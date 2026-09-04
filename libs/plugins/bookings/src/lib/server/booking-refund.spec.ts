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
 *
 * @jest-environment node
 */

/**
 * REFUNDING A PAID BOOKING REVERSES THE SELLER SHARE (AGL-2315).
 *
 * A paid booking is a destination charge now, and that changes what a refund
 * has to do. A refund on a destination charge that does not set
 * `reverse_transfer` is paid entirely out of the PLATFORM's balance while the
 * merchant keeps their transfer in full — the merchant cancels, the guest is
 * made whole, and Aglyn funds the whole concession out of a cut that was at
 * most 5% of it. That precise bug has shipped in this repo before, on a
 * marketplace partial refund, which is why the partial case below is asserted
 * separately from the full one rather than assumed to follow from it.
 *
 * The suite asserts the Stripe call's BODY, because that is where the money
 * decisions live and a route can return a perfectly good 200 while sending
 * none of them. `global.fetch` is replaced for the suite — localhost carries
 * the LIVE secret key — and every call is asserted by exact URL.
 */

const stripePosts: Array<{ params: URLSearchParams; headers: Record<string, string> }> = []
let stripeOk = true

jest.mock('@aglyn/aglyn/server', () => ({
  registerPluginApiRoute: () => undefined,
  registerPluginConfigSchema: () => undefined,
  registerPluginJob: () => undefined,
  registerBillingWebhookHandler: () => undefined,
}))

/*
 * The campaign revenue reversal, mocked. Whether it lands correctly on the
 * rollup is settled against a real double in
 * `email-revenue-attribution.spec.ts`; what this file is the only place to
 * prove is that a booking refund REACHES it. A paid booking is credited to a
 * campaign the same way a store order is — through `upsertHostContact` with
 * this booking's id — so without the reversal a booking site's campaign
 * revenue could only ever rise.
 */
const reverseAttributedRevenue = jest.fn(async () => true)
jest.mock(
  '@aglyn/tenant-data-admin/server/email-revenue-attribution',
  () => ({
    __esModule: true,
    reverseEmailAttributedRevenue: (...args: unknown[]) =>
      (reverseAttributedRevenue as any)(...args),
  }),
)

jest.mock('@aglyn/tenant-data-admin', () => {
  const booking: Record<string, unknown> = {}
  const claims = new Map<string, Record<string, unknown>>()
  const state = {
    booking,
    claims,
    /** `memberRoles` on the host doc — the admin gate's only input. */
    memberRoles: {} as Record<string, string>,
    hostExists: true,
    bookingExists: true,
    uid: 'admin-1',
    /** Set to run a competing refund inside the reserve transaction. */
    interleave: null as null | (() => void),
  }
  // A Firestore double that models the semantics the route depends on:
  // `set(..., {merge:true})` merges rather than replaces, `create()` throws on
  // an existing document, and a transaction's `get` sees writes made by
  // anything that ran before it. An unfaithful fake here would fabricate a
  // green on the cap — the one guard that exists solely for concurrency.
  const merge = (
    target: Record<string, unknown>,
    data: Record<string, unknown>,
  ) => {
    for (const [key, value] of Object.entries(data)) target[key] = value
  }
  const bookingRef = {
    id: 'booking-1',
    get: async () => ({
      exists: state.bookingExists,
      get: (field: string) => booking[field],
    }),
    set: async (data: Record<string, unknown>) => {
      merge(booking, data)
    },
  }
  const hostRef = {
    get: async () => ({
      exists: state.hostExists,
      get: (field: string) =>
        field === 'memberRoles' ? state.memberRoles : undefined,
    }),
    collection: () => ({ doc: () => bookingRef }),
  }
  const claimDoc = (id: string) => ({
    id,
    get: async () => ({
      get: (field: string) => claims.get(id)?.[field],
    }),
    create: async (data: Record<string, unknown>) => {
      if (claims.has(id)) throw new Error('ALREADY_EXISTS')
      claims.set(id, { ...data })
    },
    set: async (data: Record<string, unknown>) => {
      claims.set(id, { ...(claims.get(id) ?? {}), ...data })
    },
    delete: async () => {
      claims.delete(id)
    },
  })
  return {
    __state: state,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token === 'bad') throw new Error('invalid token')
            return { uid: state.uid }
          },
        }),
        firestore: () => ({
          collection: (name: string) =>
            name === 'apiIdempotency'
              ? { doc: (id: string) => claimDoc(id) }
              : { doc: () => hostRef },
          runTransaction: async (fn: any) => {
            // A competing writer lands BETWEEN the transaction's read and its
            // write when a test asks for one, which is the only way to test
            // that the cap is what stops an over-refund.
            const hook = state.interleave
            state.interleave = null
            return fn({
              get: async () => {
                const snapshot = {
                  exists: state.bookingExists,
                  get: (field: string) => booking[field],
                }
                if (hook) hook()
                return snapshot
              },
              set: (ref: any, data: Record<string, unknown>) => {
                merge(booking, data)
              },
            })
          },
        }),
      }),
    },
  }
})

import { bookingRefundHandler } from './refund'

const mockAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
  __state: {
    booking: Record<string, unknown>
    claims: Map<string, Record<string, unknown>>
    memberRoles: Record<string, string>
    hostExists: boolean
    bookingExists: boolean
    uid: string
    interleave: null | (() => void)
  }
}

const makeRes = () => {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const makeReq = (body: Record<string, unknown> = {}, key = 'attempt-1') =>
  ({
    method: 'POST',
    headers: {
      authorization: 'Bearer good',
      'idempotency-key': key,
    },
    body: { hostId: 'host-1', bookingId: 'booking-1', ...body },
    query: {},
    cookies: {},
  }) as any

const originalFetch = global.fetch
const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY

beforeAll(() => {
  global.fetch = jest.fn(async (url: any, init?: any) => {
    const address = String(url)
    if (address === 'https://api.stripe.com/v1/refunds') {
      stripePosts.push({
        params: new URLSearchParams(String(init?.body ?? '')),
        headers: (init?.headers ?? {}) as Record<string, string>,
      })
      return stripeOk
        ? { ok: true, json: async () => ({ id: 're_1', status: 'succeeded' }) }
        : {
            ok: false,
            json: async () => ({ error: { code: 'charge_disputed' } }),
          }
    }
    throw new Error(`Unexpected fetch to ${address}`)
  }) as unknown as typeof fetch
  process.env.STRIPE_SECRET_KEY = 'sk_test_booking_refund_spec'
})

afterAll(() => {
  global.fetch = originalFetch
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY
})

beforeEach(() => {
  stripePosts.length = 0
  stripeOk = true
  const state = mockAdmin.__state
  state.hostExists = true
  state.bookingExists = true
  state.uid = 'admin-1'
  state.memberRoles = { 'admin-1': 'admin', 'editor-1': 'editor' }
  state.claims.clear()
  state.interleave = null
  for (const key of Object.keys(state.booking)) delete state.booking[key]
  Object.assign(state.booking, {
    status: 'confirmed',
    paidAmountCents: 7500,
    feeCents: 375,
    paymentIntentId: 'pi_booking_1',
  })
})

describe('a booking refund reverses the seller share (AGL-2315)', () => {
  it('reverses the transfer and the platform fee on a FULL refund', async () => {
    const res = makeRes()
    await bookingRefundHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(stripePosts).toHaveLength(1)
    const params = stripePosts[0].params
    expect(params.get('payment_intent')).toBe('pi_booking_1')
    expect(params.get('amount')).toBe('7500')
    // WITHOUT THIS the merchant keeps the whole transfer and Aglyn funds the
    // refund out of its own balance.
    expect(params.get('reverse_transfer')).toBe('true')
    // ...and without this Aglyn keeps a commission on an appointment that did
    // not happen.
    expect(params.get('refund_application_fee')).toBe('true')
  })

  it('reverses the seller share on a PARTIAL refund too', async () => {
    // Asserted SEPARATELY from the full case on purpose. The marketplace bug
    // this guards against reversed nothing on a partial while the full path
    // looked correct, and the platform paid the whole concession out of a 20%
    // cut. A test that only refunds everything cannot see that.
    const res = makeRes()
    await bookingRefundHandler(makeReq({ amountCents: 3000 }), res)
    expect(res.statusCode).toBe(200)
    const params = stripePosts[0].params
    expect(params.get('amount')).toBe('3000')
    expect(params.get('reverse_transfer')).toBe('true')
    expect(params.get('refund_application_fee')).toBe('true')
    // Stripe prorates both against the partial amount, so the merchant gives
    // back $30 of their $71.25 rather than all of it — which is why the route
    // sends the switches rather than computing shares itself.
    expect(res.body).toEqual({
      refundedCents: 3000,
      totalRefundedCents: 3000,
      fullyRefunded: false,
    })
    // A part-refunded appointment is still happening.
    expect(mockAdmin.__state.booking['status']).toBe('confirmed')
    // And the campaign loses THIS attempt's money, not the booking total,
    // while keeping the order it was credited with.
    expect(reverseAttributedRevenue).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'booking-1',
        amountCents: 3000,
        closedTheOrder: false,
      }),
    )
  })

  it('tells the campaign reversal when the refund ended the booking', async () => {
    reverseAttributedRevenue.mockClear()
    const res = makeRes()
    await bookingRefundHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(reverseAttributedRevenue).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 7500, closedTheOrder: true }),
    )
  })

  it('accumulates partials and ends the booking when they reach the total', async () => {
    const first = makeRes()
    await bookingRefundHandler(makeReq({ amountCents: 3000 }, 'a'), first)
    const second = makeRes()
    await bookingRefundHandler(makeReq({ amountCents: 4500 }, 'b'), second)
    expect(second.statusCode).toBe(200)
    expect(second.body).toEqual({
      refundedCents: 4500,
      totalRefundedCents: 7500,
      fullyRefunded: true,
    })
    expect(mockAdmin.__state.booking['refundedCents']).toBe(7500)
    // Only NOW does the slot come back.
    expect(mockAdmin.__state.booking['status']).toBe('canceled')
    expect(stripePosts.map((post) => post.params.get('amount'))).toEqual([
      '3000',
      '4500',
    ])
    // Every one of them reversed, not just the last.
    for (const post of stripePosts) {
      expect(post.params.get('reverse_transfer')).toBe('true')
    }
  })

  it('caps a partial at what is left rather than over-refunding', async () => {
    Object.assign(mockAdmin.__state.booking, { refundedCents: 7000 })
    const res = makeRes()
    await bookingRefundHandler(makeReq({ amountCents: 5000 }, 'c'), res)
    expect(res.statusCode).toBe(200)
    expect(stripePosts[0].params.get('amount')).toBe('500')
  })

  it('refuses once nothing is left', async () => {
    Object.assign(mockAdmin.__state.booking, { refundedCents: 7500 })
    const res = makeRes()
    await bookingRefundHandler(makeReq({}, 'd'), res)
    expect(res.statusCode).toBe(400)
    expect(stripePosts).toHaveLength(0)
  })

  it('counts the amount BEFORE calling Stripe, not after', async () => {
    // The AGL-1696 ordering, and it needed its own test: deleting the
    // in-transaction reserve entirely left every other assertion in this file
    // green, because the post-Stripe write puts the same number in the same
    // place on the happy path. What the reserve actually buys is the UNHAPPY
    // path — if the response is lost after Stripe has moved the money, the
    // amount is already counted, so the retry refunds less rather than more.
    // A counter written only afterwards is not a guard; it is a record.
    //
    // Asserted by reading the document at the moment of the outbound call,
    // which is the only instant where the two orderings differ.
    let refundedAtCallTime: unknown = 'never called'
    // Restored by ASSIGNMENT, not `mockRestore`: the suite's own fetch double
    // is installed in `beforeAll`, and `mockRestore` would put back the real
    // `global.fetch` instead — which on this box carries the LIVE Stripe key.
    const suiteFetch = global.fetch
    global.fetch = (async (url: any, init?: any) => {
      refundedAtCallTime = mockAdmin.__state.booking['refundedCents']
      stripePosts.push({
        params: new URLSearchParams(String(init?.body ?? '')),
        headers: (init?.headers ?? {}) as Record<string, string>,
      })
      return { ok: true, json: async () => ({ id: 're_1' }) }
    }) as unknown as typeof fetch
    try {
      const res = makeRes()
      await bookingRefundHandler(makeReq({ amountCents: 3000 }, 'pre'), res)
      expect(res.statusCode).toBe(200)
      expect(refundedAtCallTime).toBe(3000)
    } finally {
      global.fetch = suiteFetch
    }
  })

  it('cannot be over-refunded by a concurrent attempt', async () => {
    // The cap is the ONLY thing that stops this: the two attempts are
    // genuinely distinct refunds with distinct keys, so no idempotency key can
    // help. A competing writer lands between this transaction's read and its
    // write; the counter must still not exceed what was captured.
    mockAdmin.__state.interleave = () => {
      mockAdmin.__state.booking['refundedCents'] = 7000
    }
    const res = makeRes()
    await bookingRefundHandler(makeReq({}, 'e'), res)
    expect(res.statusCode).toBe(200)
    // Reads 7000 already gone, so only 500 remains — never the full 7500.
    expect(stripePosts[0].params.get('amount')).toBe('500')
    expect(Number(mockAdmin.__state.booking['refundedCents'])).toBeLessThanOrEqual(
      7500,
    )
  })

  it('replays a settled attempt instead of refunding twice', async () => {
    const first = makeRes()
    await bookingRefundHandler(makeReq({ amountCents: 3000 }, 'same'), first)
    const second = makeRes()
    await bookingRefundHandler(makeReq({ amountCents: 3000 }, 'same'), second)
    expect(second.statusCode).toBe(200)
    expect(second.body).toEqual(first.body)
    // One refund reached Stripe, not two.
    expect(stripePosts).toHaveLength(1)
    expect(mockAdmin.__state.booking['refundedCents']).toBe(3000)
  })

  it('sends an Idempotency-Key so a lost response cannot double-refund', async () => {
    const res = makeRes()
    await bookingRefundHandler(makeReq({}, 'f'), res)
    expect(stripePosts[0].headers['Idempotency-Key']).toBeTruthy()
  })

  it('gives the reservation back when Stripe refuses', async () => {
    stripeOk = false
    const res = makeRes()
    await bookingRefundHandler(makeReq({ amountCents: 3000 }, 'g'), res)
    expect(res.statusCode).toBe(502)
    // No money moved, so the counter must not hold the amount — otherwise the
    // guest can never be refunded that $30 by any later attempt.
    expect(Number(mockAdmin.__state.booking['refundedCents'] ?? 0)).toBe(0)
    expect(mockAdmin.__state.booking['status']).toBe('confirmed')
  })
})

describe('who may refund a booking (AGL-2315)', () => {
  it('refuses without a bearer token', async () => {
    const req = makeReq()
    req.headers.authorization = ''
    const res = makeRes()
    await bookingRefundHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(stripePosts).toHaveLength(0)
  })

  it('refuses a site EDITOR — refunds move money', async () => {
    mockAdmin.__state.uid = 'editor-1'
    const res = makeRes()
    await bookingRefundHandler(makeReq({}, 'h'), res)
    expect(res.statusCode).toBe(403)
    expect(stripePosts).toHaveLength(0)
    // And nothing was written on the way to the refusal.
    expect(mockAdmin.__state.booking['refundedCents']).toBeUndefined()
  })

  it('refuses a stranger to the site', async () => {
    mockAdmin.__state.uid = 'nobody'
    const res = makeRes()
    await bookingRefundHandler(makeReq({}, 'i'), res)
    expect(res.statusCode).toBe(403)
    expect(stripePosts).toHaveLength(0)
  })

  it('refuses a GET', async () => {
    const req = makeReq()
    req.method = 'GET'
    const res = makeRes()
    await bookingRefundHandler(req, res)
    expect(res.statusCode).toBe(405)
  })
})

describe('bookings that cannot be refunded here (AGL-2315)', () => {
  it('refuses a booking that was never paid', async () => {
    delete mockAdmin.__state.booking['paidAmountCents']
    const res = makeRes()
    await bookingRefundHandler(makeReq({}, 'j'), res)
    expect(res.statusCode).toBe(409)
    expect(stripePosts).toHaveLength(0)
  })

  it('names the dashboard for a booking paid before the PaymentIntent was recorded', async () => {
    // Bookings taken before AGL-2315 stored no PaymentIntent, and it cannot be
    // recovered from our own data. A 409 that says what to do — including to
    // tick "Reverse transfer" — beats a 500 an admin cannot act on.
    delete mockAdmin.__state.booking['paymentIntentId']
    const res = makeRes()
    await bookingRefundHandler(makeReq({}, 'k'), res)
    expect(res.statusCode).toBe(409)
    expect(String((res.body as any)?.error)).toContain('Reverse transfer')
    expect(stripePosts).toHaveLength(0)
  })

  it('refuses a negative or zero amount', async () => {
    for (const amountCents of [0, -100, Number.NaN]) {
      const res = makeRes()
      await bookingRefundHandler(makeReq({ amountCents }, 'l'), res)
      expect(res.statusCode).toBe(400)
    }
    expect(stripePosts).toHaveLength(0)
  })

  it('refuses an unknown booking', async () => {
    mockAdmin.__state.bookingExists = false
    const res = makeRes()
    await bookingRefundHandler(makeReq({}, 'm'), res)
    expect(res.statusCode).toBe(404)
    expect(stripePosts).toHaveLength(0)
  })
})
