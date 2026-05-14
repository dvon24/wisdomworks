#!/usr/bin/env node
/**
 * Story 6.9 — Pre-commit secrets scanner.
 *
 * Scans the files staged for commit for high-confidence secret patterns
 * (vendor API keys, JWTs, AWS keys, etc.) and blocks the commit if any
 * are found. Invoked via .githooks/pre-commit which runs on every
 * `git commit`.
 *
 * Run manually with: node scripts/check-secrets.mjs
 *   --all   scan the entire working tree (not just staged files)
 *   --since=<ref>  scan files changed since a git ref
 *
 * Skips:
 *   - The scanner itself (this file) so its example patterns don't trip it
 *   - Files matching .gitignore patterns (already not staged)
 *   - Binary files
 *   - Files larger than 1MB (rare for source; can hide rotation noise)
 *
 * Allow-listing a false positive: add the SHA-256 of the matching line
 * (the script prints it on a hit) to scripts/secrets-allowlist.txt, one
 * hash per line. Comments with `#` permitted.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const SCANNER_SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join('/');
const ALLOWLIST_PATH = join(__dirname, 'secrets-allowlist.txt');

// High-confidence patterns. Each is a vendor-specific shape unlikely to
// false-positive. Generic "high entropy string" detection is intentionally
// NOT included — too noisy. False positives waste developer time and
// erode trust in the gate. Add new patterns ONLY when the false-positive
// rate is very low.
const PATTERNS = [
  { name: 'anthropic_api_key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai_api_key_legacy', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'openai_api_key_project', re: /\bsk-proj-[A-Za-z0-9_-]{40,}\b/g },
  { name: 'stripe_secret_key', re: /\bsk_(?:test|live)_[A-Za-z0-9]{24,}\b/g },
  { name: 'stripe_publishable_key', re: /\bpk_(?:test|live)_[A-Za-z0-9]{24,}\b/g },
  { name: 'stripe_webhook_secret', re: /\bwhsec_[A-Za-z0-9]{32,}\b/g },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'aws_access_key_id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'aws_secret_access_key', re: /\baws[_-]?secret[_-]?access[_-]?key["'\s:=]+[A-Za-z0-9/+=]{40}\b/gi },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'twilio_auth_token', re: /\bSK[a-f0-9]{32}\b/g },
  // JWT — three base64url-ish segments separated by dots. We require the
  // first segment to start with eyJ (decodes to `{"`).
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Slack bot tokens.
  { name: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  // Supabase keys often appear as JWT (caught above) but also as
  // service_role anon keys with the literal "service_role" payload.
  // The JWT pattern above catches them.
];

// Files that look like env files. Block ANY *.env file from being staged
// other than the documented examples.
const ENV_FILE_PATTERNS = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.env$/,
];
const ENV_FILE_ALLOWED = [
  /(^|\/)\.env\.example$/,
  /(^|\/)\.env\.sample$/,
  /(^|\/)\.env\.local\.example$/,
];

// Max file size to scan (bytes). Larger files are skipped.
const MAX_FILE_SIZE = 1024 * 1024;

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return new Set();
  return new Set(
    readFileSync(ALLOWLIST_PATH, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
}

function listStagedFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function listAllFiles() {
  const out = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function listFilesSince(ref) {
  const out = execSync(`git diff --name-only --diff-filter=ACMR ${ref}...HEAD`, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function isBinary(buffer) {
  // Cheap heuristic: presence of NUL byte in first 8kb.
  const head = buffer.slice(0, 8192);
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return true;
  }
  return false;
}

function lineHash(line) {
  return createHash('sha256').update(line).digest('hex');
}

function scanFile(relativePath, allowlist, allHits) {
  // Block disallowed .env files outright.
  if (ENV_FILE_PATTERNS.some((re) => re.test(relativePath))) {
    if (!ENV_FILE_ALLOWED.some((re) => re.test(relativePath))) {
      allHits.push({
        file: relativePath,
        line: 0,
        text: '<env file staged>',
        patternName: 'env_file',
        hash: '',
      });
      return;
    }
  }

  // Don't scan the scanner itself — its pattern strings would trip it.
  if (relativePath === SCANNER_SELF) return;
  // Don't scan the allowlist file itself.
  if (relativePath === 'scripts/secrets-allowlist.txt') return;

  const fullPath = join(REPO_ROOT, relativePath);
  if (!existsSync(fullPath)) return;
  const stat = statSync(fullPath);
  if (!stat.isFile()) return;
  if (stat.size > MAX_FILE_SIZE) return;
  const buf = readFileSync(fullPath);
  if (isBinary(buf)) return;
  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      const matches = line.matchAll(re);
      for (const m of matches) {
        const hash = lineHash(line);
        if (allowlist.has(hash)) continue;
        allHits.push({
          file: relativePath,
          line: i + 1,
          text: line.length > 200 ? line.slice(0, 200) + '...' : line,
          patternName: name,
          match: m[0].slice(0, 12) + '...',
          hash,
        });
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const allFlag = args.includes('--all');
  const sinceArg = args.find((a) => a.startsWith('--since='));

  let files;
  if (allFlag) files = listAllFiles();
  else if (sinceArg) files = listFilesSince(sinceArg.slice(8));
  else files = listStagedFiles();

  if (files.length === 0) {
    process.exit(0);
  }

  const allowlist = loadAllowlist();
  const hits = [];

  for (const f of files) {
    scanFile(f, allowlist, hits);
  }

  if (hits.length === 0) {
    process.exit(0);
  }

  process.stderr.write('\n');
  process.stderr.write('🔒 Pre-commit secrets scan — BLOCKED\n');
  process.stderr.write('━'.repeat(60) + '\n');
  for (const h of hits) {
    process.stderr.write(
      `\n${h.file}:${h.line} — ${h.patternName}\n` +
        (h.match ? `   matched: ${h.match}\n` : '') +
        `   line: ${h.text.trim()}\n` +
        (h.hash ? `   allowlist hash: ${h.hash}\n` : ''),
    );
  }
  process.stderr.write('\n━'.repeat(60) + '\n');
  process.stderr.write(`\nFound ${hits.length} potential secret(s).\n\n`);
  process.stderr.write('Options:\n');
  process.stderr.write('  1. Remove the secret, use process.env.* + Vercel env var\n');
  process.stderr.write('  2. If a false positive, add the SHA-256 hash above to\n');
  process.stderr.write('     scripts/secrets-allowlist.txt (one hash per line, # for comments)\n');
  process.stderr.write('  3. To bypass for one commit (DANGEROUS): git commit --no-verify\n\n');
  process.exit(1);
}

main();
