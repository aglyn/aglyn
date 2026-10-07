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

const lowStockAlerts: Array<{ hostId: string; before: any; after: any }> = []

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { firestore: { FieldPath: { documentId: () => '__name__' } } },
}))
jest.mock('./low-stock', () => ({
  alertLowStockCrossing: (hostId: string, before: any, after: any) => lowStockAlerts.push({ hostId, before, after }),
}))

import { setAvailableStock } from './stock-levels'

/** Documents by slash path; queries over one collection's direct children in id order. */
function fakeFirestore(seed: Record<string, Record<string, any>>) {
  const docs = new Map(Object.entries(seed).map(([path, data]) => [path, JSON.parse(JSON.stringify(data))]))
  let auto = 0
  const doc = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path),
  })
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.split('/').pop(),
      exists: data !== undefined,
      size: 1,
      data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
      get: (field: string) => data?.[field],
    }
  }
  const children = (path: string) =>
    [...docs.keys()]
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .sort()
  const query = (path: string, state: { limit: number; after: string | null }): any => ({
    orderBy: () => query(path, state),
    limit: (limit: number) => query(path, { ...state, limit }),
    startAfter: (after: string) => query(path, { ...state, after }),
    get: async () => {
      const ids = children(path)
        .map((key) => key.split('/').pop() as string)
        .filter((id) => state.after === null || id > state.after)
        .slice(0, state.limit)
      const page = ids.map((id) => snapshot(`${path}/${id}`))
      return { docs: page, size: page.length }
    },
  })
  const collection = (path: string): any => ({
    doc: (id?: string) => doc(`${path}/${id ?? `auto${String(++auto).padStart(4, '0')}`}`),
    orderBy: () => query(path, { limit: 1000, after: null }),
  })
  const firestore: any = {
    docs,
    collection,
    runTransaction: async (fn: (transaction: any) => Promise<unknown>) => {
      const writes: Array<() => void> = []
      const result = await fn({
        get: async (ref: any) => snapshot(ref.path),
        set: (ref: any, data: any, options?: { merge?: boolean }) =>
          writes.push(() => docs.set(ref.path, { ...(options?.merge ? docs.get(ref.path) : {}), ...JSON.parse(JSON.stringify(data)) })),
      })
      writes.forEach((apply) => apply())
      return result
    },
  }
  return firestore
}

const product = (variants: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  name: 'Tee',
  lowStockThreshold: 3,
  variants,
  ...extra,
})

const ledger = (firestore: any) =>
  [...firestore.docs.entries()]
    .filter(([path]: [string]) => path.startsWith('hosts/h1/inventoryAdjustments/'))
    .map(([, data]: [string, any]) => data)

describe('setAvailableStock — counts another warehouse keeps (AGL-3634)', () => {
  beforeEach(() => {
    lowStockAlerts.length = 0
  })

  it('sets a tracked variant to the count, with a sync row naming who counted', async () => {
    const firestore = fakeFirestore({
      'hosts/h1/products/p1': product([
        { id: 'v1', sku: 'TEE-S', inventory: 10 },
        { id: 'v2', sku: 'TEE-M', inventory: 4 },
      ]),
    })
    const results = await setAvailableStock(
      { hostId: 'h1', source: 'ShipBob', levels: [{ sku: 'TEE-S', quantity: 7 }, { sku: 'TEE-M', quantity: 4 }] },
      firestore,
    )
    expect(results).toEqual([
      { sku: 'TEE-S', outcome: 'updated', before: 10, after: 7 },
      { sku: 'TEE-M', outcome: 'unchanged', before: 4, after: 4 },
    ])
    const stored = firestore.docs.get('hosts/h1/products/p1')
    expect(stored.variants.map((variant: any) => variant.inventory)).toEqual([7, 4])
    expect(stored.inventory).toBe(11)
    expect(stored.soldOut).toBe(false)
    expect(typeof stored.updatedAtMs).toBe('number')
    expect(ledger(firestore)).toEqual([
      expect.objectContaining({ productId: 'p1', variantId: 'v1', delta: -3, reason: 'sync', source: 'ShipBob' }),
    ])
  })

  it('writes nothing, not even a ledger row, when every count already agrees', async () => {
    const firestore = fakeFirestore({ 'hosts/h1/products/p1': product([{ id: 'v1', sku: 'A', inventory: 2 }]) })
    const before = JSON.stringify(firestore.docs.get('hosts/h1/products/p1'))
    await setAvailableStock({ hostId: 'h1', source: 'ShipBob', levels: [{ sku: 'A', quantity: 2 }] }, firestore)
    expect(JSON.stringify(firestore.docs.get('hosts/h1/products/p1'))).toBe(before)
    expect(ledger(firestore)).toEqual([])
  })

  it('leaves untracked and per-location variants alone, and says why', async () => {
    const firestore = fakeFirestore({
      'hosts/h1/products/p1': product([
        { id: 'v1', sku: 'LOOSE', inventory: null },
        { id: 'v2', sku: 'SPLIT', inventory: 9, inventoryByLocation: { shop: 4, back: 5 } },
      ]),
    })
    const results = await setAvailableStock(
      { hostId: 'h1', source: 'Amazon', levels: [{ sku: 'LOOSE', quantity: 3 }, { sku: 'SPLIT', quantity: 1 }] },
      firestore,
    )
    expect(results.map((result) => result.outcome)).toEqual(['untracked', 'per_location'])
    expect(firestore.docs.get('hosts/h1/products/p1').variants[1].inventoryByLocation).toEqual({ shop: 4, back: 5 })
    expect(ledger(firestore)).toEqual([])
  })

  it('answers unknown_sku for a SKU no live product has, deleted ones included', async () => {
    const firestore = fakeFirestore({
      'hosts/h1/products/p1': product([{ id: 'v1', sku: 'GONE', inventory: 1 }], { deletedAt: 1 }),
    })
    const results = await setAvailableStock(
      { hostId: 'h1', source: 'ShipBob', levels: [{ sku: 'GONE', quantity: 5 }, { sku: 'NEVER', quantity: 1 }] },
      firestore,
    )
    expect(results.map((result) => result.outcome)).toEqual(['unknown_sku', 'unknown_sku'])
    expect(firestore.docs.get('hosts/h1/products/p1').variants[0].inventory).toBe(1)
  })

  it('refuses a count that is not a whole number of zero or more', async () => {
    const firestore = fakeFirestore({ 'hosts/h1/products/p1': product([{ id: 'v1', sku: 'A', inventory: 2 }]) })
    const results = await setAvailableStock(
      {
        hostId: 'h1',
        source: 'ShipBob',
        levels: [
          { sku: 'A', quantity: -1 },
          { sku: 'A', quantity: 1.5 },
          { sku: '', quantity: 3 },
        ],
      },
      firestore,
    )
    expect(results.map((result) => result.outcome)).toEqual(['invalid', 'invalid', 'invalid'])
    expect(firestore.docs.get('hosts/h1/products/p1').variants[0].inventory).toBe(2)
  })

  it('sets every variant that shares a SKU, across products', async () => {
    const firestore = fakeFirestore({
      'hosts/h1/products/p1': product([{ id: 'v1', sku: 'DUP', inventory: 1 }]),
      'hosts/h1/products/p2': product([{ id: 'v9', sku: 'DUP', inventory: 8 }]),
    })
    const [result] = await setAvailableStock(
      { hostId: 'h1', source: 'ShipBob', levels: [{ sku: 'DUP', quantity: 5 }] },
      firestore,
    )
    expect(result.outcome).toBe('updated')
    expect(firestore.docs.get('hosts/h1/products/p1').variants[0].inventory).toBe(5)
    expect(firestore.docs.get('hosts/h1/products/p2').variants[0].inventory).toBe(5)
  })

  it('marks a product sold out at zero and raises the low-stock crossing', async () => {
    const firestore = fakeFirestore({ 'hosts/h1/products/p1': product([{ id: 'v1', sku: 'A', inventory: 6 }]) })
    await setAvailableStock({ hostId: 'h1', source: 'ShipBob', levels: [{ sku: 'A', quantity: 0 }] }, firestore)
    expect(firestore.docs.get('hosts/h1/products/p1').soldOut).toBe(true)
    expect(lowStockAlerts).toHaveLength(1)
    expect(lowStockAlerts[0].before.variants[0].inventory).toBe(6)
    expect(lowStockAlerts[0].after.variants[0].inventory).toBe(0)
  })

  it('walks past the first page of products to find a SKU', async () => {
    const seed: Record<string, Record<string, any>> = {}
    for (let index = 0; index < 305; index += 1) {
      seed[`hosts/h1/products/p${String(index).padStart(4, '0')}`] = product([{ id: 'v', sku: `S${index}`, inventory: 1 }])
    }
    const firestore = fakeFirestore(seed)
    const [result] = await setAvailableStock(
      { hostId: 'h1', source: 'ShipBob', levels: [{ sku: 'S304', quantity: 9 }] },
      firestore,
    )
    expect(result).toEqual({ sku: 'S304', outcome: 'updated', before: 1, after: 9 })
  })
})
