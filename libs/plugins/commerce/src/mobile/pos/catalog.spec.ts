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

import { firestoreDouble as double } from '../testing/firestore-double'
import {
  categoryLevel,
  findItemByCode,
  itemNeedsSheet,
  pickOf,
  posCategoryFrom,
  posGridPlan,
  posGridQuery,
  posItemFrom,
  variantForCode,
} from './catalog'

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)

const LATTE = {
  name: 'Latte',
  slug: 'latte',
  type: 'physical',
  status: 'active',
  deletedAt: null,
  categoryIds: ['drinks'],
  options: [{ name: 'Size', values: ['Small', 'Large'] }],
  variants: [
    { id: 'v-small', options: { Size: 'Small' }, priceUsd: 3.5, sku: 'LAT-S', barcode: '0001' },
    { id: 'v-large', options: { Size: 'Large' }, priceUsd: 4.25, sku: 'LAT-L', barcode: '0002', inventory: 0 },
  ],
  modifierGroups: [
    {
      id: 'milk',
      name: 'Milk',
      min: 1,
      max: 1,
      options: [
        { id: 'whole', name: 'Whole', priceCents: 0 },
        { id: 'oat', name: 'Oat milk', priceCents: 75 },
      ],
    },
  ],
}

beforeEach(() => double.reset())

describe('the item grid (AGL-3618)', () => {
  it('reads a product as tiles price it: cents, options, modifiers', () => {
    const item = posItemFrom('p-latte', LATTE)
    expect(item).toMatchObject({ id: 'p-latte', name: 'Latte', fromCents: 350, toCents: 425, categoryIds: ['drinks'] })
    expect(item.variants.map((variant) => [variant.id, variant.label, variant.unitCents, variant.inventory])).toEqual([
      ['v-small', 'Small', 350, null],
      ['v-large', 'Large', 425, 0],
    ])
    expect(item.modifierGroups).toHaveLength(1)
    expect(itemNeedsSheet(item)).toBe(true)
    expect(itemNeedsSheet(posItemFrom('p-bag', { name: 'Bag', priceUsd: 1 }))).toBe(false)
  })

  it('prices a pick with its modifiers, and refuses a missing required choice or price', () => {
    const item = posItemFrom('p-latte', LATTE)
    expect(pickOf(item, item.variants[1], [{ groupId: 'milk', optionId: 'oat' }])).toEqual({
      productId: 'p-latte',
      variantId: 'v-large',
      name: 'Latte',
      variantLabel: 'Large / Oat milk',
      modifiers: [{ groupId: 'milk', optionId: 'oat' }],
      unitCents: 500,
    })
    expect(pickOf(item, item.variants[1])).toEqual({ problem: 'Choose milk for Latte.' })
    const unpriced = posItemFrom('p-x', { name: 'Mystery', variants: [{ id: 'default', priceUsd: undefined }] })
    expect(pickOf(unpriced, unpriced.variants[0])).toEqual({ problem: 'Set a price for Mystery before selling it.' })
    const plain = posItemFrom('p-bag', { name: 'Bag', priceUsd: 1 })
    expect(pickOf(plain, plain.variants[0])).toMatchObject({ variantId: null, variantLabel: null, unitCents: 100 })
  })

  it('plans the products hub query: live, active, and one of search, category or quick keys', () => {
    const paths = (plan: ReturnType<typeof posGridPlan>) => plan.filters.map((filter) => [filter.path, filter.op, filter.value])
    expect(paths(posGridPlan({}))).toEqual([
      ['deletedAt', '==', null],
      ['status', '==', 'active'],
    ])
    expect(paths(posGridPlan({ categoryId: 'drinks' }))).toContainEqual(['categoryIds', 'array-contains', 'drinks'])
    expect(paths(posGridPlan({ quickKeys: true, categoryId: 'drinks' }))).toContainEqual(['posQuickKey', '==', true])
    // A typed word searches the whole catalog, past any narrowing.
    const searched = paths(posGridPlan({ search: 'lat', quickKeys: true, categoryId: 'drinks' }))
    expect(searched.some(([path]) => path === 'posQuickKey' || path === 'categoryIds')).toBe(false)
    expect(searched.some(([path]) => path === 'nameTokens')).toBe(true)
    expect(posGridPlan({}).orderBy.path).toBe('nameLower')
  })

  it('pages the grid from Firestore with the planned query', async () => {
    double.setCollection('hosts/h1/products', [{ id: 'p-latte', data: LATTE }])
    const page = await posGridQuery(double.db, 'h1', {}).queryFn({ pageParam: null })
    expect(page.rows.map((row) => row.id)).toEqual(['p-latte'])
    expect(double.queries[0].path).toBe('hosts/h1/products')
  })

  it('looks a scan up across the catalog, barcode first, then SKU', async () => {
    double.setCollection('hosts/h1/products', [{ id: 'p-latte', data: LATTE }])
    const found = await findItemByCode(double.db, 'h1', ' 0002 ')
    expect(found).toMatchObject({ kind: 'found', variant: { id: 'v-large' } })
    const barcodeQuery = double.queries[0].constraints as Array<{ path?: unknown; value?: unknown }>
    expect(barcodeQuery).toContainEqual(expect.objectContaining({ path: 'barcodes', value: '0002' }))
    expect(variantForCode(posItemFrom('p', LATTE), 'lat-s')?.id).toBe('v-small')
    double.reset()
    expect(await findItemByCode(double.db, 'h1', 'nope')).toEqual({ kind: 'missing', code: 'nope' })
    expect(await findItemByCode(double.db, 'h1', '   ')).toEqual({ kind: 'unreadable' })
  })

  it('lays categories out a level at a time, orphans at the top', () => {
    const categories = [
      posCategoryFrom('b', { name: 'Bakery', order: 2 }),
      posCategoryFrom('d', { name: 'Drinks', order: 1 }),
      posCategoryFrom('hot', { name: 'Hot', parentId: 'd' }),
      posCategoryFrom('lost', { name: 'Lost', parentId: 'gone' }),
    ]
    expect(categoryLevel(categories, null).map((entry) => entry.id)).toEqual(['d', 'b', 'lost'])
    expect(categoryLevel(categories, 'd').map((entry) => entry.id)).toEqual(['hot'])
  })
})
