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
}

export interface CspReportView {
  windowDays: number
  since: string
  rowCount: number
  truncated: boolean
  rows: CspAggregateRow[]
  /** Total violations across the window — the number worth a headline. */
  totalViolations: number
  /** Distinct directives seen, most-violated first. */
  directives: Array<{ directive: string; count: number }>
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
  const byDirective = new Map<string, number>()
  let total = 0
  for (const row of rows) {
    const count = Number(row?.count ?? 0)
    const safe = Number.isFinite(count) ? count : 0
    total += safe
    const directive = String(row?.directive ?? 'unknown')
    byDirective.set(directive, (byDirective.get(directive) ?? 0) + safe)
  }
  return {
    windowDays: Number(body['windowDays'] ?? 0),
    since: String(body['since'] ?? ''),
    rowCount: Number(body['rowCount'] ?? rows.length),
    truncated: body['truncated'] === true,
    rows,
    totalViolations: total,
    directives: [...byDirective.entries()]
      .map(([directive, count]) => ({ directive, count }))
      .sort((a, b) => b.count - a.count),
  }
}
