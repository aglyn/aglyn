/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * The spend ladder on `/api/ai/assist` (AGL-2073).
 *
 * This route had no rate limit, no quota and no cost telemetry: an entitled
 * org could drive unbounded, unmeasured Anthropic spend through it. The tests
 * below are about WHEN each gate is evaluated, not how it counts — the
 * counting itself is proven in `assist-usage.spec.ts`, and this suite drives
 * the REAL reservation through the REAL rate limiter so a change to either
 * shows up here rather than in a stub that always agrees.
 *
 * Three claims carry the issue, and each has an inverse fixture so it cannot
 * pass by refusing (or admitting) everything:
 *
 *  1. **Concurrency.** N simultaneous requests against a limit of 1 admit
 *     exactly one; raise the limit to N and all N are admitted.
 *  2. **The dropped client.** The counter moves BEFORE the provider answers,
 *     so a caller that opens a request and walks away has already been
 *     counted — the failure mode that made an abandoned stream free.
 *  3. **The day boundary.** A reservation taken at 23:59:59 and released at
 *     00:00:01 credits the period it RESERVED, never the one it landed in.
 */

export {}

// ── The Firestore fake ──────────────────────────────────────────────────────
// Faithful `increment` + `set(merge)` + serializable-transaction semantics. A
// fake that let two transaction callbacks interleave their read phases would
// fabricate the very race the reservation exists to close, and go green on the
// broken code.

let mockDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0

function applyData(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    // Firestore rejects `undefined` outright rather than storing it; a fake
    // that quietly writes it hides a real write failure.
    if (value === undefined) {
      throw new Error(`undefined field value at ${key}`)
    }
    const inc = (value as { __inc?: number } | null)?.__inc
    if (typeof inc === 'number') {
      base[key] = Number(base[key] ?? 0) + inc
    } else {
      base[key] = value
    }
  }
  return base
}

/** Serialises transaction callbacks, one at a time, FIFO. */
let mockTxChain: Promise<void> = Promise.resolve()
function mockTxLock(): Promise<() => void> {
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  const waitFor = mockTxChain
  mockTxChain = mockTxChain.then(() => next)
  return waitFor.then(() => release)
}

function mockMakeFirestore() {
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => ({
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path),
      get: (field: string) => (mockDocs.get(path) ?? {})[field],
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      mockDocs.set(
        path,
        applyData(mockDocs.get(path), data, Boolean(options?.merge)),
      )
    },
    // NOT_FOUND on a missing document, exactly like the real thing — which is
    // why the counters are written with a merging `set` and never `update`.
    update: async (data: Record<string, unknown>) => {
      if (!mockDocs.has(path)) throw new Error('update on missing doc')
      mockDocs.set(path, applyData(mockDocs.get(path), data, true))
    },
  })
  const makeCollection = (prefix: string) => ({
    doc: (id?: string) => makeDoc(`${prefix}/${id ?? `auto-${++mockAutoId}`}`),
  })
  return {
    collection: (name: string) => makeCollection(name),
    runTransaction: async <T,>(
      fn: (tx: {
        get: (ref: { path: string }) => Promise<unknown>
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => void
      }) => Promise<T>,
    ): Promise<T> => {
      const release = await mockTxLock()
      try {
        const queued: Array<() => void> = []
        const tx = {
          get: async (ref: { path: string }) => ({
            exists: mockDocs.has(ref.path),
            data: () => mockDocs.get(ref.path),
            get: (field: string) => (mockDocs.get(ref.path) ?? {})[field],
          }),
          set: (
            ref: { path: string },
            data: Record<string, unknown>,
            options?: { merge?: boolean },
          ) => {
            queued.push(() => {
              mockDocs.set(
                ref.path,
                applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)),
              )
            })
          },
        }
        const result = await fn(tx)
        for (const write of queued) write()
        return result
      } finally {
        release()
      }
    },
    batch: () => {
      const queued: Array<() => void> = []
      const batch = {
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          queued.push(() => {
            mockDocs.set(
              ref.path,
              applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)),
            )
          })
          return batch
        },
        commit: async () => {
          for (const write of queued) write()
        },
      }
      return batch
    },
  }
}

// ── Module doubles ──────────────────────────────────────────────────────────

let mockVerifyIdToken: (token: string) => Promise<Record<string, unknown>>
let mockGetOrgForUser: (
  uid: string,
  orgId?: string | null,
) => Promise<unknown>
let mockLockdownRefusal: () => Promise<Response | null>
/**
 * The Firestore the handler is handed. A variable rather than a `jest.spyOn`
 * on the barrel: reaching for the module with a bare `require()` inside a test
 * makes nx read `tenant-data-admin` as lazy-loaded and then rejects every
 * STATIC import of it across the whole project — 27 unrelated files go red for
 * one line in one spec.
 */
let mockFirestoreFactory: () => unknown
let mockEntitled = true
const mockGetOrgCalls: Array<[string, string | null | undefined]> = []

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: () => mockEntitled,
}))

// The sentinel factory the fake above understands. The module under test
// reaches `firebase-admin/firestore` only for these two statics.
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

// The REAL reservation, meters and rate limiter are spliced in by path: the
// point of this suite is that the route is behind the shared ladder, and a
// stubbed `reserveAssistMessage` would prove only that the route calls
// something. The barrel itself stays mocked — importing it for real pulls the
// whole tenancy surface (and `next/cache`) into a unit test.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../../../tenant/data/admin/src/lib/server/assist-usage',
  ),
  ...jest.requireActual(
    '../../../../../tenant/data/admin/src/lib/server/api-http',
  ),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (token: string) => mockVerifyIdToken(token),
      }),
      firestore: () => mockFirestoreFactory(),
    }),
  },
  getOrgForUser: (uid: string, orgId?: string | null) => {
    mockGetOrgCalls.push([uid, orgId])
    return mockGetOrgForUser(uid, orgId)
  },
  lockdownRefusal: () => mockLockdownRefusal(),
}))

const { aiAssistHandler } = require('./ai-assist') as typeof import('./ai-assist')

// ── Harness ─────────────────────────────────────────────────────────────────

const ORG = 'org-pro'
const MONTH_DOC = (month: string) => `orgs/${ORG}/assistUsage/${month}`
const DAILY_DOC = `orgs/${ORG}/counters/assistMessagesDaily`

interface Captured {
  status: number
  body: any
  headers: Record<string, string>
}

/** A `PluginApiResponse` that records what the handler wrote. */
function makeRes(): { res: any; captured: Captured; done: Promise<Captured> } {
  const captured: Captured = { status: 0, body: undefined, headers: {} }
  let settle!: (value: Captured) => void
  const done = new Promise<Captured>((resolve) => {
    settle = resolve
  })
  const res = {
    status(code: number) {
      captured.status = code
      return res
    },
    json(body: unknown) {
      captured.body = body
      settle(captured)
    },
    send(body: unknown) {
      captured.body = body
      settle(captured)
    },
    setHeader(name: string, value: string | number) {
      captured.headers[name] = String(value)
    },
    redirect() {
      /* unused */
    },
    end() {
      settle(captured)
    },
  }
  return { res, captured, done }
}

function makeReq(
  body: Record<string, unknown>,
  token = 'user-token',
): Record<string, unknown> {
  return {
    method: 'POST',
    query: {},
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cookies: {},
    socket: {},
  }
}

/** One provider response, in Anthropic's message shape. */
function anthropicOk(text: string, usage?: Record<string, number>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        ...usage,
      },
    }),
  }
}

let mockFetch: jest.Mock

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  mockTxChain = Promise.resolve()
  mockGetOrgCalls.length = 0
  mockEntitled = true
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  delete process.env.ASSIST_ENTITLED_MONTHLY_LIMIT
  delete process.env.ASSIST_FREE_DAILY_LIMIT
  mockVerifyIdToken = async (token: string) => ({ uid: `uid-${token}` })
  mockGetOrgForUser = async (uid: string, orgId?: string | null) =>
    orgId === ORG ? { orgId: ORG, org: { plan: 'pro' }, member: { $id: uid } } : null
  mockLockdownRefusal = async () => null
  mockFirestoreFactory = () => mockMakeFirestore()
  mockFetch = jest.fn(async () => anthropicOk('Rewritten copy.'))
  ;(globalThis as any).fetch = mockFetch
})

afterEach(() => {
  jest.useRealTimers()
})

/** Drive the handler once and wait for whatever it wrote back. */
async function call(
  body: Record<string, unknown>,
  token = 'user-token',
): Promise<Captured> {
  const { res, done } = makeRes()
  await Promise.resolve(aiAssistHandler(makeReq(body, token) as any, res))
  return done
}

const BODY = { orgId: ORG, instruction: 'Punchier, please', text: 'Hello' }

// ── 1. Concurrency ──────────────────────────────────────────────────────────

describe('the cap holds under concurrency (AGL-2073)', () => {
  it('admits exactly ONE of eight simultaneous requests at a limit of 1', async () => {
    // The read-then-act shape this replaces would admit all eight: each reads
    // "0 used, limit 1" before any of them records.
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '1'
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        call(BODY, `token-concurrency-${index}`),
      ),
    )
    const admitted = results.filter((result) => result.status === 200)
    const refused = results.filter((result) => result.status === 429)
    expect([admitted.length, refused.length]).toEqual([1, 7])
    // And the provider was reached exactly once — the refusals cost nothing.
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const month = new Date().toISOString().slice(0, 7)
    expect(mockDocs.get(MONTH_DOC(month))?.['messages']).toBe(1)
  })

  it('admits ALL eight once the limit is eight — the inverse fixture', async () => {
    // Without this, the test above would pass on a handler that refuses
    // everything, which is not a cap, it is an outage.
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '8'
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        call(BODY, `token-inverse-${index}`),
      ),
    )
    expect(results.filter((result) => result.status === 200)).toHaveLength(8)
    expect(mockFetch).toHaveBeenCalledTimes(8)
    const month = new Date().toISOString().slice(0, 7)
    expect(mockDocs.get(MONTH_DOC(month))?.['messages']).toBe(8)
  })

  it('never lets the counter past the limit', async () => {
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '3'
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        call(BODY, `token-ceiling-${index}`),
      ),
    )
    const month = new Date().toISOString().slice(0, 7)
    expect(mockDocs.get(MONTH_DOC(month))?.['messages']).toBe(3)
  })
})

// ── 2. The dropped client ───────────────────────────────────────────────────

describe('an abandoned request is still counted (AGL-2073)', () => {
  it('has moved the counter BEFORE the provider answers', async () => {
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '10'
    // A provider call that never resolves stands in for the client that opens
    // a request and walks away: nothing downstream of the fetch ever runs.
    let releaseProvider!: () => void
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseProvider = () => resolve(anthropicOk('never read') as never)
        }),
    )
    const { res } = makeRes()
    const inFlight = Promise.resolve(
      aiAssistHandler(makeReq(BODY, 'token-abandoned') as any, res),
    )
    // Let the ladder run up to the provider call and stop there.
    await new Promise((resolve) => setImmediate(resolve))
    const month = new Date().toISOString().slice(0, 7)
    const day = new Date().toISOString().slice(0, 10)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockDocs.get(MONTH_DOC(month))?.['messages']).toBe(1)
    expect(mockDocs.get(DAILY_DOC)?.[day]).toBe(1)
    releaseProvider()
    await inFlight
  })

  it('so a loop of abandoned requests exhausts the cap instead of running free', async () => {
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '2'
    mockFetch.mockImplementation(() => new Promise(() => undefined))
    const { res: first } = makeRes()
    const { res: second } = makeRes()
    void aiAssistHandler(makeReq(BODY, 'token-loop-1') as any, first)
    void aiAssistHandler(makeReq(BODY, 'token-loop-2') as any, second)
    await new Promise((resolve) => setImmediate(resolve))
    // Nothing completed, yet the third request is refused — which is the whole
    // difference between a cap and a suggestion.
    const third = await call(BODY, 'token-loop-3')
    expect(third.status).toBe(429)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ── 3. The day boundary ─────────────────────────────────────────────────────

describe('a refund credits the period it RESERVED (AGL-2073)', () => {
  it('gives back the reserved day and month across a midnight rollover', async () => {
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '10'
    // `setImmediate` stays real: it is how this test lets the ladder run up
    // to the provider call, and a faked one would deadlock the await below.
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
    // Last second of August. The reservation records 2026-08-31 / 2026-08.
    jest.setSystemTime(new Date('2026-08-31T23:59:59.000Z'))
    let failProvider!: () => void
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          failProvider = () =>
            resolve({
              ok: false,
              status: 502,
              json: async () => ({ error: { message: 'Overloaded' } }),
            } as never)
        }),
    )
    const { res, done } = makeRes()
    void aiAssistHandler(makeReq(BODY, 'token-boundary') as any, res)
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockDocs.get('orgs/org-pro/assistUsage/2026-08')?.['messages']).toBe(1)
    expect(mockDocs.get(DAILY_DOC)?.['2026-08-31']).toBe(1)

    // The provider fails two seconds later — in September.
    jest.setSystemTime(new Date('2026-09-01T00:00:01.000Z'))
    failProvider()
    const result = await done
    expect(result.status).toBe(502)

    // The August keys are made whole; September was never touched. Releasing
    // against "now" would have handed the org a free September message.
    expect(mockDocs.get('orgs/org-pro/assistUsage/2026-08')?.['messages']).toBe(0)
    expect(mockDocs.get(DAILY_DOC)?.['2026-08-31']).toBe(0)
    expect(mockDocs.get('orgs/org-pro/assistUsage/2026-09')).toBeUndefined()
    expect(mockDocs.get(DAILY_DOC)?.['2026-09-01']).toBeUndefined()
  })

  it('does NOT refund once the provider has answered — the tokens are spent', async () => {
    // The inverse of the refund: a 200 whose body we cannot use still cost
    // money, so the reservation stays consumed and the cost is still metered.
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '10'
    mockFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'not json at all' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 900, output_tokens: 120 },
      }),
    }))
    const result = await call(
      { ...BODY, mode: 'section', instruction: 'A hero section' },
      'token-garbage',
    )
    expect(result.status).toBe(502)
    const month = new Date().toISOString().slice(0, 7)
    expect(mockDocs.get(MONTH_DOC(month))?.['messages']).toBe(1)
    // …and the tokens landed on the org's bill anyway.
    expect(mockDocs.get(MONTH_DOC(month))?.['inputTokens']).toBe(900)
  })
})

// ── Metering ────────────────────────────────────────────────────────────────

describe('every answered call is metered per org (AGL-2073)', () => {
  it('writes a signal and folds tokens + cost into the monthly rollup', async () => {
    const result = await call(BODY, 'token-meter')
    expect(result.status).toBe(200)
    const month = new Date().toISOString().slice(0, 7)
    const rollup = mockDocs.get(MONTH_DOC(month)) as Record<string, number>
    expect(rollup['inputTokens']).toBe(100)
    expect(rollup['outputTokens']).toBe(40)
    // Sonnet list rates: 100 in @ $3/MTok + 40 out @ $15/MTok.
    expect(rollup['estCostUsd']).toBeCloseTo(0.0009, 6)

    const signals = [...mockDocs.entries()].filter(([path]) =>
      path.startsWith(`orgs/${ORG}/assistSignals/`),
    )
    expect(signals).toHaveLength(1)
    expect(signals[0][1]).toMatchObject({
      route: '/api/ai/assist/element',
      model: 'claude-sonnet-5',
      tier: 'entitled',
      stopReason: 'end_turn',
      inputTokens: 100,
      outputTokens: 40,
    })
  })

  it('keeps NO verbatim record of what the customer typed', async () => {
    // The privacy line this route sits on: the margin question is answered by
    // the signal, and the prose is site copy nobody agreed to have retained.
    await call(BODY, 'token-no-prose')
    const exchanges = [...mockDocs.keys()].filter((path) =>
      path.startsWith(`orgs/${ORG}/assistExchanges/`),
    )
    expect(exchanges).toEqual([])
    const signals = [...mockDocs.values()].filter(
      (doc) => 'estCostUsd' in doc && 'stopReason' in doc,
    )
    for (const signal of signals) {
      expect(Object.keys(signal)).not.toContain('uid')
      expect(JSON.stringify(signal)).not.toContain('Punchier')
    }
  })

  it('attributes the section mode separately, for margin analysis', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              rootId: 'n1',
              nodes: {
                n1: {
                  $id: 'n1',
                  componentId: 'muiStack',
                  parentId: null,
                  props: {},
                  nodes: [],
                },
              },
            }),
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 700, output_tokens: 900 },
      }),
    }))
    const result = await call(
      { ...BODY, mode: 'section', instruction: 'A hero section' },
      'token-section',
    )
    expect(result.status).toBe(200)
    const signals = [...mockDocs.entries()].filter(([path]) =>
      path.startsWith(`orgs/${ORG}/assistSignals/`),
    )
    expect(signals[0][1]).toMatchObject({ route: '/api/ai/assist/section' })
  })
})

// ── The rest of the ladder ──────────────────────────────────────────────────

describe('the ladder refuses before it spends (AGL-2073)', () => {
  it('rate limits a uid at 20/min, without taking a reservation', async () => {
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '1000'
    const results: Captured[] = []
    for (let index = 0; index < 21; index += 1) {
      results.push(await call(BODY, 'token-rate'))
    }
    expect(results.slice(0, 20).every((r) => r.status === 200)).toBe(true)
    const last = results[20]
    expect(last.status).toBe(429)
    expect(last.headers['X-RateLimit-Limit']).toBe('20')
    // The 21st spent nothing AND consumed no quota — the order matters: a
    // rate-limited request that had already reserved would burn the org's cap
    // on requests it never made.
    expect(mockFetch).toHaveBeenCalledTimes(20)
    const month = new Date().toISOString().slice(0, 7)
    expect(mockDocs.get(MONTH_DOC(month))?.['messages']).toBe(20)
  })

  it('meters against the org the REQUEST names, not the one the user happens to be in', async () => {
    // The multi-org leak: `getOrgForUser(uid)` with no org argument handed a
    // user with one paid workspace assist on all of their free ones.
    const result = await call({ ...BODY, orgId: 'org-someone-else' }, 'token-scope')
    expect(result.status).toBe(403)
    expect(mockGetOrgCalls).toEqual([['uid-token-scope', 'org-someone-else']])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('400s a request that names no org at all', async () => {
    const result = await call({ instruction: 'go', text: 'x' }, 'token-noorg')
    expect(result.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockDocs.size).toBe(0)
  })

  it('403s a free workspace before the reservation', async () => {
    mockEntitled = false
    const result = await call(BODY, 'token-free')
    expect(result.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockDocs.size).toBe(0)
  })

  it('423s an org-scoped lockdown, which the dispatcher could not see', async () => {
    // The dispatcher evaluates org lockdown only when the request names a
    // hostId, and this route's callers do not — so a suspended workspace kept
    // spending until the verdict moved here.
    mockLockdownRefusal = async () =>
      Response.json({ error: 'locked', scope: 'org' }, { status: 423 })
    const result = await call(BODY, 'token-locked')
    expect([result.status, result.body]).toEqual([
      423,
      { error: 'locked', scope: 'org' },
    ])
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockDocs.size).toBe(0)
  })

  it('FAILS CLOSED when the reservation cannot be taken', async () => {
    // The deliberate asymmetry: the rate limiter is a per-instance smoother
    // and may fail soft, but the reservation is the only global bound on what
    // this route can spend. No cap must mean no call.
    process.env.ASSIST_ENTITLED_MONTHLY_LIMIT = '10'
    mockFirestoreFactory = () => ({
      ...mockMakeFirestore(),
      runTransaction: async () => {
        throw new Error('firestore unavailable')
      },
    })
    const result = await call(BODY, 'token-closed')
    expect(result.status).toBe(503)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('405s a GET and 501s without an API key, before anything else', async () => {
    const { res: getRes, done: getDone } = makeRes()
    await Promise.resolve(
      aiAssistHandler({ ...makeReq(BODY), method: 'GET' } as any, getRes),
    )
    expect((await getDone).status).toBe(405)

    delete process.env.ANTHROPIC_API_KEY
    const result = await call(BODY, 'token-nokey')
    expect(result.status).toBe(501)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
