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
  /**
   * Which VERSION of the platform answered (AGL-2091).
   *
   * `commit` alone could only ever be answered on Aglyn's own cloud, so a
   * self-host operator had nothing to quote in a bug report and no way to ask
   * whether a fix had reached them. This is the field that answers it, and
   * unlike the commit it needs no operator configuration —
   * `platformVersion()` reads the number the build inlined from package.json.
   */
  version?: string | null
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
    version: report.version ?? null,
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
 * A HEAD response for a health endpoint: the SAME status and headers its GET
 * would return, with no body (AGL-1148).
 *
 * ## Why this exists
 *
 * Every health route used to answer HEAD with a hardcoded `200` and the
 * comment "cheap liveness for monitors that only issue HEAD. Touches
 * nothing." Touching nothing is precisely the problem: **a HEAD that knows
 * nothing is a health check that cannot go red.** A monitor configured with
 * HEAD — which several uptime providers use by default — would have reported
 * green through any outage that left the function able to boot, which is most
 * of them. `/api/health/crons` sat at 503 for fifty-one hours; a HEAD monitor
 * pointed at it would have agreed with the green board the whole time.
 *
 * It also violated the contract this file opens with. "The status code is the
 * contract" cannot hold for one method and not another, and HTTP requires a
 * HEAD response to carry the same status and headers its GET would.
 *
 * ## The cost argument, which is why this is safe
 *
 * Delegating to GET means HEAD runs the dependency probe. Every route
 * memoizes that probe (`memoizeWithTtl`, 15s on the root and 5 minutes on the
 * subsystems) explicitly so a public unauthenticated endpoint cannot be made
 * to read in a loop — the same bound that already lets a fifteen-minute probe
 * hit seven endpoints for nearly nothing. HEAD now costs exactly what GET
 * costs, which is a memo lookup between refreshes, and it serializes no body.
 *
 * Headers are carried over rather than rebuilt so `Cache-Control: no-store`,
 * the open CORS origin and `Retry-After` reach a HEAD client identically — a
 * HEAD response that was cacheable while its GET was not would be the same
 * lie one layer down.
 */
export async function healthHeadOf(
  get: () => Promise<Response>,
): Promise<Response> {
  const response = await get()
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
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
  /**
   * Present, and always `false`, ONLY in the third state (AGL-1843): the
   * check could not determine whether backups are healthy. Omitted entirely
   * from a real verdict, exactly as `code` is omitted from a healthy one, so
   * `ok: true` with no `determinate` key means "measured, and fine".
   *
   * An indeterminate check reports `ok: true` and therefore does not page.
   * That is deliberate and it is bounded — see the escalation note in
   * `backupsHealth`.
   */
  determinate?: false
}

/**
 * Weekly Sunday schedule + one day of slack. A healthy cadence never exceeds
 * 7; day 8 means the last run produced nothing usable.
 */
export const MAX_BACKUP_AGE_DAYS = 8

/**
 * States in which a backup has not FAILED — it is simply not usable yet.
 *
 * `STATE_UNSPECIFIED` is a real member of the API's `Backup.State` enum ("The
 * state is unspecified"), and proto3 JSON omits a default-valued field, so a
 * backup in it arrives with **no `state` key at all**. Treating that absence
 * as a failure is the `strictNullChecks`-off trap this file is otherwise
 * careful about: a missing field must never fold into a red.
 */
const BACKUP_IN_FLIGHT = new Set(['CREATING', 'STATE_UNSPECIFIED'])

/**
 * `backups` is the listing, or `null` when it could not be read at all.
 *
 * `options.unreachable` is `ListBackupsResponse.unreachable` — the locations
 * the API could not reach. Non-empty means the listing is a PARTIAL result
 * set. `options.code` is the code to report when `backups` is `null`.
 */
export function backupsHealth(
  backups: BackupSnapshot[] | null,
  ms: number,
  now: number = Date.now(),
  options: { unreachable?: string[]; code?: string } = {},
): BackupsCheck {
  // ## THE THREE STATES (AGL-1843, second pass)
  //
  // This check used to have two: healthy, and failed. Everything it could not
  // establish — an upstream that errored, a partial listing, a run that had
  // not finished — collapsed into "backup failed", which is the loudest thing
  // it can say and was, in every one of those cases, false. It reported 503
  // `backup-failed` continuously for four and a half days while the backups
  // were fine, against a monitor that emails on a five-minute interval.
  //
  // ### Why `NOT_AVAILABLE` is not a failure — measured, not assumed
  //
  // The API documents the state as "The backup is not available **at this
  // moment**", and that temporal wording is literal. The same three backup
  // ids, read from `gcloud firestore backups list` on three dates:
  //
  //   id          2026-08-13      2026-08-17/18    2026-08-24
  //   3b5238df…   NOT_AVAILABLE   NOT_AVAILABLE    READY
  //   eb4d21e3…   READY           NOT_AVAILABLE    READY
  //   d14ce827…   —               READY            READY
  //
  // `NOT_AVAILABLE` flips in BOTH directions, on backups whose `expireTime`
  // is months away, independent of age. The 2026-08-02 backup that AGL-1490
  // was filed about — "half the Firestore backups are NOT_AVAILABLE" — is
  // READY today, twenty-two days old. It was never broken. Neither was the
  // 2026-08-09 one, which went READY → NOT_AVAILABLE → READY. And the
  // predicted permanent day-7 degradation did not happen: d14ce827 is READY
  // at day 8. So every rule that reads a `NOT_AVAILABLE` count as damage is
  // reading a maintenance window as an outage.
  //
  // ### What the check actually needs to answer
  //
  // "Can we restore, and is the restore point recent?" That question is
  // answered ENTIRELY by the age of the newest READY backup. No other row in
  // the listing can make a fresh READY backup un-restorable. So a fresh READY
  // backup is unconditionally green, and everything below it is the taxonomy
  // of why we could not find one.
  //
  // ### Why indeterminate answers 200, and why that is not fail-open
  //
  // Three things bound it, because a backups check that cannot go red is
  // worse than no backups check:
  //   1. It is time-bounded. Indeterminacy is only tolerated while a backup
  //      younger than `MAX_BACKUP_AGE_DAYS` exists. A schedule that stops, or
  //      that never produces anything usable, crosses the budget and goes red
  //      within eight days whatever the states say.
  //   2. It never overrides staleness. If a READY backup exists and is over
  //      budget, that is `backup-stale` — a newer CREATING or NOT_AVAILABLE
  //      row earns no freshness credit, so a run that hangs every week cannot
  //      hold the check green.
  //   3. The route classifies PERMANENT upstream failures (no credential,
  //      401/403/404) as hard red rather than indeterminate, so a revoked IAM
  //      role cannot silence this forever. And `checks.exports` in the same
  //      endpoint is an independent, still-hard-red probe of the GCS copy:
  //      "we cannot read the managed backups" answers 200 only while we can
  //      still prove a fresh independent copy exists.
  //
  // State 3a — the listing could not be read AT ALL. That is not a verdict;
  // it is the absence of one, and reporting it as `backup-failed` is the
  // defect this pass exists to remove.
  if (backups === null) {
    return {
      ok: true,
      ms,
      code: options.code ?? 'backups-unreadable',
      states: {},
      newestReadyAgeDays: null,
      determinate: false,
    }
  }

  const states: Record<string, number> = {}
  for (const backup of backups) {
    const state = backup.state ?? 'STATE_UNSPECIFIED'
    states[state] = (states[state] ?? 0) + 1
  }

  const snapshotMsOf = (backup: BackupSnapshot): number =>
    backup.snapshotTime ? Date.parse(backup.snapshotTime) : Number.NaN
  const newestOf = (keep: (backup: BackupSnapshot) => boolean): number | null =>
    backups
      .filter(keep)
      .map(snapshotMsOf)
      .filter((time) => Number.isFinite(time))
      .reduce<number | null>((newest, time) => Math.max(newest ?? time, time), null)
  const ageDaysOf = (time: number): number =>
    Math.round(((now - time) / 86_400_000) * 10) / 10

  const newestReadyMs = newestOf((backup) => backup.state === 'READY')
  const newestAnyMs = newestOf(() => true)
  const newestReadyAgeDays = newestReadyMs === null ? null : ageDaysOf(newestReadyMs)
  const newestAnyAgeDays = newestAnyMs === null ? null : ageDaysOf(newestAnyMs)

  // State 1 — HEALTHY. A restore point exists and it is recent. Nothing else
  // in the listing can falsify that, so nothing else is consulted.
  if (newestReadyAgeDays !== null && newestReadyAgeDays <= MAX_BACKUP_AGE_DAYS) {
    return { ok: true, ms, states, newestReadyAgeDays }
  }

  // State 2a — FAILED. A backup that is neither READY nor in flight and that
  // carries no usable `snapshotTime` cannot be aged at all, so we cannot even
  // say when the last run was. That is positive evidence of something wrong,
  // and "assume it aged out" is the assumption that hides a broken run.
  const undateable = backups.some(
    (backup) =>
      backup.state !== 'READY' &&
      !BACKUP_IN_FLIGHT.has(backup.state ?? 'STATE_UNSPECIFIED') &&
      !Number.isFinite(snapshotMsOf(backup)),
  )
  if (undateable) {
    return { ok: false, ms, code: 'backup-failed', states, newestReadyAgeDays }
  }

  // State 3b — the listing is a PARTIAL result set. `ListBackupsResponse`
  // carries `unreachable`: rather than failing the request when one location
  // cannot be reached, the API returns the backups it could see and names the
  // ones it could not. Positive evidence survives that (state 1 above already
  // returned); negative evidence does not — "we saw no fresh READY backup" is
  // not a finding when we did not see everything.
  if ((options.unreachable ?? []).length > 0) {
    return {
      ok: true,
      ms,
      code: 'backups-partial',
      states,
      newestReadyAgeDays,
      determinate: false,
    }
  }

  // State 3c — a recent run exists, it simply is not usable AT THIS MOMENT:
  // mid-creation on a Sunday, or inside one of the `NOT_AVAILABLE` windows
  // measured above. Only reachable when NOTHING is READY — a stale READY
  // backup falls through to `backup-stale` below, so this can never buy a
  // hanging schedule more than the eight-day budget.
  if (
    newestReadyAgeDays === null &&
    newestAnyAgeDays !== null &&
    newestAnyAgeDays <= MAX_BACKUP_AGE_DAYS
  ) {
    return {
      ok: true,
      ms,
      code: 'backups-not-ready-yet',
      states,
      newestReadyAgeDays,
      determinate: false,
    }
  }

  // State 2b — FAILED on freshness. Either nothing has ever been READY and
  // nothing recent exists to be waiting on, or the newest READY backup is
  // past the budget. Both mean the same operational thing: there is no recent
  // restore point, which is the only fact this check exists to protect.
  return {
    ok: false,
    ms,
    code: newestReadyAgeDays === null ? 'no-ready-backup' : 'backup-stale',
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
 * Refused org creations, reduced to a health verdict (AGL-1907).
 *
 * `signupsHealth` above counts the signups that SUCCEEDED. That is the right
 * alarm for a wave that gets through, and the wrong one for a wave that is
 * being contained: when the AGL-1534 limiter starts refusing, org-creation
 * volume goes *down*, so the check that watches volume reads calmer at exactly
 * the moment scripted pressure arrives. The 429s are the signature. Before the
 * doors open on Sep 1 this is also the only thing that can answer "has the
 * limiter ever actually fired in production" — a control nobody has seen
 * refuse is a control nobody has tested.
 *
 * Counted from `rateLimits/signupRefused_{minuteBucket}` markers, which carry
 * per-reason counts and no identifiers. This is a separate check rather than
 * more fields on `SignupsCheck` so the AGL-1536 verdict keeps its meaning
 * exactly: a creation wave and a refusal wave are different events with
 * different responses (feature-lock the signups door vs. leave the limiter to
 * do its job and go read the refusal reasons).
 *
 * Pure on purpose, like its siblings: the route queries, this decides.
 */
export interface SignupRefusalMarker {
  /** Refused attempts merged into this minute bucket. */
  refusals?: number
  /**
   * Split by what refused: `{ uid?: n, ip?: n, locked?: n, held?: n }`.
   *
   * `uid` and `ip` are the AGL-1534 rate limiter's two caps. `locked` and
   * `held` come from the `beforeUserCreated` blocking function (AGL-2583) — a
   * door the limiter never sees, because it decides account creation on the
   * Identity Platform path before any Aglyn route runs.
   */
  byReason?: Record<string, number>
  /**
   * Account creations the blocking function admitted BLIND: the signups lock
   * could not be read and nothing this instance remembered said it was pulled
   * (AGL-2583).
   *
   * Deliberately its own field rather than another `byReason` entry. Nobody
   * was refused, so folding it into the refusal split would make both counts
   * lie — and it is graded on its own terms below.
   */
  unreadable?: number
  /** When the most recent refusal in this bucket happened. */
  refusedAtMs?: number
}

export interface SignupRefusalsCheck extends HealthCheck {
  /**
   * Refused org creations inside the trailing window. A COUNT only — the
   * endpoint is public, and the limiter's keys are a uid and a hashed client
   * IP. Null when the query itself failed.
   */
  refusedSignups: number | null
  /**
   * Which cap did the refusing. A run that is almost all `ip` is one address
   * hammering; a run that is almost all `uid` is many accounts each pushing
   * past three, which is the distributed shape. Null when the query failed.
   */
  refusedByReason: Record<string, number> | null
  /**
   * Account creations decided WITHOUT the signups lock being readable
   * (AGL-2583). Graded on its own, at zero tolerance, because it is
   * categorically different from every entry in `refusedByReason`: those are
   * controls working as designed, this is the platform answering the signups
   * question without being able to consult it, and one of those is one too
   * many. Null when the query itself failed.
   */
  lockUnreadable: number | null
  /** Minutes since the most recent refusal, so the body dates itself. */
  minutesSinceLast: number | null
  /** The trailing window the count covers, so the body is self-describing. */
  windowMinutes: number
  /** The count above which this reports degraded. */
  threshold: number
}

/**
 * Trailing window the refusal count covers. One hour, matching the limiter's
 * own window (`org-create` is 3/h and 10/h) so the number is readable against
 * the caps that produced it.
 */
export const SIGNUP_REFUSAL_WINDOW_MINUTES = 60

/**
 * Degraded above 50 refusals/hour.
 *
 * Not zero, unlike the limiter-degradation alarm: a refusal is the system
 * working, and a real person who fumbles a workspace slug four times in an
 * hour produces one. The number that means something is *sustained* refusal.
 * Calibrated the same way AGL-1536's was: production holds single-digit orgs
 * (2026-08), so organic refusals are ~zero per hour, and 50 is far above any
 * plausible human while being reached in under a minute by a script. One
 * determined address can generate this alone — that is intended, because "one
 * address is hammering the signup door" is worth an email even though the
 * limiter is containing it.
 */
export const MAX_SIGNUP_REFUSALS_PER_WINDOW = 50

/**
 * The marker field the blocking function counts blind decisions under
 * (AGL-2583).
 *
 * `signupsCreationVerdict` answers `locked` when a completed read found the
 * lever pulled, `held` when a failed read fell back on an earlier one that
 * had, and — the case this names — admits the account when the read failed
 * and nothing remembered said the lever was pulled. That last one refuses
 * nobody, so it is not a `byReason` entry; it is the platform deciding the
 * signups question without being able to consult it, which is the visible
 * edge of a Firestore read outage on the account-creation path. AGL-2581 was
 * three days of that same read failing, and its only trace was a
 * `logger.warn` nothing alerts on.
 */
export const SIGNUP_LOCK_UNREADABLE_FIELD = 'unreadable'

/**
 * Blind signups-lock decisions tolerated per window: NONE.
 *
 * Deliberately not calibrated like `MAX_SIGNUP_REFUSALS_PER_WINDOW` above,
 * which is a volume threshold over refusals that mean the system is working.
 * A blind decision is never routine — a single one says the signups lock was
 * unreadable at least once, and the lock is unenforceable for as long as that
 * lasts. False positives here cost a glance at one endpoint.
 */
export const MAX_UNREADABLE_SIGNUP_DECISIONS_PER_WINDOW = 0

export function signupRefusalsHealth(
  markers: SignupRefusalMarker[] | null,
  ms: number,
  now: number = Date.now(),
  threshold: number = MAX_SIGNUP_REFUSALS_PER_WINDOW,
  windowMinutes: number = SIGNUP_REFUSAL_WINDOW_MINUTES,
  unreadableThreshold: number = MAX_UNREADABLE_SIGNUP_DECISIONS_PER_WINDOW,
): SignupRefusalsCheck {
  // A failed query is degraded, not ok — the same rule `signupsHealth` and
  // `rateLimitsHealth` follow. An alarm that cannot see the thing it watches
  // must not report calm.
  if (markers === null) {
    return {
      ok: false,
      ms,
      code: 'refusals-unavailable',
      refusedSignups: null,
      refusedByReason: null,
      lockUnreadable: null,
      minutesSinceLast: null,
      windowMinutes,
      threshold,
    }
  }

  let refusedSignups = 0
  let lockUnreadable = 0
  let newestAtMs: number | null = null
  const refusedByReason: Record<string, number> = {}
  for (const marker of markers) {
    refusedSignups += marker.refusals ?? 0
    // `Number(...) || 0` for the reason the split below gives: a corrupt
    // Firestore field must not turn this into NaN, which compares false
    // against every threshold and would report calm forever.
    lockUnreadable += Number(marker.unreadable) || 0
    for (const [reason, count] of Object.entries(marker.byReason ?? {})) {
      // `Number(...) || 0` rather than a bare add: these come out of Firestore
      // and a corrupt field must not turn the total into NaN, which compares
      // false against the threshold and would report calm forever.
      refusedByReason[reason] =
        (refusedByReason[reason] ?? 0) + (Number(count) || 0)
    }
    const at = marker.refusedAtMs
    if (typeof at === 'number' && (newestAtMs === null || at > newestAtMs)) {
      newestAtMs = at
    }
  }

  const over = refusedSignups > threshold
  // The blind count is graded FIRST and reported over the volume code. A wave
  // and an unreadable lock call for opposite responses — leave the limiter
  // alone and go read the refusal reasons, versus go find out why Firestore
  // is unreadable from the account-creation path — so the code has to name
  // the one that is actually happening.
  const blind = lockUnreadable > unreadableThreshold
  const code = blind
    ? 'signups-lock-unreadable'
    : over
      ? 'signup-refusal-wave'
      : undefined
  return {
    ok: code === undefined,
    ms,
    ...(code === undefined ? {} : { code }),
    refusedSignups,
    refusedByReason,
    lockUnreadable,
    minutesSinceLast:
      newestAtMs === null
        ? null
        : Math.max(0, Math.floor((now - newestAtMs) / 60_000)),
    windowMinutes,
    threshold,
  }
}

/**
 * NOBODY GOT AN ACCOUNT WHILE PEOPLE WERE TRYING (AGL-2583).
 *
 * `signupsHealth` watches for a FLOOD. Its healthiest possible reading —
 * zero orgs created in the trailing hour — is also what total failure looks
 * like, so the monitor named "signups" reports green precisely when nobody
 * can sign up. That is not a hypothetical: account creation was refused for
 * every visitor from Sep 1 to Sep 4 (AGL-2581) and the signup check was
 * green through all of it, because zero is comfortably under ten.
 *
 * ## Zero is only a signal next to a denominator
 *
 * Alone, "no accounts this hour" describes a quiet Tuesday night as loudly as
 * an outage, and an alarm that fires on quiet nights is an alarm everyone
 * mutes. What makes zero mean something is TRAFFIC: people arrived at the
 * signup page and none of them ended up with an account.
 *
 * The denominator is counted first-party, from `signupServed_` markers the
 * console writes when the signup page asks `/api/lockdown-status?feature=
 * signups` — the one server request every rendering of that page makes. Not
 * GA4: its API needs a service account and an OAuth round trip from a public
 * health route, its data lands with hours of latency, and a monitor that
 * depends on an analytics vendor is a monitor that reports an outage every
 * time that vendor has one. The markers are in the store this route family
 * already reads, cost one increment per instance per five seconds, and are
 * counted by exactly the same range query shape as its siblings.
 *
 * The denominator UNDER-counts on purpose and that is the safe direction:
 * the lockdown answer is edge-cacheable for a minute, so a burst of visitors
 * behind one CDN node can land as a single origin hit. Under-counting can
 * only make this check quieter, never louder — it cannot invent traffic that
 * did not happen, so it cannot invent an outage.
 *
 * Pure on purpose, like its siblings: the route counts, this decides.
 */
export interface SignupServedMarker {
  /** Signup-page serves merged into this minute bucket. */
  serves?: number
  /** When the most recent serve in this bucket happened. */
  servedAtMs?: number
}

export interface SignupDroughtCheck extends HealthCheck {
  /**
   * Signup pages served inside the trailing window — the denominator. A
   * COUNT only; the markers carry no visitor, no IP and no referrer. Null
   * when the query itself failed.
   */
  signupPagesServed: number | null
  /** Accounts (orgs) actually created in the same window. The numerator. */
  orgCreations: number | null
  /** The trailing window both numbers cover, so the body is self-describing. */
  windowMinutes: number
  /** Serves below which zero creations is treated as a quiet hour, not an outage. */
  minimumTraffic: number
}

/**
 * Trailing window the drought verdict covers. One hour, matching the sibling
 * checks so the three numbers on this endpoint are all read against the same
 * clock — and long enough that a single slow afternoon does not page anyone.
 */
export const SIGNUP_DROUGHT_WINDOW_MINUTES = 60

/**
 * Serves in the window below which zero accounts means nothing.
 *
 * Five, not one. One person can open the signup page, think better of it and
 * close the tab; five doing so in an hour with not one account created is the
 * shape of a door that does not open. Calibrated against the under-counting
 * above: with the lockdown answer cacheable for a minute, five origin hits is
 * a genuine trickle of arrivals rather than a single refreshing visitor.
 */
export const MIN_SIGNUP_TRAFFIC_FOR_DROUGHT = 5

export function signupDroughtHealth(
  markers: SignupServedMarker[] | null,
  orgCreations: number | null,
  ms: number,
  minimumTraffic: number = MIN_SIGNUP_TRAFFIC_FOR_DROUGHT,
  windowMinutes: number = SIGNUP_DROUGHT_WINDOW_MINUTES,
): SignupDroughtCheck {
  // A failed traffic query is degraded, not ok — the same rule the siblings
  // follow. Without the denominator this check has no opinion at all, and a
  // check with no opinion must not spend it saying everything is fine.
  if (markers === null) {
    return {
      ok: false,
      ms,
      code: 'traffic-unavailable',
      signupPagesServed: null,
      orgCreations,
      windowMinutes,
      minimumTraffic,
    }
  }
  let signupPagesServed = 0
  for (const marker of markers) {
    // `Number(...) || 0` for the reason the sibling gives: a corrupt Firestore
    // field must not turn the total into NaN, which compares false against
    // every threshold and would report calm forever.
    signupPagesServed += Number(marker.serves) || 0
  }
  if (orgCreations === null) {
    return {
      ok: false,
      ms,
      code: 'count-unavailable',
      signupPagesServed,
      orgCreations: null,
      windowMinutes,
      minimumTraffic,
    }
  }
  // The whole verdict: traffic arrived and NOT ONE of them got an account.
  const drought = signupPagesServed >= minimumTraffic && orgCreations === 0
  return {
    ok: !drought,
    ms,
    ...(drought ? { code: 'signup-drought' } : {}),
    signupPagesServed,
    orgCreations,
    windowMinutes,
    minimumTraffic,
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
 * Bounded from below by the alert path, not by taste. The probe memoizes for
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
 * Uncaught server-side errors, reduced to a health verdict (AGL-1921).
 *
 * ## The gap this closes
 *
 * Of the eleven alert policies in `aglyn-main`, not one could see a server
 * error rate. Every check is a LIVENESS probe on one URL: `/api/health` can be
 * green while `/api/billing/checkout` 500s for every paying customer, which is
 * the single most likely shape of a launch-day incident and the one nothing
 * could page on. Server errors lived only in the Vercel runtime log, which
 * retains ~60 minutes and drains nowhere (AGL-1799).
 *
 * The first pass gave both apps an `onRequestError` hook that forwards each
 * error to a `server-errors` log in `aglyn-main`. That closed the CAPTURE gap
 * and left the reading gap wide open, and the reading gap is the one this repo
 * keeps losing to — `/api/health/crons` was correct about a broken job for
 * fifty-one hours because nothing asked it. Measured 2026-08-24: the
 * production credential is refused `entries:list` on that log
 * (`403 Permission denied for all log views`), so no probe here can read what
 * the hook writes. The only reader that log can have is a GCP alert policy
 * created by hand.
 *
 * So the hook ALSO counts into a `rateLimits/serverError_{minute}` marker,
 * and this grades those counts into the same 200/503 contract the sibling
 * checks speak — which hands the signal to readers that already exist and
 * already run: the 15-minute GitHub uptime probe, the external keyword
 * monitors, and `docs.aglyn.com/status`.
 *
 * ## What it can and cannot see, exactly
 *
 * It counts what `onRequestError` counts: an uncaught throw in a render or a
 * route handler, in the nodejs runtime. It does NOT count an error that kills
 * the process before the hook runs, a platform-level 5xx that never reaches
 * our code (function timeout, OOM, cold-start 502), or anything thrown in the
 * edge runtime. A Vercel log drain sees all of those and remains the real fix.
 * This is the arm that ships without a purchase, and its blind spots are
 * written down rather than glossed — `docs/UPTIME_AND_SLA.md`.
 *
 * ## The third state is the one that matters here
 *
 * A monitoring path that cannot measure MUST NOT report a zero. `null` markers
 * — the query failed — is `errors-unavailable` and degraded, never "0 errors".
 * That is the same rule `rateLimitsHealth` and `billingWebhookHealth` follow,
 * and on this check it is the difference between "nothing is wrong" and "we
 * have no idea", which during a 5xx spike are the two readings furthest apart.
 *
 * ## It must be able to go GREEN
 *
 * A spike is an EVENT, not a condition (the AGL-1843 rule). Markers live seven
 * days, so "does a marker exist" would hold this red for a week after a
 * one-minute blip, and a check that stays red after recovery is a check that
 * gets muted. The verdict covers a trailing window and clears itself.
 *
 * Pure on purpose, like its siblings: the route queries, this decides, the
 * spec exercises every branch without a network.
 */
export interface ServerErrorMarker {
  /** Uncaught server errors merged into this minute bucket. */
  errors?: number
  /** Split by deployment — `{ 'console-web': n, 'tenant-web': n }`. */
  byService?: Record<string, number>
  /** When the most recent error in this bucket happened. */
  erroredAtMs?: number
}

export interface ServerErrorsCheck extends HealthCheck {
  /**
   * Uncaught server errors inside the trailing window. A COUNT only — the
   * endpoint is public, and messages, stacks and route patterns have no
   * business in it (they are in the Logging entry, which is not public). Null
   * when the query itself failed, and null is NEVER zero.
   */
  serverErrors: number | null
  /**
   * Which deployment produced them. The first thing an incident needs, and it
   * is a deployment name rather than anything about a request. Null when the
   * query failed.
   */
  byService: Record<string, number> | null
  /** Minutes since the most recent error, so the body dates itself. */
  minutesSinceLast: number | null
  /** The trailing window the count covers, so the body is self-describing. */
  windowMinutes: number
  /** The count above which this reports degraded. */
  threshold: number
}

/**
 * Trailing window the error count covers.
 *
 * Bounded from below by the alert path, not by taste — the same arithmetic as
 * `RATE_LIMIT_DEGRADED_WINDOW_MINUTES`: the probe memoizes for 5 minutes, the
 * external checks run every 5, and an alert policy wants ~10 minutes of
 * sustained failure before it emails, so a window under ~20 minutes can go red
 * and green again before anyone is told. 30 leaves ten minutes of margin and
 * still clears itself inside half an hour of the last error.
 */
export const SERVER_ERROR_WINDOW_MINUTES = 30

/**
 * Errors tolerated in the window.
 *
 * NOT zero, unlike the rate-limiter and billing alarms, and the difference is
 * real rather than a matter of nerve. Those two watch controls that a healthy
 * deployment exercises exactly never. This one watches a count that a single
 * cold-start Firestore deadline, or one visitor's malformed request reaching a
 * route that throws instead of 400ing, can make non-zero on a perfectly good
 * day — and an alarm that pages on the first of those gets muted before the
 * one that matters arrives.
 *
 * Five over thirty minutes is chosen against the only two facts available.
 * Production serves single-digit orgs (2026-08), so the organic rate of
 * UNCAUGHT server errors is ~zero — the codebase answers its expected failures
 * with 4xx, and reaching this hook means nothing handled it. And the shape
 * being caught is "a route is failing for real users", which does not produce
 * six errors an hour; it produces six in a minute. There is deliberately no
 * pretence of calibration: the beta window exists to produce a baseline, and
 * `SERVER_ERROR_ALARM_MAX_ERRORS` moves this without a deploy when it does.
 */
export const MAX_SERVER_ERRORS_PER_WINDOW = 5

export function serverErrorsHealth(
  markers: ServerErrorMarker[] | null,
  ms: number,
  now: number = Date.now(),
  threshold: number = MAX_SERVER_ERRORS_PER_WINDOW,
  windowMinutes: number = SERVER_ERROR_WINDOW_MINUTES,
): ServerErrorsCheck {
  // ⚠️ THE MEASURED ZERO. A failed query is degraded, never calm, and on this
  // check that is not a convention borrowed from its siblings — it is the
  // whole reason the check is trustworthy. "We could not count the errors"
  // and "there were no errors" are the same JSON if this branch is missing,
  // and the first is most likely precisely when the second is false.
  if (markers === null) {
    return {
      ok: false,
      ms,
      code: 'errors-unavailable',
      serverErrors: null,
      byService: null,
      minutesSinceLast: null,
      windowMinutes,
      threshold,
    }
  }

  const cutoff = now - windowMinutes * 60_000
  // The window is re-applied here rather than trusted from the query, so the
  // rule lives in one spec-covered place and a marker whose `erroredAtMs` is
  // missing cannot silently count as recent. `strictNullChecks` is off
  // repo-wide, so an absent field would otherwise compare as 0 and fall
  // outside every window forever — a marker that can never be counted.
  const recent = markers.filter(
    (marker) =>
      typeof marker.erroredAtMs === 'number' && marker.erroredAtMs >= cutoff,
  )

  const byService: Record<string, number> = {}
  let serverErrors = 0
  let lastAtMs: number | null = null
  for (const marker of recent) {
    // `Number(...) || 0` rather than a bare add: these come out of Firestore
    // and a corrupt field must not turn the total into NaN, which compares
    // false against the threshold and would report calm forever.
    serverErrors += Number(marker.errors) || 0
    for (const [service, count] of Object.entries(marker.byService ?? {})) {
      byService[service] = (byService[service] ?? 0) + (Number(count) || 0)
    }
    const at = marker.erroredAtMs as number
    if (lastAtMs === null || at > lastAtMs) lastAtMs = at
  }

  const over = serverErrors > threshold
  return {
    ok: !over,
    ms,
    ...(over ? { code: 'server-error-spike' } : {}),
    serverErrors,
    byService,
    minutesSinceLast:
      lastAtMs === null
        ? null
        : Math.max(0, Math.round(((now - lastAtMs) / 60_000) * 10) / 10),
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

/**
 * The error beacon's own liveness, reduced to a health verdict (AGL-1923).
 *
 * ## The failure this exists for
 *
 * The `Client error beacon` alert policy is a log-match: it fires when an
 * entry APPEARS in `client-errors`. A policy of that shape can only report
 * presence, so if the thing writing the entries stops writing, the policy
 * goes quiet — and quiet is the reading it also gives when everything is
 * healthy. **A dead beacon is indistinguishable from zero errors**, and
 * `reportClientErrors` has three fail-soft paths that each end in a
 * `console.warn` to a log that retains an hour and drains nowhere
 * (AGL-1799). Error Reporting would show zero errors; the policy would stay
 * silent; both readings look exactly like a clean launch.
 *
 * ## Why this shape and not a metric-absence policy
 *
 * AGL-1923 proposed a log-based metric plus `conditionAbsent`. This is the
 * same guarantee with two properties that one lacks. It is PROVABLE — the
 * verdict is graded synchronously against the write's own status, so the
 * degraded branch can be induced and observed rather than waited out over an
 * absence window. And it needs nothing new to run it: the uptime probe is
 * what winds the dead-man's switch, so there is no cron that can itself stop
 * without anyone noticing (which would only move the problem one layer out).
 *
 * ## It must be able to go GREEN
 *
 * The condition is an EVENT, not a state. A failed write degrades; the next
 * successful write clears it, within one probe TTL — no marker, no latch, no
 * retention window to age out of. That is the AGL-1843 rule applied before
 * the fact: the clearing event is named, and it is "the next heartbeat that
 * reaches Cloud Logging".
 *
 * Pure on purpose, like its siblings: the route writes, this decides, the
 * spec exercises every branch without a network.
 */
export interface BeaconCheck extends HealthCheck {
  /**
   * The log id the heartbeat targets, so the body names what to query during
   * an incident rather than making someone go and find it.
   */
  logId: string
  /** Which deployment's credential was exercised — console and tenant differ. */
  service: string
}

export function beaconHealth(
  write: { ok: boolean; code?: string } | null,
  logId: string,
  service: string,
  ms: number,
): BeaconCheck {
  // A null result is degraded by contract, the same rule `signupsHealth` and
  // `rateLimitsHealth` follow: an alarm that cannot see the thing it watches
  // must not report calm. Here it is stronger than a convention — "we could
  // not determine whether the beacon works" IS the AGL-1923 condition.
  if (write === null) {
    return { ok: false, ms, code: 'heartbeat-unavailable', logId, service }
  }
  return {
    ok: write.ok,
    ms,
    ...(write.ok ? {} : { code: write.code ?? 'heartbeat-failed' }),
    logId,
    service,
  }
}

/**
 * A tenant page render, reduced to a health verdict (AGL-2486).
 *
 * ## The gap this closes
 *
 * `marketing-home` (`aglyn.com/`) and `customer-site` (`demo.aglyn.app/`) are
 * the only two external checks that watched a REAL PAGE rather than a health
 * endpoint. Both sat at 0% from 2026-08-21, because bot protection answered
 * Google's checkers with a 429 checkpoint. The health-path firewall bypass
 * that recovered `tenant-health` and `beacon-heartbeat tenant` cannot reach
 * them: they fetch `/`, not `/api/health/*`.
 *
 * The alternative was allowlisting Google's 54 checker IPs — rejected because
 * an IP-valued bypass rule is one the drift checker cannot meaningfully
 * assert, and Google rotates the list. So the render moves to where the
 * bypass already is: an endpoint under `/api/health` that renders the page
 * server-side and grades the result.
 *
 * ## Why this is not "200 because the route exists"
 *
 * The caller runs the SAME loader the catch-all page route runs, against the
 * SAME host, and this grades what came back. A page that resolves no host,
 * 404s, redirects away, or composes an EMPTY node tree is a failure — and
 * those are the shapes an outage actually takes. A canary that cannot go red
 * for a broken page is worse than the dark check it replaces, because it
 * reports a confidence it has not earned.
 *
 * ## What is deliberately NOT asserted
 *
 * Never a string from the page. The marker is STRUCTURAL — a host resolved
 * and a non-empty composed node tree. Asserting copy would page whoever is
 * on call for an ordinary content edit, and this endpoint is public, so
 * customer content must not appear in its body either. `nodeCount` is a
 * count, which is enough to tell "rendered nothing" from "rendered" without
 * disclosing what was rendered.
 */
export type RenderOutcome =
  /** The loader returned props. `nodeCount` is the composed node total. */
  | { kind: 'rendered'; hostResolved: boolean; nodeCount: number }
  /** The loader chose the not-found branch. */
  | { kind: 'not-found' }
  /** The loader chose to redirect — a home page should never do this. */
  | { kind: 'redirect' }
  /** The loader threw, or could not be reached at all. */
  | { kind: 'unavailable' }
  /**
   * No target host is configured. A failure on purpose: "we are watching
   * nothing" must never read the same as "the page is fine".
   */
  | { kind: 'not-configured' }

export interface RenderCheck extends HealthCheck {
  /**
   * Composed nodes the page produced. A COUNT, never the nodes: this endpoint
   * is public and the nodes are the customer's page. Zero is the failure.
   */
  nodeCount: number
  /**
   * Which tenant host was rendered — a CONFIGURED host, never one derived
   * from the request, so no caller can choose what we render. Empty string
   * when nothing is configured.
   */
  host: string
}

export function renderHealth(
  outcome: RenderOutcome,
  host: string,
  ms: number,
): RenderCheck {
  const base = { ms, host }
  switch (outcome.kind) {
    case 'rendered':
      // Both halves are load-bearing. A host that resolved but composed
      // nothing is a blank page served with a 200 — the exact outage a
      // reachability ping calls healthy.
      if (!outcome.hostResolved) {
        return { ...base, ok: false, code: 'host-unresolved', nodeCount: outcome.nodeCount }
      }
      if (outcome.nodeCount <= 0) {
        return { ...base, ok: false, code: 'rendered-empty', nodeCount: 0 }
      }
      return { ...base, ok: true, nodeCount: outcome.nodeCount }
    case 'not-found':
      return { ...base, ok: false, code: 'not-found', nodeCount: 0 }
    case 'redirect':
      return { ...base, ok: false, code: 'redirected', nodeCount: 0 }
    case 'not-configured':
      return { ...base, ok: false, code: 'not-configured', nodeCount: 0 }
    case 'unavailable':
    default:
      // Same rule as `beaconHealth`: "we could not determine whether the page
      // renders" is a failure, never calm.
      return { ...base, ok: false, code: 'render-unavailable', nodeCount: 0 }
  }
}

/**
 * Billing webhook delivery, reduced to a health verdict (AGL-1924).
 *
 * ## The gap this closes
 *
 * Of the alert policies in `aglyn-main`, none watched billing. Sept 1 opens to
 * PAYING customers, and the billing path is the one place where a failure
 * nobody notices converts directly into lost revenue and a support incident
 * per affected customer. The webhook has a documented history of failing
 * exactly that way: AGL-1551 (every delivery rejected `400 Invalid signature`
 * for a week, behind a green "Active" badge), AGL-1560 (a secret roll 400ing
 * roughly half of deliveries), AGL-1552 (the replay window making every retry
 * unreceivable), AGL-1798 (`charge.refunded` never subscribed). Each is a
 * total or near-total failure of the billing event path, and not one of them
 * would have paged anyone.
 *
 * ## Why the denominator has to come from Stripe
 *
 * `stripeEvents` alone cannot answer this. `route.ts` returns 400 BEFORE
 * claiming the idempotency document, so a rejected delivery writes nothing —
 * an empty collection reads identically whether nothing happened or
 * everything was refused. That is precisely how the 2026-08-14 checklist tick
 * came out green while AGL-1551 was live. Stripe supplies what it TRIED to
 * deliver; we supply what we processed; the gap is the failure.
 *
 * ## Why this cannot false-page on a quiet night
 *
 * The verdict never keys on the ABSENCE of events. At beta volume a night
 * with zero deliveries is legitimate, and a naive freshness rule would page
 * on it — the AGL-1843 mistake in a new costume. `undelivered` is a count of
 * deliveries Stripe attempted AND failed, so a quiet window scores zero and
 * reads healthy for the right reason. `emitted` and `processed` are carried
 * for the human reading the incident and are DELIBERATELY not inputs to the
 * verdict: no floor for them exists yet, and inventing one before the beta
 * produces a baseline would be a threshold nobody could defend.
 *
 * ## Division of labour with the AGL-1906 audit
 *
 * `tools/scripts/lib/stripe-webhook-health.mjs` asserts the endpoint's full
 * subscribed-event list against `WEBHOOK_EVENTS`. That list is deliberately
 * NOT duplicated here — a second copy is the exact failure its own comment
 * warns about, and a subscription set is config that changes on deploys, not
 * a thing that changes minute to minute. This watches the two facts that DO
 * move continuously: whether the destination is still enabled, and whether
 * deliveries are landing.
 *
 * ## It must be able to go GREEN
 *
 * Everything here is a trailing window over live Stripe state. A destination
 * re-enabled, or a fixed handler whose retries then succeed, reads healthy on
 * the next probe. There is no marker to age out and nothing to latch
 * (AGL-1843): the clearing event is "a window with no failed deliveries and
 * an enabled endpoint".
 *
 * Pure on purpose, like its siblings: the route fetches, this decides, the
 * spec exercises every branch without a network.
 */
export interface BillingWebhookFacts {
  /** Our production destination, as Stripe currently holds it. */
  endpointStatus: 'enabled' | 'disabled' | 'missing'
  /** Events Stripe attempted and failed to deliver inside the window. */
  undelivered: number
  /** Events Stripe emitted inside the window. Reported, never a verdict input. */
  emitted: number
  /**
   * Events our handler claimed inside the window. Reported, never a verdict
   * input — and null when the Firestore arm could not run, which does NOT on
   * its own make the check red: Stripe already answered the question that
   * matters.
   */
  processed: number | null
  /**
   * Deliveries that answered 200 and moved NOTHING inside the window
   * (AGL-1954) — a required event type that produced neither a committed
   * effect nor a named deliberate skip. See `webhook-delivery.ts` for why
   * that is a defect by construction and a legitimate no-op is not one.
   *
   * Null when the Firestore arm could not run, and null is NOT red on its
   * own: Stripe already answered the question that matters, and a health
   * check that reds on its own read failure trains people to ignore it.
   */
  inert: number | null
  /**
   * Deliveries that only landed on a RETRY inside the window (AGL-2039).
   *
   * The arm every other count here is structurally blind to.
   * `undelivered` comes from `delivery_success=false`, which is a TERMINAL
   * filter over EVENTS: an event that 400s three times and then succeeds
   * reads back clean and is indistinguishable from one that succeeded
   * immediately. The Stripe Dashboard scores delivery ATTEMPTS and counted
   * all three — which is why AGL-1906 read 0% against the Dashboard's 30% and
   * both figures were correct. The three attempts it could not see were
   * AGL-1551.
   *
   * The webhook stamps `retriedAtMs` when the distance from `event.created`
   * to its own claim exceeds `RETRY_LAG_SECONDS`, so this is an aggregation
   * over a marker field rather than a scan of every claim in the window.
   *
   * Null when the Firestore arm could not run, and null is NOT red on its
   * own — same rule as `processed` and `inert`.
   */
  retried: number | null
  /**
   * Required event types the destination is NOT subscribed to (AGL-1948 /
   * AGL-1798). Empty is the healthy answer; null means the endpoint did not
   * report its subscriptions and the coverage question is unanswered.
   */
  unsubscribedEvents: readonly string[] | null
  /**
   * The CONNECT destination, as Stripe currently holds it (AGL-1948).
   *
   * A SECOND destination, and the platform one being perfectly healthy says
   * nothing about it: connected-account events are delivered only to a
   * destination created with `connect: true`, so its absence is invisible to
   * every count above. AGL-2122 found exactly that — `account.updated`
   * handled in two plugins, and no destination that could ever deliver it,
   * so every merchant's `stripeChargesEnabled` rotted silently.
   *
   * Null when the endpoint census itself could not be taken.
   */
  connectEndpoint: 'enabled' | 'disabled' | 'missing' | null
  /**
   * Required Connect events the Connect destination is NOT subscribed to.
   * Empty is healthy; null means there was no destination to ask, or it did
   * not state its subscriptions.
   */
  unsubscribedConnectEvents: readonly string[] | null
}

export interface BillingWebhookCheck extends HealthCheck {
  endpointStatus: BillingWebhookFacts['endpointStatus'] | null
  undelivered: number | null
  emitted: number | null
  processed: number | null
  inert: number | null
  retried: number | null
  unsubscribedEvents: readonly string[] | null
  connectEndpoint: BillingWebhookFacts['connectEndpoint'] | null
  unsubscribedConnectEvents: readonly string[] | null
  /** The trailing window the counts cover, so the body is self-describing. */
  windowMinutes: number
}

/**
 * Trailing window the delivery counts cover.
 *
 * Bounded from below by the alert path, not by taste, exactly like
 * `RATE_LIMIT_DEGRADED_WINDOW_MINUTES`: the probe memoizes for 5 minutes, the
 * uptime check runs every 5, and the policy wants ~10 minutes of sustained
 * failure before it emails — so a window under ~20 minutes can go red and
 * green again before anyone is told. Bounded from ABOVE by Stripe's retry
 * schedule: an event that fails and then succeeds on retry stops counting, so
 * a window much longer than an hour would hold transient blips red past their
 * own recovery.
 */
export const WEBHOOK_FAILURE_WINDOW_MINUTES = 60

/**
 * Failed deliveries tolerated in the window.
 *
 * Zero, and unlike the signup alarm there is no organic baseline to clear: a
 * healthy account produces exactly zero, and one is already the statement
 * "Stripe tried to tell us something about money and could not". Stripe
 * retries on its own, so a failure visible here is not one unlucky packet.
 */
export const MAX_FAILED_DELIVERIES_PER_WINDOW = 0

/**
 * Inert deliveries tolerated in the window (AGL-1954).
 *
 * Zero — and unlike `processed`, the count this check reports but refuses to
 * gate on because no defensible floor exists before the beta produces a
 * baseline, this one's floor follows from the definition. A delivery is
 * counted inert only when a required event type produced neither a committed
 * effect nor a NAMED deliberate skip (`classifyWebhookDelivery`). No
 * legitimate traffic pattern generates one: a tenant shopper's subscription,
 * a marketplace refund, a `won` dispute nobody claimed all name their reason
 * and classify as `ignored`. So any at all is the statement "Stripe told us
 * about money and nothing here moved" — the same "any at all" rule the
 * rate-limiter degradation markers use (AGL-1679).
 */
export const MAX_INERT_DELIVERIES_PER_WINDOW = 0

/**
 * Retried deliveries tolerated in the window (AGL-2039).
 *
 * Zero, and the reasoning is `MAX_FAILED_DELIVERIES_PER_WINDOW`'s: a delivery
 * counted here is one whose FIRST attempt did not get through, which is a
 * failed attempt that happened, not a statistical wobble. The healthy band
 * measured against the live account is 1.0–3.7 seconds against a 120-second
 * bar, so nothing organic sits anywhere near it.
 *
 * Cheap to be wrong in the safe direction, because this cannot latch: the
 * window is trailing and the marker is on the event's own claim, so a single
 * blip reds for at most one window and then clears itself — an event, not a
 * condition (the AGL-1843 rule). It is a parameter rather than a literal so
 * that if beta traffic turns out to produce organic retries, the knob is one
 * argument and not a rewrite.
 */
export const MAX_RETRIED_DELIVERIES_PER_WINDOW = 0

export function billingWebhookHealth(
  facts: BillingWebhookFacts | null,
  ms: number,
  windowMinutes: number = WEBHOOK_FAILURE_WINDOW_MINUTES,
  threshold: number = MAX_FAILED_DELIVERIES_PER_WINDOW,
  inertThreshold: number = MAX_INERT_DELIVERIES_PER_WINDOW,
  retriedThreshold: number = MAX_RETRIED_DELIVERIES_PER_WINDOW,
): BillingWebhookCheck {
  // A null census is degraded, the same rule `signupsHealth` and
  // `rateLimitsHealth` follow: an alarm that cannot see the thing it watches
  // must not report calm. Here it is also the AGL-1906 lesson — `unknown` was
  // read as `healthy` on 2026-08-14 and the endpoint was 400ing every
  // delivery at the time.
  if (facts === null) {
    return {
      ok: false,
      ms,
      code: 'stripe-unavailable',
      endpointStatus: null,
      undelivered: null,
      emitted: null,
      processed: null,
      inert: null,
      retried: null,
      unsubscribedEvents: null,
      connectEndpoint: null,
      unsubscribedConnectEvents: null,
      windowMinutes,
    }
  }

  const base = {
    ms,
    endpointStatus: facts.endpointStatus,
    undelivered: facts.undelivered,
    emitted: facts.emitted,
    processed: facts.processed,
    inert: facts.inert,
    retried: facts.retried,
    unsubscribedEvents: facts.unsubscribedEvents,
    connectEndpoint: facts.connectEndpoint,
    unsubscribedConnectEvents: facts.unsubscribedConnectEvents,
    windowMinutes,
  }

  // Order matters: a missing or disabled destination explains any delivery
  // count that follows, and is the more actionable statement. An endpoint
  // deleted or switched off in the dashboard is TOTAL silent failure — Stripe
  // stops attempting, so `undelivered` would read zero and a delivery-only
  // rule would call it healthy.
  if (facts.endpointStatus === 'missing') {
    return { ...base, ok: false, code: 'endpoint-missing' }
  }
  if (facts.endpointStatus === 'disabled') {
    return { ...base, ok: false, code: 'endpoint-disabled' }
  }
  // A required event the destination does not carry (AGL-1948 / AGL-1798),
  // ABOVE the delivery counts because it explains a silence they cannot see.
  // An unsubscribed event produces no delivery to fail, no request to reject
  // and no inert handler either — Stripe simply stops sending, and every
  // count below reads a perfectly healthy zero for as long as it lasts. It
  // also outranks `deliveries-failing` on actionability: this one names the
  // exact event to re-add, and `npm run setup:stripe` fixes it in a minute.
  //
  // `null` — the endpoint did not state its subscriptions — is deliberately
  // NOT red. It is a question that went unanswered, not an answer, and the
  // check already has `stripe-unavailable` for a census it could not take.
  if (facts.unsubscribedEvents && facts.unsubscribedEvents.length > 0) {
    return { ...base, ok: false, code: 'events-unsubscribed' }
  }
  if (facts.undelivered > threshold) {
    return { ...base, ok: false, code: 'deliveries-failing' }
  }
  // THE 200-THAT-DID-NOTHING (AGL-1954), and it is LAST on purpose: every
  // code above explains why a handler would have had nothing to do, so
  // reporting inertness over one of them would name the symptom instead of
  // the cause. Reached only when Stripe holds an enabled destination
  // subscribed to everything we asked for and delivered successfully — at
  // which point "a delivery moved nothing" has no innocent explanation left.
  if (facts.inert !== null && facts.inert > inertThreshold) {
    return { ...base, ok: false, code: 'handlers-inert' }
  }
  /*==========================================
   * THE ATTEMPTS NOTHING ELSE HERE CAN COUNT (AGL-2039).
   *
   * `undelivered` above is `delivery_success=false`, a TERMINAL-state filter
   * over EVENTS. An event that 400s three times and then succeeds on the
   * fourth reads back `true`, so it is zero there and zero in `emitted`,
   * `processed` and `inert` too — the handler DID eventually run. Every
   * number on this check reports a healthy window while three real delivery
   * attempts failed. That is not a hypothetical: it is the exact reading
   * AGL-1906 produced, 0.00% against the Stripe Dashboard's 30%, and the
   * three attempts the Dashboard was counting were AGL-1551's.
   *
   * BELOW `deliveries-failing` because an event failing every attempt
   * explains an event that needed several, and below `handlers-inert`
   * because a delivery that landed late and then moved nothing is worse than
   * one that landed late and worked. ABOVE the Connect codes because this is
   * this hour's revenue path and those are a slower rot.
   *
   * Null is not red: the marker is ours, so an unread Firestore is an
   * unanswered question, and `stripe-unavailable` already covers a census we
   * could not take.
   *=========================================*/
  if (facts.retried !== null && facts.retried > retriedThreshold) {
    return { ...base, ok: false, code: 'deliveries-retried' }
  }
  /*==========================================
   * THE CONNECT DESTINATION (AGL-1948, closing AGL-2122's blind spot).
   *
   * A SECOND destination, and every code above is about the first one. The
   * platform destination can be enabled, fully subscribed, delivering and
   * acting — the whole check green — while connected-account events reach
   * nothing at all, because they are delivered only to a destination created
   * with `connect: true`. AGL-2122 measured exactly that against the live
   * account on 2026-08-18: one destination, correct URL, all ten events, and
   * no Connect destination in existence. `account.updated` was handled in two
   * plugins and could never be delivered, so `syncConnectAccountStatus` never
   * ran and every merchant's charge-eligibility flag rotted where it stood.
   *
   * LAST on purpose, and for a different reason than `handlers-inert` above:
   * not because the codes above explain it, but because they do not. It is an
   * independent destination whose failure is slower — merchant readiness
   * drifting out of date — while everything above is this hour's revenue. The
   * facts ride in the body either way, so the staff board shows the Connect
   * state even when a louder code takes the headline; only the single `code`
   * is exclusive.
   *
   * `missing` IS red. Before AGL-2122 that would have been wrong, because
   * nothing created the destination and a permanently-red check teaches
   * people to ignore the board. Now that setup-stripe creates it, its absence
   * is a real regression with a one-line remedy.
   *=========================================*/
  if (facts.connectEndpoint === 'missing') {
    return { ...base, ok: false, code: 'connect-endpoint-missing' }
  }
  if (facts.connectEndpoint === 'disabled') {
    return { ...base, ok: false, code: 'connect-endpoint-disabled' }
  }
  if (
    facts.unsubscribedConnectEvents &&
    facts.unsubscribedConnectEvents.length > 0
  ) {
    return { ...base, ok: false, code: 'connect-events-unsubscribed' }
  }
  return { ...base, ok: true }
}

/**
 * Is every interval we can SELL also an interval we can BILL? (AGL-1931)
 *
 * The metered item is what turns reported usage into money. It is attached
 * from an env-configured price id that is keyed by billing interval —
 * `STRIPE_PRICE_METERED` for monthly, `STRIPE_PRICE_METERED_YEARLY` for
 * annual — because Stripe forbids one subscription mixing
 * `recurring.interval`.
 *
 * When one of those ids is missing, `meteredPriceId(interval)` returns null
 * and every subscription-mutating path does the only safe thing: it attaches
 * nothing and carries on. Failing a checkout over it would be worse. But the
 * result is a subscription that accrues usage against a meter and carries no
 * item to bill it, and NOTHING about that is visible — the plan is right, the
 * entitlements are right, the invoice looks right, and the only trace is
 * revenue that never arrives.
 *
 * That is the defect shape this check exists to end. The absence of a price
 * was indistinguishable from "correctly no overage", so it hid behind a
 * `console.warn` on a server log nobody reads. Here it is a 503 on the same
 * probe the uptime check and alert email already watch.
 *
 * ## Why ASYMMETRY is the loudest code
 *
 * One interval configured and the other not means one cohort of customers is
 * billed for overage and the other silently is not — off the same meter, on
 * the same plans, with no screen anywhere showing the difference. It cannot
 * be a deliberate state: there is no product reason to meter monthly
 * subscribers and exempt annual ones.
 *
 * ## Why BOTH missing is still red, but only with Stripe configured
 *
 * Both unset with no `STRIPE_SECRET_KEY` is simply an unprovisioned
 * deployment — local dev, a fresh preview — where no money is at stake and
 * going red would train everyone to ignore this check. That is the exact
 * reasoning the checkout and subscription routes already apply to their
 * warning, and it is preserved here.
 *
 * But both unset while Stripe IS configured is a deployment that can take
 * money and cannot bill a single unit of overage on ANY interval. That is
 * the same revenue loss, merely total instead of partial, and the earlier
 * code treated it as calm because it only ever compared the two ids to each
 * other. Comparing them to Stripe's presence instead is what closes it.
 */
export interface MeteredPricingFacts {
  /** Whether this deployment holds a Stripe secret key at all. */
  stripeConfigured: boolean
  /** `STRIPE_PRICE_METERED` — the monthly metered price — is set. */
  monthly: boolean
  /** `STRIPE_PRICE_METERED_YEARLY` — the annual metered price — is set. */
  yearly: boolean
}

export interface MeteredPricingCheck extends HealthCheck {
  stripeConfigured: boolean
  monthly: boolean
  yearly: boolean
  /**
   * The interval that would accrue unbilled usage, named so the body says
   * which cohort is affected without anyone re-deriving it from two booleans.
   */
  unbilledInterval: 'month' | 'year' | 'both' | null
}

export function meteredPricingHealth(
  facts: MeteredPricingFacts,
  ms: number,
): MeteredPricingCheck {
  const base = {
    ms,
    stripeConfigured: facts.stripeConfigured,
    monthly: facts.monthly,
    yearly: facts.yearly,
  }

  // Unprovisioned: no Stripe, no money, no alarm.
  if (!facts.stripeConfigured) {
    return { ...base, ok: true, code: 'stripe-unconfigured', unbilledInterval: null }
  }
  if (facts.monthly && facts.yearly) {
    return { ...base, ok: true, unbilledInterval: null }
  }
  if (!facts.monthly && !facts.yearly) {
    return { ...base, ok: false, code: 'metered-price-missing', unbilledInterval: 'both' }
  }
  // Exactly one. The AGL-1931 shape.
  return {
    ...base,
    ok: false,
    code: 'metered-price-asymmetric',
    unbilledInterval: facts.yearly ? 'month' : 'year',
  }
}

/*==========================================
 * SCHEDULED JOBS, WATCHED BY ABSENCE (AGL-1955).
 *
 * ## The failure this exists for
 *
 * `Cloud Scheduler job run failed (aglyn-main)` is a log-match on
 * `resource.type="cloud_scheduler_job" AND severity >= ERROR`, and the
 * `scheduled-crons.yml` workflow goes red on a non-200. Both of those are
 * triggered BY A RUN. A job that is deleted, paused, or whose `- cron:` line
 * is edited away produces no attempt, therefore no error entry, therefore no
 * red workflow, therefore nothing. Quiet reads as healthy — the same shape
 * AGL-1923 closed for the error beacon, one subsystem over.
 *
 * What is downstream of these jobs is not cosmetic: `report-usage` is the
 * only writer that meters a closed month into Stripe, `run-erasures` is the
 * GDPR deletion runner, `audit-archive` moves and then DELETES audit rows,
 * and `plugin-jobs-beat` is the only thing that makes scheduled publishing
 * and booking-hold expiry happen at all. A silently unscheduled job means
 * customers are not billed, or data is not reaped, behind a green board.
 *
 * ## The two properties that make this work
 *
 * **It does not need the job to be alive to fire.** That is the whole bug.
 * The verdict is computed by the READER — `/api/health/crons`, wound by the
 * uptime probe and by any staff member opening the Health page — against
 * marks the jobs left behind. Nothing here is on a schedule that could
 * itself stop; that would only move the problem one layer out, which is the
 * AGL-1923 argument for a graded switch over a `conditionAbsent` policy.
 *
 * **It cannot false-alarm on a legitimately idle period.** The mark is
 * stamped by the INVOCATION, not by the work: a `finish-domain-attachments`
 * run with no pending host still beats, and a quiet week for
 * `reap-plugin-artifacts` still beats. And the expected time is computed
 * from the job's own cron expression rather than from a fixed interval, so
 * `usage-email` — hourly, but only on the 1st and 2nd of the month — is
 * green for the twenty-nine days it is deliberately not running. A fixed
 * "expect one every hour" rule would have paged on the 3rd, every month.
 *
 * ## Why an output age rule was not enough on its own
 *
 * AGL-1843's `exportsHealth` watches the weekly export by the age of what it
 * PRODUCES, and that is the better rule where an output exists — it catches
 * "ran and failed" as well as "never ran". Most of these jobs have no such
 * output. `backfill-scope` is detect-only and deliberately writes nothing.
 * `usage-alerts` produces a notification only when somebody is over budget.
 * `reap-plugin-artifacts` deletes nothing in a normal week. For those, the
 * only honest thing whose age moves on every run is a mark the run itself
 * leaves — so that is what this reads. `exportsHealth` stays where it is:
 * the two are complementary, and `firestore-export` is watched by both.
 *
 * ## It must be able to go GREEN
 *
 * Nothing latches. A job that missed a fire and then runs again stamps a
 * fresh mark and reads healthy on the next probe — the AGL-1843 rule, whose
 * clearing event here is named and is "the next invocation of that job".
 *=========================================*/

/** Where the marks live. One document per job id, written by the job. */
export const CRON_BEAT_COLLECTION = 'platformCronBeats'

/**
 * The document that records when this deployment STARTED watching.
 *
 * Without it a job that has never reported cannot be told apart from a job
 * that has stopped reporting, and every board would come up red on the day
 * the feature deploys — for `usage-email`, red until the 1st of the next
 * month. The rule this enables is stated once, in `cronJobsHealth`: a job
 * with no mark is only silent once a scheduled fire time has passed SINCE
 * we started watching.
 *
 * Not a reserved id: Firestore reserves `__.*__`, and this is a plain slug
 * that no job id can collide with (job ids never contain the word `watch`,
 * and the wiring spec asserts the inventory's ids against the workflow).
 */
export const CRON_BEAT_WATCH_DOC = 'watch-window'

/**
 * Where a degraded verdict is recorded, so a red window survives it.
 *
 * The response body names the late job, but only to whoever is holding it,
 * and the uptime probe reads the status and discards the body. Vercel's
 * runtime log keeps a `console.error` for about an hour, and the Cloud
 * Logging drain deliberately does not forward one — `isServerErrorEntry`
 * drops `level: 'error'`, because that is every fail-soft line the beacons
 * write and forwarding it is what a self-feeding bill is made of. So the
 * only sink that outlives the window is the one the endpoint already holds
 * a handle to.
 *
 * Written by the READER, like the verdict itself. One document, replaced on
 * each degraded probe, holding the failing rows and when the window opened.
 * Same collision argument as the watch document: a plain slug, and no job id
 * contains `degraded`.
 */
export const CRON_BEAT_DEGRADED_DOC = 'last-degraded'

/**
 * How long a gap may be before the next degraded probe counts as a NEW
 * window rather than a continuation of the one on file.
 *
 * Three probe TTLs. Long enough that an instance answering intermittently
 * does not split one outage into a dozen, short enough that yesterday's
 * window is never mistaken for today's. The comparison is against the
 * failing set as well, so a different set always opens a new window.
 */
export const CRON_DEGRADED_WINDOW_CONTINUITY_MS = 15 * 60_000

/** Who fires the job. The two are operated, and fail, differently. */
export type CronRunner = 'github-actions' | 'cloud-scheduler'

export interface ScheduledJob {
  /** Stable id. The Firestore document id, and the health check's name. */
  id: string
  label: string
  /**
   * Five-field cron, UTC. The SAME string the scheduler holds — the wiring
   * spec asserts each one against its runner's source of truth
   * (`.github/workflows/scheduled-crons.yml` for `github-actions`,
   * `cloud/functions/src/index.ts` for `cloud-scheduler`), so an edit there
   * that is not made here fails the build rather than quietly changing what
   * "on time" means.
   */
  cron: string
  runner: CronRunner
  /** What the scheduler actually invokes, for the operator reading a red row. */
  target: string
  /**
   * How late a run may be before the row goes red.
   *
   * Generous on purpose, and the generosity is not padding. GitHub only runs
   * scheduled workflows from the default branch and delays them under load —
   * routinely by minutes, occasionally by an hour. The question this check
   * answers is "is this job still scheduled at all", not "did it start on the
   * second"; a grace that reds on ordinary lateness is alert fatigue, and an
   * alert people learn to ignore is the failure this issue is about wearing
   * a different hat.
   *
   * SO THE GRACE IS A PROPERTY OF THE RUNNER, not of the job (AGL-1617). The
   * ninety minutes the two frequent sweeps used to carry was GitHub's drift
   * budget, and it was bought with detection: on a fifteen-minute schedule it
   * takes SIX consecutive missed fires before anything is said. Moving those
   * two onto Cloud Scheduler — which is punctual, as `plugin-jobs-beat` has
   * been demonstrating at `every 1 minutes` in the same payload the whole
   * time — is what let the bar go back UP, to forty-five minutes and three
   * missed fires. That direction is the point: widening a grace to make a
   * monitor agree with a runner that drops 60% of its triggers is not a fix,
   * it is deciding not to look.
   *
   * IT IS A FLOOR, NOT THE EXACT BAR. `cronJobsHealth` compares the mark
   * against the last fire that is ALREADY this old, so where the threshold
   * lands depends on the clock's phase against the schedule: forty-five
   * minutes on a fifteen-minute cron reds somewhere between 45 and 60 minutes
   * of silence, six hours on a daily one between 6h and 30h. Quote the range,
   * not the number, when reasoning about how fast a dead job is found — and
   * never write a test that only holds at one phase.
   */
  graceMinutes: number
  /** What stops happening when this job stops. Rendered on the board. */
  drives: string
}

/**
 * THE INVENTORY.
 *
 * Six GitHub Actions schedules (`.github/workflows/scheduled-crons.yml`) — the
 * weekly jobs plus the month-boundary usage-email sweep, for which an hour of
 * drift is nothing — and twelve rows driven by Cloud Scheduler out of
 * `cloud/functions/src/index.ts`: `pluginJobsBeat` (every minute), the four
 * the `consoleFastCrons` job carries every fifteen (AGL-1617), and one
 * `consoleDailyCron` export per daily job.
 *
 * `scheduled-crons-wiring.spec.ts` holds BOTH runners against their source —
 * the workflow for the `github-actions` rows, the functions file for the
 * `cloud-scheduler` ones — in both directions. An inventory row for a job
 * nobody schedules and a scheduled job nobody watches are the same bug seen
 * from opposite ends, and both fail the build.
 *
 * `report-usage` appears TWICE and is two jobs, not one. The 02:00 run
 * rolls up the closed month and is the only run that ever reaches Stripe;
 * the 07:00 `?month=current` run writes the in-progress figure every usage
 * budget reads (AGL-2219). Either can stop without the other, and folding
 * them into one row would hide exactly that.
 */
/*
 * ⚠️ GRACE IS A PROPERTY OF THE RUNNER, not of the job.
 *
 * The five daily console jobs carried a SIX-HOUR grace because GitHub
 * Actions dispatches scheduled workflows on a best-effort basis and routinely
 * drifted by an hour or two. That grace bought tolerance and paid for it in
 * blindness: on 2026-08-27 GitHub dropped the whole day, and three of these
 * were thirty hours silent before anything said so.
 *
 * They run on Cloud Scheduler now, which has been punctual to the minute
 * since AGL-1617, and each function's own ceiling is 540 seconds. Ninety
 * minutes is therefore ten times the longest a healthy run can take and still
 * catches a dead job inside the working day, instead of most of a day later.
 */
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  {
    id: 'report-usage',
    label: 'Metered usage rollup (closed month)',
    cron: '0 2 * * *',
    runner: 'cloud-scheduler',
    target: '/api/billing/report-usage',
    graceMinutes: 90,
    drives:
      'The only run that meters a closed month into Stripe. If it stops, customers are not billed for what they used.',
  },
  {
    id: 'audit-archive',
    label: 'Audit archive',
    cron: '0 3 * * *',
    runner: 'cloud-scheduler',
    target: '/api/admin/audit-archive',
    graceMinutes: 90,
    drives:
      'Moves adminAudit rows past the 90-day window into Storage and deletes them from Firestore. If it stops, the retention promise is not being kept.',
  },
  {
    id: 'run-erasures',
    label: 'GDPR erasure runner',
    cron: '0 4 * * *',
    runner: 'cloud-scheduler',
    target: '/api/admin/run-erasures',
    graceMinutes: 90,
    drives:
      'Executes accepted erasure requests. If it stops, personal data a customer asked us to delete is still here, and the clock on that request is still running.',
  },
  {
    id: 'report-usage-current',
    label: 'Metered usage rollup (current month)',
    cron: '0 7 * * *',
    runner: 'cloud-scheduler',
    target: '/api/billing/report-usage?month=current',
    graceMinutes: 90,
    drives:
      'Writes the in-progress month figure (AGL-2219). If it stops, every usage budget on the platform is structurally unable to fire and the Billing card stops totalling.',
  },
  {
    id: 'usage-alerts',
    label: 'Usage budget alerts',
    cron: '0 8 * * *',
    runner: 'cloud-scheduler',
    target: '/api/billing/usage-alerts',
    graceMinutes: 90,
    drives:
      'Evaluates usage budgets and notifies. If it stops, an org sails past its budget with no warning and finds out on the invoice.',
  },
  {
    id: 'reap-sending-domains',
    label: 'Orphaned sending-domain reaper',
    // An hour after `run-erasures`, which is what produces most of its work:
    // an erasure records what it could not release rather than waiting on a
    // vendor, and this is the only thing that settles that debt.
    cron: '0 5 * * *',
    runner: 'cloud-scheduler',
    target: '/api/admin/reap-sending-domains',
    graceMinutes: 90,
    drives:
      'Releases the provider domain object and the zone records of every sending domain whose site or workspace is gone. If it stops, each deleted site keeps one of a bounded number of provider domain slots forever — until the ceiling is reached and a site that asks for a domain of its own is refused one, which leaves it on the shared pool rather than stopping its mail — and leaves a live DKIM key in our zone under a label a future site can claim and inherit a stranger’s signature from.',
  },
  {
    id: 'reap-unverified-orgs',
    label: 'Unverified signup reaper',
    // 06:00, after `run-erasures` and the sending-domain sweep and before the
    // billing pair. It calls `eraseOrg` itself, so it wants the erasure runner
    // to have already finished with whatever it was holding.
    cron: '0 6 * * *',
    runner: 'cloud-scheduler',
    target: '/api/admin/reap-unverified-orgs?dryRun=0',
    graceMinutes: 90,
    drives:
      'Erases workspaces whose sole owner never confirmed an email address, releasing the workspace address they took, and promotes the held address of every owner who has since verified. If it stops, a name claimed with a throwaway inbox is held until its reservation expires — and, worse, a real customer who verified keeps a pending address that becomes claimable by anyone on day twenty-one.',
  },
  {
    id: 'usage-email',
    label: 'Monthly usage summaries',
    // Hourly across the FIRST TWO DAYS only (AGL-2409). The idle-period case
    // this whole check had to get right: for twenty-nine days a month this
    // job is correctly doing nothing, and must read green while it does.
    cron: '0 * 1-2 * *',
    runner: 'github-actions',
    target: '/api/billing/usage-email',
    graceMinutes: 360,
    drives:
      "Mails each org last month's usage summary, chunked across 48 hourly windows. If it stops, the month's summaries are simply never sent.",
  },
  {
    id: 'firestore-export',
    label: 'Weekly Firestore export',
    cron: '0 5 * * 1',
    runner: 'github-actions',
    target: '/api/admin/firestore-export',
    graceMinutes: 1440,
    drives:
      'Starts the independent GCS export — the restore point that exists because the managed backups kept flipping to NOT_AVAILABLE (AGL-1843). Also watched by output age on /api/health/backups.',
  },
  {
    id: 'reap-plugin-artifacts',
    label: 'Plugin artifact reaper',
    cron: '30 5 * * 1',
    runner: 'github-actions',
    target: '/api/admin/reap-plugin-artifacts',
    graceMinutes: 1440,
    drives:
      'Deletes orphaned plugin bundles from the artifacts bucket. If it stops, storage grows without bound and nothing says so.',
  },
  {
    id: 'reverify-plugin-versions',
    label: 'Plugin verdict re-verification',
    cron: '0 6 * * 1',
    runner: 'github-actions',
    target: '/api/admin/reverify-plugin-versions',
    graceMinutes: 1440,
    drives:
      'Re-checks stored plugin verdicts against the current verifier (AGL-1086). If it stops, a regression on a live version is never noticed.',
  },
  {
    id: 'reverify-sso-domains',
    label: 'SSO domain re-verification',
    // Mondays 07:30 UTC, after the rest of the weekly block. Weekly is the
    // right cadence because the threat needs a domain to lapse, clear a
    // registrar grace period and be re-bought — months, not days — and a
    // daily sweep would multiply DNS traffic by seven to learn nothing sooner.
    cron: '30 7 * * 1',
    runner: 'github-actions',
    target: '/api/admin/reverify-sso-domains',
    graceMinutes: 1440,
    drives:
      'Re-checks that every live SSO domain still publishes its DNS ownership token (AGL-1210). If it stops, a domain that changed hands keeps routing another company sign-ins and nothing notices. It reports only — it never revokes, because a revoke logs out an entire enterprise.',
  },
  {
    id: 'backfill-scope',
    label: 'Scope-drift detection',
    cron: '30 6 * * 1',
    runner: 'github-actions',
    target: '/api/admin/backfill-scope',
    graceMinutes: 1440,
    drives:
      'Reports documents with no visibleTo — invisible to every site-scoped read (AGL-1478). Detect-only by construction, so it has no output whose age could stand in for this mark.',
  },
  {
    id: 'campaigns-process-scheduled',
    label: 'Scheduled email campaigns',
    cron: '*/15 * * * *',
    // MOVED OFF GITHUB ACTIONS (AGL-1617), with the row below it. See the
    // grace note on `graceMinutes` for why that let the bar go UP.
    runner: 'cloud-scheduler',
    target: 'consoleFastCrons → console /api/campaigns/process-scheduled',
    graceMinutes: 45,
    drives:
      'Claims and sends due campaigns. If it stops, a campaign the composer showed as Scheduled sits there and never sends — the AGL-2134 shape, which is sold on /product/marketing.',
  },
  {
    id: 'lists-materialize',
    label: 'Dynamic email lists',
    // Shares the `consoleFastCrons` job with the two rows around it — one
    // Cloud Scheduler job driving three routes, which is why adding this cost
    // no scheduler quota.
    cron: '*/15 * * * *',
    runner: 'cloud-scheduler',
    target: 'consoleFastCrons \u2192 console /api/lists/materialize',
    graceMinutes: 45,
    drives:
      'Re-evaluates every dynamic list against its rule. If it stops, a list keeps whatever membership it last had, and a campaign sent to it reaches an audience that silently stopped tracking the rule the merchant wrote — which looks exactly like a rule that matched nobody new.',
  },
  {
    id: 'finish-domain-attachments',
    label: 'Custom domain re-check',
    // Every fifteen minutes rather than twenty since AGL-1617: it shares one
    // Cloud Scheduler job with the campaign processor, and AGL-2010's argument
    // was always that a customer is sitting there waiting for their site.
    cron: '*/15 * * * *',
    runner: 'cloud-scheduler',
    target: 'consoleFastCrons → console /api/admin/finish-domain-attachments',
    graceMinutes: 45,
    drives:
      'Re-checks pending custom domains after the certificate or DNS settles (AGL-2010). If it stops, a correctly-configured domain stays dark until a human presses Re-attach.',
  },
  {
    id: 'provision-sending-domains',
    label: 'Sending domain provisioning',
    // The fourth route on the `consoleFastCrons` job, sharing its schedule
    // with the three rows above. It is a console route rather than a job on
    // the platform beat because issuing a DKIM key needs a full-access
    // provider credential the tenant runtime must never hold.
    cron: '*/15 * * * *',
    runner: 'cloud-scheduler',
    target: 'consoleFastCrons → console /api/admin/provision-sending-domains',
    graceMinutes: 45,
    drives:
      'Turns a site’s sending-domain claim into a DKIM key and the DNS records that carry it. If it stops, every site that has ASKED for a domain of its own waits on a claim with no records to publish. Their mail keeps leaving on the shared pool throughout, which makes this a stall in reputation isolation rather than stopped mail — and it is invisible to the merchant, who sees only a domain that never finishes.',
  },
  {
    id: 'drain-publish-outbox',
    label: 'Publish outbox drain',
    // The fifth route on the `consoleFastCrons` job. Fifteen minutes is the
    // bound on how long a publish whose tab went away can stay invisible,
    // and it is the schedule this shares rather than one chosen for it —
    // buying a tighter one would mean a second Cloud Scheduler job against a
    // free-tier allowance of three.
    cron: '*/15 * * * *',
    runner: 'cloud-scheduler',
    target: 'consoleFastCrons \u2192 console /api/admin/drain-publish-outbox',
    graceMinutes: 45,
    drives:
      'Fires the cache-drop announce for publishes whose tab closed before it landed (AGL-2575). Publishing is a client Firestore write, so the announce is a fetch from the browser and a closed tab strands it; this is the only thing that finishes one. If it stops, a stranded publish is invisible on the live site for the full hour-long document TTL, and the pending entry that records it is never read by anything.',
  },
  {
    id: 'plugin-jobs-beat',
    label: 'Plugin job beat',
    // Cloud Scheduler says `every 1 minutes`; the equivalent five-field
    // expression is what this check evaluates against.
    cron: '* * * * *',
    runner: 'cloud-scheduler',
    target: 'firebase-schedule-pluginJobsBeat-us-central1 → tenant /api/plugins/run-jobs',
    graceMinutes: 30,
    drives:
      'The only thing that runs scheduled publishing and booking-hold expiry (AGL-1159). It is also the one job that can fail by pointing at the WRONG deployment (AGL-2176) — the mark is stamped by the tenant runner that answers, so a beat aimed elsewhere reads as silence here.',
  },
] as const

/** One job's most recent mark, as read from `CRON_BEAT_COLLECTION`. */
export interface CronBeat {
  jobId: string
  /** Epoch ms of the invocation that left the mark. */
  atMs: number
}

export interface CronJobCheck extends HealthCheck {
  /** The schedule this row was judged against, so the body is self-describing. */
  schedule: string
  runner: CronRunner
  /** Minutes since the job last reported. Null when it never has. */
  lastBeatAgeMinutes: number | null
  /**
   * The most recent fire time the job should already have reported for, ISO.
   * Null when no such time has passed since we started watching — which is
   * the healthy reading for a job that is legitimately idle.
   */
  dueAt: string | null
  graceMinutes: number
}

/**
 * A cron field, expanded to the set of values it matches.
 *
 * Supports a star, `a`, `a-b`, `a,b,c` and a trailing `/n` step on any of
 * them — every form the inventory and `scheduled-crons.yml` use, and nothing
 * else. An unparsable field returns null, which the caller treats as "matches
 * nothing". A schedule that can never fire then produces a null `dueAt` and
 * a green row rather than a permanent red one, and the wiring spec is what
 * catches the typo — a monitor that reds on its own parse bug teaches people
 * to ignore it.
 */
function expandCronField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number.parseInt(stepRaw, 10)
    if (!Number.isFinite(step) || step <= 0) return null
    let from: number
    let to: number
    if (range === '*') {
      from = min
      to = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      from = Number.parseInt(a, 10)
      to = Number.parseInt(b, 10)
    } else {
      from = Number.parseInt(range, 10)
      to = stepRaw === undefined ? from : max
    }
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null
    if (from < min || to > max || from > to) return null
    for (let value = from; value <= to; value += step) values.add(value)
  }
  return values.size ? values : null
}

interface ParsedCron {
  minute: Set<number> | null
  hour: Set<number> | null
  dayOfMonth: Set<number> | null
  month: Set<number> | null
  dayOfWeek: Set<number> | null
  /** True when either day field is restricted — the standard OR applies. */
  domRestricted: boolean
  dowRestricted: boolean
}

function parseCron(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  const parsed: ParsedCron = {
    minute: expandCronField(minute, 0, 59),
    hour: expandCronField(hour, 0, 23),
    dayOfMonth: expandCronField(dayOfMonth, 1, 31),
    month: expandCronField(month, 1, 12),
    dayOfWeek: expandCronField(dayOfWeek, 0, 6),
    domRestricted: dayOfMonth !== '*',
    dowRestricted: dayOfWeek !== '*',
  }
  if (
    !parsed.minute ||
    !parsed.hour ||
    !parsed.dayOfMonth ||
    !parsed.month ||
    !parsed.dayOfWeek
  ) {
    return null
  }
  return parsed
}

/**
 * Does this UTC date fall on a day the expression can fire?
 *
 * The day-of-month / day-of-week OR is the standard cron rule: when BOTH are
 * restricted the job fires on either, not on both. No expression in the
 * inventory restricts both, and the rule is implemented anyway so that one
 * added later is not silently misjudged.
 */
function cronDayMatches(parsed: ParsedCron, date: Date): boolean {
  if (!parsed.month.has(date.getUTCMonth() + 1)) return false
  const domHit = parsed.dayOfMonth.has(date.getUTCDate())
  const dowHit = parsed.dayOfWeek.has(date.getUTCDay())
  if (parsed.domRestricted && parsed.dowRestricted) return domHit || dowHit
  if (parsed.domRestricted) return domHit
  if (parsed.dowRestricted) return dowHit
  return true
}

/**
 * The latest time at or before `atMs` that `expression` fires, UTC.
 *
 * Null when the expression is unparsable, or when it does not fire inside
 * the lookback — 45 days, which comfortably clears the longest gap any
 * inventory entry has (`usage-email`'s twenty-nine idle days).
 *
 * Whole non-matching DAYS are skipped rather than walked minute by minute,
 * so the worst case is ~45 day checks plus 1,440 minute checks rather than
 * 64,800 of them.
 */
export function previousCronFire(
  expression: string,
  atMs: number,
  lookbackDays = 45,
): number | null {
  const parsed = parseCron(expression)
  if (!parsed) return null
  // Floor to the minute: a fire at 05:00:00 counts as due at 05:00:30.
  let cursor = Math.floor(atMs / 60_000) * 60_000
  const floor = cursor - lookbackDays * 86_400_000
  while (cursor >= floor) {
    const date = new Date(cursor)
    if (!cronDayMatches(parsed, date)) {
      // Jump to 23:59 of the previous UTC day.
      const startOfDay = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
      )
      cursor = startOfDay - 60_000
      continue
    }
    if (
      parsed.hour.has(date.getUTCHours()) &&
      parsed.minute.has(date.getUTCMinutes())
    ) {
      return cursor
    }
    cursor -= 60_000
  }
  return null
}

/**
 * The scheduled jobs, reduced to one health check per job (AGL-1955).
 *
 * `beats` null means the marks could not be read at all — degraded for every
 * row, the same rule `signupsHealth`, `rateLimitsHealth` and `beaconHealth`
 * follow. An alarm that cannot see the thing it watches must say so rather
 * than report calm; here it is the literal condition the issue is about.
 *
 * `watchStartedAtMs` is when this deployment first read the marks. A job with
 * no mark is silent only once a fire time has passed SINCE then — otherwise
 * every row would be red on the day this deploys, and `usage-email` would
 * stay red until the 1st.
 *
 * Pure on purpose, like its siblings: the route reads, this decides, the
 * spec exercises every branch without a network.
 */
export function cronJobsHealth(
  beats: readonly CronBeat[] | null,
  watchStartedAtMs: number,
  ms: number,
  now: number = Date.now(),
  jobs: readonly ScheduledJob[] = SCHEDULED_JOBS,
): Record<string, CronJobCheck> {
  const byId = new Map((beats ?? []).map((beat) => [beat.jobId, beat.atMs]))
  const checks: Record<string, CronJobCheck> = {}
  for (const job of jobs) {
    const lastBeatMs = byId.get(job.id) ?? null
    const lastBeatAgeMinutes =
      lastBeatMs === null ? null : Math.round((now - lastBeatMs) / 60_000)
    // The most recent fire time that is already past its grace. Everything
    // more recent than that is a run we are still waiting for, on time.
    const dueMs = previousCronFire(job.cron, now - job.graceMinutes * 60_000)
    const base = {
      ms,
      schedule: job.cron,
      runner: job.runner,
      lastBeatAgeMinutes,
      dueAt: dueMs === null ? null : new Date(dueMs).toISOString(),
      graceMinutes: job.graceMinutes,
    }
    if (beats === null) {
      checks[job.id] = { ...base, ok: false, code: 'beats-unavailable' }
      continue
    }
    if (dueMs === null) {
      // Nothing was due inside the lookback. Green, and honestly so.
      checks[job.id] = { ...base, ok: true }
      continue
    }
    if (lastBeatMs === null) {
      // Never reported. Only a defect once a fire time has passed since we
      // started watching — before that it is a job we have not met yet.
      const overdue = dueMs > watchStartedAtMs
      checks[job.id] = overdue
        ? { ...base, ok: false, code: 'job-never-reported' }
        : { ...base, ok: true, code: 'awaiting-first-run' }
      continue
    }
    checks[job.id] =
      lastBeatMs < dueMs
        ? { ...base, ok: false, code: 'job-silent' }
        : { ...base, ok: true }
  }
  return checks
}

/**
 * The mark a run leaves, and the only write on the beat path.
 *
 * Structurally typed against firebase-admin's Firestore rather than importing
 * it: this module is pure and is imported by tenant Server Components, and a
 * health verdict library that drags in the admin SDK would be a new reason
 * for a page to fail. The console routes, the marketing plugin's scheduled
 * campaign processor and the tenant job runner all pass their own handle.
 *
 * NEVER THROWS. A beat that cannot be written must not take down the job it
 * is describing — the monitor becoming the outage is its own failure mode.
 * It returns false instead, and a write that keeps failing shows up where it
 * should: as a silent job on the board.
 */
export interface CronBeatStore {
  collection(name: string): {
    doc(id: string): {
      set(data: Record<string, unknown>, options?: unknown): Promise<unknown>
    }
  }
}

export async function writeCronBeat(
  store: CronBeatStore,
  jobId: string,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    await store
      .collection(CRON_BEAT_COLLECTION)
      .doc(jobId)
      .set({ jobId, atMs: now, at: new Date(now).toISOString() }, { merge: true })
    return true
  } catch {
    return false
  }
}
