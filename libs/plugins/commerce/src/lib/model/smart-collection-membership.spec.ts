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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type HostCollection,
  type HostProduct,
  liftLegacyProduct,
  matchesCollection,
  productCollectionIds,
  smartCollectionMatches,
} from './commerce'

/**
 * A smart collection's membership is WRITTEN on its products (AGL-3321): the
 * storefront reads a collection no query can express as `collectionIds
 * array-contains <id>`. These pin the derivation every writer spreads, against
 * the worked examples the backfill's script-side twin
 * (`tools/scripts/lib/product-collection-ids.mjs`) is held to as well.
 */

const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../tools/scripts/lib/product-collection-ids.fixtures.json'),
    'utf8',
  ),
) as {
  collections: Array<{ id: string } & Pick<HostCollection, 'rules' | 'matchAll'>>
  cases: Array<{ name: string; product: Partial<HostProduct>; expected: string[] }>
}

describe('productCollectionIds', () => {
  it('answers the fixtures the script-side twin answers', () => {
    expect(fixtures.cases.length).toBeGreaterThan(0)
    for (const { name, product, expected } of fixtures.cases) {
      expect({
        name,
        ids: productCollectionIds(liftLegacyProduct(product as HostProduct), fixtures.collections),
      }).toEqual({ name, ids: expected })
    }
  })

  it('is about the rules alone, so archiving a product leaves its membership', () => {
    const product = liftLegacyProduct({ name: 'Walnut Chair', status: 'archived', priceUsd: 5 })
    const collection = { rules: [{ field: 'name' as const, op: 'contains' as const, value: 'walnut' }] }
    expect(smartCollectionMatches(product, collection)).toBe(true)
    // The storefront's own scope — live and active — is what keeps it off sale.
    expect(
      matchesCollection(product, { ...collection, name: 'W', slug: 'w', mode: 'smart' }),
    ).toBe(false)
  })

  it('holds nothing for a collection with no rules', () => {
    expect(smartCollectionMatches(liftLegacyProduct({ name: 'A' }), { rules: [] })).toBe(false)
  })
})
