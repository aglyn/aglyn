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
 * Server half of the first-party error beacon (AGL-1538): validates a
 * browser-posted batch of uncaught errors and forwards each to Google Cloud
 * Error Reporting, where grouping, retention, and the alerting policy live.
 *
 * Why Error Reporting rather than a vendor: Google is already a subprocessor
 * and the GCP monitoring/alerting stack already pages (AGL-1502) — a Sentry
 * would add a subprocessor and a DPA line item, which is a deliberately
 * deferred decision. Why a route in between rather than client-direct: the
 * API needs OAuth, and the route is also where the payload is disarmed —
 * clamped, capped, and stripped before anything leaves our origin.
 *
 * The caller is an unauthenticated browser, so every parsed field is clamped
 * here AGAIN regardless of what the client-side scrubber promised — the
 * beacon script is a promise, this is the boundary.
 *
 * Fail-soft throughout: a reporting failure logs one line and returns.
 * The one thing this module must never do is turn an observed error into a
 * served one.
 */

import { getApp } from 'firebase-admin/app'
// Side-effect import: initializes the firebase-admin default app (cert
// credential) exactly the way firebase-admin.ts does, so `getApp()` below
// always finds it and its credential can mint the OAuth token.
import '@aglyn/shared-util-fbserver'

const MAX_EVENTS_PER_REQUEST = 10
const MAX_MESSAGE = 1_024
const MAX_STACK = 8_192
const MAX_URL = 512
const REPORT_TIMEOUT_MS = 4_000

export interface ClientErrorEvent {
  kind: string
  message: string
  stack?: string
  source?: string
  line?: number
  url?: string
}

function clampString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/** Origin + pathname only, server-enforced — never trust the client scrub. */
function scrubUrl(value: unknown): string {
  const raw = clampString(value, MAX_URL)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

/**
 * The events in a posted payload, clamped and capped. Anything malformed is
 * simply dropped — this endpoint never argues with a browser.
 */
export function parseClientErrorEvents(payload: unknown): ClientErrorEvent[] {
  const events = (payload as { events?: unknown })?.events
  if (!Array.isArray(events)) return []
  const parsed: ClientErrorEvent[] = []
  for (const entry of events.slice(0, MAX_EVENTS_PER_REQUEST)) {
    if (!entry || typeof entry !== 'object') continue
    const event = entry as Record<string, unknown>
    const message = clampString(event.message, MAX_MESSAGE)
    if (!message) continue
    parsed.push({
      kind: clampString(event.kind, 32) || 'error',
      message,
      stack: clampString(event.stack, MAX_STACK) || undefined,
      source: scrubUrl(event.source) || undefined,
      line: typeof event.line === 'number' ? Math.trunc(event.line) : undefined,
      url: scrubUrl(event.url) || undefined,
    })
  }
  return parsed
}

/**
 * Error Reporting groups by parsing the `message` as a stack trace; an event
 * WITHOUT a stack must carry `context.reportLocation` instead or ingestion
 * drops it. Both shapes are built here so every accepted beacon event is
 * representable.
 */
function toReportedEvent(
  event: ClientErrorEvent,
  service: string,
  version: string | undefined,
): Record<string, unknown> {
  const hasStack = Boolean(event.stack?.includes('\n'))
  return {
    '@type':
      'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
    serviceContext: { service, version },
    message: hasStack ? event.stack : `${event.kind}: ${event.message}`,
    context: {
      httpRequest: event.url ? { url: event.url } : undefined,
      ...(hasStack
        ? {}
        : {
            reportLocation: {
              filePath: event.source || 'unknown',
              lineNumber: event.line ?? 0,
              functionName: event.kind,
            },
          }),
    },
  }
}

/** The log the beacon writes; the alert policy and any triage query key on it. */
export const CLIENT_ERROR_LOG_ID = 'client-errors'

/**
 * The admin credential and project the beacon writes under.
 *
 * Extracted (AGL-1923) so the heartbeat below mints its token through the
 * SAME path the reporter does. That sharing is the whole value of the
 * heartbeat: the failures it exists to catch — an expired service-account
 * key, a revoked `logging.logEntries.create`, an exhausted Logging quota —
 * are environmental, and a heartbeat that acquired its credential some other
 * way could report healthy while every real report was being dropped.
 *
 * Returns null when either half is missing; the caller decides what that
 * means (the reporter drops the batch, the heartbeat reports degraded).
 */
async function beaconLoggingTarget(): Promise<{
  token: string
  projectId: string
} | null> {
  let token: string | undefined
  let projectId: string | undefined
  try {
    const app = getApp()
    projectId = (app.options.projectId ??
      process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']) as string | undefined
    token = (await app.options.credential?.getAccessToken())?.access_token
  } catch {
    token = undefined
  }
  if (!token || !projectId) return null
  return { token, projectId }
}

/**
 * Forwards events under the admin service account — via Cloud LOGGING, not
 * the Error Reporting `events:report` API, and the transport is the point:
 * a log entry whose payload carries the `ReportedErrorEvent` `@type` is
 * ingested by Error Reporting automatically (grouping, the Error Reporting
 * console, version tracking), while ALSO being a real log entry that a
 * Cloud Monitoring log-match alert policy can page on — `events:report`
 * produces no log entry and nothing standard to alert from. One batched
 * write per request instead of one call per event is the bonus.
 *
 * Returns how many events were written; failures are logged (one line) and
 * swallowed.
 */
export async function reportClientErrors(
  events: readonly ClientErrorEvent[],
  options: { service: string },
): Promise<number> {
  if (!events.length) return 0
  const target = await beaconLoggingTarget()
  const token = target?.token
  const projectId = target?.projectId
  if (!token || !projectId) {
    console.warn(
      JSON.stringify({ tag: 'AGL-1538:error-beacon', drop: events.length, reason: 'no-credential' }),
    )
    return 0
  }
  const version = process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7)
  try {
    const response = await fetch('https://logging.googleapis.com/v2/entries:write', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        logName: `projects/${projectId}/logs/${CLIENT_ERROR_LOG_ID}`,
        resource: { type: 'global' },
        entries: events.map((event) => ({
          severity: 'ERROR',
          jsonPayload: toReportedEvent(event, options.service, version),
        })),
      }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          tag: 'AGL-1538:error-beacon',
          status: response.status,
          drop: events.length,
        }),
      )
      return 0
    }
    return events.length
  } catch (error) {
    console.warn(
      JSON.stringify({
        tag: 'AGL-1538:error-beacon',
        transport: String(error).slice(0, 200),
      }),
    )
    return 0
  }
}

/**
 * The log the SERVER half writes to (AGL-1921).
 *
 * DELIBERATELY NOT `client-errors`. The `Client error beacon` policy is a
 * log-match on that log id, and a server 5xx is a different incident with a
 * different first move — a browser error is one visitor's broken render, a
 * 500 rate is every visitor's. Merging the streams would make the existing
 * policy fire for both and force triage to start by asking which it was.
 * A sibling log id also lets the counter this whole issue is about key on
 * server errors ALONE.
 */
export const SERVER_ERROR_LOG_ID = 'server-errors'

/**
 * One server-side error, as `onRequestError` sees it.
 *
 * `route` is the route PATTERN (`/[host]/[[...slug]]`), never the resolved
 * path: the resolved path carries org slugs, document ids and whatever a
 * visitor typed into a URL, and this payload leaves our origin for a Google
 * log. The pattern is what you group and alert on anyway.
 */
export interface ServerErrorEvent {
  message: string
  stack?: string
  route?: string
  method?: string
  routeType?: string
  digest?: string
}

/**
 * Per-instance write budget (AGL-1921).
 *
 * The failure this exists to observe is a SPIKE, and a spike is exactly when
 * an unbounded reporter turns one incident into two — a 500 on a hot path
 * can run at request rate, and every entry is a billable Logging write on an
 * account whose whole monitoring budget is $20/month. The budget is per
 * instance and per minute, so the shape of the spike still reaches Logging
 * (the counter only needs to cross a threshold, not be exact) while the cost
 * stays bounded no matter how hard the incident pushes.
 *
 * Suppression is REPORTED, never silent: when the window rolls over, one
 * summary line records how many were dropped. A monitoring path that hides
 * its own lossiness is the thing this repo keeps finding.
 */
const SERVER_ERROR_BUDGET_PER_WINDOW = 60
const SERVER_ERROR_WINDOW_MS = 60_000
let serverErrorWindowStartedAt = 0
let serverErrorsWritten = 0
let serverErrorsSuppressed = 0

/** What happened to one `reportServerError` call, for tests and callers. */
export type ServerErrorOutcome = 'written' | 'suppressed' | 'dropped'

/**
 * Forwards ONE server-side error to Cloud Logging under the admin credential.
 *
 * This is AGL-1921's fallback arm, and it is a fallback on purpose: it cannot
 * see an error that kills the process before the handler runs, nor a
 * platform-level 5xx that never reaches our code at all. A Vercel log drain
 * would see both. What this does buy is the case that matters most and is
 * most likely — our own route handlers and renders throwing — reported
 * through a transport that already works, on an account we already pay for.
 * `docs/UPTIME_AND_SLA.md` carries the blind spots in writing, because
 * partial visibility whose gaps are documented beats none.
 *
 * It shares `beaconLoggingTarget` with the client reporter deliberately: that
 * makes AGL-1923's heartbeat a dead-man's switch for THIS path too. The
 * failures that would silence server-error reporting — expired key, revoked
 * `logging.logEntries.create`, exhausted quota — are the same environmental
 * ones the heartbeat already probes, and it probes them through this exact
 * credential.
 *
 * Fail-soft and never throws: this runs inside `onRequestError`, so throwing
 * here would turn an observed error into a second one during an incident.
 */
export async function reportServerError(
  event: ServerErrorEvent,
  options: { service: string },
): Promise<ServerErrorOutcome> {
  const message = clampString(event.message, MAX_MESSAGE)
  if (!message) return 'dropped'

  const now = Date.now()
  if (now - serverErrorWindowStartedAt >= SERVER_ERROR_WINDOW_MS) {
    if (serverErrorsSuppressed > 0) {
      console.warn(
        JSON.stringify({
          tag: 'AGL-1921:server-error-beacon',
          suppressed: serverErrorsSuppressed,
          written: serverErrorsWritten,
          windowMs: SERVER_ERROR_WINDOW_MS,
        }),
      )
    }
    serverErrorWindowStartedAt = now
    serverErrorsWritten = 0
    serverErrorsSuppressed = 0
  }
  if (serverErrorsWritten >= SERVER_ERROR_BUDGET_PER_WINDOW) {
    serverErrorsSuppressed += 1
    return 'suppressed'
  }

  const target = await beaconLoggingTarget()
  if (!target) {
    console.warn(
      JSON.stringify({ tag: 'AGL-1921:server-error-beacon', drop: 1, reason: 'no-credential' }),
    )
    return 'dropped'
  }

  const stack = clampString(event.stack, MAX_STACK)
  const hasStack = stack.includes('\n')
  const version = process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7)
  try {
    const response = await fetch('https://logging.googleapis.com/v2/entries:write', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        logName: `projects/${target.projectId}/logs/${SERVER_ERROR_LOG_ID}`,
        resource: { type: 'global' },
        entries: [
          {
            severity: 'ERROR',
            jsonPayload: {
              '@type':
                'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
              serviceContext: { service: options.service, version },
              // Same rule as the client half: Error Reporting groups by
              // parsing `message` as a stack trace, and an event without one
              // must carry `context.reportLocation` or ingestion drops it.
              message: hasStack ? stack : message,
              context: {
                ...(hasStack
                  ? {}
                  : {
                      reportLocation: {
                        filePath: clampString(event.route, MAX_URL) || 'unknown',
                        lineNumber: 0,
                        functionName: clampString(event.routeType, 32) || 'server',
                      },
                    }),
              },
              // Outside `serviceContext` so Error Reporting ignores them and
              // a log-match policy can still filter on them.
              route: clampString(event.route, MAX_URL) || undefined,
              method: clampString(event.method, 16) || undefined,
              digest: clampString(event.digest, 64) || undefined,
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          tag: 'AGL-1921:server-error-beacon',
          status: response.status,
          drop: 1,
        }),
      )
      return 'dropped'
    }
    serverErrorsWritten += 1
    return 'written'
  } catch (error) {
    console.warn(
      JSON.stringify({
        tag: 'AGL-1921:server-error-beacon',
        transport: String(error).slice(0, 200),
      }),
    )
    return 'dropped'
  }
}

/**
 * The log the beacon's heartbeat is written to (AGL-1923).
 *
 * DELIBERATELY NOT `client-errors`. The `Client error beacon` alert policy is
 * a log-match on `logName="…/client-errors" AND severity>=ERROR`, so a
 * heartbeat written there would page Zach on every probe — building the
 * alert-fatigue mechanism the heartbeat exists to protect against. A separate
 * log id at INFO keeps the two streams from ever being confused, and keeps
 * the payload out of Error Reporting (which ingests on the
 * `ReportedErrorEvent` `@type`, absent here on purpose).
 */
export const BEACON_HEARTBEAT_LOG_ID = 'client-error-beacon-heartbeat'

/** What a heartbeat attempt proved, for the health verdict to reduce. */
export interface BeaconHeartbeatResult {
  /** Did the entry actually reach Cloud Logging? */
  ok: boolean
  /** A stable code on failure — never a raw error message. */
  code?: string
}

/**
 * Write one heartbeat entry through the beacon's own transport (AGL-1923).
 *
 * ## Why this exists
 *
 * `reportClientErrors` is fail-soft by design and must stay that way — it may
 * never turn an observed error into a served one. But every one of its
 * failure paths ends in a `console.warn` to the Vercel runtime log, which
 * retains about an hour and drains nowhere (AGL-1799). So the beacon can fail
 * completely and the only readings anyone has are "Error Reporting shows zero
 * errors" and "the log-match policy is silent" — which are exactly the
 * readings a clean launch produces. **A dead beacon is indistinguishable from
 * zero errors.**
 *
 * A log-match policy can only ever report presence. The fix is a signal whose
 * ABSENCE is detectable, and the cheapest one that needs no new vendor is a
 * write that a health endpoint can grade synchronously: this returns whether
 * the write landed, `/api/health/error-beacon` turns that into the 200/503
 * contract the sibling health checks already speak, and the existing uptime
 * check + alert + email path becomes the listener. The uptime probe is what
 * winds the dead-man's switch, so there is no cron to forget.
 *
 * ## What it can and cannot prove
 *
 * It proves the credential mints, the IAM grant still covers
 * `logging.logEntries.create`, the Logging API answers, and the quota is not
 * exhausted — the whole environmental failure class AGL-1923 names. It does
 * NOT prove a browser can reach `/api/errors`, and it does not prove the
 * payload shape Error Reporting ingests on, because it deliberately does not
 * write that shape.
 *
 * ## Clearing
 *
 * The condition it raises is an EVENT, not a state: the next successful write
 * clears it, within one probe TTL. Nothing here can latch (AGL-1843).
 *
 * Never throws. A heartbeat that could 500 a health endpoint would be a
 * monitoring probe that causes the outage it reports.
 */
export async function writeBeaconHeartbeat(options: {
  service: string
}): Promise<BeaconHeartbeatResult> {
  const target = await beaconLoggingTarget()
  if (!target) return { ok: false, code: 'no-credential' }
  try {
    const response = await fetch('https://logging.googleapis.com/v2/entries:write', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        logName: `projects/${target.projectId}/logs/${BEACON_HEARTBEAT_LOG_ID}`,
        resource: { type: 'global' },
        entries: [
          {
            severity: 'INFO',
            jsonPayload: {
              // No `@type`: this must not be ingested by Error Reporting.
              tag: 'AGL-1923:beacon-heartbeat',
              service: options.service,
              version: process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null,
              environment: process.env['VERCEL_ENV'] ?? 'development',
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    })
    // The STATUS only. The health body is public and a Google error message
    // can carry project ids and resource paths — the same rule the backups
    // probe follows.
    return response.ok ? { ok: true } : { ok: false, code: `http-${response.status}` }
  } catch (error) {
    // Codes, not messages: `TimeoutError` for the 4s abort, whatever the
    // fetch layer names for a transport failure.
    return {
      ok: false,
      code: `transport-${String((error as { name?: string })?.name ?? 'unknown')}`,
    }
  }
}
