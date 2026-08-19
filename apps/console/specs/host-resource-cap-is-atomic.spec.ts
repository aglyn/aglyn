/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-2231 — a free plan's resource caps hold under CONCURRENCY.
 *
 * ZACH, 2026-08-18, verbatim: *"the free/hobby tier does hard cap so it always
 * actually stays free"*. A cap that a client can beat by sending its requests
 * at the same time is not a hard cap; it is a suggestion with a race in it.
 *
 * ## The defect
 *
 * `/api/hosts/resources` read the collection count, decided, and then called
 * `collectionRef.doc(id).create(...)` — outside any transaction. Every `await`
 * in between is a yield, so N in-flight POSTs each read the same pre-count,
 * each found room, and each landed. **Nothing re-counts after a create**, so
 * the extra documents were permanent: a free plan's five screens became fifty
 * by sending fifty requests at once, and no subsequent request ever noticed.
 *
 * This is the shape AGL-1383 / AGL-1387 / AGL-1390 chased three times through
 * the COUNTING RULE, and its own analysis named the generalisation: *the
 * question is WHEN the cap is evaluated, not how well it counts*. Improving the
 * count cannot close this one at all.
 *
 * ## What the double models, and why that is not cheating
 *
 * `Transaction.get(AggregateQuery)` holds a pessimistic lock on every document
 * the underlying query matched, so two transactions counting the same
 * collection cannot both commit against the same snapshot — the loser aborts,
 * retries, re-reads the higher count and is refused. The fake below models
 * exactly that and nothing more:
 *
 *  - a transaction body runs while holding a per-collection lock;
 *  - reads inside see the store as of that moment;
 *  - buffered writes apply on commit;
 *  - a read after a write throws, as the server does.
 *
 * **The lock is on the TRANSACTION, not on the handler.** That is the whole
 * reason this suite discriminates: with the counting reads outside the
 * transaction — the code as it shipped — serializing the transaction body
 * changes nothing, because the count was already taken. Forced red exactly
 * that way; see the header of the concurrency test.
 *
 * ## Both halves, always
 *
 * A suite asserting only "the sixth is refused" also passes against a route
 * that refuses EVERYTHING, which is the most likely way a cap fix goes wrong.
 * So every case here pins the pair: the last permitted create SUCCEEDS and the
 * next one is refused, and the concurrent case asserts the exact number of
 * survivors rather than "not all of them".
 */

const mockVerifyIdToken = jest.fn()

interface FakeScreen {
  id: string
  kind?: unknown
  deletedAt?: unknown
  [field: string]: unknown
}

const mockState: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
  /** The host's live screen documents, keyed by id — the SERVER's view. */
  screens: Map<string, FakeScreen>
  /** How many transaction attempts ran, including retries. */
  attempts: number
  /** Ids handed to `createResourceUid`, in order. */
  minted: Array<string>
} = {
  memberRoles: {},
  org: {},
  screens: new Map(),
  attempts: 0,
  minted: [],
}

/** Every screen row, projected the way `readScreenSources` asks for it. */
const mockScreenDocs = () =>
  [...mockState.screens.values()].map((screen) => ({
    id: screen.id,
    get: (field: string) => screen[field],
  }))

const mockScreensCollection = () => ({
  select: () => ({ get: async () => ({ docs: mockScreenDocs() }) }),
  count: () => ({
    get: async () => ({ data: () => ({ count: mockState.screens.size }) }),
  }),
  where: () => ({
    count: () => ({
      get: async () => ({ data: () => ({ count: mockState.screens.size }) }),
    }),
  }),
  doc: (id: string) => ({
    id,
    create: (payload: Record<string, unknown>) => {
      // Firestore's `create` is not an upsert — it throws ALREADY_EXISTS, and
      // the route turns that into a 409. Modelled so a double-create can never
      // read as a silent overwrite.
      if (mockState.screens.has(id)) {
        throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      }
      mockState.screens.set(id, { id, ...payload })
    },
  }),
})

/**
 * A transaction that SERIALIZES and RETRIES, which is what the fix leans on.
 *
 * One global lock stands in for the per-collection pessimistic lock: this route
 * only ever touches one collection per request, so a finer-grained model would
 * be more code for the same verdict. Each body runs to completion — reads, then
 * decision, then the buffered write applied on commit — before the next begins.
 *
 * Retries are modelled through `create` throwing ALREADY_EXISTS rather than
 * through an abort code, because that is the only contention this route can
 * actually produce: ids are minted per request, so two transactions never write
 * the same document. The serialization is what makes the second body's COUNT
 * see the first body's write, which is the property under test.
 */
let mockLock: Promise<unknown> = Promise.resolve()
const mockRunTransaction = async (body: (tx: any) => Promise<any>) => {
  const attempt = mockLock.then(async () => {
    mockState.attempts += 1
    const buffered: Array<() => unknown> = []
    const result = await body({
      get: (query: any) => {
        if (buffered.length) {
          throw new Error('Firestore transactions cannot read after a write')
        }
        return query.get()
      },
      create: (ref: any, payload: unknown) => {
        buffered.push(() => ref.create(payload))
      },
    })
    for (const write of buffered) write()
    return result
  })
  // The lock must advance even when a body rejects, or one failure deadlocks
  // every later request in the suite.
  mockLock = attempt.catch(() => undefined)
  return attempt
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ seconds: 0 }) },
  FieldValue: { delete: () => '__field_deleted__' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        runTransaction: (body: (tx: any) => Promise<any>) =>
          mockRunTransaction(body),
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              // No routing map: an unrouted screen carrying no `kind` still
              // claims to be a page, so every seeded row is billable and the
              // only cap that can speak here is `screensPerHost`.
              get: (field: string) =>
                field === 'memberRoles' ? mockState.memberRoles : undefined,
              data: () => undefined,
            }),
            collection: () => mockScreensCollection(),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockState.org }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getLockdownVerdict: async (options: Record<string, any>) =>
    options?.staff === true
      ? null
      : options?.org?.suspendedAt != null
        ? { scope: 'org', reason: 'manual' }
        : null,
  lockdownJsonResponse: (verdict: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...verdict }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table and the REAL page-claim rule. Stubbing either would let
  // this suite pass against a route enforcing nothing — which IS the bug.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/actions'),
  // The REAL host-role gate (AGL-2334). These routes ask
  // `hostRoleCanWrite` whether the caller may write at all, and this factory
  // is a CLOSED WORLD — anything it does not name is `undefined`, so leaving
  // it out makes the route throw and every assertion below read a 500 as if
  // the behaviour under test had regressed. Stubbed `() => true` it would be
  // worse: the suite would pass against a route that admits anybody.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  createResourceUid: () => {
    const id = `minted-${mockState.minted.length}`
    mockState.minted.push(id)
    return id
  },
  nameSearchKey: (value: string) => value.toLowerCase(),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { POST } from '../app/api/hosts/resources/route'

const FREE_SCREENS = PLAN_ENTITLEMENTS.free.screensPerHost

const createScreen = () =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        hostId: 'host-1',
        resource: 'screen',
        data: { displayName: 'Untitled' },
      }),
    }),
  )

/** `n` live page documents, as the server sees them. */
const seedScreens = (n: number) => {
  mockState.screens = new Map(
    Array.from({ length: n }, (_unused, index) => [
      `seed-${index}`,
      { id: `seed-${index}` } as FakeScreen,
    ]),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLock = Promise.resolve()
  mockState.memberRoles = { 'user-1': 'admin' }
  mockState.org = { plan: 'free' }
  mockState.screens = new Map()
  mockState.attempts = 0
  mockState.minted = []
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('the premise', () => {
  it('free includes a small, FINITE number of screens', () => {
    // If this ever becomes UNLIMITED the whole suite goes vacuous — every
    // create would succeed and every assertion below would still pass.
    expect(FREE_SCREENS).toBe(5)
    expect(Number.isFinite(FREE_SCREENS)).toBe(true)
  })
})

describe('SEQUENTIALLY: the cap admits its last slot and refuses the next', () => {
  it('creates the 5th screen', async () => {
    seedScreens(FREE_SCREENS - 1)
    const response = await createScreen()
    expect(response.status).toBe(200)
    expect(mockState.screens.size).toBe(FREE_SCREENS)
  })

  it('refuses the 6th', async () => {
    seedScreens(FREE_SCREENS)
    const response = await createScreen()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain(String(FREE_SCREENS))
    // The refusal WROTE NOTHING. A 403 with the document created anyway is the
    // same bug wearing a status code.
    expect(mockState.screens.size).toBe(FREE_SCREENS)
  })
})

describe('CONCURRENTLY: twenty requests at once still land exactly five', () => {
  /**
   * THE REGRESSION TEST.
   *
   * Forced red by moving the counting reads back outside the transaction —
   * the shape the route shipped with:
   *
   *   const screenRows = await readScreenSources(hostRef)
   *   … checkQuota(org, 'screensPerHost', billableScreenIds(...).size) …
   *   const refusal = await firestore.mockRunTransaction(async (tx) => {
   *     tx.create(collectionRef.doc(id), { … })
   *     return null
   *   })
   *
   * Result with that mutation: **20 of 20 succeeded, 20 screens on a plan that
   * includes 5** — four times the allowance from one `Promise.all`. Restored,
   * the same test lands 5 and refuses 15. The transaction double is unchanged
   * between the two runs, which is the point: serializing the transaction body
   * cannot save a count that was taken before the transaction opened.
   */
  it('lands exactly the allowance and refuses the rest', async () => {
    const attempts = 20
    const responses = await Promise.all(
      Array.from({ length: attempts }, () => createScreen()),
    )
    const created = responses.filter((response) => response.status === 200)
    const refused = responses.filter((response) => response.status === 403)

    // BOTH HALVES. "None got through" would satisfy a route that refuses
    // everything, and "some were refused" would satisfy one that let six
    // through — so the count is pinned on the nose, from both directions.
    expect(created).toHaveLength(FREE_SCREENS)
    expect(refused).toHaveLength(attempts - FREE_SCREENS)
    expect(created.length + refused.length).toBe(attempts)

    // And the STORE agrees, which is the claim that actually matters: the
    // statuses could be right while the writes landed anyway.
    expect(mockState.screens.size).toBe(FREE_SCREENS)

    // Every request really ran a transaction — a route that skipped the
    // transaction entirely would still produce the numbers above if the fake
    // happened to serialize some other way.
    expect(mockState.attempts).toBe(attempts)
  })

  it('POSITIVE CONTROL: a plan with room lands every one of them', async () => {
    // Without this, "exactly five" is also what a route capped at a hard-coded
    // five would produce, and a route that refused the 6th of ANY plan would
    // pass the case above. Business screens are UNLIMITED.
    expect(PLAN_ENTITLEMENTS.business.screensPerHost).toBe(Infinity)
    mockState.org = { plan: 'business', subscription: { status: 'active' } }
    const attempts = 20
    const responses = await Promise.all(
      Array.from({ length: attempts }, () => createScreen()),
    )
    expect(responses.filter((r) => r.status === 200)).toHaveLength(attempts)
    expect(mockState.screens.size).toBe(attempts)
  })

  it('a free org already AT the cap refuses all twenty and writes none', async () => {
    seedScreens(FREE_SCREENS)
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => createScreen()),
    )
    expect(responses.every((response) => response.status === 403)).toBe(true)
    expect(mockState.screens.size).toBe(FREE_SCREENS)
  })
})

describe('the double is honest about Firestore', () => {
  it('refuses a read after a write inside one transaction', async () => {
    // The route depends on assembling its document BEFORE the transaction so
    // the body is reads-then-one-write. If a later edit reintroduces a read
    // after `tx.create`, this is the semantic that catches it — so the double
    // has to actually carry it, and this proves it does rather than asserting
    // it in a comment.
    await expect(
      mockRunTransaction(async (tx) => {
        tx.create({ create: () => undefined }, {})
        await tx.get({ get: async () => ({ docs: [] }) })
      }),
    ).rejects.toThrow('cannot read after a write')
  })

  it('discards a buffered write when the body refuses afterwards', async () => {
    const written: Array<unknown> = []
    const result = await mockRunTransaction(async (tx) => {
      tx.create({ create: (payload: unknown) => written.push(payload) }, { a: 1 })
      return null
    })
    expect(result).toBeNull()
    expect(written).toHaveLength(1) // committed, because the body resolved…
    await mockRunTransaction(async (tx) => {
      tx.create({ create: (payload: unknown) => written.push(payload) }, { a: 2 })
      throw new Error('nope')
    }).catch(() => undefined)
    expect(written).toHaveLength(1) // …and NOT committed, because it threw.
  })
})
