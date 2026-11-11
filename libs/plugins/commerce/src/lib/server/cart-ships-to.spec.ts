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
import { FieldPath, Timestamp } from 'firebase-admin/firestore'

/*
 * The cart says up front when checkout will ask where it is shipping to, so
 * the cart can show Ship to with its other fields instead of after the first
 * Checkout press: the same plan checkout makes, with no destination yet. Rates
 * that differ by zone ask; one zone, no shipping, or nothing posted do not.
 */

let fake: QueryFakeFirestore

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fake }),
    firestore: { FieldPath, Timestamp },
  },
}))

import { cartHandler } from './cart'
import { cartCookieName } from './cart-cookie'

const HOST_ID = 'host-1'
const CART_ID = 'cart-1'

const TWO_ZONES = {
  zones: [
    { id: 'us', name: 'United States', countries: ['US'] },
    { id: 'world', name: 'Everywhere else', countries: ['*'] },
  ],
  rates: [
    { id: 'std', zoneId: 'us', name: 'Standard', kind: 'flat', amountCents: 799 },
    { id: 'intl', zoneId: 'world', name: 'International', kind: 'flat', amountCents: 2999 },
  ],
}

const ONE_ZONE = {
  zones: [{ id: 'world', name: 'Everywhere', countries: ['*'] }],
  rates: [{ id: 'std', zoneId: 'world', name: 'Standard', kind: 'flat', amountCents: 799 }],
}

async function readCart() {
  const result = { status: 0, body: undefined as any }
  const res: any = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    setHeader: () => undefined,
  }
  await cartHandler(
    {
      method: 'GET',
      query: { hostId: HOST_ID },
      body: {},
      headers: {},
      cookies: { [cartCookieName(HOST_ID)]: CART_ID },
      socket: {},
    } as never,
    res,
  )
  return result
}

beforeEach(() => {
  fake = queryFakeFirestore()
  fake.seed(`hosts/${HOST_ID}/products/reader`, {
    name: 'Card reader',
    slug: 'reader',
    type: 'physical',
    status: 'active',
    deletedAt: null,
    variants: [{ id: 'default', priceUsd: 59, inventory: null, weightGrams: 200 }],
  })
  fake.seed(`hosts/${HOST_ID}/products/guide`, {
    name: 'Setup guide',
    slug: 'guide',
    type: 'digital',
    status: 'active',
    deletedAt: null,
    variants: [{ id: 'default', priceUsd: 5, inventory: null }],
  })
})

describe('the cart asks where it ships before checkout does', () => {
  it('asks when the store’s rates differ by destination and the cart holds something posted', async () => {
    fake.seed(`hosts/${HOST_ID}/settings/store`, { shipping: TWO_ZONES })
    fake.seed(`hosts/${HOST_ID}/carts/${CART_ID}`, { lines: [{ productId: 'reader', quantity: 2 }] })
    const shown = await readCart()
    expect(shown.status).toBe(200)
    expect(shown.body.needsShippingCountry).toBe(true)
    expect(shown.body.shippingCountries).toEqual(expect.arrayContaining(['US', 'CA']))
  })

  it('does not ask when one rate serves every destination', async () => {
    fake.seed(`hosts/${HOST_ID}/settings/store`, { shipping: ONE_ZONE })
    fake.seed(`hosts/${HOST_ID}/carts/${CART_ID}`, { lines: [{ productId: 'reader', quantity: 1 }] })
    const shown = await readCart()
    expect(shown.body).not.toHaveProperty('needsShippingCountry')
  })

  it('does not ask a store with no shipping set up', async () => {
    fake.seed(`hosts/${HOST_ID}/carts/${CART_ID}`, { lines: [{ productId: 'reader', quantity: 1 }] })
    const shown = await readCart()
    expect(shown.body).not.toHaveProperty('needsShippingCountry')
  })

  it('does not ask a cart with nothing posted', async () => {
    fake.seed(`hosts/${HOST_ID}/settings/store`, { shipping: TWO_ZONES })
    fake.seed(`hosts/${HOST_ID}/carts/${CART_ID}`, { lines: [{ productId: 'guide', quantity: 1 }] })
    const shown = await readCart()
    expect(shown.status).toBe(200)
    expect(shown.body).not.toHaveProperty('needsShippingCountry')
  })
})
