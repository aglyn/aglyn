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
  MAX_EXPORT_AGE_DAYS,
  backupsHealth,
  beaconHealth,
  billingWebhookHealth,
  exportsHealth,
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  MAX_ORG_CREATIONS_PER_WINDOW,
  ORG_CREATION_WINDOW_MINUTES,
  memoizeWithTtl,
  meteredPricingHealth,
  RATE_LIMIT_DEGRADED_WINDOW_MINUTES,
  rateLimitsHealth,
  MAX_SIGNUP_REFUSALS_PER_WINDOW,
  SIGNUP_REFUSAL_WINDOW_MINUTES,
  signupRefusalsHealth,
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
      version: '1.0.0-beta.6',
      environment: 'production',
      region: 'iad1',
      at: '2026-08-02T00:00:00.000Z',
    })
    expect(body).toEqual({
      status: 'ok',
      service: 'console',
      checks: { firestore: OK },
      commit: 'abc1234',
      // The field a self-host operator reads to know what they are running
      // (AGL-2091). `commit` alone could only ever be answered on Vercel.
      version: '1.0.0-beta.6',
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
    expect(body['version']).toBeNull()
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

  it('fails when the NEWEST backup is unusable — the AGL-1490 gap', () => {
    // The 2026-08-02 backup failed silently and sat unnoticed for 11 days.
    // What made it an incident is that it was the NEWEST thing there was:
    // nothing usable had been produced since. That must still page someone —
    // and it does, on FRESHNESS, which is the honest reason. (The code moved
    // from `backup-failed` to `backup-stale` in the second AGL-1843 pass: the
    // 2026-08-02 backup is READY today, so "that backup is broken" was never
    // a true statement about it. "There is no restore point inside the age
    // budget" was, and still is.)
    const check = backupsHealth(
      [
        { state: 'NOT_AVAILABLE', snapshotTime: days(11) },
        { state: 'READY', snapshotTime: days(14) },
      ],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('backup-stale')
    expect(check.states).toEqual({ NOT_AVAILABLE: 1, READY: 1 })
  })

  it('does NOT fail when the newest run flipped NOT_AVAILABLE behind a fresh READY (AGL-1843)', () => {
    // The live false red this pass removes. `NOT_AVAILABLE` is documented as
    // "not available AT THIS MOMENT" and was measured flipping in both
    // directions: eb4d21e3 went READY (08-13) → NOT_AVAILABLE (08-17) →
    // READY (08-24). So the moment Sunday's backup enters one of those
    // windows while last week's is still READY, the old rule ("a non-READY
    // backup newer than the newest READY one is a failure") fires 503
    // `backup-failed` — with a two-day-old restorable backup sitting right
    // there. On a five-minute email monitor that is ~288 mails a day.
    const check = backupsHealth(
      [
        { state: 'NOT_AVAILABLE', snapshotTime: days(0) },
        { state: 'READY', snapshotTime: days(2) },
      ],
      7,
      NOW,
    )
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(check.newestReadyAgeDays).toBe(2)
  })

  it('tolerates aged-out NOT_AVAILABLE backups behind a fresh READY (AGL-1843)', () => {
    // THE regression test. Managed backups flip READY → NOT_AVAILABLE at ~7
    // days and then linger for the ~90 days until `expireTime`, so a weekly
    // schedule that is working perfectly always shows a pile of them beside
    // one READY backup. The old rule failed on any of them, which made this
    // check structurally incapable of going green — it alerted continuously
    // from 2026-08-13 onward while the backups were in fact fine. Production
    // shape on 2026-08-18, verbatim from `gcloud firestore backups list`.
    const check = backupsHealth(
      [
        { state: 'NOT_AVAILABLE', snapshotTime: days(16) },
        { state: 'NOT_AVAILABLE', snapshotTime: days(9) },
        { state: 'READY', snapshotTime: days(2) },
      ],
      7,
      NOW,
    )
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(check.states).toEqual({ NOT_AVAILABLE: 2, READY: 1 })
    expect(check.newestReadyAgeDays).toBe(2)
  })

  it('refuses to date an undateable non-READY backup in its own favour', () => {
    // No `snapshotTime` means it cannot be shown to be older than anything,
    // and "assume it aged out" is the assumption that hides a genuinely
    // broken run. Only reachable once there is no fresh READY backup — with
    // one, recovery is possible and no other row can make that false.
    const check = backupsHealth(
      [{ state: 'NOT_AVAILABLE' }, { state: 'READY', snapshotTime: days(12) }],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('backup-failed')
  })

  it('still fails when nothing is READY, whatever the aged ones say', () => {
    const check = backupsHealth(
      [{ state: 'NOT_AVAILABLE', snapshotTime: days(16) }],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-ready-backup')
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

  it('fails on an empty listing — the schedule exists, so nothing is a failure', () => {
    const check = backupsHealth([], 7, NOW)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-ready-backup')
    expect(check.determinate).toBeUndefined()
  })

  it('is INDETERMINATE while the only run so far is still creating', () => {
    // "No run has completed yet" is not "the backup failed". Bounded: the
    // moment that CREATING backup passes the age budget without ever going
    // READY, the freshness rules below take over and this goes red.
    const check = backupsHealth([{ state: 'CREATING', snapshotTime: days(0) }], 7, NOW)
    expect(check.ok).toBe(true)
    expect(check.determinate).toBe(false)
    expect(check.code).toBe('backups-not-ready-yet')
  })

  it('is INDETERMINATE when every recent backup is inside a NOT_AVAILABLE window', () => {
    // Measured, not hypothesised: 3b5238df and eb4d21e3 were BOTH
    // NOT_AVAILABLE on 2026-08-17 and are BOTH READY on 2026-08-24. The
    // flips are independent per backup, so all of them landing in a window
    // at once is reachable — and it is a maintenance window, not a failure.
    const check = backupsHealth(
      [
        { state: 'NOT_AVAILABLE', snapshotTime: days(1) },
        { state: 'NOT_AVAILABLE', snapshotTime: days(7) },
      ],
      7,
      NOW,
    )
    expect(check.ok).toBe(true)
    expect(check.determinate).toBe(false)
    expect(check.code).toBe('backups-not-ready-yet')
    expect(check.newestReadyAgeDays).toBeNull()
  })

  it('goes RED once the NOT_AVAILABLE window outlasts the age budget', () => {
    // The bound on the tolerance above. Nothing usable for nine days is a
    // real loss of recovery capability whatever the states say.
    const check = backupsHealth(
      [{ state: 'NOT_AVAILABLE', snapshotTime: days(MAX_BACKUP_AGE_DAYS + 1) }],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-ready-backup')
  })

  it('treats a MISSING state as in-flight, not as a failure', () => {
    // proto3 JSON omits a default-valued field, so a backup in
    // `STATE_UNSPECIFIED` arrives with no `state` key at all. With
    // strictNullChecks off that absence compiles clean straight into a red.
    const check = backupsHealth([{ snapshotTime: days(0) }], 7, NOW)
    expect(check.ok).toBe(true)
    expect(check.code).toBe('backups-not-ready-yet')
    expect(check.states).toEqual({ STATE_UNSPECIFIED: 1 })
  })

  it('a state-less, date-less row cannot manufacture `backup-failed`', () => {
    // proto3 JSON omits BOTH default-valued fields, so a row Google has
    // created but not yet populated arrives as `{}`. `strictNullChecks` is
    // off repo-wide: those two `undefined`s sail through every comparison and
    // fold into the loudest verdict this function has. What is genuinely
    // wrong here is the STALE READY backup beside it, and that is what has to
    // be reported — the empty row is a run in flight, not a failed one.
    const check = backupsHealth(
      [{}, { state: 'READY', snapshotTime: days(MAX_BACKUP_AGE_DAYS + 4) }],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('backup-stale')
    expect(check.states).toEqual({ STATE_UNSPECIFIED: 1, READY: 1 })
  })

  it('is INDETERMINATE when the listing could not be read at all', () => {
    // An upstream that errored says nothing about the backups. Reporting it
    // as `backup-failed` is the AGL-1843 defect shape.
    const check = backupsHealth(null, 7, NOW, { code: 'http-503' })
    expect(check.ok).toBe(true)
    expect(check.determinate).toBe(false)
    expect(check.code).toBe('http-503')
    expect(check.states).toEqual({})
    expect(check.newestReadyAgeDays).toBeNull()
  })

  it('is INDETERMINATE, not red, when the listing came back PARTIAL', () => {
    // `ListBackupsResponse.unreachable`: the API returns what it could see
    // and names what it could not. "We saw no fresh READY backup" is not a
    // finding when we did not see everything.
    const check = backupsHealth([], 7, NOW, {
      unreachable: ['projects/p/locations/nam5'],
    })
    expect(check.ok).toBe(true)
    expect(check.determinate).toBe(false)
    expect(check.code).toBe('backups-partial')
  })

  it('still trusts POSITIVE evidence under a partial listing', () => {
    // Unreachable locations can only hide backups, never invent the fresh
    // READY one we can already see — so this stays green, not unknown.
    const check = backupsHealth([{ state: 'READY', snapshotTime: days(1) }], 7, NOW, {
      unreachable: ['projects/p/locations/nam5'],
    })
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(check.determinate).toBeUndefined()
  })

  it('a partial listing cannot mask an undateable broken backup', () => {
    const check = backupsHealth([{ state: 'NOT_AVAILABLE' }], 7, NOW, {
      unreachable: ['projects/p/locations/nam5'],
    })
    expect(check.ok).toBe(false)
    expect(check.code).toBe('backup-failed')
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

describe('exportsHealth', () => {
  // Fixed clock: 2026-08-24T12:00:00Z (a week after the first real export).
  const NOW = Date.parse('2026-08-24T12:00:00Z')
  const days = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

  it('is ok with a fresh completed export', () => {
    const check = exportsHealth([{ timeCreated: days(2) }], 7, NOW)
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(check.exportCount).toBe(1)
    expect(check.newestExportAgeDays).toBe(2)
  })

  it('judges only the NEWEST marker — old retained exports are history, not failures', () => {
    // The 90-day lifecycle keeps ~13 weekly exports around. Their ages are
    // the point of retention, not a symptom.
    const check = exportsHealth(
      [{ timeCreated: days(72) }, { timeCreated: days(2) }, { timeCreated: days(30) }],
      7,
      NOW,
    )
    expect(check.ok).toBe(true)
    expect(check.exportCount).toBe(3)
    expect(check.newestExportAgeDays).toBe(2)
  })

  it('fails when the newest export exceeds the age budget', () => {
    const check = exportsHealth([{ timeCreated: days(MAX_EXPORT_AGE_DAYS + 1) }], 7, NOW)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('export-stale')
    expect(check.newestExportAgeDays).toBe(MAX_EXPORT_AGE_DAYS + 1)
  })

  it('fails on an empty bucket — the cron exists, so nothing is a failure', () => {
    const check = exportsHealth([], 7, NOW)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-export')
    expect(check.exportCount).toBe(0)
    expect(check.newestExportAgeDays).toBeNull()
  })

  it('gives a marker with no parseable timestamp no freshness credit', () => {
    // A hung export never writes its completion marker; a garbled listing
    // must not masquerade as a fresh one.
    const check = exportsHealth([{ timeCreated: 'not-a-date' }, {}], 7, NOW)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-export')
    expect(check.exportCount).toBe(2)
    expect(check.newestExportAgeDays).toBeNull()
  })

  it('reports a failed listing as degraded, never as calm', () => {
    const check = exportsHealth(null, 7, NOW)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('exports-unavailable')
    expect(check.exportCount).toBeNull()
    expect(check.newestExportAgeDays).toBeNull()
  })

  it('exposes counts and an age only — no bucket names, no object paths', () => {
    const check = exportsHealth([{ timeCreated: days(1) }], 7, NOW)
    expect(Object.keys(check).sort()).toEqual([
      'exportCount',
      'ms',
      'newestExportAgeDays',
      'ok',
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

describe('beaconHealth (AGL-1923)', () => {
  const LOG = 'client-error-beacon-heartbeat'

  it('is ok when the heartbeat write reached Cloud Logging', () => {
    const check = beaconHealth({ ok: true }, LOG, 'console-web', 40)
    expect(check.ok).toBe(true)
    // No code on success — a body that always carries one teaches whoever
    // reads it during an incident that the field means nothing.
    expect(check.code).toBeUndefined()
    expect(healthHttpStatus(healthStatus({ beacon: check }))).toBe(200)
  })

  it('names the log and the deployment, so the body says what to go and query', () => {
    const check = beaconHealth({ ok: true }, LOG, 'tenant-web', 40)
    expect(check.logId).toBe(LOG)
    expect(check.service).toBe('tenant-web')
  })

  it('is degraded, with the transport code, when the write was rejected', () => {
    const check = beaconHealth({ ok: false, code: 'http-403' }, LOG, 'console-web', 40)
    expect(check.ok).toBe(false)
    // 403 is the revoked-IAM shape this whole check exists for — the code has
    // to survive into the body or the alert says "beacon down" and nothing else.
    expect(check.code).toBe('http-403')
    expect(healthHttpStatus(healthStatus({ beacon: check }))).toBe(503)
  })

  it('is degraded when the credential could not be minted', () => {
    const check = beaconHealth({ ok: false, code: 'no-credential' }, LOG, 'console-web', 3)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-credential')
  })

  it('falls back to a stable code when a failure carries none', () => {
    expect(beaconHealth({ ok: false }, LOG, 'console-web', 3).code).toBe(
      'heartbeat-failed',
    )
  })

  it('treats an unavailable heartbeat as degraded, never as calm', () => {
    // "We could not determine whether the beacon works" IS the AGL-1923
    // condition. A check that reports ok here would be the exact failure it
    // was built to catch, one layer up.
    const check = beaconHealth(null, LOG, 'console-web', 4000)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('heartbeat-unavailable')
    expect(healthHttpStatus(healthStatus({ beacon: check }))).toBe(503)
  })

  it('CLEARS: a degraded verdict does not latch — the next good write is ok', () => {
    // The AGL-1843 rule, enforced rather than asserted in prose. `backup-state`
    // sat red for four and a half days because its condition could not be
    // cleared by any event; this one has no state to carry, so the same inputs
    // in the other order give the other answer.
    const red = beaconHealth({ ok: false, code: 'http-429' }, LOG, 'console-web', 40)
    const green = beaconHealth({ ok: true }, LOG, 'console-web', 40)
    expect(red.ok).toBe(false)
    expect(green.ok).toBe(true)
  })
})

describe('billingWebhookHealth (AGL-1924)', () => {
  const HEALTHY = {
    endpointStatus: 'enabled' as const,
    undelivered: 0,
    emitted: 12,
    processed: 12,
    inert: 0,
    unsubscribedEvents: [] as readonly string[],
    connectEndpoint: 'enabled' as const,
    unsubscribedConnectEvents: [] as readonly string[],
  }

  it('is ok when the destination is enabled and nothing failed to deliver', () => {
    const check = billingWebhookHealth(HEALTHY, 90)
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(healthHttpStatus(healthStatus({ billingWebhook: check }))).toBe(200)
  })

  it('is ok on a QUIET window — zero events is not a failure', () => {
    // The AGL-1843 mistake in a new costume: at beta volume a night with no
    // deliveries is legitimate, and a freshness rule would page on it. The
    // verdict never keys on absence.
    const check = billingWebhookHealth(
      {
        endpointStatus: 'enabled',
        undelivered: 0,
        emitted: 0,
        processed: 0,
        inert: 0,
        unsubscribedEvents: [],
        connectEndpoint: 'enabled' as const,
        unsubscribedConnectEvents: [],
      },
      90,
    )
    expect(check.ok).toBe(true)
  })

  it('goes red when Stripe could not deliver — the AGL-1551 shape', () => {
    const check = billingWebhookHealth({ ...HEALTHY, undelivered: 7, processed: 0 }, 90)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('deliveries-failing')
    expect(healthHttpStatus(healthStatus({ billingWebhook: check }))).toBe(503)
  })

  it('goes red on ONE failed delivery — there is no organic baseline', () => {
    expect(billingWebhookHealth({ ...HEALTHY, undelivered: 1 }, 90).ok).toBe(false)
  })

  it('goes red when the destination is disabled, even with zero failures', () => {
    // Total silent failure: Stripe stops ATTEMPTING, so `undelivered` reads
    // zero and a delivery-only rule would call this healthy.
    const check = billingWebhookHealth(
      {
        endpointStatus: 'disabled',
        undelivered: 0,
        emitted: 40,
        processed: 0,
        inert: 0,
        unsubscribedEvents: [],
        connectEndpoint: 'enabled' as const,
        unsubscribedConnectEvents: [],
      },
      90,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('endpoint-disabled')
  })

  it('goes red when the destination is gone entirely', () => {
    const check = billingWebhookHealth(
      {
        endpointStatus: 'missing',
        undelivered: 0,
        emitted: 40,
        processed: 0,
        inert: 0,
        unsubscribedEvents: [],
        connectEndpoint: 'enabled' as const,
        unsubscribedConnectEvents: [],
      },
      90,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('endpoint-missing')
  })

  it('reports the endpoint problem in preference to the delivery count', () => {
    // The more actionable statement, and it EXPLAINS the other number.
    const check = billingWebhookHealth(
      {
        endpointStatus: 'missing',
        undelivered: 9,
        emitted: 40,
        processed: 0,
        inert: 0,
        unsubscribedEvents: [],
        connectEndpoint: 'enabled' as const,
        unsubscribedConnectEvents: [],
      },
      90,
    )
    expect(check.code).toBe('endpoint-missing')
  })

  it('treats an unavailable census as degraded — unknown is never a pass', () => {
    // The 2026-08-14 mis-tick: "no contrary evidence" read as "healthy" while
    // the live endpoint was 400ing every delivery.
    const check = billingWebhookHealth(null, 6000)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('stripe-unavailable')
    expect(check.undelivered).toBeNull()
    expect(check.endpointStatus).toBeNull()
  })

  it('stays ok when only the Firestore arm is unavailable', () => {
    // Stripe already answered the question that matters; a Firestore hiccup
    // must not manufacture a billing page.
    const check = billingWebhookHealth({ ...HEALTHY, processed: null }, 90)
    expect(check.ok).toBe(true)
    expect(check.processed).toBeNull()
  })

  it('carries emitted and processed WITHOUT letting them move the verdict', () => {
    // No floor for these exists until the beta produces a baseline, so they
    // are for the human reading the incident, not for the alarm.
    const check = billingWebhookHealth({ ...HEALTHY, emitted: 500, processed: 0 }, 90)
    expect(check.ok).toBe(true)
    expect(check.emitted).toBe(500)
    expect(check.processed).toBe(0)
  })

  it('CLEARS: a red window does not latch — the next clean window is ok', () => {
    const red = billingWebhookHealth({ ...HEALTHY, undelivered: 3 }, 90)
    const green = billingWebhookHealth(HEALTHY, 90)
    expect(red.ok).toBe(false)
    expect(green.ok).toBe(true)
  })

  it('describes its own window, so the body needs no external key', () => {
    expect(billingWebhookHealth(HEALTHY, 90).windowMinutes).toBe(60)
    expect(billingWebhookHealth(HEALTHY, 90, 15).windowMinutes).toBe(15)
  })

  /*==========================================
   * THE 200-THAT-DID-NOTHING (AGL-1954).
   *
   * Every assertion above is satisfied by a handler that answers 200 and
   * drops the work on the floor: the destination is enabled, Stripe records
   * a successful delivery, `undelivered` stays zero. These are the ones that
   * are not.
   *=========================================*/

  it('goes red when a delivery landed and moved NOTHING', () => {
    const check = billingWebhookHealth({ ...HEALTHY, inert: 1 }, 90)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('handlers-inert')
    expect(healthHttpStatus(healthStatus({ billingWebhook: check }))).toBe(503)
  })

  it('goes red on ONE inert delivery — the floor follows from the definition', () => {
    // Unlike `processed`, this count has no organic baseline to clear: a
    // legitimately irrelevant event NAMES its reason and never reaches here.
    expect(billingWebhookHealth({ ...HEALTHY, inert: 1 }, 90).ok).toBe(false)
    expect(billingWebhookHealth({ ...HEALTHY, inert: 0 }, 90).ok).toBe(true)
  })

  it('stays ok when the inert arm could not be read at all', () => {
    // Same rule as `processed`: a Firestore hiccup must not manufacture a
    // billing page when Stripe has already answered the question that matters.
    const check = billingWebhookHealth({ ...HEALTHY, inert: null }, 90)
    expect(check.ok).toBe(true)
    expect(check.inert).toBeNull()
  })

  it('CLEARS: an inert window does not latch', () => {
    // AGL-1843's lesson. This is an event, not a condition — the trailing
    // window on the reader is what makes it self-clearing.
    expect(billingWebhookHealth({ ...HEALTHY, inert: 4 }, 90).ok).toBe(false)
    expect(billingWebhookHealth(HEALTHY, 90).ok).toBe(true)
  })

  it('takes an inert threshold, so an incident can be muted without a deploy', () => {
    expect(billingWebhookHealth({ ...HEALTHY, inert: 2 }, 90, 60, 0, 5).ok).toBe(
      true,
    )
    expect(billingWebhookHealth({ ...HEALTHY, inert: 6 }, 90, 60, 0, 5).ok).toBe(
      false,
    )
  })

  it('reports every code that EXPLAINS inertness in preference to it', () => {
    // A handler with nothing to do because Stripe stopped sending is not a
    // broken handler. Naming the symptom over the cause is how an operator
    // gets sent to the wrong file.
    expect(
      billingWebhookHealth(
        { ...HEALTHY, endpointStatus: 'missing', inert: 9 },
        90,
      ).code,
    ).toBe('endpoint-missing')
    expect(
      billingWebhookHealth({ ...HEALTHY, undelivered: 3, inert: 9 }, 90).code,
    ).toBe('deliveries-failing')
    expect(
      billingWebhookHealth(
        { ...HEALTHY, unsubscribedEvents: ['charge.refunded'], inert: 9 },
        90,
      ).code,
    ).toBe('events-unsubscribed')
  })

  /*==========================================
   * SUBSCRIPTION COVERAGE (AGL-1948 / AGL-1798).
   *=========================================*/

  it('goes red when a REQUIRED event is not subscribed, with everything else green', () => {
    // The AGL-1798 shape exactly: `charge.refunded` missing from the live
    // destination. Stripe stops SENDING, so there is no failed delivery, no
    // rejected request and no inert handler — every other count reads a
    // perfectly healthy zero.
    const check = billingWebhookHealth(
      { ...HEALTHY, unsubscribedEvents: ['charge.refunded'] },
      90,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('events-unsubscribed')
    expect(check.unsubscribedEvents).toEqual(['charge.refunded'])
  })

  it('ranks a missing subscription ABOVE a delivery failure', () => {
    // Both are real, and this one names the exact event to re-add.
    const check = billingWebhookHealth(
      { ...HEALTHY, undelivered: 4, unsubscribedEvents: ['invoice.paid'] },
      90,
    )
    expect(check.code).toBe('events-unsubscribed')
  })

  it('stays ok when the endpoint did not state its subscriptions', () => {
    // An unanswered question is not an answer, and the check already has
    // `stripe-unavailable` for a census it could not take.
    const check = billingWebhookHealth(
      { ...HEALTHY, unsubscribedEvents: null },
      90,
    )
    expect(check.ok).toBe(true)
    expect(check.unsubscribedEvents).toBeNull()
  })

  /*==========================================
   * THE CONNECT DESTINATION (AGL-1948).
   *
   * A second destination that shares the platform one's URL. Every other case
   * in this describe can be green while this is broken, which is the whole
   * reason it needed its own facts.
   *=========================================*/
  it('goes red when there is NO Connect destination — the AGL-2122 shape', () => {
    // Measured on the live account 2026-08-18: one destination, right URL,
    // all ten events — and nothing that could ever deliver `account.updated`.
    // Every count in this check reads perfectly healthy in that state.
    const check = billingWebhookHealth(
      { ...HEALTHY, connectEndpoint: 'missing', unsubscribedConnectEvents: null },
      90,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('connect-endpoint-missing')
    expect(healthHttpStatus(healthStatus({ billingWebhook: check }))).toBe(503)
  })

  it('goes red when the Connect destination exists but is switched off', () => {
    const check = billingWebhookHealth(
      { ...HEALTHY, connectEndpoint: 'disabled', unsubscribedConnectEvents: [] },
      90,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('connect-endpoint-disabled')
  })

  it('goes red when the Connect destination lost account.updated', () => {
    const check = billingWebhookHealth(
      {
        ...HEALTHY,
        connectEndpoint: 'enabled',
        unsubscribedConnectEvents: ['account.updated'],
      },
      90,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('connect-events-unsubscribed')
  })

  it('reports a PLATFORM problem in preference to a Connect one', () => {
    // Both broken at once: the platform destination is this hour's revenue,
    // the Connect one is slower rot. The Connect facts still ride in the
    // body, so the board shows both — only the headline code is exclusive.
    const check = billingWebhookHealth(
      { ...HEALTHY, endpointStatus: 'missing', connectEndpoint: 'missing' },
      90,
    )
    expect(check.code).toBe('endpoint-missing')
    expect(check.connectEndpoint).toBe('missing')
  })

  it('stays ok when Connect is enabled and fully subscribed', () => {
    const check = billingWebhookHealth(HEALTHY, 90)
    expect(check.ok).toBe(true)
    expect(check.connectEndpoint).toBe('enabled')
  })

  it('carries null Connect facts through an unavailable census', () => {
    const check = billingWebhookHealth(null, 90)
    expect(check.code).toBe('stripe-unavailable')
    expect(check.connectEndpoint).toBeNull()
    expect(check.unsubscribedConnectEvents).toBeNull()
  })
})

describe('meteredPricingHealth (AGL-1931)', () => {
  const LIVE = { stripeConfigured: true, monthly: true, yearly: true }

  it('is ok when both intervals have a metered price', () => {
    const check = meteredPricingHealth(LIVE, 1)
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(check.unbilledInterval).toBeNull()
    expect(healthHttpStatus(healthStatus({ meteredPricing: check }))).toBe(200)
  })

  it('goes red when the YEARLY price is missing — the AGL-1931 shape', () => {
    // Annual subscribers accrue usage against the meter and carry no item to
    // bill it. Monthly subscribers are billed correctly, which is precisely
    // what makes it invisible.
    const check = meteredPricingHealth({ ...LIVE, yearly: false }, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('metered-price-asymmetric')
    expect(check.unbilledInterval).toBe('year')
    expect(healthHttpStatus(healthStatus({ meteredPricing: check }))).toBe(503)
  })

  it('goes red when the MONTHLY price is missing — the mirror shape', () => {
    // Same fault, other cohort. Naming only the yearly one would leave the
    // symmetric regression uncaught.
    const check = meteredPricingHealth({ ...LIVE, monthly: false }, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('metered-price-asymmetric')
    expect(check.unbilledInterval).toBe('month')
  })

  it('goes red when BOTH are missing on a Stripe-configured deployment', () => {
    // Total, not partial: this deployment can take money and cannot bill a
    // single unit of overage. The old two-ids-compared-to-each-other rule
    // called this calm.
    const check = meteredPricingHealth(
      { stripeConfigured: true, monthly: false, yearly: false },
      1,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('metered-price-missing')
    expect(check.unbilledInterval).toBe('both')
  })

  it('stays ok when Stripe itself is unconfigured — no money at stake', () => {
    // Local dev and fresh previews. Going red here would train everyone to
    // ignore this check, which is the same reasoning the checkout route
    // applies to its warning.
    const check = meteredPricingHealth(
      { stripeConfigured: false, monthly: false, yearly: false },
      1,
    )
    expect(check.ok).toBe(true)
    expect(check.code).toBe('stripe-unconfigured')
    expect(check.unbilledInterval).toBeNull()
  })

  it('does NOT excuse a half-configured deployment as unprovisioned', () => {
    // The tempting shortcut is "no Stripe key, ignore everything". A
    // deployment holding one metered price but no key is a misconfiguration
    // worth seeing, but it is NOT revenue loss — so it reports ok, and the
    // check must not claim otherwise in either direction.
    const check = meteredPricingHealth(
      { stripeConfigured: false, monthly: true, yearly: false },
      1,
    )
    expect(check.ok).toBe(true)
    expect(check.code).toBe('stripe-unconfigured')
  })

  it('carries the facts into the body so the verdict is auditable', () => {
    const check = meteredPricingHealth({ ...LIVE, yearly: false }, 7)
    expect(check.monthly).toBe(true)
    expect(check.yearly).toBe(false)
    expect(check.stripeConfigured).toBe(true)
    expect(check.ms).toBe(7)
  })
})

describe('signupRefusalsHealth (AGL-1907)', () => {
  const at = (ms: number, refusals: number, byReason: Record<string, number>) =>
    ({ refusals, byReason, refusedAtMs: ms })
  const NOW = 1_755_100_800_000

  it('ALLOWS legitimate use: zero refusals, and a fumbling human, stay green', () => {
    // The direction that ships a launch-day outage if it is wrong. A quiet
    // hour must be ok, and so must a real person who mistypes a workspace
    // slug into the 429 a handful of times.
    const quiet = signupRefusalsHealth([], 7, NOW)
    expect(quiet.ok).toBe(true)
    expect(quiet.code).toBeUndefined()
    expect(quiet.refusedSignups).toBe(0)

    const fumbling = signupRefusalsHealth([at(NOW, 4, { uid: 4 })], 7, NOW)
    expect(fumbling.ok).toBe(true)
    expect(fumbling.code).toBeUndefined()
  })

  it('is ok AT the threshold, not merely below it', () => {
    const atCap = signupRefusalsHealth(
      [at(NOW, MAX_SIGNUP_REFUSALS_PER_WINDOW, { ip: 50 })],
      7,
      NOW,
    )
    expect(atCap.ok).toBe(true)
    expect(atCap.code).toBeUndefined()
  })

  it('REFUSES: one past the threshold is a wave', () => {
    const check = signupRefusalsHealth(
      [at(NOW, MAX_SIGNUP_REFUSALS_PER_WINDOW + 1, { ip: 51 })],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('signup-refusal-wave')
    expect(check.refusedSignups).toBe(MAX_SIGNUP_REFUSALS_PER_WINDOW + 1)
  })

  it('sums across minute buckets and keeps the per-reason split', () => {
    // The split is the diagnosis: mostly `ip` is one address hammering,
    // mostly `uid` is many accounts, which is the distributed shape.
    const check = signupRefusalsHealth(
      [
        at(NOW, 30, { ip: 25, uid: 5 }),
        at(NOW - 60_000, 25, { ip: 20, uid: 5 }),
      ],
      7,
      NOW,
    )
    expect(check.refusedSignups).toBe(55)
    expect(check.refusedByReason).toEqual({ ip: 45, uid: 10 })
    expect(check.ok).toBe(false)
  })

  it('degrades when the query itself failed', () => {
    const check = signupRefusalsHealth(null, 7, NOW)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('refusals-unavailable')
    expect(check.refusedSignups).toBeNull()
    expect(check.refusedByReason).toBeNull()
  })

  it('honours a threshold override and self-describes its window', () => {
    // The forced-failure knob: SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR=-1 makes
    // every count over, which is how the red path was proven end to end.
    const check = signupRefusalsHealth([at(NOW, 0, {})], 7, NOW, -1)
    expect(check.ok).toBe(false)
    expect(check.threshold).toBe(-1)
    expect(check.windowMinutes).toBe(SIGNUP_REFUSAL_WINDOW_MINUTES)
  })

  it('dates itself from the newest marker, not the first one read', () => {
    const check = signupRefusalsHealth(
      [at(NOW - 600_000, 1, { uid: 1 }), at(NOW - 120_000, 1, { uid: 1 })],
      7,
      NOW,
    )
    expect(check.minutesSinceLast).toBe(2)
  })

  it('reports null minutesSinceLast when no marker carries a timestamp', () => {
    const check = signupRefusalsHealth([{ refusals: 3 }], 7, NOW)
    expect(check.minutesSinceLast).toBeNull()
    expect(check.refusedSignups).toBe(3)
  })

  it('a corrupt count cannot launder the verdict into NaN', () => {
    // NaN > threshold is false, so a bad field would report calm forever.
    const check = signupRefusalsHealth(
      [{ refusals: 200, byReason: { ip: 'lots' as any }, refusedAtMs: NOW }],
      7,
      NOW,
    )
    expect(check.ok).toBe(false)
    expect(check.refusedByReason).toEqual({ ip: 0 })
  })

  it('exposes counts only — no uid, no IP, no limiter key', () => {
    const check = signupRefusalsHealth([at(NOW, 2, { uid: 2 })], 7, NOW)
    expect(Object.keys(check).sort()).toEqual([
      'minutesSinceLast',
      'ms',
      'ok',
      'refusedByReason',
      'refusedSignups',
      'threshold',
      'windowMinutes',
    ])
  })
})
