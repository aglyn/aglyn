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
const mockRefusalGet = jest.fn()
const queries: {
  collection: string
  field: string
  op: string
  cutoffMs: number
}[] = []
/** AGL-1907 marker listings, kept apart so the AGL-1536 counts stay exact. */
const refusalQueries: {
  collection: string
  field: string
  op: string
  cutoffMs: number
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
      where: (field: string, op: string, cutoff: { ms: number } | number) => ({
        // AGL-1536: the org-creation aggregation.
        count: () => ({
          get: () => {
            queries.push({
              collection,
              field,
              op,
              cutoffMs: (cutoff as { ms: number }).ms,
            })
            return mockCountGet()
          },
        }),
        // AGL-1907: the refusal-marker listing. A distinct chain, so a route
        // that issued the wrong one would fail here rather than quietly
        // reading the other check's data.
        orderBy: () => ({
          limit: (max: number) => ({
            get: () => {
              refusalQueries.push({
                collection,
                field,
                op,
                cutoffMs: cutoff as number,
                limit: max,
              })
              return mockRefusalGet()
            },
          }),
        }),
      }),
    }),
  }),
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
  RATE_LIMIT_COLLECTION: 'rateLimits',
  SIGNUP_REFUSAL_DOC_PREFIX: 'signupRefused_',
}))

/** A refusal marker as Firestore hands it back. */
const marker = (id: string, refusals: number, byReason: Record<string, number>) => ({
  id,
  data: () => ({ refusals, byReason, refusedAtMs: Date.now() - 60_000 }),
})

const refusalsOf = (...docs: unknown[]) => async () => ({ docs })

type RouteModule = typeof import('../app/api/health/signups/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/signups/route')
}

const countOf = (count: number) => async () => ({ data: () => ({ count }) })

beforeEach(() => {
  mockCountGet.mockReset()
  mockRefusalGet.mockReset()
  // A quiet hour is the default so every AGL-1536 test below reads the
  // verdict it was written for.
  mockRefusalGet.mockImplementation(refusalsOf())
  queries.length = 0
  refusalQueries.length = 0
  delete process.env['SIGNUP_ALARM_MAX_PER_HOUR']
  delete process.env['SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR']
})

afterAll(() => {
  delete process.env['SIGNUP_ALARM_MAX_PER_HOUR']
  delete process.env['SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR']
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
    expect(refusalQueries).toHaveLength(0)
  })
})

describe('AGL-1907 · /api/health/signups reports REFUSED creations too', () => {
  it('ALLOWS legitimate use: a quiet hour is 200 and says zero', async () => {
    // The green direction. If this check could not be shown to pass, it would
    // be a launch-morning outage wearing an alarm's clothes.
    mockCountGet.mockImplementation(countOf(1))
    mockRefusalGet.mockImplementation(refusalsOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.checks.signupRefusals).toMatchObject({
      ok: true,
      refusedSignups: 0,
      windowMinutes: 60,
      threshold: 50,
    })
    expect(body.checks.signups.ok).toBe(true)
  })

  it('ALLOWS a person who fumbled into the 429 a few times', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockRefusalGet.mockImplementation(
      refusalsOf(marker('signupRefused_1', 4, { uid: 4 })),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.signupRefusals.ok).toBe(true)
  })

  it('REFUSES: a sustained run of 429s is a 503 with the reason split', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockRefusalGet.mockImplementation(
      refusalsOf(
        marker('signupRefused_2', 40, { ip: 38, uid: 2 }),
        marker('signupRefused_1', 20, { ip: 20 }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.signupRefusals).toMatchObject({
      code: 'signup-refusal-wave',
      refusedSignups: 60,
      refusedByReason: { ip: 58, uid: 2 },
    })
    // The point of the whole check: creations read CALM while this is
    // happening, because the limiter is doing its job.
    expect(body.checks.signups.ok).toBe(true)
  })

  it('queries markers by refusedAtMs — never lastAtMs, which is AGL-1693 territory', async () => {
    mockCountGet.mockImplementation(countOf(0))
    const before = Date.now()
    await (await freshRoute()).GET()
    expect(refusalQueries).toHaveLength(1)
    expect(refusalQueries[0]).toMatchObject({
      collection: 'rateLimits',
      field: 'refusedAtMs',
      op: '>=',
    })
    expect(refusalQueries[0].field).not.toBe('lastAtMs')
    expect(refusalQueries[0].cutoffMs).toBeGreaterThanOrEqual(
      before - 3_600_000,
    )
    // Cost-bounded like every probe in this family.
    expect(refusalQueries[0].limit).toBeGreaterThan(0)
  })

  it('ignores a foreign document that happens to carry refusedAtMs', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockRefusalGet.mockImplementation(
      refusalsOf(
        marker('degraded_1', 999, { ip: 999 }),
        marker('signupRefused_1', 3, { ip: 3 }),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.signupRefusals.refusedSignups).toBe(3)
  })

  it('SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR=-1 forces the red without a single 429', async () => {
    process.env['SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR'] = '-1'
    mockCountGet.mockImplementation(countOf(0))
    mockRefusalGet.mockImplementation(refusalsOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    expect((await response.json()).checks.signupRefusals).toMatchObject({
      code: 'signup-refusal-wave',
      refusedSignups: 0,
      threshold: -1,
    })
  })

  it('an unparsable override falls back to the shared default', async () => {
    process.env['SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR'] = 'fifty'
    mockCountGet.mockImplementation(countOf(0))
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.signupRefusals.threshold).toBe(50)
  })

  it('a failed marker query is a 503, never calm — and leaks no error detail', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockRefusalGet.mockRejectedValue(
      new Error('7 PERMISSION_DENIED: projects/aglyn-main/rateLimits'),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.checks.signupRefusals.code).toBe('refusals-unavailable')
    expect(body.checks.signupRefusals.refusedSignups).toBeNull()
    expect(JSON.stringify(body)).not.toContain('PERMISSION_DENIED')
  })

  it('memoises independently — a hammered endpoint costs one of each query', async () => {
    mockCountGet.mockImplementation(countOf(2))
    const route = await freshRoute()
    await route.GET()
    await route.GET()
    await route.GET()
    expect(queries).toHaveLength(1)
    expect(refusalQueries).toHaveLength(1)
  })

  it('publishes counts only — no uid, no IP, no limiter key', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockRefusalGet.mockImplementation(
      refusalsOf(marker('signupRefused_1', 2, { uid: 2 })),
    )
    const body = await (await (await freshRoute()).GET()).json()
    expect(Object.keys(body.checks.signupRefusals).sort()).toEqual([
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
