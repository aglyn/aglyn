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
 * AGL-1536 — the signup-volume health route, invoked in-process.
 *
 * The verdict logic (`signupsHealth`) is spec-covered in the shared health
 * lib; this exercises the ROUTE around it with the real health helpers and a
 * mocked Firestore aggregation: the count query it issues, the 200/503
 * mapping, the env threshold knob (the forced-failure lever the alert path
 * is proven with), the degraded-on-error contract, and the per-instance
 * memoisation that bounds a public endpoint's cost. Only Firestore is
 * mocked — a mocked `healthHttpStatus` would let the route pass while wired
 * to nothing.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * the probe memo is module-level with a 5-minute TTL, so a shared module
 * would serve every test the first test's count.
 */

const mockCountGet = jest.fn()
const queries: {
  collection: string
  field: string
  op: string
  cutoffMs: number
}[] = []

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({}),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({
    collection: (collection: string) => ({
      where: (field: string, op: string, cutoff: { ms: number }) => ({
        count: () => ({
          get: () => {
            queries.push({ collection, field, op, cutoffMs: cutoff.ms })
            return mockCountGet()
          },
        }),
      }),
    }),
  }),
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
}))

type RouteModule = typeof import('../app/api/health/signups/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/signups/route')
}

const countOf = (count: number) => async () => ({ data: () => ({ count }) })

beforeEach(() => {
  mockCountGet.mockReset()
  queries.length = 0
  delete process.env['SIGNUP_ALARM_MAX_PER_HOUR']
})

afterAll(() => {
  delete process.env['SIGNUP_ALARM_MAX_PER_HOUR']
})

describe('AGL-1536 · /api/health/signups', () => {
  it('counts orgs created in the trailing hour and reports ok at baseline', async () => {
    mockCountGet.mockImplementation(countOf(1))
    const before = Date.now()
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('console-signups')
    expect(body.checks.signups).toMatchObject({
      ok: true,
      recentOrgCreations: 1,
      windowMinutes: 60,
      threshold: 10,
    })
    // The query is the control: the orgs collection, createdAt strictly
    // after now minus one hour. A wrong field or window would count nothing
    // forever and the alarm would report calm through any wave.
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({
      collection: 'orgs',
      field: 'createdAt',
      op: '>',
    })
    expect(queries[0].cutoffMs).toBeGreaterThanOrEqual(before - 3_600_000)
    expect(queries[0].cutoffMs).toBeLessThanOrEqual(Date.now() - 3_600_000)
    // Public endpoint: never cacheable, readable by the status page.
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('exactly the per-IP cap stays green; one past it is a 503 wave', async () => {
    // 10/h is what a single maxed-out address can mint under AGL-1534 — the
    // limiter's territory. 11 requires multiple addresses, which is the shape
    // only this alarm can see.
    mockCountGet.mockImplementation(countOf(10))
    const atCap = await (await freshRoute()).GET()
    expect(atCap.status).toBe(200)

    mockCountGet.mockImplementation(countOf(11))
    const wave = await (await freshRoute()).GET()
    expect(wave.status).toBe(503)
    const body = await wave.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.signups.code).toBe('signup-wave')
    expect(body.checks.signups.recentOrgCreations).toBe(11)
  })

  it('SIGNUP_ALARM_MAX_PER_HOUR=-1 forces the wave — the alert-path lever', async () => {
    // The documented synthetic failure: every count, including zero, is over
    // a negative threshold, so the deployed endpoint can be made red without
    // creating a single org.
    process.env['SIGNUP_ALARM_MAX_PER_HOUR'] = '-1'
    mockCountGet.mockImplementation(countOf(0))
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.checks.signups).toMatchObject({
      code: 'signup-wave',
      recentOrgCreations: 0,
      threshold: -1,
    })
  })

  it('an unparsable override falls back to the shared default', async () => {
    process.env['SIGNUP_ALARM_MAX_PER_HOUR'] = 'eleven'
    mockCountGet.mockImplementation(countOf(0))
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.signups.threshold).toBe(10)
  })

  it('a failed count is a 503, never calm — and leaks no error detail', async () => {
    mockCountGet.mockRejectedValue(
      new Error('7 PERMISSION_DENIED: projects/aglyn-main/secrets/everywhere'),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.checks.signups.code).toBe('count-unavailable')
    expect(body.checks.signups.recentOrgCreations).toBeNull()
    expect(JSON.stringify(body)).not.toContain('PERMISSION_DENIED')
  })

  it('memoises the probe — a hammered public endpoint costs one query', async () => {
    mockCountGet.mockImplementation(countOf(2))
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
