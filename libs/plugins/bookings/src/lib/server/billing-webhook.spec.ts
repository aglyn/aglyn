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
 * The paid-booking branch and its customer (AGL-1755).
 *
 * `server.ts` captures the contact at REQUEST time, which is the right place —
 * the booking is written `pendingPayment` and no money has moved yet. Payment
 * completes here, and this handler set `paidAmountCents` and never returned to
 * the contact, so a paid booking's money reached the booking document and
 * nothing else. The same shape as AGL-1748's draft branch: the completion
 * handler does everything except the contact.
 *
 * The guard came with it. This was an unconditional merge-set with no status
 * check — idempotent only by accident, because every value it wrote was fixed.
 * `purchaseCents` is a `FieldValue.increment`, so the accident stops holding
 * the moment money is carried through.
 *
 * These tests assert on WHAT LANDED — the in-memory Firestore and the captured
 * `upsertHostContact` options — rather than on anything the handler returns; it
 * returns nothing. Same harness as `billing-webhook-draft.spec.ts` (AGL-1748).
 *
 * No Stripe boundary is exercised: this handler is handed the event object and
 * makes no outbound call. `global.fetch` is still replaced and asserted unused,
 * because localhost carries the LIVE secret key.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
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
      // `FieldValue.delete()` has to actually remove the key, or the
      // expired-hold assertion below would pass on a sentinel.
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

const contactUpserts: any[] = []
const sentEmails: any[] = []
const meteredHosts: string[] = []

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
  meterHostEmail: async (hostId: string) => {
    meteredHosts.push(hostId)
  },
  renderHostEmailWithTokens: async () => null,
  upsertHostContact: async (options: any) => {
    contactUpserts.push(options)
  },
  // The GA4 `purchase` this handler now sends (AGL-2481). Stubbed rather than
  // omitted: an absent export is a TypeError at the call site, which would
  // redden these refund tests for a reason that has nothing to do with them.
  // What the event CONTAINS is asserted in `billing-webhook-ga-purchase.spec.ts`.
  sendGa4Purchase: async () => ({ sent: true, synthesizedClientId: true }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  sendEmail: async (message: any) => {
    sentEmails.push(message)
  },
}))

/**
 * The handler schedules its GA4 `purchase` through `after()` (AGL-2481), and
 * importing `next/server` in a node test environment throws before any test
 * runs. Mocked to run the callback inline, matching every marketplace webhook
 * spec. The purchase itself is asserted in `billing-webhook-ga-purchase.spec.ts`;
 * here this only keeps the module loadable.
 */
jest.mock('next/server', () => ({
  after: (work: () => unknown) => {
    void work()
  },
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// The pending hold and the session that pays it
// ---------------------------------------------------------------------------

/**
 * A $95.00 service. Nothing coincides: the charge (9500) is not the duration
 * (60), not the start instant and not the platform's own numbers, so an
 * assertion that lands on it cannot have got there by reaching for the nearest
 * figure.
 */
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

const BOOKING_SESSION = {
  id: 'cs_booking_1',
  payment_status: 'paid',
  amount_total: 9500,
  metadata: {
    type: 'booking-payment',
    hostId: 'host-1',
    bookingId: 'booking-1',
  },
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await bookingsBillingWebhookHandler({ type, object } as any)
}

function storedBooking() {
  return docs.get('hosts/host-1/bookings/booking-1') as any
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  contactUpserts.length = 0
  sentEmails.length = 0
  meteredHosts.length = 0
  fetchMock.mockClear()

  docs.set('hosts/host-1/bookings/booking-1', { ...BOOKING })
})

// ---------------------------------------------------------------------------

describe('paid booking (AGL-1755)', () => {
  /** Unchanged behavior, pinned so the guard rewrite cannot quietly drop it. */
  it('confirms the hold, records the amount and releases the expiry', async () => {
    await deliver(BOOKING_SESSION)
    const booking = storedBooking()
    expect(booking.status).toBe('confirmed')
    expect(booking.paidAmountCents).toBe(9500)
    expect(booking.confirmedAt).toBe('<server-timestamp>')
    expect('expiresAtMs' in booking).toBe(false)
  })

  /**
   * THE DEFECT. This handler never called `upsertHostContact` at all, so the
   * money that completed a paid booking reached the booking document and
   * nothing else — the request-time capture in `server.ts` had already run,
   * before there was anything to count. Every assertion here failed on an empty
   * array before the fix.
   */
  it('records the payment against the customer', async () => {
    await deliver(BOOKING_SESSION)
    expect(contactUpserts).toHaveLength(1)
    const upsert = contactUpserts[0]
    expect(upsert.hostId).toBe('host-1')
    expect(upsert.email).toBe('rhea@example.com')
    expect(upsert.name).toBe('Rhea Salt')
    expect(upsert.interaction.refId).toBe('booking-1')
    expect(upsert.interaction.summary).toBe(
      'Paid for "Deep tissue massage" ($95.00)',
    )
  })

  /**
   * The money, on its own. `purchaseCents` is the field `ltvCents` accumulates
   * through, and 9500 is what Stripe charged — the booking document stores no
   * price to re-derive it from, which is the AGL-1698/AGL-1711 rule anyway.
   */
  it('passes the charged amount as purchaseCents', async () => {
    await deliver(BOOKING_SESSION)
    expect(contactUpserts[0].purchaseCents).toBe(9500)
  })

  /**
   * Provenance. `source` stays `'booking'` — the same source the request-time
   * capture used — so the contact's `sources` map still says where this person
   * came from, and service revenue stays distinguishable from product revenue
   * without a schema change.
   */
  it('keeps the booking source', async () => {
    await deliver(BOOKING_SESSION)
    expect(contactUpserts[0].source).toBe('booking')
  })

  /**
   * Stripe delivers at least once and `purchaseCents` is a
   * `FieldValue.increment`, so a replay would inflate the customer's lifetime
   * value every time. There was no status check here at all; the transition is
   * now the key and it runs in a transaction. Counting the side effects is the
   * assertion — the booking document is a merge-set and looks identical either
   * way. The doubled email and doubled meter were already happening.
   */
  it('absorbs a redelivered event without double-counting', async () => {
    await deliver(BOOKING_SESSION)
    await deliver(BOOKING_SESSION)

    expect(contactUpserts).toHaveLength(1)
    expect(sentEmails).toHaveLength(1)
    expect(meteredHosts).toEqual(['host-1'])
    expect(storedBooking().paidAmountCents).toBe(9500)
  })

  /**
   * A metadata `bookingId` pointing at nothing used to CREATE a stub booking,
   * because the write was a merge-set on a ref that need not exist. The
   * existence check is new and deliberate.
   */
  it('does not manufacture a booking that is not there', async () => {
    docs.delete('hosts/host-1/bookings/booking-1')
    await deliver(BOOKING_SESSION)
    expect(storedBooking()).toBeUndefined()
    expect(contactUpserts).toHaveLength(0)
    expect(sentEmails).toHaveLength(0)
  })

  /**
   * The key is "not yet confirmed" rather than "is pendingPayment" on purpose:
   * the lapsed-hold sweeper cancels a `pendingPayment` booking after 24h, and
   * refusing a payment that landed anyway would take the money and record
   * nothing. Pinned so the guard is not tightened without someone deciding to.
   */
  it('still confirms a hold the sweeper had canceled', async () => {
    docs.set('hosts/host-1/bookings/booking-1', {
      ...BOOKING,
      status: 'canceled',
    })
    await deliver(BOOKING_SESSION)
    expect(storedBooking().status).toBe('confirmed')
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].purchaseCents).toBe(9500)
  })

  /** A booking with no address is not a contact — and must not throw. */
  it('records no contact when the booking has no address', async () => {
    docs.set('hosts/host-1/bookings/booking-1', { ...BOOKING, email: '' })
    await deliver(BOOKING_SESSION)
    expect(contactUpserts).toHaveLength(0)
    expect(sentEmails).toHaveLength(0)
    expect(storedBooking().status).toBe('confirmed')
  })

  /** Another plugin's session is not this branch's to act on. */
  it('ignores a session that is not a booking payment', async () => {
    await deliver({
      ...BOOKING_SESSION,
      metadata: { ...BOOKING_SESSION.metadata, type: 'commerce-cart' },
    })
    expect(contactUpserts).toHaveLength(0)
    expect(storedBooking().status).toBe('pendingPayment')
  })

  /**
   * The guest confirmation is the other side effect hanging off the new guard,
   * pinned so the transaction rewrite is covered end to end and still reads the
   * booking's own fields after they moved off a post-write re-read and onto the
   * value lifted inside the transaction.
   */
  it('still emails the customer the service and the reference', async () => {
    await deliver(BOOKING_SESSION)
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toBe('rhea@example.com')
    expect(sentEmails[0].subject).toBe('Booking confirmed: Deep tissue massage')
    expect(sentEmails[0].text).toContain('Reference: booking-1')
  })

  it('never calls Stripe', async () => {
    await deliver(BOOKING_SESSION)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * WHAT A REFUND WILL NEED (AGL-2315).
 *
 * A paid booking is a destination charge now, and reversing one needs the
 * PaymentIntent — which appears on this event and nowhere else. The handler
 * recorded `paidAmountCents` and nothing that identifies the charge, so a
 * refund had no handle to pull, and unlike most gaps this one cannot be
 * backfilled from our own data later: it is gone the moment the webhook
 * returns.
 */
describe('the refund handles (AGL-2315)', () => {
  const PAID_SESSION = {
    ...BOOKING_SESSION,
    payment_intent: 'pi_booking_1',
    metadata: { ...BOOKING_SESSION.metadata, feeCents: '190' },
  }

  it('records the PaymentIntent the refund will reverse', async () => {
    await deliver(PAID_SESSION)
    expect(storedBooking().paymentIntentId).toBe('pi_booking_1')
  })

  it('reads an EXPANDED payment_intent object as well as an id string', async () => {
    // Stripe sends the id on a delivered event, but an expanded read — or a
    // replayed event captured with `expand` — carries the object. Coercing
    // that with `String()` would store "[object Object]" and produce a refund
    // route that 502s on a booking it says it can refund.
    await deliver({ ...PAID_SESSION, payment_intent: { id: 'pi_expanded' } })
    expect(storedBooking().paymentIntentId).toBe('pi_expanded')
  })

  it('records the fee as CHARGED, not as re-resolved later', async () => {
    // The rate follows the plan and the plan moves (AGL-2289), so re-deriving
    // Aglyn's cut at refund time would reverse a share that was never taken.
    await deliver(PAID_SESSION)
    expect(storedBooking().feeCents).toBe(190)
  })

  it('records a zero fee on the 0%-rate tiers as a real answer', async () => {
    await deliver({
      ...PAID_SESSION,
      metadata: { ...PAID_SESSION.metadata, feeCents: '0' },
    })
    expect(storedBooking().feeCents).toBe(0)
  })

  it('does NOT seed refundedCents', async () => {
    // Seeding it would be the AGL-1758 shape: a defaulted field written
    // through `merge` destroying the real one. This handler can re-enter after
    // a refund has accumulated a counter, and a zero written back over it
    // would re-open the full amount for refunding a second time.
    await deliver(PAID_SESSION)
    expect('refundedCents' in storedBooking()).toBe(false)
  })

  it('leaves a refunded booking alone on redelivery', async () => {
    // "Already processed" is WIDER than `confirmed` once money can flow back
    // out: a full refund moves the booking OFF `confirmed`, so a redelivery
    // arriving afterwards would otherwise read as unprocessed and re-confirm
    // an appointment the merchant has already cancelled and refunded.
    await deliver(PAID_SESSION)
    docs.set('hosts/host-1/bookings/booking-1', {
      ...storedBooking(),
      status: 'canceled',
      refundedCents: 9500,
    })
    contactUpserts.length = 0
    sentEmails.length = 0
    meteredHosts.length = 0

    await deliver(PAID_SESSION)

    expect(storedBooking().status).toBe('canceled')
    expect(storedBooking().refundedCents).toBe(9500)
    // ...and no second confirmation to a guest whose appointment is cancelled,
    // no second contact write, no second metered email.
    expect(sentEmails).toHaveLength(0)
    expect(contactUpserts).toHaveLength(0)
    expect(meteredHosts).toHaveLength(0)
  })

  it('leaves a PARTIALLY refunded booking alone on redelivery', async () => {
    // Still `confirmed`, because a part-refunded appointment is still
    // happening — so the status check alone cannot catch this one, and the
    // refund counter is what proves the handler has already run.
    await deliver(PAID_SESSION)
    docs.set('hosts/host-1/bookings/booking-1', {
      ...storedBooking(),
      status: 'pendingPayment',
      refundedCents: 3000,
    })
    contactUpserts.length = 0
    sentEmails.length = 0

    await deliver(PAID_SESSION)

    expect(storedBooking().refundedCents).toBe(3000)
    expect(sentEmails).toHaveLength(0)
    expect(contactUpserts).toHaveLength(0)
  })
})

/**
 * THE REGIME THE BOOKING CARRIED, ON THE RECORD (AGL-2028).
 *
 * `server.ts` now charges the merchant's own service rate when they have set
 * one, as an ordinary line item Stripe is never told is tax (AGL-1711). That
 * construction is what keeps the tax the MERCHANT's rather than something
 * computed against Aglyn's registrations — and it is also what makes the
 * session report `total_details.amount_tax: 0`, so the session's own
 * `metadata.taxCents` is the ONLY witness to the figure.
 *
 * The booking document is what the merchant reads, and every other storefront
 * money door stamps `taxMode` on exactly that (AGL-2451). Three things follow
 * and all three were absent before:
 *
 *  1. **`taxMode`**, from the shared `storefrontTaxModeOf` derivation in its
 *     two-argument form — never a constant, so the day a rate is set the
 *     record follows it rather than needing a second change here.
 *  2. **`taxCents`** beside it, absent rather than a defaulted zero: "no tax
 *     was charged" and "this booking predates the field" are different facts,
 *     and a zero written through `merge` is the AGL-1758 shape.
 *  3. **The contact's lifetime value must EXCLUDE it.** Tax is not the
 *     merchant's revenue. `paidAmountCents` stays the full charge, because it
 *     is the ceiling a refund reverses and the guest paid all of it.
 */
describe('a booking records its tax regime (AGL-2028)', () => {
  /** $95 service + $5.70 service tax at 6% = $100.70 charged. */
  const TAXED_SESSION = {
    ...BOOKING_SESSION,
    amount_total: 10070,
    metadata: { ...BOOKING_SESSION.metadata, taxCents: '570', taxPct: '6' },
  }

  it('stamps the regime on the booking the merchant reads', async () => {
    await deliver(BOOKING_SESSION)
    const booking = storedBooking()
    expect(booking.status).toBe('confirmed')
    // The default store sets no service rate, so the honest answer is `none`
    // — recorded, which is what separates it from a booking taken before the
    // field existed.
    expect(booking.taxMode).toBe('none')
    expect(booking.taxCents).toBeUndefined()
  })

  it('records a merchant-rated booking as `manual`, not `none`', async () => {
    // THE DEFECT A ONE-ARGUMENT DERIVATION WOULD LEAVE. Stripe reports no tax
    // on this session by our own construction, so anything reading only
    // Stripe's fields says `none` here — for a booking that really did charge
    // the client tax.
    await deliver(TAXED_SESSION)
    const booking = storedBooking()
    expect(booking.taxMode).toBe('manual')
    expect(booking.taxCents).toBe(570)
  })

  it('follows the session rather than restating a constant', async () => {
    // Stripe Tax is never asked from this path, but the derivation must still
    // be the shared one rather than a hand-written "manual if metadata".
    await deliver({
      ...BOOKING_SESSION,
      automatic_tax: { enabled: true },
      total_details: { amount_tax: 570 },
    })
    expect(storedBooking().taxMode).toBe('stripe-automatic')
  })

  it('keeps the full charge as the refundable amount', async () => {
    // `paidAmountCents` is the ceiling `refund.ts` reverses against, and the
    // client handed over all of it — tax included.
    await deliver(TAXED_SESSION)
    expect(storedBooking().paidAmountCents).toBe(10070)
  })

  it('counts only the service toward the client’s lifetime value', async () => {
    // Tax is not the merchant's revenue and must not inflate a contact's LTV
    // — the AGL-1755 figure, kept honest.
    await deliver(TAXED_SESSION)
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].purchaseCents).toBe(9500)
    expect(contactUpserts[0].purchaseCents).not.toBe(10070)
    expect(contactUpserts[0].interaction.summary).toContain('($95.00)')
  })

  it('survives a redelivered event', async () => {
    await deliver(TAXED_SESSION)
    await deliver(TAXED_SESSION)
    const booking = storedBooking()
    expect(booking.taxMode).toBe('manual')
    expect(booking.taxCents).toBe(570)
  })
})
