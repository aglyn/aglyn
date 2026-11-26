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
 * The cart prices in the shopper's currency (AGL-4248) exactly as checkout
 * will charge it: the variant converted and rounded (or its fixed price), each
 * add-on converted on its own (or its fixed amount), and the currency named.
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
import { resetFxRatesCache } from './currency'

const HOST_ID = 'host-1'
const CART_ID = 'cart-1'

async function readCart(query: Record<string, string> = {}) {
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
      query: { hostId: HOST_ID, ...query },
      body: {},
      headers: {},
      cookies: { [cartCookieName(HOST_ID)]: CART_ID },
      socket: {},
    } as never,
    res,
  )
  return result
}

const WRAP_GROUP = {
  id: 'extras',
  name: 'Extras',
  min: 0,
  max: 1,
  online: true,
  options: [{ id: 'wrap', name: 'Gift wrap', priceCents: 500 }],
}

beforeEach(() => {
  resetFxRatesCache()
  fake = queryFakeFirestore()
  // Per 1 EUR: 1 USD = 1.80 / 1.05 NZD (1.7142857…).
  fake.seed('platform/fxRates', {
    base: 'EUR',
    rates: { USD: 1.05, NZD: 1.8 },
    asOfMs: Date.now() - 60_000,
    source: 'ecb',
  })
  fake.seed(`hosts/${HOST_ID}/settings/store`, {
    currency: 'USD',
    currencies: { enabled: true, currencies: [{ code: 'NZD', rounding: 'whole' }] },
  })
  fake.seed(`hosts/${HOST_ID}/products/tee`, {
    name: 'Tee',
    slug: 'tee',
    type: 'digital',
    status: 'active',
    deletedAt: null,
    variants: [{ id: 'default', priceUsd: 59, inventory: null }],
    modifierGroups: [WRAP_GROUP],
  })
  fake.seed(`hosts/${HOST_ID}/carts/${CART_ID}`, {
    lines: [{ productId: 'tee', quantity: 2, modifiers: [{ groupId: 'extras', optionId: 'wrap' }] }],
  })
})

describe('the cart read in the shopper currency', () => {
  it('prices every line in NZD as checkout will, and names the currency', async () => {
    const shown = await readCart({ currency: 'NZD' })
    expect(shown.status).toBe(200)
    expect(shown.body.currency).toBe('NZD')
    // 59 × 1.714… = 101.14 → rounded up to NZ$102; the NZ$8.58 add-on is not rounded.
    expect(shown.body.lines[0].unitAmountCents).toBe(10_200 + 858)
    expect(shown.body.subtotalCents).toBe((10_200 + 858) * 2)
  })

  it('honours a fixed variant price and a fixed add-on amount', async () => {
    fake.seed(`hosts/${HOST_ID}/products/tee`, {
      name: 'Tee',
      slug: 'tee',
      type: 'digital',
      status: 'active',
      deletedAt: null,
      variants: [{ id: 'default', priceUsd: 59, inventory: null, fixedPrices: { NZD: 99 } }],
      modifierGroups: [
        { ...WRAP_GROUP, options: [{ ...WRAP_GROUP.options[0], fixedPriceCents: { NZD: 900 } }] },
      ],
    })
    const shown = await readCart({ currency: 'NZD' })
    expect(shown.body.lines[0].unitAmountCents).toBe(9_900 + 900)
  })

  it('stays in the store currency when the store does not sell in the one asked for', async () => {
    const shown = await readCart({ currency: 'GBP' })
    expect(shown.body.currency).toBe('USD')
    expect(shown.body.lines[0].unitAmountCents).toBe(5_900 + 500)
  })

  it('stays in the store currency when the rates are stale', async () => {
    fake.seed('platform/fxRates', {
      base: 'EUR',
      rates: { USD: 1.05, NZD: 1.8 },
      asOfMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
    })
    const shown = await readCart({ currency: 'NZD' })
    expect(shown.body.currency).toBe('USD')
    expect(shown.body.subtotalCents).toBe((5_900 + 500) * 2)
  })

  it('answers as before when no currency is asked', async () => {
    const shown = await readCart()
    expect(shown.body).not.toHaveProperty('currency')
    expect(shown.body.lines[0].unitAmountCents).toBe(5_900 + 500)
  })
})
