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
 * Add-ons on the website (AGL-4100), through the storefront's own doors: the
 * product page's data carries only the groups switched to "Show on the
 * website", and the cart keeps the picks as ids, refuses a required group
 * unanswered, keeps two configurations apart and prices the add-ons from the
 * product on every read — never from what the browser sent.
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

const HOST_ID = 'host-1'
const CART_ID = 'cart-1'

/** A canopy: the size is the variant; frame and walls are add-ons, walls dearer on the large one. */
const CANOPY = {
  name: 'Canopy',
  slug: 'canopy',
  type: 'physical',
  status: 'active',
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
      // Register only: required at the counter, never asked or shown online.
      id: 'stakes',
      name: 'Stakes',
      min: 1,
      max: 1,
      options: [{ id: 'kit', name: 'Stake kit', priceCents: 1500 }],
    },
  ],
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

const post = (body: Record<string, unknown>) =>
  call(cartHandler, { method: 'POST', body: { hostId: HOST_ID, action: 'add', quantity: 1, ...body } })

const lines = () => (fake.read(`hosts/${HOST_ID}/carts/${CART_ID}`)?.['lines'] ?? []) as Array<Record<string, unknown>>

const ALU = { groupId: 'frame', optionId: 'alu' }
const BACK = { groupId: 'walls', optionId: 'back' }

beforeEach(() => {
  fake = queryFakeFirestore()
  fake.seed(`hosts/${HOST_ID}/products/canopy`, CANOPY)
  fake.seed(`hosts/${HOST_ID}/products/mug`, {
    name: 'Mug',
    slug: 'mug',
    type: 'physical',
    status: 'active',
    deletedAt: null,
    variants: [{ id: 'default', priceUsd: 12, inventory: null }],
    // A coffee shop's register-only group: no live store change.
    modifierGroups: [CANOPY.modifierGroups[2]],
  })
})

describe('the product page’s data', () => {
  it('carries the website groups with their prices by variant, and never a register-only one', async () => {
    const result = await call(productHandler, { query: { hostId: HOST_ID, slug: 'canopy' } })
    expect(result.status).toBe(200)
    const groups = result.body.product.modifierGroups
    expect(groups.map((group: any) => group.id)).toEqual(['frame', 'walls'])
    expect(groups[1].options[0]).toEqual({
      id: 'back',
      name: 'Back wall',
      priceCents: 9000,
      priceCentsByVariant: { large: 15000 },
    })
    expect(groups[0]).not.toHaveProperty('online')
    expect(JSON.stringify(result.body)).not.toContain('Stake kit')
  })

  it('sends no add-ons for a product whose groups are all at the register', async () => {
    const result = await call(productHandler, { query: { hostId: HOST_ID, slug: 'mug' } })
    expect(result.body.product).not.toHaveProperty('modifierGroups')
  })
})

describe('the cart', () => {
  it('refuses a line with a required add-on unanswered, in plain words, and stores nothing', async () => {
    const result = await post({ productId: 'canopy', variantId: 'small' })
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('Choose frame for Canopy.')
    expect(fake.read(`hosts/${HOST_ID}/carts/${CART_ID}`)).toBeUndefined()
  })

  it('refuses a pick of a register-only group, or of a choice the product does not offer', async () => {
    expect((await post({ productId: 'canopy', variantId: 'small', modifiers: [ALU, { groupId: 'stakes', optionId: 'kit' }] })).status).toBe(400)
    expect((await post({ productId: 'canopy', variantId: 'small', modifiers: [{ groupId: 'frame', optionId: 'gold' }] })).status).toBe(400)
    expect(lines()).toEqual([])
  })

  it('keeps the picks as ids in the product’s order, and two configurations as two lines', async () => {
    expect((await post({ productId: 'canopy', variantId: 'small', modifiers: [BACK, ALU] })).status).toBe(200)
    expect((await post({ productId: 'canopy', variantId: 'small', modifiers: [ALU] })).status).toBe(200)
    expect((await post({ productId: 'canopy', variantId: 'small', modifiers: [ALU, BACK] })).status).toBe(200)
    expect(lines()).toEqual([
      { productId: 'canopy', variantId: 'small', modifiers: [ALU, BACK], quantity: 2 },
      { productId: 'canopy', variantId: 'small', modifiers: [ALU], quantity: 1 },
    ])
    // A quantity change and a removal find the line by its add-ons.
    await call(cartHandler, {
      method: 'POST',
      body: { hostId: HOST_ID, action: 'set', productId: 'canopy', variantId: 'small', modifiers: [BACK, ALU], quantity: 5 },
    })
    await call(cartHandler, {
      method: 'POST',
      body: { hostId: HOST_ID, action: 'remove', productId: 'canopy', variantId: 'small', modifiers: [ALU] },
    })
    expect(lines()).toEqual([{ productId: 'canopy', variantId: 'small', modifiers: [ALU, BACK], quantity: 5 }])
  })

  it('prices add-ons from the product on the variant, whatever price the browser sent', async () => {
    await post({
      productId: 'canopy',
      variantId: 'large',
      quantity: 2,
      unitAmountCents: 1,
      modifiers: [
        { ...ALU, priceCents: 0 },
        { ...BACK, priceCents: 0 },
      ],
    })
    expect(lines()[0]).toEqual({ productId: 'canopy', variantId: 'large', modifiers: [ALU, BACK], quantity: 2 })
    const shown = await call(cartHandler, { query: { hostId: HOST_ID } })
    expect(shown.body.lines[0]).toMatchObject({
      name: 'Canopy',
      variantLabel: '10x20 / Aluminum frame, Back wall',
      // $1,400 + $200 frame + $150 back wall on the large one.
      unitAmountCents: 175000,
    })
    expect(shown.body.subtotalCents).toBe(350000)
  })

  it('reads a cart stored before add-ons as it always did', async () => {
    fake.seed(`hosts/${HOST_ID}/carts/${CART_ID}`, { lines: [{ productId: 'mug', quantity: 2 }] })
    const shown = await call(cartHandler, { query: { hostId: HOST_ID } })
    expect(shown.body.lines).toEqual([
      expect.objectContaining({ productId: 'mug', unitAmountCents: 1200, quantity: 2 }),
    ])
    expect(shown.body.lines[0]).not.toHaveProperty('unavailable')
    expect(shown.body.subtotalCents).toBe(2400)
    // And a mug still goes in with no choices: its group is the register's.
    expect((await post({ productId: 'mug' })).status).toBe(200)
  })

  it('shows a line whose required add-on is now unanswered as unavailable, saying what to do', async () => {
    fake.seed(`hosts/${HOST_ID}/carts/${CART_ID}`, {
      lines: [{ productId: 'canopy', variantId: 'small', quantity: 1 }],
    })
    const shown = await call(cartHandler, { query: { hostId: HOST_ID } })
    expect(shown.body.lines[0]).toMatchObject({
      unavailable: true,
      unitAmountCents: 0,
      problem: 'Choose frame for Canopy. Remove it and add it again from its page.',
    })
    expect(shown.body.subtotalCents).toBe(0)
  })
})
