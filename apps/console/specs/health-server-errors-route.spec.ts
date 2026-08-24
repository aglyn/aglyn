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
 * AGL-1921 — the server-error-rate health route, invoked in-process.
 *
 * The verdict logic (`serverErrorsHealth`) is spec-covered branch by branch in
 * the shared health lib; this exercises the ROUTE around it with the real
 * health helpers and a mocked Firestore query.
 *
 * **The case this file exists for is `goes RED on real errors`.** A monitor
 * that has only ever been observed green is not a monitor — every other test
 * here is scaffolding around that one and its inverse, the failed query that
 * must report `unknown` rather than a confident zero.
 *
 * Only Firestore is mocked — a mocked `healthHttpStatus` would let the route
 * pass while wired to nothing.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * the probe memo is module-level with a 5-minute TTL, so a shared module
 * would serve every test the first test's markers.
 */

// Makes this file a MODULE. Every binding below would otherwise land in the
// global script scope and collide with the sibling health route specs, which
// declare the same `queries` / `RouteModule` / `freshRoute` names — `tsc
// --noEmit` fails the whole project on it even though jest runs each file in
// its own sandbox and never notices.
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
  SERVER_ERROR_DOC_PREFIX: 'serverError_',
}))

type RouteModule = typeof import('../app/api/health/server-errors/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/server-errors/route')
}

/** A marker document as `flushServerErrors` writes it. */
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
  delete process.env['SERVER_ERROR_ALARM_MAX_ERRORS']
})

afterAll(() => {
  delete process.env['SERVER_ERROR_ALARM_MAX_ERRORS']
})

describe('AGL-1921 · /api/health/server-errors', () => {
  it('reports ok on a quiet window, and asks the right question', async () => {
    mockGet.mockImplementation(docsOf())
    const before = Date.now()
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('console-server-errors')
    expect(body.checks.serverErrors).toMatchObject({
      ok: true,
      serverErrors: 0,
      byService: {},
      minutesSinceLast: null,
      windowMinutes: 30,
      threshold: 5,
    })
    // The query is the control. `erroredAtMs` — NOT `lastAtMs` (AGL-1679's
    // degradation markers) and NOT `refusedAtMs` (AGL-1907's refusal markers):
    // three disjoint single-field indexes, so one signal's flood can never
    // fill another probe's read limit and blind it. A range plus an orderBy on
    // the SAME field is served by the automatic index, so this needs no
    // composite index.
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({
      collection: 'rateLimits',
      field: 'erroredAtMs',
      op: '>=',
      orderBy: 'erroredAtMs',
      direction: 'desc',
    })
    expect(queries[0].limit).toBeGreaterThan(0)
    expect(queries[0].cutoffMs).toBeGreaterThanOrEqual(before - 30 * 60_000)
    expect(queries[0].cutoffMs).toBeLessThanOrEqual(Date.now() - 30 * 60_000)
    // Public endpoint: never cacheable, readable by the status page.
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  /**
   * ⚑ THE CASE THE WHOLE ISSUE IS ABOUT.
   *
   * A spike of real server errors must turn the endpoint RED, because that
   * 503 is the entire alerting mechanism: the GitHub uptime probe fails its
   * run on it, the external keyword monitors lose `"status":"ok"`, and the
   * docs status card flips. Nothing downstream needs to understand the body.
   */
  it('goes RED on a spike of real server errors, and names the deployment', async () => {
    mockGet.mockImplementation(
      docsOf(
        marker('serverError_1755100800000', {
          errors: 41,
          byService: { 'console-web': 38, 'tenant-web': 3 },
          erroredAtMs: minutesAgo(2),
        }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.serverErrors).toMatchObject({
      ok: false,
      code: 'server-error-spike',
      serverErrors: 41,
      byService: { 'console-web': 38, 'tenant-web': 3 },
    })
    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('sums markers across minutes and instances to cross the threshold', async () => {
    // No single minute is over the threshold; the window is. A per-marker rule
    // would miss a slow bleed, which is the shape a partially-broken route
    // takes at beta volume.
    mockGet.mockImplementation(
      docsOf(
        marker('serverError_3', {
          errors: 2,
          byService: { 'console-web': 2 },
          erroredAtMs: minutesAgo(1),
        }),
        marker('serverError_2', {
          errors: 2,
          byService: { 'tenant-web': 2 },
          erroredAtMs: minutesAgo(9),
        }),
        marker('serverError_1', {
          errors: 2,
          byService: { 'console-web': 2 },
          erroredAtMs: minutesAgo(20),
        }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const check = (await response.json()).checks.serverErrors
    expect(check.serverErrors).toBe(6)
    expect(check.byService).toEqual({ 'console-web': 4, 'tenant-web': 2 })
  })

  it('a handful of errors below the threshold stays GREEN', async () => {
    // Not zero-tolerance, deliberately: one cold-start deadline must not page
    // anyone, or the alarm gets muted before the real one arrives.
    mockGet.mockImplementation(
      docsOf(
        marker('serverError_1', {
          errors: 5,
          byService: { 'console-web': 5 },
          erroredAtMs: minutesAgo(3),
        }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.serverErrors).toMatchObject({
      ok: true,
      serverErrors: 5,
    })
  })

  it('a spike older than the window is GREEN — it must be able to recover', async () => {
    // Markers live seven days. If existence alone drove the verdict, one bad
    // minute would hold this red for a week and the check would get muted —
    // the AGL-1843 rule. The query already excludes it; this proves the ROUTE
    // stays green even when such a document is handed back, so a widened
    // query or a clock-skewed cutoff cannot resurrect a finished incident.
    mockGet.mockImplementation(
      docsOf(
        marker('serverError_0', {
          errors: 5_000,
          byService: { 'console-web': 5_000 },
          erroredAtMs: minutesAgo(31),
        }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.serverErrors.serverErrors).toBe(0)
  })

  it('ignores a document that is not a server-error marker', async () => {
    // `erroredAtMs` exists only on these markers today. If a sibling document
    // in the shared `rateLimits` collection ever grew one, it must not be read
    // as an outage.
    mockGet.mockImplementation(
      docsOf(
        marker('degraded_1755100800000', {
          errors: 900,
          calls: 900,
          erroredAtMs: minutesAgo(1),
        }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.serverErrors.serverErrors).toBe(0)
  })

  /**
   * ⚑ THE MEASURED ZERO — the worst possible bug in this feature.
   *
   * `.catch(() => [])` anywhere on this path would render an unreadable store
   * as "0 errors, all clear", and it would render it that way during exactly
   * the incident that made the store unreadable. Unknown must be its own
   * state, and it must be the LOUD one.
   */
  it('a failed query reports UNKNOWN and 503s — never a confident zero', async () => {
    mockGet.mockRejectedValue(
      new Error('7 PERMISSION_DENIED: projects/aglyn-main/secrets/everywhere'),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.checks.serverErrors.code).toBe('errors-unavailable')
    // Null, not 0. The distinction is the feature.
    expect(body.checks.serverErrors.serverErrors).toBeNull()
    expect(body.checks.serverErrors.byService).toBeNull()
    expect(JSON.stringify(body)).not.toContain('PERMISSION_DENIED')
  })

  it('SERVER_ERROR_ALARM_MAX_ERRORS=-1 forces degraded — the alert-path lever', async () => {
    // The synthetic failure: zero errors is still over a negative threshold,
    // so the DEPLOYED endpoint can be made red without breaking a real route.
    // This is how the monitor → email path gets observed firing in production.
    process.env['SERVER_ERROR_ALARM_MAX_ERRORS'] = '-1'
    mockGet.mockImplementation(docsOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    expect((await response.json()).checks.serverErrors).toMatchObject({
      code: 'server-error-spike',
      serverErrors: 0,
      threshold: -1,
    })
  })

  it('an unparsable override falls back to the shared default', async () => {
    process.env['SERVER_ERROR_ALARM_MAX_ERRORS'] = 'none'
    mockGet.mockImplementation(docsOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.serverErrors.threshold).toBe(5)
  })

  it('memoises the probe — a hammered public endpoint costs one query', async () => {
    mockGet.mockImplementation(docsOf())
    const route = await freshRoute()
    await route.GET()
    await route.GET()
    await route.GET()
    expect(queries).toHaveLength(1)
  })

  it('HEAD is 200 with no body on a quiet window', async () => {
    mockGet.mockImplementation(docsOf())
    const route = await freshRoute()
    const response = await route.HEAD()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  it('HEAD goes RED with GET, which is the whole point of watching it', async () => {
    mockGet.mockImplementation(
      docsOf(
        marker('serverError_1', {
          errors: 99,
          byService: { 'console-web': 99 },
          erroredAtMs: minutesAgo(1),
        }),
      ),
    )
    const route = await freshRoute()
    // Compared against GET rather than a literal: the contract is that the
    // two AGREE, and a HEAD pinned to 503 would be broken the other way.
    expect((await route.GET()).status).toBe(503)
    const head = await route.HEAD()
    expect(head.status).toBe(503)
    expect(await head.text()).toBe('')
    expect(head.headers.get('cache-control')).toContain('no-store')
  })

  it('HEAD adds no query of its own — it shares the probe memo', async () => {
    mockGet.mockImplementation(docsOf())
    const route = await freshRoute()
    await route.GET()
    const afterGet = queries.length
    await route.HEAD()
    expect(queries.length).toBe(afterGet)
  })
})
