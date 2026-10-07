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

import { PRODUCT_LIST_QUERY } from '../../lib/constants/product-list-query'
import { createApiDouble, firestoreDouble as double } from '../testing/firestore-double'
import { planList } from './list-page'
import {
  adjustStock,
  applyProductEdit,
  blankProductEdit,
  checkProductEdit,
  createProduct,
  findProductsByCode,
  PRODUCT_FILTERS,
  productEditOf,
  productRow,
  productsListQuery,
  productsListRequest,
  updateProduct,
} from './products'

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)

const live = {
  name: 'Mug',
  slug: 'mug',
  type: 'physical',
  status: 'active',
  mediaUrls: ['https://cdn.example/h1/m1'],
  variants: [
    { id: 'small', priceUsd: 12, sku: 'MUG-S', inventory: 4 },
    { id: 'large', priceUsd: 16, sku: 'MUG-L', barcode: '0123', inventory: 2 },
  ],
  lowStockThreshold: 5,
  stockHolds: { cs_1: { small: 1 } },
  deletedAt: null,
}

const context = (respond?: (path: string, init: any) => unknown) => {
  const api = createApiDouble(respond)
  return { api, context: { firestore: double.db, hostId: 'h1', api: api.client, now: () => 1_000 } }
}

beforeEach(() => double.reset())

describe('the catalog list', () => {
  it.each(PRODUCT_FILTERS.map((filter) => [filter.id]))('asks the %s chip of the one query', (id) => {
    const plan = planList(PRODUCT_LIST_QUERY, productsListRequest({ filter: id, search: 'blue mug' }))
    expect(plan.refused).toEqual([])
    expect(plan.filters[0]).toEqual({ path: 'deletedAt', op: '==', value: null })
  })

  it('matches a scanned code whole and lower-cased, and drops the search beside it', () => {
    const request = productsListRequest({ filter: 'all', search: 'mug', code: { field: 'barcodes', value: 'ABC-1' } })
    expect(request.clauses).toEqual([{ field: 'barcodes', op: 'contains', value: 'abc-1' }])
    expect(request.search).toEqual([])
    expect(planList(PRODUCT_LIST_QUERY, request).refused).toEqual([])
  })

  it('reads a row once', () => {
    expect(productRow('p1', live)).toMatchObject({
      name: 'Mug',
      imageUrl: 'https://cdn.example/h1/m1',
      priceRange: [12, 16],
      inventory: 6,
      lowStock: false,
      variantCount: 2,
    })
  })

  it('finds a scanned code by barcode, then by SKU', async () => {
    double.setCollection('hosts/h1/products', [{ id: 'p1', data: live }])
    const { context: ctx } = context()
    const found = await findProductsByCode(ctx, ' mug-l ')
    expect(found.map((row) => row.id)).toEqual(['p1'])
    const asked = double.queries.map((entry) => entry.constraints.find((c: any) => c.op === 'array-contains'))
    expect(asked).toEqual([
      { type: 'where', path: 'barcodes', op: 'array-contains', value: 'mug-l' },
    ])
    await productsListQuery(ctx, { filter: 'active' }).queryFn({ pageParam: null })
    expect(double.queries.at(-1)!.constraints).toEqual(
      expect.arrayContaining([{ type: 'where', path: 'status', op: '==', value: 'active' }]),
    )
  })
})

describe('creating a product', () => {
  it('goes through the resources route under the id the editor minted, with every derived key', async () => {
    const { api, context: ctx } = context()
    const edit = { ...blankProductEdit(), name: 'Blue Mug', status: 'active' as const }
    edit.variants = [{ id: 'default', priceUsd: 18, sku: 'BM-1', barcode: '' }]
    await createProduct(ctx, { productId: 'new1', edit, inventory: 10 })
    expect(api.calls).toHaveLength(1)
    const { path, init } = api.calls[0]
    expect(path).toBe('hosts/resources')
    expect(init.body).toMatchObject({ hostId: 'h1', resource: 'product', id: 'new1' })
    expect(init.body.data).toMatchObject({
      name: 'Blue Mug',
      slug: 'blue-mug',
      nameLower: 'blue mug',
      skus: ['bm-1'],
      priceUsd: 18,
      priceFromCents: 1800,
      inventory: 10,
      soldOut: false,
      collectionIds: [],
      createdAtMs: 1_000,
    })
    expect(init.body.data.variants).toEqual([{ id: 'default', priceUsd: 18, sku: 'BM-1', inventory: 10 }])
  })

  it('counts a retry that finds its own product as the save', async () => {
    const { context: ctx } = context(() => {
      throw Object.assign(new Error('That id already exists'), { status: 409 })
    })
    const edit = { ...blankProductEdit(), name: 'Blue Mug' }
    await expect(createProduct(ctx, { productId: 'new1', edit })).resolves.toEqual({ id: 'new1' })
  })

  it('refuses what the console editor refuses, before any call', async () => {
    const { api, context: ctx } = context()
    await expect(createProduct(ctx, { productId: 'x', edit: blankProductEdit() })).rejects.toThrow(/name is required/)
    expect(api.calls).toEqual([])
  })
})

describe('editing a product', () => {
  it('writes the edit over the LIVE document, keeping its stock and holds', async () => {
    double.setDoc('hosts/h1/products/p1', live)
    const { api, context: ctx } = context()
    const edit = productEditOf(live as never)
    edit.name = 'Big Mug'
    edit.variants[1].barcode = ''
    edit.variants[1].priceUsd = 20
    // Someone sold the last large mugs after the phone opened the product.
    double.setDoc('hosts/h1/products/p1', {
      ...live,
      variants: [live.variants[0], { ...live.variants[1], inventory: 0 }],
    })
    await updateProduct(ctx, { productId: 'p1', edit })
    const write = double.writes.find((entry) => entry.path === 'hosts/h1/products/p1') as any
    expect(write.kind).toBe('update')
    expect(write.data.variants[1]).toEqual({ id: 'large', priceUsd: 20, sku: 'MUG-L', inventory: 0 })
    expect(write.data).toMatchObject({ name: 'Big Mug', nameLower: 'big mug', inventory: 4, barcodes: { deleteField: true } })
    expect(write.data).not.toHaveProperty('stockHolds')
    // The cache drop is staged in the same commit, then asked for.
    expect(double.writes.some((entry) => entry.path.startsWith('publishOutbox/'))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.calls.map((call) => call.path)).toContain('screens/revalidate')
  })

  it('applies only what the editor edits', () => {
    const next = applyProductEdit(live as never, { ...productEditOf(live as never), status: 'archived' })
    expect(next.variants).toEqual(live.variants)
    expect(next.status).toBe('archived')
    expect(checkProductEdit(live as never, { ...productEditOf(live as never), name: ' ' })).toMatch(/required/)
  })
})

describe('counting stock', () => {
  it('moves the live count and writes the ledger row in one commit', async () => {
    double.setDoc('hosts/h1/products/p1', live)
    const { context: ctx } = context()
    const result = await adjustStock(ctx, { productId: 'p1', variantId: 'large', delta: -5, reason: 'damage' })
    expect(result.inventory).toBe(4)
    const update = double.writes.find((entry) => entry.path === 'hosts/h1/products/p1') as any
    expect(update.data.variants[1].inventory).toBe(0)
    const ledger = double.writes.find((entry) => entry.path.startsWith('hosts/h1/inventoryAdjustments/')) as any
    expect(ledger.data).toEqual({
      productId: 'p1',
      variantId: 'large',
      delta: -5,
      appliedDelta: -2,
      reason: 'damage',
      atMs: 1_000,
    })
  })

  it('refuses an untracked variant and a zero', async () => {
    double.setDoc('hosts/h1/products/p1', { ...live, variants: [{ id: 'small', priceUsd: 12, inventory: null }] })
    const { context: ctx } = context()
    await expect(adjustStock(ctx, { productId: 'p1', variantId: 'small', delta: 1, reason: 'restock' })).rejects.toThrow(/not tracked/)
    await expect(adjustStock(ctx, { productId: 'p1', variantId: 'small', delta: 0, reason: 'restock' })).rejects.toThrow(/number of units/)
  })

  it('writes nothing when the commit is refused', async () => {
    double.setDoc('hosts/h1/products/p1', live)
    double.failNextCommit(Object.assign(new Error('nope'), { code: 'aborted' }))
    const { context: ctx } = context()
    await expect(adjustStock(ctx, { productId: 'p1', variantId: 'small', delta: 1, reason: 'restock' })).rejects.toThrow('nope')
    expect(double.writes).toEqual([])
  })
})
