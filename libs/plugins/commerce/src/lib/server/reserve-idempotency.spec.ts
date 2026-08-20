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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import {
  resolveTransactionFeeCents,
  storefrontProcessingCostCents,
} from '@aglyn/aglyn'
import { reserveHandler } from './reserve'

/**
 * Reservation idempotency (AGL-1697, item 4).
 *
 * This handler was protected against a SEQUENTIAL retry by accident: the
 * retry's own 30-minute pending hold made `isRangeAvailable` answer false, so
 * the guest was told "Those dates just sold out" about dates THEY were holding
 * — a misleading refusal where a replay of the original session URL was the
 * correct answer. The claim turns that retry into the replay.
 *
 * `global.fetch` is replaced for the whole file — nothing here may reach
 * api.stripe.com, localhost carries the LIVE secret key. Firestore is an
 * in-memory map so the tests COUNT the reservation holds that actually landed.
 *
 * CONCURRENCY IS COVERED HERE NOW (AGL-2450, and AGL-1848 which reported the
 * same defect independently). This header used to end by disclaiming it — "two
 * CONCURRENT submits with two different keys still both pass the
 * out-of-transaction availability read", filed as a follow-up — and that
 * sentence outlived the fix it described. Anyone reading down to it would have
 * believed an open hole in a file that closes it, which is how a fixed defect
 * gets rebuilt. The `two guests cannot hold the same dates` block below is the
 * coverage; the availability re-read now happens inside the writing
 * transaction in `reserve.ts`.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/**
 * A version per COLLECTION, which is what a query read has to be validated
 * against (AGL-2450).
 *
 * Firestore serialises a transaction that read a query by failing it when any
 * document the query covers has changed. Modelling only per-document versions
 * would miss the case this file exists to test — the conflicting write is a
 * NEW reservation, a document the first transaction never read — so a
 * doc-level check would see nothing stale and let both bookings commit, which
 * is precisely the defect reported as fixed.
 */
const collectionVersions = new Map<string, number>()

function bumpCollection(docPath: string): void {
  const collection = docPath.slice(0, docPath.lastIndexOf('/'))
  collectionVersions.set(collection, (collectionVersions.get(collection) ?? 0) + 1)
}

function writeDoc(path: string, value: Record<string, any>, merge: boolean): void {
  docs.set(path, merge ? { ...(docs.get(path) ?? {}), ...value } : value)
  bumpCollection(path)
}

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      writeDoc(path, value, Boolean(options?.merge))
    },
    /** `create()` rejecting on an existing doc IS the dedupe primitive. */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        const error: any = new Error(
          `ALREADY_EXISTS: entity already exists: ${path}`,
        )
        error.code = 6
        throw error
      }
      writeDoc(path, value, false)
    },
    delete: async () => {
      docs.delete(path)
      bumpCollection(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

interface Filter {
  field: string
  op: string
  value: any
}

/**
 * THE QUERY IS MODELLED, NOT WAVED THROUGH (AGL-2159).
 *
 * The availability read is an equality, an INEQUALITY on a second field, an
 * `orderBy` on that field and a `limit`, and every one of the four is
 * load-bearing: the inequality is what removes the past, the ordering is what
 * decides which stays survive the limit, and the limit is the cap the old
 * unordered query let arbitrary history fill. A fake that ignored the operator,
 * or applied `limit` before ordering, would report the crowd-out as fixed
 * whatever the handler did — and would equally report a correct handler as
 * broken. Unsupported operators throw rather than matching everything.
 */
function applyFilter(data: any, filter: Filter): boolean {
  const actual = data?.[filter.field]
  switch (filter.op) {
    case '==':
      return actual === filter.value
    case '>':
      return Number(actual) > Number(filter.value)
    case '>=':
      return Number(actual) >= Number(filter.value)
    case '<':
      return Number(actual) < Number(filter.value)
    case '<=':
      return Number(actual) <= Number(filter.value)
    default:
      throw new Error(`Unmodelled operator: ${filter.op}`)
  }
}

function makeQuery(
  path: string,
  filters: Filter[],
  order: string | null,
  limit: number | null,
): any {
  return {
    /** Read by the transaction double, to version-check the query. */
    collectionPath: path,
    where: (field: string, op: string, value: any) =>
      makeQuery(path, [...filters, { field, op, value }], order, limit),
    orderBy: (field: string) => makeQuery(path, filters, field, limit),
    limit: (count: number) => makeQuery(path, filters, order, count),
    get: async () => {
      let keys = childPaths(path).filter((key) =>
        filters.every((filter) => applyFilter(docs.get(key), filter)),
      )
      if (order) {
        // Firestore also DROPS documents missing the ordered field.
        keys = keys
          .filter((key) => (docs.get(key) as any)?.[order] !== undefined)
          .sort(
            (a, b) =>
              Number((docs.get(a) as any)[order]) -
              Number((docs.get(b) as any)[order]),
          )
      }
      // …and the limit applies AFTER the ordering, which is the whole point.
      if (limit != null) keys = keys.slice(0, limit)
      return { docs: keys.map(makeSnapshot) }
    },
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    where: (field: string, op: string, value: any) =>
      makeQuery(path, [{ field, op, value }], null, null),
    orderBy: (field: string) => makeQuery(path, [], field, null),
    limit: (count: number) => makeQuery(path, [], null, count),
  }
}

/** Parked between a transaction's read and its commit, to force interleaving. */
let afterRead: (() => Promise<void>) | null = null
let abortedRetries = 0

/**
 * Optimistic concurrency over QUERY reads (AGL-2450).
 *
 * A double that merely buffered the writes and committed them would report
 * green with the defect in place: both bookings would read an availability set
 * lacking the other, both would pass `isRangeAvailable`, and both would write.
 * So the read set is recorded — the version of every collection a query
 * touched — and the callback re-runs when any of them moved.
 */
async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const readVersions = new Map<string, number>()
    const writes: { path: string; value: Record<string, any>; merge: boolean }[] =
      []
    const transaction = {
      get: async (target: any) => {
        if (target?.collectionPath) {
          readVersions.set(
            target.collectionPath,
            collectionVersions.get(target.collectionPath) ?? 0,
          )
          return target.get()
        }
        return makeSnapshot(target.path)
      },
      set: (ref: any, value: Record<string, any>, options?: any) => {
        writes.push({ path: ref.path, value, merge: Boolean(options?.merge) })
      },
      update: (ref: any, value: Record<string, any>) => {
        writes.push({ path: ref.path, value, merge: true })
      },
      create: (ref: any, value: Record<string, any>) => {
        writes.push({ path: ref.path, value, merge: false })
      },
    }
    const result = await body(transaction)
    if (afterRead && attempt === 0) {
      const hook = afterRead
      afterRead = null
      await hook()
    }
    const stale = [...readVersions.entries()].some(
      ([collection, version]) =>
        (collectionVersions.get(collection) ?? 0) !== version,
    )
    if (stale) {
      abortedRetries++
      continue
    }
    for (const write of writes) writeDoc(write.path, write.value, write.merge)
    return result
  }
  const error: any = new Error('ABORTED: too much contention')
  error.code = 10
  throw error
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'business',
    // `billingStatus`, not `subscriptionStatus` — see the note in
    // draft-order-idempotency.spec.ts. Only this key downgrades a paid plan.
    billingStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
  },
  getOrgForHost: async () => mockOrg,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — counted, never reached
// ---------------------------------------------------------------------------

interface StripeCall {
  url: string
  idempotencyKey: string | null
  /** The POST body, so the AGL-1969/AGL-2000 tax decision can be asserted. */
  params: URLSearchParams
}

const stripeCalls: StripeCall[] = []
const stripeSessionsByKey = new Map<string, { url: string }>()
let stripeSessionCounter = 0

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.includes('api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  const idempotencyKey =
    (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
  stripeCalls.push({
    url: target,
    idempotencyKey,
    params: new URLSearchParams(String(init?.body ?? '')),
  })
  if (idempotencyKey && stripeSessionsByKey.has(idempotencyKey)) {
    return {
      ok: true,
      json: async () => stripeSessionsByKey.get(idempotencyKey),
    }
  }
  const session = {
    url: `https://checkout.stripe.com/pay/session-${++stripeSessionCounter}`,
  }
  if (idempotencyKey) stripeSessionsByKey.set(idempotencyKey, session)
  return { ok: true, json: async () => session }
})

// ---------------------------------------------------------------------------
// Request / response plumbing
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000
const CHECK_IN = DAY_MS * 20_700
const CHECK_OUT = CHECK_IN + 2 * DAY_MS

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  } as PluginApiResponse
  return { res, result }
}

async function post(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const { res, result } = makeResponse()
  const request = {
    method: 'POST',
    query: {},
    body: {
      hostId: 'host-1',
      resourceId: 'room-1',
      checkInDayMs: CHECK_IN,
      checkOutDayMs: CHECK_OUT,
      guestName: 'Ada Lovelace',
      guestEmail: 'ada@example.com',
      ...body,
    },
    headers: { host: 'acme.aglyn.app', ...headers },
    cookies: {},
    socket: {},
  } as PluginApiRequest
  await reserveHandler(request, res)
  return result
}

function holdDocs() {
  return childPaths('hosts/host-1/reservations').map((path) => docs.get(path))
}

function claimDocs() {
  return childPaths('apiIdempotency')
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  collectionVersions.clear()
  afterRead = null
  abortedRetries = 0
  stripeCalls.length = 0
  stripeSessionsByKey.clear()
  autoIdCounter = 0
  stripeSessionCounter = 0
  fetchMock.mockClear()

  docs.set('hosts/host-1/resources/room-1', {
    name: 'Garden cabin',
    nightlyRateUsd: 150,
  })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
})

// ---------------------------------------------------------------------------

/**
 * Two guests, one room (AGL-2450).
 *
 * The sequential refusal below ("still refuses a fresh attempt for dates a live
 * hold occupies") passed the whole time the defect was live, and that is the
 * point of this block: it only ever proved the SECOND request sees the FIRST
 * one's COMMITTED hold. It says nothing about two requests whose availability
 * reads both happen before either write — the ordering a real pair of guests
 * produces, and the one that put two confirmed stays in one room.
 *
 * The two requests are driven CONCURRENTLY rather than through an explicit
 * interleaving hook. That is deliberate: a hook has to be planted at a point
 * only the fixed code has, so removing the fix would make these tests fail with
 * "the hook never fired" rather than by double-booking. Run concurrently, the
 * pre-fix handler interleaves at its own `await`s and writes two holds on the
 * same nights — the defect itself, which is what a red here should look like.
 */
describe('two guests cannot hold the same dates (AGL-2450)', () => {
  it('refuses the loser instead of writing a second hold on the same nights', async () => {
    const [first, rival] = await Promise.all([
      post({}, { 'idempotency-key': 'attempt-a' }),
      post({}, { 'idempotency-key': 'attempt-b' }),
    ])

    // Which one loses is deliberately not pinned: the loser is whichever
    // transaction commits second. Exactly one booking, and the other is told
    // the truth rather than charged for a room it cannot have.
    expect([first.status, rival.status].sort()).toEqual([200, 409])
    expect(
      [first, rival].find((result) => result.status === 409).body.error,
    ).toBe('Those dates just sold out')
    // The contention was real: the losing transaction saw its query go stale
    // and re-ran. Without this the assertions above would also hold if the two
    // requests had simply run end to end.
    expect(abortedRetries).toBeGreaterThan(0)

    // ONE hold on the room, and only the winner was ever sent to Stripe.
    expect(holdDocs()).toHaveLength(1)
    expect(stripeCalls).toHaveLength(1)
  })

  /**
   * The guard forced red from the other side: two guests wanting nights a month
   * apart both contend on the collection version, so the loser RETRIES — and
   * then finds its own dates free and commits. A retry is not a refusal, and a
   * transaction that refused everything it retried would fail here.
   */
  it('books both guests when their dates do not overlap', async () => {
    const [first, other] = await Promise.all([
      post({}, { 'idempotency-key': 'attempt-a' }),
      post(
        {
          checkInDayMs: CHECK_IN + 30 * DAY_MS,
          checkOutDayMs: CHECK_OUT + 30 * DAY_MS,
        },
        { 'idempotency-key': 'attempt-b' },
      ),
    ])

    expect(first.status).toBe(200)
    expect(other.status).toBe(200)
    expect(holdDocs()).toHaveLength(2)
    expect(stripeCalls).toHaveLength(2)
  })
})

describe('reservation idempotency (AGL-1697)', () => {
  it('creates one pending hold with a session and records the claim', async () => {
    const result = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(result.status).toBe(200)
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(holdDocs()).toHaveLength(1)
    expect((holdDocs()[0] as any).status).toBe('pending')
    expect(stripeCalls).toHaveLength(1)
    expect(claimDocs()).toHaveLength(1)
    expect(docs.get(claimDocs()[0])?.['status']).toBe('done')
  })

  /**
   * THE DEFECT. Before the claim, a retried keyed attempt hit its OWN pending
   * hold in the availability read and was told "Those dates just sold out" —
   * a misleading 409 about dates the guest was holding, where the correct
   * answer was the original session URL, replayed.
   */
  it('replays a retried reservation instead of claiming the dates sold out', async () => {
    const first = await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.url).toBe(first.body.url)
    expect(second.body.error).toBeUndefined()
    // One hold, one Stripe session — nothing was doubled.
    expect(holdDocs()).toHaveLength(1)
    expect(stripeCalls).toHaveLength(1)
  })

  /**
   * A DIFFERENT guest wanting the same dates is a real second attempt, and
   * the live pending hold refusing them is the correct business answer — the
   * accidental protection, kept deliberate.
   */
  it('still refuses a fresh attempt for dates a live hold occupies', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    const rival = await post({}, { 'idempotency-key': 'attempt-b' })
    expect(rival.status).toBe(409)
    expect(rival.body.error).toBe('Those dates just sold out')
    expect(holdDocs()).toHaveLength(1)
    expect(stripeCalls).toHaveLength(1)
  })

  it('books disjoint dates under a fresh key as a real second reservation', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    const later = await post(
      {
        checkInDayMs: CHECK_IN + 10 * DAY_MS,
        checkOutDayMs: CHECK_OUT + 10 * DAY_MS,
      },
      { 'idempotency-key': 'attempt-b' },
    )
    expect(later.status).toBe(200)
    expect(holdDocs()).toHaveLength(2)
    expect(stripeCalls).toHaveLength(2)
  })

  /**
   * A GENUINE sold-out refusal is deterministic: the guest picks other dates
   * (a new attempt), or the blocking stay is cancelled and the same button is
   * pressed again. Either way the key must not be burned by the 409.
   */
  it('releases the key on a genuine sold-out refusal', async () => {
    docs.set('hosts/host-1/reservations/blocker', {
      resourceId: 'room-1',
      status: 'confirmed',
      checkInDayMs: CHECK_IN,
      checkOutDayMs: CHECK_OUT,
      createdAtMs: Date.now(),
    })
    const refused = await post({}, { 'idempotency-key': 'attempt-c' })
    expect(refused.status).toBe(409)
    expect(claimDocs()).toHaveLength(0)
    expect(stripeCalls).toHaveLength(0)

    docs.delete('hosts/host-1/reservations/blocker')
    const retry = await post({}, { 'idempotency-key': 'attempt-c' })
    expect(retry.status).toBe(200)
    expect(holdDocs()).toHaveLength(1)
  })

  /**
   * Stripe's own idempotency is the backstop for the window where the claim
   * landed but the response was lost — the session call carries a key derived
   * from the attempt, stable across a re-run.
   */
  it('hands Stripe an idempotency key derived from the attempt', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    expect(stripeCalls[0].idempotencyKey).toBeTruthy()

    docs.delete(claimDocs()[0] ?? 'apiIdempotency/none')
    // The stale hold from run one still blocks the dates, so clear it — this
    // simulates the claim being lost, not the hold.
    for (const path of childPaths('hosts/host-1/reservations')) {
      docs.delete(path)
    }
    await post({}, { 'idempotency-key': 'attempt-a' })
    expect(stripeCalls).toHaveLength(2)
    expect(stripeCalls[1].idempotencyKey).toBe(stripeCalls[0].idempotencyKey)
    expect(stripeSessionsByKey.size).toBe(1)
  })

  /**
   * A failed Stripe call already rolled the hold back; it must release the
   * claim too, or one flaky moment locks these dates for this guest forever.
   */
  it('releases the claim when the session fails', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'nope' } }),
    }))
    const failed = await post({}, { 'idempotency-key': 'attempt-d' })
    expect(failed.status).toBe(502)
    expect(holdDocs()).toHaveLength(0)
    expect(claimDocs()).toHaveLength(0)

    const retry = await post({}, { 'idempotency-key': 'attempt-d' })
    expect(retry.status).toBe(200)
    expect(holdDocs()).toHaveLength(1)
  })

  /**
   * Backwards compatibility: a keyless client still reserves, and its retry
   * keeps getting the accidental-but-safe 409 from its own pending hold —
   * unchanged behaviour, no claim documents.
   */
  it('still reserves without a key, and its retry stays a 409', async () => {
    const first = await post()
    const second = await post()
    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(holdDocs()).toHaveLength(1)
    expect(stripeCalls).toHaveLength(1)
    expect(claimDocs()).toHaveLength(0)
    expect(stripeCalls[0].idempotencyKey).toBeNull()
  })
})

/**
 * AGL-1873: the commerce entitlement is re-asked per request, the AGL-481
 * pattern — a lapsed org's storefront stops taking reservation deposits at
 * the next attempt. The refusal is hoisted with the other deterministic
 * merchant-side refusals ABOVE the claim (AGL-1697), so it never burns the
 * guest's attempt key.
 */
describe('the commerce entitlement gates the reservation door (AGL-1873)', () => {
  afterEach(() => {
    mockOrg.org.plan = 'business'
    mockOrg.org.billingStatus = 'active'
  })

  it('a free-plan org is refused before Stripe and before any hold', async () => {
    mockOrg.org.plan = 'free'
    const result = await post({}, { 'idempotency-key': 'attempt-entitlement' })
    expect(result.status).toBe(403)
    expect(stripeCalls).toHaveLength(0)
    expect(holdDocs()).toHaveLength(0)
  })

  it('a dead subscription on a paid plan is refused too — the sticky-downgrade half', async () => {
    mockOrg.org.billingStatus = 'canceled'
    const result = await post({}, { 'idempotency-key': 'attempt-entitlement-2' })
    expect(result.status).toBe(403)
    expect(stripeCalls).toHaveLength(0)
    expect(holdDocs()).toHaveLength(0)
  })

  it('the refusal does not burn the guest attempt key', async () => {
    mockOrg.org.plan = 'free'
    const refused = await post({}, { 'idempotency-key': 'attempt-back' })
    expect(refused.status).toBe(403)
    expect(claimDocs()).toHaveLength(0)
    mockOrg.org.plan = 'business'
    const retry = await post({}, { 'idempotency-key': 'attempt-back' })
    expect(retry.status).toBe(200)
    expect(holdDocs()).toHaveLength(1)
  })
})

/**
 * LODGING TAX IS THE MERCHANT'S OWN SETTING, AND IT IS OFF UNTIL THEY SET IT
 * (AGL-1969, replacing AGL-2000 part 3's flat no-tax pin).
 *
 * AGL-2000 pinned "this path charges no tax" as a stated decision. That
 * decision was always a holding position for one reason: the merchant had no
 * way to answer the question at all. The AGL-285 editor configures a goods
 * SALES rate, and reading it for a room would apply the wrong regime's number
 * — so the honest interim answer was zero.
 *
 * The merchant now has a field of their own (`tax.lodging`), and the shape of
 * the guarantee changes accordingly:
 *
 *  - **Unset — the default, and every existing store — still charges nothing.**
 *    The first describe below is the AGL-2000 guard, kept and WIDENED to a
 *    property over the whole emitted body rather than four named keys.
 *  - **Set, and the guest pays it**, as an ordinary line item the way every
 *    other manual rate rides (AGL-1711), so the derived `taxMode` reads
 *    `manual` and the figure is never computed against Aglyn's registrations.
 *
 * Aglyn still takes no position on what is owed. These tests assert the
 * MECHANISM — that the merchant's number is the one charged and recorded —
 * and nothing about who must remit it.
 */
describe('a reservation with no lodging rate set charges no tax (AGL-1969)', () => {
  it('sends no tax parameter of any kind', async () => {
    const result = await post()
    expect(result.status).toBe(200)
    const session = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    expect(session).toBeDefined()
    // Stripe Tax would compute a GOODS rate on a room — no lodging tax code
    // is sent, and none could be from here.
    expect(session?.params.get('automatic_tax[enabled]')).toBeNull()
    // Nor the merchant's configured sales rate, by either construction.
    expect(session?.params.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(session?.params.get('line_items[1][price_data][unit_amount]')).toBeNull()
    // And no metadata witness claiming a tax that was never charged.
    expect(session?.params.get('metadata[taxCents]')).toBeNull()

    // THE GUARD ITSELF, widened — the AGL-2028 shape applied here.
    //
    // The four assertions above are an allowlist of four exact keys, and a
    // change that adds tax by any other spelling walks straight past them:
    // `automatic_tax[liability][type]`, `tax_id_collection[enabled]` and
    // `line_items[0][price_data][tax_behavior]` are all real Stripe
    // parameters this body would have carried silently. Stated as a property
    // over the whole emitted body, because the next spelling is by definition
    // the one nobody listed.
    expect([...(session?.params.keys() ?? [])].filter((key) => /tax/i.test(key)))
      .toEqual([])
  })

  it('is unmoved by the GOODS sales rate the merchant configured', async () => {
    // The reason a lodging field had to exist. A store with a full manual
    // sales-tax setup — mode, origin, a matching 8.25% zone rate — still
    // charges nothing on a stay, because none of that describes lodging.
    // Without this, "charges no tax" could hold merely because the fixture
    // store had no tax settings at all.
    docs.set('hosts/host-1/settings/store', {
      tax: {
        mode: 'manual',
        origin: { country: 'US', state: 'TX' },
        rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
      },
    })
    const result = await post()
    expect(result.status).toBe(200)
    const session = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    expect([...(session?.params.keys() ?? [])].filter((key) => /tax/i.test(key)))
      .toEqual([])
    // 2 nights x $150, no deposit configured, and nothing on top.
    expect(session?.params.get('line_items[0][price_data][unit_amount]')).toBe(
      '30000',
    )
  })

  // Positive control: the charge itself must still be made, or the assertions
  // above would hold for a reservation that never took any money.
  it('still charges for the stay', async () => {
    await post()
    const session = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    expect(
      Number(session?.params.get('line_items[0][price_data][unit_amount]')),
    ).toBeGreaterThan(0)
    expect(session?.params.get('metadata[type]')).toBe('commerce-reservation')
  })
})

describe('a merchant-set lodging rate is charged and recorded (AGL-1969)', () => {
  /** 6% occupancy tax, the merchant's own number, in their own words. */
  const withLodging = (rate: Record<string, unknown>) => {
    docs.set('hosts/host-1/settings/store', { tax: { lodging: rate } })
  }

  it('adds the merchant’s rate as its own line on the session', async () => {
    withLodging({ pct: 6, label: 'City occupancy tax' })
    const result = await post()
    expect(result.status).toBe(200)
    const session = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    // 2 nights x $150 = $300 charged, 6% = $18 on top.
    expect(session?.params.get('line_items[0][price_data][unit_amount]')).toBe(
      '30000',
    )
    expect(session?.params.get('line_items[1][price_data][unit_amount]')).toBe(
      '1800',
    )
    // The merchant's OWN label reaches the guest's receipt — not a generic
    // one this code chose for them.
    expect(
      session?.params.get('line_items[1][price_data][product_data][name]'),
    ).toBe('City occupancy tax')
  })

  it('never asks Stripe Tax to compute it', async () => {
    // The line item construction is the whole point (AGL-1711/AGL-1904): a
    // manual line means the tax is the MERCHANT's, derived as `taxMode:
    // 'manual'`. `automatic_tax` would compute against AGLYN's registrations,
    // at a goods rate, on a room.
    withLodging({ pct: 6 })
    await post()
    const session = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    expect(session?.params.get('automatic_tax[enabled]')).toBeNull()
    expect(session?.params.get('line_items[0][tax_rates][0]')).toBeNull()
  })

  it('stamps the figure the webhook needs to record it', async () => {
    // Stripe is never told the second line is tax, so the session's own
    // metadata is the only witness — the same reason `checkout.ts` stamps it.
    withLodging({ pct: 6, label: 'City occupancy tax' })
    await post()
    const session = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    expect(session?.params.get('metadata[taxCents]')).toBe('1800')
    expect(session?.params.get('metadata[taxPct]')).toBe('6')
  })

  it('falls back to a plain label, never to a blank receipt line', async () => {
    withLodging({ pct: 6 })
    await post()
    const session = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    expect(
      session?.params.get('line_items[1][price_data][product_data][name]'),
    ).toBe('Lodging tax')
  })

  it('taxes the DEPOSIT when one is charged — the stated limitation', async () => {
    // THE RESIDUAL AGL-1969 DOES NOT DECIDE, asserted so it cannot be
    // mistaken for an oversight.
    //
    // `reserve.ts` charges `depositCents || totalCents`. The rate is applied
    // to WHAT IS CHARGED — the only amount the platform actually moves — so
    // on a deposit-taking resource the tax collected here is the rate on the
    // deposit, not on the stay. Whether a jurisdiction wants occupancy tax on
    // the full stay at booking, on the deposit only, or on redemption at
    // check-out is a tax question this code deliberately does NOT answer; the
    // merchant is told so in the settings card and collects any balance the
    // way they already collect the balance of the stay.
    //
    // Pinned as an equality rather than left implicit: a later change that
    // quietly switched the basis to `totalCents` would be TAKING that
    // decision, and it should have to come here and say so.
    docs.set('hosts/host-1/resources/room-1', {
      name: 'Garden cabin',
      nightlyRateUsd: 150,
      depositPct: 25,
    })
    withLodging({ pct: 6 })
    const result = await post()
    expect(result.status).toBe(200)
    const session = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    const charged = Number(
      session?.params.get('line_items[0][price_data][unit_amount]'),
    )
    // A deposit really was taken — without this the assertion below would
    // hold for a resource whose deposit configuration did nothing.
    expect(charged).toBe(7500)
    expect(charged).toBeLessThan(30000)
    // 6% of the DEPOSIT ($75), not of the stay ($300, which would be 1800).
    expect(session?.params.get('line_items[1][price_data][unit_amount]')).toBe(
      '450',
    )
  })

  it('OFF stays off for a rate that is not a rate', async () => {
    // Zero, negative, non-numeric and a decimal-point typo (`825` for `8.25`)
    // all resolve to no tax rather than to some number the merchant did not
    // choose. Driven through the handler, not through the resolver, so this
    // proves the HANDLER never emits a line for them.
    for (const pct of [0, -6, Number.NaN, 825] as unknown[]) {
      stripeCalls.length = 0
      docs.delete('hosts/host-1/reservations/auto-1')
      docs.clear()
      collectionVersions.clear()
      docs.set('hosts/host-1/resources/room-1', {
        name: 'Garden cabin',
        nightlyRateUsd: 150,
      })
      docs.set('profiles/owner-1', {
        stripeAccountId: 'acct_live_merchant',
        stripeChargesEnabled: true,
      })
      withLodging({ pct } as Record<string, unknown>)
      const result = await post()
      expect(result.status).toBe(200)
      const session = stripeCalls.find((call) =>
        call.url.includes('/checkout/sessions'),
      )
      expect(
        [...(session?.params.keys() ?? [])].filter((key) => /tax/i.test(key)),
      ).toEqual([])
    }
  })

  it('keeps the platform take off the tax, and passes the card cost on all of it', async () => {
    // AGL-2317's rule, restated for a path that now carries tax: the take is
    // computed on the ITEMS, never on the state's money, while Stripe's card
    // cost is debited from the platform balance on the WHOLE charge and so
    // must be passed through on the whole charge (AGL-2152).
    withLodging({ pct: 6 })
    await post()
    const withTax = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    const feeWithTax = Number(
      withTax?.params.get('payment_intent_data[application_fee_amount]'),
    )

    docs.clear()
    collectionVersions.clear()
    stripeCalls.length = 0
    docs.set('hosts/host-1/resources/room-1', {
      name: 'Garden cabin',
      nightlyRateUsd: 150,
    })
    docs.set('profiles/owner-1', {
      stripeAccountId: 'acct_live_merchant',
      stripeChargesEnabled: true,
    })
    await post()
    const withoutTax = stripeCalls.find((call) =>
      call.url.includes('/checkout/sessions'),
    )
    const feeWithoutTax = Number(
      withoutTax?.params.get('payment_intent_data[application_fee_amount]'),
    )

    // The difference is EXACTLY Stripe's own cost on the extra $18 and
    // nothing more — no platform take on the state's money. Derived from the
    // real pricing function rather than a copied constant, so a rate change
    // moves the expectation with it.
    expect(feeWithTax - feeWithoutTax).toBe(
      storefrontProcessingCostCents(31800) - storefrontProcessingCostCents(30000),
    )
    // NEGATIVE CONTROL. The business plan takes 2% on a service, so a fee
    // computed on the TAX-INCLUSIVE base is a different, larger number. If
    // these two were equal the assertion above would be proving nothing.
    const takeOnTaxToo = resolveTransactionFeeCents(
      mockOrg.org,
      'service',
      31800,
      31800,
    )
    expect(feeWithTax).toBe(
      resolveTransactionFeeCents(mockOrg.org, 'service', 30000, 31800),
    )
    expect(feeWithTax).toBeLessThan(takeOnTaxToo)
  })
})

/**
 * THE 500-DOCUMENT CAP, AND WHAT USED TO FILL IT (AGL-2159).
 *
 * The availability read was `.where('resourceId','==',resourceId).limit(500)`
 * with no ordering, so Firestore answered with 500 documents in `__name__`
 * order — an arbitrary slice of the resource's ENTIRE booking history. Stays
 * from three summers ago, which cannot overlap anything a guest is asking for
 * today, competed for those slots on equal terms with the live reservation
 * that does. A cottage past 500 lifetime bookings therefore began dropping
 * real holds out of its own availability check and confirming a second guest
 * into an occupied room — and the failure is invisible from inside:
 * `isRangeAvailable` is handed a short list and answers, correctly, that the
 * range is free.
 *
 * These drive the whole handler, so what is measured is whether the SECOND
 * guest is refused — not whether a query builder was called with particular
 * arguments.
 */
describe('an availability check that must not be crowded out (AGL-2159)', () => {
  /** Stays that ended long before the requested arrival, so cannot overlap. */
  function seedPastStays(count: number): void {
    for (let index = 1; index <= count; index += 1) {
      // Ids chosen to sort BEFORE the live hold under `__name__`, which is the
      // order the old unordered query actually returned.
      docs.set(`hosts/host-1/reservations/aaa-past-${index}`, {
        resourceId: 'room-1',
        status: 'checked_out',
        checkInDayMs: CHECK_IN - DAY_MS * (900 + index),
        checkOutDayMs: CHECK_IN - DAY_MS * (899 + index),
        createdAtMs: 1,
      })
    }
  }

  function seedLiveHold(): void {
    docs.set('hosts/host-1/reservations/zzz-live', {
      resourceId: 'room-1',
      status: 'confirmed',
      checkInDayMs: CHECK_IN,
      checkOutDayMs: CHECK_OUT,
      createdAtMs: 1,
    })
  }

  /**
   * THE DEFECT. 600 finished stays plus the one confirmed booking that covers
   * the requested dates: the old query returned the first 500 by id, the live
   * hold was not among them, and the second guest was taken.
   */
  it('refuses dates a live booking covers even behind 600 finished stays', async () => {
    seedPastStays(600)
    seedLiveHold()

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(409)
    expect(result.body).toEqual({ error: 'Those dates just sold out' })
    // No second hold, and no charge attempted for a room already taken.
    expect(holdDocs().filter((hold: any) => hold.status === 'pending')).toEqual(
      [],
    )
    expect(
      stripeCalls.filter((call) => call.url.includes('/checkout/sessions')),
    ).toHaveLength(0)
  })

  /**
   * THE POSITIVE CONTROL, and the one that stops "refuse everything" passing
   * the test above: the same 600 finished stays with NO live hold must still
   * let the booking through.
   */
  it('still books when the finished stays are all that is there', async () => {
    seedPastStays(600)

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
    expect(holdDocs().filter((hold: any) => hold.status === 'pending')).toHaveLength(
      1,
    )
  })

  /**
   * And the expiry rule still holds under the narrowed query: an abandoned
   * `pending` hold older than 30 minutes releases its dates. The filter runs in
   * memory, so this proves the narrowing did not quietly promote expired holds
   * into blockers by ordering them ahead of the cut.
   */
  it('still releases an expired pending hold', async () => {
    docs.set('hosts/host-1/reservations/stale', {
      resourceId: 'room-1',
      status: 'pending',
      checkInDayMs: CHECK_IN,
      checkOutDayMs: CHECK_OUT,
      createdAtMs: Date.now() - 31 * 60 * 1000,
    })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
  })

  /** A stay that ENDS on the requested arrival day is not an overlap. */
  it('books dates that begin the day a previous stay ends', async () => {
    docs.set('hosts/host-1/reservations/back-to-back', {
      resourceId: 'room-1',
      status: 'confirmed',
      checkInDayMs: CHECK_IN - 3 * DAY_MS,
      checkOutDayMs: CHECK_IN,
      createdAtMs: 1,
    })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
  })

  /** …and another resource's bookings never block this one. */
  it('ignores a booking on a different resource', async () => {
    docs.set('hosts/host-1/reservations/other-room', {
      resourceId: 'room-2',
      status: 'confirmed',
      checkInDayMs: CHECK_IN,
      checkOutDayMs: CHECK_OUT,
      createdAtMs: 1,
    })

    const result = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(result.status).toBe(200)
  })
})
