# Security

This document describes how to report a security issue, what to expect when
you do, and where to find our operational security documentation.

## Reporting a vulnerability

If you believe you've found a security vulnerability in WisdomWorks, please
report it privately:

- **Email**: devonsroberson24@yahoo.com (subject prefix `[SECURITY]`)
- **Do not** open a public GitHub issue for security reports.
- **Do not** disclose the issue publicly until we've had time to investigate.

Include in your report:
- A description of the issue and its potential impact
- Steps to reproduce (proof-of-concept code if applicable)
- Any suggested remediation

We'll acknowledge receipt within 48 hours and provide an initial assessment
within 5 business days.

## Scope

In scope:
- The WisdomWorks web application (`apps/web`)
- The marketing site (`apps/website`)
- The shared package (`packages/shared`)
- Database schema and RLS policies (`db/migrations`)
- Integration code (Google, Microsoft, Stripe, WhatsApp, etc.)

Out of scope:
- Third-party services we integrate with (report directly to that vendor)
- Issues requiring physical access to a user's device
- Social-engineering attacks
- Denial-of-service via volume (we run on Vercel + Supabase autoscale)

## Internal operational documentation

For operators (Devon + future team):

- [Incident response runbook](docs/security/incident-response-runbook.md) —
  step-by-step playbooks for the highest-likelihood security events
  (credential leak, service-role key compromise, audit-log integrity
  break, RLS bypass, data-deletion request)
- Security epic plan — see `_bmad-output/planning-artifacts/epics.md`
  Epic 6 (in the repo, not customer-facing)

## Architecture references

Security-relevant code paths:

- API auth + sessions — `apps/web/app/api/_lib/api-auth.ts` (Story 6.1)
- PII redaction — `packages/shared/src/privacy/redact.ts` (Story 6.5)
- RLS helpers — `db/migrations/2026-05-14d-rls-tenant-isolation.sql` (Story 6.2)
- Hash-chained audit log — `db/migrations/2026-05-14e-unified-audit-log.sql`
  + `apps/web/app/api/_lib/audit-log.ts` (Story 6.4)
- Compliance profiles + egress guard —
  `apps/web/app/api/_lib/compliance-profile.ts` +
  `apps/web/app/api/_lib/egress-guard.ts` (Story 6.12)
- Data export + right-to-be-forgotten —
  `apps/web/app/api/compliance/{export,delete}/route.ts` (Story 6.7)
- Pre-commit secrets scanner — `scripts/check-secrets.mjs` (Story 6.9)
- Credential encryption + audit log —
  `apps/web/app/api/_lib/credential-security` + migration
  `2026-05-11-credential-security.sql` (Story 6.3)
