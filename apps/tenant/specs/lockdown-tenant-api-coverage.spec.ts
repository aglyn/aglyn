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
 * must either resolve a lockdown for the host it touches or be recorded in
 * {@link UNGATED_JOBS}. A new job is a violation by existing — including a
 * new job added to a file that already holds four.
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
const JOB_REGISTRATION =
  /registerPluginJob\(\{[\s\S]{0,600}?name:\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/g
/** `const NAME = 'value'` in the same file, for the constant spelling. */
function resolveJobName(source: string, literal?: string, ident?: string) {
  if (literal) return literal
  if (!ident) return null
  const match = source.match(
    new RegExp(`(?:export\\s+)?const\\s+${ident}\\s*=\\s*'([^']+)'`),
  )
  return match ? match[1] : null
}
/** The gate as it is written when it guards the work, not merely imported. */
const JOB_GATE =
  /if\s*\(\s*await\s+getSiteLockdown\(|(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*await\s+getSiteLockdown\(/

interface JobSite {
  key: string
  file: string
  name: string
  gated: boolean
}

const JOB_SITES: JobSite[] = JOB_ROOTS.flatMap((root) =>
  walk(
    resolve(REPO_ROOT, root),
    (name) => name.endsWith('.ts') && !name.includes('.spec.'),
  )
    .map(repoPath)
    .flatMap((file) => {
      const source = read(file)
      const gated = JOB_GATE.test(source)
      return [...source.matchAll(JOB_REGISTRATION)].flatMap((match) => {
        const name = resolveJobName(source, match[1], match[2])
        // An unresolvable name is not a pass. It means a registration exists
        // that this walk cannot key, which is indistinguishable from the
        // miss above, so it is surfaced as its own key rather than dropped.
        return [
          {
            key: `${file}#${name ?? `UNRESOLVED(${match[2]})`}`,
            file,
            name: name ?? '',
            gated,
          },
        ]
      })
    }),
).sort((a, b) => a.key.localeCompare(b.key))

/**
 * Background jobs that run on platform credentials and do NOT resolve a
 * lockdown. Frozen, for the same three reasons the route set above is —
 * except that here the members are not reads: they mutate. That is why they
 * are named individually rather than by file, and why adding a fifth job to
 * `commerce/server.ts` fails this spec.
 *
 * Closing them is not a line-of-code change and was not attempted in
 * AGL-2495: `libs/plugins/*` cannot import `@aglyn/tenant-data-admin` under
 * the current nx boundaries, so a plugin job cannot call `getSiteLockdown`
 * without either a new shared edge or the runner handing the verdict to the
 * handler. The runner is the better shape — it already resolves the release
 * flags for every job — but it is a change to the job contract, not to a
 * call site.
 */
const UNGATED_JOBS: Record<string, string> = {
  'libs/plugins/bookings/src/lib/server.ts#booking-reminders':
    'sends reminder email for upcoming bookings on a locked host',
  'libs/plugins/bookings/src/lib/server.ts#expire-stale-holds':
    'releases held booking slots — a write across every site, including locked ones',
  'libs/plugins/commerce/src/lib/server.ts#abandoned-checkout-recovery':
    'sends recovery email for carts on a locked host',
  'libs/plugins/commerce/src/lib/server.ts#back-in-stock-alerts':
    'sends stock alerts for a locked host',
  'libs/plugins/commerce/src/lib/server.ts#stock-decrement-reconciliation':
    'rewrites inventory counts across every site',
  'libs/plugins/commerce/src/lib/server.ts#supplier-webhook-delivery':
    'delivers outbound webhooks on behalf of a locked host',
}

describe('AGL-2495 · every background job that writes for a host asks the lock', () => {
  it('discovers the registrations rather than trusting a list', () => {
    // ANTI-VACUITY, and the shape that matters most here: this walk crosses
    // two roots and a regex with a bounded lookahead, so an empty result is
    // entirely plausible and would pass every assertion below.
    expect(JOB_SITES.length).toBeGreaterThanOrEqual(7)
    expect(new Set(JOB_SITES.map((job) => job.file)).size).toBeGreaterThan(1)
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
    expect(`${anchor?.file}: ${anchor?.gated}`).toBe(
      'apps/tenant/utils/publish-schedule-job.ts: true',
    )
  })

  it('leaves no job ungated and unrecorded', () => {
    const violations = JOB_SITES.filter(
      (job) => !job.gated && !(job.key in UNGATED_JOBS),
    ).map(
      (job) =>
        `${job.key} — this job writes for a host on platform credentials ` +
        `with no lockdown verdict on the path. Resolve the lock for the host ` +
        `it is about to touch (apps/tenant/utils/publish-schedule-job.ts is ` +
        `the model), or record it in UNGATED_JOBS with what it does.`,
    )
    expect(violations).toEqual([])
  })

  it('holds the ungated-job set at exactly its recorded size', () => {
    // Both directions: a new job in an already-listed file must be argued
    // for, and a job that gets gated must be struck from the list rather
    // than left as a stale claim.
    const ungated = JOB_SITES.filter((job) => !job.gated)
      .map((job) => job.key)
      .sort()
    expect(ungated).toEqual(Object.keys(UNGATED_JOBS).sort())
  })
})
