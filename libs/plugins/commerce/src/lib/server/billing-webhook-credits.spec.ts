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
import { commerceBillingWebhookHandler } from './billing-webhook'
import {
  encodeCheckoutCreditMetadata,
  registerPluginCheckoutCredit,
  type PluginCheckoutCreditProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-checkout-credits'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * Store credit another plugin held for a cart checkout (AGL-3640) is TAKEN in
 * the transaction that writes the order: the provider's stage reads inside it
 * and its debit writes inside it, so the redemption and the order land
 * together. A redelivered event finds the order and takes nothing again; a
 * provider that gives less than Stripe discounted is said on the order and to
 * the merchant; an expired session lets the hold go.
 *
 * The harness is `billing-webhook-redemption.spec.ts`'s.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** gRPC `Status.NOT_FOUND` — what Firestore's "no entity to update" carries. */
const GRPC_NOT_FOUND = 5

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Resolves one field value against what is already stored, so the sentinels
 * behave as Firestore's do rather than landing as literal marker objects.
 * Applied at ANY depth, because that is where `set({ merge: true })` honours
 * them and it is the difference the gift-card site turns on.
 */
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

/**
 * Paths whose `update()` should fail for a reason that is NOT absence, so the
 * "an outage is not a deletion" case can be driven through the real handler.
 */
const updateFailures = new Map<string, { code?: number; message: string }>()

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
    update: async (value: Record<string, any>) => {
      const injected = updateFailures.get(path)
      if (injected) throw Object.assign(new Error(injected.message), injected)
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

let contactUpserts: PluginContactCaptureRequest[] = []
const notices: unknown[][] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL `updateExisting` — it is what distinguishes gRPC NOT_FOUND from
  // every other failure, so a stub of it would leave the claim untested. Taken
  // from the module's own path rather than the barrel, which pulls
  // `render-cache` and with it Next's server internals into a jsdom worker.
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
    notifyHostManagers: async (...args: unknown[]) => {
      notices.push(args)
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
// A recording provider and the session it held for
// ---------------------------------------------------------------------------

const HELD = {
  providerId: 'loyalty.rewards',
  reference: 'm:abc',
  holdKey: 'attempt-key-1',
  amountCents: 1200,
  label: 'Rewards',
  last4: 'CCCC',
}

const CART_SESSION = {
  id: 'cs_cart_1',
  payment_status: 'paid',
  payment_intent: 'pi_cart_1',
  amount_total: 3300,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 1200 },
  metadata: {
    type: 'commerce-cart',
    hostId: 'host-1',
    cartId: 'cart-1',
    feeCents: '99',
    ...encodeCheckoutCreditMetadata(HELD),
  },
}

const staged: Array<Record<string, unknown>> = []
const debits: Array<Record<string, unknown>> = []
const released: Array<Record<string, unknown>> = []

function provide(give: (cents: number) => number = (cents) => cents) {
  const provider: PluginCheckoutCreditProvider = {
    key: 'rewards',
    label: 'Rewards',
    recognizes: () => true,
    offered: async () => true,
    resolve: async () => ({ ok: false, status: 404, error: 'unused' }),
    hold: async () => ({ ok: false, status: 404, error: 'unused' }),
    release: async (input) => {
      released.push(input)
    },
    stage: async (input) => {
      staged.push({ ...input, transaction: Boolean(input.transaction) })
      return {
        availableCents: 5000,
        debit: (request) => {
          debits.push(request)
          return give(request.cents)
        },
        reverse: () => 0,
      }
    },
    restore: async () => 0,
  }
  registerPluginCheckoutCredit(provider, { pluginId: 'loyalty' })
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await commerceBillingWebhookHandler({ type, object, requestHost: 'acme.aglyn.app' } as any)
}

const cartOrder = () => docs.get('hosts/host-1/orders/cs_cart_1') as any
const shortNotices = () =>
  notices.filter((args) => (args[1] as { title?: string })?.title === 'Store credit on an order came up short')

beforeAll(() => {
  ;(global as any).fetch = jest.fn(async (url: any) => {
    throw new Error(`Unexpected fetch to ${String(url)}`)
  })
})

beforeEach(() => {
  docs.clear()
  updateFailures.clear()
  contactUpserts = standInRecordSystem({ reset: false })
  autoIdCounter = 0
  staged.length = 0
  debits.length = 0
  released.length = 0
  notices.length = 0
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    variants: [{ id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10 }],
  })
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'product-1', variantId: 'large', quantity: 3 }],
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('store credit settles with the order (AGL-3640)', () => {
  it('takes the hold inside the order’s transaction and records what it took', async () => {
    provide()
    await deliver(CART_SESSION)
    expect(staged).toEqual([
      expect.objectContaining({ transaction: true, hostId: 'host-1', reference: 'm:abc', orderId: 'cs_cart_1', holdKey: 'attempt-key-1' }),
    ])
    expect(debits).toEqual([{ cents: 1200, key: 'attempt-key-1', orderId: 'cs_cart_1', channel: 'online' }])
    expect(cartOrder().credits).toEqual([
      {
        providerId: 'loyalty.rewards',
        pluginId: 'loyalty',
        key: 'rewards',
        reference: 'm:abc',
        label: 'Rewards',
        last4: 'CCCC',
        amountCents: 1200,
        appliedAs: 'discount',
      },
    ])
    expect((cartOrder().timeline as any[]).some((event) => event.event === 'credit-short')).toBe(false)
    expect(shortNotices()).toEqual([])
  })

  it('a redelivered event takes nothing again', async () => {
    provide()
    await deliver(CART_SESSION)
    await deliver(CART_SESSION)
    expect(debits).toHaveLength(1)
  })

  it('says so on the order and to the merchant when the account gave less than was discounted', async () => {
    provide(() => 700)
    await deliver(CART_SESSION)
    expect(cartOrder().credits[0].amountCents).toBe(700)
    const short = (cartOrder().timeline as any[]).find((event) => event.event === 'credit-short')
    expect(short.detail).toContain('$12.00 of Rewards')
    expect(short.detail).toContain('$7.00')
    expect(shortNotices()).toHaveLength(1)
  })

  it('still writes the order when the provider is gone, and says the credit did not settle', async () => {
    await deliver(CART_SESSION)
    expect(cartOrder()).toBeDefined()
    expect(cartOrder().credits).toBeUndefined()
    expect((cartOrder().timeline as any[]).some((event) => event.event === 'credit-short')).toBe(true)
  })

  it('an expired session lets the hold go', async () => {
    provide()
    await deliver({ ...CART_SESSION, payment_status: 'unpaid' }, 'checkout.session.expired')
    expect(released).toEqual([{ hostId: 'host-1', reference: 'm:abc', holdKey: 'attempt-key-1' }])
    expect(cartOrder()).toBeUndefined()
  })
})
