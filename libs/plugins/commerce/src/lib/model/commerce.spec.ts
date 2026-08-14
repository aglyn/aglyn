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
  adjustVariantInventory,
  canPurchase,
  commerceSlug,
  expandVariantMatrix,
  findVariant,
  isLowStock,
  liftLegacyProduct,
  matchesCollection,
  productInventory,
  productPriceRange,
  registersWithinCap,
  resolveCheckoutBillingMode,
  stockTrackingApplies,
  transferVariantInventory,
  validateCollection,
  validateProduct,
  type HostCollection,
  type HostProduct,
} from './commerce'

function product(overrides: Partial<HostProduct> = {}): HostProduct {
  return {
    name: 'Front Brake Pads',
    slug: 'front-brake-pads',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 25 }],
    ...overrides,
  }
}

describe('commerceSlug', () => {
  it('kebab-cases and strips diacritics/symbols', () => {
    expect(commerceSlug('Öhlins Shock — 46mm!')).toBe('ohlins-shock-46mm')
  })
  it('trims leading/trailing dashes', () => {
    expect(commerceSlug('  --Sale!--  ')).toBe('sale')
  })
})

describe('expandVariantMatrix', () => {
  it('returns a single default combo without options', () => {
    expect(expandVariantMatrix(undefined)).toEqual([{}])
    expect(expandVariantMatrix([])).toEqual([{}])
  })
  it('builds the cartesian product', () => {
    const combos = expandVariantMatrix([
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Color', values: ['Red', 'Blue'] },
    ])
    expect(combos).toHaveLength(4)
    expect(combos).toContainEqual({ Size: 'M', Color: 'Blue' })
  })
  it('caps at the variant ceiling', () => {
    const many = Array.from({ length: 30 }, (_, index) => `v${index}`)
    const combos = expandVariantMatrix([
      { name: 'A', values: many },
      { name: 'B', values: many },
    ])
    expect(combos.length).toBeLessThanOrEqual(100)
  })
})

describe('findVariant / productPriceRange / productInventory', () => {
  const multi = product({
    options: [{ name: 'Size', values: ['S', 'M'] }],
    variants: [
      { id: 's', options: { Size: 'S' }, priceUsd: 20, inventory: 3 },
      { id: 'm', options: { Size: 'M' }, priceUsd: 30, inventory: null },
    ],
  })
  it('matches exact option selections only', () => {
    expect(findVariant(multi, { Size: 'M' })?.id).toBe('m')
    expect(findVariant(multi, { Size: 'L' })).toBeUndefined()
    expect(findVariant(multi, {})).toBeUndefined()
  })
  it('computes the price range', () => {
    expect(productPriceRange(multi)).toEqual([20, 30])
    expect(productPriceRange({ variants: [] })).toEqual([0, 0])
  })
  it('sums only tracked inventory, null when all untracked', () => {
    expect(productInventory(multi)).toBe(3)
    expect(
      productInventory({ variants: [{ id: 'x', priceUsd: 1 }] }),
    ).toBeNull()
  })
})

describe('matchesCollection', () => {
  const smart: HostCollection = {
    name: 'Under $50',
    slug: 'under-50',
    mode: 'smart',
    rules: [
      { field: 'priceUsd', op: 'lt', value: 50 },
      { field: 'tag', op: 'eq', value: 'brakes' },
    ],
  }
  it('applies AND semantics by default', () => {
    expect(matchesCollection(product({ tags: ['brakes'] }), smart)).toBe(true)
    expect(matchesCollection(product({ tags: [] }), smart)).toBe(false)
  })
  it('applies OR semantics when matchAll is false', () => {
    expect(
      matchesCollection(product({ tags: [] }), { ...smart, matchAll: false }),
    ).toBe(true)
  })
  it('never matches draft or deleted products', () => {
    expect(
      matchesCollection(product({ status: 'draft', tags: ['brakes'] }), smart),
    ).toBe(false)
    expect(
      matchesCollection(
        product({ deletedAt: 1, tags: ['brakes'] }),
        smart,
      ),
    ).toBe(false)
  })
  it('answers manual collections from productIds', () => {
    const manual: HostCollection = {
      name: 'Featured',
      slug: 'featured',
      mode: 'manual',
      productIds: ['p1'],
    }
    expect(matchesCollection(product(), manual, 'p1')).toBe(true)
    expect(matchesCollection(product(), manual, 'p2')).toBe(false)
  })
})

describe('liftLegacyProduct', () => {
  it('lifts a Commerce Starter doc into a default variant', () => {
    const lifted = liftLegacyProduct({
      name: 'Sticker pack',
      priceUsd: 5,
      inventory: 10,
    })
    expect(lifted.variants).toEqual([
      { id: 'default', priceUsd: 5, inventory: 10 },
    ])
    expect(lifted.slug).toBe('sticker-pack')
    expect(lifted.status).toBe('active')
  })
  it('passes catalog-shaped docs through unchanged', () => {
    const shaped = product()
    expect(liftLegacyProduct(shaped)).toBe(shaped)
  })
})

describe('validateProduct', () => {
  it('accepts a minimal valid product', () => {
    expect(validateProduct(product())).toBeNull()
  })
  it('rejects bad slugs, empty variants, dup ids/skus, bad prices', () => {
    expect(validateProduct(product({ slug: 'Bad Slug' }))).toMatch(/Slug/)
    expect(validateProduct(product({ variants: [] }))).toMatch(/variant/)
    expect(
      validateProduct(
        product({
          variants: [
            { id: 'a', priceUsd: 1 },
            { id: 'a', priceUsd: 2 },
          ],
        }),
      ),
    ).toMatch(/unique/)
    expect(
      validateProduct(
        product({
          variants: [
            { id: 'a', priceUsd: 1, sku: 'X' },
            { id: 'b', priceUsd: 2, sku: 'X' },
          ],
        }),
      ),
    ).toMatch(/SKU/)
    expect(
      validateProduct(product({ variants: [{ id: 'a', priceUsd: -1 }] })),
    ).toMatch(/zero or more/)
    expect(
      validateProduct(product({ variants: [{ id: 'a', priceUsd: 20000 }] })),
    ).toMatch(/capped/)
  })
  it('rejects compare-at at or below price', () => {
    expect(
      validateProduct(
        product({
          variants: [{ id: 'a', priceUsd: 10, compareAtPriceUsd: 10 }],
        }),
      ),
    ).toMatch(/Compare-at/)
  })
})

describe('inventory (AGL-281)', () => {
  const tracked = product({
    variants: [
      { id: 'a', priceUsd: 10, inventory: 2 },
      { id: 'b', priceUsd: 12, inventory: 0 },
      { id: 'c', priceUsd: 14 },
    ],
  })

  it('allows untracked, denies exhausted, backorder overrides', () => {
    expect(canPurchase(tracked, 'a', 2)).toBe(true)
    expect(canPurchase(tracked, 'a', 3)).toBe(false)
    expect(canPurchase(tracked, 'b')).toBe(false)
    expect(canPurchase(tracked, 'c')).toBe(true)
    expect(canPurchase({ ...tracked, oversellPolicy: 'backorder' }, 'b')).toBe(
      true,
    )
    expect(canPurchase(tracked, 'missing')).toBe(false)
    // No variantId = default (first) variant.
    expect(canPurchase(tracked, undefined)).toBe(true)
  })

  it('adjustVariantInventory floors at zero and skips untracked', () => {
    const sold = adjustVariantInventory(tracked, 'a', -3)
    expect(sold.find((v: any) => v.id === 'a').inventory).toBe(0)
    const restocked = adjustVariantInventory(tracked, 'b', 5)
    expect(restocked.find((v: any) => v.id === 'b').inventory).toBe(5)
    const untouched = adjustVariantInventory(tracked, 'c', -1)
    expect(untouched.find((v: any) => v.id === 'c').inventory).toBeUndefined()
  })

  it('adjusts per-location buckets and re-sums the flat total (AGL-286)', () => {
    const multiLocation = product({
      variants: [
        {
          id: 'a',
          priceUsd: 10,
          inventory: 5,
          inventoryByLocation: { main: 3, store: 2 },
        },
      ],
    })
    const adjusted = adjustVariantInventory(multiLocation, 'a', -2, 'main')
    expect(adjusted[0].inventoryByLocation).toEqual({ main: 1, store: 2 })
    expect(adjusted[0].inventory).toBe(3)
  })

  it('transfers between locations without changing the total', () => {
    const multiLocation = product({
      variants: [
        {
          id: 'a',
          priceUsd: 10,
          inventory: 5,
          inventoryByLocation: { main: 3, store: 2 },
        },
      ],
    })
    const moved = transferVariantInventory(multiLocation, 'a', 'main', 'store', 99)
    expect(moved[0].inventoryByLocation).toEqual({ main: 0, store: 5 })
    // Untracked variants and empty sources are no-ops.
    const untouched = transferVariantInventory(
      product(),
      'default',
      'x',
      'y',
      1,
    )
    expect(untouched[0].inventoryByLocation).toBeUndefined()
  })

  it('isLowStock compares tracked totals to the threshold', () => {
    expect(isLowStock({ ...tracked, lowStockThreshold: 2 })).toBe(true)
    expect(isLowStock({ ...tracked, lowStockThreshold: 1 })).toBe(false)
    expect(isLowStock(tracked)).toBe(false)
    // Fully untracked products never alert.
    expect(
      isLowStock({
        variants: [{ id: 'x', priceUsd: 1 }],
        lowStockThreshold: 5,
      }),
    ).toBe(false)
  })
})

describe('validateCollection', () => {
  it('accepts manual and rule-complete smart collections', () => {
    expect(
      validateCollection({
        name: 'Featured',
        slug: 'featured',
        mode: 'manual',
      }),
    ).toBeNull()
    expect(
      validateCollection({
        name: 'Cheap',
        slug: 'cheap',
        mode: 'smart',
        rules: [{ field: 'priceUsd', op: 'lt', value: 10 }],
      }),
    ).toBeNull()
  })
  it('rejects smart collections without rules', () => {
    expect(
      validateCollection({ name: 'X', slug: 'x', mode: 'smart', rules: [] }),
    ).toMatch(/rule/)
  })
})

describe('registersWithinCap (AGL-482)', () => {
  const reg = (id: string, sec: number) => ({
    $id: id,
    createdAt: { toMillis: () => sec * 1000 },
  })

  it('keeps the oldest N registers by creation order', () => {
    const registers = [reg('c', 3), reg('a', 1), reg('b', 2)]
    expect([...registersWithinCap(registers, 2)]).toEqual(['a', 'b'])
    expect([...registersWithinCap(registers, 1)]).toEqual(['a'])
  })

  it('returns all when cap covers the count (and for Infinity)', () => {
    const registers = [reg('a', 1), reg('b', 2)]
    expect(registersWithinCap(registers, 2).size).toBe(2)
    expect(registersWithinCap(registers, 5).size).toBe(2)
    expect(registersWithinCap(registers, Infinity).size).toBe(2)
  })

  it('excludes everything when the cap is 0', () => {
    expect(registersWithinCap([reg('a', 1)], 0).size).toBe(0)
  })

  it('breaks ties by id so the ranking is stable', () => {
    const registers = [reg('b', 1), reg('a', 1)]
    expect([...registersWithinCap(registers, 1)]).toEqual(['a'])
  })

  it('treats a missing createdAt as oldest (0)', () => {
    const registers = [reg('new', 5), { $id: 'legacy' } as any]
    expect([...registersWithinCap(registers, 1)]).toEqual(['legacy'])
  })
})

describe('resolveCheckoutBillingMode (AGL-545)', () => {
  const monthly = { interval: 'month' as const }

  it('is always payment without a subscription, whatever is requested', () => {
    expect(resolveCheckoutBillingMode({}, undefined)).toBe('payment')
    expect(resolveCheckoutBillingMode({}, 'subscribe')).toBe('payment')
    expect(resolveCheckoutBillingMode({}, 'once')).toBe('payment')
  })

  it('ignores the request on subscription-only products', () => {
    const only = { subscription: monthly }
    expect(resolveCheckoutBillingMode(only, undefined)).toBe('subscription')
    expect(resolveCheckoutBillingMode(only, 'subscribe')).toBe('subscription')
    // A forged 'once' cannot buy a subscription product one-time.
    expect(resolveCheckoutBillingMode(only, 'once')).toBe('subscription')
  })

  it('honors the buyer choice on subscriptionOptional products', () => {
    const optional = { subscription: monthly, subscriptionOptional: true }
    expect(resolveCheckoutBillingMode(optional, 'subscribe')).toBe(
      'subscription',
    )
    expect(resolveCheckoutBillingMode(optional, 'once')).toBe('payment')
  })

  it('defaults optional products to one-time (matching the PDP)', () => {
    const optional = { subscription: monthly, subscriptionOptional: true }
    expect(resolveCheckoutBillingMode(optional, undefined)).toBe('payment')
    expect(resolveCheckoutBillingMode(optional, null)).toBe('payment')
    expect(resolveCheckoutBillingMode(optional, 'garbage')).toBe('payment')
  })

  it('treats subscriptionOptional without subscription as one-time', () => {
    expect(
      resolveCheckoutBillingMode({ subscriptionOptional: true }, 'subscribe'),
    ).toBe('payment')
  })
})

/**
 * Stock tracking is inert on a subscription-only product: nothing decrements
 * it on the initial charge (AGL-1732) or on a renewal (AGL-1743), so the
 * console must stop offering the number rather than maintain a false one.
 *
 * Each case is asserted individually — a single `toBe(false)` on the
 * subscription-only shape would pass against a predicate that returned
 * `!product.subscription`, which is the wrong answer for "Both".
 */
describe('stockTrackingApplies (AGL-1744)', () => {
  const monthly = { interval: 'month' } as const

  it('applies to a plain one-time product', () => {
    expect(stockTrackingApplies({})).toBe(true)
  })

  it('does NOT apply to a subscription-only product', () => {
    expect(stockTrackingApplies({ subscription: monthly })).toBe(false)
    expect(stockTrackingApplies({ subscription: { interval: 'year' } })).toBe(
      false,
    )
    // Explicitly false is still subscription-only, not "Both".
    expect(
      stockTrackingApplies({
        subscription: monthly,
        subscriptionOptional: false,
      }),
    ).toBe(false)
  })

  /**
   * The half that must keep working. A "Both" product genuinely sells
   * one-time — the cart only ever builds `mode: 'payment'`, and buy-now with
   * `billing: 'once'` records a plain order that decrements — so withdrawing
   * tracking here would delete a control that works.
   */
  it('DOES apply to a subscriptionOptional ("Both") product', () => {
    expect(
      stockTrackingApplies({
        subscription: monthly,
        subscriptionOptional: true,
      }),
    ).toBe(true)
  })

  it('is not fooled by product type — a physical box is no truer', () => {
    // `type` is deliberately not an input: a physical subscription wants a
    // per-renewal decrement, which AGL-1743 blocks.
    expect(
      stockTrackingApplies(
        product({ type: 'physical', subscription: monthly }),
      ),
    ).toBe(false)
    expect(
      stockTrackingApplies(product({ type: 'digital', subscription: monthly })),
    ).toBe(false)
  })

  /**
   * The predicate must not have moved the gate every other purchase path
   * shares. Pinned here because AGL-1744's whole risk was altering it as a
   * side effect.
   */
  it('leaves canPurchase untouched for one-time products', () => {
    const oneTime = product({
      variants: [
        { id: 'a', priceUsd: 10, inventory: 2 },
        { id: 'b', priceUsd: 12, inventory: 0 },
      ],
    })
    expect(canPurchase(oneTime, 'a', 2)).toBe(true)
    expect(canPurchase(oneTime, 'a', 3)).toBe(false)
    expect(canPurchase(oneTime, 'b')).toBe(false)
  })
})
