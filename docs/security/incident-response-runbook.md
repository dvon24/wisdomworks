# Incident Response Runbook

Step-by-step playbooks for the highest-likelihood security incidents in
WisdomWorks. Each playbook is structured: detect → contain → eradicate →
recover → post-mortem.

When in doubt, **contain first, investigate second**. A locked-down system
recovering from a panic is cheaper than a slowly-burning compromise.

## Severity classification

| Level | Definition | Response time | Pager-equivalent? |
|-------|------------|---------------|-------------------|
| **SEV-1** | Active compromise, tenant data exposure, paid-customer impact | Immediate (within 15 min) | Yes — interrupt whatever you're doing |
| **SEV-2** | Credible threat (leaked key found in logs, audit-chain break, anomalous admin access) | Within 1 hour | Within working hours; finish current task first |
| **SEV-3** | Defense-in-depth signal (scanner caught a near-miss, dependency CVE) | Within 1 business day | No — handle during normal work |

## Common first steps (apply to all SEV-1)

1. **Open an incident note** — plain text file or doc. Timestamp every action.
   Future-you needs the timeline; auditors will too.
2. **Don't panic-rotate** — rotating a credential before understanding the
   blast radius can break downstream systems. Contain first.
3. **Preserve evidence** — do NOT delete logs, do NOT drop the audit chain.
   The unified_audit_log is append-only on purpose; keep it that way.
4. **Snapshot before changes** — if you're about to modify the production
   DB, take a Supabase PITR snapshot first.

---

## Playbook 1 — Leaked credential discovered

### Symptoms
- Pre-commit secrets scanner triggered locally on a commit
- GitHub Secret Scanning alert
- Anthropic / OpenAI / Stripe sends a credential-rotation warning email
- Someone tweets / blogs a key that looks like ours

### Detect
1. Identify the leaked credential type (Anthropic key, Stripe key, Supabase
   service-role, GitHub token, etc.).
2. If from a git commit, capture: commit SHA, branch, file path, who
   committed, what time.
3. If from a third-party warning, get the exact key prefix + last-active
   timestamp the provider reports.

### Contain
1. **Rotate the leaked credential at the provider** before doing anything
   else. The few minutes between rotation and updating Vercel env vars
   is your only exposure window — much shorter than leaving the leaked
   key live.
2. Update the corresponding Vercel env var in
   `vercel.com/dvon24/wisdomworks` → Settings → Environment Variables.
3. Trigger a Vercel redeploy (`vercel deploy --prod` or push an empty commit).
4. **If the leaked credential is `SUPABASE_SERVICE_ROLE_KEY`**: follow
   Playbook 2 instead — that's its own SEV-1.

### Eradicate
1. If the leak was in a git commit: do NOT just delete the file in a new
   commit. The commit history still contains the secret. Either:
   - Rewrite history (`git filter-repo` or BFG) + force-push + invalidate
     any downstream forks. Coordinate with everyone who pulled.
   - Or accept that the historical commit is public and rely on the
     rotation (the key is dead; the literal characters in history are
     useless).
2. Audit other repos / chat logs / shared docs for the same secret.

### Recover
1. Verify the new credential works (test a representative API call).
2. Check `unified_audit_log` for any unusual activity in the
   exposure window:
   ```sql
   SELECT * FROM unified_audit_log
   WHERE created_at >= '<window_start>'
     AND outcome IN ('blocked', 'failure')
   ORDER BY created_at DESC;
   ```
3. Check `credential_access_log` for unusual reads of the leaked
   credential's row:
   ```sql
   SELECT * FROM credential_access_log
   WHERE accessed_at >= '<window_start>'
   ORDER BY accessed_at DESC LIMIT 100;
   ```

### Post-mortem
- Why did the secret end up where it leaked from? Process gap?
- Was the pre-commit scanner enabled at commit time? If no, who's missing
  the hook? Re-run `pnpm install` in their checkout.
- Add to `scripts/check-secrets.mjs` if a new pattern was missed.

---

## Playbook 2 — Supabase service-role key compromised

This is the worst-case scenario. The service-role key bypasses RLS,
encryption, and all application-layer auth. **SEV-1, no debate.**

### Detect
- Same triggers as Playbook 1, but specifically for the `SUPABASE_SERVICE_ROLE_KEY`
- OR: unusual DB activity in Supabase Dashboard (mass deletes, schema
  changes, queries from unrecognized IPs)
- OR: audit chain integrity verification fails (Playbook 3)

### Contain (do these in parallel if you have help)
1. **Rotate the service-role key** in Supabase Dashboard → Settings → API.
2. **Snapshot the database** — Dashboard → Database → Backups → "Create
   manual backup." Preserves the current state for forensics.
3. **Update Vercel env var** + redeploy.
4. **Verify rotation took effect** — try an old curl with the old key,
   should get 401.

### Eradicate
1. **Verify audit chain integrity** for each tenant — run
   `verify_audit_chain(tenant_phone)` for every active tenant. Any
   tenant returning `broken_at != null` had rows modified outside the
   normal path. Note them.
2. **Inventory non-revertible damage**:
   - Sent emails, posted social content, transferred money — can't be
     un-sent. List them from the audit log.
   - Tool invocations that triggered third-party side effects — same.
3. **Check OAuth credentials**: the attacker could have decrypted stored
   `oauth_connections` rows (we encrypt at rest with `TOKEN_ENCRYPTION_KEY`,
   but the service role could read that key from env if it accessed
   Vercel). If you suspect Vercel env var access, rotate
   `TOKEN_ENCRYPTION_KEY` AND every tenant's connected OAuth tokens
   (force re-auth via the deck Connections tab).

### Recover
1. Restore from snapshot if data was destructively modified (deletion,
   mass update). Use Supabase PITR to a timestamp before the incident.
2. Notify affected tenants if their data was exposed. **GDPR Article 33**:
   notify the relevant supervisory authority within 72 hours of becoming
   aware of a personal-data breach.
3. Update `tenant_compliance_profiles.metadata` with breach notification
   timestamps for compliance-flagged tenants.

### Post-mortem
- How did the service-role key escape? It should ONLY exist in Vercel env
  vars + Devon's local `.env.local`. Audit access to both.
- Consider rotating to short-lived service tokens via a vault layer
  (this is Phase B of Story 6.2 — not built yet, but this incident is
  the priority signal to build it).

---

## Playbook 3 — Audit chain integrity break

The `verify_audit_chain(tenant_phone)` RPC reports `broken_at != null`.
Some historical audit row has been modified or deleted.

### Detect
- Periodic verification job reports a break (we don't have this cron yet —
  build it as a follow-on)
- Manual `verify_audit_chain` invocation during another incident
- Auditor running their own check

### Contain
1. Capture the `broken_at` UUID, the `break_reason`, the tenant_phone.
2. Snapshot the database (Supabase Dashboard → manual backup).
3. **Do NOT attempt to "fix" the chain** by recomputing hashes. The break
   IS the evidence; repairing it would destroy the only signal you have.
4. If the chain break is recent (last few hours), follow Playbook 2 —
   assume service-role compromise until proven otherwise.

### Eradicate
1. Identify what changed. The audit log row's payload may show the
   original action; query for that table + tenant + time window in the
   actual data tables and look for inconsistencies.
2. Check `credential_access_log` and `pg_stat_activity` for unusual
   database sessions around the break time.

### Recover
1. If service-role compromise confirmed: follow Playbook 2.
2. If a bug in our code corrupted the audit log (less likely but
   possible): identify and patch, then re-run verification to confirm
   chain is now stable going forward. The historical break STAYS — we
   don't rewrite history.

### Post-mortem
- Add an alert if `verify_audit_chain` fails.
- Consider a scheduled cron that runs verification across all tenants
  daily and pages on first failure.

---

## Playbook 4 — Unauthorized data deletion request

Someone requests deletion of a tenant's data — could be the tenant
themselves (legitimate GDPR/CCPA right-to-be-forgotten) OR could be a
malicious actor trying to nuke a competitor's data.

### Detect
- POST to `/api/compliance/delete` from an unexpected source
- WhatsApp/email from a tenant saying "delete my account"
- Legal notice from a tenant's lawyer

### Contain
1. **Do NOT process the deletion immediately.** The endpoint requires
   admin token + foot-gun confirmation string, but a social-engineering
   attack might have those.
2. Verify the request is genuine:
   - For owner-initiated: respond on the registered channel (their
     WhatsApp owner phone), require a confirmation reply.
   - For legal-channel requests: verify the requesting party is
     authorized (the tenant of record, an authorized agent, or a
     supervisory authority).
3. If suspicious: respond "we received your request, processing within
   30 days per GDPR" — gives time to verify without breaching deadline.

### Eradicate
N/A — there's nothing to eradicate. This is about NOT performing a
destructive action under false pretenses.

### Recover
1. If verified legitimate: run `/api/compliance/delete` with the
   confirmation string. The audit entry pre-deletion preserves the
   record.
2. If verified malicious: log the attempt to `unified_audit_log`
   (action=`governance.bypass`, outcome=`blocked`), preserve the
   request context, consider notifying law enforcement if there's a
   pattern.

### Post-mortem
- Should the deletion endpoint require two-factor / two-person approval
  for paying tenants? Likely yes; build as a follow-on.

---

## Playbook 5 — RLS bypass discovery

Someone reports a query path that bypasses tenant isolation — e.g. an
anon-key call returning another tenant's data, or a missing policy on
a new table.

### Detect
- Security report (responsible disclosure)
- Code review catches a missing `app_tenant_phone()` policy check
- Pen-test finding

### Contain
1. Identify the affected endpoint(s) + table(s).
2. If the issue is fixable in DB only (missing policy): write the
   `CREATE POLICY` statement; review; apply via Supabase SQL Editor.
3. If the issue is in app code (e.g. a route uses anon key without
   setting tenant context): patch the route to either use service-role
   correctly OR call `set_config('app.tenant_phone', $phone, true)`
   before queries. Deploy.

### Eradicate
1. Query `unified_audit_log` for any access patterns matching the
   bypass:
   ```sql
   SELECT * FROM unified_audit_log
   WHERE action = 'data.export' OR action LIKE 'admin.%'
   AND created_at >= '<discovery_window>';
   ```
2. Check the affected table's recent reads for cross-tenant access
   (harder — we don't log per-row reads). Best you can do is review
   server logs for the affected endpoint.

### Recover
1. Notify affected tenants if cross-tenant data exposure occurred.
2. Add a regression test that exercises the bypass path with anon key.

### Post-mortem
- How did the missing policy land? Was the new table created without
  going through the canonical migration pattern?
- Add a CI check that scans new migrations for tenant-scoped tables
  lacking RLS (follow-on enhancement).

---

## Quick reference — environment variables that matter

| Variable | Risk if leaked | Rotation difficulty |
|----------|----------------|--------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | **Catastrophic** — full DB access, RLS bypass | Easy (Supabase Dashboard) |
| `ANTHROPIC_API_KEY` | Token cost, agent impersonation | Easy (Anthropic Console) |
| `STRIPE_SECRET_KEY` | Customer payment exposure, refund manipulation | Easy (Stripe Dashboard) |
| `TOKEN_ENCRYPTION_KEY` | Decrypts stored OAuth tokens | **Hard** — re-encrypts ALL `oauth_connections` rows |
| `API_AUTH_SECRET` | Forge owner session cookies | Medium (invalidates all sessions) |
| `OWNER_API_TOKEN` | Admin endpoint access | Easy (Vercel env var) |
| `WHATSAPP_ACCESS_TOKEN` | Send/receive on owner's WhatsApp number | Medium (Meta Business Manager) |
| `CRON_SECRET` | Trigger crons manually | Easy |

## Contact list

- Devon Roberson — owner, devonsroberson24@yahoo.com
- Anthropic security — security@anthropic.com (Claude API issues)
- Supabase security — security@supabase.com
- Stripe security — security@stripe.com
- Meta security (WhatsApp) — facebook.com/whitehat
