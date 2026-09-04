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
  discountBenefit,
  resolveDiscount,
  type HostDiscount,
} from './commerce-discounts'

const NOW = 1_800_000_000_000

const discounts: Array<HostDiscount & { $id: string }> = [
  { $id: 'save10', code: 'SAVE10', kind: 'percent', valuePct: 10 },
  {
    $id: 'summer',
    name: 'Summer sale',
    kind: 'percent',
    valuePct: 5,
  },
  {
    $id: 'bigspender',
    name: 'Free shipping over $50',
    kind: 'free_shipping',
    minSubtotalCents: 5000,
  },
  {
    $id: 'flat5',
    code: 'FLAT5',
    kind: 'fixed',
    valueCents: 500,
    productIds: ['p1'],
    maxRedemptions: 10,
    redemptions: 10,
  },
  {
    $id: 'expired',
    code: 'OLD',
    kind: 'percent',
    valuePct: 50,
    endAtMs: NOW - 1,
  },
]

describe('resolveDiscount', () => {
  const context = {
    subtotalCents: 10000,
    productIds: ['p1', 'p2'],
    nowMs: NOW,
  }

  it('applies a valid entered code (beats automatics)', () => {
    const resolved = resolveDiscount(discounts, { ...context, code: 'save10' })
    expect(resolved?.discountId).toBe('save10')
    expect(resolved?.discountCents).toBe(1000)
    expect(resolved?.codeProblem).toBeUndefined()
  })

  it('surfaces why an entered code fails', () => {
    expect(
      resolveDiscount(discounts, { ...context, code: 'FLAT5' })?.codeProblem,
    ).toMatch(/fully redeemed/)
    expect(
      resolveDiscount(discounts, { ...context, code: 'OLD' })?.codeProblem,
    ).toMatch(/expired/)
    expect(resolveDiscount(discounts, { ...context, code: 'NOPE' })).toBeNull()
  })

  it('picks the largest automatic discount without a code', () => {
    const resolved = resolveDiscount(discounts, context)
    expect(resolved?.discountId).toBe('summer')
    expect(resolved?.discountCents).toBe(500)
  })

  it('honors min-subtotal on automatics and grants free shipping', () => {
    const small = resolveDiscount(discounts, {
      subtotalCents: 1000,
      productIds: [],
      nowMs: NOW,
    })
    expect(small?.discountId).toBe('summer')
    // Free-shipping automatic qualifies at $50+ but percent still wins
    // on cents; free shipping surfaces when it is the best value.
    const onlyShipping = resolveDiscount(
      discounts.filter((discount) => discount.$id === 'bigspender'),
      context,
    )
    expect(onlyShipping?.freeShipping).toBe(true)
  })

  it('enforces product scope', () => {
    const scoped = resolveDiscount(
      [
        {
          $id: 'scoped',
          code: 'SCOPED',
          kind: 'percent',
          valuePct: 20,
          productIds: ['p9'],
        },
      ],
      { ...context, code: 'SCOPED' },
    )
    expect(scoped?.codeProblem).toMatch(/does not apply/)
  })
})


/**
 * What a discount is WORTH, and the fact that "nothing" is an answer with a
 * reason rather than the number zero.
 *
 * `valueCents` used to return a bare `number`, and every kind it did not
 * understand returned `0`. `free_shipping` was such a kind, so it resolved
 * successfully worth nothing and the cart — which applies a discount only when
 * `discountCents > 0`, and refuses a code only when nothing resolved at all —
 * charged full shipping without an error. These pin the distinction that makes
 * that impossible to repeat.
 */
describe('discountBenefit', () => {
  const at = (kind: string, extra: Record<string, unknown> = {}) =>
    discountBenefit({ kind, ...extra } as never, 10000)

  it('names free shipping as its own benefit, not as zero off', () => {
    expect(at('free_shipping')).toEqual({ kind: 'free-shipping' })
  })

  it('prices a percentage against the subtotal', () => {
    expect(at('percent', { valuePct: 10 })).toEqual({
      kind: 'amount',
      centsOff: 1000,
    })
  })

  it('caps a fixed amount at the subtotal', () => {
    // CONTROL that the amount arm still computes, and still refuses to hand
    // back more than the cart is worth.
    expect(at('fixed', { valueCents: 99999 })).toEqual({
      kind: 'amount',
      centsOff: 10000,
    })
  })

  it('reports a kind it cannot apply instead of answering zero', () => {
    // The guard. A `kind` written by a newer build arrives as an ordinary
    // string, and answering `0` for it is the original defect restated.
    const benefit = at('store-credit')
    expect(benefit.kind).toBe('none')
    expect(benefit).toHaveProperty('reason', expect.stringMatching(/cannot apply/))
  })

  it('reports a discount configured to take nothing off', () => {
    expect(at('percent', { valuePct: 0 }).kind).toBe('none')
    expect(at('fixed', { valueCents: 0 }).kind).toBe('none')
  })
})

describe('resolveDiscount carries the benefit', () => {
  const context = { subtotalCents: 10000, productIds: ['p1'] }

  it('refuses an entered code that confers nothing', () => {
    // A code the shopper TYPED must produce a reason they can see. Before
    // this it resolved as a successful discount of zero and said nothing.
    const resolved = resolveDiscount(
      [{ $id: 'd1', code: 'WAT', kind: 'store-credit' } as never],
      { ...context, code: 'WAT' },
    )
    expect(resolved?.codeProblem).toMatch(/cannot apply/)
    expect(resolved?.discountCents).toBe(0)
    expect(resolved?.freeShipping).toBe(false)
  })

  it('applies an entered free-shipping code', () => {
    const resolved = resolveDiscount(
      [{ $id: 'd1', code: 'FREESHIP', kind: 'free_shipping' } as never],
      { ...context, code: 'FREESHIP' },
    )
    expect(resolved?.codeProblem).toBeUndefined()
    expect(resolved?.freeShipping).toBe(true)
    expect(resolved?.benefit).toEqual({ kind: 'free-shipping' })
  })

  it('passes over an automatic promotion worth nothing', () => {
    // Nobody asked for an automatic promotion, so there is no shopper to
    // answer — but a real one later in the list must still win.
    const resolved = resolveDiscount(
      [
        { $id: 'dead', kind: 'store-credit' } as never,
        { $id: 'live', kind: 'percent', valuePct: 5 } as never,
      ],
      context,
    )
    expect(resolved?.discountId).toBe('live')
    expect(resolved?.discountCents).toBe(500)
  })
})

/**
 * A SCOPED DISCOUNT IS WORTH ONLY WHAT IT COVERS.
 *
 * `applies` already refused a cart containing NONE of the scoped products, so
 * the scope was never entirely dead — but the AMOUNT was computed against the
 * whole subtotal. A discount scoped to three products therefore discounted the
 * entire basket the moment one of the three was in it: the merchant chose a
 * scope, checkout charged as though they had not, and the difference came out
 * of their margin with nothing on any screen to explain it.
 */
describe('product-scoped discount pricing', () => {
  const lines = [
    { productId: 'in-scope', amountCents: 4000 },
    { productId: 'out-of-scope', amountCents: 6000 },
  ]
  const context = {
    subtotalCents: 10000,
    productIds: ['in-scope', 'out-of-scope'],
    lines,
  }

  it('takes its percentage off the scoped lines, not the basket', () => {
    // 10% of the $40 line, never 10% of the $100 basket.
    const resolved = resolveDiscount(
      [
        {
          $id: 'd1',
          code: 'TEN',
          kind: 'percent',
          valuePct: 10,
          productIds: ['in-scope'],
        } as never,
      ],
      { ...context, code: 'TEN' },
    )

    expect(resolved?.discountCents).toBe(400)
  })

  it('caps a fixed amount at what the scoped lines are worth', () => {
    const resolved = resolveDiscount(
      [
        {
          $id: 'd1',
          code: 'FIFTY',
          kind: 'fixed',
          valueCents: 5000,
          productIds: ['in-scope'],
        } as never,
      ],
      { ...context, code: 'FIFTY' },
    )

    // $50 off, but only $40 of covered goods to take it off.
    expect(resolved?.discountCents).toBe(4000)
  })

  it('CONTROL: an unscoped discount still prices against the whole basket', () => {
    // Without this the change would look right while shrinking every ordinary
    // store-wide discount.
    const resolved = resolveDiscount(
      [{ $id: 'd1', code: 'TEN', kind: 'percent', valuePct: 10 } as never],
      { ...context, code: 'TEN' },
    )

    expect(resolved?.discountCents).toBe(1000)
  })

  it('CONTROL: a cart with none of the scoped products is still refused', () => {
    // The eligibility gate that already worked must keep working — the change
    // is about the amount, not about who qualifies.
    const resolved = resolveDiscount(
      [
        {
          $id: 'd1',
          code: 'TEN',
          kind: 'percent',
          valuePct: 10,
          productIds: ['something-else'],
        } as never,
      ],
      { ...context, code: 'TEN' },
    )

    expect(resolved?.codeProblem).toMatch(/does not apply/)
    expect(resolved?.discountCents).toBe(0)
  })

  it('refuses a scoped discount when the cart did not say what lines cost', () => {
    // Falling back to the whole subtotal would be the defect restated, and a
    // second pricing path split by what the caller happened to pass.
    const resolved = resolveDiscount(
      [
        {
          $id: 'd1',
          code: 'TEN',
          kind: 'percent',
          valuePct: 10,
          productIds: ['in-scope'],
        } as never,
      ],
      { subtotalCents: 10000, productIds: ['in-scope'], code: 'TEN' },
    )

    expect(resolved?.codeProblem).toMatch(/what each item costs/)
    expect(resolved?.discountCents).toBe(0)
  })
})
