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
 * AGL-1955 — a job that stops being scheduled must turn this red.
 *
 * The point of the file is the pair of properties in the middle: the
 * detector goes RED when a job stops reporting, and it stays GREEN through a
 * period the job is legitimately not running. A monitor that cannot do the
 * first is the bug; one that cannot do the second gets muted, which is the
 * same bug with extra steps.
 */
import {
  CRON_BEAT_COLLECTION,
  SCHEDULED_JOBS,
  cronJobsHealth,
  healthStatus,
  previousCronFire,
  writeCronBeat,
  type CronBeat,
} from './health-report'

/** Wednesday 2026-08-19 12:00 UTC. Not the 1st or 2nd, deliberately. */
const NOW = Date.parse('2026-08-19T12:00:00.000Z')
const MINUTE = 60_000
const DAY = 86_400_000

/** Watching since a fortnight ago, so no row is in its bootstrap window. */
const WATCHING_SINCE = NOW - 14 * DAY

/** Every job reported one minute ago — the all-green baseline. */
function allFresh(atMs = NOW - MINUTE): CronBeat[] {
  return SCHEDULED_JOBS.map((job) => ({ jobId: job.id, atMs }))
}

describe('previousCronFire', () => {
  it('finds the last daily fire', () => {
    expect(previousCronFire('0 2 * * *', NOW)).toBe(
      Date.parse('2026-08-19T02:00:00.000Z'),
    )
  })

  it('finds the last weekly fire — Monday, three days back', () => {
    expect(previousCronFire('0 5 * * 1', NOW)).toBe(
      Date.parse('2026-08-17T05:00:00.000Z'),
    )
  })

  it('walks back across a month boundary for a day-of-month schedule', () => {
    // `usage-email` on the 19th: the last hour it ever ran was 23:00 on the
    // 2nd. Seventeen days of legitimate idleness, found without walking
    // 24,000 minutes one at a time.
    expect(previousCronFire('0 * 1-2 * *', NOW)).toBe(
      Date.parse('2026-08-02T23:00:00.000Z'),
    )
  })

  it('handles step and range fields', () => {
    expect(previousCronFire('*/15 * * * *', Date.parse('2026-08-19T12:07:00Z'))).toBe(
      Date.parse('2026-08-19T12:00:00.000Z'),
    )
    expect(previousCronFire('*/20 * * * *', Date.parse('2026-08-19T12:41:00Z'))).toBe(
      Date.parse('2026-08-19T12:40:00.000Z'),
    )
  })

  it('returns null rather than a wrong answer for an unparsable expression', () => {
    expect(previousCronFire('0 2 * *', NOW)).toBeNull()
    expect(previousCronFire('bogus * * * *', NOW)).toBeNull()
  })

  it('parses EVERY expression in the inventory', () => {
    // A field form the parser silently rejected would make its job's row
    // permanently green — the whole check quietly inert for that row.
    for (const job of SCHEDULED_JOBS) {
      expect(previousCronFire(job.cron, NOW)).not.toBeNull()
    }
  })
})

describe('cronJobsHealth', () => {
  it('is green when every job reported a minute ago', () => {
    const checks = cronJobsHealth(allFresh(), WATCHING_SINCE, 3, NOW)
    expect(Object.keys(checks).sort()).toEqual(
      SCHEDULED_JOBS.map((job) => job.id).sort(),
    )
    expect(healthStatus(checks)).toBe('ok')
  })

  /*==========================================
   * THE PROOF. A job stops reporting; the detector goes red.
   *=========================================*/
  it('goes RED for a job that stopped reporting, and ONLY that job', () => {
    const beats = allFresh().map((beat) =>
      beat.jobId === 'report-usage'
        ? // Last ran three days ago. The 02:00 rollup has been due, and
          // missed, twice since — this is a job somebody deleted the
          // `- cron:` line for, or paused, or that 404s in production.
          { ...beat, atMs: NOW - 3 * DAY }
        : beat,
    )
    const checks = cronJobsHealth(beats, WATCHING_SINCE, 3, NOW)

    expect(checks['report-usage'].ok).toBe(false)
    expect(checks['report-usage'].code).toBe('job-silent')
    expect(checks['report-usage'].lastBeatAgeMinutes).toBe(3 * 24 * 60)
    expect(checks['report-usage'].dueAt).toBe('2026-08-19T02:00:00.000Z')
    // The whole body is degraded, which is what makes the route answer 503.
    expect(healthStatus(checks)).toBe('degraded')
    // And nothing else moved. A detector that reds the board wholesale
    // cannot be used to find the one job that died.
    const red = Object.entries(checks)
      .filter(([, check]) => !check.ok)
      .map(([id]) => id)
    expect(red).toEqual(['report-usage'])
  })

  it('goes red for the Cloud Scheduler beat, which is the job the issue names', () => {
    // `plugin-jobs-beat` is the only real Cloud Scheduler job in the project.
    // Deleted, paused, or aimed at another deployment (AGL-2176) all look
    // the same from here — no mark — and all are defects.
    const beats = allFresh().map((beat) =>
      beat.jobId === 'plugin-jobs-beat'
        ? { ...beat, atMs: NOW - 45 * MINUTE }
        : beat,
    )
    const checks = cronJobsHealth(beats, WATCHING_SINCE, 3, NOW)
    expect(checks['plugin-jobs-beat'].ok).toBe(false)
    expect(checks['plugin-jobs-beat'].code).toBe('job-silent')
  })

  it('clears itself the moment the job reports again', () => {
    // Nothing latches (the AGL-1843 rule). The named clearing event is the
    // next invocation, and here it is.
    const stopped = cronJobsHealth(
      allFresh().map((beat) =>
        beat.jobId === 'run-erasures' ? { ...beat, atMs: NOW - 3 * DAY } : beat,
      ),
      WATCHING_SINCE,
      3,
      NOW,
    )
    expect(stopped['run-erasures'].ok).toBe(false)
    const recovered = cronJobsHealth(allFresh(), WATCHING_SINCE, 3, NOW)
    expect(recovered['run-erasures'].ok).toBe(true)
    expect(recovered['run-erasures'].code).toBeUndefined()
  })

  /*==========================================
   * THE OTHER HALF. An idle job must NOT go red.
   *=========================================*/
  it('stays green through a legitimately idle period', () => {
    // `usage-email` runs hourly on the 1st and 2nd and not at all for the
    // rest of the month. On the 19th its newest mark is SEVENTEEN DAYS old
    // and that is correct. A fixed "expect one every hour" rule would have
    // paged here, every month, for twenty-nine days.
    const beats: CronBeat[] = [
      ...allFresh().filter((beat) => beat.jobId !== 'usage-email'),
      { jobId: 'usage-email', atMs: Date.parse('2026-08-02T23:00:00.000Z') },
    ]
    const checks = cronJobsHealth(beats, WATCHING_SINCE, 3, NOW)
    expect(checks['usage-email'].ok).toBe(true)
    expect(checks['usage-email'].lastBeatAgeMinutes).toBeGreaterThan(23_000)
    expect(healthStatus(checks)).toBe('ok')
  })

  it('still catches the idle job once its window comes round', () => {
    // The same job, judged on the 2nd at 12:00 with nothing since the 1st.
    // Idleness is a property of the SCHEDULE, not an excuse the row keeps.
    const secondOfMonth = Date.parse('2026-09-02T12:00:00.000Z')
    const checks = cronJobsHealth(
      [{ jobId: 'usage-email', atMs: Date.parse('2026-09-01T09:00:00.000Z') }],
      Date.parse('2026-08-01T00:00:00.000Z'),
      3,
      secondOfMonth,
    )
    expect(checks['usage-email'].ok).toBe(false)
    expect(checks['usage-email'].code).toBe('job-silent')
  })

  it('tolerates ordinary lateness up to the job grace', () => {
    // GitHub delays scheduled workflows routinely. A row that reds on a
    // twenty-minute delay is one people learn to ignore.
    const late = Date.parse('2026-08-19T02:00:00.000Z') - 1 // just before 02:00
    const checks = cronJobsHealth(
      [{ jobId: 'report-usage', atMs: late }],
      WATCHING_SINCE,
      3,
      Date.parse('2026-08-19T06:00:00.000Z'), // four hours late, grace is six
    )
    expect(checks['report-usage'].ok).toBe(true)
  })

  /*==========================================
   * The three-states rule: unreadable is never green.
   *=========================================*/
  it('is degraded — not green — when the marks cannot be read at all', () => {
    const checks = cronJobsHealth(null, WATCHING_SINCE, 3, NOW)
    expect(healthStatus(checks)).toBe('degraded')
    for (const check of Object.values(checks)) {
      expect(check.code).toBe('beats-unavailable')
    }
  })

  it('does not red a job it has not met yet, and does once it should have', () => {
    // Bootstrap. On the day this deploys nothing has reported; a check that
    // came up red for thirteen rows would be dismissed on sight.
    const justStarted = cronJobsHealth([], NOW - MINUTE, 3, NOW)
    expect(healthStatus(justStarted)).toBe('ok')
    expect(justStarted['report-usage'].code).toBe('awaiting-first-run')

    // A fortnight later the same empty collection is a real finding: every
    // one of these should have fired since we started watching.
    const neverRan = cronJobsHealth([], WATCHING_SINCE, 3, NOW)
    expect(neverRan['report-usage'].ok).toBe(false)
    expect(neverRan['report-usage'].code).toBe('job-never-reported')
    expect(healthStatus(neverRan)).toBe('degraded')
  })

  it('exposes schedules and ages only — nothing an operator could not already read in the repo', () => {
    const checks = cronJobsHealth(allFresh(), WATCHING_SINCE, 3, NOW)
    expect(Object.keys(checks['report-usage']).sort()).toEqual([
      'dueAt',
      'graceMinutes',
      'lastBeatAgeMinutes',
      'ms',
      'ok',
      'runner',
      'schedule',
    ])
  })
})

describe('writeCronBeat', () => {
  function fakeStore() {
    const writes: Array<{ collection: string; doc: string; data: unknown }> = []
    const store = {
      collection: (collection: string) => ({
        doc: (doc: string) => ({
          set: async (data: Record<string, unknown>) => {
            writes.push({ collection, doc, data })
          },
        }),
      }),
    }
    return { store, writes }
  }

  it('stamps one document per job id', async () => {
    const { store, writes } = fakeStore()
    expect(await writeCronBeat(store, 'audit-archive', NOW)).toBe(true)
    expect(writes).toEqual([
      {
        collection: CRON_BEAT_COLLECTION,
        doc: 'audit-archive',
        data: {
          jobId: 'audit-archive',
          atMs: NOW,
          at: '2026-08-19T12:00:00.000Z',
        },
      },
    ])
  })

  it('never throws, so the monitor cannot become the outage', async () => {
    const exploding = {
      collection: () => ({
        doc: () => ({
          set: async () => {
            throw new Error('firestore is having a day')
          },
        }),
      }),
    }
    await expect(writeCronBeat(exploding, 'audit-archive', NOW)).resolves.toBe(
      false,
    )
  })
})
