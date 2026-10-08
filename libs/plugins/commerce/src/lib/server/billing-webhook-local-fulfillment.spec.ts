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
import { standInRecordSystem } from '../testing/stand-in-record-system'
import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * A paid pickup or local delivery cart becomes a routed order (AGL-3624):
 * the order carries the method, the location or zone and window, and the
 * queue fields; the stock comes off the pickup location's bucket; the order
 * never goes to a shipping tool; and an address typed at payment outside
 * every zone is flagged to the store. Harness from
 * `billing-webhook-low-stock.spec.ts`; no Stripe boundary is reached.
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


const session = (metadata: Record<string, string>, extra: Record<string, any> = {}) => ({
  id: 'cs_local',
  payment_status: 'paid',
  payment_intent: 'pi_local',
  amount_total: 3000,
  customer_details: {
    email: 'buyer@example.com',
    name: 'Ada',
    address: { line1: '9 Billing Rd', postal_code: '11111', country: 'US' },
  },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: { type: 'commerce-cart', hostId: 'host-1', cartId: 'cart-1', feeCents: '90', ...metadata },
  ...extra,
})

async function deliver(object: any) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  standInRecordSystem({ reset: false })
  autoIdCounter = 0
  docs.set('hosts/host-1', { displayName: 'Bakery' })
  docs.set('hosts/host-1/products/bread', {
    name: 'Bread',
    type: 'physical',
    variants: [{ id: 'loaf', priceUsd: 15, inventory: 10, inventoryByLocation: { main: 4, back: 6 } }],
  })
  docs.set('hosts/host-1/carts/cart-1', { lines: [{ productId: 'bread', variantId: 'loaf', quantity: 2 }] })
  docs.set('hosts/host-1/locations/main', {
    name: 'Main Street',
    address: '1 Main St',
    pickup: { enabled: true, hours: 'Mo-Fr 09:00-17:00' },
  })
  docs.set('hosts/host-1/settings/store', {
    localDelivery: {
      enabled: true,
      country: 'US',
      locationId: 'main',
      zones: [{ id: 'near', name: 'Downtown', kind: 'postcode', postcodes: ['627*'], feeCents: 500 }],
      windows: 'Mo-Su 09:00-12:00',
    },
  })
})

describe('a paid pickup cart (AGL-3624)', () => {
  it('records the pickup, routes it, and takes the stock off that location', async () => {
    await deliver(session({ fulfillment: 'pickup', pickupLocationId: 'main', orderTextPhone: '+12175550100' }))
    const order = docs.get('hosts/host-1/orders/cs_local') as any
    expect(order).toMatchObject({
      fulfillmentMethod: 'pickup',
      locationId: 'main',
      customerPhone: '+12175550100',
      fulfillmentKey: 'pickup_preparing',
      fulfillmentLocationId: 'main',
      requiresShipping: false,
      pickup: { locationId: 'main', locationName: 'Main Street', address: '1 Main St', status: 'preparing' },
    })
    // The billing address Stripe falls back to is not where a pickup goes.
    expect(order.shippingAddress).toBeUndefined()
    const variant = (docs.get('hosts/host-1/products/bread') as any).variants[0]
    expect(variant.inventoryByLocation).toEqual({ main: 2, back: 6 })
    expect(variant.inventory).toBe(8)
    const ledger = [...docs.entries()]
      .filter(([path]) => path.startsWith('hosts/host-1/inventoryAdjustments/'))
      .map(([, row]) => row)
    expect(ledger).toEqual([expect.objectContaining({ delta: -2, locationId: 'main', orderId: 'cs_local' })])
  })

  it('leaves a shipped cart exactly as it was', async () => {
    await deliver(
      session({}, { shipping_details: { name: 'Ada', address: { line1: '2 Ship St', postal_code: '62704', country: 'US' } } }),
    )
    const order = docs.get('hosts/host-1/orders/cs_local') as any
    expect(order.fulfillmentMethod).toBeUndefined()
    expect(order.fulfillmentKey).toBeUndefined()
    expect(order.requiresShipping).toBe(true)
    expect(order.shippingAddress?.line1).toBe('2 Ship St')
    expect((docs.get('hosts/host-1/products/bread') as any).variants[0].inventory).toBe(8)
  })
})

describe('a paid local delivery cart (AGL-3624)', () => {
  const metadata = {
    fulfillment: 'local_delivery',
    deliveryZoneId: 'near',
    deliveryWindowStartMs: String(Date.UTC(2026, 9, 13, 14, 0)),
    deliveryWindowEndMs: String(Date.UTC(2026, 9, 13, 17, 0)),
    deliveryPostalCode: '62704',
    deliveryFeeCents: '500',
    deliveryLocationId: 'main',
  }

  it('records the zone, the window and the address, due at the window', async () => {
    await deliver(
      session(metadata, { shipping_details: { name: 'Ada', address: { line1: '2 Elm St', postal_code: '62704', country: 'US' } } }),
    )
    const order = docs.get('hosts/host-1/orders/cs_local') as any
    expect(order).toMatchObject({
      fulfillmentMethod: 'local_delivery',
      locationId: 'main',
      fulfillmentKey: 'delivery_scheduled',
      fulfillmentDueMs: Date.UTC(2026, 9, 13, 14, 0),
      requiresShipping: false,
      shippingAddress: { line1: '2 Elm St', postalCode: '62704' },
      localDelivery: { zoneId: 'near', zoneName: 'Downtown', feeCents: 500, status: 'scheduled' },
    })
    expect(order.localDelivery.addressOutsideZone).toBeUndefined()
    expect(notifications.some((note) => /delivery address/.test(note.title))).toBe(false)
  })

  it('flags an address typed at payment outside every zone, and tells the store', async () => {
    await deliver(
      session(metadata, { shipping_details: { name: 'Ada', address: { line1: '5 Far Rd', postal_code: '90210', country: 'US' } } }),
    )
    const order = docs.get('hosts/host-1/orders/cs_local') as any
    expect(order.localDelivery.addressOutsideZone).toBe(true)
    expect(notifications.filter((note) => /Check the delivery address/.test(note.title))).toHaveLength(1)
  })
})
