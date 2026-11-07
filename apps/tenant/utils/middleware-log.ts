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
 * The tenant middleware's own log lines (AGL-4121). Edge-safe: no imports.
 *
 * The host-switch trace used to go out on EVERY request, three lines each.
 * An edge log line carries no status code, so it passes the production log
 * drains' filter (`not (log/statusCode ge 200 and log/statusCode lt 500)`) and
 * every one was a billed delivery to the Cloud Run receiver plus Vercel drain
 * volume, for a trace nobody reads outside a debugging session. It is now
 * written only when `AGLYN_DEBUG_MIDDLEWARE=1` is set on the deployment.
 */
export function middlewareDebugEnabled(): boolean {
  return process.env['AGLYN_DEBUG_MIDDLEWARE'] === '1'
}

/** `console.debug`, only while the middleware trace is switched on. */
export function middlewareDebug(...args: unknown[]): void {
  if (middlewareDebugEnabled()) console.debug(...args)
}

/**
 * How often each isolate proves the drain path is alive: at most one line per
 * this window. Far inside the receiver watcher's window (an ABSENCE condition,
 * "No requests reaching log-drain-receiver for 1 hour"), so an isolate serving
 * any traffic at all keeps it fed.
 */
export const MIDDLEWARE_HEARTBEAT_INTERVAL_MS = 5 * 60_000

let lastHeartbeatAt = Number.NEGATIVE_INFINITY

/**
 * The drain heartbeat: one small line per isolate per
 * {@link MIDDLEWARE_HEARTBEAT_INTERVAL_MS}, whatever the debug switch says.
 *
 * Kept because the trace above was a steady part of what reached the drain
 * receiver in a quiet hour (its floor is a few hundred deliveries an hour),
 * and the receiver's watcher fires on an hour of silence. Turning the trace
 * off without this could trade a log bill for a false red on the watcher that
 * guards the 5xx alert. This line keeps the watcher fed at a few lines an hour
 * per isolate instead of three per request, and it still goes silent if the
 * drain, the receiver or the tenant stops.
 *
 * Returns whether it wrote, for the spec.
 */
export function middlewareHeartbeat(now: number = Date.now()): boolean {
  if (now - lastHeartbeatAt < MIDDLEWARE_HEARTBEAT_INTERVAL_MS) return false
  lastHeartbeatAt = now
  console.info(JSON.stringify({ tag: 'tenant-middleware:heartbeat' }))
  return true
}

/** Test seam: the next call writes a heartbeat again. */
export function __resetMiddlewareHeartbeat(): void {
  lastHeartbeatAt = Number.NEGATIVE_INFINITY
}
