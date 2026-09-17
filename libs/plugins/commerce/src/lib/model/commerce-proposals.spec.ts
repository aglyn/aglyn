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
  canPurchase,
  productCopyPatch,
  productPriceMissing,
  unpricedProductDraft,
  validateProduct,
  variantHasPrice,
  type HostProduct,
} from './commerce'
import { switchedOffDiscount } from './commerce-discounts'

/**
 * What the catalog does with a proposal (AGL-2916): copy written onto a
 * product, a proposed product created with no price, and a proposed discount
 * created switched off.
 */

const LAMP: HostProduct = {
  name: 'Brass desk lamp',
  slug: 'brass-desk-lamp',
  type: 'physical',
  status: 'active',
  description: 'A lamp.',
  tags: ['lighting'],
  options: [
    { name: 'finish', values: ['Brass', 'Black'] },
    { name: 'bulb', values: ['Warm', 'Cool'] },
  ],
  variants: [
    { id: 'v1', options: { finish: 'Brass', bulb: 'Warm' }, priceUsd: 40, sku: 'L-BW', inventory: 3 },
    { id: 'v2', options: { finish: 'Black', bulb: 'Cool' }, priceUsd: 42, sku: 'L-KC', inventory: 0 },
  ],
  seo: { title: 'Lamp', imageUrl: 'media:host-1/share' },
}

describe('a price a sale can charge', () => {
  it('is a finite number of zero or more, and nothing else', () => {
    expect(variantHasPrice({ priceUsd: 0 })).toBe(true)
    expect(variantHasPrice({ priceUsd: 12.5 })).toBe(true)
    for (const priceUsd of [undefined, null, Number.NaN, -1, Number.POSITIVE_INFINITY, '12']) {
      expect([priceUsd, variantHasPrice({ priceUsd } as never)]).toEqual([priceUsd, false])
    }
    expect(variantHasPrice(undefined)).toBe(false)
  })

  it('is missing from a product when any variant has none', () => {
    expect(productPriceMissing(LAMP)).toBe(false)
    expect(productPriceMissing({ variants: [{ priceUsd: 40 }, {}] })).toBe(true)
  })

  it('is what the editor waits for before it saves, in words that say so', () => {
    const unpriced = { ...LAMP, variants: [{ id: 'default' }] } as unknown as HostProduct
    expect(validateProduct(unpriced)).toBe('Set a price for every variant')
    expect(validateProduct({ ...LAMP, variants: [{ id: 'default', priceUsd: 0 }], options: [] })).toBeNull()
  })
})

describe('copy written onto a product', () => {
  it('changes only the fields the copy names, and keeps the listing’s share image', () => {
    expect(productCopyPatch(LAMP, {})).toEqual({})
    expect(
      productCopyPatch(LAMP, {
        description: 'Adjustable brass desk lamp.',
        tags: [' lighting ', 'desk', 'desk', ''],
        categoryIds: ['cat-1', 'cat-1'],
        seoDescription: 'A brass lamp for the desk.',
      }),
    ).toEqual({
      description: 'Adjustable brass desk lamp.',
      tags: ['lighting', 'desk'],
      categoryIds: ['cat-1'],
      seo: { title: 'Lamp', imageUrl: 'media:host-1/share', description: 'A brass lamp for the desk.' },
    })
  })

  it('renames options with every variant’s id, price, SKU and stock kept', () => {
    const patch = productCopyPatch(LAMP, { optionNames: ['Finish', 'Bulb color'] })
    expect(patch.options).toEqual([
      { name: 'Finish', values: ['Brass', 'Black'] },
      { name: 'Bulb color', values: ['Warm', 'Cool'] },
    ])
    expect(patch.variants).toEqual([
      { id: 'v1', options: { Finish: 'Brass', 'Bulb color': 'Warm' }, priceUsd: 40, sku: 'L-BW', inventory: 3 },
      { id: 'v2', options: { Finish: 'Black', 'Bulb color': 'Cool' }, priceUsd: 42, sku: 'L-KC', inventory: 0 },
    ])
  })

  it('renames nothing for names that do not name each option once with a name of its own', () => {
    for (const optionNames of [['Finish'], ['Finish', 'Finish'], ['Finish', ' '], ['finish', 'bulb'], ['A', 'B', 'C']]) {
      expect([optionNames, productCopyPatch(LAMP, { optionNames })]).toEqual([optionNames, {}])
    }
  })
})

describe('a proposed product, created', () => {
  const PROPOSAL = {
    name: '  Wild mint soy candle ',
    type: 'physical' as const,
    description: 'A hand-poured soy candle.\n\nBurn time: [hours].',
    tags: ['candle', ' candle', 'soy'],
    options: [
      { name: 'Size', values: ['8 oz', '16 oz', '8 oz'] },
      { name: 'Size', values: ['Large'] },
      { name: 'Scent', values: [] },
    ],
    seoTitle: 'Wild mint soy candle',
    seoDescription: '',
  }

  it('is a draft with one variant a combination and no price on any, under a slug of its own', () => {
    const draft = unpricedProductDraft(PROPOSAL, new Set(['wild-mint-soy-candle', 'wild-mint-soy-candle-2']), 1_700_000_000_000)
    expect(draft).toMatchObject({
      name: 'Wild mint soy candle',
      nameLower: 'wild mint soy candle',
      slug: 'wild-mint-soy-candle-3',
      type: 'physical',
      status: 'draft',
      description: 'A hand-poured soy candle.\n\nBurn time: [hours].',
      tags: ['candle', 'soy'],
      options: [{ name: 'Size', values: ['8 oz', '16 oz'] }],
      seo: { title: 'Wild mint soy candle' },
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_000_000,
    })
    expect(draft.variants.map((variant) => variant.options)).toEqual([{ Size: '8 oz' }, { Size: '16 oz' }])
    expect(draft.variants.every((variant) => !('priceUsd' in variant))).toBe(true)
    expect('priceUsd' in draft).toBe(false)
    expect(productPriceMissing(draft)).toBe(true)
    expect(validateProduct(draft as unknown as HostProduct)).toBe('Set a price for every variant')
  })

  it('has one default variant when it has no options, and is never sold before it is priced', () => {
    const draft = unpricedProductDraft({ ...PROPOSAL, options: [] }, new Set(), 1)
    expect(draft.variants).toEqual([{ id: 'default' }])
    expect('options' in draft).toBe(false)
    // Stock is untracked, so only the price stands between it and a sale.
    expect(canPurchase(draft as unknown as HostProduct, 'default')).toBe(true)
    expect(variantHasPrice(draft.variants[0])).toBe(false)
  })
})

describe('a proposed discount, created', () => {
  const base = { name: ' Welcome ', code: ' welcome 10! ', valuePct: null, valueCents: null, minSubtotalCents: null }

  it('is switched off with no redemptions, its code as the discounts card stores one', () => {
    expect(switchedOffDiscount({ ...base, kind: 'percent', valuePct: 10 })).toEqual({
      name: 'Welcome',
      code: 'WELCOME10',
      kind: 'percent',
      valuePct: 10,
      enabled: false,
      redemptions: 0,
    })
    expect(switchedOffDiscount({ ...base, code: null, kind: 'fixed', valueCents: 500, minSubtotalCents: 5_000 })).toEqual({
      name: 'Welcome',
      code: null,
      kind: 'fixed',
      valueCents: 500,
      minSubtotalCents: 5_000,
      enabled: false,
      redemptions: 0,
    })
    expect(switchedOffDiscount({ ...base, kind: 'free_shipping', valuePct: 50 })).toEqual({
      name: 'Welcome',
      code: 'WELCOME10',
      kind: 'free_shipping',
      enabled: false,
      redemptions: 0,
    })
  })

  it('is not made at all from a value no discount can take', () => {
    expect(switchedOffDiscount({ ...base, kind: 'percent', valuePct: 0 })).toBeNull()
    expect(switchedOffDiscount({ ...base, kind: 'percent', valuePct: 150 })).toBeNull()
    expect(switchedOffDiscount({ ...base, kind: 'fixed', valueCents: 0 })).toBeNull()
    expect(switchedOffDiscount({ ...base, kind: 'bogus' as never })).toBeNull()
  })
})
