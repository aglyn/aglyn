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
 * PLATFORM HEALTH — the reading half of the probes (AGL-1900).
 *
 * Five capabilities shipped as endpoints with no surface: `/api/health`,
 * `/api/health/backups` (AGL-1490/1843), `/api/health/rate-limits`
 * (AGL-1693), `/api/health/signups` (AGL-1536) and the staff-gated
 * `/api/admin/email-health` (AGL-709). Each answers a question an operator
 * has on a bad day, and each answered it only to a curl. This module turns
 * their bodies into something a staff page can render.
 *
 * ## The one thing this module must get right
 *
 * **A 503 is the ANSWER, not a failure to get one.** The health endpoints
 * speak a 200/503 contract: degraded IS the report. Code that treats
 * `!response.ok` as "the check could not be read" turns every real outage
 * into "unknown" — the precise inversion that makes a status board useless
 * exactly when it matters. `readHealthResponse` takes the status code and the
 * body separately and only reports `unreachable` when there is no body to
 * read at all.
 *
 * A check that is genuinely unreadable is NOT reported as healthy. There are
 * three states here, not two, and the third one is never quietly folded into
 * the good one.
 *
 * Pure: no fetch, no clock, no DOM. The page does the fetching.
 */

export type ProbeAuth = 'public' | 'staff'

export interface HealthProbeDescriptor {
  id: string
  label: string
  /** Path to fetch, query string included. */
  path: string
  auth: ProbeAuth
  /** What going red here actually means for customers. */
  meaning: string
  /** The first thing to do about it. */
  remedy: string
}

/**
 * The probes worth putting on one screen, in the order a bad day reads them:
 * is it serving, can it be restored, is it being abused, can it mail anyone.
 */
export const HEALTH_PROBES: readonly HealthProbeDescriptor[] = [
  {
    id: 'serving',
    label: 'Serving',
    path: '/api/health',
    auth: 'public',
    meaning:
      'The console and its dependencies answer. Degraded here means customers are seeing errors right now.',
    remedy:
      'Check the failing dependency code below, then the Vercel and Firebase status pages.',
  },
  {
    id: 'billing',
    label: 'Billing webhook',
    path: '/api/health/billing',
    auth: 'public',
    meaning:
      'Stripe still has an enabled destination for us, subscribed to every event we need, whose deliveries land ON THE FIRST ATTEMPT and actually move something — plus the separate Connect destination that carries connected-account events. Degraded means Stripe is trying to tell us about money and it is not getting through — subscriptions, refunds and entitlements stop moving while checkout keeps taking payments, or connected merchants keep selling on a charge-eligibility flag that stopped being refreshed.',
    remedy:
      'Read the code. endpoint-missing / endpoint-disabled is a Stripe dashboard fix. events-unsubscribed names the exact event that fell off the destination — `npm run setup:stripe` re-adds it (this is the AGL-1798 shape: no failed delivery, no error, just silence). deliveries-failing is ours (signature, a rolled secret). deliveries-retried means the deliveries DID land — on a second or later attempt, so earlier ones failed and every event-scored count above reads a healthy zero; this is the only arm that sees what the Stripe Dashboard error rate sees, so read the `retriedAtMs` events in stripeEvents for the ids, types and lag, and check what was failing at that hour (a deploy, a cold start, a rolled secret half-applied). handlers-inert is the worst one and the least obvious: deliveries ARE landing and answering 200, and the handler is doing nothing with them — check what stopped being registered, then read the `inert: true` events in stripeEvents for the ids and types. connect-endpoint-missing / connect-endpoint-disabled / connect-events-unsubscribed are the SECOND destination, not the one above: connected-account events are delivered only to a destination created with `connect: true`, so without it `syncConnectAccountStatus` never runs and a merchant whose Stripe account got restricted keeps selling until a shopper meets the failure at payment. `npm run setup:stripe` creates it — note `connect: true` is settable only at creation, so a wrong one must be deleted, not edited. Run `npm run audit:stripe-webhook` for the full join. A quiet window with no events is healthy, not blind — this never keys on the absence of deliveries.',
  },
  {
    id: 'errorBeacon',
    label: 'Error beacon',
    path: '/api/health/error-beacon',
    auth: 'public',
    meaning:
      'The client-error beacon can still reach Cloud Logging. Degraded means browser errors are being collected by nothing — and a dead beacon reads as ZERO errors everywhere else, which is indistinguishable from a clean day.',
    remedy:
      'no-credential is the deployment FIREBASE_* env, http-401/403 is a lost logging.logEntries.create grant, http-429 is quota. Clears on the next heartbeat that lands. The tenant runtime has its own credential and its own copy of this probe.',
  },
  {
    id: 'backups',
    label: 'Backups & exports',
    path: '/api/health/backups',
    auth: 'public',
    meaning:
      'A restore point exists and is recent. Degraded means the worst day would have nothing to restore from — the failure that went unnoticed for eleven days in AGL-1490.',
    remedy:
      'Read the state histogram: NOT_AVAILABLE backups are the Google-managed ones failing, a stale export age means the weekly export job stopped running.',
  },
  {
    id: 'crons',
    label: 'Scheduled jobs',
    path: '/api/health/crons',
    auth: 'public',
    meaning:
      'Every scheduled job is still BEING SCHEDULED. Degraded means one of them stopped firing and said nothing — the failure everything else here is blind to, because every other cron signal is triggered by a run. Downstream of these rows are metered billing, GDPR erasures, the audit archive and scheduled publishing: a silently unscheduled job means customers are not billed, or data is not reaped, with the rest of this board green.',
    remedy:
      "Read the row, then read its RUNNER — the two fail differently. A GitHub Actions row that is job-silent: check `.github/workflows/scheduled-crons.yml` still carries its `- cron:` line, then the workflow's recent runs (GitHub disables scheduled workflows on a repo with no activity for 60 days, and it also coalesces and silently DROPS triggers under load — that is AGL-1617, which is why nothing sub-hourly lives there any more). A Cloud Scheduler row that is job-silent: `gcloud scheduler jobs list --project=aglyn-main` should show firebase-schedule-pluginJobsBeat-us-central1 and firebase-schedule-consoleFastCrons-us-central1; then `gcloud functions logs read consoleFastCrons` for the status it got back — a 401 is CRON_SECRET drift, a 429 is Bot Protection with AGLYN_PROBE_TOKEN unset, and 'skipped' means AGLYN_CONSOLE_URL is unset. plugin-jobs-beat also reads silent when AGLYN_JOB_RUNNER_URL points at another deployment. job-never-reported means it has not run ONCE since we started watching: usually a route that 404s in production because the promotion never happened. beats-unavailable is our own Firestore read, not the jobs. A job in a legitimately idle stretch is green on purpose and never counts here.",
  },
  {
    id: 'rateLimits',
    label: 'Rate limiters',
    path: '/api/health/rate-limits',
    auth: 'public',
    meaning:
      'No durable limiter fell back recently. Degraded means sign-in, password reset, form submit and the public API were bounded per-instance instead of globally — the door was wider than intended.',
    remedy:
      'A past episode clears itself as the window rolls forward. Several episodes means more than one instance saw it — check Firestore availability for that window.',
  },
  {
    id: 'signups',
    label: 'Signup volume',
    path: '/api/health/signups',
    auth: 'public',
    meaning:
      'Organization creation is at normal volume. Degraded means a signup wave the per-uid and per-IP limits cannot see — a distributed farm holding every actor under both caps.',
    remedy:
      'The manual response is the signups feature lock on Staff → Lockdown.',
  },
  {
    id: 'email',
    label: 'Email delivery',
    path: '/api/admin/email-health?probe=1',
    auth: 'staff',
    meaning:
      'This deployment can actually send mail. Misconfigured means invites, password resets and receipts silently go nowhere — every sender no-ops without BOTH the key and the sender address.',
    remedy:
      'The blockers listed below are in the order they stop delivery. Domain verification is not observable here, so a clean report can still bounce until DNS is verified.',
  },
] as const

export type HealthVerdict = 'ok' | 'degraded' | 'unreachable'

export interface HealthCheckLine {
  name: string
  ok: boolean
  ms: number | null
  code: string | null
  /** Figures the check carries, already worded. Empty when it carries none. */
  facts: string[]
}

export interface HealthProbeResult {
  id: string
  verdict: HealthVerdict
  /** HTTP status observed, or null when the request never answered. */
  httpStatus: number | null
  checks: HealthCheckLine[]
  /** Populated only when `verdict` is `unreachable`. */
  error: string | null
}

/**
 * A number, or null.
 *
 * `null` and `''` are excluded explicitly because `Number(null)` is `0` and
 * `Number('')` is `0` — both finite. The health bodies use `null` to mean
 * "there is none" (no usable backup, no export, the count query failed), so
 * coercing would render "newest usable backup is 0 days old" over the top of
 * "there is no usable backup": a reassuring figure where the alarm belongs.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The figures a check carries, worded — `{ states: { READY: 1 } }` is not
 * something to put on a screen, and an operator reading a red board should
 * not have to expand a JSON blob to learn the backup is nine days old.
 */
function checkFacts(name: string, check: Record<string, unknown>): string[] {
  const facts: string[] = []
  const states = check['states']
  if (states && typeof states === 'object') {
    const entries = Object.entries(states as Record<string, unknown>)
    if (entries.length) {
      facts.push(
        entries.map(([state, count]) => `${count} ${state}`).join(' · '),
      )
    } else {
      facts.push('no backups listed at all')
    }
  }
  const age = num(check['newestReadyAgeDays'])
  if (age !== null) {
    facts.push(`newest usable backup is ${age} day${age === 1 ? '' : 's'} old`)
  } else if ('newestReadyAgeDays' in check) {
    facts.push('no usable backup exists')
  }
  const exportCount = num(check['exportCount'])
  if (exportCount !== null) facts.push(`${exportCount} exports retained`)
  const exportAge = num(check['newestExportAgeDays'])
  if (exportAge !== null) {
    facts.push(`newest export is ${exportAge} day${exportAge === 1 ? '' : 's'} old`)
  }
  const degradedCalls = num(check['degradedCalls'])
  if (degradedCalls !== null) {
    facts.push(`${degradedCalls} fallback calls in window`)
  }
  const episodes = num(check['degradedEpisodes'])
  if (episodes !== null) {
    facts.push(
      `${episodes} instance-episode${episodes === 1 ? '' : 's'}` +
        (episodes > 1 ? ' — more than one instance saw it' : ''),
    )
  }
  const sinceLast = num(check['minutesSinceLast'])
  if (sinceLast !== null) facts.push(`last fallback ${sinceLast} min ago`)
  const creations = num(check['recentOrgCreations'])
  if (creations !== null) facts.push(`${creations} orgs created in window`)
  /*==========================================
   * THE 200-THAT-DID-NOTHING, WORDED (AGL-1954 / AGL-1948).
   *
   * `handlers-inert` and `events-unsubscribed` are the two billing codes an
   * operator has never seen before, and both describe a system that looks
   * fine from every other angle. A bare code on the board would send someone
   * to Stripe's dashboard, where everything is green — which is exactly the
   * wrong place and exactly what happened on 2026-08-14. So the board says
   * the number AND what it means.
   *=========================================*/
  const inert = num(check['inert'])
  if (inert !== null) {
    facts.push(
      inert === 0
        ? 'every delivery in window moved something'
        : `${inert} deliver${inert === 1 ? 'y' : 'ies'} answered 200 and moved NOTHING`,
    )
  } else if ('inert' in check) {
    facts.push('could not tell whether deliveries did anything')
  }
  /*==========================================
   * THE ATTEMPTS THE EVENT COUNTS CANNOT SEE, WORDED (AGL-2039).
   *
   * `undelivered: 0` sits directly above this line and means "no event failed
   * EVERY attempt". A reader takes that as "no failures", which is how
   * AGL-1906's 0.00% got quoted against the Stripe Dashboard's 30%. So this
   * line says attempts, out loud, next to it.
   *=========================================*/
  const retried = num(check['retried'])
  if (retried !== null) {
    facts.push(
      retried === 0
        ? 'every delivery landed on its first attempt'
        : `${retried} deliver${retried === 1 ? 'y' : 'ies'} only landed on a RETRY — earlier attempts failed`,
    )
  } else if ('retried' in check) {
    facts.push('could not tell whether any delivery needed a retry')
  }
  const unsubscribed = check['unsubscribedEvents']
  if (Array.isArray(unsubscribed)) {
    facts.push(
      unsubscribed.length === 0
        ? 'every required event subscribed'
        : `NOT subscribed: ${unsubscribed.join(', ')}`,
    )
  } else if ('unsubscribedEvents' in check) {
    facts.push('the destination did not state its subscriptions')
  }
  /*==========================================
   * THE SECOND DESTINATION, WORDED (AGL-1948).
   *
   * Every other billing fact on this tile is about the platform destination.
   * This one is about a different endpoint that shares its URL, so the words
   * have to say "Connect" or a reader will fold it into the line above and
   * conclude the platform destination is broken.
   *=========================================*/
  const connectEndpoint = check['connectEndpoint']
  if (typeof connectEndpoint === 'string') {
    facts.push(
      connectEndpoint === 'enabled'
        ? 'Connect destination enabled'
        : connectEndpoint === 'disabled'
          ? 'Connect destination DISABLED — connected-account events are not being delivered'
          : 'NO Connect destination — every merchant’s charge-eligibility flag is going stale',
    )
  }
  const unsubscribedConnect = check['unsubscribedConnectEvents']
  if (Array.isArray(unsubscribedConnect) && unsubscribedConnect.length > 0) {
    facts.push(`Connect NOT subscribed: ${unsubscribedConnect.join(', ')}`)
  }
  /*==========================================
   * A JOB THAT STOPPED BEING SCHEDULED, WORDED (AGL-1955).
   *
   * The row's name is the job id, which says nothing about when it was
   * supposed to run — and the whole point of the check is that "quiet" and
   * "healthy" look identical until you know the schedule. So the board says
   * the cadence, the last time it reported, and, when it is red, the run it
   * missed. Someone reading this at 3am should be able to go straight to the
   * workflow file without opening the issue history.
   *=========================================*/
  const schedule = check['schedule']
  if (typeof schedule === 'string') {
    const runner = check['runner']
    facts.push(
      `${runner === 'cloud-scheduler' ? 'Cloud Scheduler' : 'GitHub Actions'} · ${schedule} UTC`,
    )
  }
  if ('lastBeatAgeMinutes' in check) {
    const age = num(check['lastBeatAgeMinutes'])
    facts.push(
      age === null
        ? 'has NEVER reported a run'
        : age < 120
          ? `last ran ${age} min ago`
          : `last ran ${Math.round((age / 60) * 10) / 10} h ago`,
    )
  }
  const dueAt = check['dueAt']
  if (typeof dueAt === 'string' && check['ok'] !== true) {
    facts.push(`should have run at ${dueAt}`)
  }
  const graceMinutes = num(check['graceMinutes'])
  if (graceMinutes !== null) facts.push(`grace ${graceMinutes} min`)
  const windowMinutes = num(check['windowMinutes'])
  if (windowMinutes !== null) facts.push(`window ${windowMinutes} min`)
  const threshold = num(check['threshold'])
  if (threshold !== null) facts.push(`threshold ${threshold}`)
  return facts
}

/**
 * One health endpoint's answer, normalized.
 *
 * `httpStatus` may be 503 — that is a successful read of a degraded system,
 * and it must not be confused with a failure to read. `body` null (a network
 * error, a parse failure) is the only thing that makes a probe unreachable.
 */
export function readHealthResponse(
  httpStatus: number | null,
  body: Record<string, unknown> | null,
): HealthProbeResult {
  if (!body) {
    return {
      id: '',
      verdict: 'unreachable',
      httpStatus,
      checks: [],
      error:
        httpStatus === null
          ? 'The probe did not answer.'
          : `The probe answered ${httpStatus} with no readable body.`,
    }
  }
  // A staff-gated probe refusing the caller is unreachable, not healthy: a
  // board that renders "ok" because it was told 403 is the worst outcome here.
  if (httpStatus !== null && httpStatus !== 200 && httpStatus !== 503) {
    return {
      id: '',
      verdict: 'unreachable',
      httpStatus,
      checks: [],
      error:
        typeof body['error'] === 'string'
          ? body['error']
          : `The probe answered ${httpStatus}.`,
    }
  }
  const rawChecks = body['checks']
  const checks: HealthCheckLine[] =
    rawChecks && typeof rawChecks === 'object'
      ? Object.entries(rawChecks as Record<string, unknown>).map(
          ([name, raw]) => {
            const check = (raw ?? {}) as Record<string, unknown>
            return {
              name,
              ok: check['ok'] === true,
              ms: num(check['ms']),
              code: typeof check['code'] === 'string' ? check['code'] : null,
              facts: checkFacts(name, check),
            }
          },
        )
      : []
  // Trust the body's own verdict when it states one; fall back to the status
  // code, which the endpoints derive from exactly the same computation.
  const stated = body['status']
  const verdict: HealthVerdict =
    stated === 'ok' || stated === 'degraded'
      ? stated
      : httpStatus === 503
        ? 'degraded'
        : checks.some((check) => !check.ok)
          ? 'degraded'
          : 'ok'
  return { id: '', verdict, httpStatus, checks, error: null }
}

/** The email probe answers 200 with its own shape rather than `checks`. */
export function readEmailHealthResponse(
  httpStatus: number | null,
  body: Record<string, unknown> | null,
): HealthProbeResult {
  if (!body || (httpStatus !== null && httpStatus !== 200)) {
    return {
      id: 'email',
      verdict: 'unreachable',
      httpStatus,
      checks: [],
      error:
        (body && typeof body['error'] === 'string' && body['error']) ||
        (httpStatus === null
          ? 'The probe did not answer.'
          : `The probe answered ${httpStatus}.`),
    }
  }
  const blockers = Array.isArray(body['blockers'])
    ? (body['blockers'] as unknown[]).map(String)
    : []
  const credentials = (body['credentials'] ?? null) as {
    status?: string
    detail?: string
  } | null
  const facts: string[] = [
    body['hasApiKey'] ? 'API key present' : 'API key MISSING',
    body['hasFrom'] ? 'sender address present' : 'sender address MISSING',
  ]
  if (body['fromDomain']) facts.push(`sends from ${body['fromDomain']}`)
  if (credentials?.status) {
    facts.push(`credential probe: ${credentials.status}`)
  }
  return {
    id: 'email',
    verdict: body['healthy'] === true ? 'ok' : 'degraded',
    httpStatus,
    checks: [
      {
        name: 'delivery',
        ok: body['healthy'] === true,
        ms: null,
        code: blockers.length ? 'blocked' : null,
        facts: [...facts, ...blockers],
      },
    ],
    error: null,
  }
}

export interface PlatformHealthSummary {
  degraded: string[]
  unreachable: string[]
  ok: string[]
  /** True only when every probe answered and every one is healthy. */
  allGreen: boolean
}

/**
 * The board's headline.
 *
 * `allGreen` requires every probe to have ANSWERED. A page that says "all
 * systems normal" while two probes never replied is stating something it did
 * not check — the green that only proves what it read.
 */
export function summarizePlatformHealth(
  results: readonly HealthProbeResult[],
): PlatformHealthSummary {
  const pick = (verdict: HealthVerdict) =>
    results.filter((result) => result.verdict === verdict).map((r) => r.id)
  const degraded = pick('degraded')
  const unreachable = pick('unreachable')
  const ok = pick('ok')
  return {
    degraded,
    unreachable,
    ok,
    allGreen:
      results.length === HEALTH_PROBES.length &&
      degraded.length === 0 &&
      unreachable.length === 0 &&
      ok.length === HEALTH_PROBES.length,
  }
}

export interface CspAggregateRow {
  day?: string
  app?: string
  directive?: string
  blockedOrigin?: string
  count?: number
  lastSite?: string
  lastPath?: string
  /**
   * `enforce` means the browser BLOCKED it; `report` means a report-only
   * policy measured it and the script or image loaded anyway. The collector
   * has always stored this — the summary above it did not read it, so a
   * blocked login script and a measured analytics pixel counted the same.
   */
  disposition?: 'enforce' | 'report'
  /** Epoch millis of the most recent report in this row. */
  lastSeenMs?: number
}

export interface CspReportView {
  windowDays: number
  since: string
  rowCount: number
  truncated: boolean
  rows: CspAggregateRow[]
  /** Total violations across the window — the number worth a headline. */
  totalViolations: number
  /**
   * Distinct directives seen, most-violated first.
   *
   * `blocked` and `reported` are split because they are different questions.
   * `reported` is the flip decision — what a stricter policy WOULD break.
   * `blocked` is an incident: something did not run, for somebody, on a page
   * that is live.
   *
   * `lastBlockedMs` is what stops a resolved incident reading as an ongoing
   * one. Twenty-two blocked inline scripts on `/signin` and `/app` sat in a
   * fourteen-day window for a week after they stopped happening, and the
   * summary presented them exactly as it presented that morning's reports.
   */
  directives: Array<{
    directive: string
    count: number
    blocked: number
    reported: number
    lastBlockedMs: number | null
  }>
  /** Newest ENFORCED violation in the window, or null when there is none. */
  lastBlockedMs: number | null
}

/**
 * The CSP counters, reduced to what a flip decision needs (AGL-1799).
 *
 * The question these rows answer is "would enforcing this directive break
 * anything?", so the totals are per DIRECTIVE — a directive with zero rows
 * across the window is one that can be enforced, and that is the whole point
 * of having collected them.
 */
export function readCspReport(
  body: Record<string, unknown> | null,
): CspReportView | null {
  if (!body || !Array.isArray(body['rows'])) return null
  const rows = (body['rows'] as CspAggregateRow[]) ?? []
  const byDirective = new Map<
    string,
    { count: number; blocked: number; reported: number; lastBlockedMs: number | null }
  >()
  let total = 0
  let lastBlockedMs: number | null = null
  for (const row of rows) {
    const count = Number(row?.count ?? 0)
    const safe = Number.isFinite(count) ? count : 0
    total += safe
    const directive = String(row?.directive ?? 'unknown')
    const entry = byDirective.get(directive) ?? {
      count: 0,
      blocked: 0,
      reported: 0,
      lastBlockedMs: null,
    }
    entry.count += safe
    // Anything not explicitly `enforce` is treated as measured. An unknown
    // disposition must not be able to invent an incident.
    if (row?.disposition === 'enforce') {
      entry.blocked += safe
      const seen = Number(row?.lastSeenMs ?? 0)
      if (Number.isFinite(seen) && seen > 0) {
        entry.lastBlockedMs = Math.max(entry.lastBlockedMs ?? 0, seen)
        lastBlockedMs = Math.max(lastBlockedMs ?? 0, seen)
      }
    } else {
      entry.reported += safe
    }
    byDirective.set(directive, entry)
  }
  return {
    windowDays: Number(body['windowDays'] ?? 0),
    since: String(body['since'] ?? ''),
    rowCount: Number(body['rowCount'] ?? rows.length),
    truncated: body['truncated'] === true,
    rows,
    totalViolations: total,
    directives: [...byDirective.entries()]
      .map(([directive, entry]) => ({ directive, ...entry }))
      // Blocked first whatever the volume: one script that did not run
      // outranks a thousand measured ones.
      .sort((a, b) => b.blocked - a.blocked || b.count - a.count),
    lastBlockedMs,
  }
}
