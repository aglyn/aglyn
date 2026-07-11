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
