#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Verifies that each production domain points at the newest READY production
// deployment of its Vercel project, and (with --fix) repairs a stale alias by
// running `vercel promote` on that deployment (AGL-542).
//
// It ALSO asserts that the serving deployment was built from the current
// production branch HEAD (AGL-566). Alias currency alone is not enough: when a
// production merge's Vercel↔GitHub webhook is dropped, NO deployment is created
// for that commit, so the newest READY deployment is an older commit and the
// alias points at it — "current" by the alias check, yet missing the merge.
// This guard compares the newest deployment's `githubCommitSha` (Vercel API)
// against `git ls-remote <remote> production` and flags a build that lags HEAD.
// The `www` project runs a per-path ignore-build-step (it only rebuilds when
// `apps/www` changes), so its commit legitimately trails HEAD — it's reported
// but never fails (`alwaysBuilds: false`).
//
// Why this exists: after promoting to production, the tenant wildcard domain
// (*.aglyn.app) has repeatedly stayed aliased to a STALE deployment. Directory
// links are a footgun here — the repo-root `.vercel/repo.json` maps EVERY
// directory to the console project (`app-aglyn-io`) — so this script never
// relies on the cwd link at all: it names the project explicitly in
// `vercel ls <project> --prod`, identifies deployments by URL, and
// cross-checks every result against the project name that `vercel inspect`
// reports. A mismatch aborts rather than trusting the wrong project.
//
// Usage (rides your existing `vercel` CLI login; the commit check additionally
// reads the CLI's own token from `VERCEL_TOKEN` or the CLI auth file to call
// the Vercel API — the same credential the CLI uses, never a new secret):
//
//   node tools/deploy/verify-production-aliases.mjs           # verify only
//   node tools/deploy/verify-production-aliases.mjs --fix     # promote when stale
//   node tools/deploy/verify-production-aliases.mjs --json    # machine output
//
// Env knobs for the commit check (all optional):
//   VERCEL_TOKEN     API token (else the CLI auth file is read)
//   DEPLOY_REMOTE    git remote that Vercel builds from (else auto-detect zgover/core)
//   DEPLOY_BRANCH    production branch name (default: production)
//
// Exit codes: 0 = all domains current AND on HEAD; 1 = a domain is stale, or an
// always-build project's deployment lags HEAD (a missed build); 2 = operational
// error (vercel missing/not authenticated, unparseable CLI output).
//
// CLI quirks handled here: `vercel inspect` prints to STDERR (we capture
// both streams); piped `vercel ls` emits bare deployment URLs with no status
// column (we confirm Ready via inspect); every inspect is timed out at ~30s.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEAM_SCOPE = 'team_Mu9NFauDO31nvj89PgmQJEtN'
const INSPECT_TIMEOUT_MS = 30_000
const LS_TIMEOUT_MS = 60_000
const PROMOTE_TIMEOUT_MS = 240_000
// Deep enough to reach a Ready deployment past the run of Canceled entries the
// ignore-step produces on every non-production push.
const MAX_LS_CANDIDATES = 25

const PROJECTS = [
  {
    name: 'app-aglyn-io',
    label: 'console',
    domains: ['https://app.aglyn.io'],
    // Builds on every production push; its commit must equal HEAD.
    alwaysBuilds: true,
  },
  {
    name: 'tenant-aglyn-app',
    label: 'tenant',
    // northwind-coffee.aglyn.app probes the *.aglyn.app wildcard alias.
    domains: ['https://northwind-coffee.aglyn.app'],
    alwaysBuilds: true,
  },
  {
    name: 'www-aglyn-io',
    label: 'www',
    // The aglyn.app apex serves the marketing site, not the tenant wildcard.
    domains: ['https://aglyn.app'],
    // Per-path ignore-build-step: rebuilds only when apps/www changes, so its
    // commit trails HEAD by design — report the SHA, never fail on it.
    alwaysBuilds: false,
  },
  {
    name: 'docs-aglyn-io',
    label: 'docs',
    // Docusaurus docs site (apps/docs). Builds on every production push;
    // three consecutive Error builds went unnoticed until AGL-580 because
    // this project wasn't verified — a lagging commit now flags loudly.
    domains: ['https://docs.aglyn.io'],
    alwaysBuilds: true,
  },
]

const args = process.argv.slice(2)
const FIX = args.includes('--fix')
const JSON_OUT = args.includes('--json')
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: node tools/deploy/verify-production-aliases.mjs [--fix] [--json]\n\n' +
      'Verifies app.aglyn.io, *.aglyn.app (via northwind-coffee.aglyn.app) and\n' +
      'aglyn.app against the newest READY production deployment of their Vercel\n' +
      'projects. --fix promotes the newest deployment when a domain is stale.\n' +
      'Exit codes: 0 current, 1 stale, 2 operational error.',
  )
  process.exit(0)
}
const unknown = args.filter((a) => !['--fix', '--json'].includes(a))
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(' ')} (try --help)`)
  process.exit(2)
}

// Progress goes to stderr so --json keeps stdout machine-clean.
const log = (msg) => process.stderr.write(msg + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function vercel(cmdArgs, { timeoutMs = INSPECT_TIMEOUT_MS } = {}) {
  return new Promise((resolveP) => {
    execFile(
      'vercel',
      [...cmdArgs, '--scope', TEAM_SCOPE],
      {
        cwd: repoRoot,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      },
      (error, stdout, stderr) => {
        resolveP({
          ok: !error,
          binMissing: error?.code === 'ENOENT',
          timedOut: Boolean(error && error.killed),
          stdout: stdout ?? '',
          // `vercel inspect` prints to stderr; always keep both streams.
          out: `${stdout ?? ''}\n${stderr ?? ''}`.trim(),
        })
      },
    )
  })
}

const hostOf = (url) => {
  if (!url) return null
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

const short = (sha) => (sha ? sha.slice(0, 7) : '—')

/**
 * The Vercel API token for the commit check (AGL-566): `VERCEL_TOKEN` first,
 * then the CLI's own auth file (the same credential `vercel` already uses).
 * Returns null when neither is available — the commit check then degrades to a
 * skipped note rather than an error.
 */
function readVercelToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim()
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.config', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.vercel', 'auth.json'),
  ]
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const token = JSON.parse(readFileSync(path, 'utf8'))?.token
      if (token) return String(token).trim()
    } catch {
      // Unreadable/!JSON — try the next candidate.
    }
  }
  return null
}

function git(cmdArgs, { timeoutMs = INSPECT_TIMEOUT_MS } = {}) {
  return new Promise((resolveP) => {
    execFile('git', cmdArgs, { cwd: repoRoot, timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) =>
      resolveP({ ok: !error, stdout: stdout ?? '' }),
    )
  })
}

/**
 * The production branch HEAD SHA that Vercel builds from (AGL-566). Uses
 * `DEPLOY_REMOTE`/`DEPLOY_BRANCH` when set, else the first git remote whose URL
 * points at the Vercel-connected repo (…/zgover/core). Returns null on failure
 * (the commit check then reports "unknown" rather than failing the run).
 */
async function productionHeadSha() {
  const branch = process.env.DEPLOY_BRANCH?.trim() || 'production'
  let remote = process.env.DEPLOY_REMOTE?.trim()
  if (!remote) {
    const remotes = (await git(['remote', '-v'])).stdout
    remote =
      remotes
        .split('\n')
        .find((l) => /\bzgover\/core\b/i.test(l) && /\(fetch\)/.test(l))
        ?.split(/\s+/)[0] ?? 'origin'
  }
  const res = await git(['ls-remote', remote, `refs/heads/${branch}`])
  const sha = res.stdout.trim().split(/\s+/)[0]
  return { sha: /^[0-9a-f]{40}$/i.test(sha) ? sha : null, remote, branch }
}

/** A deployment's source commit SHA via the Vercel API (AGL-566). */
async function deploymentCommitSha(deploymentId, token) {
  if (!token || !deploymentId) return null
  try {
    const res = await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentId}?teamId=${TEAM_SCOPE}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return null
    const body = await res.json()
    return body?.meta?.githubCommitSha ?? body?.gitSource?.sha ?? null
  } catch {
    return null
  }
}

/** Pull id / name / status / url out of `vercel inspect` output (stderr!). */
function parseInspect(out) {
  const grab = (re) => out.match(re)?.[1] ?? null
  return {
    id: grab(/^\s*id\s+(\S+)/m),
    name: grab(/^\s*name\s+(\S+)/m),
    // Status renders as e.g. "status  ● Ready" — skip decoration, keep word.
    status: grab(/^\s*status\s+[^A-Za-z]*([A-Za-z]+)/m),
    url: grab(/^\s*url\s+(\S+)/m),
  }
}

async function inspect(target) {
  const res = await vercel(['inspect', target], { timeoutMs: INSPECT_TIMEOUT_MS })
  if (res.binMissing) throw new FatalError('`vercel` CLI not found on PATH — install it (npm i -g vercel)')
  if (res.timedOut) return { error: `inspect ${target} timed out after ${INSPECT_TIMEOUT_MS / 1000}s` }
  const parsed = parseInspect(res.out)
  if (!parsed.id && !parsed.url) {
    return { error: `could not parse \`vercel inspect ${target}\` output: ${firstLine(res.out)}` }
  }
  return parsed
}

const firstLine = (s) => (s || '(empty output)').split('\n').find((l) => l.trim()) ?? '(empty output)'

class FatalError extends Error {}

/** Newest-first production deployment URLs from piped `vercel ls <project> --prod`. */
async function listProdDeployments(project) {
  const res = await vercel(['ls', project.name, '--prod'], { timeoutMs: LS_TIMEOUT_MS })
  if (res.binMissing) throw new FatalError('`vercel` CLI not found on PATH — install it (npm i -g vercel)')
  if (res.timedOut) return { error: `\`vercel ls ${project.name} --prod\` timed out after ${LS_TIMEOUT_MS / 1000}s` }
  // Piped `vercel ls` emits bare deployment URLs (no status column) on stdout.
  let urls = res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(l))
  if (urls.length === 0) {
    // Defensive fallback: newer CLI formats may decorate lines; scan tokens.
    urls = [...new Set(res.out.match(/https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app/gi) ?? [])]
  }
  if (urls.length === 0) {
    return { error: `no production deployments found (\`vercel ls ${project.name} --prod\`): ${firstLine(res.out)}` }
  }
  return { urls }
}

/** Newest deployment whose inspect status is Ready. */
async function findNewestReady(project) {
  const listed = await listProdDeployments(project)
  if (listed.error) return { error: listed.error }
  const tried = []
  for (const url of listed.urls.slice(0, MAX_LS_CANDIDATES)) {
    const info = await inspect(url)
    if (info.error) return { error: info.error }
    // Authoritative cross-check: inspect reports the owning project's name.
    if (info.name && info.name !== project.name) {
      return {
        error:
          `\`vercel inspect ${url}\` reports project "${info.name}", expected ` +
          `"${project.name}" — \`vercel ls ${project.name}\` returned another project's deployments`,
      }
    }
    if (/^ready$/i.test(info.status ?? '')) {
      return { url, id: info.id }
    }
    tried.push(`${hostOf(url)}=${info.status ?? 'unknown'}`)
  }
  return {
    error:
      `none of the ${Math.min(listed.urls.length, MAX_LS_CANDIDATES)} newest production ` +
      `deployments is Ready (${tried.join(', ')}) — wait for the build or check the dashboard`,
  }
}

/** Which deployment currently serves this domain? (inspect resolves the alias) */
async function checkDomain(project, domain, newestReady) {
  const info = await inspect(domain)
  if (info.error) return { domain, error: info.error }
  const serving = { url: info.url ?? null, id: info.id ?? null, name: info.name ?? null }
  const current =
    (serving.id && newestReady.id && serving.id === newestReady.id) ||
    (serving.url && hostOf(serving.url) === hostOf(newestReady.url))
  const nameMismatch = serving.name && serving.name !== project.name
  return {
    domain,
    serving,
    verdict: current && !nameMismatch ? 'current' : 'STALE',
    ...(nameMismatch
      ? { note: `domain serves project "${serving.name}", expected "${project.name}"` }
      : {}),
  }
}

async function verifyProject(project, { token, head }) {
  let newestReady = await findNewestReady(project)
  // A non-always-build project (www) cancels most pushes via its ignore-build-
  // step, so its recent deployments are all Canceled and the real Ready build
  // is buried past the scan window. Don't fail — fall back to whatever the
  // apex domain currently serves (an older, legitimately-Ready build).
  if (newestReady.error && project.alwaysBuilds === false) {
    const served = await inspect(project.domains[0])
    if (!served.error && /^ready$/i.test(served.status ?? '')) {
      newestReady = { url: served.url, id: served.id, viaDomain: true }
    }
  }
  if (newestReady.error) return { project: project.name, error: newestReady.error }
  log(
    `[${project.label}] ${newestReady.viaDomain ? 'serving' : 'newest READY'} production ` +
      `deployment: ${hostOf(newestReady.url)}${newestReady.viaDomain ? ' (ignore-build-step; no recent rebuild)' : ''}`,
  )

  // Commit guard (AGL-566): is the newest deployment built from HEAD?
  let commit = null
  if (head?.sha) {
    const sha = await deploymentCommitSha(newestReady.id, token)
    if (!token) {
      commit = { status: 'skipped', note: 'set VERCEL_TOKEN or log in with the Vercel CLI' }
    } else if (!sha) {
      commit = { status: 'unknown', note: 'commit unavailable from the Vercel API' }
    } else {
      const onHead = sha === head.sha
      // Only an always-build project lagging HEAD is a real problem: a missed
      // build. www trails HEAD by design (per-path ignore-build-step).
      const behind = !onHead && project.alwaysBuilds !== false
      commit = { sha, head: head.sha, onHead, behind }
      log(
        `[${project.label}] commit ${short(sha)} ${onHead ? '==' : '!='} HEAD ${short(head.sha)}` +
          (behind
            ? ' — BUILD MISSING for HEAD (production merge never built)'
            : onHead
              ? ''
              : ' (ignore-build-step; trails HEAD by design)'),
      )
    }
  }

  let domains = []
  for (const domain of project.domains) {
    domains.push(await checkDomain(project, domain, newestReady))
  }

  let promoted = false
  if (FIX && domains.some((d) => d.verdict === 'STALE')) {
    log(`[${project.label}] STALE domain detected — promoting ${hostOf(newestReady.url)}`)
    const res = await vercel(['promote', newestReady.url, '--yes'], {
      timeoutMs: PROMOTE_TIMEOUT_MS,
    })
    if (!res.ok) {
      const reason = res.timedOut ? `timed out after ${PROMOTE_TIMEOUT_MS / 1000}s` : firstLine(res.out)
      domains = domains.map((d) =>
        d.verdict === 'STALE' ? { ...d, note: `promote failed: ${reason}` } : d,
      )
    } else {
      promoted = true
      // Re-verify: aliases usually flip within seconds; retry briefly.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleep(5000)
        domains = await Promise.all(
          domains.map(async (d) =>
            d.error ? d : { ...(await checkDomain(project, d.domain, newestReady)), promoted: true },
          ),
        )
        if (domains.every((d) => d.error || d.verdict === 'current')) break
      }
    }
  }

  return { project: project.name, newestReady, domains, promoted, commit }
}

const commitCell = (c) => {
  if (!c) return '—'
  if (c.status === 'skipped' || c.status === 'unknown') return c.status
  if (c.onHead) return `${short(c.sha)}=HEAD`
  return `${short(c.sha)} ${c.behind ? 'MISSING' : 'trails(ok)'}`
}

function printTable(results) {
  const rows = []
  for (const r of results) {
    if (r.error) {
      rows.push([r.project, '—', '—', '—', '—', `ERROR: ${r.error}`])
      continue
    }
    for (const d of r.domains) {
      if (d.error) {
        rows.push([r.project, hostOf(d.domain), hostOf(r.newestReady.url), '—', commitCell(r.commit), `ERROR: ${d.error}`])
      } else {
        const verdict =
          d.verdict === 'current'
            ? d.promoted
              ? 'current (fixed)'
              : 'current'
            : `STALE${d.promoted ? ' (still stale after promote)' : ''}${d.note ? ` — ${d.note}` : ''}`
        rows.push([r.project, hostOf(d.domain), hostOf(r.newestReady.url), hostOf(d.serving.url) ?? d.serving.id ?? '?', commitCell(r.commit), verdict])
      }
    }
  }
  const header = ['PROJECT', 'DOMAIN', 'NEWEST READY', 'SERVING', 'COMMIT', 'VERDICT']
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)))
  const fmt = (row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ')
  console.log('')
  console.log(fmt(header))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(fmt(row))
  console.log('')
}

async function main() {
  // Auth guard: no secrets here — this rides the developer's own CLI session.
  const who = await vercel(['whoami'], { timeoutMs: INSPECT_TIMEOUT_MS })
  if (who.binMissing) {
    throw new FatalError('`vercel` CLI not found on PATH — install it (npm i -g vercel)')
  }
  if (!who.ok) {
    throw new FatalError(
      `vercel CLI is not authenticated for scope ${TEAM_SCOPE} — run \`vercel login\` ` +
        `first (${firstLine(who.out)})`,
    )
  }
  log(`Authenticated as ${firstLine(who.stdout)} (scope ${TEAM_SCOPE})`)

  // Shared inputs for the commit guard (AGL-566), resolved once.
  const token = readVercelToken()
  const head = await productionHeadSha()
  if (head?.sha) {
    log(
      `Production HEAD: ${short(head.sha)} (${head.remote}/${head.branch})` +
        (token ? '' : ' — commit check SKIPPED (no Vercel API token)'),
    )
  } else {
    log('Production HEAD: unknown (git ls-remote failed) — commit check skipped')
  }

  const results = []
  for (const project of PROJECTS) {
    results.push(await verifyProject(project, { token, head }))
  }

  const anyError = results.some((r) => r.error || r.domains?.some((d) => d.error))
  const anyStale = results.some((r) => r.domains?.some((d) => d.verdict === 'STALE'))
  const anyBuildMissing = results.some((r) => r.commit?.behind)
  const exitCode = anyError ? 2 : anyStale || anyBuildMissing ? 1 : 0

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: exitCode === 0, exitCode, fix: FIX, head, results }, null, 2))
  } else {
    printTable(results)
    if (anyStale && !FIX) {
      console.log('Stale alias detected — re-run with --fix to promote the newest deployment.')
    }
    if (anyBuildMissing) {
      const behind = results.filter((r) => r.commit?.behind).map((r) => r.project)
      console.log(
        `Build MISSING for production HEAD on: ${behind.join(', ')} — the production ` +
          "merge never built (dropped Vercel webhook, AGL-566). Re-push the branch or " +
          'trigger a redeploy; `--fix` cannot repair this (there is no HEAD build to promote).',
      )
    }
  }
  process.exit(exitCode)
}

main().catch((err) => {
  if (err instanceof FatalError) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, exitCode: 2, error: err.message }))
    else console.error(`ERROR: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exit(2)
})
