#!/usr/bin/env node
/**
 * iris-debug — fire a test message at Iris and print a readable audit of
 * everything she did (tools called, gates fired, tokens, cost, draft vs final).
 *
 * Wraps POST /api/debug/iris. Run against a local dev server or a deployment.
 *
 * Usage:
 *   node scripts/iris-debug.mjs "what's on my calendar today?"
 *   node scripts/iris-debug.mjs --phone 491703604562 "rename Sophia to Iris"
 *   node scripts/iris-debug.mjs --surface deck --json "pull my P&L"
 *
 * Env (or .env / .env.local, auto-loaded):
 *   IRIS_DEBUG_URL    base URL of the app        (default http://localhost:3000)
 *   IRIS_DEBUG_PHONE  owner phone to run as       (or pass --phone)
 *   OWNER_API_TOKEN   bearer token for the deadbolt (required unless you have
 *                     a session cookie, which curl/node won't)
 *
 * Flags:
 *   --phone <num>     owner phone (overrides IRIS_DEBUG_PHONE)
 *   --surface <s>     whatsapp|deck|telegram|sms|imessage  (default whatsapp)
 *   --url <base>      app base URL (overrides IRIS_DEBUG_URL)
 *   --json            print the raw JSON trace instead of the formatted view
 *   --persist         write history/usage/mining like a real turn (default OFF —
 *                     debug runs are non-polluting by default; tools still execute)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── tiny .env loader (no dep) ──────────────────────────────────────────────
function loadEnv(file) {
  try {
    const txt = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* file may not exist — fine */
  }
}
loadEnv('.env.local');
loadEnv('.env');

// ── arg parsing ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let phone = process.env.IRIS_DEBUG_PHONE;
let surface = 'whatsapp';
let base = process.env.IRIS_DEBUG_URL || 'http://localhost:3000';
let raw = false;
let persist = false;
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--phone') phone = args[++i];
  else if (a === '--surface') surface = args[++i];
  else if (a === '--url') base = args[++i];
  else if (a === '--json') raw = true;
  else if (a === '--persist') persist = true;
  else rest.push(a);
}
const message = rest.join(' ').trim();

if (!message) {
  console.error('Usage: node scripts/iris-debug.mjs [--phone N] [--surface S] [--url U] [--json] "your message"');
  process.exit(1);
}
if (!phone) {
  console.error('No phone. Pass --phone <num> or set IRIS_DEBUG_PHONE.');
  process.exit(1);
}

const token = process.env.OWNER_API_TOKEN;
const headers = { 'content-type': 'application/json' };
if (token) headers['authorization'] = `Bearer ${token}`;

// ── call ─────────────────────────────────────────────────────────────────
// phone goes in the QUERY string (not just the body): the Bearer-token admin
// auth path reads the actor phone from `?phone=` and won't read the body.
const url = `${base.replace(/\/$/, '')}/api/debug/iris?phone=${encodeURIComponent(phone)}`;
console.error(`→ POST ${url}  (surface ${surface}, persist ${persist})\n`);

let res;
try {
  res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone, message, surface, persist }),
  });
} catch (err) {
  console.error(`Request failed: ${err.message}`);
  console.error('Is the dev server running?  pnpm dev  (or set --url to your deployment)');
  process.exit(1);
}

const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error(`HTTP ${res.status} — non-JSON response:\n${text.slice(0, 1000)}`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${JSON.stringify(data, null, 2)}`);
  if (res.status === 401) console.error('\nHint: set OWNER_API_TOKEN in your env.');
  process.exit(1);
}

if (raw) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

// ── formatted view ─────────────────────────────────────────────────────────
const t = data.trace || {};
const s = data.summary || {};
const line = '─'.repeat(64);

const out = [];
out.push(line);
out.push(`IRIS DEBUG TRACE  ·  ${t.surface}  ·  ${t.model}  ·  effort=${t.effort}`);
out.push(line);
out.push(`Iterations:   ${t.iterations}${t.hitIterationCap ? '  ⚠ HIT CAP' : ''}`);
out.push(`Tools avail:  ${t.toolCount} (${(t.connections || []).join(', ') || 'no connections'})`);
out.push(`Tokens:       ${s.tokens_in} in / ${s.tokens_out} out  ·  ${s.cache_hit_pct}% cache hit`);
out.push(`Cost:         $${s.cost_usd}`);
out.push(`Duration:     ${t.durationMs}ms (brain)  ·  ${data.endpoint_ms}ms (endpoint)`);
out.push('');

out.push('TOOL CALLS');
if (!t.steps || t.steps.length === 0) {
  out.push('  (none — answered from context, no tools called)');
} else {
  for (const step of t.steps) {
    const ok = step.success ? '✓' : '✗';
    out.push(`  ${ok} [it${step.iteration}] ${step.tool}  (${step.caller}, ${step.durationMs}ms)`);
    const inp = JSON.stringify(step.input);
    out.push(`      in:  ${inp.length > 160 ? inp.slice(0, 160) + '…' : inp}`);
    const prev = (step.resultPreview || '').replace(/\s+/g, ' ').trim();
    out.push(`      out: ${prev.length > 160 ? prev.slice(0, 160) + '…' : prev}`);
    if (step.ownerConfirmation) out.push(`      ✓ confirm: ${step.ownerConfirmation}`);
  }
}
out.push('');

out.push('GATES FIRED');
if (!t.gates || t.gates.length === 0) {
  out.push('  (none — draft shipped unchanged)');
} else {
  for (const g of t.gates) {
    out.push(`  • ${g.gate} → ${g.action}`);
    out.push(`      ${g.detail}`);
  }
}
out.push('');

if (s.draft_changed_by_gates) {
  out.push('DRAFT (model first instinct)');
  out.push('  ' + (t.draftReply || '').split('\n').join('\n  '));
  out.push('');
}
out.push('FINAL REPLY (what ships)');
out.push('  ' + (data.reply || '').split('\n').join('\n  '));
out.push('');
if (t.error) out.push(`⚠ ERROR: ${t.error}`);
out.push(line);
out.push(`note: ${data.note}`);

console.log(out.join('\n'));
