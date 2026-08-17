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
 * The low-stock crossing alert on the cart and buy-now branches (AGL-1826).
 *
 * THE DEFECT. The AGL-281 crossing check — low after the decrement, not low
 * before, one manager nudge per threshold breach — lived inline on the buy-now
 * branch and nowhere else, so whether a merchant was told they were running
 * out depended on which door the sale came through: the single-product
 * storefront button alerted while the cart, which sells MORE units per order,
 * crossed the same threshold silently. The shared `alertLowStockCrossing` now
 * sits beside every decrement; the buy-now cases here pin that extraction as
 * a pure move (they hold on both sides), and the cart cases are the fix.
 *
 * The draft-link and POS card sites live in `billing-webhook-draft.spec.ts`,
 * and the register's own cash loop in `pos-order.spec.ts` — one file per
 * harness, same shape as the AGL-1767 suite this one's fakes follow.
 *
 * No Stripe boundary is exercised: the handler is handed the event object and
 * the paths under test make no outbound call. `global.fetch` is still replaced
 * and asserted unused, because localhost carries the LIVE secret key.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** gRPC `Status.NOT_FOUND` — what Firestore's "no entity to update" carries. */
const GRPC_NOT_FOUND = 5

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
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        throw Object.assign(
          new Error(`5 NOT_FOUND: No document to update: ${path}`),
          { code: GRPC_NOT_FOUND },
        )
      }
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

jest.mock('@aglyn/tenant-data-admin', () => {
  // The real `updateExisting` (AGL-1767's pattern): the cart branch closes its
  // checkout doc through it, and a stub would have to reproduce the NOT_FOUND
  // discrimination anyway. Taken from the module's own path rather than the
  // barrel, which pulls Next's server internals into a jsdom worker.
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
    getOrgForHost: async () => ({
      org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
    }),
    meterHostEmail: async () => undefined,
    notifyHostManagers: async (hostId: string, notification: any) => {
      notifications.push({ hostId, ...notification })
    },
    upsertHostContact: async (options: any) => {
      contactUpserts.push(options)
    },
    renderHostEmailWithTokens: async () => null,
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// The sessions
// ---------------------------------------------------------------------------

/**
 * Three $15.00 boxes: stock 10, threshold 8, so the sale crosses to 7. The
 * mug's numbers (5, 4, 2) and the tote's (20, 5, 1) are all distinct from the
 * box's, so no assertion can land right by reaching for the nearest figure.
 */
const CART_SESSION = {
  id: 'cs_cart_low',
  payment_status: 'paid',
  payment_intent: 'pi_cart_low',
  amount_total: 4500,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'commerce-cart',
    hostId: 'host-1',
    cartId: 'cart-1',
    feeCents: '146',
  },
}

const BUY_NOW_SESSION = {
  id: 'cs_buynow_low',
  payment_status: 'paid',
  payment_intent: 'pi_buynow_low',
  amount_total: 4500,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'commerce-order',
    hostId: 'host-1',
    productId: 'product-1',
    variantId: 'large',
    quantity: '3',
    feeCents: '44',
  },
}

async function deliver(object: any) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

const lowStockAlerts = () =>
  notifications.filter(
    (notification) => notification.type === 'content.lowStock',
  )

/** product-1 at 10 with the given threshold (absent when undefined). */
function trackBox(lowStockThreshold: number | undefined) {
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    ...(lowStockThreshold != null ? { lowStockThreshold } : {}),
    variants: [{ id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10 }],
  })
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  contactUpserts.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  trackBox(8)
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'product-1', variantId: 'large', quantity: 3 }],
  })
})

// ---------------------------------------------------------------------------

describe('the cart crossing alert (AGL-1826)', () => {
  /**
   * THE DEFECT: before the fix this array was empty on the exact decrement
   * (10 - 3 = 7, at the threshold of 8) that alerts from the buy-now button, and the count
   * still moved — the merchant's first warning was an oversell.
   */
  it('alerts when a cart sale crosses the threshold', async () => {
    await deliver(CART_SESSION)
    expect(lowStockAlerts()).toEqual([
      {
        hostId: 'host-1',
        type: 'content.lowStock',
        title: 'Low stock — Monthly box',
        body: '7 left across tracked variants',
        link: '/host-1/products',
      },
    ])
    // The decrement itself is AGL-281's, untouched by the alert.
    expect(
      (docs.get('hosts/host-1/products/product-1') as any).variants[0]
        .inventory,
    ).toBe(7)
  })

  /**
   * A multi-line basket nudges once per PRODUCT that breached — the filing's
   * open question, decided as the per-crossing semantics every site shares:
   * the box and the mug cross, the tote does not, so exactly two alerts.
   */
  it('nudges once per product that breached', async () => {
    docs.set('hosts/host-1/products/product-2', {
      name: 'Mug',
      type: 'physical',
      lowStockThreshold: 4,
      variants: [{ id: 'default', priceUsd: 9, inventory: 5 }],
    })
    docs.set('hosts/host-1/products/product-3', {
      name: 'Tote',
      type: 'physical',
      lowStockThreshold: 5,
      variants: [{ id: 'default', priceUsd: 11, inventory: 20 }],
    })
    docs.set('hosts/host-1/carts/cart-1', {
      lines: [
        { productId: 'product-1', variantId: 'large', quantity: 3 },
        { productId: 'product-2', quantity: 2 },
        { productId: 'product-3', quantity: 1 },
      ],
    })
    await deliver(CART_SESSION)
    expect(lowStockAlerts().map((alert) => alert.title).sort()).toEqual([
      'Low stock — Monthly box',
      'Low stock — Mug',
    ])
    expect(
      lowStockAlerts().find((alert) => alert.title === 'Low stock — Mug')
        ?.body,
    ).toBe('3 left across tracked variants')
  })

  /** The `created` transaction bounds the alert as it bounds the decrement. */
  it('alerts once on a redelivered cart event', async () => {
    await deliver(CART_SESSION)
    await deliver(CART_SESSION)
    expect(lowStockAlerts()).toHaveLength(1)
  })

  /**
   * One nudge per breach, not one per order after it — the buy-now dedupe,
   * preserved verbatim. Holds either side of the fix.
   */
  it('does not re-alert a product already below its threshold', async () => {
    trackBox(20)
    await deliver(CART_SESSION)
    expect(lowStockAlerts()).toHaveLength(0)
  })

  /** No threshold configured means no alert, ever. Holds either side. */
  it('does not alert a product with no threshold', async () => {
    trackBox(undefined)
    await deliver(CART_SESSION)
    expect(lowStockAlerts()).toHaveLength(0)
  })
})

describe('the buy-now crossing alert (AGL-1826 pins)', () => {
  /**
   * The branch the check was extracted FROM: the same sale that alerted
   * before the refactor alerts after it, field for field. Holds on both
   * sides — this is the pure-move pin.
   */
  it('still alerts on the crossing buy-now sale', async () => {
    await deliver(BUY_NOW_SESSION)
    expect(lowStockAlerts()).toEqual([
      {
        hostId: 'host-1',
        type: 'content.lowStock',
        title: 'Low stock — Monthly box',
        body: '7 left across tracked variants',
        link: '/host-1/products',
      },
    ])
    expect(
      (docs.get('hosts/host-1/products/product-1') as any).variants[0]
        .inventory,
    ).toBe(7)
  })

  /** And its dedupe is unchanged: already low fires nothing. */
  it('still does not re-alert an already-low product', async () => {
    trackBox(20)
    await deliver(BUY_NOW_SESSION)
    expect(lowStockAlerts()).toHaveLength(0)
  })

  /** The `created` guard still bounds it on redelivery. */
  it('still alerts once on a redelivered buy-now event', async () => {
    await deliver(BUY_NOW_SESSION)
    await deliver(BUY_NOW_SESSION)
    expect(lowStockAlerts()).toHaveLength(1)
  })
})

/** localhost carries the LIVE Stripe key: no path here may reach out. */
it('makes no outbound request', async () => {
  await deliver(CART_SESSION)
  await deliver(BUY_NOW_SESSION)
  expect(fetchMock).not.toHaveBeenCalled()
})
