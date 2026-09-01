/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
 *
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
 * AGL-1955 — the scheduled-job absence probe, invoked in-process.
 *
 * `cronJobsHealth` is spec-covered branch by branch in the shared health
 * lib. This exercises the ROUTE around it with the real health helpers and a
 * mocked Firestore: the marks it reads, the 200/503 mapping, the bootstrap
 * window it writes once, and the degraded-on-error contract. Only Firestore
 * is mocked — a mocked `healthHttpStatus` would let the route pass while
 * wired to nothing.
 *
 * The test that matters is the one where a job stops reporting and the
 * endpoint turns RED. Everything else in the cron path answers only when a run happens, so
 * a probe that could not fail on silence would be the bug wearing a health
 * check as a costume.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * the probe memo is module-level with a 5-minute TTL, so a shared module
 * would serve every test the first test's answer.
 */
import { SCHEDULED_JOBS } from '@aglyn/aglyn/server'

const DAY = 86_400_000

/** The whole `platformCronBeats` collection, as the test wants it to read. */
let mockStore: Record<string, Record<string, unknown>> = {}
/** Every write the route makes, so the bootstrap can be asserted exactly. */
let mockWrites: Array<{ doc: string; data: Record<string, unknown> }> = []
/** Set to make the collection read throw, i.e. we cannot see the jobs. */
let mockListThrows = false

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({}),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({
    collection: (collection: string) => {
      if (collection !== 'platformCronBeats') {
        throw new Error(`unexpected collection ${collection}`)
      }
      return {
        get: async () => {
          if (mockListThrows) throw new Error('firestore is having a day')
          return {
            docs: Object.entries(mockStore).map(([id, data]) => ({
              id,
              get: (field: string) => data[field],
            })),
          }
        },
        doc: (id: string) => ({
          get: async () => {
            if (mockListThrows) throw new Error('firestore is having a day')
            return { get: (field: string) => mockStore[id]?.[field] }
          },
          set: async (data: Record<string, unknown>) => {
            mockWrites.push({ doc: id, data })
            mockStore[id] = { ...(mockStore[id] ?? {}), ...data }
          },
        }),
      }
    },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
}))

type RouteModule = typeof import('../app/api/health/crons/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/crons/route')
}

/** Every job reported a minute ago, and we have been watching for a month. */
function healthyStore(now: number) {
  const seeded: Record<string, Record<string, unknown>> = {
    'watch-window': { startedAtMs: now - 30 * DAY },
  }
  for (const job of SCHEDULED_JOBS) {
    seeded[job.id] = { jobId: job.id, atMs: now - 60_000 }
  }
  return seeded
}

/**
 * The route names its failing rows on `console.error` by design, so half the
 * cases here log. Silenced suite-wide rather than per test: without it every
 * degraded case prints, and the tests that DO assert on the line need a
 * handle anyway.
 */
let errorLog: jest.SpyInstance

beforeEach(() => {
  mockStore = {}
  mockWrites = []
  mockListThrows = false
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  errorLog.mockRestore()
})

describe('/api/health/crons', () => {
  it('answers 200 when every job reported', async () => {
    mockStore = healthyStore(Date.now())
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('console-crons')
    // Every job in the inventory has a row. A probe that reported on some of
    // them would be a board with a silent gap in it.
    expect(Object.keys(body.checks).sort()).toEqual(
      SCHEDULED_JOBS.map((job) => job.id).sort(),
    )
  })

  /*==========================================
   * THE PROOF. Simulate a job that stops reporting.
   *=========================================*/
  it('answers 503 and names the job when one stops reporting', async () => {
    const now = Date.now()
    mockStore = healthyStore(now)
    // `report-usage` last reported three days ago — the schedule was deleted,
    // or paused, or the route 404s in production. Nothing else changes: no
    // error is logged, no delivery fails, the workflow never goes red, and
    // before this endpoint existed the board stayed entirely green.
    mockStore['report-usage'] = { jobId: 'report-usage', atMs: now - 3 * DAY }

    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks['report-usage'].ok).toBe(false)
    expect(body.checks['report-usage'].code).toBe('job-silent')
    expect(body.checks['report-usage'].schedule).toBe('0 2 * * *')
    // And it points at the run that was missed, not just at the job.
    expect(typeof body.checks['report-usage'].dueAt).toBe('string')
    // Only that job. A probe that reds the whole board cannot be used to
    // find the one job that died.
    const red = Object.entries(body.checks)
      .filter(([, check]) => !(check as { ok: boolean }).ok)
      .map(([id]) => id)
    expect(red).toEqual(['report-usage'])
  })

  it('goes red for the Cloud Scheduler beat too', async () => {
    const now = Date.now()
    mockStore = healthyStore(now)
    // The plugin job beat is the project's only real Cloud Scheduler job and
    // the only one no workflow file mentions.
    delete mockStore['plugin-jobs-beat']

    const { GET } = await freshRoute()
    const body = await (await GET()).json()
    expect(body.checks['plugin-jobs-beat'].ok).toBe(false)
    expect(body.checks['plugin-jobs-beat'].code).toBe('job-never-reported')
  })

  it('still 503s for the job AGL-1617 moved, at the grace it moved it to', async () => {
    // END-TO-END, on the exact row the incident was about. Moving
    // `campaigns-process-scheduled` off GitHub Actions and onto Cloud
    // Scheduler was allowed to change WHERE it is fired from and WHEN it is
    // considered late — it was not allowed to make this endpoint any less
    // able to notice it going quiet. A fix that quietly stopped detecting
    // would be worse than the 104-minute gap it was fixing.
    const now = Date.now()
    mockStore = healthyStore(now)
    // SEVENTY-FIVE minutes, and the number is not arbitrary. A grace is a
    // FLOOR, not the exact bar: the verdict compares the mark against the
    // last fire that is already `graceMinutes` old, so where that lands
    // depends on the clock's phase against the schedule. With a 45-minute
    // grace on a 15-minute cron the row reds somewhere between 45 and 60
    // minutes of silence — 50 minutes reds on a wall clock at :00 and does
    // not at :07, which is a flake waiting to happen in a suite that runs at
    // whatever time it runs. 75 is past the ceiling and therefore red at
    // every phase, while still being comfortably inside the 90-minute grace
    // this job used to carry — so this test also fails if the grace is ever
    // widened back. `health-report-crons.spec.ts` pins the exact 45/46
    // boundary against a frozen clock.
    mockStore['campaigns-process-scheduled'] = {
      jobId: 'campaigns-process-scheduled',
      atMs: now - 75 * 60_000,
    }

    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks['campaigns-process-scheduled'].ok).toBe(false)
    expect(body.checks['campaigns-process-scheduled'].code).toBe('job-silent')
    // The body says which runner to go and look at — the remediation for a
    // Cloud Scheduler row and a GitHub Actions row are different places.
    expect(body.checks['campaigns-process-scheduled'].runner).toBe(
      'cloud-scheduler',
    )
    expect(body.checks['campaigns-process-scheduled'].graceMinutes).toBe(45)
    // And it is still the only red row: the move did not make this a check
    // that reds the board wholesale.
    const red = Object.entries(body.checks)
      .filter(([, check]) => !(check as { ok: boolean }).ok)
      .map(([id]) => id)
    expect(red).toEqual(['campaigns-process-scheduled'])
  })

  it('is degraded — not green — when the marks cannot be read at all', async () => {
    mockListThrows = true
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(503)
    for (const check of Object.values(body.checks)) {
      expect((check as { code: string }).code).toBe('beats-unavailable')
    }
  })

  it('opens its own bootstrap window once, and never reds on day one', async () => {
    // Nothing has ever reported. On the day this deploys that is the truth
    // for every row, and thirteen red lights on a first deploy is a board
    // people stop reading.
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.checks['report-usage'].code).toBe('awaiting-first-run')
    expect(mockWrites).toHaveLength(1)
    expect(mockWrites[0].doc).toBe('watch-window')
    expect(typeof mockWrites[0].data.startedAtMs).toBe('number')
  })

  it('does not rewrite the bootstrap window it already has', async () => {
    // A window that reset on every probe would make the check permanently
    // unable to fail: nothing would ever be overdue relative to "now".
    mockStore = { 'watch-window': { startedAtMs: Date.now() - 30 * DAY } }
    const { GET } = await freshRoute()
    await GET()
    expect(mockWrites).toEqual([])
  })

  it('memoises, so a public endpoint cannot be made to read in a loop', async () => {
    mockStore = healthyStore(Date.now())
    const { GET } = await freshRoute()
    await GET()
    const before = Object.keys(mockStore).length
    mockStore['report-usage'] = { jobId: 'report-usage', atMs: 0 }
    const body = await (await GET()).json()
    // Still the memoised healthy answer — the TTL, not a fresh read.
    expect(body.checks['report-usage'].ok).toBe(true)
    expect(Object.keys(mockStore).length).toBe(before)
  })

  it('HEAD answers 200 with no body when every job reported', async () => {
    mockStore = healthyStore(Date.now())
    const { HEAD } = await freshRoute()
    const response = await HEAD()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  /**
   * THE MONITOR-FACING HALF OF THE RED PATH (AGL-1148).
   *
   * HEAD used to be a hardcoded 200 with the comment "cheap liveness ...
   * touches nothing", and touching nothing is exactly the defect: several
   * uptime providers issue HEAD by default, and one pointed here would have
   * agreed with the green board for the whole fifty-one hours this endpoint
   * spent at 503. A health check that cannot go red is the failure this
   * endpoint exists to prevent, reproduced one method over.
   */
  it('HEAD goes RED with GET — the defect that made a HEAD monitor useless', async () => {
    const now = Date.now()
    mockStore = healthyStore(now)
    mockStore['report-usage'] = { jobId: 'report-usage', atMs: now - 3 * DAY }

    const { GET, HEAD } = await freshRoute()
    // Asserted against GET in the same test rather than against a literal:
    // the contract is that the two AGREE, and a HEAD hardcoded to 503 would
    // be just as broken in the other direction.
    expect((await GET()).status).toBe(503)
    const head = await HEAD()
    expect(head.status).toBe(503)
    expect(await head.text()).toBe('')
    // And the headers a monitor reads survive the body being dropped — a
    // HEAD that was cacheable while its GET was not is the same lie one
    // layer down.
    expect(head.headers.get('cache-control')).toContain('no-store')
    expect(head.headers.get('retry-after')).toBe('30')
  })

  it('HEAD costs no extra reads — it shares GET\'s memo', async () => {
    mockStore = healthyStore(Date.now())
    const { GET, HEAD } = await freshRoute()
    await GET()
    const writesAfterGet = mockWrites.length
    // The bootstrap document is written once by the first probe; HEAD must
    // not re-read the collection or write anything of its own.
    mockStore['report-usage'] = { jobId: 'report-usage', atMs: 0 }
    expect((await HEAD()).status).toBe(200)
    expect(mockWrites.length).toBe(writesAfterGet)
  })

  /*==========================================
   * The red window has to be attributable AFTER it closes.
   *=========================================*/
  it('logs WHICH job went quiet, not merely that something did', async () => {
    // The body names the late job, but only to whoever is holding it, and
    // the uptime probe reads the status and discards the body. Production
    // spent roughly seven hours red on 2026-08-27 and seven more overnight
    // into 2026-09-01 — ~170 503s each, every one answered in under a second
    // — and afterwards nothing said which row had flipped. Scheduler had
    // fired throughout and the every-minute beat never gapped, so the jobs
    // were healthy and the evidence was simply gone.
    const now = Date.now()
    mockStore = healthyStore(now)
    mockStore['report-usage'] = { jobId: 'report-usage', atMs: now - 3 * DAY }
    const { GET } = await freshRoute()
    expect((await GET()).status).toBe(503)

    const output = errorLog.mock.calls.map((call) => String(call[0])).join('\n')
    // The name is the whole point — everything else is context for it.
    expect(output).toContain('report-usage')
    // With the numbers that decide the verdict, so the line answers "by how
    // much" without needing the body it was never given.
    expect(output).toMatch(/lastBeatAgeMinutes=\d+/)
    expect(output).toMatch(/graceMinutes=\d+/)
    expect(output).toContain('schedule="0 2 * * *"')
  })

  it('says nothing at all while the board is green', async () => {
    // A probe that logged every read would bury the one line that matters
    // under a day of noise, and the drain bills for it.
    mockStore = healthyStore(Date.now())
    const { GET } = await freshRoute()
    expect((await GET()).status).toBe(200)

    expect(errorLog).not.toHaveBeenCalled()
  })

  it('logs once per PROBE, not once per caller', async () => {
    // The rate has to be the read's, not the monitor's. During a red window
    // the uptime probe, its HEAD twin and every staff member opening
    // /admin/health arrive inside the same memo window; one line each would
    // turn a seven-hour outage into thousands.
    const now = Date.now()
    mockStore = healthyStore(now)
    mockStore['report-usage'] = { jobId: 'report-usage', atMs: now - 3 * DAY }
    const { GET, HEAD } = await freshRoute()
    await GET()
    await GET()
    await HEAD()

    expect(errorLog).toHaveBeenCalledTimes(1)
  })

  it('names the blackout itself when the marks cannot be read', async () => {
    // "We cannot see the jobs" is the other way this goes red, and it is the
    // one most likely to be mistaken for the jobs being fine.
    mockListThrows = true
    const { GET } = await freshRoute()
    expect((await GET()).status).toBe(503)

    const output = errorLog.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('health/crons degraded')
    // Every row is degraded by contract in this branch, so the count in the
    // line is what distinguishes it from a single silent job at a glance.
    expect(output).toContain(`/${SCHEDULED_JOBS.length}`)
  })
})
