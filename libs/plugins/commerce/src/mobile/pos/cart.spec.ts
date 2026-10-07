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

import {
  cartAdd,
  cartCount,
  cartDiscountCents,
  cartRemove,
  cartSaleLines,
  cartSetDiscount,
  cartSetQuantity,
  cartSubtotalCents,
  EMPTY_CART,
  POS_LINE_MAX_QUANTITY,
  readStoredCart,
} from './cart'

const latte = { productId: 'p-latte', variantId: 'v-large', name: 'Latte', variantLabel: 'Large', unitCents: 450 }
const oat = [{ groupId: 'milk', optionId: 'oat' }]

describe('the basket (AGL-3618)', () => {
  it('grows one line per item and choices, and counts and totals in cents', () => {
    let cart = cartAdd(EMPTY_CART, latte)
    cart = cartAdd(cart, latte, 2)
    cart = cartAdd(cart, { ...latte, modifiers: oat, unitCents: 525 })
    expect(cart.lines).toHaveLength(2)
    expect(cart.lines[0].quantity).toBe(3)
    expect(cartCount(cart)).toBe(4)
    expect(cartSubtotalCents(cart)).toBe(3 * 450 + 525)
  })

  it('caps a line at what the server rings up, and zero removes it', () => {
    let cart = cartAdd(EMPTY_CART, latte, 500)
    expect(cart.lines[0].quantity).toBe(POS_LINE_MAX_QUANTITY)
    cart = cartSetQuantity(cart, cart.lines[0].key, 0)
    expect(cart.lines).toEqual([])
    expect(cartRemove(cartAdd(EMPTY_CART, latte), 'nope').lines).toHaveLength(1)
  })

  it('previews the discount as the server takes it, line by line', () => {
    const cart = cartSetDiscount(cartAdd(cartAdd(EMPTY_CART, latte, 3), { ...latte, variantId: 'v-small', unitCents: 333 }), 10)
    expect(cartDiscountCents(cart)).toBe(Math.round((1350 * 10) / 100) + Math.round((333 * 10) / 100))
    expect(cartSetDiscount(cart, 250).discountPct).toBe(100)
    expect(cartSetDiscount(cart, Number.NaN).discountPct).toBe(0)
  })

  it('sends picks and counts, never a price', () => {
    const cart = cartAdd(cartAdd(EMPTY_CART, { ...latte, modifiers: oat }), { ...latte, variantId: null })
    expect(cartSaleLines(cart)).toEqual([
      { productId: 'p-latte', variantId: 'v-large', modifiers: oat, quantity: 1 },
      { productId: 'p-latte', quantity: 1 },
    ])
    expect(JSON.stringify(cartSaleLines(cart))).not.toMatch(/Cents/)
  })

  it('reads a stored basket back defensively', () => {
    const stored = JSON.parse(JSON.stringify(cartSetDiscount(cartAdd(EMPTY_CART, { ...latte, modifiers: oat }, 2), 5)))
    expect(readStoredCart(stored)).toEqual(cartSetDiscount(cartAdd(EMPTY_CART, { ...latte, modifiers: oat }, 2), 5))
    expect(readStoredCart(null)).toEqual(EMPTY_CART)
    expect(readStoredCart({ lines: [{ name: 'no id' }, 7], discountPct: 'x' })).toEqual(EMPTY_CART)
  })
})
