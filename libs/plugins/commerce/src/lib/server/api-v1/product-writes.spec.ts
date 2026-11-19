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

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, ApiErrors: {}, apiJson: jest.fn(), firebaseAdmin: {} }))

import { COMMERCE_DEFAULT_PRICE_USD } from '../../model/commerce'
import { blankProductDraft } from '../../model/product-write'
import { applyVariantWrite, mergeProductWrite, readProductWrite, readVariantWrite, unpricedProductDraft } from './product-writes'

/*
 * The product write's body and how it lands on a product (AGL-4235), apart
 * from the save: what is read, what is refused, and what the editor's own
 * moves make of it. The save itself is `save-product.spec.ts`'s.
 */

const LOAF = {
  ...blankProductDraft(),
  name: 'Loaf',
  slug: 'loaf',
  options: [{ name: 'Size', values: ['S', 'L'] }],
  variants: [
    { id: 'v_s', options: { Size: 'S' }, priceUsd: 5, sku: 'L-S', weightGrams: 400 },
    { id: 'v_l', options: { Size: 'L' }, priceUsd: 8 },
  ],
}

describe('readProductWrite', () => {
  it('reads the members it names, trimmed, and clears a description with null', () => {
    expect(readProductWrite({ name: ' Rye ', description: null, tags: [' a ', ''], categoryIds: ['c', 'c'] }, { create: true })).toEqual({
      values: { name: 'Rye', description: '', tags: ['a'], categoryIds: ['c'] },
    })
  })

  it('names every member it refuses', () => {
    const read = readProductWrite(
      { name: '', status: 'live', slug: 'Not a slug', mediaUrls: ['ftp://x'], options: [{ name: 'Size' }], extra: 1 },
      { create: false },
    )
    expect('errors' in read && Object.keys(read.errors).sort()).toEqual(['extra', 'mediaUrls', 'name', 'options[0].values', 'slug', 'status'])
  })

  it('needs a name only on a create', () => {
    expect(readProductWrite({}, { create: true })).toEqual({ errors: { name: 'Required, and not blank' } })
    expect(readProductWrite({}, { create: false })).toEqual({ values: {} })
  })
})

describe('readVariantWrite', () => {
  it('takes null to clear and refuses a negative, a fraction of stock and a target outside a product write', () => {
    expect(readVariantWrite({ priceUsd: null, sku: ' S1 ', inventory: 3 })).toEqual({ values: { priceUsd: null, sku: 'S1', inventory: 3 } })
    const read = readVariantWrite({ priceUsd: -1, inventory: 0.5, id: 'v' })
    expect('errors' in read && Object.keys(read.errors).sort()).toEqual(['id', 'inventory', 'priceUsd'])
  })

  it('in a product write, needs the variant named by id or options', () => {
    expect(readVariantWrite({ priceUsd: 1 }, { target: true, prefix: 'variants[0].' })).toEqual({
      errors: { 'variants[0].': 'Name the variant by its `id` or by its `options`' },
    })
  })
})

describe('mergeProductWrite', () => {
  it('changes a variant named by id or by options, clearing a number with null as the grid does', () => {
    const merged = mergeProductWrite(LOAF as never, { variants: [{ id: 'v_s', weightGrams: null, sku: null }, { options: { Size: 'L' }, priceUsd: 9 }] }, 1)
    expect('refusal' in merged).toBe(false)
    const [small, large] = (merged as typeof LOAF).variants
    expect(small).toEqual({ id: 'v_s', options: { Size: 'S' }, priceUsd: 5 })
    expect(large).toEqual({ id: 'v_l', options: { Size: 'L' }, priceUsd: 9 })
  })

  it('refuses two changes to one variant', () => {
    const merged = mergeProductWrite(LOAF as never, { variants: [{ id: 'v_s', priceUsd: 1 }, { options: { Size: 'S' }, priceUsd: 2 }] }, 1)
    expect(merged).toEqual({ refusal: expect.objectContaining({ status: 400, detail: { 'variants[1]': expect.any(String) } }) })
  })

  it('drops every option to one default variant, the editor’s product with no options', () => {
    const merged = mergeProductWrite(LOAF as never, { options: [] }, 1) as typeof LOAF
    expect(merged.options).toEqual([])
    expect(merged.variants).toHaveLength(1)
    expect(merged.variants[0]).toMatchObject({ options: {}, priceUsd: 5 })
  })

  it('applyVariantWrite sets stock as typed: a number counted, null untracked', () => {
    expect(applyVariantWrite({ id: 'v', priceUsd: 1, inventory: 3 }, { inventory: null })).toEqual({ id: 'v', priceUsd: 1, inventory: null })
    expect(applyVariantWrite({ id: 'v', priceUsd: 1 }, { inventory: 0 })).toEqual({ id: 'v', priceUsd: 1, inventory: 0 })
  })
})

describe('unpricedProductDraft', () => {
  it('is the editor’s blank draft with no price on its variant', () => {
    const draft = unpricedProductDraft()
    expect({ ...draft, variants: [] }).toEqual({ ...blankProductDraft(), variants: [] })
    expect(draft.variants).toEqual([{ id: 'default' }])
  })

  it('gives every combination a grid rebuild makes the first variant’s missing price', () => {
    const merged = mergeProductWrite(unpricedProductDraft(), { options: [{ name: 'Size', values: ['S', 'L'] }] }, 1)
    if ('refusal' in merged) throw new Error('refused')
    expect(merged.variants.map((variant) => 'priceUsd' in variant)).toEqual([false, false])
  })

  it('leaves the editor’s own blank draft at its default price', () => {
    expect(blankProductDraft().variants[0].priceUsd).toBe(COMMERCE_DEFAULT_PRICE_USD)
  })
})
