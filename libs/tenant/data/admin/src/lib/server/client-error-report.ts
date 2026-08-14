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
