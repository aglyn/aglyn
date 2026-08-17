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

import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * The paid-reservation branch and its guest (AGL-1755).
 *
 * The branch stored `paidCents` straight off Stripe's `amount_total` and then
 * called `upsertHostContact` with no amount at all, so a guest who paid for a
 * stay came out of the CRM worth nothing.
 *
 * The load-bearing assertion in this file is that the amount is the DEPOSIT
 * (`amount_total`) and not the stay's `totalCents`. That is the AGL-1755
 * double-count question, traced through the folio: a POS `folio` sale (AGL-317)
 * charges a room extra as its own paid order carrying its own `purchaseCents`
 * since AGL-1748, appends to `reservations/{id}.folio` for display only, and
 * never touches `paidCents`; check-out settles nothing (it moves the status and
 * says the room charges are "already recorded as paid POS orders"); the unpaid
 * stay balance is collected at the register as another POS order. Deposit and
 * folio lines are therefore disjoint sums, each charged once. Counting
 * `totalCents` here is what would double-count — money not yet paid, which the
 * register will charge again.
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
let autoIdCounter = 0

/** Direct children of `path` — a collection `get()` must not return grandchildren. */
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
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({
      docs: childPaths(path).map(makeSnapshot),
      size: childPaths(path).length,
    }),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, value)
      return created
    },
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

const notifications: any[] = []
const contactUpserts: any[] = []
const sentEmails: any[] = []
const meteredHosts: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
        increment: (value: number) => ({ __increment: value }),
      },
    },
  },
  findUserByUidAcrossPools: async () => null,
  getOrgForHost: async () => ({
    org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
  }),
  meterHostEmail: async (hostId: string) => {
    meteredHosts.push(hostId)
  },
  notifyHostManagers: async (hostId: string, notification: any) => {
    notifications.push({ hostId, ...notification })
  },
  upsertHostContact: async (options: any) => {
    contactUpserts.push(options)
  },
  renderHostEmailWithTokens: async () => null,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async (message: any) => {
    sentEmails.push(message)
  },
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// The pending hold and the session that pays it
// ---------------------------------------------------------------------------

/**
 * A seven-night stay with a deposit. Every figure is distinct, so an assertion
 * that lands on the right number cannot have got there by reaching for the
 * nearest one: the deposit charged (21000) is not the stay total (84000), not
 * the nightly rate (12000), not the platform fee (630) and not the nights (7).
 */
const RESERVATION = {
  resourceId: 'cabin-1',
  status: 'pending',
  checkInDayMs: 1_777_000_000_000,
  checkOutDayMs: 1_777_604_800_000,
  guestName: 'Otto Held',
  guestEmail: 'held@example.com',
  nights: 7,
  totalCents: 84000,
  depositCents: 21000,
  paidCents: 0,
  createdAtMs: 1000,
}

const RESERVATION_SESSION = {
  id: 'cs_res_1',
  payment_status: 'paid',
  payment_intent: 'pi_res_1',
  amount_total: 21000,
  customer_details: { email: 'Paid@Example.com', name: 'Otto Held' },
  metadata: {
    type: 'commerce-reservation',
    hostId: 'host-1',
    reservationId: 'res-1',
    feeCents: '630',
  },
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

function storedReservation() {
  return docs.get('hosts/host-1/reservations/res-1') as any
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  contactUpserts.length = 0
  sentEmails.length = 0
  meteredHosts.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()

  docs.set('hosts/host-1', { displayName: 'Acme Cabins' })
  docs.set('hosts/host-1/reservations/res-1', { ...RESERVATION })
})

// ---------------------------------------------------------------------------

describe('paid reservation (AGL-1755)', () => {
  /** Unchanged behavior, pinned so the guard rewrite cannot quietly drop it. */
  it('confirms the hold and records what was charged', async () => {
    await deliver(RESERVATION_SESSION)
    const reservation = storedReservation()
    expect(reservation.status).toBe('confirmed')
    expect(reservation.paidCents).toBe(21000)
    expect(reservation.checkoutSessionId).toBe('cs_res_1')
    expect(reservation.paymentIntentId).toBe('pi_res_1')
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('New reservation')
  })

  /**
   * THE DEFECT. The branch called `upsertHostContact` with no `purchaseCents`,
   * so `ltvCents` never rose for a guest who had just paid for a stay. This
   * assertion failed on `undefined` before the fix.
   */
  it('passes the charged amount as purchaseCents', async () => {
    await deliver(RESERVATION_SESSION)
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].purchaseCents).toBe(21000)
  })

  /**
   * THE DOUBLE-COUNT GUARD, asserted as its own test because it is the reason
   * AGL-1755 said to trace the folio before writing anything. The amount is the
   * money that MOVED, not the stay's total: the rest of the stay is collected
   * at the register as a separate POS order that carries its own
   * `purchaseCents` since AGL-1748, and a room extra charged to the folio is
   * likewise its own paid order. Taking `totalCents` here would count 84000 of
   * which only 21000 has been paid, and then count the remainder again.
   */
  it('counts the deposit only, never the whole stay', async () => {
    await deliver(RESERVATION_SESSION)
    const { purchaseCents } = contactUpserts[0]
    expect(purchaseCents).toBe(21000)
    expect(purchaseCents).not.toBe(84000) // the stay total, mostly unpaid
    expect(purchaseCents).not.toBe(12000) // the nightly rate
    expect(purchaseCents).not.toBe(630) // the platform fee
    // And the folio is untouched by this branch — a room charge is its own
    // paid POS order, not a second bite at the reservation.
    expect(storedReservation().folio).toBeUndefined()
  })

  /**
   * Provenance survives the money. `source` stays `'booking'`, so the contact's
   * `sources` map still separates a stay from a shop sale and no schema change
   * was needed to keep service revenue distinguishable from product revenue.
   */
  it('keeps the booking source and names the amount in the summary', async () => {
    await deliver(RESERVATION_SESSION)
    const upsert = contactUpserts[0]
    expect(upsert.hostId).toBe('host-1')
    expect(upsert.source).toBe('booking')
    expect(upsert.name).toBe('Otto Held')
    expect(upsert.interaction.refId).toBe('res-1')
    expect(upsert.interaction.summary).toBe('Reserved a stay ($210.00)')
  })

  /** The paying buyer wins; the stored guest address is the fallback. */
  it('prefers the paying buyer over the address the hold carried', async () => {
    await deliver(RESERVATION_SESSION)
    expect(contactUpserts[0].email).toBe('Paid@Example.com')
  })

  it('falls back to the address the hold carried', async () => {
    await deliver({ ...RESERVATION_SESSION, customer_details: null })
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].email).toBe('held@example.com')
    expect(contactUpserts[0].purchaseCents).toBe(21000)
  })

  /** No address anywhere is not a contact — and must not throw. */
  it('records no contact when there is no address at all', async () => {
    docs.set('hosts/host-1/reservations/res-1', {
      ...RESERVATION,
      guestEmail: null,
    })
    await deliver({ ...RESERVATION_SESSION, customer_details: null })
    expect(contactUpserts).toHaveLength(0)
    expect(storedReservation().status).toBe('confirmed')
  })

  /**
   * Stripe delivers at least once and `purchaseCents` is a
   * `FieldValue.increment`, so a replay that reached it would inflate the
   * guest's lifetime value on every retry. The `pending` to `confirmed`
   * transition was always the guard but was a read-then-write, so two
   * concurrent deliveries could both observe `pending`. It now runs in a
   * transaction. Counting the side effects is the assertion — the reservation
   * document is a merge-set and looks identical either way.
   */
  it('absorbs a redelivered event without double-counting', async () => {
    await deliver(RESERVATION_SESSION)
    await deliver(RESERVATION_SESSION)

    expect(contactUpserts).toHaveLength(1)
    expect(notifications).toHaveLength(1)
    expect(sentEmails).toHaveLength(1)
    expect(meteredHosts).toEqual(['host-1'])
    expect(storedReservation().paidCents).toBe(21000)
  })

  /** A hold that is not pending is not this event's to confirm. */
  it('does nothing for a reservation that is already confirmed', async () => {
    docs.set('hosts/host-1/reservations/res-1', {
      ...RESERVATION,
      status: 'confirmed',
    })
    await deliver(RESERVATION_SESSION)
    expect(contactUpserts).toHaveLength(0)
    expect(notifications).toHaveLength(0)
  })

  /** A metadata reservationId pointing at nothing must not manufacture one. */
  it('does nothing when the reservation is missing', async () => {
    docs.delete('hosts/host-1/reservations/res-1')
    await deliver(RESERVATION_SESSION)
    expect(contactUpserts).toHaveLength(0)
    expect(notifications).toHaveLength(0)
    expect(storedReservation()).toBeUndefined()
  })

  /**
   * The guest confirmation is the other side effect hanging off the guard,
   * pinned so the transaction rewrite is covered end to end and still reads the
   * stay's own fields (nights, check-in) after they moved off the pre-read
   * snapshot and onto the value lifted inside the transaction.
   */
  it('still emails the guest the nights and the amount paid', async () => {
    await deliver(RESERVATION_SESSION)
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toBe('Paid@Example.com')
    expect(sentEmails[0].text).toContain('Nights: 7')
    expect(sentEmails[0].text).toContain('Paid today: $210.00')
  })

  it('never calls Stripe', async () => {
    await deliver(RESERVATION_SESSION)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
