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
 * Firestore backup state, reduced to a health verdict (AGL-1490, AGL-1502).
 *
 * The 2026-08-02 backup sat at `NOT_AVAILABLE` for eleven days and nothing
 * noticed — the schedule ran, the API reported the failure, and no one was
 * listening. This turns "is the newest backup real and recent" into the same
 * 200/503 contract the other health checks speak, so the existing uptime
 * probe + alert path is the listener.
 *
 * Pure on purpose: the route fetches, this decides, the spec exercises every
 * branch without a network.
 */
export interface BackupSnapshot {
  /** `READY` | `CREATING` | `NOT_AVAILABLE` (or whatever the API adds next). */
  state?: string
  /** ISO timestamp of the data the backup captured. */
  snapshotTime?: string
}

export interface BackupsCheck extends HealthCheck {
  /**
   * Histogram by state — `{ READY: 1, NOT_AVAILABLE: 1 }`. Counts only: the
   * endpoint is public, and backup ids or resource paths have no business in
   * it. Counts are enough to know WHAT is wrong before opening gcloud.
   */
  states: Record<string, number>
  /** Age of the newest READY backup, in days. Null when there is none. */
  newestReadyAgeDays: number | null
}

/**
 * Weekly Sunday schedule + one day of slack. A healthy cadence never exceeds
 * 7; day 8 means the last run produced nothing usable.
 */
export const MAX_BACKUP_AGE_DAYS = 8

export function backupsHealth(
  backups: BackupSnapshot[],
  ms: number,
  now: number = Date.now(),
): BackupsCheck {
  const states: Record<string, number> = {}
  for (const backup of backups) {
    const state = backup.state ?? 'UNKNOWN'
    states[state] = (states[state] ?? 0) + 1
  }

  const newestReadyMs = backups
    .filter((backup) => backup.state === 'READY' && backup.snapshotTime)
    .map((backup) => Date.parse(backup.snapshotTime as string))
    .filter((time) => Number.isFinite(time))
    .reduce<number | null>((newest, time) => Math.max(newest ?? time, time), null)
  const newestReadyAgeDays =
    newestReadyMs === null
      ? null
      : Math.round(((now - newestReadyMs) / 86_400_000) * 10) / 10

  // `CREATING` is tolerated: every Sunday there is a window where the newest
  // backup legitimately is one, and paging on it weekly would teach everyone
  // to ignore the alert. It earns no freshness credit either — a backup that
  // never finishes fails the age rule instead.
  const failed = backups.some(
    (backup) => backup.state !== 'READY' && backup.state !== 'CREATING',
  )

  const code = failed
    ? 'backup-failed'
    : newestReadyAgeDays === null
      ? 'no-ready-backup'
      : newestReadyAgeDays > MAX_BACKUP_AGE_DAYS
        ? 'backup-stale'
        : undefined

  return {
    ok: code === undefined,
    ms,
    ...(code === undefined ? {} : { code }),
    states,
    newestReadyAgeDays,
  }
}

/**
 * Org-creation volume, reduced to a health verdict (AGL-1536).
 *
 * The detection layer over the AGL-1534 rate limit: the limiter bounds each
 * uid (3/h) and each IP (10/h), so a distributed farm holding every actor
 * under both caps is invisible to it — but visible in aggregate. This turns
 * "how many orgs appeared in the trailing hour" into the same 200/503
 * contract the other health checks speak, so the existing uptime check +
 * alert + email path is the listener, and a wave becomes an email instead of
 * a surprise. The manual response lever is the AGL-1510 signups feature-lock.
 *
 * Pure on purpose, like `backupsHealth`: the route counts, this decides, the
 * spec exercises every branch without a network.
 */
export interface SignupsCheck extends HealthCheck {
  /**
   * Orgs created inside the trailing window. A COUNT only — the endpoint is
   * public, and org names, slugs or owners have no business in it. Null when
   * the count query itself failed.
   */
  recentOrgCreations: number | null
  /** The trailing window the count covers, so the body is self-describing. */
  windowMinutes: number
  /** The count above which this reports degraded. */
  threshold: number
}

/** Trailing window the org-creation count covers. */
export const ORG_CREATION_WINDOW_MINUTES = 60

/**
 * Degraded above 10 creations/hour. Calibrated against two facts: production
 * holds 4 orgs TOTAL (2026-08), so the organic baseline is ~zero per hour;
 * and the AGL-1534 per-IP cap is 10/h, so a single maxed-out address can
 * never trip this — 11+/h necessarily means multiple addresses, which is
 * exactly the distributed signature the rate limiter cannot see. If a launch
 * day legitimately beats this, the alert asks a human to glance at the orgs
 * list and enjoy the view; that is the correct outcome, not a false positive.
 */
export const MAX_ORG_CREATIONS_PER_WINDOW = 10

export function signupsHealth(
  recentOrgCreations: number | null,
  ms: number,
  threshold: number = MAX_ORG_CREATIONS_PER_WINDOW,
): SignupsCheck {
  // A failed count is degraded, not ok — an alarm that cannot see the thing
  // it watches must say so rather than report calm.
  const code =
    recentOrgCreations === null
      ? 'count-unavailable'
      : recentOrgCreations > threshold
        ? 'signup-wave'
        : undefined
  return {
    ok: code === undefined,
    ms,
    ...(code === undefined ? {} : { code }),
    recentOrgCreations,
    windowMinutes: ORG_CREATION_WINDOW_MINUTES,
    threshold,
  }
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
