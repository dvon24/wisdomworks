/**
 * POST /api/connections/project
 *
 * Save a project_connections row. Tests the credentials against the
 * provider's API before saving so bad tokens fail loud instead of
 * surfacing as silent cron errors hours later.
 *
 * Vercel + GitHub credentials are encrypted at write (same encryptToken
 * shared lib used elsewhere).
 *
 * Body shape (vercel-github):
 *   {
 *     phone,
 *     project_name,
 *     agent_config_id,
 *     provider: 'vercel-github',
 *     vercel_token, vercel_project_id, vercel_team_id?,
 *     github_token, github_owner, github_repo, github_branch?
 *   }
 */

import { encryptToken, assertEncryptionConfigured } from '@wisdomworks/shared';
import { fetchVercelProject, fetchGitHubReadme, syncConnection } from '../../_lib/project-sync';
import { requireOwnerAuth } from '../../_lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    // Refuse to accept any credentials if encryption isn't configured.
    // Better to surface a hard error than silently store plaintext tokens.
    try {
      await assertEncryptionConfigured();
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 503 });
    }

    const body = await request.json();
    const {
      phone,
      project_name,
      agent_config_id,
      provider,
      vercel_token,
      vercel_project_id,
      vercel_team_id,
      github_token,
      github_owner,
      github_repo,
      github_branch,
    } = body ?? {};

    if (!phone || !project_name) {
      return Response.json({ error: 'phone and project_name required' }, { status: 400 });
    }

    // Story 6.1 deadbolt — project connections store provider tokens
    const denied = await requireOwnerAuth(request, phone);
    if (denied) return denied;

    if (!provider || provider !== 'vercel-github') {
      return Response.json({ error: 'Only vercel-github provider is implemented today' }, { status: 400 });
    }
    if (!vercel_token || !vercel_project_id || !github_token || !github_owner || !github_repo) {
      return Response.json({ error: 'vercel_token, vercel_project_id, github_token, github_owner, github_repo all required' }, { status: 400 });
    }

    // Verify creds against both providers BEFORE saving. Cheaper to fail
    // here than to silently store a bad row that breaks the cron.
    const project = await fetchVercelProject(vercel_token, vercel_project_id, vercel_team_id);
    if (!project) {
      return Response.json({ error: 'Vercel auth failed or project not found — check token and project id' }, { status: 401 });
    }
    const readme = await fetchGitHubReadme(github_token, github_owner, github_repo);
    if (!readme && readme !== '') {
      // fetchGitHubReadme returns '' on 404 but null on a real error — null
      // means we couldn't auth. Empty-string README is fine.
      return Response.json({ error: 'GitHub auth failed — check personal access token and owner/repo' }, { status: 401 });
    }

    const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');
    const credentials = {
      vercel_token: await encryptToken(vercel_token),
      vercel_project_id,
      vercel_team_id: vercel_team_id ?? undefined,
      github_token: await encryptToken(github_token),
      github_owner,
      github_repo,
      github_branch: github_branch ?? 'main',
    };
    const metadata = {
      vercel_project_name: project.name,
      deploy_url: project.production_url,
      repo_url: `https://github.com/${github_owner}/${github_repo}`,
    };

    // Upsert by (tenant_phone, project_name)
    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/project_connections?on_conflict=tenant_phone,project_name`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          project_name,
          agent_config_id: agent_config_id ?? null,
          provider: 'vercel-github',
          capability_tier: 1,
          credentials,
          metadata,
          status: 'active',
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!upsertRes.ok) {
      const text = await upsertRes.text();
      return Response.json({ error: `Save failed: ${upsertRes.status} ${text.slice(0, 200)}` }, { status: 500 });
    }
    const rows = await upsertRes.json();
    const saved = rows[0];

    // Immediately run a first sync so the agent has a baseline snapshot
    // on its very next tick instead of waiting up to 2 hours.
    if (saved) {
      void syncConnection(saved).catch((err) => console.warn('[connect-project] initial sync threw:', err));
    }

    return Response.json({
      success: true,
      connection_id: saved?.id,
      project_name: saved?.project_name,
      deploy_url: project.production_url,
      message: `Connected ${project.name}. First sync running in background — agent's next tick will have the snapshot.`,
    });
  } catch (err: any) {
    console.error('[connect-project] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
