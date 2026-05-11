/**
 * Project sync — pulls state from connected external projects (Vercel +
 * GitHub at MVP) and stores periodic snapshots in project_snapshots.
 *
 * The assigned agent's tick prompt reads the latest snapshot summary so
 * agents can speak substantively about projects without re-fetching every
 * tick. Agents can also call discovery tools (read_repo_file, list_repo_tree,
 * fetch_deployed_page) on demand for deeper investigation.
 *
 * Provider-aware: vercel-github at MVP, slots open for wix/wordpress/
 * webflow/shopify/advisory. Each provider has its own adapter; this file
 * holds the vercel-github one + the shared persistence layer.
 */

import { decryptToken } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

// ─── Vercel API ───────────────────────────────────────────────────────────

const VERCEL_API = 'https://api.vercel.com';

export interface VercelDeployment {
  id: string;
  state: string;
  target: string | null;
  url: string;
  created_at: string;
  commit_sha?: string;
  commit_message?: string;
  build_error?: string;
}

export interface VercelProjectInfo {
  id: string;
  name: string;
  production_url?: string;
}

async function vercelGet(path: string, token: string, teamId?: string): Promise<any | null> {
  try {
    const sep = path.includes('?') ? '&' : '?';
    const url = teamId ? `${VERCEL_API}${path}${sep}teamId=${teamId}` : `${VERCEL_API}${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[project-sync] Vercel ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[project-sync] Vercel ${path} threw:`, err);
    return null;
  }
}

export async function fetchVercelProject(token: string, projectId: string, teamId?: string): Promise<VercelProjectInfo | null> {
  const data = await vercelGet(`/v9/projects/${encodeURIComponent(projectId)}`, token, teamId);
  if (!data) return null;
  const prod = data.targets?.production;
  return {
    id: data.id ?? projectId,
    name: data.name ?? projectId,
    production_url: prod?.alias?.[0] ? `https://${prod.alias[0]}` : (data.latestDeployments?.[0]?.url ? `https://${data.latestDeployments[0].url}` : undefined),
  };
}

export async function fetchVercelDeployments(token: string, projectId: string, limit = 10, teamId?: string): Promise<VercelDeployment[]> {
  const data = await vercelGet(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`, token, teamId);
  if (!data?.deployments) return [];
  return data.deployments.map((d: any) => ({
    id: d.uid ?? d.id,
    state: d.state ?? d.readyState ?? 'unknown',
    target: d.target ?? null,
    url: d.url ?? '',
    created_at: d.created ? new Date(d.created).toISOString() : new Date().toISOString(),
    commit_sha: d.meta?.githubCommitSha,
    commit_message: d.meta?.githubCommitMessage,
    build_error: d.state === 'ERROR' ? (d.errorMessage ?? 'build failed') : undefined,
  }));
}

// ─── GitHub API ───────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  is_pr: boolean;
  draft?: boolean;
  labels: string[];
  url: string;
  created_at: string;
  updated_at: string;
}

async function githubGet(path: string, token: string, accept = 'application/vnd.github+json'): Promise<any | null> {
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wisdomworks-agent-runtime',
      },
    });
    if (!res.ok) {
      console.warn(`[project-sync] GitHub ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return accept.includes('raw') ? await res.text() : await res.json();
  } catch (err) {
    console.warn(`[project-sync] GitHub ${path} threw:`, err);
    return null;
  }
}

export async function fetchGitHubReadme(token: string, owner: string, repo: string): Promise<string> {
  const text = await githubGet(`/repos/${owner}/${repo}/readme`, token, 'application/vnd.github.raw');
  return (typeof text === 'string' ? text : '').slice(0, 4000);
}

export async function fetchGitHubCommits(token: string, owner: string, repo: string, limit = 20, branch?: string): Promise<GitHubCommit[]> {
  const branchParam = branch ? `&sha=${encodeURIComponent(branch)}` : '';
  const data = await githubGet(`/repos/${owner}/${repo}/commits?per_page=${limit}${branchParam}`, token);
  if (!Array.isArray(data)) return [];
  return data.map((c: any) => ({
    sha: c.sha,
    message: c.commit?.message ?? '',
    author: c.commit?.author?.name ?? c.author?.login ?? 'unknown',
    date: c.commit?.author?.date ?? '',
    url: c.html_url ?? '',
  }));
}

export async function fetchGitHubIssues(token: string, owner: string, repo: string, limit = 30): Promise<GitHubIssue[]> {
  const data = await githubGet(`/repos/${owner}/${repo}/issues?state=open&per_page=${limit}`, token);
  if (!Array.isArray(data)) return [];
  return data.map((i: any) => ({
    number: i.number,
    title: i.title ?? '',
    state: i.state ?? 'open',
    is_pr: !!i.pull_request,
    draft: i.draft,
    labels: (i.labels ?? []).map((l: any) => typeof l === 'string' ? l : l.name).filter(Boolean),
    url: i.html_url ?? '',
    created_at: i.created_at ?? '',
    updated_at: i.updated_at ?? '',
  }));
}

export async function fetchGitHubFile(token: string, owner: string, repo: string, path: string, branch?: string): Promise<string | null> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const text = await githubGet(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}${ref}`, token, 'application/vnd.github.raw');
  return typeof text === 'string' ? text : null;
}

export async function fetchGitHubTree(token: string, owner: string, repo: string, path = '', branch?: string): Promise<{ name: string; type: string; path: string }[]> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const data = await githubGet(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}${ref}`, token);
  if (!Array.isArray(data)) return [];
  return data.map((e: any) => ({ name: e.name, type: e.type, path: e.path }));
}

// ─── Combined Vercel + GitHub sync (Tier 1) ───────────────────────────────

export interface SyncResult {
  snapshot_data: any;
  summary: string;
  diff_summary?: string;
}

interface VercelGithubCreds {
  vercel_token: string;
  vercel_project_id: string;
  vercel_team_id?: string;
  github_token: string;
  github_owner: string;
  github_repo: string;
  github_branch?: string;
}

export async function syncVercelGithub(creds: VercelGithubCreds, previousSnapshot?: any): Promise<SyncResult> {
  const vtoken = await decryptToken(creds.vercel_token);
  const gtoken = await decryptToken(creds.github_token);

  const [project, deployments, commits, issues, readme] = await Promise.all([
    fetchVercelProject(vtoken, creds.vercel_project_id, creds.vercel_team_id),
    fetchVercelDeployments(vtoken, creds.vercel_project_id, 10, creds.vercel_team_id),
    fetchGitHubCommits(gtoken, creds.github_owner, creds.github_repo, 15, creds.github_branch),
    fetchGitHubIssues(gtoken, creds.github_owner, creds.github_repo, 30),
    fetchGitHubReadme(gtoken, creds.github_owner, creds.github_repo),
  ]);

  const prodDeploy = deployments.find((d) => d.target === 'production') ?? deployments[0];
  const lastErrorDeploys = deployments.filter((d) => d.state === 'ERROR').slice(0, 3);
  const buildStatus = prodDeploy?.state === 'READY' ? 'ready'
    : prodDeploy?.state === 'ERROR' ? 'error'
    : prodDeploy?.state === 'BUILDING' || prodDeploy?.state === 'QUEUED' ? 'building'
    : 'unknown';

  const openIssues = issues.filter((i) => !i.is_pr);
  const openPRs = issues.filter((i) => i.is_pr);

  const snapshot_data = {
    project_name: project?.name ?? creds.github_repo,
    deploy_url: project?.production_url ?? (prodDeploy?.url ? `https://${prodDeploy.url}` : undefined),
    build_status: buildStatus,
    deployments: deployments.slice(0, 5),
    recent_commits: commits.slice(0, 10),
    open_issues: openIssues.slice(0, 15),
    open_prs: openPRs.slice(0, 10),
    readme_excerpt: readme.slice(0, 2000),
    recent_errors: lastErrorDeploys.map((d) => ({ when: d.created_at, message: d.build_error ?? 'build error', deploy_id: d.id })),
    synced_at: new Date().toISOString(),
  };

  // Build a tight summary the agent can read in one glance
  const summaryParts: string[] = [];
  summaryParts.push(`Production: ${buildStatus}${snapshot_data.deploy_url ? ` (${snapshot_data.deploy_url})` : ''}.`);
  if (commits.length > 0) summaryParts.push(`Last commit: "${commits[0]!.message.split('\n')[0]?.slice(0, 80)}" by ${commits[0]!.author}.`);
  if (openIssues.length > 0) summaryParts.push(`${openIssues.length} open issue${openIssues.length === 1 ? '' : 's'}.`);
  if (openPRs.length > 0) summaryParts.push(`${openPRs.length} open PR${openPRs.length === 1 ? '' : 's'}.`);
  if (lastErrorDeploys.length > 0) summaryParts.push(`${lastErrorDeploys.length} recent build error${lastErrorDeploys.length === 1 ? '' : 's'}.`);
  const summary = summaryParts.join(' ');

  // Compare to previous snapshot to surface what's changed
  let diff_summary: string | undefined;
  if (previousSnapshot) {
    const prevCommitShas = new Set<string>((previousSnapshot.recent_commits ?? []).map((c: any) => c.sha));
    const newCommits = commits.filter((c) => !prevCommitShas.has(c.sha));
    const prevIssueNumbers = new Set<number>((previousSnapshot.open_issues ?? []).map((i: any) => i.number));
    const newIssues = openIssues.filter((i) => !prevIssueNumbers.has(i.number));
    const prevPRNumbers = new Set<number>((previousSnapshot.open_prs ?? []).map((p: any) => p.number));
    const newPRs = openPRs.filter((p) => !prevPRNumbers.has(p.number));
    const prevDeployIds = new Set<string>((previousSnapshot.deployments ?? []).map((d: any) => d.id));
    const newDeploys = deployments.filter((d) => !prevDeployIds.has(d.id));
    const statusChanged = previousSnapshot.build_status && previousSnapshot.build_status !== buildStatus;

    const parts: string[] = [];
    if (statusChanged) parts.push(`build status: ${previousSnapshot.build_status} → ${buildStatus}`);
    if (newCommits.length > 0) parts.push(`${newCommits.length} new commit${newCommits.length === 1 ? '' : 's'}`);
    if (newDeploys.length > 0) parts.push(`${newDeploys.length} new deploy${newDeploys.length === 1 ? '' : 's'}`);
    if (newIssues.length > 0) parts.push(`${newIssues.length} new issue${newIssues.length === 1 ? '' : 's'}`);
    if (newPRs.length > 0) parts.push(`${newPRs.length} new PR${newPRs.length === 1 ? '' : 's'}`);
    diff_summary = parts.length > 0 ? `Since last sync: ${parts.join(', ')}.` : 'No changes since last sync.';
  }

  return { snapshot_data, summary, diff_summary };
}

// ─── Persistence ──────────────────────────────────────────────────────────

interface ProjectConnection {
  id: string;
  tenant_phone: string;
  agent_config_id: string | null;
  project_name: string;
  provider: string;
  capability_tier: number;
  credentials: any;
  metadata: any;
  status: string;
}

export async function loadActiveConnections(): Promise<ProjectConnection[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/project_connections?status=eq.active&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function loadConnection(connectionId: string): Promise<ProjectConnection | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/project_connections?id=eq.${connectionId}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function loadConnectionsForAgent(agentConfigId: string): Promise<ProjectConnection[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/project_connections?agent_config_id=eq.${agentConfigId}&status=eq.active&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function loadLatestSnapshot(connectionId: string): Promise<any | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/project_snapshots?project_connection_id=eq.${connectionId}&order=taken_at.desc&limit=1&select=snapshot_data,summary,diff_summary,taken_at`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function persistSnapshot(connectionId: string, tenantPhone: string, result: SyncResult): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/project_snapshots`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        project_connection_id: connectionId,
        tenant_phone: tenantPhone,
        snapshot_data: result.snapshot_data,
        summary: result.summary,
        diff_summary: result.diff_summary ?? null,
      }),
    });
    if (!res.ok) {
      console.warn(`[project-sync] persist failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    await markConnectionSynced(connectionId);
    return true;
  } catch (err) {
    console.warn('[project-sync] persist threw:', err);
    return false;
  }
}

export async function markConnectionSynced(connectionId: string, error?: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/project_connections?id=eq.${connectionId}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      last_synced_at: new Date().toISOString(),
      last_sync_error: error ?? null,
      status: error ? 'error' : 'active',
    }),
  });
}

/**
 * Top-level sync entrypoint — picks the right adapter by provider, runs it,
 * persists the snapshot. Returns whether anything was persisted.
 */
export async function syncConnection(conn: ProjectConnection): Promise<{ ok: boolean; error?: string }> {
  try {
    const prev = await loadLatestSnapshot(conn.id);
    let result: SyncResult;

    if (conn.provider === 'vercel-github') {
      result = await syncVercelGithub(conn.credentials as VercelGithubCreds, prev?.snapshot_data);
    } else {
      const err = `provider ${conn.provider} not implemented yet`;
      await markConnectionSynced(conn.id, err);
      return { ok: false, error: err };
    }

    const ok = await persistSnapshot(conn.id, conn.tenant_phone, result);
    return { ok };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await markConnectionSynced(conn.id, msg);
    return { ok: false, error: msg };
  }
}
