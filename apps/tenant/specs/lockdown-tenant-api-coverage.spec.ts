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

import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'

/**
 * EVERY TENANT API ROUTE HAS A LOCKDOWN DISPOSITION (AGL-2495).
 *
 * The sibling of `apps/console/specs/lockdown-423-coverage.spec.ts`, for the
 * surface that had no coverage guard at all. Enforcement existed —
 * `visitorWriteRefusal` / `getSiteLockdown` in
 * `libs/tenant/data/admin/src/lib/server/tenant-write-lockdown.ts` — but
 * nothing enumerated who calls it, so the answer to "is this route covered"
 * was thirty separate acts of archaeology.
 *
 * ## Why this surface is the dangerous one
 *
 * The tenant middleware is what takes a locked site off the air, and its
 * matcher **deliberately excludes `/api`**. So on this app, unlike the
 * console, a route outside the gate is not merely un-refused — it is the one
 * part of a taken-down site that is still answering. And lockdown FAILS OPEN
 * by design (every reader swallows its errors and returns null), so during a
 * Firestore incident the gate is all there is: a takedown is not holding by
 * itself. That makes coverage more important here, not less.
 *
 * ## What the AGL-1621 drill found, and why a list would not have found it
 *
 * `apps/tenant/utils/publish-schedule-job.ts` ran a scheduled publish on
 * PLATFORM credentials from a secret-gated route, outside every lockdown
 * gate — so a publish could fire on a locked host. It was found by hand,
 * because no guard was looking. It is fixed; this spec is what stops the
 * next one, and it holds the JOB surface as well as the route surface for
 * exactly that reason (see the second describe below).
 *
 * ## The four dispositions
 *
 *  1. WIRED — the route asks the verdict itself and RETURNS the answer. Two
 *     idioms, both shipped: the local (`const paused = await
 *     visitorWriteRefusal(…)`, `if (paused) return paused`) and the local
 *     predicate (`if (await telemetryFrozen(hostId)) return noContent()`,
 *     where the predicate consults `getSiteLockdown` in this same file). A
 *     computed verdict that never becomes the response is not wiring, and
 *     the classifier is made to fail on that shape below.
 *  2. DELEGATED — `// lockdown-423: via <path>`, naming the module that runs
 *     the verdict for it; the target is verified to actually contain a
 *     verdict call, because a pointer at nothing is the drift shape.
 *  3. EXEMPT — `// lockdown-423: exempt — <reason>` in the file, AND a named
 *     entry in {@link TENANT_EXEMPT_AUDIT} below. Both, checked for EQUALITY
 *     in both directions. A marker nobody reads is decoration that looks
 *     like coverage (`feedback_written_but_never_read`) — those markers
 *     already existed on `csp-report` and `errors` and no guard had ever
 *     read them. An audit entry with no marker is a claim about a file that
 *     does not make it.
 *  4. UNGATED — a route that SHOULD honour a lock and does not, frozen by
 *     name in {@link TENANT_UNGATED_READS} with what it exposes and what
 *     closing it would take. This is not an exemption and is not written as
 *     one: it is a known-open set, held at exactly its current size, with a
 *     standing obligation that every member stay provably WRITE-FREE.
 *
 * Anything else is a violation, and a new route is a violation by existing.
 *
 * ## What this spec deliberately does NOT do
 *
 * It does not pattern-match its way out of an exemption. There is no "GET
 * routes are reads" rule and no path prefix that skips the check — the
 * console guard's `api/admin/` short-circuit is the shape being avoided
 * here, and `edit-hint/set` is the local proof that method is not
 * disposition: it is a GET that plants credentials.
 */
const REPO_ROOT = resolve(__dirname, '../../..')
const TENANT_API = 'apps/tenant/app/api'

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.nx',
  '.turbo',
])

/**
 * Next accepts `route.js|jsx|ts|tsx` (App Router file conventions). The
 * console guard hardcoded `route.ts`, which made a `route.tsx` handler
 * invisible to it — a blind spot nobody had to exploit deliberately, just
 * one `tsx` away. Held as a predicate rather than inline so the widening is
 * itself assertable, below, without a fixture file existing.
 */
export const isRouteFile = (name: string): boolean =>
  /^route\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(name)

function walk(absoluteDir: string, keep: (name: string) => boolean): string[] {
  const found: string[] = []
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...walk(join(absoluteDir, entry.name), keep))
    } else if (keep(entry.name)) {
      found.push(join(absoluteDir, entry.name))
    }
  }
  return found
}

const read = (repoPath: string) =>
  readFileSync(resolve(REPO_ROOT, repoPath), 'utf8')
const repoPath = (absolutePath: string) => relative(REPO_ROOT, absolutePath)

const ROUTES = walk(resolve(REPO_ROOT, TENANT_API), isRouteFile)
  .map(repoPath)
  .sort()

/** Everything in this app that can produce a lockdown verdict. */
const VERDICT_CALL =
  /(?:visitorWriteRefusal|visitorContentRefusal|getSiteLockdown|lockdownRefusal|getLockdownVerdict|resolveLockdown|isLockdownActive)\s*\(/

/**
 * The body of a function declared in this file, approximately: from its
 * declaration to the first column-0 `}`. Good enough to answer "does this
 * predicate consult the verdict", which is the only question asked of it.
 */
function functionBody(source: string, name: string): string | null {
  const at = source.search(
    new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`),
  )
  if (at === -1) return null
  const end = source.indexOf('\n}', at)
  return source.slice(at, end === -1 ? source.length : end)
}

/**
 * Wiring, in the two shapes this app actually ships — and BOUND to the
 * return in both, because the failure that matters is a verdict that is
 * computed and thrown away (`feedback_verify_control_is_wired`). Matching a
 * bare identifier would be satisfied by the import line alone.
 */
function wiredHow(source: string): string | null {
  // Shape 1 — the refusal local: `const paused = await visitorWriteRefusal(…)`
  // followed by `if (paused) return paused`.
  const assigned = source.matchAll(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(visitorWriteRefusal|visitorContentRefusal|lockdownRefusal|getLockdownVerdict)\s*\(/g,
  )
  for (const match of assigned) {
    const [, local, helper] = match
    if (
      new RegExp(`if\\s*\\(\\s*${local}\\s*\\)\\s*return\\s+${local}\\b`).test(
        source,
      )
    ) {
      return `${helper}() → if (${local}) return ${local}`
    }
  }
  // Shape 2 — a predicate declared in this file that consults the verdict,
  // guarding a return: `if (await telemetryFrozen(hostId)) return noContent()`.
  const guarded = source.matchAll(
    /if\s*\(\s*await\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\)\s*return\b/g,
  )
  for (const match of guarded) {
    const body = functionBody(source, match[1])
    if (body && VERDICT_CALL.test(body)) {
      return `if (await ${match[1]}(…)) return …`
    }
  }
  return null
}

const VIA = /lockdown-423: via (\S+)/
const EXEMPT = /lockdown-423: exempt — (.*)/

/** Marker reason: the marker line's tail plus the following `//` lines. */
function exemptReason(source: string): string | null {
  const lines = source.split('\n')
  const at = lines.findIndex((line) => EXEMPT.test(line))
  if (at === -1) return null
  let reason = (lines[at].match(EXEMPT) as RegExpMatchArray)[1].trim()
  for (let next = at + 1; next < lines.length; next += 1) {
    const trimmed = lines[next].trim()
    if (!trimmed.startsWith('//')) break
    reason += ` ${trimmed.slice(2).trim()}`
  }
  return reason
}

/**
 * The audited exemptions. Every one of these ALSO carries the marker in its
 * own file; this table is the second half, so that adding a marker is not
 * something a reviewer can miss and removing one is not something a sweep
 * can do quietly. The reason here says why the route is safe locked; the
 * marker in the file says it to whoever is reading the route.
 */
const TENANT_EXEMPT_AUDIT: Record<string, string> = {
  // The lock's own surfaces. Refusing these makes the lock unobservable.
  'apps/tenant/app/api/locked/route.ts':
    'the 503 notice page itself — the middleware rewrites every path of a locked host here',
  'apps/tenant/app/api/lockdown-verdict/route.ts':
    'the verdict the edge middleware asks for; a route that refused while locked would make every request fail open',
  // Beacons and probes: no caller identity, no org action, and a monitor
  // cannot authenticate. Markers pre-dated this guard and were never read.
  'apps/tenant/app/api/csp-report/route.ts':
    'anonymous browser beacon, aggregate-only write into a platform collection',
  'apps/tenant/app/api/errors/route.ts':
    'anonymous browser beacon, aggregate-only write into a platform collection',
  'apps/tenant/app/api/health/route.ts':
    'infrastructure liveness probe; unauthenticated by design so a monitor can reach it',
  'apps/tenant/app/api/health/error-beacon/route.ts':
    'infrastructure monitoring probe; no org-scoped action',
  'apps/tenant/app/api/health/render/site/route.ts':
    'infrastructure monitoring probe; no org-scoped action',
  'apps/tenant/app/api/health/render/marketing/route.ts':
    'infrastructure monitoring probe; no org-scoped action',
  // The two doors that must stay open while a site is DOWN. Refusing these
  // would close the only channels a takedown leaves.
  'apps/tenant/app/api/report-abuse/route.ts':
    'the abuse intake; a suspended host is the likeliest subject of a report and the 503 is what motivates the reporter',
  'apps/tenant/app/api/counter-notice/route.ts':
    'the §512(g) counter-notice; the filer is by definition locked out of both their site and the console',
  // No org data reachable at all.
  'apps/tenant/app/api/consent/region/route.ts':
    'pure request-header echo; reads no document and writes none',
  'apps/tenant/app/api/edit-hint/set/route.ts':
    'plants two signed browser cookies and redirects; the hint is redeemed at edit-access/exchange, which runs the verdict',
  'apps/tenant/app/api/edit-context/route.ts':
    'read-only projection for the admin bar; the capability it describes is gated at the mint (editAccessMintRefusal)',
  'apps/tenant/app/api/revalidate/route.ts':
    'shared-secret cache purge on behalf of the console, which ran the verdict before the publish that called it',
  // The cron beat. Its obligation is pushed down to the jobs, and the second
  // describe below is what holds that.
  'apps/tenant/app/api/plugins/run-jobs/route.ts':
    'subject-less cron entrypoint — no org, no host, no user to ask a verdict about; each registered job resolves its own',
}

/**
 * THE KNOWN-OPEN SET, FROZEN.
 *
 * Not exemptions. Each of these serves a customer's own site content or its
 * metadata over `/api`, which the tenant middleware's matcher excludes — so
 * under a full takedown the pages 503 and these keep answering. Closing them
 * needs the read-refusing API gate that
 * `tenant-write-lockdown.ts` explicitly deferred ("a read-refusing API gate
 * is its own decision with its own blast radius"). AGL-2495 closed the two
 * that hand out a COMPOSED NODE TREE — `protection/unlock` and the
 * `screen/not-found` loader — because serving those is serving the site
 * itself. The rest are recorded here rather than quietly left out.
 *
 * Writing them down buys three things a silent omission does not:
 *  - the set cannot GROW without a decision (equality, both directions);
 *  - every member must stay WRITE-FREE, asserted below, so an ungated read
 *    can never become an ungated write by an ordinary edit;
 *  - the next person to pick this up has the list.
 */
interface UngatedRead {
  why: string
  /** Modules the route delegates to, scanned by the write-freeze check too. */
  alsoScan?: string[]
}
const TENANT_UNGATED_READS: Record<string, UngatedRead> = {
  'apps/tenant/app/api/collections-rss/route.ts': {
    why: 'serves the published entries of a content collection as RSS; a full takedown 503s the pages but not the feed',
  },
  'apps/tenant/app/api/sitemap/route.ts': {
    why: 'enumerates every indexable URL of the site, including a locked one',
  },
  'apps/tenant/app/api/robots/route.ts': {
    why: 'per-host robots.txt; deliberately fails OPEN even on an unresolvable host so a blip cannot de-index a customer',
  },
  'apps/tenant/app/api/manifest/route.ts': {
    why: 'per-host web app manifest — name, colours, icons; branding metadata rather than content',
  },
  'apps/tenant/app/api/host/[hostId]/route.ts': {
    why: 'the allow-listed public projection of the host doc (display name, logo, locales, SEO)',
  },
  'apps/tenant/app/api/screen/route.ts': {
    why: 'the published screen LIST for a host — an allow-listed projection, never the screen documents',
  },
  'apps/tenant/app/api/plugins/fetch/route.ts': {
    why: 'allowlisted outbound proxy for plugin code; it forwards to a public origin and returns the response, and writes nothing of ours',
    alsoScan: ['libs/tenant/data/admin/src/lib/server/serve-plugin-fetch.ts'],
  },
}

type Kind = 'wired' | 'delegated' | 'exempt' | 'ungated' | 'violation'

interface Classified {
  file: string
  kind: Kind
  detail?: string
}

const CLASSIFIED: Classified[] = ROUTES.map((file) => {
  const source = read(file)
  const how = wiredHow(source)
  if (how) return { file, kind: 'wired' as const, detail: how }
  const via = source.match(VIA)
  if (via) return { file, kind: 'delegated' as const, detail: via[1] }
  const reason = exemptReason(source)
  if (reason !== null) return { file, kind: 'exempt' as const, detail: reason }
  if (file in TENANT_UNGATED_READS) return { file, kind: 'ungated' as const }
  return { file, kind: 'violation' as const }
})

const byKind = (kind: Kind) => CLASSIFIED.filter((entry) => entry.kind === kind)

/**
 * Firestore MUTATION, as it is spelled in this app. Deliberately not `.add(`
 * or `.set(` bare: `sitemap` calls `excluded.add(screenId)` on a `Set` and
 * `protection/unlock` calls `.update(password)` on a hash, and a guard that
 * cried wolf on those would be turned off within a week.
 */
const FIRESTORE_WRITE =
  /FieldValue\.|\.batch\(\)|bulkWriter|\.doc\([^)]*\)\s*\.\s*(?:set|update|delete|create)\(|\.collection\([^)]*\)\s*\.\s*add\(|\btx\.(?:set|update|delete|create)\(|runTransaction\(/

describe('AGL-2495 · every tenant API route has a lockdown disposition', () => {
  it('discovers the whole surface, and the walk is proven non-empty', () => {
    // ANTI-VACUITY. A walk that silently matched nothing — wrong cwd, wrong
    // glob, a pattern that stopped compiling — passes every assertion below
    // while proving nothing, and this repo shipped exactly that failure in a
    // checker that printed its green line unconditionally. So: a floor, AND
    // named files the search is SUPPOSED to find, AND a classification each
    // one must land in.
    expect(ROUTES.length).toBeGreaterThanOrEqual(30)
    const found = new Map(CLASSIFIED.map((entry) => [entry.file, entry.kind]))
    for (const [anchor, kind] of [
      // One of each disposition, so a classifier that collapsed to a single
      // answer cannot pass this.
      ['apps/tenant/app/api/forms/submit/route.ts', 'wired'],
      ['apps/tenant/app/api/analytics/collect/route.ts', 'wired'],
      ['apps/tenant/app/api/protection/unlock/route.ts', 'wired'],
      ['apps/tenant/app/api/screen/nodes/route.ts', 'delegated'],
      ['apps/tenant/app/api/locked/route.ts', 'exempt'],
      ['apps/tenant/app/api/sitemap/route.ts', 'ungated'],
    ] as const) {
      expect(`${anchor}: ${found.get(anchor)}`).toBe(`${anchor}: ${kind}`)
    }
  })

  it('reads route.tsx and the other App Router spellings', () => {
    // The console blind spot, asserted as a predicate so it is proven
    // without planting a fixture route in a live app. `route.tsx` is a legal
    // Next handler and was invisible to every lockdown guard in this repo.
    for (const name of ['route.ts', 'route.tsx', 'route.js', 'route.jsx']) {
      expect(`${name}: ${isRouteFile(name)}`).toBe(`${name}: true`)
    }
    for (const name of ['page.tsx', 'route.spec.ts', 'not-route.ts', 'route.md']) {
      expect(`${name}: ${isRouteFile(name)}`).toBe(`${name}: false`)
    }
  })

  it('does not mistake an unreturned verdict for wiring', () => {
    // Made to fail on purpose before it is trusted. The import line, and a
    // verdict computed and dropped, are the two shapes that have actually
    // shipped in this repo.
    const importOnly = [
      "import { visitorWriteRefusal } from '@aglyn/tenant-data-admin'",
      'const paused = await visitorWriteRefusal({ hostId, request, surface })',
    ].join('\n')
    expect(wiredHow(importOnly)).toBeNull()
    expect(wiredHow(`${importOnly}\nif (paused) { /* refusal deleted */ }`)).toBeNull()
    expect(wiredHow(`${importOnly}\nif (paused) return paused`)).not.toBeNull()
    // And the predicate shape: guarded return, but the predicate never asks.
    const predicate = [
      'async function frozen(hostId) {',
      '  return cache.get(hostId) === true',
      '}',
      'if (await frozen(hostId)) return noContent()',
    ].join('\n')
    expect(wiredHow(predicate)).toBeNull()
    expect(
      wiredHow(predicate.replace('cache.get(hostId) === true', 'Boolean(await getSiteLockdown(hostId))')),
    ).not.toBeNull()
  })

  it('leaves no route unwired, undelegated, unexplained and unlisted', () => {
    const violations = byKind('violation').map(
      (entry) =>
        `${entry.file} — wire the verdict (see forms/submit), add ` +
        `"lockdown-423: via <module>", document ` +
        `"lockdown-423: exempt — <reason>" AND add it to TENANT_EXEMPT_AUDIT, ` +
        `or — only if it genuinely cannot be closed yet — record it in ` +
        `TENANT_UNGATED_READS with what it exposes`,
    )
    expect(violations).toEqual([])
  })

  it('backs every delegation with a module that really runs the verdict', () => {
    const delegated = byKind('delegated')
    expect(delegated.length).toBeGreaterThanOrEqual(4)
    const broken = delegated
      .filter((entry) => {
        const target = resolve(REPO_ROOT, entry.detail as string)
        return !existsSync(target) || !VERDICT_CALL.test(read(entry.detail as string))
      })
      .map((entry) => `${entry.file} → ${entry.detail}`)
    expect(broken).toEqual([])
  })

  it('exempts only with a marker AND a named audit entry, matched exactly', () => {
    // Equality both ways. A marker without an entry is an exemption nobody
    // reviewed; an entry without a marker is a claim about a file that does
    // not make it, which is how a stale audit outlives the route it audits.
    const markered = byKind('exempt')
      .map((entry) => entry.file)
      .sort()
    expect(markered).toEqual(Object.keys(TENANT_EXEMPT_AUDIT).sort())
    const thin = byKind('exempt')
      .filter((entry) => (entry.detail as string).length < 40)
      .map((entry) => `${entry.file} — "${entry.detail}"`)
    expect(thin).toEqual([])
    const thinAudit = Object.entries(TENANT_EXEMPT_AUDIT)
      .filter(([, why]) => why.length < 40)
      .map(([file, why]) => `${file} — "${why}"`)
    expect(thinAudit).toEqual([])
  })

  it('holds the known-open set at exactly its recorded size', () => {
    const ungated = byKind('ungated')
      .map((entry) => entry.file)
      .sort()
    expect(ungated).toEqual(Object.keys(TENANT_UNGATED_READS).sort())
  })

  it('keeps every known-open route provably WRITE-free', () => {
    // The standing obligation on the set above: an ungated READ is a
    // disclosure decision that has been made and written down; an ungated
    // WRITE is the AGL-1621 defect. This is the line between them, and it is
    // what stops an ordinary edit walking one route across it.
    const writing: string[] = []
    for (const [file, entry] of Object.entries(TENANT_UNGATED_READS)) {
      for (const scan of [file, ...(entry.alsoScan ?? [])]) {
        if (FIRESTORE_WRITE.test(read(scan))) writing.push(`${file} → ${scan}`)
      }
    }
    expect(writing).toEqual([])
  })

  it('the write detector fires on a route that really writes', () => {
    // ANTI-VACUITY for the assertion above: without this, a regex that
    // stopped matching would report the whole known-open set as clean, which
    // is the more dangerous direction. `forms/submit` and `counter-notice`
    // both write, and are not in the set.
    for (const writer of [
      'apps/tenant/app/api/forms/submit/route.ts',
      'apps/tenant/app/api/counter-notice/route.ts',
      'apps/tenant/app/api/report-abuse/route.ts',
    ]) {
      expect(`${writer}: ${FIRESTORE_WRITE.test(read(writer))}`).toBe(
        `${writer}: true`,
      )
    }
  })
})

/**
 * THE JOB SURFACE (AGL-2495, from the AGL-1621 finding).
 *
 * `apps/tenant/app/api/plugins/run-jobs/route.ts` is exempt above because it
 * is subject-less: the beat carries no org, no host and no user, and runs
 * whichever registered jobs are due. That exemption is only honest if the
 * obligation lands one level down — which is exactly where it was NOT
 * landing when the drill found `publish-schedule-job.ts` flipping version
 * pointers on locked hosts through platform credentials.
 *
 * So the same discover-don't-list posture, applied to registrations: every
 * `registerPluginJob({…})` in the repo is found, keyed by `file#name`, and
 * must declare what it touches and — for a job that touches hosts — actually
 * ask the lock. A new job is a violation by existing, including a new job
 * added to a file that already holds four.
 *
 * ## The gate moved into the CONTRACT, and why that is the point
 *
 * The first pass of this spec recorded six ungated jobs and froze them, on
 * the stated grounds that `libs/plugins/*` could not import
 * `@aglyn/tenant-data-admin`. **That reason was wrong.** The admin lib
 * carries `scope:data` and `scope:aglyn`, both on the `aglyn:addons`
 * allowlist in `eslint.config.mjs`, and 196 files under `libs/plugins`
 * already import it. Recorded here rather than quietly corrected, because a
 * frozen set justified by a constraint that does not exist is the worst kind
 * of known-open: it looks argued.
 *
 * The conclusion held anyway, for the better reason. Six call-site edits
 * close six holes and guarantee the seventh is forgotten. So `PluginJob`
 * now carries a REQUIRED `lockdown` declaration and `runPluginJobs` injects
 * a `PluginJobHostGate` into every handler — a new job does not compile
 * until its author has answered what it touches, and this spec is what
 * checks the answer is true.
 *
 * ## What this half can and cannot see
 *
 * It reads text. It can prove a registration DECLARES a scope and that the
 * gate is asked somewhere in the registration, and it cannot prove the
 * answer reaches every mutation inside a scan function three files away.
 * That is what the behavioural suites are for — `job-lockdown.spec.ts` in
 * each plugin, and `publish-schedule-job-lockdown.spec.ts` here — which
 * drive each job with a gate that says LOCKED and assert nothing was written
 * or sent, then lift and assert the work lands. Said plainly rather than
 * implied: this guard holds the shape, those suites hold the behaviour, and
 * neither one is the other.
 */
const JOB_ROOTS = ['apps/tenant', 'libs/plugins']

/**
 * `name:` is written BOTH ways in this repo — a string literal in the plugin
 * bundles, and a module constant in `publish-schedule-job.ts`
 * (`name: APPLY_PUBLISH_SCHEDULES_JOB`). Matching only the literal form is
 * how this walk first ran: it found six registrations, all of them in
 * `libs/plugins`, and silently missed THE job the drill was about. Kept as a
 * cautionary note rather than tidied away — the anchor test below is what
 * caught it, which is the entire argument for having an anchor.
 */
const JOB_NAME = /name:\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/
/** `const NAME = 'value'` in the same file, for the constant spelling. */
function resolveJobName(source: string, literal?: string, ident?: string) {
  if (literal) return literal
  if (!ident) return null
  const match = source.match(
    new RegExp(`(?:export\\s+)?const\\s+${ident}\\s*=\\s*'([^']+)'`),
  )
  return match ? match[1] : null
}

/**
 * The whole `registerPluginJob({ … })` literal, brace-matched.
 *
 * The first pass used a bounded lookahead (`[\s\S]{0,600}?`) and computed
 * `gated` PER FILE, which meant one gated job in `commerce/server.ts` would
 * have vouched for the other three. Balanced extraction is what makes the
 * disposition per REGISTRATION, which is the only unit that means anything
 * when four of them share a file.
 */
export function jobRegistrationBlocks(source: string): string[] {
  const blocks: string[] = []
  const opener = 'registerPluginJob({'
  let from = 0
  for (;;) {
    const start = source.indexOf(opener, from)
    if (start === -1) break
    let depth = 0
    let end = -1
    for (let i = start + opener.length - 1; i < source.length; i += 1) {
      const char = source[i]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    // An unbalanced literal is not a pass: it is surfaced as a block running
    // to end-of-file, which fails to classify and therefore fails the spec.
    blocks.push(source.slice(start, end === -1 ? source.length : end))
    from = end === -1 ? source.length : end
  }
  return blocks
}

/** The handler's first parameter — the gate, when the handler takes one. */
export function handlerGateParam(block: string): string | null {
  const match = block.match(
    /handler:\s*(?:async\s+)?(?:\(\s*([A-Za-z_$][\w$]*)?[^)]*\)|([A-Za-z_$][\w$]*))\s*=>/,
  )
  if (!match) return null
  return match[1] ?? match[2] ?? null
}

/**
 * Does this registration ASK the lock? Three idioms, all shipped:
 *
 *  1. the direct call, used as a guard — `if (await getSiteLockdown(hostId))`
 *     — which `apps/tenant/utils/publish-schedule-job.ts` may make because it
 *     lives in the app and imports the admin lib statically;
 *  2. the injected gate, asked here — `if (await gate.isLocked(hostId))`;
 *  3. the injected gate, THREADED into a scan whose signature requires one —
 *     `await scanRestockAlerts(gate)`. The parameter is not optional on any
 *     of those functions, so "passed it on" is as strong as "asked it", and
 *     strictly stronger than a local `if` that a refactor could orphan.
 *
 * A bare import, or a parameter declared and never used, is NOT an ask — the
 * synthetics below hold that.
 */
export function jobAsksTheLock(block: string): boolean {
  if (/if\s*\(\s*await\s+getSiteLockdown\(/.test(block)) return true
  const param = handlerGateParam(block)
  if (!param) return false
  // Search the handler BODY only. The declaration `async (gate) =>` would
  // otherwise satisfy the "passed as an argument" shape all by itself, which
  // is the vacuous pass this function exists to avoid.
  const arrow = block.indexOf('=>', block.indexOf('handler:'))
  if (arrow === -1) return false
  const body = block.slice(arrow + 2)
  if (new RegExp(`\\b${param}\\s*\\.\\s*isLocked\\s*\\(`).test(body)) return true
  return new RegExp(`\\(\\s*${param}\\s*[,)]`).test(body)
}

/** `lockdown: { scope: 'per-host' }` / `{ scope: 'platform', reason: '…' }`. */
export function jobLockdownScope(block: string): string | null {
  const match = block.match(/lockdown:\s*\{\s*scope:\s*'([^']+)'/)
  return match ? match[1] : null
}

interface JobSite {
  key: string
  file: string
  name: string
  scope: string | null
  asks: boolean
}

const JOB_SITES: JobSite[] = JOB_ROOTS.flatMap((root) =>
  walk(
    resolve(REPO_ROOT, root),
    (name) => name.endsWith('.ts') && !name.includes('.spec.'),
  )
    .map(repoPath)
    .flatMap((file) => {
      const source = read(file)
      return jobRegistrationBlocks(source).map((block) => {
        const named = JOB_NAME.exec(block)
        const name = named
          ? resolveJobName(source, named[1], named[2])
          : null
        // An unresolvable name is not a pass. It means a registration exists
        // that this walk cannot key, which is indistinguishable from a miss,
        // so it is surfaced as its own key rather than dropped.
        return {
          key: `${file}#${name ?? `UNRESOLVED(${named?.[2] ?? '?'})`}`,
          file,
          name: name ?? '',
          scope: jobLockdownScope(block),
          asks: jobAsksTheLock(block),
        }
      })
    }),
).sort((a, b) => a.key.localeCompare(b.key))

/**
 * Jobs that legitimately touch NOTHING a lock could be about, and may
 * therefore declare `{ scope: 'platform' }`. Empty today, and that is the
 * honest state: every registered job on this platform acts for hosts.
 *
 * Held as a named table anyway, checked for equality in BOTH directions,
 * because the alternative is that `scope: 'platform'` becomes a word an
 * author can type to leave the walk. A job claiming it has to be argued for
 * here, in a file a reviewer reads, and a job that stops claiming it has to
 * be struck rather than left as a stale entry.
 */
const PLATFORM_JOBS: Record<string, string> = {}

/**
 * Background jobs that mutate for a host and do NOT resolve a lockdown.
 *
 * **EMPTY, and it is meant to stay empty.** The six that were frozen here —
 * four commerce, two bookings — are closed: each declares
 * `lockdown: { scope: 'per-host' }` and threads the runner's gate through to
 * its per-host loop. The set is kept as a named, asserted-empty record
 * rather than deleted, so re-opening it is a visible act with a reason
 * attached rather than a silent regression in a passing suite.
 *
 * Adding an entry here is NOT how a new job passes this spec. It is the
 * escape hatch of last resort for a job that genuinely cannot ask — and no
 * such job exists, because the runner hands every handler a gate.
 */
const UNGATED_JOBS: Record<string, string> = {}

describe('AGL-2495 · every background job that writes for a host asks the lock', () => {
  it('discovers the registrations rather than trusting a list', () => {
    // ANTI-VACUITY, and the shape that matters most here: this walk crosses
    // two roots and a brace matcher, so an empty result is entirely
    // plausible and would pass every assertion below.
    expect(JOB_SITES.length).toBeGreaterThanOrEqual(7)
    expect(new Set(JOB_SITES.map((job) => job.file)).size).toBeGreaterThan(1)
    // And it must find the file that holds FOUR of them as four, not one —
    // the per-file/per-registration confusion the first pass shipped.
    expect(
      JOB_SITES.filter(
        (job) => job.file === 'libs/plugins/commerce/src/lib/server.ts',
      ).map((job) => job.name).sort(),
    ).toEqual([
      'abandoned-checkout-recovery',
      'back-in-stock-alerts',
      'stock-decrement-reconciliation',
      'supplier-webhook-delivery',
    ])
  })

  it('names the core publish beat as gated — the AGL-1621 anchor', () => {
    // THE regression this whole spec exists for. `publish-schedule-job.ts`
    // ran a scheduled publish on platform credentials from a secret-gated
    // route with no lockdown gate anywhere on the path, so a publish could
    // fire on a locked host. Delete `if (await getSiteLockdown(hostId))
    // continue` from that file and this line names it.
    const anchor = JOB_SITES.find(
      (job) => job.file === 'apps/tenant/utils/publish-schedule-job.ts',
    )
    expect(anchor?.name).toBe('apply-publish-schedules')
    expect(`${anchor?.file}: ${anchor?.scope} / ${anchor?.asks}`).toBe(
      'apps/tenant/utils/publish-schedule-job.ts: per-host / true',
    )
  })

  it('every registration DECLARES what it touches', () => {
    // The declaration is required by the type, so this cannot fail while
    // typecheck passes — which is the point of asserting it anyway. The two
    // guards read the same fact from different directions, and a spec that
    // silently depended on `tsc` having run would be a guard whose green
    // means "somebody else checked".
    const undeclared = JOB_SITES.filter(
      (job) => job.scope !== 'per-host' && job.scope !== 'platform',
    ).map(
      (job) =>
        `${job.key} — no lockdown declaration. Add ` +
        `lockdown: { scope: 'per-host' } and ask the gate the runner hands ` +
        `your handler, or { scope: 'platform', reason: '…' } if this job ` +
        `truly touches nothing a lock could be about.`,
    )
    expect(undeclared).toEqual([])
  })

  it('leaves no host-touching job without an ask', () => {
    const violations = JOB_SITES.filter(
      (job) => job.scope === 'per-host' && !job.asks && !(job.key in UNGATED_JOBS),
    ).map(
      (job) =>
        `${job.key} — this job writes for a host on platform credentials ` +
        `with no lockdown verdict reachable from its registration. Take the ` +
        `PluginJobHostGate the runner hands your handler and either ask it ` +
        `(if (await gate.isLocked(hostId)) continue) or thread it into the ` +
        `scan that loops over hosts. Calling pluginJobHostGate() yourself ` +
        `does NOT satisfy this: a job that mints its own gate can declare ` +
        `{ scope: 'platform' } and never meet the refusing gate that checks ` +
        `the declaration. apps/tenant/utils/publish-schedule-job.ts is the ` +
        `model.`,
    )
    expect(violations).toEqual([])
  })

  it('holds the ungated-job set EMPTY', () => {
    // Both directions, as before — except the recorded size is now zero.
    // The six that used to sit here are closed, and a seventh cannot be
    // added by writing a line in this file: it would also have to survive
    // the behavioural suites, which drive the job under a lock.
    const ungated = JOB_SITES.filter(
      (job) => job.scope === 'per-host' && !job.asks,
    )
      .map((job) => job.key)
      .sort()
    expect(ungated).toEqual(Object.keys(UNGATED_JOBS).sort())
    expect(Object.keys(UNGATED_JOBS)).toEqual([])
  })

  it('holds the platform-scoped set at exactly its argued size', () => {
    const claimed = JOB_SITES.filter((job) => job.scope === 'platform')
      .map((job) => job.key)
      .sort()
    expect(claimed).toEqual(Object.keys(PLATFORM_JOBS).sort())
  })

  it('a platform-scoped job carries its reason IN the registration', () => {
    // The table above is the argument a reviewer reads; this is the argument
    // the next author of that file reads. Both, for the same reason the
    // route exemptions need both a marker and an audit entry.
    for (const file of new Set(JOB_SITES.map((job) => job.file))) {
      for (const block of jobRegistrationBlocks(read(file))) {
        if (jobLockdownScope(block) !== 'platform') continue
        expect(`${file}: ${/reason:\s*'[^']+'/.test(block)}`).toBe(
          `${file}: true`,
        )
      }
    }
  })
})

/**
 * ANTI-VACUITY FOR THE CLASSIFIER ITSELF.
 *
 * The App Check debug-token lesson, applied to the two functions this half
 * turns on: prove the search finds what it is SUPPOSED to find, and prove it
 * refuses the near-misses. Synthetic strings rather than fixture files, so
 * the negatives can be stated without planting an ungated job in a live app
 * and without touching a shared checkout to prove a red.
 */
describe('AGL-2495 · the job classifier is falsifiable', () => {
  const wrap = (body: string) => `registerPluginJob({\n${body}\n})`

  it('finds four registrations in one string, not one', () => {
    const four = [1, 2, 3, 4]
      .map((n) => wrap(`  name: 'job-${n}',\n  handler: async () => {},`))
      .join('\n\n')
    expect(jobRegistrationBlocks(four)).toHaveLength(4)
    // ...and each block is its OWN literal, not a run-on to the last brace.
    expect(jobRegistrationBlocks(four)[0]).toContain("name: 'job-1'")
    expect(jobRegistrationBlocks(four)[0]).not.toContain("name: 'job-2'")
  })

  it('brace-matches THROUGH a nested object literal', () => {
    const block = wrap(
      `  name: 'nested',\n  lockdown: { scope: 'per-host' },\n` +
        `  handler: async (gate) => { await scan(gate) },`,
    )
    expect(jobRegistrationBlocks(`${block}\nconst after = 1`)).toHaveLength(1)
    expect(jobRegistrationBlocks(block)[0]).toContain('handler')
  })

  it('ACCEPTS the three real idioms', () => {
    expect(
      jobAsksTheLock(
        wrap(
          `  handler: async () => {\n` +
            `    if (await getSiteLockdown(hostId)) continue\n  },`,
        ),
      ),
    ).toBe(true)
    expect(
      jobAsksTheLock(
        wrap(`  handler: async (gate) => {\n` +
          `    if (await gate.isLocked(hostId)) continue\n  },`),
      ),
    ).toBe(true)
    expect(
      jobAsksTheLock(
        wrap(`  handler: async (gate) => {\n    await scanThings(gate)\n  },`),
      ),
    ).toBe(true)
  })

  it('REFUSES a gate that is declared and ignored', () => {
    // The exact shape a new job takes on its way to being wrong: the author
    // accepted the parameter (or a linter added it) and never used it.
    expect(
      jobAsksTheLock(
        wrap(
          `  lockdown: { scope: 'per-host' },\n` +
            `  handler: async (gate) => {\n    await scanThings()\n  },`,
        ),
      ),
    ).toBe(false)
  })

  it('REFUSES a handler that MINTS its own gate', () => {
    // Functionally this one would work — `pluginJobHostGate()` returns the
    // same gate the runner would have passed. It is refused anyway, and the
    // reason is the `platform` escape hatch: `runPluginJobs` hands a
    // platform-scoped job a gate that THROWS when asked, which is the only
    // runtime check that a declaration is true. A job free to mint its own
    // gate is free to declare `platform` and never meet that check. Taking
    // what you are given is what keeps the two halves attached.
    expect(
      jobAsksTheLock(
        wrap(
          `  lockdown: { scope: 'per-host' },\n` +
            `  handler: async () => {\n` +
            `    await scanThings(pluginJobHostGate())\n  },`,
        ),
      ),
    ).toBe(false)
  })

  it('REFUSES a handler that takes no gate at all', () => {
    expect(
      jobAsksTheLock(wrap(`  handler: async () => {\n    await scan()\n  },`)),
    ).toBe(false)
  })

  it('REFUSES a verdict that is computed and dropped', () => {
    // `getSiteLockdown` present, awaited, and doing nothing — the shape the
    // route half of this spec also refuses. Presence is not correctness.
    expect(
      jobAsksTheLock(
        wrap(
          `  handler: async () => {\n` +
            `    const state = await getSiteLockdown(hostId)\n` +
            `    await publish()\n  },`,
        ),
      ),
    ).toBe(false)
  })

  it('REFUSES a mention in a comment', () => {
    expect(
      jobAsksTheLock(
        wrap(
          `  // if (await gate.isLocked(hostId)) continue — TODO\n` +
            `  handler: async () => {\n    await scan()\n  },`,
        ),
      ),
    ).toBe(false)
  })

  it('reads the scope, and answers null when there is none', () => {
    expect(jobLockdownScope(wrap(`  lockdown: { scope: 'per-host' },`))).toBe(
      'per-host',
    )
    expect(
      jobLockdownScope(wrap(`  lockdown: { scope: 'platform', reason: 'x' },`)),
    ).toBe('platform')
    expect(jobLockdownScope(wrap(`  name: 'no-declaration',`))).toBe(null)
  })
})

/**
 * THE WIRING THE GATE DEPENDS ON.
 *
 * Core's `pluginJobHostGate()` answers "not locked" when no resolver is
 * registered — fail open, so a self-host that never wired one does not have
 * every background job welded shut by infrastructure it did not ask for.
 * The cost of that direction is that a deleted import turns the whole gate
 * into a no-op while every test above stays green: the declarations are
 * still there, the asks are still there, and the answer is always no.
 *
 * `feedback_written_but_never_read`, one turn on: this asserts the reader
 * exists. Three facts, each individually load-bearing.
 */
describe('AGL-2495 · the job lockdown resolver is actually wired', () => {
  const RESOLVER = 'apps/tenant/utils/plugin-job-lockdown.ts'
  const RUNNER = 'apps/tenant/app/api/plugins/run-jobs/route.ts'

  it('the tenant registers a resolver, from the admin lib', () => {
    const source = read(RESOLVER)
    expect(source).toContain('registerPluginJobHostLockdown(')
    // Asking the SAME function the drill's fix asks, rather than keeping a
    // second notion of what a lock is — so the enforcement-class work on
    // `getSiteLockdown` reaches the job beat for free.
    expect(source).toContain('getSiteLockdown')
    expect(source).toContain("from '@aglyn/tenant-data-admin'")
  })

  it('the runner route imports it for its side effect', () => {
    // Delete this import and every job on the beat runs ungated.
    expect(read(RUNNER)).toContain("import '../../../../utils/plugin-job-lockdown'")
  })

  it('the runner reports whether the gate is wired at all', () => {
    // A silent no-op is the failure mode of a fail-open registry. The beat
    // says so in its response rather than leaving it to be inferred from
    // work happening on a locked site.
    expect(read(RUNNER)).toContain('hostLockdownWired')
  })

  it('the job contract makes the declaration REQUIRED, not optional', () => {
    // `lockdown?: PluginJobLockdown` would let every future registration
    // skip the question and would leave this whole describe asserting a
    // convention instead of a contract.
    const contract = read('libs/aglyn/src/lib/plugin-manager/plugin-jobs.ts')
    expect(contract).toContain('lockdown: PluginJobLockdown')
    expect(contract).not.toContain('lockdown?: PluginJobLockdown')
  })
})
