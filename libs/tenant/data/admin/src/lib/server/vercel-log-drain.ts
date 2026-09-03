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

/**
 * The Vercel log-drain receiver (AGL-1921, third and last arm).
 *
 * ## Why this arm exists at all
 *
 * The two arms already shipped both start from OUR code running. The
 * `onRequestError` hook (`reportServerError`) sees a render or route handler
 * throw; `/api/health/server-errors` grades the markers that hook writes.
 * Neither can see:
 *
 * - an error that kills the process before the hook runs,
 * - a platform-level 5xx that never reaches our code at all — a function
 *   timeout, an OOM kill, a cold-start 502,
 * - anything thrown in the edge runtime.
 *
 * A log drain sees all three, because Vercel emits the request log whether or
 * not our code got far enough to have an opinion. That is why this is the arm
 * that closes the issue rather than a fourth partial view.
 *
 * ## The shape of the risk, and what each rule below buys
 *
 * A drain streams EVERY request log for both projects. The account's whole
 * monitoring budget is about $20/month, so the dangerous failure mode here is
 * not missing an error — it is faithfully forwarding a million healthy 200s
 * into Cloud Logging and getting a bill for it. Hence, in order:
 *
 * 1. **Signature first, fail closed.** HMAC-SHA1 of the RAW body keyed by the
 *    drain secret, timing-safe compared. Unsigned means unwritten, always.
 * 2. **Filter before writing.** `isServerErrorEntry` is the cost gate: an
 *    entry that is not a server error costs one predicate and zero writes.
 * 3. **Never our own route.** See `RECEIVER_ROUTE_PATH`.
 * 4. **A per-instance budget per window**, with suppression REPORTED. A
 *    monitoring path that hides its own lossiness is the bug shape this repo
 *    keeps rediscovering.
 *
 * ## Where it writes, and why not next door
 *
 * `vercel-runtime`, DELIBERATELY NOT `server-errors`. That log is the
 * `onRequestError` hook's, and the alert policy
 * `projects/aglyn-main/alertPolicies/11610705614308437855` keys on it. A 500
 * our code threw is seen by BOTH arms, so merging the streams would count one
 * incident twice and make triage start by asking which arm saw it. The same
 * separation `client-errors` and `server-errors` already keep, for the same
 * reason.
 *
 * The entries carry a real `httpRequest.status`, which is what makes the
 * policy AGL-1921 originally specified — a log filter on logName matching
 * "vercel" and httpRequest.status at or above 500 — expressible without a
 * log-based metric on a jsonPayload field first.
 */

/**
 * LAZY, and that is load-bearing rather than stylistic (AGL-1921, 2026-08-26).
 *
 * `client-error-report` reaches `firebase-admin`. A static import here would
 * pull the whole SDK into anything that bundles this module — including the
 * Cloud Run receiver, whose entire reason for existing is to run this gate
 * OFF Vercel with nothing but `node:crypto` and a metadata-server token. That
 * receiver always supplies its own {@link DrainIngestOptions.target}, so this
 * path is never reached there and the SDK is never resolved.
 *
 * Called through `defaultLoggingTarget` below, never at module scope.
 */
async function defaultLoggingTarget(): Promise<{
  token: string
  projectId: string
} | null> {
  const { beaconLoggingTarget } = await import('./client-error-report')
  return beaconLoggingTarget()
}

/**
 * The log id the drain writes to. Contains "vercel" on purpose: the alert
 * policy `projects/aglyn-main/alertPolicies/14031689508473384486` matches
 * `logName=~"vercel"`, so the name is load-bearing. Renaming this log without
 * repointing that policy silences the platform-5xx arm.
 */
export const VERCEL_RUNTIME_LOG_ID = 'vercel-runtime'

/** The env var holding the drain's signature secret. Fails closed if unset. */
export const DRAIN_SECRET_ENV = 'VERCEL_LOG_DRAIN_SECRET'

/**
 * The receiver's own path — the FEEDBACK-LOOP GUARD (requirement 5).
 *
 * ⚠️ HISTORICAL, AND KEPT AS DEFENCE IN DEPTH (2026-08-26). The receiver USED
 * to run on `aglyn-console`, whose logs the console drain collects, and the
 * two cuts below were the answer to one receiver 500 draining back in.
 *
 * They were not enough, and the reason is worth stating plainly because the
 * docstring that used to live here got it wrong: **both cuts are about the
 * WRITE, and the cost was the DELIVERY.** Nothing inside a receiver can
 * decline to be requested, and every delivery POST is itself a request that
 * produces a log the same drain then delivers. Measured at 695K invocations
 * in nine hours. Vercel's drain `sampling` rules are not a fix either — a
 * single `{rate: 0}` rule with no path prefix moved delivery volume from 31
 * to 32 per five minutes, i.e. the whole `schemas.log` filter block is stored
 * and never applied.
 *
 * The receiver now lives OFF Vercel, at `cloud/log-drain` on Cloud Run, which
 * no drain watches — so the loop is structurally impossible rather than
 * filtered against. These cuts stay because they cost nothing and they are
 * the backstop if anyone ever mounts this gate on a Vercel route again.
 *
 * Two structural cuts, not one:
 *
 * a. Every entry whose path is this route is dropped before the 5xx filter —
 *    so even the receiver's OWN 500s can never be forwarded, by anything, at
 *    any budget. It is not "we try not to error"; it is that its errors are
 *    unforwardable.
 * b. Every line this module logs about itself is `console.warn`, i.e. Vercel
 *    `level: "warning"`, and the filter forwards only 5xx and `fatal`. A
 *    suppression summary drained back in is therefore dropped a second time,
 *    on a different property, by a different rule.
 *
 * Matched as a PREFIX so `/api/log-drain`, a future `/api/log-drain/test` and
 * the query-bearing `proxy.path` form all fall on the same side of it.
 */
export const RECEIVER_ROUTE_PATH = '/api/log-drain'

/**
 * The lockdown notice route — a route whose 503 is the FEATURE, not a fault.
 *
 * `apps/tenant/app/api/locked/route.ts` answers every request with a real 503
 * carrying `Retry-After`, and the middleware rewrites every path of a locked
 * or bandwidth-capped host to it. That status is deliberate: a takedown
 * notice answering 200 would tell crawlers and uptime checks the site is
 * fine, which is the whole reason the notice is a route handler rather than a
 * page.
 *
 * Forwarded, it is indistinguishable from an outage. One suspended host being
 * crawled emits a 5xx per request, forever, into the arm whose only consumer
 * is an alert policy — so the policy fires on a working feature and the next
 * real incident arrives in a stream that is already red.
 *
 * Matched EXACTLY, not as a prefix: the notice is one path, and a future
 * `/api/locked/*` would be a different route with no such guarantee about its
 * status.
 */
export const LOCKDOWN_NOTICE_ROUTE_PATH = '/api/locked'

/**
 * Per-instance write budget, mirroring `reportServerError`'s (same file
 * neighbourhood, same rationale): the failure being watched is a SPIKE, and a
 * spike is when an unbounded forwarder turns one incident into a second one
 * denominated in dollars. 60 entries a minute per instance is far more than
 * any threshold policy needs to cross — the shape of the spike survives; the
 * bill does not follow it.
 */
const DRAIN_BUDGET_PER_WINDOW = 60
const DRAIN_WINDOW_MS = 60_000
let drainWindowStartedAt = 0
let drainWritten = 0
let drainSuppressed = 0

const MAX_MESSAGE = 1_024
const WRITE_TIMEOUT_MS = 4_000

/** Reset the budget counters. Test seam only — never called in production. */
export function resetDrainBudgetForTests(): void {
  drainWindowStartedAt = 0
  drainWritten = 0
  drainSuppressed = 0
}

/**
 * One log entry as a Vercel drain delivers it. Only the fields this receiver
 * reads are named; the wire object carries many more (client IP, user agent,
 * referer, the query-bearing `proxy.path`) which are deliberately NOT in this
 * type, because a field that has no name here cannot be forwarded by accident.
 */
export interface VercelDrainEntry {
  id?: string
  deploymentId?: string
  projectId?: string
  projectName?: string
  source?: string
  host?: string
  timestamp?: number
  level?: string
  type?: string
  message?: string
  path?: string
  entrypoint?: string
  requestId?: string
  statusCode?: number
  environment?: string
  executionRegion?: string
  proxy?: {
    method?: string
    statusCode?: number
    path?: string
    pathType?: string
  }
}

function clampString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/**
 * The entries in one delivery, in either format Vercel will send.
 *
 * `json` delivers an array (and, per the reference's own example, sometimes a
 * newline-separated sequence of objects); `ndjson` delivers one object per
 * line. Parsing both means the drain's `deliveryFormat` can be changed in the
 * dashboard without a deploy, and a malformed line is skipped rather than
 * failing the whole delivery — Vercel disables a drain that errors too often,
 * so a receiver that 500s on one bad line silences itself.
 */
export function parseDrainPayload(rawBody: string): VercelDrainEntry[] {
  const body = rawBody.trim()
  if (!body) return []
  try {
    const parsed: unknown = JSON.parse(body)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is VercelDrainEntry =>
          Boolean(entry) && typeof entry === 'object',
      )
    }
    if (parsed && typeof parsed === 'object')
      return [parsed as VercelDrainEntry]
  } catch {
    // Not a single JSON document — fall through to line-by-line.
  }
  const entries: VercelDrainEntry[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        entries.push(parsed as VercelDrainEntry)
      }
    } catch {
      // One unreadable line never fails a delivery.
    }
  }
  return entries
}

/** Does this entry describe the receiver's own route? See RECEIVER_ROUTE_PATH. */
export function isReceiverEntry(entry: VercelDrainEntry): boolean {
  const paths = [entry.path, entry.proxy?.path]
  return paths.some((path) => {
    if (typeof path !== 'string') return false
    // `proxy.path` carries the query string; compare the path part only.
    const [pathname] = path.split('?')
    return (
      pathname === RECEIVER_ROUTE_PATH ||
      pathname.startsWith(`${RECEIVER_ROUTE_PATH}/`)
    )
  })
}

/**
 * Is this the lockdown notice serving its deliberate 503? See
 * {@link LOCKDOWN_NOTICE_ROUTE_PATH}.
 *
 * Narrow on purpose — the route being exempt must not make the route
 * unwatchable. Only a clean 503 is excused: a 500 the handler threw, the
 * `statusCode -1` of a crashed lambda, and a `fatal` line all still forward,
 * because those say the notice itself is broken and a locked host is then
 * serving nothing at all.
 */
export function isLockdownNoticeEntry(entry: VercelDrainEntry): boolean {
  if (entry.level === 'fatal' || entry.type === 'fatal') return false
  const statuses = [entry.statusCode, entry.proxy?.statusCode].filter(
    (status): status is number => typeof status === 'number',
  )
  if (!statuses.length || statuses.some((status) => status !== 503)) return false
  return [entry.path, entry.proxy?.path].some((path) => {
    if (typeof path !== 'string') return false
    // `proxy.path` carries the query string; compare the path part only.
    const [pathname] = path.split('?')
    return pathname === LOCKDOWN_NOTICE_ROUTE_PATH
  })
}

/**
 * THE COST GATE (requirement 3). Everything false here is dropped unwritten.
 *
 * What counts as a server error:
 *
 * - `statusCode >= 500` or `proxy.statusCode >= 500` — the platform 5xx this
 *   whole arm exists for, including the ones our code never saw.
 * - `statusCode === -1` — documented as "no response returned and the lambda
 *   crashed". The OOM/hard-crash case, and the single most important entry
 *   shape the `onRequestError` hook is structurally unable to produce.
 * - `level === 'fatal'` or `type === 'fatal'` — the edge-runtime and
 *   process-death shape, which may carry no status at all.
 *
 * What deliberately does NOT count:
 *
 * - `level === 'error'`. That is any `console.error`, including the fail-soft
 *   warn/error lines the beacons themselves write, and forwarding it would
 *   mean paying per line for a stream the `onRequestError` hook already
 *   covers properly. If an errored request matters, it has a status.
 * - `proxy.statusCode === -1`. Same sentinel, opposite meaning: on the proxy
 *   object it documents a BACKGROUND REVALIDATION, which is a healthy ISR
 *   refresh. Reading it as a crash would forward a steady trickle of normal
 *   traffic forever — the exact bill this gate exists to prevent.
 */
export function isServerErrorEntry(entry: VercelDrainEntry): boolean {
  if (typeof entry.statusCode === 'number') {
    if (entry.statusCode >= 500) return true
    if (entry.statusCode === -1) return true
  }
  const proxyStatus = entry.proxy?.statusCode
  if (typeof proxyStatus === 'number' && proxyStatus >= 500) return true
  if (entry.level === 'fatal' || entry.type === 'fatal') return true
  return false
}

/**
 * Everything above, in the order the cost argument requires.
 * Exported so the tests can assert the gate without a transport.
 */
export function selectForwardableEntries(
  entries: readonly VercelDrainEntry[],
): VercelDrainEntry[] {
  return entries.filter(
    (entry) =>
      !isReceiverEntry(entry) &&
      !isLockdownNoticeEntry(entry) &&
      isServerErrorEntry(entry),
  )
}

/**
 * One Cloud Logging entry, carrying ONLY fields that are already inside the
 * envelope the shipped beacons send (requirement 8).
 *
 * Explicitly absent, and each for a reason:
 * `proxy.path` (query string — the AGL-1538 boundary is origin+pathname and
 * this is the same boundary), `proxy.clientIp` and `proxy.userAgent` and
 * `proxy.referer` (visitor identity; also why Vercel's own IP-visibility
 * toggle exists), request or response bodies (never delivered, never wanted).
 * `path` IS forwarded because Vercel documents it as the function or dynamic
 * path — the route PATTERN, which is what you group and alert on anyway, and
 * exactly what `reportServerError` already sends as `route`.
 */
function toLogEntry(entry: VercelDrainEntry): Record<string, unknown> {
  const status =
    typeof entry.statusCode === 'number' && entry.statusCode >= 0
      ? entry.statusCode
      : typeof entry.proxy?.statusCode === 'number' &&
          entry.proxy.statusCode >= 0
        ? entry.proxy.statusCode
        : undefined
  return {
    severity: 'ERROR',
    // The structured field the AGL-1921 policy matches on. A jsonPayload key
    // would need a log-based metric first; this one is queryable as shipped.
    httpRequest: {
      requestMethod: clampString(entry.proxy?.method, 16) || undefined,
      status,
    },
    jsonPayload: {
      // No ReportedErrorEvent `@type`: these are NOT ingested into Error
      // Reporting. A function timeout has no stack, would group as one giant
      // bucket, and would drown the real grouped errors the hook reports.
      source: clampString(entry.source, 32) || undefined,
      level: clampString(entry.level, 16) || undefined,
      type: clampString(entry.type, 32) || undefined,
      route: clampString(entry.path, 512) || undefined,
      entrypoint: clampString(entry.entrypoint, 256) || undefined,
      host: clampString(entry.host, 256) || undefined,
      environment: clampString(entry.environment, 32) || undefined,
      region: clampString(entry.executionRegion, 32) || undefined,
      project: clampString(entry.projectName, 64) || undefined,
      projectId: clampString(entry.projectId, 64) || undefined,
      deploymentId: clampString(entry.deploymentId, 64) || undefined,
      requestId: clampString(entry.requestId, 64) || undefined,
      logId: clampString(entry.id, 64) || undefined,
      statusCode:
        typeof entry.statusCode === 'number' ? entry.statusCode : undefined,
      proxyStatusCode:
        typeof entry.proxy?.statusCode === 'number'
          ? entry.proxy.statusCode
          : undefined,
      // Clamped like the beacon's own message. This is where "Task timed out
      // after 10.01 seconds" lives, which is the whole triage value of the
      // platform-5xx case.
      message: clampString(entry.message, MAX_MESSAGE) || undefined,
    },
  }
}

/** What one delivery did, for the response body, the tests and the caller. */
export interface DrainIngestResult {
  /** Entries in the delivery. */
  received: number
  /** Entries that passed the receiver-path and 5xx gates. */
  matched: number
  /** Entries actually written to Cloud Logging. */
  forwarded: number
  /** Entries dropped by the per-window budget — REPORTED, never silent. */
  suppressed: number
  /** Set when nothing could be written at all; a stable code, never a message. */
  code?: 'no-credential' | 'transport' | `http-${number}`
}

/**
 * Where the write goes, and under whose credential.
 *
 * Injectable because the receiver has to be able to run somewhere that is NOT
 * a Vercel project this drain watches — a delivery POST is a request to
 * whatever hosts it, and a request produces a log the same drain then
 * delivers, which is the AGL-1921 feedback loop. Vercel's drain `sampling`
 * rules look like the answer and are NOT: measured 2026-08-26, a single
 * `{rate: 0}` rule with no path prefix — literally "drop everything" — changed
 * delivery volume from 31 to 32 per five minutes. The whole `schemas.log`
 * filter block is accepted by the API, echoed back on `GET`, and never
 * applied. Separation is the only control that works.
 *
 * The default keeps every existing caller on the Firebase admin credential.
 * A receiver hosted off Vercel (Cloud Run in `aglyn-main`) passes its own
 * resolver instead and never imports `firebase-admin` at all, which is what
 * lets this module be bundled for it without dragging the SDK along.
 */
export interface DrainIngestOptions {
  /**
   * Resolve the Cloud Logging bearer token and project. Returning `null`
   * means "no credential" and the delivery is dropped, reported, and answered
   * 200 — never an error, because Vercel disables a drain whose endpoint
   * fails often enough.
   */
  target?: () => Promise<{ token: string; projectId: string } | null>
}

/**
 * Ingest ONE verified delivery: filter, budget, then a single batched write.
 *
 * Never throws. Vercel disables a drain whose endpoint fails often enough, so
 * a receiver that propagated a Logging outage would end by turning itself off
 * during the incident it exists to report.
 */
export async function ingestDrainDelivery(
  entries: readonly VercelDrainEntry[],
  options?: DrainIngestOptions,
): Promise<DrainIngestResult> {
  const received = entries.length
  const matched = selectForwardableEntries(entries)
  const result: DrainIngestResult = {
    received,
    matched: matched.length,
    forwarded: 0,
    suppressed: 0,
  }
  if (!matched.length) return result

  const now = Date.now()
  if (now - drainWindowStartedAt >= DRAIN_WINDOW_MS) {
    if (drainSuppressed > 0) {
      // ⚠️ The lossiness is REPORTED. `level: "warning"`, so guard (b) in
      // RECEIVER_ROUTE_PATH keeps this line from ever draining back in.
      console.warn(
        JSON.stringify({
          tag: 'AGL-1921:vercel-log-drain',
          suppressed: drainSuppressed,
          written: drainWritten,
          windowMs: DRAIN_WINDOW_MS,
        }),
      )
    }
    drainWindowStartedAt = now
    drainWritten = 0
    drainSuppressed = 0
  }

  const room = Math.max(0, DRAIN_BUDGET_PER_WINDOW - drainWritten)
  const writable = matched.slice(0, room)
  const suppressed = matched.length - writable.length
  if (suppressed > 0) drainSuppressed += suppressed
  result.suppressed = suppressed
  if (!writable.length) return result

  const target = await (options?.target ?? defaultLoggingTarget)()
  if (!target) {
    console.warn(
      JSON.stringify({
        tag: 'AGL-1921:vercel-log-drain',
        drop: writable.length,
        reason: 'no-credential',
      }),
    )
    result.code = 'no-credential'
    return result
  }

  try {
    const response = await fetch(
      'https://logging.googleapis.com/v2/entries:write',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          logName: `projects/${target.projectId}/logs/${VERCEL_RUNTIME_LOG_ID}`,
          resource: { type: 'global' },
          entries: writable.map(toLogEntry),
        }),
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      },
    )
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          tag: 'AGL-1921:vercel-log-drain',
          status: response.status,
          drop: writable.length,
        }),
      )
      result.code = `http-${response.status}`
      return result
    }
    drainWritten += writable.length
    result.forwarded = writable.length
    return result
  } catch (error) {
    console.warn(
      JSON.stringify({
        tag: 'AGL-1921:vercel-log-drain',
        transport: String(error).slice(0, 200),
      }),
    )
    result.code = 'transport'
    return result
  }
}
