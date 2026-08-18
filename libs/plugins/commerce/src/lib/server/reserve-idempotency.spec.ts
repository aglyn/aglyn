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
 * NOT covered here, deliberately: two CONCURRENT submits with two different
 * keys still both pass the out-of-transaction availability read and create two
 * holds — that is the transactional-guard follow-up the issue notes, a
 * different defect from the unkeyed retry.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

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
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
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
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    /** The handler's equality query over reservations, faithfully filtered. */
    where: (field: string, _op: string, value: any) => ({
      limit: (_count: number) => ({
        get: async () => ({
          docs: childPaths(path)
            .filter((key) => (docs.get(key) as any)?.[field] === value)
            .map(makeSnapshot),
        }),
      }),
    }),
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
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
 * The reservation's no-tax decision, PINNED (AGL-2000, part 3).
 *
 * `reserve.ts` carries two stated reasons for charging no tax — a stay is not
 * goods, and the AGL-285 editor configures a goods SALES rate while lodging is
 * an occupancy-tax regime with its own rates, registration and return; and the
 * charge is usually a DEPOSIT, so taxing it would apply a whole stay's tax to a
 * fraction of it. That reasoning was written down and nothing asserted it, so a
 * future change adding `automatic_tax` here would have broken nothing. It does
 * now.
 *
 * This pins the DECISION, not the outcome: proper lodging-tax support (AGL-1969)
 * is expected to change it, and whoever does that should have to come here and
 * say so.
 */
describe('a reservation charges no tax, deliberately (AGL-2000)', () => {
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
