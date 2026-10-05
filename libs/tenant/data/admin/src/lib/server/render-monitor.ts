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
 * `system.siteRenderRecovered` once. The state lives in
 * `operatorHealthState/render-monitor--<host>`, beside every other health
 * check, so Staff → Operator alerts lists it with its status and since when.
 *
 * Nothing here names an Aglyn host: the default target is the install's own
 * demonstration site label under its own tenant apex, the convention the
 * middleware and the render canaries already follow.
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

export type RenderProbeKind = 'dynamic' | 'isr'

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
  return [...new Set([demo, ...listed].filter(Boolean))]
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
}

export type RenderMonitorTransition = 'failing' | 'recovered' | null

/**
 * The next state for one site, given what this run saw. Pure.
 *
 * The status turns `degraded` only once `threshold` runs in a row have
 * failed, so one slow cold start or one dropped connection says nothing. It
 * turns back on the first passing run, because a render that works is
 * proof, and a recovery held back is a recovery nobody hears about.
 */
export function nextRenderMonitorState(
  prior: Partial<RenderMonitorStateDoc> | null,
  observation: { ok: boolean; detail: string },
  context: { origin: string; label: string; threshold: number; now: number },
): { next: RenderMonitorStateDoc; transition: RenderMonitorTransition } {
  const { origin, label, threshold, now } = context
  const checkId = renderMonitorCheckId(origin)
  const detail = String(observation.detail ?? '').slice(0, 1_000)
  const wasDegraded = prior?.status === 'degraded'
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

function probeLine(row: RenderProbeRow): string {
  return `${row.kind} ${new URL(row.url).pathname}: ${row.detail} (${row.ms} ms)`
}

/** Fetch and grade one probe. Never throws. */
async function runProbe(
  origin: string,
  spec: RenderProbeSpec,
  options: {
    fetcher: typeof fetch
    headers: Record<string, string>
    nonce: string
    timeoutMs: number
    clock: () => number
  },
): Promise<RenderProbeRow> {
  const url = `${origin}${spec.path(options.nonce)}`
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

  const sites = await Promise.all(
    resolveRenderMonitorTargets(env).map(
      async (origin): Promise<RenderMonitorSiteResult> => {
        const probes = await Promise.all(
          RENDER_PROBES.map((spec) =>
            runProbe(origin, spec, {
              fetcher: options.fetcher ?? fetch,
              headers: options.headers ?? {},
              nonce: nonce(),
              timeoutMs: options.timeoutMs ?? RENDER_MONITOR_TIMEOUT_MS,
              clock,
            }),
          ),
        )
        const ok = probes.every((probe) => probe.ok)
        const site: RenderMonitorSiteResult = { origin, ok, probes }
        if (dryRun) return site
        const host = new URL(origin).host
        const failing = probes.filter((probe) => !probe.ok)
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
                { ok, detail },
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
          site.status = next.status
          site.consecutiveFailures = next.consecutiveFailures
          site.transition = transition
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
          site.error = error instanceof Error ? error.message : String(error)
          console.error(`[render-monitor] ${host} could not be recorded`, error)
        }
        return site
      },
    ),
  )
  return { dryRun, threshold, sites }
}
