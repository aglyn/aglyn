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
// Every project declares exactly ONE commit-guard mode (enforced below —
// a project with neither, or both, aborts with exit 2):
//
//   alwaysBuilds: true    Builds on every production push, so its deployed
//                         commit must EQUAL production HEAD.
//   buildsOnPaths: [...]  Runs a path-scoped ignore-build-step, so its commit
//                         legitimately trails HEAD. The assertion is instead
//                         that no production commit AFTER the deployed one
//                         touched those paths (AGL-1610).
//
// There is deliberately no "report it, never fail" mode. `alwaysBuilds: false`
// used to be one and is now rejected: on the retired `www-aglyn-io` entry it
// suppressed the commit guard outright AND (via the baseline fallback deleted
// in AGL-1607) made the aglyn.com apex structurally unfailable. A path-scoped
// project gets a weaker assertion, never no assertion.
//
// Why this exists: after promoting to production, the tenant wildcard domain
// (*.aglyn.app) has repeatedly stayed aliased to a STALE deployment. Directory
// links are a footgun here — the repo-root `.vercel/repo.json` maps EVERY
// directory to the console project (`aglyn-console`) — so this script never
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
//   DEPLOY_REMOTE    git remote that Vercel builds from (else auto-detect aglyn/aglyn)
//   DEPLOY_BRANCH    production branch name (default: production)
//
// Exit codes: 0 = all domains current AND on HEAD; 1 = a domain is stale, or an
// always-build project's deployment lags HEAD (a missed build); 2 = operational
// error (vercel missing/not authenticated, unparseable CLI output).
//
// CLI quirks handled here: `vercel inspect` prints to STDERR (we capture
// both streams); piped `vercel ls` emits bare deployment URLs with no status
// column (we confirm Ready via inspect); every inspect is timed out at ~30s.
// `vercel ls` also PAGES at 20 rows no matter how deep we intend to walk, so
// the baseline is selected with the server-side `--status READY` filter rather
// than by scanning the list (AGL-1632 — see MAX_READY_CANDIDATES).

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEAM_SCOPE = 'team_JFfQodGE8VhCAZM6usYTu54M'
const INSPECT_TIMEOUT_MS = 30_000
const LS_TIMEOUT_MS = 60_000
const PROMOTE_TIMEOUT_MS = 240_000
// How many READY candidates to ask the server for. This is NOT a scan depth.
//
// It used to be one (`MAX_LS_CANDIDATES = 25`): the baseline was found by
// walking the unfiltered `vercel ls` list and inspecting each entry until one
// came back Ready. That walk could never reach 25, because piped `vercel ls`
// returns a single page of 20 (measured 2026-08-14 on aglyn-plugins) and
// nothing passed `--limit` or `--next`. A path-scoped project accumulates
// roughly one Canceled record per promote — the ignore-build-step CREATES a
// deployment and then cancels it — so its newest Ready build sinks steadily
// down that page and would eventually fall off it, at which point the run
// exited 2 with "wait for the build", advice that is wrong for this cause
// (AGL-1632).
//
// The fix is to stop scanning: `--status READY` filters SERVER-side across the
// project's entire history, so entry 1 is the newest Ready deployment however
// many Canceled records precede it, and the page size stops mattering.
// Measured 2026-08-14 on www-aglyn-io, whose 25 newest production deployments
// are every one of them Canceled: the filtered query still returns its Ready
// builds from 28-30 days ago. The few spare candidates below only cover the
// race where a listed deployment stops being Ready before we inspect it.
const MAX_READY_CANDIDATES = 5
// A path-scoped BUILD MISSING normally names one or two commits; cap the list
// so a misconfigured `buildsOnPaths` cannot bury the verdict under the backlog.
const MAX_LISTED_COMMITS = 10

const PROJECTS = [
  {
    name: 'aglyn-console',
    legacyNames: ['app-aglyn-io'],
    label: 'console',
    domains: ['https://app.aglyn.com'],
    // Builds on every production push; its commit must equal HEAD.
    alwaysBuilds: true,
  },
  {
    name: 'aglyn-tenant',
    legacyNames: ['tenant-aglyn-app'],
    label: 'tenant',
    // Two distinct aliases on one project, both worth asserting (AGL-1607):
    //   northwind-coffee.aglyn.app — the *.aglyn.app wildcard alias
    //   aglyn.com                  — the marketing apex
    // The apex is an ordinary tenant site: host `aglyn-marketing`
    // (`cname: aglyn.com`), resolved by the `default:` custom-domain branch of
    // `apps/tenant/middleware.ts`, which has no `aglyn.com` case at all. It was
    // probed against the retired `www-aglyn-io` project until AGL-1607;
    // measured 2026-08-14, `vercel inspect https://aglyn.com` reports project
    // `aglyn-tenant`, and `vercel project ls` lists aglyn.com as this project's
    // latest production URL. Do not probe aglyn.io/aglyn.app here — they
    // redirect to the apex, so they would test the redirect, not the alias.
    domains: ['https://northwind-coffee.aglyn.app', 'https://aglyn.com'],
    alwaysBuilds: true,
  },
  {
    name: 'aglyn-docs',
    legacyNames: ['docs-aglyn-io'],
    label: 'docs',
    // Docusaurus docs site (apps/docs). Builds on every production push;
    // three consecutive Error builds went unnoticed until AGL-580 because
    // this project wasn't verified — a lagging commit now flags loudly.
    domains: ['https://docs.aglyn.com'],
    alwaysBuilds: true,
  },
  {
    name: 'aglyn-plugins',
    label: 'plugins',
    // The plugin origin (root directory `tools/plugin-loader/origin`). It is
    // load-bearing for every marketplace plugin in both apps, and it was absent
    // from this list entirely until AGL-1610.
    //
    // Probe the CUSTOM domain, not the canonical `aglyn-plugins-aglyn.vercel.app`
    // that `vercel project ls` prints as the "Latest Production URL". Measured
    // 2026-08-14:
    //   * `NEXT_PUBLIC_PLUGIN_ORIGIN` is `https://plugins.aglyn.com` in
    //     production — the literal is baked into the live tenant client bundle
    //     as `loadRealmPlugins(..., {artifactsBase: "https://plugins.aglyn.com"})`.
    //   * `plugins.aglyn.com` serves `/load` (the sandboxed plugin realm) 200,
    //     with `frame-ancestors https://app.aglyn.com https://*.aglyn.app`, and
    //     edge-rewrites `/artifacts/*` to the console's artifact route.
    //   * The canonical vercel.app alias is deployment-protected: it 302s to
    //     `vercel.com/sso-api` and sends `x-frame-options: DENY`, so it could
    //     not serve the realm iframe even if something asked it to. Nothing in
    //     the repo requests it.
    // A stale alias here silently breaks plugin loading for every customer.
    domains: ['https://plugins.aglyn.com'],
    // Path-scoped, NOT always-built: `tools/scripts/vercel-ignore-build.sh
    // plugins` cancels the build unless the push range touched this directory
    // (the `plugins` case inverts the rule — only that directory is relevant).
    // So its commit trails HEAD by design and `alwaysBuilds: true` would be a
    // permanent false red. Keep this list in step with that script.
    buildsOnPaths: ['tools/plugin-loader/origin'],
  },
]

// Mode guard (AGL-1610): a project that declares neither mode would have NO
// commit assertion at all, which is the shape AGL-1607 was filed for. Fail
// loudly at startup rather than reporting green on an unguarded entry.
for (const project of PROJECTS) {
  const pathScoped = Array.isArray(project.buildsOnPaths) && project.buildsOnPaths.length > 0
  if ((project.alwaysBuilds === true) === pathScoped) {
    console.error(
      `ERROR: project "${project.name}" must declare exactly one of ` +
        '`alwaysBuilds: true` or a non-empty `buildsOnPaths` (see the header comment).',
    )
    process.exit(2)
  }
}

const args = process.argv.slice(2)
const FIX = args.includes('--fix')
const JSON_OUT = args.includes('--json')
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: node tools/deploy/verify-production-aliases.mjs [--fix] [--json]\n\n' +
      'Verifies app.aglyn.com, *.aglyn.app (via northwind-coffee.aglyn.app),\n' +
      'aglyn.com, docs.aglyn.com and plugins.aglyn.com against the newest\n' +
      'READY production deployment of their Vercel projects. --fix promotes\n' +
      'the newest deployment when a domain is stale.\n' +
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
 * points at the Vercel-connected repo (…/aglyn/aglyn). Returns null on failure
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
        .find((l) => /\baglyn\/aglyn\b/i.test(l) && /\(fetch\)/.test(l))
        ?.split(/\s+/)[0] ?? 'origin'
  }
  const res = await git(['ls-remote', remote, `refs/heads/${branch}`])
  const sha = res.stdout.trim().split(/\s+/)[0]
  return { sha: /^[0-9a-f]{40}$/i.test(sha) ? sha : null, remote, branch }
}

/**
 * Production commits AFTER `deployedSha` that touched `paths` (AGL-1610).
 *
 * The assertion for a path-scoped project: the ignore-build-step only skips a
 * build when the push range left its root directory untouched, so a deployment
 * trailing HEAD is fine — UNLESS a later production commit actually changed
 * those paths and no deployment was produced for it. That is the same missed
 * build `alwaysBuilds: true` catches, narrowed to the paths that can affect it.
 *
 * Needs both commits in the local object store; a shallow or unfetched checkout
 * degrades to a reported `unknown` rather than a pass or a failure.
 */
async function commitsTouchingPathsSince(deployedSha, headSha, paths) {
  for (const sha of [deployedSha, headSha]) {
    const have = await git(['cat-file', '-e', `${sha}^{commit}`])
    if (!have.ok) {
      return { error: `commit ${short(sha)} is not in the local checkout — run \`git fetch\` and re-run` }
    }
  }
  const res = await git(['log', '--format=%H %s', `${deployedSha}..${headSha}`, '--', ...paths])
  if (!res.ok) return { error: `\`git log ${short(deployedSha)}..${short(headSha)}\` failed` }
  return { commits: res.stdout.split('\n').map((l) => l.trim()).filter(Boolean) }
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

/**
 * Newest-first READY production deployment URLs for a project (AGL-1632).
 *
 * `--status READY` is what makes this correct: the filter is applied by the API
 * across the project's whole deployment history, so the first row is the newest
 * Ready deployment no matter how many Canceled records sit in front of it. The
 * previous version listed everything and scanned, which silently bottomed out at
 * the 20-row page size.
 *
 * An empty result is therefore meaningful and unambiguous: the project has no
 * Ready production deployment at all, not merely none recent enough to see.
 */
async function listReadyProdDeployments(project) {
  const res = await vercel(
    ['ls', project.name, '--prod', '--status', 'READY', '--limit', String(MAX_READY_CANDIDATES)],
    { timeoutMs: LS_TIMEOUT_MS },
  )
  if (res.binMissing) throw new FatalError('`vercel` CLI not found on PATH — install it (npm i -g vercel)')
  if (res.timedOut) return { error: `\`vercel ls ${project.name} --prod --status READY\` timed out after ${LS_TIMEOUT_MS / 1000}s` }
  if (!res.ok) {
    return {
      error:
        `\`vercel ls ${project.name} --prod --status READY\` failed: ${firstLine(res.out)} ` +
        '(--status and --limit need Vercel CLI >= 41; run `vercel --version`)',
    }
  }
  // Piped `vercel ls` emits bare deployment URLs (no status column) on stdout.
  let urls = res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(l))
  if (urls.length === 0) {
    // Defensive fallback: newer CLI formats may decorate lines; scan tokens.
    urls = [...new Set(res.out.match(/https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app/gi) ?? [])]
  }
  // An empty list is a real answer here, not a parse failure — see below.
  return { urls }
}

/** Newest deployment whose inspect status is Ready. */
async function findNewestReady(project) {
  const listed = await listReadyProdDeployments(project)
  if (listed.error) return { error: listed.error }
  // Distinguish the two causes the old single message conflated (AGL-1632).
  // This branch can now only mean "no Ready build has EVER existed for this
  // project" — the query is not windowed, so it cannot mean "the Ready build is
  // older than we looked". www-aglyn-io is the shape that used to land here.
  if (listed.urls.length === 0) {
    return {
      error:
        `project "${project.name}" has NO Ready production deployment — ` +
        `\`vercel ls ${project.name} --prod --status READY\` searches the project's whole ` +
        'history, so this is not a stale-scan artefact. Check the dashboard: every ' +
        'production build is Canceled or Errored, or the project is retired.',
    }
  }
  const tried = []
  for (const url of listed.urls) {
    const info = await inspect(url)
    if (info.error) return { error: info.error }
    // Authoritative cross-check: inspect reports the owning project's name
    // (or a pre-rename name it still carries — see ownedByProject).
    if (!ownedByProject(info.name, project)) {
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
  // Reachable only as a race: the API listed these as READY and every one of
  // them had changed state by the time we inspected it. Distinct from the
  // empty-list case above, and genuinely worth re-running.
  return {
    error:
      `\`vercel ls ${project.name} --prod --status READY\` listed ${listed.urls.length} ` +
      `Ready deployment(s), but none still inspects as Ready (${tried.join(', ')}) — ` +
      'the state changed underneath the query; re-run',
  }
}

/**
 * Does `vercel inspect`'s reported project name identify this project? (AGL-730)
 *
 * A deployment's `name` is the project name AT DEPLOY TIME — it is frozen into
 * the deployment record and does NOT follow a project rename. After the
 * 2026-07-23 renames, every pre-existing deployment still reports the old name,
 * which made the cross-check below abort with exit 2 on all three renamed
 * projects. Accepting the old names keeps the guard's real purpose intact (it
 * still catches `vercel ls` handing back a genuinely different project) without
 * failing on history.
 *
 * `legacyNames` can be dropped once every project has produced a production
 * deployment under its new name.
 */
function ownedByProject(reportedName, project) {
  if (!reportedName) return true
  return (
    reportedName === project.name ||
    (project.legacyNames ?? []).includes(reportedName)
  )
}

/** Which deployment currently serves this domain? (inspect resolves the alias) */
async function checkDomain(project, domain, newestReady) {
  const info = await inspect(domain)
  if (info.error) return { domain, error: info.error }
  const serving = { url: info.url ?? null, id: info.id ?? null, name: info.name ?? null }
  const current =
    (serving.id && newestReady.id && serving.id === newestReady.id) ||
    (serving.url && hostOf(serving.url) === hostOf(newestReady.url))
  const nameMismatch = !ownedByProject(serving.name, project)
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
  const newestReady = await findNewestReady(project)
  // There used to be a fallback here for `alwaysBuilds: false` projects: when
  // no Ready deployment could be found, it set the baseline to whatever the
  // project's own first domain was currently serving. That made the alias
  // comparison TAUTOLOGICAL — `checkDomain` compares the domain's serving
  // deployment against that same baseline, so `serving.id === newestReady.id`
  // was true by construction and the domain could never be reported stale, no
  // matter how old the deployment behind it was (AGL-1607). A check that
  // cannot fail is worse than no check. A project with no Ready production
  // deployment is now an error (exit 2), which is the honest answer.
  if (newestReady.error) return { project: project.name, error: newestReady.error }
  log(`[${project.label}] newest READY production deployment: ${hostOf(newestReady.url)}`)

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
      commit = { sha, head: head.sha, onHead, behind: false }
      let detail = ''
      if (onHead) {
        // Nothing to qualify: the deployment is built from HEAD either way.
      } else if (project.buildsOnPaths) {
        // Trailing HEAD is expected here — what matters is whether anything
        // this project actually builds from changed since (AGL-1610).
        const missed = await commitsTouchingPathsSince(sha, head.sha, project.buildsOnPaths)
        if (missed.error) {
          commit.pathScope = { paths: project.buildsOnPaths, status: 'unknown', note: missed.error }
          detail = ` — path scope UNVERIFIED: ${missed.error}`
        } else {
          commit.behind = missed.commits.length > 0
          commit.pathScope = { paths: project.buildsOnPaths, missed: missed.commits }
          const shas = missed.commits.map((c) => short(c.split(' ')[0]))
          detail = commit.behind
            ? ` — BUILD MISSING: ${missed.commits.length} later production commit(s) changed ` +
              `${project.buildsOnPaths.join(', ')} (${shas.slice(0, MAX_LISTED_COMMITS).join(', ')}` +
              `${shas.length > MAX_LISTED_COMMITS ? `, +${shas.length - MAX_LISTED_COMMITS} more` : ''})`
            : ` (trails HEAD by design; nothing since touched ${project.buildsOnPaths.join(', ')})`
        }
      } else {
        commit.behind = true
        detail = ' — BUILD MISSING for HEAD (production merge never built)'
      }
      log(`[${project.label}] commit ${short(sha)} ${onHead ? '==' : '!='} HEAD ${short(head.sha)}${detail}`)
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
  if (c.behind) return `${short(c.sha)} MISSING`
  if (c.pathScope?.status === 'unknown') return `${short(c.sha)} scope?`
  return `${short(c.sha)} ${c.pathScope ? 'path-current' : 'trails(ok)'}`
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
      const behind = results.filter((r) => r.commit?.behind)
      console.log(
        `Build MISSING on: ${behind.map((r) => r.project).join(', ')} — a production commit ` +
          'those projects build from never produced a deployment (dropped Vercel webhook, ' +
          'AGL-566; for a path-scoped project, a change to its own directory that was ' +
          'nonetheless skipped, AGL-1610). Re-push the branch or trigger a redeploy; ' +
          '`--fix` cannot repair this (there is no build to promote).',
      )
      for (const r of behind) {
        const missed = r.commit.pathScope?.missed ?? []
        for (const c of missed.slice(0, MAX_LISTED_COMMITS)) console.log(`  ${r.project}: ${c}`)
        if (missed.length > MAX_LISTED_COMMITS) {
          console.log(`  ${r.project}: … +${missed.length - MAX_LISTED_COMMITS} more`)
        }
      }
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
