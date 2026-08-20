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

/**
 * A gift-card code is never emailed unless the card exists (AGL-2161).
 *
 * The issuance write was `.set({…}).catch(() => undefined)` and control fell
 * straight through to the send. A failed write therefore shipped the buyer a
 * real-looking `GC-XXXXXXXXXXXX` for a document that does not exist, and
 * `meterHostEmail` billed the merchant for delivering it. Nothing anywhere
 * recorded that it had happened.
 *
 * The buyer discovers it at checkout, where `cart-checkout.ts` finds
 * `!fresh.exists`, places no hold and applies nothing — so the money was taken
 * for goods that cannot be redeemed, and the first person to learn of it is
 * the customer.
 *
 * AGL-2449 made the SPENDING side transactional (hold at checkout, settle in
 * the webhook, one document). This is the MINTING side catching up, and it is
 * deliberately the same mechanism seen from the other end rather than a second
 * one: a card that was never written is the same "card that isn't there" the
 * settlement's orphan note already describes.
 *
 * ## Why the assertions are shaped this way
 *
 * Every refusal is paired with the neighbouring success on the same session,
 * because a handler that issued nothing at all would satisfy a suite that only
 * proves the failure path — and issuing nothing is the more expensive bug, not
 * the safer one. Both directions were forced red on purpose.
 *
 * No Stripe boundary is exercised: the handler is handed the event object and
 * this path makes no outbound call. `global.fetch` is still replaced and
 * asserted unused, because localhost carries the LIVE secret key.
 */

import { NOTIFICATION_TYPE_LABELS } from '@aglyn/aglyn'
import { commerceBillingWebhookHandler } from './billing-webhook'

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** Paths whose `set` rejects, so a half-landed write can be modelled. */
const setFailures = new Set<string>()

function makeSnapshot(path: string): any {
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
      // PREFIX match: a gift-card code is an HMAC over the session, the line
      // and `Date.now()`, so a test cannot name the document it wants to fail.
      if ([...setFailures].some((prefix) => path.startsWith(prefix))) {
        throw Object.assign(new Error(`13 INTERNAL: write rejected ${path}`), {
          code: 13,
        })
      }
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
    update: async (value: Record<string, any>) => {
      docs.set(path, { ...(docs.get(path) ?? {}), ...value })
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
    get: async () => ({ docs: [], size: 0 }),
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
const meteredEmails: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const { updateExisting } = jest.requireActual(
    '@aglyn/tenant-data-admin/server/update-existing',
  )
  return {
    updateExisting,
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
    // `business` carries the `giftCards` entitlement, which the issuance
    // block re-checks as defence in depth (AGL-470).
    getOrgForHost: async () => ({
      orgId: 'org-1',
      org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
    }),
    meterHostEmail: async (hostId: string) => {
      meteredEmails.push(hostId)
    },
    notifyHostManagers: async (hostId: string, notification: any) => {
      notifications.push({ hostId, ...notification })
    },
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: async () => null,
    getPluginConfig: async () => ({}),
  }
})

const sentEmails: any[] = []
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => true,
  sendEmail: async (message: any) => {
    sentEmails.push(message)
  },
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/**
 * Nothing here coincides: the card value (3300), the charge (6600) and the
 * quantity (2) are distinct, so an assertion landing on the right number
 * cannot have reached for the nearest one.
 */
const CART_SESSION = {
  id: 'cs_gift_1',
  payment_status: 'paid',
  payment_intent: 'pi_gift_1',
  amount_total: 6600,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'commerce-cart',
    hostId: 'host-1',
    cartId: 'cart-1',
  },
}

async function deliver(object: any = CART_SESSION) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

/** Every gift-card document that landed, by code. */
const issuedCards = () =>
  [...docs.keys()].filter((path) =>
    path.startsWith('hosts/host-1/giftCards/'),
  )

/** Only the gift-card alerts; the order also raises a routine "New order". */
const giftCardAlerts = () =>
  notifications.filter((entry) => String(entry.title).includes('not issued'))

/** The codes actually put in front of the buyer. */
const emailedCodes = () =>
  sentEmails
    .filter((message) => message.context === 'gift card')
    .map((message) => /GC-[A-F0-9]+/.exec(String(message.text))?.[0] ?? null)

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  // A gift-card line is a DIGITAL line, so the order write signs a download
  // token on its way past. Unrelated to this suite, but it throws without a
  // secret and every assertion would read as a gift-card failure.
  process.env.TOKEN_SIGNING_SECRET = 'gift-card-issuance-spec-secret'
})

beforeEach(() => {
  docs.clear()
  setFailures.clear()
  notifications.length = 0
  sentEmails.length = 0
  meteredEmails.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Gift card',
    type: 'digital',
    giftCard: true,
    variants: [{ id: 'default', priceUsd: 33, inventory: null }],
  })
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'product-1', variantId: 'default', quantity: 2 }],
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('the happy path still issues (AGL-322)', () => {
  it('writes one card per unit and emails each code', async () => {
    await deliver()

    expect(issuedCards()).toHaveLength(2)
    expect(emailedCodes()).toHaveLength(2)
    // Every code the buyer was given resolves to a card that exists.
    for (const code of emailedCodes()) {
      expect(docs.has(`hosts/host-1/giftCards/${code}`)).toBe(true)
    }
    // And the card carries the value that was paid for it, in cents.
    const card = docs.get(`hosts/host-1/giftCards/${emailedCodes()[0]}`) as any
    expect(card.balanceCents).toBe(3300)
    expect(card.initialCents).toBe(3300)
    expect(giftCardAlerts()).toHaveLength(0)
  })

  it('meters the send, because the email IS the purchased goods', async () => {
    await deliver()
    // Every email that went out was metered — asserted as an identity rather
    // than a literal count, so the order receipt riding along cannot make the
    // number right for the wrong reason.
    expect(meteredEmails).toHaveLength(sentEmails.length)
    expect(emailedCodes()).toHaveLength(2)
  })

  it('reached no Stripe endpoint', async () => {
    await deliver()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a failed issuance write is never emailed (AGL-2161)', () => {
  beforeEach(() => {
    // Codes are unpredictable (HMAC over session id, product, unit and
    // `Date.now()`), so the double is told to reject by prefix.
    setFailures.add('hosts/host-1/giftCards')
  })

  it('sends NO code when the card could not be written', async () => {
    await deliver()

    expect(issuedCards()).toHaveLength(0)
    // THE BUG: this used to be 2. A code in the buyer's inbox for a card that
    // does not exist is worse than no code at all — it is discovered by the
    // customer, at checkout, after they have paid.
    expect(emailedCodes()).toHaveLength(0)
  })

  it('does not meter an email it did not send', async () => {
    await deliver()
    // Two gift-card sends' worth of metering is exactly what the merchant used
    // to be billed for delivering codes that redeemed against nothing.
    expect(meteredEmails).toHaveLength(sentEmails.length)
    expect(emailedCodes()).toHaveLength(0)
  })

  it('TELLS THE MERCHANT, so the buyer is not the one who finds out', async () => {
    await deliver()

    // One per unissued unit, so the merchant knows how many to hand-issue.
    expect(giftCardAlerts()).toHaveLength(2)
    expect(giftCardAlerts()[0].hostId).toBe('host-1')
    // The amount and the order, because the merchant has to hand-issue it.
    expect(giftCardAlerts()[0].body).toContain('$33.00')
    expect(giftCardAlerts()[0].body).toContain('cs_gift_1')
    expect(giftCardAlerts()[0].link).toBe('/host-1/products')
  })

  it('carries a notification TYPE the console knows how to render', async () => {
    // A type outside the union renders as a blank row, which is the same as
    // not telling anyone.
    await deliver()
    expect(Object.keys(NOTIFICATION_TYPE_LABELS)).toContain(
      giftCardAlerts()[0].type,
    )
  })

  it('does not abandon the rest of the order', async () => {
    // The order is still recorded — the buyer paid, and a gift-card write
    // failing must not lose the transaction it was part of.
    await deliver()
    expect(docs.has('hosts/host-1/orders/cs_gift_1')).toBe(true)
  })
})

describe('one card failing does not take the others with it', () => {
  it('POSITIVE CONTROL: an unrelated write failure still issues both', async () => {
    // Proves the refusal above is caused by the CARD write and not by any
    // failure anywhere in the handler — otherwise the suite would pass
    // against a handler that stopped issuing for an unrelated reason.
    setFailures.add('hosts/host-1/somewhere-else')
    await deliver()

    expect(issuedCards()).toHaveLength(2)
    expect(emailedCodes()).toHaveLength(2)
    expect(giftCardAlerts()).toHaveLength(0)
  })
})
