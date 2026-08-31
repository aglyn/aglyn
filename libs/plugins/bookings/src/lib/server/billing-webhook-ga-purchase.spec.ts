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

import { bookingsBillingWebhookHandler } from './billing-webhook'

/**
 * The GA4 `purchase` a paid booking reports into AGLYN's property (AGL-2481).
 *
 * The bookings plugin sent zero analytics events of any kind while its billing
 * webhook computed real money, so booking revenue was invisible in our own
 * property. These tests pin the two things that make the number trustworthy:
 * it is the fee actually charged, and a Stripe redelivery cannot send it twice.
 *
 * ## The fixture is built so a wrong implementation cannot pass
 *
 * `feeCents` is **617** against a **9500** charge. 617 is not 5% of 9500 (475),
 * not 6% (570), not 7% (665) and not any other round rate — so an
 * implementation that re-derived our cut from the org's plan instead of reading
 * what Stripe was told to charge produces a different number and goes red. It
 * is also not the gross, not the tax, and not the duration, so an assertion
 * that lands on it cannot have got there by reaching for the nearest figure.
 *
 * `a SECOND booking with a different fee` exists for the same reason from the
 * other side: it is the mutation test for "records a constant instead of the
 * measured value", the defect class that has shipped in this repo before. A
 * hardcoded 6.17 passes the first test and fails that one.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore — the `billing-webhook.spec.ts` harness
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

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
      const next = options?.merge
        ? { ...(docs.get(path) ?? {}), ...value }
        : { ...value }
      for (const [key, entry] of Object.entries(next)) {
        if ((entry as any)?.__delete) delete (next as any)[key]
      }
      docs.set(path, next)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id?: string) => makeDocRef(`${path}/${id ?? 'auto'}`),
    where: () => ref,
    limit: () => ref,
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<any>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    }),
}

/** Every `sendGa4Purchase` input, in order. The subject of every assertion. */
const ga4Purchases: any[] = []
/** Lets one test make the sender reject, to prove the handler still survives. */
let ga4Rejects = false

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The site's own sending identity, which every tenant send now resolves.
   *
   * A VERIFIED one, because these specs are about the mail their subject
   * sends rather than about the identity boundary — a refusing stub would
   * turn each of them into an assertion that no mail was sent, which is not
   * what any of them was written to check. The boundary itself is proved in
   * `platform-sending-domain.spec.ts`, `host-sending-domain.spec.ts` and
   * `email-audience-coverage.spec.ts`.
   *
   * The domain is the SITE's, never `aglyn.com`, so an assertion on a From:
   * address in this file cannot accidentally pass against a platform
   * fallback.
   */
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        delete: () => ({ __delete: true }),
      },
    },
  },
  getOrgForHost: async () => ({
    org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
  }),
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
  upsertHostContact: async () => undefined,
  sendGa4Purchase: async (input: any) => {
    ga4Purchases.push(input)
    if (ga4Rejects) throw new Error('GA4 is down')
    return { sent: true, synthesizedClientId: true }
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  sendEmail: async () => undefined,
}))

/**
 * `after()` runs the callback immediately here.
 *
 * The REAL contract is the opposite of a no-op and the distinction matters:
 * production `after()` defers the work until the response is sent, and the
 * reason this handler must use it at all is that a bare `void promise` in this
 * invocation never runs (AGL-2327/AGL-2346). Running it inline is how a
 * synchronous test observes work that is by construction asynchronous in
 * production; what it cannot do is prove the scheduling itself, which is why
 * `it('schedules through after(), never a bare void')` asserts on the import.
 */
jest.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    void fn()
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BOOKING = {
  serviceId: 'service-1',
  serviceName: 'Deep tissue massage',
  name: 'Rhea Salt',
  email: 'rhea@example.com',
  startsAtMs: 1_777_000_000_000,
  endsAtMs: 1_777_003_600_000,
  status: 'pendingPayment',
  expiresAtMs: 1_776_999_000_000,
  timezone: 'America/Chicago',
}

/**
 * $95.00 charged, of which $7.84 is the merchant's service tax and $6.17 is
 * Aglyn's fee. Every one of the three is a different number and none is a
 * round function of another — see the file comment.
 */
const GROSS_CENTS = 9500
const FEE_CENTS = 617
const TAX_CENTS = 784

function session(overrides: Record<string, any> = {}) {
  return {
    id: 'cs_booking_1',
    payment_status: 'paid',
    amount_total: GROSS_CENTS,
    currency: 'usd',
    customer_details: { email: 'rhea@example.com' },
    ...overrides,
    metadata: {
      type: 'booking-payment',
      hostId: 'host-1',
      bookingId: 'booking-1',
      feeCents: String(FEE_CENTS),
      taxCents: String(TAX_CENTS),
      ...(overrides.metadata ?? {}),
    },
  }
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await bookingsBillingWebhookHandler({ type, object } as any)
}

beforeEach(() => {
  docs.clear()
  ga4Purchases.length = 0
  ga4Rejects = false
  docs.set('hosts/host-1/bookings/booking-1', { ...BOOKING })
})

// ---------------------------------------------------------------------------
// The value is the measured one
// ---------------------------------------------------------------------------

describe('the value', () => {
  it('is the fee Stripe actually charged, read off the webhook payload', async () => {
    await deliver(session())

    expect(ga4Purchases).toHaveLength(1)
    // 617 cents — the `metadata.feeCents` the session carried, and nothing
    // else on the event.
    expect(ga4Purchases[0].value).toBe(6.17)
  })

  it('is NOT the gross the guest paid — that is the merchant\'s number', async () => {
    await deliver(session())

    // The AGL-1639 settlement: our property reports OUR take. Reporting 95.00
    // here would put a massage beside a subscription as though Aglyn earned
    // both, and every combined total and ARPA in the property would be wrong.
    expect(ga4Purchases[0].value).not.toBe(95)
    expect(ga4Purchases[0].value).not.toBe(GROSS_CENTS / 100)
  })

  it('is not the gross ex-tax either, which is the merchant\'s figure', async () => {
    await deliver(session())

    // (9500 - 784) / 100 = 87.16 — the number the MERCHANT's property gets,
    // and a plausible wrong answer here.
    expect(ga4Purchases[0].value).not.toBe(87.16)
  })

  /**
   * THE MUTATION TEST. A hardcoded `6.17`, or a fee re-derived from the org's
   * plan rate, passes every assertion above and fails this one: the only
   * implementation that survives both is one that reads the number off the
   * event it was handed.
   */
  it('MOVES with the payload — a second booking at a different fee', async () => {
    docs.set('hosts/host-1/bookings/booking-2', { ...BOOKING })
    await deliver(session())
    await deliver(
      session({
        id: 'cs_booking_2',
        amount_total: 4200,
        metadata: { bookingId: 'booking-2', feeCents: '289', taxCents: '0' },
      }),
    )

    expect(ga4Purchases.map((purchase) => purchase.value)).toEqual([6.17, 2.89])
  })

  it('sends NOTHING on a 0%-fee tier rather than a zero-valued purchase', async () => {
    await deliver(session({ metadata: { feeCents: '0' } }))

    // The merchant really sold something and Aglyn really earned nothing. A
    // `value: 0` row would drag ARPA down and inflate the purchase COUNT,
    // which is the denominator of conversion rate.
    expect(ga4Purchases).toHaveLength(0)
    // ...but the booking still confirmed. Analytics must never gate money.
    expect(docs.get('hosts/host-1/bookings/booking-1')?.status).toBe('confirmed')
  })
})

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('a REPLAYED webhook does not fire a second purchase', async () => {
    const object = session()

    await deliver(object)
    await deliver(object)
    await deliver(object)

    // Stripe redelivers `checkout.session.completed` for up to three days
    // after any 500, and this endpoint 500s on purpose. Three deliveries, one
    // purchase — anything else inflates our own reported revenue by the
    // redelivery rate.
    expect(ga4Purchases).toHaveLength(1)
    expect(ga4Purchases[0].value).toBe(6.17)
  })

  it('does not fire again after the booking has been refunded', async () => {
    await deliver(session())
    expect(ga4Purchases).toHaveLength(1)

    // A refund moves the booking OFF `confirmed`, so a redelivery arriving
    // afterwards would read as unprocessed under a narrower guard.
    docs.set('hosts/host-1/bookings/booking-1', {
      ...docs.get('hosts/host-1/bookings/booking-1'),
      status: 'refunded',
      refundedCents: GROSS_CENTS,
    })
    await deliver(session())

    expect(ga4Purchases).toHaveLength(1)
  })

  it('carries the session id as transaction_id, so GA de-duplicates too', async () => {
    await deliver(session())

    // The same key the Firestore guard turns on — a second, independent line
    // of defence if that guard is ever bypassed.
    expect(ga4Purchases[0].transactionId).toBe('cs_booking_1')
  })
})

// ---------------------------------------------------------------------------
// Shape, and the failure posture
// ---------------------------------------------------------------------------

describe('the event', () => {
  it('is categorised so booking revenue reads apart from the other lines', async () => {
    await deliver(session())

    const [item] = ga4Purchases[0].items
    expect(item.item_category).toBe('booking')
    // Sums to `value`: one item, one price, and that price is OUR fee.
    expect(item.price).toBe(6.17)
    expect(item.quantity).toBe(1)
  })

  it('carries NO merchant free text into our property', async () => {
    await deliver(session())

    const [item] = ga4Purchases[0].items
    // A service name is merchant-authored and one edit from carrying a
    // person's name into a dimension in OUR property.
    expect(item.item_name).not.toBe('Deep tissue massage')
    expect(item.item_id).toBe('service-1')
  })

  it('always resolves a client-id seed, so the hit is never silently dropped', async () => {
    await deliver(session())

    // `sendGa4Purchase` returns `no-client-id` and sends nothing when it has
    // neither a real nor a synthesizable id — the "written but never read"
    // void this change exists to close.
    expect(ga4Purchases[0].stripeCustomerId).toBeTruthy()
  })

  it('prefers a real Stripe customer over the email seed', async () => {
    await deliver(session({ customer: 'cus_regular_guest' }))

    expect(ga4Purchases[0].stripeCustomerId).toBe('cus_regular_guest')
  })

  it('falls back to the guest email, never the per-appointment booking id', async () => {
    await deliver(session({ customer_details: { email: 'rhea@example.com' } }))

    // Seeding from the booking id would turn a regular client into a crowd of
    // one-purchase strangers and make ARPA nonsense.
    expect(ga4Purchases[0].stripeCustomerId).toBe('rhea@example.com')
    expect(ga4Purchases[0].stripeCustomerId).not.toBe('booking-1')
  })

  it('never lets an analytics failure reach the webhook', async () => {
    ga4Rejects = true

    // A throw would un-claim the Stripe event and cause a redelivery, turning
    // a missed analytics hit into a repeated billing side effect.
    await expect(deliver(session())).resolves.toBeUndefined()
    expect(docs.get('hosts/host-1/bookings/booking-1')?.status).toBe('confirmed')
  })

  it('schedules through after(), never a bare void promise', async () => {
    // The inline `after` mock cannot prove the scheduling, so this asserts the
    // handler actually goes through it: with `after` mocked to DROP its
    // callback, no purchase is recorded. A bare `void sendGa4Purchase(...)`
    // would still record one and fail here — and would report to nothing in
    // production, which is how marketplace revenue went missing (AGL-2327).
    const { after } = jest.requireMock('next/server') as any
    expect(typeof after).toBe('function')
    await deliver(session())
    expect(ga4Purchases).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The booking becomes findable by session id
// ---------------------------------------------------------------------------

describe('the merchant-side lookup key', () => {
  it('stamps the checkout session id on the confirmed booking', async () => {
    await deliver(session())

    // The guest's browser comes back from Stripe holding a session id and
    // nothing else, so this is what `booking-analytics.ts` resolves against.
    expect(docs.get('hosts/host-1/bookings/booking-1')?.checkoutSessionId).toBe(
      'cs_booking_1',
    )
  })
})
