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
import { zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { addCheckInDays } from '../model/commerce-check-in-product'

/*
 * A pass bought for a day the buyer chooses (AGL-4043), through the
 * storefront's own doors: the product page's data says which variants ask
 * for a day and the store's time zone, and the cart keeps the day on the
 * line, refusing a day that has passed on the store's calendar or one on an
 * item that asks for none.
 */

let fake: QueryFakeFirestore

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fake }),
    firestore: { FieldPath, Timestamp },
  },
  getOrgForHost: async () => ({ org: { id: 'org-1', timeZone: 'America/Denver' } }),
}))

import { cartHandler } from './cart'
import { cartCookieName } from './cart-cookie'
import { productHandler } from './product'

const HOST_ID = 'host-1'
const CART_ID = 'cart-1'
const ZONE = 'America/Chicago'
const today = () => zonedDayKey(Date.now(), ZONE)

function seedProduct(id: string, patch: Record<string, unknown> = {}) {
  fake.seed(`hosts/${HOST_ID}/products/${id}`, {
    name: id,
    slug: id,
    type: 'service',
    status: 'active',
    deletedAt: null,
    variants: [{ id: 'default', priceUsd: 25, inventory: null }],
    ...patch,
  })
}

async function call(
  handler: typeof productHandler,
  request: { method?: string; query?: Record<string, string>; body?: Record<string, unknown> },
) {
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
  await handler(
    {
      method: request.method ?? 'GET',
      query: request.query ?? {},
      body: request.body ?? {},
      headers: {},
      cookies: { [cartCookieName(HOST_ID)]: CART_ID },
      socket: {},
    } as never,
    res,
  )
  return result
}

const add = (body: Record<string, unknown>) =>
  call(cartHandler, { method: 'POST', body: { hostId: HOST_ID, action: 'add', quantity: 1, ...body } })

const lines = () => (fake.read(`hosts/${HOST_ID}/carts/${CART_ID}`)?.['lines'] ?? []) as Array<Record<string, unknown>>

beforeEach(() => {
  fake = queryFakeFirestore()
  fake.seed(`hosts/${HOST_ID}`, { timeZone: ZONE })
  seedProduct('pass', {
    checkIn: { enabled: true },
    variants: [
      { id: 'ahead', priceUsd: 40, checkIn: { enabled: true, askUseDate: true } },
      { id: 'today', priceUsd: 40 },
    ],
  })
  seedProduct('mug')
})

describe('the product page’s data', () => {
  it('names the variants that ask for a day, with the store’s time zone', async () => {
    const result = await call(productHandler, { query: { hostId: HOST_ID, slug: 'pass' } })
    expect(result.status).toBe(200)
    expect(result.body.product.useDayTimeZone).toBe(ZONE)
    expect(result.body.product.variants.map((variant: any) => [variant.id, variant.asksUseDate ?? false])).toEqual([
      ['ahead', true],
      ['today', false],
    ])
  })

  it('sends neither for a product that asks for no day', async () => {
    const result = await call(productHandler, { query: { hostId: HOST_ID, slug: 'mug' } })
    expect(result.body.product).not.toHaveProperty('useDayTimeZone')
    expect(result.body.product.variants[0]).not.toHaveProperty('asksUseDate')
  })
})

describe('the cart', () => {
  it('keeps the day on the line, and two days of one pass are two lines', async () => {
    const day = addCheckInDays(today(), 2)
    expect((await add({ productId: 'pass', variantId: 'ahead', useDayKey: day })).status).toBe(200)
    expect((await add({ productId: 'pass', variantId: 'ahead', useDayKey: today() })).status).toBe(200)
    expect((await add({ productId: 'pass', variantId: 'ahead', useDayKey: day })).status).toBe(200)
    expect(lines()).toEqual([
      { productId: 'pass', variantId: 'ahead', useDayKey: day, quantity: 2 },
      { productId: 'pass', variantId: 'ahead', useDayKey: today(), quantity: 1 },
    ])
    // Removing one day's line leaves the other.
    await call(cartHandler, {
      method: 'POST',
      body: { hostId: HOST_ID, action: 'remove', productId: 'pass', variantId: 'ahead', useDayKey: day },
    })
    expect(lines()).toEqual([{ productId: 'pass', variantId: 'ahead', useDayKey: today(), quantity: 1 }])
  })

  it('takes a pass with no day, for the day it is bought', async () => {
    expect((await add({ productId: 'pass', variantId: 'ahead' })).status).toBe(200)
    expect(lines()).toEqual([{ productId: 'pass', variantId: 'ahead', quantity: 1 }])
  })

  it('refuses a day that has passed, one that is not a date, and one on an item that asks none', async () => {
    const refusals = [
      { productId: 'pass', variantId: 'ahead', useDayKey: addCheckInDays(today(), -1) },
      { productId: 'pass', variantId: 'ahead', useDayKey: '2027-02-30' },
      { productId: 'pass', variantId: 'ahead', useDayKey: addCheckInDays(today(), 731) },
      { productId: 'pass', variantId: 'today', useDayKey: today() },
      { productId: 'mug', useDayKey: today() },
    ]
    for (const body of refusals) expect((await add(body)).status).toBe(400)
    // A day cannot ride in on a quantity change either.
    const set = await call(cartHandler, {
      method: 'POST',
      body: { hostId: HOST_ID, action: 'set', productId: 'mug', quantity: 2, useDayKey: today() },
    })
    expect(set.status).toBe(400)
    expect(lines()).toEqual([])
  })
})
