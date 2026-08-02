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
 * Shared shape for the `/api/health` endpoints (AGL-1102).
 *
 * Both the console and the tenant runtime answer this, and they must answer it
 * IDENTICALLY — an uptime series is only comparable across services if the
 * status codes and the field names agree. Two near-identical route files would
 * have drifted the first time one of them was touched.
 *
 * The rules encoded here, each of which is a way health checks routinely lie:
 *
 * **The status code is the contract.** Most uptime monitors read nothing else,
 * so a degraded dependency has to be a 503. A 200 whose body says "degraded"
 * is a signal nobody receives.
 *
 * **Never cacheable.** A cached health check returns 200 from the edge while
 * the origin is on fire, and the graph stays green straight through the
 * outage. Three separate caches have faked a green check in this repo already,
 * so this sets `no-store` on every response including the failures — an error
 * response is the one you least want served from a cache.
 *
 * **No internals in the body.** It is public and unauthenticated, so a failing
 * check reports a CODE and never the underlying message, which can carry
 * project ids, paths or credentials fragments.
 */

export interface HealthCheck {
  ok: boolean
  /** How long the dependency took. The number that turns into a latency graph. */
  ms: number
  /** A stable code on failure — never a raw error message. */
  code?: string
}

export interface HealthReport {
  service: string
  checks: Record<string, HealthCheck>
  commit?: string | null
  environment?: string | null
  region?: string | null
  /** Injected so the body is deterministic in tests. */
  at?: string
}

export const HEALTH_NO_STORE =
  'no-store, no-cache, must-revalidate, max-age=0'

/** Degraded if ANY check failed. There is no partial credit for uptime. */
export function healthStatus(checks: Record<string, HealthCheck>): 'ok' | 'degraded' {
  return Object.values(checks).every((check) => check.ok) ? 'ok' : 'degraded'
}

export function healthBody(report: HealthReport): Record<string, unknown> {
  return {
    status: healthStatus(report.checks),
    service: report.service,
    checks: report.checks,
    commit: report.commit ?? null,
    environment: report.environment ?? null,
    region: report.region ?? null,
    at: report.at ?? new Date().toISOString(),
  }
}

export function healthHeaders(status: 'ok' | 'degraded'): Record<string, string> {
  return {
    'Cache-Control': HEALTH_NO_STORE,
    // Readable from any origin, deliberately.
    //
    // A status page must not live on the thing it reports on, so it is served
    // from a DIFFERENT deployment and reads these cross-origin. Without this
    // header the browser blocks the read and the page renders every service as
    // down during a perfectly healthy day — a status page that cries outage is
    // worse than none.
    //
    // Safe to open: the body is already public and unauthenticated, carries no
    // secrets, and a failing check reports a code rather than a message.
    'Access-Control-Allow-Origin': '*',
    // Tells a well-behaved monitor the failure is transient rather than a
    // permanent 5xx worth escalating on the first sample.
    ...(status === 'ok' ? {} : { 'Retry-After': '30' }),
  }
}

export function healthHttpStatus(status: 'ok' | 'degraded'): number {
  return status === 'ok' ? 200 : 503
}

/**
 * Reuse a probe result for `ttlMs`, per instance.
 *
 * The endpoint is public and unauthenticated, so an unthrottled dependency
 * check is a free amplifier: anyone could turn a loop into database reads on
 * our account. This bounds the cost to one probe per instance per interval
 * however hard it is hit.
 *
 * FAILURES ARE CACHED TOO, deliberately. A dependency that is down will be
 * down for the next caller as well, and re-probing per request turns an
 * outage into a stampede against the thing that is already failing.
 */
export function memoizeWithTtl<T>(
  ttlMs: number,
  probe: () => Promise<T>,
  now: () => number = Date.now,
): () => Promise<T> {
  let cached: { at: number; value: T } | null = null
  return async () => {
    const at = now()
    const elapsed = cached ? at - cached.at : Infinity
    // `elapsed >= 0` is not paranoia. A plain `elapsed < ttlMs` treats a
    // BACKWARDS clock as permanently fresh — the entry never expires and the
    // endpoint reports a stale verdict forever, which on a health check means
    // reporting healthy through an outage. Serverless instances outlive more
    // clock weirdness than a local run suggests.
    if (cached && elapsed >= 0 && elapsed < ttlMs) return cached.value
    const value = await probe()
    cached = { at, value }
    return value
  }
}
