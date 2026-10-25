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
 * A product sold in person only (`sellOnline: false`, AGL-4060) through the
 * storefront's own doors: its page's data, its "you may also like" row and
 * the basket. Each answers as if there were no such product, while a product
 * stored before the switch — no `sellOnline` at all — sells as it always did.
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
import { productHandler } from './product'
import { relatedHandler } from './related'

const HOST_ID = 'host-1'
const CART_ID = 'cart-1'

function seedProduct(id: string, patch: Record<string, unknown> = {}) {
  fake.seed(`hosts/${HOST_ID}/products/${id}`, {
    name: id,
    slug: id,
    type: 'physical',
    status: 'active',
    deletedAt: null,
    tags: ['kit'],
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

beforeEach(() => {
  fake = queryFakeFirestore()
  seedProduct('reader', { sellOnline: false })
  seedProduct('mug')
  seedProduct('tee', { sellOnline: true })
})

describe('the product page’s data', () => {
  it('answers 404 for a product sold in person only, as for a draft', async () => {
    expect((await call(productHandler, { query: { hostId: HOST_ID, slug: 'reader' } })).status).toBe(404)
    expect((await call(productHandler, { query: { hostId: HOST_ID, slug: 'mug' } })).status).toBe(200)
    expect((await call(productHandler, { query: { hostId: HOST_ID, slug: 'tee' } })).status).toBe(200)
  })
})

describe('related products', () => {
  it('names no neighbor sold in person only', async () => {
    const result = await call(relatedHandler, { query: { hostId: HOST_ID, productId: 'mug' } })
    expect(result.body.productIds).toEqual(['tee'])
  })

  it('answers none for a product sold in person only', async () => {
    const result = await call(relatedHandler, { query: { hostId: HOST_ID, productId: 'reader' } })
    expect(result.body).toEqual({ productIds: [] })
  })
})

describe('the cart', () => {
  it('refuses to add a product sold in person only, and stores nothing', async () => {
    const result = await call(cartHandler, {
      method: 'POST',
      body: { hostId: HOST_ID, action: 'add', productId: 'reader', quantity: 1 },
    })
    expect(result.status).toBe(404)
    expect(fake.read(`hosts/${HOST_ID}/carts/${CART_ID}`)).toBeUndefined()
  })

  it('adds a product stored before the switch, which sells online', async () => {
    const result = await call(cartHandler, {
      method: 'POST',
      body: { hostId: HOST_ID, action: 'add', productId: 'mug', quantity: 1 },
    })
    expect(result.status).toBe(200)
    expect(fake.read(`hosts/${HOST_ID}/carts/${CART_ID}`)?.['lines']).toEqual([
      expect.objectContaining({ productId: 'mug', quantity: 1 }),
    ])
  })

  it('shows a line already in the basket as unavailable once the product is in person only, and lets it go', async () => {
    fake.seed(`hosts/${HOST_ID}/carts/${CART_ID}`, {
      lines: [
        { productId: 'reader', quantity: 1 },
        { productId: 'mug', quantity: 2 },
      ],
    })
    const shown = await call(cartHandler, { query: { hostId: HOST_ID } })
    expect(shown.body.lines).toEqual([
      expect.objectContaining({ productId: 'reader', unavailable: true, unitAmountCents: 0 }),
      expect.not.objectContaining({ unavailable: true }),
    ])
    const removed = await call(cartHandler, {
      method: 'POST',
      body: { hostId: HOST_ID, action: 'remove', productId: 'reader' },
    })
    expect(removed.status).toBe(200)
    expect(fake.read(`hosts/${HOST_ID}/carts/${CART_ID}`)?.['lines']).toEqual([
      expect.objectContaining({ productId: 'mug' }),
    ])
  })
})
