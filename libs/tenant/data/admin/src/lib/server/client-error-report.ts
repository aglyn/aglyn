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
