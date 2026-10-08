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

import { productSearchFields, productStockFields, type HostProduct } from './commerce'
import { productEditWrite, productSaveFields, smartCollectionRulesOf, stockAdjustmentWrite, type EditedProduct } from './product-write'

const product: EditedProduct = {
  $id: 'p1',
  name: '  Latte  ',
  slug: '',
  type: 'physical',
  status: 'active',
  mediaUrls: ['https://cdn.example/latte.png'],
  variants: [
    { id: 'small', priceUsd: 3.5, sku: 'LAT-S', inventory: 4 },
    { id: 'large', priceUsd: 4.25, inventory: 2 },
  ],
  skus: ['STALE'],
  barcodes: ['STALE'],
  stockHolds: { cs_1: { variantId: 'small', quantity: 1 } },
} as EditedProduct

describe('productSaveFields: what the product editor writes', () => {
  const fields = productSaveFields(product, 1_000)

  it('drops the listener id and the seeded codes', () => {
    expect(fields).not.toHaveProperty('$id')
    expect((fields as { skus?: string[] }).skus).toEqual(productSearchFields({ name: 'Latte', variants: product.variants }).skus)
    expect((fields as { skus?: string[] }).skus).not.toContain('STALE')
    expect(fields).not.toHaveProperty('barcodes')
  })

  it('writes the trimmed name with its search keys, the slug, price, stock, image and clock', () => {
    expect(fields).toMatchObject({
      ...productSearchFields({ name: 'Latte', variants: product.variants }),
      slug: 'latte',
      priceUsd: 3.5,
      ...productStockFields({ variants: product.variants, oversellPolicy: undefined }),
      imageUrl: 'https://cdn.example/latte.png',
      updatedAtMs: 1_000,
    })
  })

  it('an edit carries the live holds, not the seed, and stays live', () => {
    const live = { cs_9: { variantId: 'large', quantity: 2 } }
    expect(productEditWrite(fields, live)).toMatchObject({ stockHolds: live, deletedAt: null })
    expect(productEditWrite(fields, undefined)).not.toHaveProperty('stockHolds')
  })
})

describe('stockAdjustmentWrite: what Adjust stock writes', () => {
  const stored = product as HostProduct

  it('moves the count, the stock fields and appends the ledger row', () => {
    const write = stockAdjustmentWrite(stored, 'p1', { variantId: 'small', delta: 3, reason: 'restock' }, 2_000)!
    expect(write.update['variants']).toEqual([
      { id: 'small', priceUsd: 3.5, sku: 'LAT-S', inventory: 7 },
      { id: 'large', priceUsd: 4.25, inventory: 2 },
    ])
    expect(write.update['updatedAtMs']).toBe(2_000)
    expect(write.ledger).toEqual({ productId: 'p1', variantId: 'small', delta: 3, reason: 'restock', atMs: 2_000 })
  })

  it('writes nothing for no units, and names a location only when given', () => {
    expect(stockAdjustmentWrite(stored, 'p1', { variantId: 'small', delta: 0.2, reason: 'restock' }, 0)).toBeNull()
    expect(stockAdjustmentWrite(stored, 'p1', { variantId: 'small', delta: -1, reason: 'damage', locationId: 'loc1' }, 0)!.ledger.locationId).toBe('loc1')
  })
})

it('reads a smart collection as the membership rules do', () => {
  expect(smartCollectionRulesOf('c1', { matchAll: true })).toEqual({ id: 'c1', rules: [], matchAll: true })
})
