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

import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import type { OperatorHealthStateDoc } from './operator-health'

/**
 * THE RENDER MONITOR (AGL-3568): does a published site still render a page
 * that was not already in a cache?
 *
 * On 2026-10-05 every uncached page render on the published-site runtime
 * hung to the platform's 60 s limit for 28 minutes, and nothing alerted. The
 * three monitors that existed each missed it for its own reason:
 *
 *  - the GitHub uptime probe is scheduled every 15 minutes and GitHub ran it
 *    four times that day, none of them during the outage;
 *  - its page rows fetch `/`, which the ISR cache answers, so a visitor's
 *    page that was cached still loaded and the row stayed green;
 *  - `/api/health/render/site` runs the page LOADER in-process and never the
 *    site layout, which is where the request was stuck.
 *
 * So this fetches pages over HTTP, from the console (a different deployment
 * from the one it watches), on Cloud Scheduler every five minutes, and asks
 * for two pages no cache can answer:
 *
 *  - `dynamic` — `/search`, a route every site has that renders on every
 *    request (`force-dynamic`) inside the full site layout. A 200 that is a
 *    complete document proves the layout and head ran just now.
 *  - `isr` — a path nobody has ever requested, under the catch-all page.
 *    A never-seen path is the one request the ISR cache cannot answer, so it
 *    renders in the same static context every published page renders in,
 *    which is the context the 2026-09-09 outage only appeared in. It is a
 *    404 by construction, and the site's own not-found page is drawn inside
 *    the same layout, so a complete 404 document is a pass.
 *
 * A site that fails `threshold` runs in a row raises
 * `system.siteRenderFailing` once; the first passing run after that raises
 * `system.siteRenderRecovered` once.
 *
 * ## A challenge is not a failed render (AGL-3580)
 *
 * When bot protection answers instead of the site, this run saw nothing about
 * the site at all. On 2026-10-05 the console had no `AGLYN_PROBE_TOKEN`, every
 * `/search` probe got the 429 checkpoint for three hours, and the monitor told
 * the operator "Pages are not rendering on aglyn.com" and then "rendering
 * again after 3 h" about a site that was serving pages the whole time. So a
 * run whose only failures are challenges is BLIND: it leaves the site's
 * verdict and failure count exactly as they were, and `threshold` blind runs
 * in a row raise `system.renderMonitorBlind` once, which names the setup
 * problem instead of an outage. A run with a real failure beside a challenge
 * is still a failure, because the real one is evidence. The state lives in
 * `operatorHealthState/render-monitor--<host>`, beside every other health
 * check, so Staff → Operator alerts lists it with its status and since when.
 *
 * Nothing here names an Aglyn host for anyone else: the default target is the
 * install's own demonstration site label under its own tenant apex, the
 * convention the middleware and the render canaries already follow. The one
 * exception is `PLATFORM_RENDER_PAGES` below, which applies on Aglyn's own
 * console deployment and nowhere else.
 *
 * ## Real pages, rendered fresh (AGL-3571)
 *
 * The two probes above draw the layout. They do not draw a page BODY, and
 * beta.223 hung only on page bodies with an image in them (an ancestor walk
 * looped on the page root, AGL-3565): `demo` has no images and the not-found
 * page has no body, so this monitor read green through it. So a third probe,
 * `page`, renders a real published page through the full ISR path — through
 * the tenant's `*.vercel.app` production domain (`RENDER_MONITOR_RENDER_ORIGIN`),
 * which honors `?tenantHost=` and sits behind Deployment Protection, naming
 * the site with a spelling no cache holds (`freshHostSpelling`). The cache key
 * includes the `[host]` segment, and `normalizeHostAlias` resolves every
 * spelling to the same site. Without the automation bypass the render origin
 * answers its sign-in redirect, so no `page` probe is made at all.
 *
 * One page per site per run, rotating through that site's list: a platform
 * break fails every page with an image, so every run, and alerts as fast as
 * before; a break on one page alone is seen on its turn.
 */

/** The state documents' collection: the health checks' own. */
const RENDER_MONITOR_COLLECTION = 'operatorHealthState'

/** Every render monitor document id starts with this. */
export const RENDER_MONITOR_CHECK_PREFIX = 'render-monitor--'

/** The beat id `/api/health/crons` reads for the scheduled run. */
export const RENDER_MONITOR_JOB_ID = 'render-monitor'

/**
 * How long one page fetch may take. Well under the 60 s a platform function
 * may run, so a hung render is graded here as a timeout rather than waiting
 * for the platform's 504, and well under the route's own `maxDuration`.
 */
export const RENDER_MONITOR_TIMEOUT_MS = 25_000

/** Failing runs in a row before the alert goes out. */
export const RENDER_MONITOR_DEFAULT_THRESHOLD = 2

/**
 * The prefix of the never-requested path the `isr` probe asks for. A
 * lowercase slug on purpose: it must reach the catch-all page like any
 * screen slug would, not a reserved or rewritten route.
 */
export const RENDER_PROBE_ISR_PREFIX = '/aglyn-render-probe-'

export type RenderProbeKind = 'dynamic' | 'isr' | 'page'

export interface RenderProbeSpec {
  kind: RenderProbeKind
  /** The path to request, given a fresh nonce. */
  path: (nonce: string) => string
  /** The status a healthy render answers with. */
  expectStatus: number
}

export const RENDER_PROBES: readonly RenderProbeSpec[] = [
  { kind: 'dynamic', path: () => '/search', expectStatus: 200 },
  {
    kind: 'isr',
    path: (nonce) => `${RENDER_PROBE_ISR_PREFIX}${nonce}`,
    expectStatus: 404,
  },
]

/** One fetched response, reduced to what grading reads. */
export interface RenderProbeResponse {
  status: number
  contentType?: string | null
  body?: string
  location?: string | null
  /** `x-vercel-cache` on Vercel, `x-nextjs-cache` on a plain `next start`. */
  cacheState?: string | null
}

export interface RenderProbeVerdict {
  ok: boolean
  /** Bot protection answered instead of the site. */
  challenged: boolean
  /** A stable code; `ok` on a pass. */
  code: string
  detail: string
}

/** Vercel's challenge interstitial, matched on the body like the front doors. */
const CHECKPOINT_MARKER = /Vercel Security Checkpoint/i

/**
 * Cache states that mean the bytes came out of a store. A probe meant to
 * prove a render cannot pass on one of these, whatever the status.
 */
const CACHED_STATES = new Set(['HIT', 'STALE', 'PRERENDER'])

/**
 * Grade one probe response. Pure.
 *
 * The page markers are the front doors' (`tools/scripts/lib/front-door.mjs`)
 * and for their reason: structural, never site copy. `</html>` proves the
 * document finished streaming, `/_next/static/` that our build produced it.
 */
export function gradeRenderProbe(
  response: RenderProbeResponse,
  expectStatus: number,
): RenderProbeVerdict {
  const body = response.body ?? ''
  if (CHECKPOINT_MARKER.test(body)) {
    return {
      ok: false,
      challenged: true,
      code: 'challenged',
      detail: `bot protection answered (HTTP ${response.status}) instead of the site; check AGLYN_PROBE_TOKEN on the console`,
    }
  }
  if (response.status >= 300 && response.status < 400) {
    return {
      ok: false,
      challenged: false,
      code: 'redirected',
      detail: `redirected to ${response.location ?? '?'}, so no page was rendered`,
    }
  }
  if (response.status !== expectStatus) {
    return {
      ok: false,
      challenged: false,
      code: `http-${response.status}`,
      detail: `HTTP ${response.status}`,
    }
  }
  if (!/text\/html/i.test(response.contentType ?? '')) {
    return {
      ok: false,
      challenged: false,
      code: 'not-html',
      detail: `not HTML (${response.contentType || 'no content-type'})`,
    }
  }
  if (!body.includes('</html>')) {
    return {
      ok: false,
      challenged: false,
      code: 'incomplete',
      detail: 'the document never finished (no </html>)',
    }
  }
  if (!body.includes('/_next/static/')) {
    return {
      ok: false,
      challenged: false,
      code: 'not-our-render',
      detail: 'no Next asset references, so the app did not render it',
    }
  }
  const cache = String(response.cacheState ?? '').trim().toUpperCase()
  if (CACHED_STATES.has(cache)) {
    return {
      ok: false,
      challenged: false,
      code: 'served-from-cache',
      detail: `served from cache (${cache}), so it proves no render`,
    }
  }
  return { ok: true, challenged: false, code: 'ok', detail: 'rendered' }
}

/**
 * The pages Aglyn's own console renders fresh when `RENDER_MONITOR_PAGES` is
 * unset: the canary's real client pages (`tools/scripts/lib/prod-canary.mjs`
 * `DEFAULT_TENANT_HOSTS`), images, reusable components, repeats and a form
 * between them. Applied ONLY on that console deployment (`VERCEL_PROJECT_ID`),
 * so no other install ever requests them.
 */
export const PLATFORM_RENDER_PAGES = [
  'ready-to-roll.aglyn.app/',
  'edr-construction.aglyn.app/',
  'edr-construction.aglyn.app/services',
  'edr-construction.aglyn.app/contact',
].join(' ')

/** Aglyn's console project on Vercel, the one deployment the list above is for. */
export const PLATFORM_CONSOLE_VERCEL_PROJECT_ID = 'prj_gEzxEXc0Lhs81rmaXIg2a1GbsDfl'

/**
 * The tenant's production project domain on Vercel: follows every promote and
 * rollback, honors `?tenantHost=`, and is reachable only with the bypass.
 */
export const PLATFORM_RENDER_ORIGIN = 'https://aglyn-tenant-aglyn.vercel.app'

/** The middleware's custom-domain sentinel (`apps/tenant/utils/get-host.ts`). */
const CNAME_HOST_PREFIX = 'cname--'

/** Letters past this are never recased, so the bit arithmetic stays in 32 bits. */
const MAX_SPELLING_BITS = 30

function spellingLetters(host: string): number[] {
  return [...host.toLowerCase()]
    .map((char, index) => (/[a-z]/.test(char) ? index : -1))
    .filter((index) => index >= 0)
    .slice(0, MAX_SPELLING_BITS)
}

/**
 * Spelling number `n` of one site: a `?tenantHost=` value that resolves to
 * that site and is a `[host]` route segment no other number produces, so the
 * page it asks for has no cache entry to come from.
 *
 *  - `{sub}.{apex}` → the full name, letters upper-cased by the bits of `n`,
 *    then one trailing dot per exhausted round of cases.
 *  - any other name → `cname--{name}`, recased the same way and cycling after
 *    `2 ** letters` (that form keeps trailing dots), with the prefix left
 *    lower-case because the canonical-domain redirect tests the raw segment.
 *
 * MUST stay identical to `freshHostSpelling` in
 * `tools/scripts/lib/prod-canary.mjs`; `apps/tenant/specs/probe-host-spelling.spec.ts`
 * pins both against `normalizeHostAlias`.
 */
export function freshHostSpelling(host: string, n: number, apex: string = TENANT_APEX): string {
  const subdomain = host.endsWith(`.${apex}`)
  const prefix = subdomain ? '' : CNAME_HOST_PREFIX
  const chars = [...host.toLowerCase()]
  const letters = spellingLetters(host)
  const capacity = 2 ** letters.length
  const value = Math.max(0, Math.floor(Number(n) || 0))
  const bits = value % capacity
  letters.forEach((index, bit) => {
    if (Math.floor(bits / 2 ** bit) % 2 === 1) chars[index] = chars[index].toUpperCase()
  })
  const dots = subdomain ? '.'.repeat(Math.floor(value / capacity)) : ''
  return `${prefix}${chars.join('')}${dots}`
}

/**
 * The spelling number for a run at `nowMs`: minutes since 2026-10-01, so it
 * never repeats on one deployment — a `{sub}.aglyn.app` name of 18 letters
 * gains its first trailing dot after half a year.
 */
export function renderSpellingNumber(nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - Date.UTC(2026, 9, 1)) / 60_000))
}

/** One watched site's real pages. */
export interface RenderMonitorPages {
  /** The site's public origin, which keys its state document. */
  origin: string
  host: string
  paths: string[]
}

/**
 * `"a.example.app b.example.app/services, https://b.example.app/contact"` →
 * one entry per host, paths merged, `/` when an entry names none. Entries that
 * are not a hostname are dropped, as `RENDER_MONITOR_ORIGINS` drops them.
 */
export function parseRenderMonitorPages(text: string | undefined | null): RenderMonitorPages[] {
  const byHost = new Map<string, string[]>()
  for (const raw of String(text ?? '').split(/[\s,]+/)) {
    const entry = raw.trim().replace(/^https?:\/\//i, '')
    if (!entry) continue
    const slash = entry.indexOf('/')
    const host = (slash === -1 ? entry : entry.slice(0, slash)).toLowerCase()
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) continue
    const path = slash === -1 ? '/' : entry.slice(slash).replace(/\/+$/, '') || '/'
    const paths = byHost.get(host) ?? []
    if (!paths.includes(path)) paths.push(path)
    byHost.set(host, paths)
  }
  return [...byHost].map(([host, paths]) => ({ origin: `https://${host}`, host, paths }))
}

/**
 * Which real pages the monitor renders, and through which origin.
 *
 * `RENDER_MONITOR_PAGES` (same grammar as the canary's `CANARY_TENANT_HOSTS`)
 * and `RENDER_MONITOR_RENDER_ORIGIN`, else — on Aglyn's own console only —
 * `PLATFORM_RENDER_PAGES` through `PLATFORM_RENDER_ORIGIN`. `off` (here or in
 * `RENDER_MONITOR_ORIGINS`) renders none. No render origin, no pages.
 */
export function resolveRenderMonitorPages(
  env: Readonly<Record<string, string | undefined>>,
): { renderOrigin: string; pages: RenderMonitorPages[] } {
  const off = /^(off|none|false|0)$/i
  const raw = String(env['RENDER_MONITOR_PAGES'] ?? '').trim()
  if (off.test(raw) || off.test(String(env['RENDER_MONITOR_ORIGINS'] ?? '').trim())) {
    return { renderOrigin: '', pages: [] }
  }
  const platform = env['VERCEL_PROJECT_ID'] === PLATFORM_CONSOLE_VERCEL_PROJECT_ID
  const renderOrigin =
    originOf(env['RENDER_MONITOR_RENDER_ORIGIN']) || (platform ? PLATFORM_RENDER_ORIGIN : '')
  const pages = parseRenderMonitorPages(raw || (platform ? PLATFORM_RENDER_PAGES : ''))
  return renderOrigin ? { renderOrigin, pages } : { renderOrigin: '', pages: [] }
}

/** A configured value as an origin, or '' when it is not one. */
export function originOf(value: string | undefined | null): string {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[^/\s?#]+$/i.test(trimmed) ? trimmed.toLowerCase() : ''
}

/**
 * Which sites the monitor renders, from the console's environment.
 *
 * 1. The install's demonstration site: `OPERATOR_HEALTH_TENANT_ORIGIN` when
 *    set (the one published site the operator alerts tick already watches),
 *    else `https://<AGLYN_TENANT_DEMO or demo>.<tenant apex>`.
 * 2. Plus every origin in `RENDER_MONITOR_ORIGINS`, comma separated.
 *
 * `RENDER_MONITOR_ORIGINS=off` watches nothing, for an install with no
 * published site to watch. Values that are not origins are dropped.
 */
export function resolveRenderMonitorTargets(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const raw = String(env['RENDER_MONITOR_ORIGINS'] ?? '').trim()
  if (/^(off|none|false|0)$/i.test(raw)) return []
  const apex =
    String(env['NEXT_PUBLIC_TENANT_DOMAIN'] ?? '').trim() || TENANT_APEX
  const label = String(env['AGLYN_TENANT_DEMO'] ?? '').trim() || 'demo'
  const demo =
    originOf(env['OPERATOR_HEALTH_TENANT_ORIGIN']) ||
    originOf(`https://${label}.${apex}`)
  const listed = raw
    .split(/[\s,]+/)
    .map((value) => originOf(value))
    .filter(Boolean)
  // A site whose pages are rendered is watched whole: its layout probes too.
  const paged = resolveRenderMonitorPages(env).pages.map((page) => page.origin)
  return [...new Set([demo, ...listed, ...paged].filter(Boolean))]
}

/** The state document id for one origin. */
export function renderMonitorCheckId(origin: string): string {
  return `${RENDER_MONITOR_CHECK_PREFIX}${new URL(origin).host}`
}

/** One render monitor state document. */
export interface RenderMonitorStateDoc extends OperatorHealthStateDoc {
  origin: string
  /** Failing runs in a row, reset by any passing run. */
  consecutiveFailures: number
  /** When the current run of failures began; null while passing. */
  failingSinceMs: number | null
  lastOkAtMs: number | null
  /** Runs in a row where bot protection answered instead of the site. */
  consecutiveBlindRuns?: number
  /** When the current blind stretch began; null while the monitor can see. */
  blindSinceMs?: number | null
  /** When a run last saw the site itself: a pass or a real failure. */
  lastObservedAtMs?: number | null
}

export type RenderMonitorTransition = 'failing' | 'recovered' | 'blind' | null

/**
 * The next state for one site, given what this run saw. Pure.
 *
 * The status turns `degraded` only once `threshold` runs in a row have
 * failed, so one slow cold start or one dropped connection says nothing. It
 * turns back on the first passing run, because a render that works is
 * proof, and a recovery held back is a recovery nobody hears about.
 *
 * A BLIND observation (every failure was a bot-protection challenge) changes
 * nothing about the site: its status, failure count and since-time carry over
 * untouched, and only the blind count moves. It transitions to `blind` once,
 * on the `threshold`-th blind run in a row.
 */
export function nextRenderMonitorState(
  prior: Partial<RenderMonitorStateDoc> | null,
  observation: { ok: boolean; detail: string; blind?: boolean },
  context: { origin: string; label: string; threshold: number; now: number },
): { next: RenderMonitorStateDoc; transition: RenderMonitorTransition } {
  const { origin, label, threshold, now } = context
  const checkId = renderMonitorCheckId(origin)
  const detail = String(observation.detail ?? '').slice(0, 1_000)
  const wasDegraded = prior?.status === 'degraded'
  if (!observation.ok && observation.blind) {
    const blindRuns = (prior?.consecutiveBlindRuns ?? 0) + 1
    return {
      next: {
        checkId,
        label,
        origin,
        status: wasDegraded ? 'degraded' : 'ok',
        sinceMs: prior?.sinceMs ?? now,
        detail: `The monitor cannot see this site: ${detail}`.slice(0, 1_000),
        updatedAtMs: now,
        consecutiveFailures: prior?.consecutiveFailures ?? 0,
        failingSinceMs: prior?.failingSinceMs ?? null,
        lastOkAtMs: prior?.lastOkAtMs ?? null,
        consecutiveBlindRuns: blindRuns,
        blindSinceMs: prior?.blindSinceMs ?? now,
        lastObservedAtMs: prior?.lastObservedAtMs ?? null,
      },
      transition: blindRuns === Math.max(1, threshold) ? 'blind' : null,
    }
  }
  const sighted = { consecutiveBlindRuns: 0, blindSinceMs: null, lastObservedAtMs: now }
  if (observation.ok) {
    return {
      next: {
        checkId,
        label,
        origin,
        status: 'ok',
        sinceMs: !wasDegraded && prior?.sinceMs ? prior.sinceMs : now,
        detail,
        updatedAtMs: now,
        consecutiveFailures: 0,
        failingSinceMs: null,
        lastOkAtMs: now,
        ...sighted,
      },
      transition: wasDegraded ? 'recovered' : null,
    }
  }
  const failures = (prior?.consecutiveFailures ?? 0) + 1
  const failingSinceMs = prior?.failingSinceMs ?? now
  const degraded = wasDegraded || failures >= Math.max(1, threshold)
  return {
    next: {
      checkId,
      label,
      origin,
      status: degraded ? 'degraded' : 'ok',
      sinceMs: degraded
        ? wasDegraded && prior?.sinceMs
          ? prior.sinceMs
          : failingSinceMs
        : (prior?.sinceMs ?? now),
      detail,
      updatedAtMs: now,
      consecutiveFailures: failures,
      failingSinceMs,
      lastOkAtMs: prior?.lastOkAtMs ?? null,
      ...sighted,
    },
    transition: degraded && !wasDegraded ? 'failing' : null,
  }
}

/** One probe as the report shows it. */
export interface RenderProbeRow extends RenderProbeVerdict {
  kind: RenderProbeKind
  url: string
  ms: number
  httpStatus: number | null
}

/** One site's result for a run. */
export interface RenderMonitorSiteResult {
  origin: string
  ok: boolean
  /** Every failure this run was a challenge, so it saw nothing of the site. */
  blind: boolean
  probes: RenderProbeRow[]
  /** The state written; absent on a dry run or a failed write. */
  status?: 'ok' | 'degraded'
  consecutiveFailures?: number
  transition?: RenderMonitorTransition
  error?: string
}

export interface RenderMonitorReport {
  dryRun: boolean
  threshold: number
  sites: RenderMonitorSiteResult[]
}

/** The read-modify-write of one site's state, as one transaction. */
export type RenderMonitorStore = <T>(
  checkId: string,
  work: (prior: Partial<RenderMonitorStateDoc> | null) => {
    next: RenderMonitorStateDoc
    result: T
  },
) => Promise<T>

/**
 * The default store: one Firestore transaction on the site's document, so
 * two overlapping runs cannot both decide they saw the edge.
 */
const firestoreStore: RenderMonitorStore = async (checkId, work) => {
  const { default: firebaseAdmin } = await import('./firebase-admin')
  const db = firebaseAdmin.app().firestore()
  const ref = db.collection(RENDER_MONITOR_COLLECTION).doc(checkId)
  return db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    const prior = snapshot.exists
      ? (snapshot.data() as Partial<RenderMonitorStateDoc>)
      : null
    const { next, result } = work(prior)
    transaction.set(ref, next)
    return result
  })
}

type RaiseAlert = (
  type: string,
  options: { dedupeKey?: string; context?: Record<string, string | number> },
) => Promise<unknown>

const defaultRaise: RaiseAlert = async (type, options) => {
  const { raiseOperatorAlert } = await import('./operator-alerts')
  return raiseOperatorAlert(type, options)
}

function describeDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * The `page` probe's URL for one run: this run's page of the site's list
 * (rotating every five-minute slot), under this run's spelling of the site.
 */
export function pageProbeUrl(
  renderOrigin: string,
  site: RenderMonitorPages,
  slot: number,
  spelling: number,
): string {
  const path = site.paths[Math.abs(slot) % site.paths.length] ?? '/'
  const url = new URL(path, renderOrigin)
  url.searchParams.set('tenantHost', freshHostSpelling(site.host, spelling))
  return url.toString()
}

function probeLine(row: RenderProbeRow): string {
  return `${row.kind} ${new URL(row.url).pathname}: ${row.detail} (${row.ms} ms)`
}

/** Fetch and grade one probe. Never throws. */
async function runProbe(
  url: string,
  spec: { kind: RenderProbeKind; expectStatus: number },
  options: {
    fetcher: typeof fetch
    headers: Record<string, string>
    timeoutMs: number
    clock: () => number
  },
): Promise<RenderProbeRow> {
  const startedAt = options.clock()
  try {
    const response = await options.fetcher(url, {
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        'user-agent': 'aglyn-render-monitor',
        accept: 'text/html,application/xhtml+xml',
        ...options.headers,
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    const body = await response.text()
    const verdict = gradeRenderProbe(
      {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body,
        location: response.headers.get('location'),
        cacheState:
          response.headers.get('x-vercel-cache') ??
          response.headers.get('x-nextjs-cache'),
      },
      spec.expectStatus,
    )
    return {
      kind: spec.kind,
      url,
      ms: options.clock() - startedAt,
      httpStatus: response.status,
      ...verdict,
    }
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    const timedOut = name === 'TimeoutError' || name === 'AbortError'
    return {
      kind: spec.kind,
      url,
      ms: options.clock() - startedAt,
      httpStatus: null,
      ok: false,
      challenged: false,
      code: timedOut ? 'timeout' : 'unreachable',
      detail: timedOut
        ? `no complete page in ${Math.round(options.timeoutMs / 1_000)} s`
        : `unreachable (${(error as { cause?: { code?: string } } | null)?.cause?.code ?? name ?? 'error'})`,
    }
  }
}

/**
 * One run: render every target, record each site's state, raise the edge.
 *
 * A dry run fetches and grades and writes nothing, so a person can ask
 * "what would the monitor see right now" without moving its state.
 */
export async function runRenderMonitor(
  options: {
    dryRun?: boolean
    env?: Readonly<Record<string, string | undefined>>
    fetcher?: typeof fetch
    /** Our own edge's bypass headers, from the caller's environment. */
    headers?: Record<string, string>
    now?: () => number
    nonce?: () => string
    timeoutMs?: number
    store?: RenderMonitorStore
    raise?: RaiseAlert
  } = {},
): Promise<RenderMonitorReport> {
  const env = options.env ?? process.env
  const clock = options.now ?? Date.now
  const store = options.store ?? firestoreStore
  const raise = options.raise ?? defaultRaise
  const dryRun = Boolean(options.dryRun)
  const parsedThreshold = Number.parseInt(
    String(env['RENDER_MONITOR_FAILURE_THRESHOLD'] ?? ''),
    10,
  )
  const threshold =
    Number.isFinite(parsedThreshold) && parsedThreshold >= 1
      ? parsedThreshold
      : RENDER_MONITOR_DEFAULT_THRESHOLD
  const nonce =
    options.nonce ??
    (() => `${clock().toString(36)}${Math.random().toString(36).slice(2, 8)}`)

  const probeOptions = {
    fetcher: options.fetcher ?? fetch,
    headers: options.headers ?? {},
    timeoutMs: options.timeoutMs ?? RENDER_MONITOR_TIMEOUT_MS,
    clock,
  }
  // Real pages need the render origin AND the bypass that gets past its
  // Deployment Protection; without both a `page` probe could only fail.
  const { renderOrigin, pages } = resolveRenderMonitorPages(env)
  const canRenderPages = Boolean(
    renderOrigin && probeOptions.headers['x-vercel-protection-bypass'],
  )
  const runAt = clock()
  const slot = Math.floor(runAt / 300_000)

  const sites = await Promise.all(
    resolveRenderMonitorTargets(env).map(
      async (origin): Promise<RenderMonitorSiteResult> => {
        const layoutProbes = RENDER_PROBES.map((spec) =>
          runProbe(`${origin}${spec.path(nonce())}`, spec, probeOptions),
        )
        const site = canRenderPages ? pages.find((page) => page.origin === origin) : undefined
        const pageProbe = site
          ? [
              runProbe(
                pageProbeUrl(renderOrigin, site, slot, renderSpellingNumber(runAt)),
                { kind: 'page', expectStatus: 200 },
                probeOptions,
              ),
            ]
          : []
        const probes = await Promise.all([...layoutProbes, ...pageProbe])
        const ok = probes.every((probe) => probe.ok)
        const failing = probes.filter((probe) => !probe.ok)
        const blind = !ok && failing.every((probe) => probe.challenged)
        const result: RenderMonitorSiteResult = { origin, ok, blind, probes }
        if (dryRun) return result
        const host = new URL(origin).host
        const detail = ok
          ? 'Fresh renders pass.'
          : failing.map(probeLine).join('; ')
        try {
          const now = clock()
          const { next, transition, failingSinceMs } = await store(
            renderMonitorCheckId(origin),
            (prior) => {
              const decided = nextRenderMonitorState(
                prior,
                { ok, detail, blind },
                {
                  origin,
                  label: `Page rendering on ${host}`,
                  threshold,
                  now,
                },
              )
              return {
                next: decided.next,
                result: {
                  ...decided,
                  // When the failures a recovery ends began.
                  failingSinceMs: prior?.failingSinceMs ?? prior?.sinceMs ?? now,
                },
              }
            },
          )
          result.status = next.status
          result.consecutiveFailures = next.consecutiveFailures
          result.transition = transition
          if (transition === 'failing') {
            await raise('system.siteRenderFailing', {
              dedupeKey: host,
              context: {
                site: host,
                failures: next.consecutiveFailures,
                since: describeDuration(now - next.sinceMs),
                detail,
              },
            })
          } else if (transition === 'blind') {
            await raise('system.renderMonitorBlind', {
              dedupeKey: host,
              context: {
                site: host,
                runs: next.consecutiveBlindRuns ?? threshold,
                detail,
              },
            })
          } else if (transition === 'recovered') {
            await raise('system.siteRenderRecovered', {
              dedupeKey: host,
              context: {
                site: host,
                duration: describeDuration(now - failingSinceMs),
              },
            })
          }
        } catch (error) {
          result.error = error instanceof Error ? error.message : String(error)
          console.error(`[render-monitor] ${host} could not be recorded`, error)
        }
        return result
      },
    ),
  )
  return { dryRun, threshold, sites }
}

/**
 * One watched site as `/api/health/pages` reports it (AGL-3580).
 *
 * The shape of every other health check — `ok`, `ms`, a stable `code` — plus
 * when the monitor last saw the site, so a reader can tell a fresh verdict
 * from an old one without a second request.
 */
export interface RenderPagesCheck {
  ok: boolean
  ms: number
  code?: string
  /** When a run last rendered or failed this site's pages, ISO. */
  lastObservedAt: string | null
  /** When the site's current status began, ISO. */
  since: string | null
}

/**
 * A verdict older than this says the monitor stopped, not that the site did.
 * Four missed five-minute runs.
 */
export const RENDER_PAGES_STALE_MS = 20 * 60_000

/** How many sites one `?site=` may ask about. */
export const RENDER_PAGES_MAX_SITES = 10

/**
 * Which watched hosts a `?site=` asks about. Pure.
 *
 * Absent or empty asks about every watched site. A host that is not watched
 * is kept, so the caller can answer it red: a public monitor pointed at a
 * site nobody renders is a monitor that can never go red, which is the
 * mistake this door exists to undo.
 */
export function requestedRenderPagesHosts(
  query: string | null | undefined,
  watchedOrigins: readonly string[],
): string[] {
  const asked = String(query ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((entry) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(entry))
  const hosts = asked.length ? asked : watchedOrigins.map((origin) => new URL(origin).host)
  return [...new Set(hosts)].slice(0, RENDER_PAGES_MAX_SITES)
}

/**
 * The public verdict on real pages, per site, from the render monitor's
 * stored state (AGL-3580). Pure.
 *
 * This is what the status page's `Published sites` and `Marketing site`
 * monitors read. Before it they read `/api/health/render/*`, which builds a
 * node tree inside a route handler and never draws a page, and both stayed at
 * 100% through two outages on 2026-10-05 in which every fresh page hung.
 *
 * Red is reserved for the one thing a visitor would notice:
 *
 *  - `not-rendering` — the monitor saw the site fail to render pages it could
 *    not have served from a cache, `threshold` runs in a row.
 *  - `not-watched` — the monitor renders nothing for this host, so this row
 *    could never go red; fix the monitor's config or the URL.
 *  - `state-unavailable` — the verdicts could not be read at all.
 *
 * Green with a code is a verdict this door cannot improve on, and is never
 * reported as an outage, because it is not one:
 *
 *  - `awaiting-first-run` — a site added since the monitor last ran.
 *  - `monitor-blind` — bot protection answered the monitor; the site's last
 *    real verdict stands, and the operator alert says what to fix.
 *  - `observation-stale` — no run in {@link RENDER_PAGES_STALE_MS}; the
 *    monitor's own `render-monitor` row on `/api/health/crons` is what goes
 *    red for that, so a stopped scheduler is never told as a site outage.
 */
export function renderPagesHealth(
  hosts: readonly string[],
  watchedOrigins: readonly string[],
  states: ReadonlyMap<string, Partial<RenderMonitorStateDoc>> | null,
  ms: number,
  now: number = Date.now(),
): Record<string, RenderPagesCheck> {
  const watched = new Set(watchedOrigins.map((origin) => new URL(origin).host))
  const iso = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : null
  const checks: Record<string, RenderPagesCheck> = {}
  if (!hosts.length) {
    checks['sites'] = { ok: false, ms, code: 'no-sites-watched', lastObservedAt: null, since: null }
    return checks
  }
  for (const host of hosts) {
    const blank = { ms, lastObservedAt: null, since: null }
    if (!watched.has(host)) {
      checks[host] = { ...blank, ok: false, code: 'not-watched' }
      continue
    }
    if (states === null) {
      checks[host] = { ...blank, ok: false, code: 'state-unavailable' }
      continue
    }
    const state = states.get(`${RENDER_MONITOR_CHECK_PREFIX}${host}`)
    if (!state) {
      checks[host] = { ...blank, ok: true, code: 'awaiting-first-run' }
      continue
    }
    const observed = state.lastObservedAtMs ?? state.lastOkAtMs ?? null
    const row = { ms, lastObservedAt: iso(observed), since: iso(state.sinceMs) }
    if (state.status === 'degraded') {
      checks[host] = { ...row, ok: false, code: 'not-rendering' }
    } else if ((state.consecutiveBlindRuns ?? 0) > 0) {
      checks[host] = { ...row, ok: true, code: 'monitor-blind' }
    } else if (now - (state.updatedAtMs ?? 0) > RENDER_PAGES_STALE_MS) {
      checks[host] = { ...row, ok: true, code: 'observation-stale' }
    } else {
      checks[host] = { ...row, ok: true }
    }
  }
  return checks
}

/**
 * Read the stored verdicts for `hosts`, one batched read. Null when the read
 * fails, which {@link renderPagesHealth} reports red rather than calm.
 */
export async function readRenderMonitorStates(
  hosts: readonly string[],
): Promise<Map<string, Partial<RenderMonitorStateDoc>> | null> {
  try {
    const { default: firebaseAdmin } = await import('./firebase-admin')
    const db = firebaseAdmin.app().firestore()
    const refs = hosts.map((host) =>
      db.collection(RENDER_MONITOR_COLLECTION).doc(`${RENDER_MONITOR_CHECK_PREFIX}${host}`),
    )
    const snapshots = refs.length ? await db.getAll(...refs) : []
    const states = new Map<string, Partial<RenderMonitorStateDoc>>()
    for (const snapshot of snapshots) {
      if (snapshot.exists) states.set(snapshot.id, snapshot.data() as Partial<RenderMonitorStateDoc>)
    }
    return states
  } catch (error) {
    console.error('[render-monitor] stored verdicts could not be read', error)
    return null
  }
}
