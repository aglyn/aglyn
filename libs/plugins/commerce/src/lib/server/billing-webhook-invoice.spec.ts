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

import type { PluginContactCaptureRequest } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { standInRecordSystem } from '../testing/stand-in-record-system'
import { withOrderListFields } from '../model'
import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * A draft order paid through its invoice's lasting pay link (AGL-4099),
 * through the `commerce-draft` branch it always completed through: the draft
 * flips to paid with its list fields restated from the document (never
 * stamped a second time), stock moves for catalog lines only, and a payment
 * the invoice cannot take is recorded on the order and told, never fulfilled.
 *
 * Asserted on what landed in the in-memory Firestore, the notifications and
 * the contact captures; the handler returns nothing. `fetch` is replaced and
 * asserted unused: this branch makes no outbound call.
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
let contactUpserts: PluginContactCaptureRequest[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
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
  meterHostEmail: async () => undefined,
  notifyHostManagers: async (hostId: string, notification: any) => {
    notifications.push({ hostId, ...notification })
  },
  renderHostEmailWithTokens: async () => null,
  // A promotion's redemption, applied to a discount that exists.
  updateExisting: async (ref: any, data: Record<string, unknown>) => {
    if (!docs.has(ref.path)) return false
    docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
    return true
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// The draft order and the session its invoice's link opened
// ---------------------------------------------------------------------------

/** Two canopies (tracked stock) and setup typed for the job, composed on day one. */
const DRAFT_ORDER = withOrderListFields('d-1', {
  number: 2001,
  status: 'pending',
  channel: 'draft',
  lineItems: [
    { productId: 'canopy', variantId: 'red', name: 'Canopy 10x10', productType: 'physical', quantity: 2, unitAmountCents: 120_000 },
    { productId: '', custom: true, name: 'Setup', sku: 'SETUP', productType: 'service', quantity: 1, unitAmountCents: 30_000 },
  ],
  totals: { itemsCents: 270_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 270_000 },
  taxMode: 'none',
  customerEmail: 'jordan@example.com',
  timeline: [{ atMs: 1_000, event: 'draft', detail: 'Draft created by owner@example.com' }],
  createdAtMs: 1_000,
  checkoutSessionId: 'cs_invoice_1',
  draftShipping: { countries: ['US'], options: [{ rateId: 'standard', name: 'Standard', amountCents: 1_500 }] },
} as any)

const INVOICE_SESSION = {
  id: 'cs_invoice_1',
  payment_status: 'paid',
  payment_intent: 'pi_invoice_1',
  amount_total: 271_500,
  total_details: { amount_shipping: 1_500, amount_tax: 0 },
  customer_details: { email: 'jordan@example.com', name: 'Jordan Lee' },
  shipping_details: { name: 'Jordan Lee', address: { line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78702', country: 'US' } },
  metadata: {
    type: 'commerce-draft',
    hostId: 'host-1',
    orderId: 'd-1',
    payLinkVersion: '1',
    feeCents: '8100',
  },
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await commerceBillingWebhookHandler({ type, object, requestHost: 'acme.aglyn.app' } as any)
}

const stored = () => docs.get('hosts/host-1/orders/d-1') as any
const stock = (productId: string, variantId: string) =>
  (docs.get(`hosts/host-1/products/${productId}`) as any).variants.find((variant: any) => variant.id === variantId).inventory

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  contactUpserts = standInRecordSystem({ reset: false })
  autoIdCounter = 0
  fetchMock.mockClear()
  docs.set('hosts/host-1', { displayName: 'Acme Tents' })
  docs.set('hosts/host-1/products/canopy', {
    name: 'Canopy 10x10',
    type: 'physical',
    variants: [{ id: 'red', priceUsd: 1_200, inventory: 10 }],
  })
  docs.set('hosts/host-1/orders/d-1', JSON.parse(JSON.stringify(DRAFT_ORDER)))
})

// ---------------------------------------------------------------------------

describe('a draft order paid through its invoice’s pay link', () => {
  it('flips to paid on the same document, its list fields restated rather than stamped again', async () => {
    await deliver(INVOICE_SESSION)
    const order = stored()
    expect(order).toMatchObject({
      status: 'paid',
      channel: 'draft',
      number: 2001,
      customerEmail: 'jordan@example.com',
      customerEmailLower: 'jordan@example.com',
      paymentIntentId: 'pi_invoice_1',
      shippingAddress: { line1: '1 Main St', postalCode: '78702', country: 'US' },
      totals: { itemsCents: 270_000, shippingCents: 1_500, totalCents: 271_500 },
      taxMode: 'none',
    })
    // The day it was composed stays its day: no paid-time restamp, as a quote gets.
    expect(order.createdAtMs).toBe(1_000)
    expect(order.createdAt).toBeUndefined()
    expect(order.searchTokens).toEqual(DRAFT_ORDER.searchTokens)
    expect(order.timeline.map((entry: any) => entry.event)).toEqual(['draft', 'paid'])
  })

  it('moves stock for the catalog line only, never for a typed line', async () => {
    await deliver(INVOICE_SESSION)
    expect(stock('canopy', 'red')).toBe(8)
    const ledger = [...docs.entries()].filter(([path]) => path.startsWith('hosts/host-1/inventoryAdjustments/'))
    expect(ledger.map(([, row]) => row.productId)).toEqual(['canopy'])
    expect(JSON.stringify(ledger)).not.toContain('SETUP')
  })

  it('tells the business it was the invoice that was paid, and keeps the payer as a contact', async () => {
    await deliver(INVOICE_SESSION)
    expect(notifications.map((entry) => entry.title)).toEqual(['Invoice paid — #2001'])
    expect(notifications[0].body).toContain('paid the invoice for draft order #2001')
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0]).toMatchObject({ purchaseCents: 271_500, interaction: { source: 'order', refId: 'd-1' } })
  })

  it('does nothing more when Stripe sends the same payment again', async () => {
    await deliver(INVOICE_SESSION)
    const first = JSON.stringify(stored())
    await deliver(INVOICE_SESSION)
    expect(JSON.stringify(stored())).toBe(first)
    expect(stock('canopy', 'red')).toBe(8)
    expect(notifications).toHaveLength(1)
  })

  it('records a second payment on the order and tells the business, without a second sale', async () => {
    await deliver(INVOICE_SESSION)
    await deliver({ ...INVOICE_SESSION, id: 'cs_invoice_2', payment_intent: 'pi_invoice_2' })
    const order = stored()
    expect(order.paymentIntentId).toBe('pi_invoice_1')
    expect(order.payLink.unmatchedPayments).toEqual([
      expect.objectContaining({ sessionId: 'cs_invoice_2', paymentIntentId: 'pi_invoice_2', amountCents: 271_500, reason: 'already-paid' }),
    ])
    expect(order.timeline.at(-1)).toMatchObject({ event: 'invoice-payment-unmatched' })
    expect(order.timeline.at(-1).detail).toContain('after this invoice was paid')
    expect(stock('canopy', 'red')).toBe(8)
    expect(notifications.map((entry) => entry.title)).toEqual(['Invoice paid — #2001', 'Invoice #2001 was paid twice'])
    // …once, however often Stripe sends it.
    await deliver({ ...INVOICE_SESSION, id: 'cs_invoice_2', payment_intent: 'pi_invoice_2' })
    expect(stored().payLink.unmatchedPayments).toHaveLength(1)
    expect(notifications).toHaveLength(2)
  })

  it('takes no payment made through a link the business replaced, and says so', async () => {
    docs.set('hosts/host-1/orders/d-1', { ...JSON.parse(JSON.stringify(DRAFT_ORDER)), payLink: { version: 2 } })
    await deliver(INVOICE_SESSION)
    const order = stored()
    expect(order.status).toBe('pending')
    expect(order.payLink).toEqual({ version: 2, unmatchedPayments: [expect.objectContaining({ sessionId: 'cs_invoice_1', reason: 'superseded' })] })
    expect(stock('canopy', 'red')).toBe(10)
    expect(notifications.map((entry) => entry.title)).toEqual(['A replaced link for Invoice #2001 was paid'])
    expect(contactUpserts).toHaveLength(0)
  })

  it('keeps a canceled draft’s paid-after-cancel record, as before', async () => {
    docs.set('hosts/host-1/orders/d-1', { ...JSON.parse(JSON.stringify(DRAFT_ORDER)), status: 'cancelled' })
    await deliver(INVOICE_SESSION)
    expect(stored()).toMatchObject({ status: 'cancelled', paidAfterCancel: true })
    expect(stored().payLink).toBeUndefined()
    expect(notifications.map((entry) => entry.title)).toEqual(['A canceled order was paid'])
  })

  it('counts the promotion the draft was priced with, once', async () => {
    docs.set('hosts/host-1/discounts/spring', { code: 'SPRING', redemptions: 3 })
    await deliver({ ...INVOICE_SESSION, metadata: { ...INVOICE_SESSION.metadata, discountId: 'spring' } })
    await deliver({ ...INVOICE_SESSION, metadata: { ...INVOICE_SESSION.metadata, discountId: 'spring' } })
    expect((docs.get('hosts/host-1/discounts/spring') as any).redemptions).toEqual({ __increment: 1 })
  })

  it('never calls Stripe', async () => {
    await deliver(INVOICE_SESSION)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
