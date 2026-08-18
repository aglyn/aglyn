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
 * GCS export freshness, reduced to a health verdict (AGL-1843).
 *
 * Exports are NOT managed backups — they are the independent copy that exists
 * BECAUSE the managed backups proved unreliable (every backup this project
 * took flipped `READY` → `NOT_AVAILABLE` at roughly one week old, AGL-1843).
 * A weekly `exportDocuments` run writes portable snapshot files to a GCS
 * bucket, and this check watches that the newest one is real and recent, so
 * a managed-backup flip no longer means "one copy only". The two are kept as
 * SEPARATE checks in the same endpoint precisely so the body says which layer
 * is degraded rather than blending them into one dishonest verdict.
 *
 * The input is the list of `*.overall_export_metadata` completion markers —
 * Firestore writes exactly one per FINISHED export, so the marker's creation
 * time is the moment the export completed, not the moment it started. An
 * export that hangs forever never produces a marker and fails the age rule,
 * the same trick `backupsHealth` plays with `CREATING`.
 *
 * Pure on purpose, like its siblings: the route lists, this decides, the
 * spec exercises every branch without a network.
 */
export interface ExportMarker {
  /** ISO timestamp the completion marker was written — when the export FINISHED. */
  timeCreated?: string
}

export interface ExportsCheck extends HealthCheck {
  /**
   * Completed exports currently retained. A COUNT only — the endpoint is
   * public, and bucket names or object paths have no business in it. Null
   * when the listing itself failed.
   */
  exportCount: number | null
  /** Age of the newest completed export, in days. Null when there is none. */
  newestExportAgeDays: number | null
}

/**
 * Weekly cadence (Mondays, `scheduled-crons.yml`) + one day of slack — the
 * same budget as `MAX_BACKUP_AGE_DAYS`, for the same reason: a schedule that
 * stops producing is as broken as one that fails.
 */
export const MAX_EXPORT_AGE_DAYS = 8

export function exportsHealth(
  markers: ExportMarker[] | null,
  ms: number,
  now: number = Date.now(),
): ExportsCheck {
  // A failed listing is degraded, not ok — same rule as `signupsHealth` and
  // `rateLimitsHealth`: an alarm that cannot see the thing it watches must
  // say so rather than report calm.
  if (markers === null) {
    return {
      ok: false,
      ms,
      code: 'exports-unavailable',
      exportCount: null,
      newestExportAgeDays: null,
    }
  }

  const newestMs = markers
    .map((marker) => Date.parse(marker.timeCreated ?? ''))
    .filter((time) => Number.isFinite(time))
    .reduce<number | null>((newest, time) => Math.max(newest ?? time, time), null)
  const newestExportAgeDays =
    newestMs === null ? null : Math.round(((now - newestMs) / 86_400_000) * 10) / 10

  // The cron exists, so "no exports" is a failure, not a fresh start — the
  // first export ran 2026-08-17, before this check first deployed.
  const code =
    newestExportAgeDays === null
      ? 'no-export'
      : newestExportAgeDays > MAX_EXPORT_AGE_DAYS
        ? 'export-stale'
        : undefined

  return {
    ok: code === undefined,
    ms,
    ...(code === undefined ? {} : { code }),
    exportCount: markers.length,
    newestExportAgeDays,
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
 * Rate-limiter degradation, reduced to a health verdict (AGL-1693).
 *
 * `consumeRateLimit` fails SOFT: when the Firestore counter is unreachable it
 * answers from a per-instance `Map` and flags `degraded`. AGL-1679 made that
 * findable after the fact — on recovery the instance writes one summary
 * document `rateLimits/degraded_{minuteBucket}` — but nothing reads it, so a
 * degraded window during the beta still passes unnoticed in real time. This
 * turns "did any limiter fall back recently" into the same 200/503 contract
 * the sibling checks speak, so the AGL-1502 uptime check + alert + email path
 * is the listener.
 *
 * **The window is the whole design.** Markers carry a 30-day `expiresAt`, so
 * "does a marker exist" would leave the endpoint red for a month after a
 * thirty-second blip — a recovered incident permanently paging is how a check
 * gets muted, and muted is worse than absent. That is the opposite of the
 * backups check, which stays red BY DESIGN because a missing restore point is
 * a condition that persists until someone fixes it (DISASTER_RECOVERY.md gap
 * 2). A degraded limiter window is an EVENT: it is over, and what is owed is
 * a notification, not a standing alarm. So the verdict covers a trailing
 * window and clears itself.
 *
 * Filtering on `lastAtMs` rather than the marker's id: the id is bucketed on
 * `firstAtMs`, so a long episode's document is stamped with the minute the
 * outage STARTED. An id-range window would miss exactly the longest episodes,
 * which are the ones worth waking up for.
 *
 * Pure on purpose, like `backupsHealth` and `signupsHealth`: the route
 * queries, this decides, the spec exercises every branch without a network.
 */
export interface RateLimitDegradationMarker {
  /** Calls that fell back to the per-instance cap. */
  calls?: number
  /** Instance-episodes merged into this minute bucket. */
  episodes?: number
  /** When the episode's last fallback happened. */
  lastAtMs?: number
  /** The failure code the episode ended on. */
  code?: string
}

export interface RateLimitsCheck extends HealthCheck {
  /**
   * Fallback calls inside the trailing window. A COUNT only — the endpoint is
   * public, and limiter keys are hashed client IPs. Null when the query
   * itself failed.
   */
  degradedCalls: number | null
  /** Instance-episodes inside the window. 2+ means several instances saw it. */
  degradedEpisodes: number | null
  /** Minutes since the most recent fallback, so the body dates itself. */
  minutesSinceLast: number | null
  /** The trailing window the counts cover, so the body is self-describing. */
  windowMinutes: number
  /** The count above which this reports degraded. */
  threshold: number
}

/**
 * Trailing window the degradation counts cover.
 *
 * Bounded from below by the alert path, not by taste. The probe memoises for
 * 5 minutes, the uptime check runs every 5, and the alert policy wants ~10
 * minutes of sustained failure before it emails — so a window shorter than
 * ~20 minutes can go red and green again before anyone is told, which is a
 * check that reports nothing while looking like it works. 30 leaves ten
 * minutes of margin and still clears itself inside half an hour.
 */
export const RATE_LIMIT_DEGRADED_WINDOW_MINUTES = 30

/**
 * Any fallback at all is worth an email. Unlike the signup alarm there is no
 * organic baseline to clear: a healthy deployment produces exactly zero of
 * these, and one is already the statement "for some requests, the global cap
 * was not the cap". Firestore retries transactions internally, so a failure
 * that reaches this code is not a single unlucky contention.
 */
export const MAX_DEGRADED_CALLS_PER_WINDOW = 0

export function rateLimitsHealth(
  markers: RateLimitDegradationMarker[] | null,
  ms: number,
  now: number = Date.now(),
  threshold: number = MAX_DEGRADED_CALLS_PER_WINDOW,
  windowMinutes: number = RATE_LIMIT_DEGRADED_WINDOW_MINUTES,
): RateLimitsCheck {
  // A failed query is degraded, not ok — same rule as `signupsHealth`. An
  // alarm that cannot see the thing it watches must not report calm, and this
  // one reads the collection that just failed for the limiter.
  if (markers === null) {
    return {
      ok: false,
      ms,
      code: 'markers-unavailable',
      degradedCalls: null,
      degradedEpisodes: null,
      minutesSinceLast: null,
      windowMinutes,
      threshold,
    }
  }

  const cutoff = now - windowMinutes * 60_000
  // The window is re-applied here rather than trusted from the query, so the
  // rule lives in one spec-covered place and a marker whose `lastAtMs` is
  // missing cannot silently count as recent.
  const recent = markers.filter(
    (marker) =>
      typeof marker.lastAtMs === 'number' && marker.lastAtMs >= cutoff,
  )

  const degradedCalls = recent.reduce(
    (total, marker) => total + (Number(marker.calls) || 0),
    0,
  )
  const degradedEpisodes = recent.reduce(
    (total, marker) => total + (Number(marker.episodes) || 0),
    0,
  )
  const lastAtMs = recent.reduce<number | null>(
    (latest, marker) => Math.max(latest ?? -Infinity, marker.lastAtMs as number),
    null,
  )

  return {
    ok: degradedCalls <= threshold,
    ms,
    ...(degradedCalls <= threshold ? {} : { code: 'rate-limiter-degraded' }),
    degradedCalls,
    degradedEpisodes,
    minutesSinceLast:
      lastAtMs === null
        ? null
        : Math.round(((now - lastAtMs) / 60_000) * 10) / 10,
    windowMinutes,
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
