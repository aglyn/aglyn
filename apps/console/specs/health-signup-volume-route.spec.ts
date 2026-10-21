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
 * AGL-1536, AGL-1907, AGL-2583 — the signup-volume health route, invoked
 * in-process.
 *
 * The route was `/api/health/signups` until AGL-2583 renamed it to what it
 * measures. The old path is still served, by a thin alias whose own coverage
 * is the last describe in this file.
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

// A module, not a script. Every spec in this app shares one TypeScript
// program, so a top-level declaration in script scope collides with the
// identically named one in a sibling — which is why each health-route spec
// carries this line.
export {}

const mockCountGet = jest.fn()
const mockRefusalGet = jest.fn()
/** AGL-2583 signup-page serve markers — the drought denominator. */
const mockServedGet = jest.fn()
const mockAttemptGet = jest.fn()
/** AGL-3725 orgs in the landing window. */
const mockLandingGet = jest.fn()
/** AGL-4021 new accounts in the workspace window, and their two sub-reads. */
const mockWorkspaceGet = jest.fn()
const mockAccountSubGet = jest.fn()
const mockGetUsers = jest.fn()
const workspaceQueries: { bounds: { field: string; op: string; ms: number }[]; limit: number }[] = []
const landingQueries: {
  collection: string
  bounds: { field: string; op: string; ms: number }[]
  limit: number
}[] = []
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
/** AGL-2583 serve listings, kept apart for the same reason. */
const servedQueries: {
  collection: string
  field: string
  op: string
  cutoffMs: number
  limit: number
}[] = []
const attemptQueries: {
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

jest.mock('firebase-admin/auth', () => ({
  __esModule: true,
  getAuth: () => ({ getUsers: (ids: { uid: string }[]) => mockGetUsers(ids) }),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({
    collection: (collection: string) => ({
      // AGL-4021: `users/{uid}/orgs` and `users/{uid}/legalAcceptances`.
      doc: (id: string) => ({
        collection: (sub: string) => ({
          limit: () => ({ get: () => mockAccountSubGet(id, sub) }),
        }),
      }),
      where: (field: string, op: string, cutoff: { ms: number } | number) => ({
        // AGL-3725: the landing read is the only one with a SECOND range edge.
        where: (field2: string, op2: string, cutoff2: { ms: number }) => ({
          limit: (max: number) => ({
            get: () => {
              // AGL-4021: the account read ranges on plain milliseconds.
              if (collection === 'users') {
                workspaceQueries.push({
                  bounds: [
                    { field, op, ms: cutoff as number },
                    { field: field2, op: op2, ms: cutoff2 as unknown as number },
                  ],
                  limit: max,
                })
                return mockWorkspaceGet()
              }
              landingQueries.push({
                collection,
                bounds: [
                  { field, op, ms: (cutoff as { ms: number }).ms },
                  { field: field2, op: op2, ms: cutoff2.ms },
                ],
                limit: max,
              })
              return mockLandingGet()
            },
          }),
        }),
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
        // AGL-1907 refusals and AGL-2583 serves. Routed by the FIELD each
        // one ranges on, so a route that queried the wrong field would read
        // the wrong signal's fixture and fail here rather than silently
        // grading one check with another's data — which is precisely the
        // class of mistake this whole issue is about.
        orderBy: () => ({
          limit: (max: number) => ({
            get: () => {
              const record = {
                collection,
                field,
                op,
                cutoffMs: cutoff as number,
                limit: max,
              }
              if (field === 'servedAtMs') {
                servedQueries.push(record)
                return mockServedGet()
              }
              if (field === 'attemptedAtMs') {
                attemptQueries.push(record)
                return mockAttemptGet()
              }
              refusalQueries.push(record)
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
  SIGNUP_SERVED_DOC_PREFIX: 'signupServed_',
  SIGNUP_ATTEMPT_DOC_PREFIX: 'signupAttempted_',
}))

/** A refusal marker as Firestore hands it back. */
const marker = (id: string, refusals: number, byReason: Record<string, number>) => ({
  id,
  data: () => ({ refusals, byReason, refusedAtMs: Date.now() - 60_000 }),
})

const refusalsOf = (...docs: unknown[]) => async () => ({ docs })

/** A serve marker as Firestore hands it back (AGL-2583). */
const serveMarker = (id: string, serves: number) => ({
  id,
  data: () => ({ serves, servedAtMs: Date.now() - 60_000 }),
})

const servesOf = (...docs: unknown[]) => async () => ({ docs })

/** An org-creation attempt marker as Firestore hands it back (AGL-2714). */
const attemptMarker = (id: string, attempts: number) => ({
  id,
  data: () => ({ attempts, attemptedAtMs: Date.now() - 60_000 }),
})

const attemptsOf = (...docs: unknown[]) => async () => ({ docs })

type RouteModule = typeof import('../app/api/health/signup-volume/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/signup-volume/route')
}

const countOf = (count: number) => async () => ({ data: () => ({ count }) })

/** Orgs as the landing read sees them: each with this many sites (AGL-3725). */
/**
 * Orgs NEWEST FIRST, one minute apart, each by a different visitor unless
 * `visitors` names one: the landing check reads the newest people in order.
 */
const orgsWithSites =
  (...siteCounts: number[]) =>
  async () =>
    orgsMadeBy(siteCounts.map((sites) => ({ sites })))()

const orgsMadeBy =
  (
    orgs: Array<{
      sites: number
      firstTouch?: number
      owner?: string
      // Absent means the org was born with the marker and never landed.
      landedAtMs?: number | null | 'unmarked'
    }>,
  ) =>
  async () => ({
    docs: orgs.map(({ sites, firstTouch, owner, landedAtMs }, index) => ({
      get: (field: string) => {
        if (field === 'hosts') {
          return Object.fromEntries(
            Array.from({ length: sites }, (_, i) => [`h${i}`, true]),
          )
        }
        if (field === 'createdAt') {
          return { toMillis: () => Date.now() - 3_600_000 - index * 60_000 }
        }
        if (field === 'acquisition') {
          return firstTouch === undefined ? undefined : { capturedAt: firstTouch }
        }
        if (field === 'ownerUid') return owner ?? `owner-${index}`
        if (field === 'landedAtMs') {
          if (landedAtMs === 'unmarked') return undefined
          return landedAtMs === undefined ? null : landedAtMs
        }
        return undefined
      },
    })),
  })

beforeEach(() => {
  mockCountGet.mockReset()
  mockRefusalGet.mockReset()
  mockServedGet.mockReset()
  mockAttemptGet.mockReset()
  // A quiet hour is the default so every AGL-1536 test below reads the
  // verdict it was written for.
  mockRefusalGet.mockImplementation(refusalsOf())
  // No signup traffic by default, so the AGL-2583 drought check stays green
  // and cannot turn an unrelated test red for its own reasons.
  mockServedGet.mockImplementation(servesOf())
  mockAttemptGet.mockImplementation(attemptsOf())
  // Every org has a site by default, so the AGL-3725 landing check stays
  // green and cannot turn an unrelated test red.
  mockLandingGet.mockReset()
  mockLandingGet.mockImplementation(orgsWithSites(1, 1))
  landingQueries.length = 0
  // No new accounts by default, so the AGL-4021 workspace check stays green.
  mockWorkspaceGet.mockReset()
  mockWorkspaceGet.mockResolvedValue({ docs: [] })
  mockAccountSubGet.mockReset()
  mockGetUsers.mockReset()
  workspaceQueries.length = 0
  queries.length = 0
  refusalQueries.length = 0
  servedQueries.length = 0
  attemptQueries.length = 0
  delete process.env['SIGNUP_ALARM_MAX_PER_HOUR']
  delete process.env['SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR']
  delete process.env['SIGNUP_DROUGHT_MIN_TRAFFIC']
})

afterAll(() => {
  delete process.env['SIGNUP_ALARM_MAX_PER_HOUR']
  delete process.env['SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR']
  delete process.env['SIGNUP_DROUGHT_MIN_TRAFFIC']
})

describe('AGL-1536 · /api/health/signup-volume', () => {
  it('counts orgs created in the trailing hour and reports ok at baseline', async () => {
    mockCountGet.mockImplementation(countOf(1))
    const before = Date.now()
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('console-signup-volume')
    expect(body.checks.signupVolume).toMatchObject({
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
    expect(body.checks.signupVolume.code).toBe('signup-wave')
    expect(body.checks.signupVolume.recentOrgCreations).toBe(11)
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
    expect(body.checks.signupVolume).toMatchObject({
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
    expect((await response.json()).checks.signupVolume.threshold).toBe(10)
  })

  it('a failed count is a 503, never calm — and leaks no error detail', async () => {
    mockCountGet.mockRejectedValue(
      new Error('7 PERMISSION_DENIED: projects/aglyn-main/secrets/everywhere'),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.checks.signupVolume.code).toBe('count-unavailable')
    expect(body.checks.signupVolume.recentOrgCreations).toBeNull()
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

  it('HEAD is 200 with no body on a quiet hour', async () => {
    // The healthy fixture has to be set now that HEAD actually READS. Before
    // AGL-1148 this test passed with no fixture at all, because HEAD looked
    // at nothing — it was green in a state where GET answers 503.
    mockCountGet.mockImplementation(countOf(1))
    mockRefusalGet.mockImplementation(refusalsOf())
    const route = await freshRoute()
    const response = await route.HEAD()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  /**
   * HEAD used to be a hardcoded 200 that read nothing (AGL-1148) — a check
   * that could not go red, for exactly the monitors most likely to use it.
   * This spec asserted the defect as if it were the design.
   */
  it('HEAD goes RED with GET, which is the whole point of watching it', async () => {
    mockCountGet.mockRejectedValue(new Error('7 PERMISSION_DENIED: nope'))
    const route = await freshRoute()
    expect((await route.GET()).status).toBe(503)
    const head = await route.HEAD()
    expect(head.status).toBe(503)
    expect(await head.text()).toBe('')
    expect(head.headers.get('cache-control')).toContain('no-store')
  })

  it('HEAD adds no query of its own — it shares the probe memo', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockRefusalGet.mockImplementation(refusalsOf())
    const route = await freshRoute()
    await route.GET()
    const afterGet = queries.length + refusalQueries.length
    await route.HEAD()
    expect(queries.length + refusalQueries.length).toBe(afterGet)
  })
})

describe('AGL-1907 · /api/health/signup-volume reports REFUSED creations too', () => {
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
    expect(body.checks.signupVolume.ok).toBe(true)
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
    expect(body.checks.signupVolume.ok).toBe(true)
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
      'lockUnreadable',
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

/**
 * AGL-2583 — the DROUGHT check, on the route.
 *
 * The check that did not exist while signup was refusing every visitor for
 * three days from launch day. The verdict logic is spec-covered in the shared
 * health lib; this exercises the ROUTE around it: the traffic query it issues,
 * that it shares ONE org-creation count with the wave check, and that a
 * drought reaches the status code monitors actually read.
 */
describe('AGL-2583 · the drought — traffic arrived and nobody got an account', () => {
  it('REDS when people asked for an org and zero were created', async () => {
    // The AGL-2581 hour. The wave check is perfectly green in this state —
    // that is the whole reason this one had to be built. The denominator is
    // ATTEMPTS since AGL-2714; serves ride along as context.
    mockCountGet.mockImplementation(countOf(0))
    mockServedGet.mockImplementation(
      servesOf(
        serveMarker('signupServed_2', 30),
        serveMarker('signupServed_1', 12),
      ),
    )
    mockAttemptGet.mockImplementation(
      attemptsOf(
        attemptMarker('signupAttempted_2', 30),
        attemptMarker('signupAttempted_1', 12),
      ),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.signupDrought).toMatchObject({
      ok: false,
      code: 'signup-drought',
      signupPagesServed: 42,
      signupAttempts: 42,
      orgCreations: 0,
    })
    // The point, stated as an assertion: the check named for signups is
    // GREEN while nobody on the platform can sign up.
    expect(body.checks.signupVolume.ok).toBe(true)
  })

  it('ALLOWS a quiet night — no traffic, no accounts, 200', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockServedGet.mockImplementation(servesOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.signupDrought.ok).toBe(true)
  })

  it('ALLOWS a busy hour that produced an account', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockServedGet.mockImplementation(servesOf(serveMarker('signupServed_1', 900)))
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.signupDrought.ok).toBe(true)
  })

  it('queries serves by servedAtMs — never a field a sibling owns', async () => {
    mockCountGet.mockImplementation(countOf(0))
    const before = Date.now()
    await (await freshRoute()).GET()
    expect(servedQueries).toHaveLength(1)
    expect(servedQueries[0]).toMatchObject({
      collection: 'rateLimits',
      field: 'servedAtMs',
      op: '>=',
    })
    // Four signals, four disjoint indexes: sharing a field would let one
    // signal's flood fill another's read limit and blind it silently.
    expect(['lastAtMs', 'refusedAtMs', 'erroredAtMs']).not.toContain(
      servedQueries[0].field,
    )
    expect(servedQueries[0].cutoffMs).toBeGreaterThanOrEqual(before - 3_600_000)
    expect(servedQueries[0].limit).toBeGreaterThan(0)
  })

  it('ignores a foreign document that happens to carry servedAtMs', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockServedGet.mockImplementation(
      servesOf(serveMarker('degraded_1', 999), serveMarker('signupServed_1', 2)),
    )
    const response = await (await freshRoute()).GET()
    // Two serves is under the floor, so this stays green — and would not
    // have, had the foreign document been counted.
    expect(response.status).toBe(200)
    expect((await response.json()).checks.signupDrought.signupPagesServed).toBe(2)
  })

  it('a failed ATTEMPT query is a 503, never calm — and leaks no error detail', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockAttemptGet.mockRejectedValue(
      new Error('7 PERMISSION_DENIED: projects/aglyn-main/rateLimits'),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.checks.signupDrought.code).toBe('traffic-unavailable')
    expect(body.checks.signupDrought.signupAttempts).toBeNull()
    expect(JSON.stringify(body)).not.toContain('PERMISSION_DENIED')
  })

  it('a failed SERVE query alone stays calm — context, not verdict (AGL-2714)', async () => {
    // Serves stopped deciding anything, so losing them must not manufacture a
    // degraded reading on an hour when nobody was even trying.
    mockCountGet.mockImplementation(countOf(0))
    mockServedGet.mockRejectedValue(new Error('7 PERMISSION_DENIED'))
    mockAttemptGet.mockImplementation(attemptsOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.checks.signupDrought.ok).toBe(true)
    expect(body.checks.signupDrought.signupPagesServed).toBeNull()
  })

  it('SIGNUP_DROUGHT_MIN_TRAFFIC=0 forces the red — the alert-path lever', async () => {
    // The documented synthetic failure: a floor of zero makes any hour with
    // no creations a drought, so the deployed alert can be proven end to end
    // without breaking signup for a single visitor.
    process.env['SIGNUP_DROUGHT_MIN_TRAFFIC'] = '0'
    mockCountGet.mockImplementation(countOf(0))
    mockServedGet.mockImplementation(servesOf())
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    expect((await response.json()).checks.signupDrought).toMatchObject({
      code: 'signup-drought',
      minimumTraffic: 0,
    })
  })

  it('an unparsable override falls back to the shared default', async () => {
    process.env['SIGNUP_DROUGHT_MIN_TRAFFIC'] = 'five'
    mockCountGet.mockImplementation(countOf(0))
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    // 3, in ATTEMPTS, since AGL-2714 — it was 5 while the floor was counted
    // in signup-page serves, and the unit changing is why the number did.
    expect((await response.json()).checks.signupDrought.minimumTraffic).toBe(3)
  })

  it('spends ONE org count on both verdicts, not two', async () => {
    // A second aggregation would double a public endpoint's cost and — worse
    // — let the body report "0 created" beside "not a drought", because the
    // two numbers would come from two different moments.
    mockCountGet.mockImplementation(countOf(0))
    mockServedGet.mockImplementation(servesOf(serveMarker('signupServed_1', 9)))
    const body = await (await (await freshRoute()).GET()).json()
    expect(queries).toHaveLength(1)
    expect(body.checks.signupDrought.orgCreations).toBe(
      body.checks.signupVolume.recentOrgCreations,
    )
  })

  it('publishes counts only — no visitor, no IP, no referrer', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockServedGet.mockImplementation(servesOf(serveMarker('signupServed_1', 3)))
    mockAttemptGet.mockImplementation(
      attemptsOf(attemptMarker('signupAttempted_1', 3)),
    )
    const body = await (await (await freshRoute()).GET()).json()
    expect(Object.keys(body.checks.signupDrought).sort()).toEqual([
      'minimumTraffic',
      'ms',
      'ok',
      'orgCreations',
      'signupAttempts',
      'signupPagesServed',
      'windowMinutes',
    ])
  })
})

/**
 * AGL-2583 — the rename did not cost anybody a monitor.
 *
 * `/api/health/signups` is the path the GCP uptime check, the GitHub probe
 * and any self-hoster's monitor were already pointed at. It still answers,
 * with the same body and the same status, and it is NOT a redirect — this
 * repo's own probe refuses to follow a `3xx` and would report one as an
 * outage (AGL-786).
 */
describe('AGL-2583 · the old /api/health/signups path still answers', () => {
  it('serves the same body and status as the renamed route', async () => {
    mockCountGet.mockImplementation(countOf(1))
    jest.resetModules()
    const alias = await import('../app/api/health/signups/route')
    const response = await alias.GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.service).toBe('console-signup-volume')
    expect(Object.keys(body.checks).sort()).toEqual([
      'signupDrought',
      'signupLanding',
      'signupRefusals',
      'signupVolume',
      'signupWorkspace',
    ])
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })

  it('goes RED with the renamed route — a working alias, not a green stub', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockServedGet.mockImplementation(servesOf(serveMarker('signupServed_1', 50)))
    mockAttemptGet.mockImplementation(
      attemptsOf(attemptMarker('signupAttempted_1', 50)),
    )
    jest.resetModules()
    const alias = await import('../app/api/health/signups/route')
    const response = await alias.GET()
    expect(response.status).toBe(503)
    expect((await response.json()).checks.signupDrought.code).toBe(
      'signup-drought',
    )
  })

  it('declares its own no-cache segment config, never inheriting one', async () => {
    // A re-exported `dynamic` is not something Next follows, so the alias
    // would quietly become a CACHEABLE health check — the first way a health
    // check learns to lie.
    jest.resetModules()
    const alias = await import('../app/api/health/signups/route')
    expect(alias.dynamic).toBe('force-dynamic')
    expect(alias.revalidate).toBe(0)
  })
})

/**
 * AGL-2583 — the blocking function's decisions are now DATA, and this route
 * grades them.
 *
 * `beforeUserCreated` decides on the Identity Platform path, in front of
 * everything the rate limiter can see, and its only trace used to be a
 * `logger.warn` on Cloud Run stderr. It now writes the same
 * `signupRefused_` marker the limiter does, which means this endpoint —
 * unchanged in shape — covers that door too.
 */
describe('AGL-2583 · one blind signups-lock decision is a 503', () => {
  /** A marker as the blocking function writes it for a blind admission. */
  const blindMarker = (id: string, unreadable: number) => ({
    id,
    data: () => ({
      refusals: 0,
      byReason: {},
      unreadable,
      refusedAtMs: Date.now() - 60_000,
    }),
  })

  it('REDS on a single blind decision, with no refusal beside it', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockRefusalGet.mockImplementation(
      refusalsOf(blindMarker('signupRefused_1', 1)),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.checks.signupRefusals).toMatchObject({
      ok: false,
      code: 'signups-lock-unreadable',
      refusedSignups: 0,
      lockUnreadable: 1,
    })
    // Zero refusals against a threshold of fifty: the volume rule alone
    // reads this hour as perfectly healthy, which is exactly what it did.
    expect(body.checks.signupRefusals.threshold).toBe(50)
  })

  it('ALLOWS a deliberate staff lock — pulling the lever must not page', async () => {
    mockCountGet.mockImplementation(countOf(0))
    mockRefusalGet.mockImplementation(
      refusalsOf(marker('signupRefused_1', 3, { locked: 3 })),
    )
    const response = await (await freshRoute()).GET()
    expect(response.status).toBe(200)
    expect((await response.json()).checks.signupRefusals.lockUnreadable).toBe(0)
  })
})

describe('AGL-3725 · signupLanding: a workspace that never reached a site', () => {
  /*
   * AGL-3724 made every workspace it was asked for and sent the person to a
   * 404 before the site list. Volume, refusals, drought and the canary all
   * stayed green for nine hours, because each of them asks about workspaces.
   */
  it('goes red when the two newest people past the grace period have no site', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockLandingGet.mockImplementation(orgsWithSites(0, 0, 1, 2))
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.checks.signupLanding).toMatchObject({
      ok: false,
      code: 'signups-stranded',
      strandedOrgs: 2,
      strandedPeople: 2,
      strandedStreak: 2,
      orgsInWindow: 4,
      windowHours: 12,
      graceMinutes: 30,
      maxStranded: 2,
    })
  })

  it('stays green for two drop-offs with a person who made a site between them (2026-10-17)', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockLandingGet.mockImplementation(orgsWithSites(0, 1, 0, 2))
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.checks.signupLanding).toMatchObject({
      ok: true,
      strandedOrgs: 2,
      strandedPeople: 2,
      strandedStreak: 1,
    })
  })

  it("counts one browser's workspaces as one person, and never prints who (2026-10-17)", async () => {
    // A third workspace made with a second Google account, after the first
    // one got a site: the same first-touch stamp, so the same person.
    mockCountGet.mockImplementation(countOf(1))
    mockLandingGet.mockImplementation(
      orgsMadeBy([
        { sites: 0, firstTouch: 1792233980958, owner: 'second-google' },
        { sites: 0, owner: 'someone-else' },
        { sites: 1, firstTouch: 1792233980958, owner: 'first-google' },
      ]),
    )
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.checks.signupLanding).toMatchObject({
      ok: true,
      strandedOrgs: 2,
      strandedPeople: 1,
      strandedStreak: 0,
    })
    const text = JSON.stringify(body)
    expect(text).not.toContain('1792233980958')
    expect(text).not.toContain('second-google')
  })

  it('reads the landing marker: owners who reached the console are not stranded (2026-10-18)', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockLandingGet.mockImplementation(
      orgsMadeBy([
        { sites: 0, landedAtMs: Date.now() - 3_600_000 },
        { sites: 0, landedAtMs: Date.now() - 7_200_000 },
        { sites: 0, landedAtMs: 'unmarked' },
      ]),
    )
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.checks.signupLanding).toMatchObject({
      ok: true,
      strandedOrgs: 0,
      strandedStreak: 0,
      unmarkedOrgs: 1,
    })
  })

  it('stays green for one person who signed up and left', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockLandingGet.mockImplementation(orgsWithSites(0, 1, 1))
    const { GET } = await freshRoute()
    const body = await (await GET()).json()
    expect(body.checks.signupLanding).toMatchObject({ ok: true, strandedOrgs: 1 })
    expect(body.checks.signupLanding.code).toBeUndefined()
  })

  it('reads orgs between twelve hours and thirty minutes old, bounded', async () => {
    mockCountGet.mockImplementation(countOf(0))
    const before = Date.now()
    const { GET } = await freshRoute()
    await GET()
    const after = Date.now()
    expect(landingQueries).toHaveLength(1)
    const [query] = landingQueries
    expect(query.collection).toBe('orgs')
    expect(query.limit).toBeGreaterThan(0)
    const [older, newer] = query.bounds
    expect(older).toMatchObject({ field: 'createdAt', op: '>' })
    expect(newer).toMatchObject({ field: 'createdAt', op: '<=' })
    expect(older.ms).toBeGreaterThanOrEqual(before - 12 * 3_600_000)
    expect(older.ms).toBeLessThanOrEqual(after - 12 * 3_600_000)
    expect(newer.ms).toBeGreaterThanOrEqual(before - 30 * 60_000)
    expect(newer.ms).toBeLessThanOrEqual(after - 30 * 60_000)
  })

  it('is degraded, never calm, when the orgs cannot be read', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockLandingGet.mockRejectedValue(
      new Error('7 PERMISSION_DENIED: projects/aglyn-main/databases/(default)'),
    )
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.checks.signupLanding).toMatchObject({
      ok: false,
      code: 'orgs-unavailable',
      strandedOrgs: null,
    })
    // The provider's message never reaches the public body.
    expect(JSON.stringify(body)).not.toContain('aglyn-main')
  })
})

describe('AGL-4021 · signupWorkspace: a verified account that never got a workspace', () => {
  /*
   * signupLanding grades orgs, so an account with none is invisible to it.
   * Three phone Google sign-ups on 2026-10-20/21 got no workspace at all and
   * every check stayed green.
   */
  const now = Date.now()
  const accountsOf = (
    ...rows: { uid: string; door: string; minutesAgo: number; workspace: boolean; accepted?: boolean; verified?: boolean }[]
  ) => {
    mockWorkspaceGet.mockResolvedValue({
      docs: rows.map((row) => ({
        id: row.uid,
        get: (field: string) =>
          field === 'acquisition'
            ? { door: row.door, accountCreatedAt: now - row.minutesAgo * 60_000 }
            : undefined,
      })),
    })
    mockGetUsers.mockImplementation(async (ids: { uid: string }[]) => ({
      users: ids.map(({ uid }) => ({
        uid,
        emailVerified: rows.find((row) => row.uid === uid)?.verified !== false,
      })),
    }))
    mockAccountSubGet.mockImplementation(async (uid: string, sub: string) => {
      const row = rows.find((candidate) => candidate.uid === uid)
      const present = sub === 'orgs' ? row?.workspace : row?.accepted !== false
      return { empty: !present }
    })
  }

  it('goes red when the two newest accounts through one door have no workspace', async () => {
    mockCountGet.mockImplementation(countOf(1))
    accountsOf(
      { uid: 'a', door: 'signup-google', minutesAgo: 40, workspace: true },
      { uid: 'b', door: 'signup-google-redirect', minutesAgo: 60, workspace: false },
      { uid: 'c', door: 'signup-password', minutesAgo: 90, workspace: true },
      { uid: 'd', door: 'signup-google-redirect', minutesAgo: 120, workspace: false },
    )
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.checks.signupWorkspace).toMatchObject({
      ok: false,
      code: 'signups-without-workspace',
      workspacelessAccounts: 2,
      workspacelessStreak: 2,
      gradedInWindow: 4,
      windowHours: 36,
    })
    // Counts only: the public body never names an account or a door.
    expect(JSON.stringify(body)).not.toMatch(/signup-google-redirect|"[abcd]"/)
  })

  it('stays green for a Google account that walked away from the consent bounce', async () => {
    mockCountGet.mockImplementation(countOf(1))
    accountsOf(
      { uid: 'a', door: 'signup-google', minutesAgo: 40, workspace: false, accepted: false },
      { uid: 'b', door: 'signup-google', minutesAgo: 60, workspace: false, accepted: false },
    )
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.checks.signupWorkspace).toMatchObject({ ok: true, gradedInWindow: 0 })
  })

  it('reads accounts between thirty-six hours and thirty minutes old, bounded', async () => {
    mockCountGet.mockImplementation(countOf(1))
    const before = Date.now()
    await (await freshRoute()).GET()
    expect(workspaceQueries).toHaveLength(1)
    const [query] = workspaceQueries
    expect(query.limit).toBe(200)
    expect(query.bounds[0]).toMatchObject({ field: 'acquisition.accountCreatedAt', op: '>' })
    expect(query.bounds[1]).toMatchObject({ field: 'acquisition.accountCreatedAt', op: '<=' })
    // Never further back than thirty-six hours. (The graded-since floor can
    // only move it forward.)
    expect(query.bounds[0].ms).toBeGreaterThanOrEqual(before - 36 * 3_600_000 - 1_000)
    expect(before - 30 * 60_000 - query.bounds[1].ms).toBeLessThan(5_000)
  })

  it('is degraded, never calm, when the account read fails', async () => {
    mockCountGet.mockImplementation(countOf(1))
    mockWorkspaceGet.mockRejectedValue(new Error('unavailable'))
    const { GET } = await freshRoute()
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.checks.signupWorkspace).toMatchObject({
      ok: false,
      code: 'accounts-unavailable',
    })
  })
})
