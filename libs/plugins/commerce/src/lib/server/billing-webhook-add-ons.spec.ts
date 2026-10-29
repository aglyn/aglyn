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
 * A paid order names its add-ons (AGL-4100).
 *
 * The cart's order is priced again from the cart document when Stripe says
 * it is paid, so its lines must price the add-ons the way checkout did — the
 * variant plus its add-ons on that variant — and name them, folded into the
 * line's label as the register folds its modifiers, and kept structured in
 * `modifiers`. A Buy now order takes its unit price from the session and its
 * add-ons from the ids the session carried.
 *
 * Driven through the real handler with the in-memory Firestore of
 * `billing-webhook-cart-dropship.spec.ts`.
 */

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

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

function mergeInto(previous: Record<string, any>, patch: Record<string, any>): Record<string, any> {
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
      docs.set(path, options?.merge ? mergeInto(docs.get(path) ?? {}, value) : mergeInto({}, value))
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, mergeInto({}, value))
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
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
    doc: (id?: string) => makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: [], size: 0, empty: true }),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, value)
      return created
    },
    where: () => ref,
    orderBy: () => ref,
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
      create: (ref: any, value: any) => {
        void ref.create(value)
      },
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const { updateExisting } = jest.requireActual('@aglyn/tenant-data-admin/server/update-existing')
  return {
    updateExisting,
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
          delete: () => undefined,
        },
      },
    },
    findUserByUidAcrossPools: async () => null,
    getOrgForHost: async () => ({ org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' } }),
    meterHostEmail: async () => undefined,
    notifyHostManagers: async () => undefined,
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: async () => null,
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

/** Frame required, walls dearer on the large size. */
const CANOPY = {
  name: 'Canopy',
  type: 'service',
  options: [{ name: 'Size', values: ['10x10', '10x20'] }],
  variants: [
    { id: 'small', options: { Size: '10x10' }, priceUsd: 900, inventory: null },
    { id: 'large', options: { Size: '10x20' }, priceUsd: 1400, inventory: null },
  ],
  modifierGroups: [
    {
      id: 'frame',
      name: 'Frame',
      min: 1,
      max: 1,
      online: true,
      options: [
        { id: 'steel', name: 'Steel frame', priceCents: 0 },
        { id: 'alu', name: 'Aluminum frame', priceCents: 20000 },
      ],
    },
    {
      id: 'walls',
      name: 'Walls',
      min: 0,
      max: 2,
      online: true,
      options: [
        { id: 'back', name: 'Back wall', priceCents: 9000, priceCentsByVariant: { large: 15000 } },
        { id: 'side', name: 'Side wall', priceCents: 7500 },
      ],
    },
  ],
}

const ALU = { groupId: 'frame', optionId: 'alu' }
const BACK = { groupId: 'walls', optionId: 'back' }

const session = (id: string, metadata: Record<string, string>, amountTotal: number) => ({
  id,
  payment_status: 'paid',
  payment_intent: `pi_${id}`,
  amount_total: amountTotal,
  customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata,
})

async function deliver(object: any) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

const order = (id: string) => docs.get(`hosts/host-1/orders/${id}`) as any

beforeAll(() => {
  process.env.TOKEN_SIGNING_SECRET = 'test-token-signing-secret'
})

beforeEach(() => {
  docs.clear()
  autoIdCounter = 0
  ;(global as any).fetch = jest.fn(() => new Promise<never>(() => undefined))
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  docs.set('hosts/host-1', { displayName: 'Acme Canopies' })
  docs.set('hosts/host-1/products/canopy', CANOPY)
  docs.set('hosts/host-1/products/mug', {
    name: 'Mug',
    type: 'physical',
    variants: [{ id: 'default', priceUsd: 12 }],
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a paid cart order with add-ons (AGL-4100)', () => {
  it('prices each line as checkout did and names its add-ons, structured and in the label', async () => {
    docs.set('hosts/host-1/carts/cart-1', {
      lines: [
        { productId: 'canopy', variantId: 'large', quantity: 2, modifiers: [ALU, BACK] },
        { productId: 'mug', quantity: 1 },
      ],
    })
    await deliver(
      session('cs_cart_addons', { type: 'commerce-cart', hostId: 'host-1', cartId: 'cart-1', feeCents: '0' }, 351200),
    )
    const [canopy, mug] = order('cs_cart_addons').lineItems
    expect(canopy).toMatchObject({
      productId: 'canopy',
      variantId: 'large',
      name: 'Canopy',
      variantLabel: '10x20 / Aluminum frame, Back wall',
      quantity: 2,
      unitAmountCents: 175000,
      modifiers: [
        { groupId: 'frame', optionId: 'alu', group: 'Frame', name: 'Aluminum frame', priceCents: 20000 },
        { groupId: 'walls', optionId: 'back', group: 'Walls', name: 'Back wall', priceCents: 15000 },
      ],
    })
    // A line with no add-ons is recorded exactly as before.
    expect(mug).toMatchObject({ productId: 'mug', quantity: 1, unitAmountCents: 1200 })
    expect(mug).not.toHaveProperty('modifiers')
    expect(mug).not.toHaveProperty('variantLabel')
    expect(order('cs_cart_addons').itemsCents ?? order('cs_cart_addons').totals?.itemsCents).toBe(351200)
  })
})

describe('a paid Buy now order with add-ons (AGL-4100)', () => {
  it('records the session’s unit price and the add-ons its ids name', async () => {
    await deliver(
      session(
        'cs_buy_addons',
        {
          type: 'commerce-order',
          hostId: 'host-1',
          productId: 'canopy',
          variantId: 'large',
          quantity: '1',
          feeCents: '0',
          unitAmountCents: '175000',
          taxCents: '0',
          discountCents: '0',
          modifiers: JSON.stringify([
            ['frame', 'alu'],
            ['walls', 'back'],
          ]),
        },
        175000,
      ),
    )
    const [line] = order('cs_buy_addons').lineItems
    expect(line).toMatchObject({
      productId: 'canopy',
      variantId: 'large',
      variantLabel: '10x20 / Aluminum frame, Back wall',
      unitAmountCents: 175000,
      quantity: 1,
    })
    expect(line.modifiers.map((modifier: any) => [modifier.name, modifier.priceCents])).toEqual([
      ['Aluminum frame', 20000],
      ['Back wall', 15000],
    ])
  })

  it('records a session with no add-ons as before', async () => {
    await deliver(
      session(
        'cs_buy_plain',
        {
          type: 'commerce-order',
          hostId: 'host-1',
          productId: 'mug',
          quantity: '1',
          feeCents: '0',
          unitAmountCents: '1200',
          taxCents: '0',
          discountCents: '0',
        },
        1200,
      ),
    )
    const [line] = order('cs_buy_plain').lineItems
    expect(line).toMatchObject({ productId: 'mug', unitAmountCents: 1200 })
    expect(line).not.toHaveProperty('modifiers')
    expect(line).not.toHaveProperty('variantLabel')
  })
})
