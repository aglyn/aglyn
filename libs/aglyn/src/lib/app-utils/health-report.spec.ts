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

import {
  HEALTH_NO_STORE,
  MAX_BACKUP_AGE_DAYS,
  backupsHealth,
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  MAX_ORG_CREATIONS_PER_WINDOW,
  ORG_CREATION_WINDOW_MINUTES,
  memoizeWithTtl,
  RATE_LIMIT_DEGRADED_WINDOW_MINUTES,
  rateLimitsHealth,
  signupsHealth,
} from './health-report'

const OK = { ok: true, ms: 12 }
const BAD = { ok: false, ms: 5000, code: 'deadline-exceeded' }

describe('healthStatus', () => {
  it('is degraded if ANY check failed — no partial credit', () => {
    expect(healthStatus({ firestore: OK })).toBe('ok')
    expect(healthStatus({ firestore: OK, stripe: OK })).toBe('ok')
    expect(healthStatus({ firestore: OK, stripe: BAD })).toBe('degraded')
    expect(healthStatus({ firestore: BAD })).toBe('degraded')
  })

  it('treats no checks as ok rather than throwing', () => {
    // A liveness-only probe is a legitimate configuration; it must not 503.
    expect(healthStatus({})).toBe('ok')
  })
})

describe('the status code is the contract', () => {
  it('maps degraded to 503, not a 200 with a sad body', () => {
    // Most uptime monitors read the status code and nothing else. A 200 whose
    // body says "degraded" is a signal nobody receives.
    expect(healthHttpStatus('ok')).toBe(200)
    expect(healthHttpStatus('degraded')).toBe(503)
  })
})

describe('nothing may cache a health check', () => {
  it('sets no-store on success AND on failure', () => {
    // The failure response is the one you least want served from a cache: a
    // cached 503 outlives the outage, a cached 200 hides it.
    for (const status of ['ok', 'degraded'] as const) {
      expect(healthHeaders(status)['Cache-Control']).toBe(HEALTH_NO_STORE)
    }
  })

  it('spells out every directive a CDN might honour', () => {
    // `no-cache` alone permits a stored-and-revalidated copy; `max-age=0`
    // alone permits serving stale. Only the full set stops all of them.
    for (const directive of ['no-store', 'no-cache', 'must-revalidate', 'max-age=0']) {
      expect(`${directive}: ${HEALTH_NO_STORE.includes(directive)}`).toBe(
        `${directive}: true`,
      )
    }
  })

  it('is readable cross-origin, or the status page reports a false outage', () => {
    // The status page is served from a DIFFERENT deployment on purpose — a
    // status page hosted on the thing it reports on cannot survive its
    // outage. Without this header the browser blocks the read and every
    // service renders as down on a perfectly healthy day.
    for (const status of ['ok', 'degraded'] as const) {
      expect(healthHeaders(status)['Access-Control-Allow-Origin']).toBe('*')
    }
  })

  it('asks a monitor to retry only when degraded', () => {
    expect(healthHeaders('degraded')['Retry-After']).toBe('30')
    expect(healthHeaders('ok')['Retry-After']).toBeUndefined()
  })
})

describe('healthBody', () => {
  it('reports the service, the checks and which build answered', () => {
    const body = healthBody({
      service: 'console',
      checks: { firestore: OK },
      commit: 'abc1234',
      environment: 'production',
      region: 'iad1',
      at: '2026-08-02T00:00:00.000Z',
    })
    expect(body).toEqual({
      status: 'ok',
      service: 'console',
      checks: { firestore: OK },
      commit: 'abc1234',
      environment: 'production',
      region: 'iad1',
      at: '2026-08-02T00:00:00.000Z',
    })
  })

  it('nulls absent build metadata rather than omitting the keys', () => {
    // A probe that stores these must not have to distinguish "missing key"
    // from "unknown value" — the shape is the same every sample.
    const body = healthBody({ service: 'tenant', checks: {}, at: 'now' })
    expect(body['commit']).toBeNull()
    expect(body['environment']).toBeNull()
    expect(body['region']).toBeNull()
  })

  it('carries a failing check’s CODE and never a message', () => {
    const body = healthBody({ service: 'console', checks: { firestore: BAD }, at: 'now' })
    expect(body['status']).toBe('degraded')
    expect(JSON.stringify(body)).toContain('deadline-exceeded')
    // The endpoint is public. Anything resembling an internal detail must not
    // be reachable through it.
    expect(Object.keys(BAD)).toEqual(['ok', 'ms', 'code'])
  })
})

describe('backupsHealth', () => {
  // Fixed clock: 2026-08-13T12:00:00Z.
  const NOW = Date.parse('2026-08-13T12:00:00Z')
  const days = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

  it('is ok with a fresh READY backup', () => {
    const check = backupsHealth([{ state: 'READY', snapshotTime: days(4) }], 7, NOW)
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(check.newestReadyAgeDays).toBe(4)
    expect(check.states).toEqual({ READY: 1 })
  })

  it('fails on any NOT_AVAILABLE backup — the AGL-1490 gap', () => {
    // The 2026-08-02 backup failed silently and sat unnoticed for 11 days.
    // A fresh READY sibling does NOT excuse it: half the restore points being
    // gone is exactly the condition that must page someone.
    const check = backupsHealth(
      [
        { state: 'NOT_AVAILABLE', snapshotTime: days(11) },
        { state: 'READY', snapshotTime: days(4) },
      ],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('backup-failed')
    expect(check.states).toEqual({ NOT_AVAILABLE: 1, READY: 1 })
  })

  it('fails when the newest READY backup exceeds the age budget', () => {
    const check = backupsHealth(
      [{ state: 'READY', snapshotTime: days(MAX_BACKUP_AGE_DAYS + 1) }],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('backup-stale')
    expect(check.newestReadyAgeDays).toBe(MAX_BACKUP_AGE_DAYS + 1)
  })

  it('fails when no backup is READY at all — including an empty list', () => {
    // The schedule exists, so "no backups" is a failure, not a fresh start.
    expect(backupsHealth([], 7, NOW).code).toBe('no-ready-backup')
    expect(
      backupsHealth([{ state: 'CREATING', snapshotTime: days(0) }], 7, NOW).code,
    ).toBe('no-ready-backup')
  })

  it('tolerates CREATING beside a fresh READY — the Sunday window', () => {
    // Every week there is a moment where the newest backup is mid-creation.
    // Paging on that teaches everyone to ignore the alert; the age rule
    // still catches a backup that never finishes.
    const check = backupsHealth(
      [
        { state: 'READY', snapshotTime: days(6) },
        { state: 'CREATING', snapshotTime: days(0) },
      ],
      7,
      NOW,
    )
    expect(check.ok).toBe(true)
    expect(check.newestReadyAgeDays).toBe(6)
  })

  it('gives CREATING no freshness credit', () => {
    const check = backupsHealth(
      [
        { state: 'READY', snapshotTime: days(MAX_BACKUP_AGE_DAYS + 2) },
        { state: 'CREATING', snapshotTime: days(0) },
      ],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('backup-stale')
  })

  it('exposes counts only — no ids, no resource paths', () => {
    // The endpoint is public; the body must stay describable in one line.
    const check = backupsHealth([{ state: 'READY', snapshotTime: days(1) }], 7, NOW)
    expect(Object.keys(check).sort()).toEqual([
      'ms',
      'newestReadyAgeDays',
      'ok',
      'states',
    ])
  })
})

describe('signupsHealth', () => {
  it('is ok at the baseline — and AT the threshold, not merely below it', () => {
    // The AGL-1534 per-IP cap is 10/h. A single maxed-out address is the
    // limiter's job, not this alarm's: exactly 10 must stay green so the
    // alarm only speaks when the limiter is structurally blind.
    expect(signupsHealth(0, 7).ok).toBe(true)
    const atCap = signupsHealth(MAX_ORG_CREATIONS_PER_WINDOW, 7)
    expect(atCap.ok).toBe(true)
    expect(atCap.code).toBeUndefined()
  })

  it('degrades one past the threshold — the multi-address signature', () => {
    const check = signupsHealth(MAX_ORG_CREATIONS_PER_WINDOW + 1, 7)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('signup-wave')
    expect(check.recentOrgCreations).toBe(MAX_ORG_CREATIONS_PER_WINDOW + 1)
  })

  it('degrades when the count itself is unavailable', () => {
    // An alarm that cannot see the thing it watches must not report calm.
    const check = signupsHealth(null, 7)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('count-unavailable')
    expect(check.recentOrgCreations).toBeNull()
  })

  it('honours a threshold override and self-describes its window', () => {
    // The route may pass an env-tuned threshold; the body must say what was
    // asked so the on-call reader never guesses which rule fired.
    const check = signupsHealth(1, 7, 0)
    expect(check.ok).toBe(false)
    expect(check.threshold).toBe(0)
    expect(check.windowMinutes).toBe(ORG_CREATION_WINDOW_MINUTES)
  })

  it('exposes a count only — no org names, slugs or owners', () => {
    const check = signupsHealth(2, 7)
    expect(Object.keys(check).sort()).toEqual([
      'ms',
      'ok',
      'recentOrgCreations',
      'threshold',
      'windowMinutes',
    ])
  })
})

describe('rateLimitsHealth', () => {
  const NOW = 1_755_100_800_000
  const minutesAgo = (minutes: number) => NOW - minutes * 60_000

  it('is ok when no limiter has fallen back', () => {
    const check = rateLimitsHealth([], 4, NOW)
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(check.degradedCalls).toBe(0)
    expect(check.minutesSinceLast).toBeNull()
    expect(check.windowMinutes).toBe(RATE_LIMIT_DEGRADED_WINDOW_MINUTES)
  })

  it('is degraded when a limiter fell back inside the window', () => {
    const check = rateLimitsHealth(
      [{ calls: 12, episodes: 1, lastAtMs: minutesAgo(3), code: 'unavailable' }],
      4,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('rate-limiter-degraded')
    expect(check.degradedCalls).toBe(12)
    expect(check.degradedEpisodes).toBe(1)
    expect(check.minutesSinceLast).toBe(3)
  })

  it('goes GREEN again once the window has passed', () => {
    // The whole point of AGL-1693's constraint. Markers live 30 days, so a
    // recovered blip would otherwise hold this red for a month and the check
    // would be muted — which is worse than not having it. Contrast
    // /api/health/backups, red by design until the bad backup is gone.
    const marker = {
      calls: 400,
      episodes: 3,
      lastAtMs: minutesAgo(RATE_LIMIT_DEGRADED_WINDOW_MINUTES + 1),
    }
    expect(rateLimitsHealth([marker], 4, NOW).ok).toBe(true)
    expect(rateLimitsHealth([marker], 4, NOW).degradedCalls).toBe(0)
    // …and it was red while it was inside the window.
    expect(
      rateLimitsHealth(
        [marker],
        4,
        marker.lastAtMs + (RATE_LIMIT_DEGRADED_WINDOW_MINUTES - 1) * 60_000,
      ).ok,
    ).toBe(false)
  })

  it('sums across instances and dates itself from the most recent', () => {
    // Several markers in one window means several instances degraded.
    const check = rateLimitsHealth(
      [
        { calls: 5, episodes: 1, lastAtMs: minutesAgo(20) },
        { calls: 7, episodes: 2, lastAtMs: minutesAgo(2) },
        { calls: 999, episodes: 9, lastAtMs: minutesAgo(90) },
      ],
      4,
      NOW,
    )
    expect(check.degradedCalls).toBe(12)
    expect(check.degradedEpisodes).toBe(3)
    expect(check.minutesSinceLast).toBe(2)
  })

  it('ignores a marker with no `lastAtMs` rather than counting it as recent', () => {
    // A malformed or partially-written marker must not fake an incident.
    const check = rateLimitsHealth([{ calls: 4, episodes: 1 }], 4, NOW)
    expect(check.ok).toBe(true)
    expect(check.degradedCalls).toBe(0)
  })

  it('is degraded when the marker query itself failed', () => {
    // An alarm that cannot see the thing it watches must not report calm —
    // and this one reads the collection the limiter writes to.
    const check = rateLimitsHealth(null, 4, NOW)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('markers-unavailable')
    expect(check.degradedCalls).toBeNull()
    expect(check.degradedEpisodes).toBeNull()
  })

  it('honours the threshold override, including the forced-failure lever', () => {
    const marker = { calls: 3, episodes: 1, lastAtMs: minutesAgo(1) }
    expect(rateLimitsHealth([marker], 4, NOW, 5).ok).toBe(true)
    expect(rateLimitsHealth([marker], 4, NOW, 5).threshold).toBe(5)
    // -1 makes even a clean probe report degraded: the way the alert path is
    // proven end to end without inducing a real Firestore outage.
    expect(rateLimitsHealth([], 4, NOW, -1).ok).toBe(false)
  })
})

describe('memoizeWithTtl', () => {
  it('probes once inside the window and again after it', async () => {
    let calls = 0
    let clock = 1000
    const probe = memoizeWithTtl(15_000, async () => ++calls, () => clock)

    expect(await probe()).toBe(1)
    expect(await probe()).toBe(1)
    clock += 14_999
    expect(await probe()).toBe(1)
    clock += 2
    expect(await probe()).toBe(2)
    expect(calls).toBe(2)
  })

  it('caches FAILURES too, so an outage is not a stampede', async () => {
    // Re-probing per request hammers the dependency that is already failing,
    // and on a public endpoint that is someone else's lever.
    let calls = 0
    const clock = 0
    const probe = memoizeWithTtl(
      10_000,
      async () => {
        calls += 1
        return { ok: false, ms: 1 }
      },
      () => clock,
    )
    await probe()
    await probe()
    await probe()
    expect(calls).toBe(1)
  })

  it('does not cache across the boundary when the clock jumps backwards', async () => {
    // Serverless instances get reused across odd clock behaviour; a negative
    // elapsed must not read as "still fresh forever".
    let calls = 0
    let clock = 100_000
    const probe = memoizeWithTtl(10_000, async () => ++calls, () => clock)
    expect(await probe()).toBe(1)
    clock = 0
    expect(await probe()).toBe(2)
  })
})
