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
// The readable half of the server-error signal (AGL-1921) — see the block
// comment in `reportServerError`.
import {
  beaconHealth,
  deploymentCommitRef,
  deploymentEnvironmentLabel,
  isDeployedRuntime,
  isTransientBeaconCode,
  type BeaconCheck,
} from '@aglyn/aglyn/server'
// The scheme list the beacon and the CSP collector share (AGL-2786). A
// subpath, not the `/server` barrel: specs that stub that barrel with a
// hand-built factory would silently turn this into `undefined`.
import { isForeignScriptStack } from '@aglyn/aglyn/app-utils/foreign-script'

import {
  readBeaconHeartbeat,
  recordBeaconHeartbeat,
  recordServerError,
} from './rate-limit-store'

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
 * Was this stack thrown with no code of ours on it, and was all of it seen?
 *
 * Every frame under a scheme no deployment of ours serves (AGL-2786) — an
 * in-app webview's bridge, an extension's content script. The beacon drops
 * these before sending; this is the half that also covers a bundle already
 * cached in a visitor's tab, which keeps posting whatever its copy of the rule
 * missed for as long as the tab lives.
 *
 * Only a stack that arrived WHOLE is judged. One at the clamp may be the head
 * of a longer stack, and the tail it lost could hold the frame that makes the
 * error ours.
 *
 * The beacon's other tell — every frame is the document — is deliberately not
 * applied here. This side has no page to compare against, and our own inline
 * code's handled errors carry the document's URL too.
 */
function isForeignOnlyStack(stack: string): boolean {
  return stack.length > 0 && stack.length < MAX_STACK && isForeignScriptStack(stack)
}

/**
 * The events in a posted payload, clamped and capped. Anything malformed is
 * simply dropped — this endpoint never argues with a browser — and so is an
 * error none of our code threw (see {@link isForeignOnlyStack}).
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
    const stack = clampString(event.stack, MAX_STACK)
    if (isForeignOnlyStack(stack)) continue
    parsed.push({
      kind: clampString(event.kind, 32) || 'error',
      message,
      stack: stack || undefined,
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
    // Outside `serviceContext` so Error Reporting ignores it while a log-match
    // policy can still filter on it — the same placement, for the same reason,
    // that the server half gives `route`/`method`/`digest`.
    //
    // Until AGL-2523 the kind reached the payload ONLY on the stackless path,
    // folded into `message` and `reportLocation.functionName`. Every stacked
    // error — which is nearly all of them — arrived unclassifiable, so the
    // `Client error beacon` policy had no way to express anything narrower
    // than "any entry at all". That is why it pages for one visitor whose
    // webview rewrote the DOM.
    kind: clampString(event.kind, 32) || 'error',
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
 *
 * EXPORTED for the Vercel log-drain receiver (AGL-1921, third arm), which
 * writes to `vercel-runtime` through this same credential for the same
 * reason the heartbeat does: the failures that would silence the drain are
 * the environmental ones AGL-1923's heartbeat already probes, and it probes
 * them through exactly this path. A receiver that minted its own token would
 * need its own dead-man's switch.
 */
export async function beaconLoggingTarget(): Promise<{
  token: string
  projectId: string
} | null> {
  return (await resolveBeaconLoggingTarget()).target
}

/** The credential, plus WHY there isn't one when there isn't. */
export interface BeaconTargetResolution {
  target: { token: string; projectId: string } | null
  /** Set only when `target` is null. */
  code?: 'no-credential' | 'credential-unavailable'
}

/**
 * The same resolution, saying which of two very different things went wrong
 * (AGL-2713).
 *
 * `no-credential` used to cover both, and the collapse is what made
 * `/api/health/error-beacon` cry wolf: one of the two is permanent and one is
 * a cold lambda's first outbound connection.
 *
 * - **`no-credential`** — there is no admin app, or it has no project, or it
 *   has no credential object. `initializeApp` runs at module load and is
 *   guarded on `FIREBASE_PRIVATE_KEY` + `FIREBASE_CLIENT_EMAIL` +
 *   `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, so this is a STATIC fact about the
 *   deployment's environment: it cannot heal on the next request, and every
 *   browser error is being dropped for as long as it holds. Red immediately —
 *   which is exactly what the remedy text on the staff board already says
 *   (`no-credential` is the deployment `FIREBASE_*` env).
 * - **`credential-unavailable`** — the app and the certificate are both there
 *   and `getAccessToken()` did not produce a token on THIS attempt. That is a
 *   JWT-bearer exchange against `oauth2.googleapis.com`, and on a cold
 *   instance it is the first outbound TLS handshake the sandbox has ever made.
 *   Nothing was decided, so nothing about the beacon has been established.
 */
export async function resolveBeaconLoggingTarget(): Promise<BeaconTargetResolution> {
  let app
  try {
    app = getApp()
  } catch {
    return { target: null, code: 'no-credential' }
  }
  const projectId = (app.options.projectId ??
    process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']) as string | undefined
  const credential = app.options.credential
  if (!projectId || !credential) return { target: null, code: 'no-credential' }
  let token: string | undefined
  try {
    token = (await credential.getAccessToken())?.access_token
  } catch {
    token = undefined
  }
  if (!token) return { target: null, code: 'credential-unavailable' }
  return { target: { token, projectId } }
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

  /*==========================================
   * A LAPTOP IS NOT A DEPLOYMENT (AGL-1925, option 1).
   *
   * Measured 2026-08-18 over a trailing week of Error Reporting `groupStats`:
   * 13 of 17 events — 76% — were not production, and the single highest-ranked
   * "production error group" in the project was a dev-only artifact with
   * `http://localhost:4200` stack frames. Ranking is the whole point of Error
   * Reporting, so a majority-noise stream does not merely cost storage: it
   * aims triage at the wrong thing, and the `Client error beacon` policy
   * notifies its single human recipient for every uncaught error on any
   * developer's machine.
   *
   * The credential is why localhost reaches production at all: `firebase-admin`
   * is configured from the root `.env`, which names the platform project.
   *
   * Unlike the server half this stream carries NO `environment` stamp — the
   * only marker was `serviceContext.version` being absent off Vercel, which
   * did that job by accident and stopped doing it once `deploymentCommitRef`
   * started resolving a commit for self-hosted builds. So refusing the write
   * is not one of two options here; it is the only one that works at all.
   *
   * `isDeployedRuntime`, matching `reportServerError`: an operator's own
   * container reports its visitors' errors, and a developer's console already
   * shows them the error it would have sent.
   *==========================================*/
  if (!isDeployedRuntime()) return 0

  const target = await beaconLoggingTarget()
  const token = target?.token
  const projectId = target?.projectId
  if (!token || !projectId) {
    console.warn(
      JSON.stringify({ tag: 'AGL-1538:error-beacon', drop: events.length, reason: 'no-credential' }),
    )
    return 0
  }
  /*
   * Which BUILD this report came from, resolved the way `/api/health` resolves
   * it — `BUILD_ID`, then `COMMIT_REF`, then Vercel's own.
   *
   * This read `VERCEL_GIT_COMMIT_SHA` directly, which is set on Aglyn's cloud
   * and nowhere else, so every error a self-hosted deployment reported arrived
   * with no version at all while the health endpoint beside it named the
   * commit correctly. An error report you cannot tie to a build is an error
   * report you cannot act on.
   *
   * `undefined`, not `null`: this becomes Error Reporting's
   * `serviceContext.version`, where an absent key is omitted and an empty one
   * is a version.
   */
  const version = deploymentCommitRef() ?? undefined
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
 * `route` is the route PATTERN (`/[host]/[scheme]/[[...slug]]`), never the resolved
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

  /*==========================================
   * A LAPTOP IS NOT A DEPLOYMENT, AND THIS IS THE ONLY GATE THAT CAN SAY SO.
   *
   * ABOVE the marker below, unlike every other gate here, and the difference
   * is what is being refused. Those gates are about a write that FAILED and
   * must still be counted. This one is about a process that should not be
   * reporting at all: the count is as wrong as the log entry, because
   * `/api/health/server-errors` reads that marker out of the platform project
   * and would answer for a developer's terminal.
   *
   * The credential makes this reachable. `firebase-admin` is configured from
   * the root `.env`, which names the platform project, so `nx dev` writes to
   * production Cloud Logging under the same key production uses. Measured
   * 2026-08-31: three parse errors from an interrupted rebase — carrying
   * `file:///Users/.../aglyn/apps/...` stacks — landed in `server-errors` and
   * opened the `Server errors: uncaught 5xx` policy, which was still open two
   * days later while all thirteen uptime checks read 100%.
   *
   * `environment` was stamped for this (see the field below), but a stamp only
   * helps a reader who filters on it, and the one reader this log can have is
   * a hand-made alert policy that did not. Refusing the write is the half that
   * does not depend on somebody else's configuration.
   *
   * `isDeployedRuntime` and not `isProductionDeployment`, deliberately: a
   * preview's 5xx is a real 5xx served by a real deployment, and the stamp
   * already separates it for anyone who wants to.
   *==========================================*/
  if (!isDeployedRuntime()) return 'dropped'

  /*==========================================
   * COUNT IT WHERE SOMETHING CAN READ THE COUNT (AGL-1921, second pass).
   *
   * FIRST, above every gate below, and that ordering is the whole point.
   *
   * The Logging entry this function goes on to write is the right record for
   * triage and the wrong one for an alarm we can ship: measured 2026-08-24,
   * the production credential is refused `entries:list` on that log with
   * `403 Permission denied for all log views`, so nothing in this repo can
   * read back what it wrote. The only reader the log can ever have is a GCP
   * alert policy somebody creates by hand.
   *
   * The marker is readable today, and putting it above the budget gate, the
   * credential check and the fetch means the count survives every way the
   * Logging arm can fail. That is not tidiness — a beacon whose transport is
   * dead reports ZERO errors, which is the measured-zero shape this repo keeps
   * finding, and it would report it during exactly the incident that killed
   * the transport.
   *
   * Never awaited: this runs inside `onRequestError`, and the marker coalesces
   * in process anyway (at most one write per five seconds per instance).
   *==========================================*/
  recordServerError(options.service)

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
  const version = deploymentCommitRef() ?? undefined
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
              // WHICH DEPLOYMENT THREW, and the log-match policy has no other
              // way to ask. The credential comes from the environment, so a
              // developer serving the console locally against the platform
              // project writes here under the same key as production and
              // lands in the same log — a throw on a laptop is then
              // indistinguishable from a 500 served to a customer. The
              // heartbeat beside this already stamps it for that reason.
              environment: deploymentEnvironmentLabel(),
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
 * heartbeat written there would page the on-call owner on every probe — building the
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
  const { target, code } = await resolveBeaconLoggingTarget()
  if (!target) return { ok: false, code: code ?? 'no-credential' }
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
              version: deploymentCommitRef(),
              environment: deploymentEnvironmentLabel(),
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

/**
 * How long the probe waits before its second attempt (AGL-2713).
 *
 * Long enough for a JWT-bearer exchange that lost its first connection to get
 * another one, short enough that it is invisible next to a probe already
 * budgeted at 4s for the Logging write. It is a delay, not a backoff schedule:
 * a second attempt either establishes something or it does not, and a third
 * would only spend a public endpoint's time proving the same point.
 */
export const BEACON_HEARTBEAT_RETRY_DELAY_MS = 250

/**
 * How long a missed heartbeat is forgiven after the last one that landed.
 *
 * One monitor interval. The uptime workflow reads this door every 15 minutes,
 * so a grace of exactly that means the FIRST probe after a miss can be
 * forgiven and the second cannot — "tolerate a single miss, red on a
 * sustained one", stated in the only unit the reader actually samples in.
 *
 * The bound this puts on a real outage: the marker is refreshed by every
 * successful probe, and this endpoint is polled every 5 minutes, so the last
 * landing is at most one probe TTL old when a sustained failure starts. Worst
 * case the door reds 20 minutes later than it does today, and the 15-minute
 * workflow sees it on its next run.
 */
export const BEACON_HEARTBEAT_GRACE_MS = 15 * 60_000

/** Injectable clock, sleep, writer and store, so a spec can drive every branch. */
export interface BeaconHeartbeatProbeOptions {
  service: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  firestore?: any
  graceMs?: number
  retryDelayMs?: number
  /**
   * The heartbeat writer. Defaults to the real one, and exists as a seam
   * because the belt below catches a contract `writeBeaconHeartbeat` is
   * documented never to break — a branch that is otherwise unreachable, and
   * therefore one nobody has ever watched work.
   */
  write?: (options: { service: string }) => Promise<BeaconHeartbeatResult>
}

/**
 * One heartbeat probe, graded — the whole of what both doors do (AGL-2713).
 *
 * ## Why this is one function and not two copies
 *
 * `apps/console` and `apps/tenant` each own a copy of
 * `/api/health/error-beacon`, and they must: the deployments carry different
 * admin credentials, so a console heartbeat proves nothing about the tenant
 * one. What they do NOT need is two copies of the policy. Before this the two
 * route files were byte-identical apart from a service name, which is the
 * arrangement that guarantees a fix reaches one door and not the other. The
 * per-deployment part (which credential, which service name, which memo) stays
 * in the routes; the grading lives here, once.
 *
 * ## The sequence, and why each step is where it is
 *
 * 1. Write. If it lands, record the durable marker and report green — the
 *    marker being the evidence a LATER miss will be forgiven with.
 * 2. If it did not land and the code is a refusal — `http-401`/`http-403`
 *    (a lost `logging.logEntries.create` grant), `http-429` (quota),
 *    `no-credential` (the deployment env) — report red NOW, with no retry and
 *    no grace. Those are permanent until a person acts, and re-asking a
 *    credential that has been revoked only delays the page.
 * 3. Otherwise nothing was decided, so ask once more after a short delay. On a
 *    cold lambda this is the step that actually fixes the measured incident:
 *    the memo is per-instance, so a fresh instance has no history to be
 *    forgiving WITH, and the only tolerance available inside the request is
 *    another attempt.
 * 4. If the second attempt misses too, forgive only against the durable
 *    marker — see {@link beaconHealth}, which will not forgive without proof.
 *
 * `attempts` and `ms` ride in the body on every outcome, including green ones,
 * because a retry that is quietly always needed is a credential on its way out
 * and a door that hid it would be back where it started.
 */
export async function beaconHeartbeatProbe(
  options: BeaconHeartbeatProbeOptions,
): Promise<BeaconCheck> {
  const clock = options.now ?? Date.now
  const pause =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const graceMs = options.graceMs ?? BEACON_HEARTBEAT_GRACE_MS
  const startedAt = clock()
  const service = options.service

  const write = options.write ?? writeBeaconHeartbeat

  const attempt = async (): Promise<BeaconHeartbeatResult | null> => {
    try {
      return await write({ service })
    } catch {
      // `writeBeaconHeartbeat` is documented never to throw; this is the belt
      // that keeps a monitoring probe from ever being the outage it reports.
      // A null result is degraded by contract — "we could not determine
      // whether the beacon works" IS the condition this endpoint exists to
      // catch, and unlike a missed write it is a broken contract rather than
      // a quiet network, so it is never one of the tolerated shapes.
      return null
    }
  }

  const graded = (
    write: BeaconHeartbeatResult | null,
    attempts: number,
    landedAtMs: number | null,
  ): BeaconCheck =>
    beaconHealth(write, BEACON_HEARTBEAT_LOG_ID, service, clock() - startedAt, {
      attempts,
      landedAtMs,
      graceMs,
      now: clock(),
    })

  const first = await attempt()
  if (first?.ok) {
    const landedAtMs = clock()
    recordBeaconHeartbeat(service, {
      now: landedAtMs,
      firestore: options.firestore,
    })
    return graded(first, 1, landedAtMs)
  }
  if (first === null || !isTransientBeaconCode(first.code)) {
    return graded(first, 1, null)
  }

  await pause(options.retryDelayMs ?? BEACON_HEARTBEAT_RETRY_DELAY_MS)

  const second = await attempt()
  if (second?.ok) {
    const landedAtMs = clock()
    recordBeaconHeartbeat(service, {
      now: landedAtMs,
      firestore: options.firestore,
    })
    return graded(second, 2, landedAtMs)
  }
  if (second === null || !isTransientBeaconCode(second.code)) {
    return graded(second, 2, null)
  }
  // Both attempts came back with nothing decided. The only thing that can
  // forgive that is proof another instance landed a heartbeat recently, and
  // a store that cannot answer is not proof.
  return graded(second, 2, await readBeaconHeartbeat(service, {
    firestore: options.firestore,
  }))
}
