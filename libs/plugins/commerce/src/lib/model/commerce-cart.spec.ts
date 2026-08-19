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
  cartCount,
  CART_MAX_QUANTITY,
  mergeCarts,
  removeCartLine,
  upsertCartLine,
} from './commerce-cart'

describe('upsertCartLine', () => {
  it('adds, accumulates, sets, and removes at zero', () => {
    let lines = upsertCartLine({ lines: [] }, {
      productId: 'p1',
      variantId: 'a',
      quantity: 2,
    })
    expect(lines).toHaveLength(1)
    lines = upsertCartLine({ lines }, { productId: 'p1', variantId: 'a', quantity: 3 })
    expect(lines[0].quantity).toBe(5)
    lines = upsertCartLine(
      { lines },
      { productId: 'p1', variantId: 'a', quantity: 1 },
      'set',
    )
    expect(lines[0].quantity).toBe(1)
    lines = upsertCartLine(
      { lines },
      { productId: 'p1', variantId: 'a', quantity: 0 },
      'set',
    )
    expect(lines).toHaveLength(0)
  })

  it('treats variant selections as distinct lines and clamps quantity', () => {
    let lines = upsertCartLine({ lines: [] }, { productId: 'p1', variantId: 'a', quantity: 1 })
    lines = upsertCartLine({ lines }, { productId: 'p1', variantId: 'b', quantity: 500 })
    expect(lines).toHaveLength(2)
    expect(lines[1].quantity).toBe(CART_MAX_QUANTITY)
  })
})

describe('removeCartLine / cartCount', () => {
  it('removes by product+variant and counts units', () => {
    const lines = [
      { productId: 'p1', variantId: 'a', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ]
    expect(cartCount({ lines })).toBe(3)
    const removed = removeCartLine({ lines }, { productId: 'p1', variantId: 'a' })
    expect(removed).toHaveLength(1)
    expect(cartCount({ lines: removed })).toBe(1)
    expect(cartCount(undefined)).toBe(0)
  })
})

describe('mergeCarts', () => {
  it('accumulates guest lines into the customer cart', () => {
    const merged = mergeCarts(
      { lines: [{ productId: 'p1', quantity: 1 }] },
      {
        lines: [
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', variantId: 'x', quantity: 1 },
        ],
      },
    )
    expect(merged).toEqual([
      { productId: 'p1', quantity: 3 },
      { productId: 'p2', variantId: 'x', quantity: 1 },
    ])
  })
})

/**
 * AGL-2285. `Math.round(line.quantity)` was the whole sanitiser, and
 * `Math.round(NaN)` is `NaN` — which walked straight past the `<= 0` guard,
 * because `NaN <= 0` is `false`. A cart line with `quantity: NaN` (a legal
 * Firestore double) was stored, and from there `cart-checkout.ts` computed
 * `itemsCents`, the platform fee and the Stripe `line_items[n][quantity]` as
 * `NaN` too. Stripe 400s, so the shopper could not check out AT ALL until they
 * found the poisoned line and removed it — a lost sale, persisted in their own
 * cart.
 */
describe('a quantity that is not a number (AGL-2285)', () => {
  it('does not add a line for one', () => {
    const lines = upsertCartLine(
      { lines: [] },
      { productId: 'p1', quantity: Number('x') },
    )
    expect(lines).toEqual([])
  })

  it('does not poison a line that already exists', () => {
    const lines = upsertCartLine(
      { lines: [{ productId: 'p1', quantity: 2 }] },
      { productId: 'p1', quantity: Number('x') },
      'add',
    )
    expect(lines).toEqual([{ productId: 'p1', quantity: 2 }])
    expect(Number.isFinite(lines[0].quantity)).toBe(true)
  })

  it('heals a line already stored with one', () => {
    // `set` mode with a real quantity, over a stored NaN.
    const lines = upsertCartLine(
      { lines: [{ productId: 'p1', quantity: Number('x') }] },
      { productId: 'p1', quantity: 3 },
      'set',
    )
    expect(lines).toEqual([{ productId: 'p1', quantity: 3 }])
  })

  it('keeps the mini-cart badge a number when one is stored', () => {
    const count = cartCount({
      lines: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: Number('x') },
      ],
    })
    // The real item still counts — the badge does not go blank over the bad one.
    expect(count).toBe(2)
  })

  /**
   * POSITIVE CONTROL: the ordinary paths are untouched, so the assertions
   * above are not satisfied by a cart that refuses everything.
   */
  it('POSITIVE CONTROL: real quantities still add, accumulate and cap', () => {
    let lines = upsertCartLine({ lines: [] }, { productId: 'p1', quantity: 2 })
    expect(lines).toEqual([{ productId: 'p1', quantity: 2 }])
    lines = upsertCartLine({ lines }, { productId: 'p1', quantity: 3 }, 'add')
    expect(lines).toEqual([{ productId: 'p1', quantity: 5 }])
    lines = upsertCartLine({ lines }, { productId: 'p1', quantity: 500 }, 'set')
    expect(lines[0].quantity).toBe(CART_MAX_QUANTITY)
    expect(cartCount({ lines })).toBe(CART_MAX_QUANTITY)
  })
})

