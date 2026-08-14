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
 * AGL-1693 — the rate-limiter degradation health route, invoked in-process.
 *
 * The verdict logic (`rateLimitsHealth`) is spec-covered branch by branch in
 * the shared health lib; this exercises the ROUTE around it with the real
 * health helpers and a mocked Firestore query: the query it issues, the
 * 200/503 mapping, the self-clearing window that AGL-1693 exists to get
 * right, the env threshold knob (the forced-failure lever the alert path is
 * proven with), the degraded-on-error contract, and the per-instance
 * memoisation that bounds a public endpoint's cost. Only Firestore is mocked
 * — a mocked `healthHttpStatus` would let the route pass while wired to
 * nothing.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * the probe memo is module-level with a 5-minute TTL, so a shared module
 * would serve every test the first test's markers.
 */

// Makes this file a MODULE. Every binding below would otherwise land in the
// global script scope and collide with the sibling `health-signups-route`
// spec, which declares the same `queries` / `RouteModule` / `freshRoute`
// names — `tsc --noEmit` fails the whole project on it even though jest runs
// each file in its own sandbox and never notices.
export {}

const mockGet = jest.fn()
const queries: {
  collection: string
  field: string
  op: string
  cutoffMs: number
  orderBy: string
  direction: string
  limit: number
}[] = []

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({}),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({
    collection: (collection: string) => ({
      where: (field: string, op: string, cutoffMs: number) => ({
        orderBy: (orderBy: string, direction: string) => ({
          limit: (limit: number) => ({
            get: () => {
              queries.push({
                collection,
                field,
                op,
                cutoffMs,
                orderBy,
                direction,
                limit,
              })
              return mockGet()
            },
          }),
        }),
      }),
    }),
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
  RATE_LIMIT_COLLECTION: 'rateLimits',
  DEGRADATION_DOC_PREFIX: 'degraded_',
}))

type RouteModule = typeof import('../app/api/health/rate-limits/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/rate-limits/route')
}

/** A marker document as `flushDegradation` writes it. */
const marker = (
  id: string,
  data: Record<string, unknown>,
): { id: string; data: () => Record<string, unknown> } => ({
  id,
  data: () => data,
})

const docsOf = (
  ...docs: { id: string; data: () => Record<string, unknown> }[]
) => async () => ({ docs })

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000

beforeEach(() => {
  mockGet.mockReset()
  queries.length = 0
  delete process.env['RATE_LIMIT_ALARM_MAX_CALLS']
})

afterAll(() => {
  delete process.env['RATE_LIMIT_ALARM_MAX_CALLS']
})

describe('AGL-1693 · /api/health/rate-limits', () => {
  it('reports ok when no limiter has fallen back, and asks the right question', async () => {
    mockGet.mockImplementation(docsOf())
    const before = Date.now()
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('console-rate-limits')
    expect(body.checks.rateLimits).toMatchObject({
      ok: true,
      degradedCalls: 0,
      degradedEpisodes: 0,
      minutesSinceLast: null,
      windowMinutes: 30,
      threshold: 0,
    })
    // The query is the control. `lastAtMs`, not the document id: the id is
    // bucketed on `firstAtMs`, so an id-range window would miss exactly the
    // long episodes. A range plus an orderBy on the SAME field is served by
    // the automatic single-field index, so this needs no composite index.
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({
      collection: 'rateLimits',
      field: 'lastAtMs',
      op: '>=',
      orderBy: 'lastAtMs',
      direction: 'desc',
    })
    expect(queries[0].limit).toBeGreaterThan(0)
    expect(queries[0].cutoffMs).toBeGreaterThanOrEqual(before - 30 * 60_000)
    expect(queries[0].cutoffMs).toBeLessThanOrEqual(Date.now() - 30 * 60_000)
    // Public endpoint: never cacheable, readable by the status page.
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('503s on a recent degraded window and reports the totals', async () => {
    mockGet.mockImplementation(
      docsOf(
        marker('degraded_1755100800000', {
          calls: 240,
          episodes: 2,
          firstAtMs: minutesAgo(6),
          lastAtMs: minutesAgo(4),
          code: 'unavailable',
        }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.rateLimits).toMatchObject({
      ok: false,
      code: 'rate-limiter-degraded',
      degradedCalls: 240,
      degradedEpisodes: 2,
    })
    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('a degradation older than the window is GREEN — the AGL-1693 constraint', async () => {
    // Markers carry a 30-day expiry. If existence alone drove the verdict,
    // one recovered blip would hold this red for a month and the check would
    // get muted — the opposite of /api/health/backups, which stays red by
    // design because a missing restore point is a condition, not an event.
    //
    // The query itself already excludes it; this proves the ROUTE stays green
    // even when such a document is handed back, so a widened query or a
    // clock-skewed cutoff cannot resurrect a finished incident.
    mockGet.mockImplementation(
      docsOf(
        marker('degraded_1755000000000', {
          calls: 5_000,
          episodes: 9,
          lastAtMs: minutesAgo(31),
        }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.rateLimits.degradedCalls).toBe(0)
  })

  it('ignores a counter document that is not a marker', async () => {
    // `lastAtMs` exists only on markers today. If a counter ever grew one,
    // a live rate-limit bucket must not be read as an outage.
    mockGet.mockImplementation(
      docsOf(
        marker('a3f9c1_1755100800000', {
          count: 7,
          lastAtMs: minutesAgo(1),
        }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.rateLimits.degradedCalls).toBe(0)
  })

  it('RATE_LIMIT_ALARM_MAX_CALLS=-1 forces degraded — the alert-path lever', async () => {
    // The synthetic failure: zero calls is still over a negative threshold,
    // so the deployed endpoint can be made red without inducing a Firestore
    // outage. Same lever `SIGNUP_ALARM_MAX_PER_HOUR` gives the wave alarm.
    process.env['RATE_LIMIT_ALARM_MAX_CALLS'] = '-1'
    mockGet.mockImplementation(docsOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    expect((await response.json()).checks.rateLimits).toMatchObject({
      code: 'rate-limiter-degraded',
      degradedCalls: 0,
      threshold: -1,
    })
  })

  it('an unparsable override falls back to the shared default', async () => {
    process.env['RATE_LIMIT_ALARM_MAX_CALLS'] = 'none'
    mockGet.mockImplementation(docsOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.rateLimits.threshold).toBe(0)
  })

  it('a failed query is a 503, never calm — and leaks no error detail', async () => {
    // This reads the very collection the limiter writes, so a query failure
    // is itself evidence the durable limiter may be down.
    mockGet.mockRejectedValue(
      new Error('7 PERMISSION_DENIED: projects/aglyn-main/secrets/everywhere'),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.checks.rateLimits.code).toBe('markers-unavailable')
    expect(body.checks.rateLimits.degradedCalls).toBeNull()
    expect(JSON.stringify(body)).not.toContain('PERMISSION_DENIED')
  })

  it('memoises the probe — a hammered public endpoint costs one query', async () => {
    mockGet.mockImplementation(docsOf())
    const route = await freshRoute()
    await route.GET()
    await route.GET()
    await route.GET()
    expect(queries).toHaveLength(1)
  })

  it('HEAD is liveness only: 200, touches nothing', async () => {
    const route = await freshRoute()
    const response = await route.HEAD()
    expect(response.status).toBe(200)
    expect(queries).toHaveLength(0)
  })
})
