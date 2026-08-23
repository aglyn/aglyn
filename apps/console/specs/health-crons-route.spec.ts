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

beforeEach(() => {
  mockStore = {}
  mockWrites = []
  mockListThrows = false
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
})
