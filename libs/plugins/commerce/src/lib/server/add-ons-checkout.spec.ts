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
 *
 * @jest-environment node
 */
import {
  type QueryFakeFirestore,
  queryFakeFirestore,
} from '@aglyn/tenant-data-admin/server/test-firestore-queries'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'

/*
 * WHAT A CONFIGURED PRODUCT CHARGES (AGL-4100).
 *
 * A canopy's frame and walls are add-ons, the walls dearer on the large size.
 * The cart's checkout and Buy now both price one unit as the variant's price
 * plus its add-ons, priced HERE from the product on the variant sold — never
 * from anything the browser sent — and name the add-ons on the Stripe line.
 * A required add-on unanswered is refused in plain words before anything is
 * reserved or minted.
 *
 * These read the FORM BODY each handler built: it is what decides what the
 * card is charged. Stripe is mocked absolutely and never reached.
 */

let fake: QueryFakeFirestore

const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'business',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  firebaseAdmin: {
    app: () => ({ firestore: () => fake }),
    firestore: { FieldPath, FieldValue, Timestamp },
  },
  getOrgForHost: async () => mockOrg,
}))

import { cartCheckoutHandler } from './cart-checkout'
import { checkoutHandler } from './checkout'

let sessionBody: URLSearchParams | null = null

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.startsWith('https://api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  if (target.endsWith('/v1/checkout/sessions')) {
    sessionBody = new URLSearchParams(String(init?.body ?? ''))
    return {
      ok: true,
      json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' }),
    }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

/** Frame required; walls optional and dearer on the large size; stakes sold at the register only. */
const CANOPY = {
  name: 'Canopy',
  slug: 'canopy',
  status: 'active',
  // A service, so no shipping plan joins the body: the assertions are about the line.
  type: 'service',
  deletedAt: null,
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
    {
      id: 'stakes',
      name: 'Stakes',
      min: 1,
      max: 1,
      options: [{ id: 'kit', name: 'Stake kit', priceCents: 1500 }],
    },
  ],
}

const ALU = { groupId: 'frame', optionId: 'alu' }
const BACK = { groupId: 'walls', optionId: 'back' }

function seedStore() {
  fake = queryFakeFirestore()
  fake.seed('hosts/host-1', { name: 'Acme' })
  fake.seed('profiles/owner-1', { stripeAccountId: 'acct_1', stripeChargesEnabled: true })
  fake.seed('hosts/host-1/products/canopy', CANOPY)
  fake.seed('hosts/host-1/settings/store', { tax: { mode: 'none' } })
}

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: any = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader: () => undefined,
    redirect: () => undefined,
    end: () => undefined,
  }
  return { res, result }
}

async function cartCheckout(lines: Array<Record<string, unknown>>) {
  seedStore()
  fake.seed('hosts/host-1/carts/cart-1', { lines })
  sessionBody = null
  const { res, result } = makeResponse()
  await cartCheckoutHandler(
    {
      method: 'POST',
      body: { hostId: 'host-1' },
      cookies: { 'aglyn_cart_host-1': 'cart-1' },
      headers: { host: 'shop.example.com' },
      query: {},
    } as never,
    res,
  )
  return { result, body: sessionBody as URLSearchParams | null }
}

async function buyNow(body: Record<string, unknown>, seed?: () => void) {
  seedStore()
  seed?.()
  sessionBody = null
  const { res, result } = makeResponse()
  await checkoutHandler(
    {
      method: 'POST',
      body: { hostId: 'host-1', productId: 'canopy', quantity: 1, ...body },
      cookies: {},
      headers: { host: 'shop.example.com' },
      query: {},
    } as never,
    res,
  )
  return { result, body: sessionBody as URLSearchParams | null }
}

const line = (body: URLSearchParams | null, index: number) => ({
  quantity: body?.get(`line_items[${index}][quantity]`),
  unitAmount: body?.get(`line_items[${index}][price_data][unit_amount]`),
  name: body?.get(`line_items[${index}][price_data][product_data][name]`),
})

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the cart’s checkout', () => {
  it('charges each line as its variant plus its add-ons on that variant, named on the line', async () => {
    const { result, body } = await cartCheckout([
      { productId: 'canopy', variantId: 'large', quantity: 2, modifiers: [ALU, BACK] },
      { productId: 'canopy', variantId: 'small', quantity: 1, modifiers: [{ groupId: 'frame', optionId: 'steel' }] },
    ])
    expect(result.status).toBe(200)
    expect(line(body, 0)).toEqual({
      quantity: '2',
      // $1,400 + $200 aluminum + $150 back wall on the large one.
      unitAmount: '175000',
      name: 'Canopy (10x20 / Aluminum frame, Back wall)',
    })
    expect(line(body, 1)).toEqual({ quantity: '1', unitAmount: '90000', name: 'Canopy (10x10 / Steel frame)' })
  })

  it('ignores any price a tampered cart carries', async () => {
    const { body } = await cartCheckout([
      {
        productId: 'canopy',
        variantId: 'large',
        quantity: 1,
        unitAmountCents: 1,
        modifiers: [
          { ...ALU, priceCents: 0 },
          { ...BACK, priceCents: 0 },
        ],
      },
    ])
    expect(line(body, 0).unitAmount).toBe('175000')
  })

  it('refuses a line with a required add-on unanswered, before any session', async () => {
    const { result, body } = await cartCheckout([{ productId: 'canopy', variantId: 'small', quantity: 1 }])
    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(result.body.error).toBe('Choose frame for Canopy. Remove it and add it again from its page.')
    expect(body).toBeNull()
  })

  it('refuses a choice the product no longer offers', async () => {
    const { result, body } = await cartCheckout([
      { productId: 'canopy', variantId: 'small', quantity: 1, modifiers: [{ groupId: 'frame', optionId: 'gold' }] },
    ])
    expect(result.body.error).toBe('A choice on Canopy is no longer offered. Remove it and add it again.')
    expect(body).toBeNull()
  })
})

describe('Buy now', () => {
  it('charges the variant plus its add-ons on that variant, and carries the picks to the order', async () => {
    const { result, body } = await buyNow({ variantId: 'large', quantity: 2, modifiers: [BACK, ALU] })
    expect(result.status).toBe(200)
    expect(line(body, 0)).toEqual({
      quantity: '2',
      unitAmount: '175000',
      name: 'Canopy (10x20 / Aluminum frame, Back wall)',
    })
    expect(body?.get('metadata[unitAmountCents]')).toBe('175000')
    expect(JSON.parse(String(body?.get('metadata[modifiers]')))).toEqual([
      ['frame', 'alu'],
      ['walls', 'back'],
    ])
  })

  it('ignores any price the browser sent', async () => {
    const { body } = await buyNow({
      variantId: 'small',
      unitAmountCents: 1,
      priceUsd: 1,
      modifiers: [{ ...ALU, priceCents: 0 }],
    })
    expect(line(body, 0).unitAmount).toBe('110000')
  })

  it('refuses a required add-on unanswered, or a register-only pick, before any session', async () => {
    const missing = await buyNow({ variantId: 'small' })
    expect(missing.result.status).toBe(400)
    expect(missing.result.body.error).toBe('Choose frame for Canopy.')
    expect(missing.body).toBeNull()
    const registerOnly = await buyNow({ variantId: 'small', modifiers: [ALU, { groupId: 'stakes', optionId: 'kit' }] })
    expect(registerOnly.result.status).toBe(400)
    expect(registerOnly.body).toBeNull()
  })

  it('leaves a product with no website add-ons as it was: no metadata, no label beyond the variant', async () => {
    const { body } = await buyNow({ productId: 'mug' }, () =>
      fake.seed('hosts/host-1/products/mug', {
        name: 'Mug',
        status: 'active',
        type: 'service',
        variants: [{ id: 'default', priceUsd: 12, inventory: null }],
        // A register-only group, required at the counter: no live store change.
        modifierGroups: [CANOPY.modifierGroups[2]],
      }),
    )
    expect(line(body, 0)).toEqual({ quantity: '1', unitAmount: '1200', name: 'Mug' })
    expect(body?.has('metadata[modifiers]')).toBe(false)
  })
})
