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
 * The dropship supplier POST survives the webhook returning (AGL-2473).
 *
 * THE DEFECT. The routing block was `void (async () => { … })()` — a floating
 * promise that read the org, the product and the supplier, wrote the callback
 * token, and then `await fetch(supplier.webhookUrl, …)` against an endpoint the
 * MERCHANT configured, on a host Aglyn does not run. Vercel freezes the
 * container the moment the response is written, so a supplier that is slow or
 * down is a supplier that is never told: the order is paid, the buyer is
 * thanked, and nothing anywhere records that a notification is owed. It is
 * discovered when the customer asks where their parcel is.
 *
 * The experiment is the real failure mode rather than a race. `fetch` here
 * NEVER SETTLES, which is exactly the case the freeze cuts off, so the red is
 * deterministic instead of depending on which microtask wins. Once the handler
 * has returned, the only durable evidence that can exist is a Firestore
 * document — so that is what these assert on, keyed by path, and "nothing was
 * written" is a real absence rather than a return value the handler does not
 * produce.
 *
 * FORCED RED against the old code: `supplierDeliveries` is empty (the POST is
 * in flight and unrecoverable), and `fetchMock` has been called from inside the
 * response path.
 *
 * The second property is the one that keeps the naive fix out. AGL-2161
 * declined to simply `await` this block because a supplier timing out would
 * push the handler past Stripe's window, Stripe would redeliver, and a dropped
 * notification would become a DUPLICATED order — strictly worse. So the door
 * must still not wait on a stranger's server, and `resolvesWithoutTheSupplier`
 * measures that with the same hanging `fetch`.
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

/**
 * A supplier endpoint that accepts the connection and never answers.
 *
 * This is the shape the freeze eats. A `fetch` that REJECTS would be caught by
 * the old block's `.catch(() => undefined)` and would prove nothing about
 * durability; one that never settles leaves the floating promise parked exactly
 * where a torn-down container leaves it.
 */
let fetchMock: jest.Mock

const SUPPLIER_SESSION = {
  id: 'cs_dropship_1',
  payment_status: 'paid',
  payment_intent: 'pi_dropship_1',
  amount_total: 8300,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'commerce-order',
    hostId: 'host-1',
    productId: 'product-1',
    variantId: 'large',
    feeCents: '271',
  },
}

async function deliver(object: any = SUPPLIER_SESSION) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

/**
 * Every queued delivery, by document path.
 *
 * TOP-LEVEL, not `hosts/{hostId}/…`: the host catch-all in the rules file is
 * permissive by default, and the row carries the exact JSON body Aglyn signs
 * with the supplier's shared secret — an editor-writable row would be an
 * editor-chosen payload delivered under that secret. A top-level collection
 * matches no rule at all and is denied to every client.
 */
function queued(): Array<[string, any]> {
  return [...docs.entries()].filter(([path]) =>
    path.startsWith('supplierDeliveries/'),
  )
}

const order = () => docs.get('hosts/host-1/orders/cs_dropship_1') as any

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

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    supplierId: 'supplier-1',
    variants: [{ id: 'large', priceUsd: 83, sku: 'BOX-L', inventory: 10 }],
  })
  docs.set('hosts/host-1/suppliers/supplier-1', {
    name: 'Northwind Fulfilment',
    webhookUrl: 'https://supplier.example.com/orders',
    webhookSecret: 'supplier-shared-secret',
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('a paid dropship order outlives the webhook (AGL-2473)', () => {
  /**
   * THE RED. With the supplier hanging, the old block is parked inside `fetch`
   * when the response is written and the container is frozen — and there is
   * nothing in Firestore that says a POST is owed, so no later pass can find
   * it. This is the whole bug in one assertion.
   */
  it('records the owed supplier POST durably before returning', async () => {
    await deliver()
    const entries = queued()
    expect(entries).toHaveLength(1)
    const [, delivery] = entries[0]
    expect(delivery.status).toBe('pending')
    expect(delivery.orderId).toBe('cs_dropship_1')
    expect(delivery.supplierId).toBe('supplier-1')
    expect(delivery.attempts).toBe(0)
    expect(typeof delivery.nextAttemptAtMs).toBe('number')
  })

  /**
   * And the door does not call the stranger at all. AGL-2161's objection to
   * awaiting the block was that a slow supplier pushes the handler past
   * Stripe's window and buys a duplicated order in exchange for a dropped
   * notification; the queue is only a fix if the POST has genuinely left the
   * response path.
   */
  it('makes no outbound supplier request from the response path', async () => {
    await deliver()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /** The response still lands while the supplier is hanging. */
  it('resolves without the supplier answering', async () => {
    await expect(deliver()).resolves.toBeUndefined()
  })

  /**
   * The queued body is the payload the supplier would have received, captured
   * at the door — `requestHost` is a property of THIS request and is not
   * available to a later pass, so the callback URL has to be frozen here.
   */
  it('freezes the callback URL the supplier posts tracking back to', async () => {
    await deliver()
    const [, delivery] = queued()[0]
    const payload = JSON.parse(delivery.body)
    expect(payload.orderId).toBe('cs_dropship_1')
    expect(payload.productId).toBe('product-1')
    expect(payload.quantity).toBe(1)
    expect(payload.updateUrl).toContain('https://acme.aglyn.app')
    expect(payload.updateUrl).toContain(`token=${order().supplierToken}`)
  })

  /**
   * The two writes the merchant sees are unchanged and are still made on the
   * response path: they are our own Firestore, not a third party's server, and
   * `supplier-update.ts` re-derives this token to authenticate the callback.
   */
  it('still stamps the callback token and the routed timeline entry', async () => {
    await deliver()
    expect(order().supplierToken).toEqual(expect.any(String))
    expect(
      (order().timeline as any[]).some((event) => event.event === 'routed'),
    ).toBe(true)
  })

  /**
   * Email is NOT queued. It goes through Aglyn's own provider, the handler
   * already awaits the buyer's receipt through the same one, and the queue
   * exists for the endpoint we do not run.
   */
  it('still emails a supplier who has an address, inline', async () => {
    docs.set('hosts/host-1/suppliers/supplier-1', {
      name: 'Northwind Fulfilment',
      email: 'orders@northwind.example',
    })
    await deliver()
    expect(
      sentEmails.some((email) => email.to === 'orders@northwind.example'),
    ).toBe(true)
    expect(queued()).toHaveLength(0)
  })

  /**
   * A supplier with no webhook URL queues nothing — an empty queue row would
   * dead-letter on a delivery nobody ever asked for and alarm the merchant
   * about a supplier they deliberately configured as email-only.
   */
  it('queues nothing when the supplier has no webhook URL', async () => {
    docs.set('hosts/host-1/suppliers/supplier-1', {
      name: 'Northwind Fulfilment',
    })
    await deliver()
    expect(queued()).toHaveLength(0)
  })

  /**
   * Stripe redelivers. The AGL-498 existence guard returns before this fan-out,
   * so a second delivery of the same event cannot reach the enqueue — but the
   * id is deterministic and the write is a `create()` anyway, because the guard
   * is one flag over a dozen effects and `reconcile-stock.ts` already documents
   * why that is not enough on its own.
   */
  it('does not re-queue or reset a delivery on redelivery', async () => {
    await deliver()
    const [path, first] = queued()[0]
    expect(path).toBe('supplierDeliveries/host-1__cs_dropship_1__supplier-1')
    docs.set(path, { ...first, attempts: 3, status: 'pending' })
    await deliver()
    expect(queued()).toHaveLength(1)
    expect(docs.get(path)?.attempts).toBe(3)
  })
})
