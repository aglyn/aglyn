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
import { supplierRoutingToken } from './supplier-routing'

/**
 * Dropship suppliers are told about CART orders (AGL-3773).
 *
 * THE DEFECT. Only the Buy-button path (`commerce-order`) routed a paid order
 * to its product's supplier. The cart path stamped each line's `supplierId`
 * and stopped there, so a supplier assigned to a product never heard about an
 * order placed through the cart — no email, no queued webhook, no tracking
 * link — while the order sat paid and unshipped.
 *
 * FORCED RED against the old code: no `supplierDeliveries` row, no email to
 * the supplier, and no `routed` entry on the order's timeline.
 *
 * Driven through the real handler with the same in-memory Firestore as
 * `billing-webhook-dropship-outbox.spec.ts`, so the `created` guard, the
 * entitlement check and the outbox's `create()` are the production ones.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore. Same double as `billing-webhook-redemption.spec.ts`,
// plus `create()` — the primitive the enqueue uses for idempotency, and one
// whose semantics differ from BOTH of the two the redemption spec models.
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** gRPC `Status.NOT_FOUND` — what Firestore's "no entity to update" carries. */
const GRPC_NOT_FOUND = 5
/** gRPC `Status.ALREADY_EXISTS` — what `create()` on a live path carries. */
const GRPC_ALREADY_EXISTS = 6

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveValue(previous: unknown, next: unknown): unknown {
  if (isPlainObject(next) && '__increment' in next) {
    return Number(previous ?? 0) + Number(next.__increment)
  }
  if (isPlainObject(next) && '__arrayUnion' in next) {
    return [...((previous as unknown[]) ?? []), next.__arrayUnion]
  }
  if (isPlainObject(next) && isPlainObject(previous)) {
    return mergeInto(previous, next)
  }
  return next
}

function mergeInto(
  previous: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const merged = { ...previous }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = resolveValue(previous[key], value)
  }
  return merged
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
        options?.merge
          ? mergeInto(docs.get(path) ?? {}, value)
          : mergeInto({}, value),
      )
    },
    // `create()` REFUSES an existing document rather than overwriting it —
    // that refusal is the whole reason the enqueue uses it, so a double that
    // aliased it to `set()` would let a redelivery reset a retry that is
    // already part-way through its backoff and still report green.
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        throw Object.assign(
          new Error(`6 ALREADY_EXISTS: Document already exists: ${path}`),
          { code: GRPC_ALREADY_EXISTS },
        )
      }
      docs.set(path, mergeInto({}, value))
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        throw Object.assign(
          new Error(`5 NOT_FOUND: No document to update: ${path}`),
          { code: GRPC_NOT_FOUND },
        )
      }
      docs.set(path, mergeInto(docs.get(path) as Record<string, any>, value))
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    path,
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
      update: (ref: any, value: any) => {
        void ref.update(value)
      },
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const { updateExisting } = jest.requireActual(
    '@aglyn/tenant-data-admin/server/update-existing',
  )
  return {
    updateExisting,
    /*
     * The site's own sending identity, which every tenant send now resolves.
     *
     * A VERIFIED one, because this spec is about the mail its subject sends
     * rather than about the identity boundary — a refusing stub would turn it
     * into an assertion that no mail was sent. The boundary is proved in
     * `platform-sending-domain.spec.ts`, `host-sending-domain.spec.ts` and
     * `email-audience-coverage.spec.ts`.
     *
     * The domain is the SITE's, never `aglyn.com`, so an assertion on a From:
     * address here cannot pass against a platform fallback.
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
          arrayUnion: (value: any) => ({ __arrayUnion: value }),
          increment: (value: number) => ({ __increment: value }),
        },
      },
    },
    findUserByUidAcrossPools: async () => null,
    // Pro and above — `dropshipRouting` is the gate the block opens with, and
    // the REAL `checkEntitlement` decides it, so a plan that did not carry the
    // feature would make every case below vacuously green.
    getOrgForHost: async () => ({
      org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
    }),
    meterHostEmail: async () => undefined,
    notifyHostManagers: async () => undefined,
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: async () => null,
  }
})

const sentEmails: any[] = []

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async (options: any) => {
    sentEmails.push(options)
  },
}))

let fetchMock: jest.Mock

const CART_SESSION = {
  id: 'cs_cart_dropship_1',
  payment_status: 'paid',
  payment_intent: 'pi_cart_dropship_1',
  amount_total: 12300,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  shipping_details: {
    name: 'Ada Cartwright',
    address: {
      line1: '12 Analytical Way',
      line2: null,
      city: 'Springfield',
      state: 'IL',
      postal_code: '62701',
      country: 'US',
    },
  },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'commerce-cart',
    hostId: 'host-1',
    cartId: 'cart-1',
    feeCents: '271',
  },
}

async function deliver(object: any = CART_SESSION) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

function queued(): Array<[string, any]> {
  return [...docs.entries()].filter(([path]) =>
    path.startsWith('supplierDeliveries/'),
  )
}

const order = () => docs.get('hosts/host-1/orders/cs_cart_dropship_1') as any
const routed = () =>
  ((order()?.timeline as any[]) ?? []).filter((event) => event.event === 'routed')

beforeAll(() => {
  process.env.TOKEN_SIGNING_SECRET = 'test-token-signing-secret'
})

beforeEach(() => {
  docs.clear()
  sentEmails.length = 0
  autoIdCounter = 0
  fetchMock = jest.fn(() => new Promise<never>(() => undefined))
  ;(global as any).fetch = fetchMock
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    supplierId: 'supplier-1',
    variants: [{ id: 'large', priceUsd: 83, sku: 'BOX-L', options: { Size: 'Large' } }],
  })
  docs.set('hosts/host-1/products/product-2', {
    name: 'Gift wrap',
    type: 'physical',
    supplierId: 'supplier-2',
    variants: [{ id: 'default', priceUsd: 20 }],
  })
  docs.set('hosts/host-1/products/product-3', {
    name: 'Sticker',
    type: 'physical',
    variants: [{ id: 'default', priceUsd: 20 }],
  })
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [
      { productId: 'product-1', variantId: 'large', quantity: 2 },
      { productId: 'product-2', quantity: 1 },
      { productId: 'product-3', quantity: 1 },
    ],
  })
  docs.set('hosts/host-1/suppliers/supplier-1', {
    name: 'Northwind Fulfillment',
    email: 'orders@northwind.example',
    webhookUrl: 'https://supplier.example.com/orders',
    webhookSecret: 'supplier-shared-secret',
  })
  docs.set('hosts/host-1/suppliers/supplier-2', {
    name: 'Wrap Co',
    email: 'hello@wrap.example',
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a paid cart order reaches its dropship suppliers (AGL-3773)', () => {
  it('records the order with each line\'s supplier', async () => {
    await deliver()
    expect(order().lineItems.map((line: any) => line.supplierId ?? null)).toEqual([
      'supplier-1',
      'supplier-2',
      null,
    ])
  })

  it('queues the webhook for a supplier that has one, with only its own lines', async () => {
    await deliver()
    const entries = queued()
    expect(entries.map(([path]) => path)).toEqual([
      'supplierDeliveries/host-1__cs_cart_dropship_1__supplier-1',
    ])
    const payload = JSON.parse(entries[0][1].body)
    expect(payload.lines).toEqual([
      {
        productId: 'product-1',
        productName: 'Monthly box',
        variantLabel: 'Large',
        sku: 'BOX-L',
        quantity: 2,
      },
    ])
    expect(payload.shippingAddress).toMatchObject({ line1: '12 Analytical Way', postalCode: '62701' })
    expect(payload.updateUrl).toBe(
      'https://acme.aglyn.app/api/commerce/supplier-update?hostId=host-1' +
        `&orderId=cs_cart_dropship_1&token=${supplierRoutingToken('host-1', 'cs_cart_dropship_1', 'supplier-1')}`,
    )
  })

  it('makes no outbound supplier request from the response path', async () => {
    await deliver()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('emails each supplier its own lines and its own tracking link', async () => {
    await deliver()
    const northwind = sentEmails.find((mail) => mail.to === 'orders@northwind.example')
    const wrap = sentEmails.find((mail) => mail.to === 'hello@wrap.example')
    expect(northwind.subject).toBe('New order to fulfill for Acme Boxes: Monthly box')
    expect(northwind.text).toContain('- 2× Monthly box (Large), SKU BOX-L')
    expect(northwind.text).not.toContain('Gift wrap')
    expect(northwind.text).toContain(
      'Ship to: Ada Cartwright, 12 Analytical Way, Springfield, IL 62701, US',
    )
    expect(wrap.text).toContain('- 1× Gift wrap')
    expect(wrap.text).not.toContain('Monthly box')
    expect(wrap.text).toContain(
      `token=${supplierRoutingToken('host-1', 'cs_cart_dropship_1', 'supplier-2')}`,
    )
    expect(sentEmails.filter((mail) => mail.context === 'dropship supplier notice')).toHaveLength(2)
  })

  it('stamps one routed entry per supplier on the timeline', async () => {
    await deliver()
    expect(routed().map((event) => event.detail)).toEqual([
      'Sent 1 line to supplier Northwind Fulfillment',
      'Sent 1 line to supplier Wrap Co',
    ])
  })

  it('tells nobody twice when Stripe redelivers the event', async () => {
    await deliver()
    const [path, first] = queued()[0]
    docs.set(path, { ...first, attempts: 3 })
    await deliver()
    expect(queued()).toHaveLength(1)
    expect(docs.get(path)?.attempts).toBe(3)
    expect(sentEmails.filter((mail) => mail.context === 'dropship supplier notice')).toHaveLength(2)
    expect(routed()).toHaveLength(2)
  })

  it('skips a supplier that was removed, and still tells the others', async () => {
    docs.delete('hosts/host-1/suppliers/supplier-1')
    await deliver()
    expect(queued()).toHaveLength(0)
    expect(sentEmails.some((mail) => mail.to === 'hello@wrap.example')).toBe(true)
    expect(routed()).toHaveLength(1)
  })

  it('routes nothing on an order with no supplier lines', async () => {
    docs.set('hosts/host-1/carts/cart-1', {
      lines: [{ productId: 'product-3', quantity: 1 }],
    })
    await deliver()
    expect(queued()).toHaveLength(0)
    expect(sentEmails.some((mail) => mail.context === 'dropship supplier notice')).toBe(false)
    expect(order()).toBeDefined()
  })
})
