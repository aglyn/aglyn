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

import { memoryFirestore, memoryFirestoreModule } from '../testing/pos-ops-memory-firestore'

jest.mock('firebase-admin/firestore', () => memoryFirestoreModule)
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
  getLockdownVerdict: jest.fn(),
  getOrgForHost: jest.fn(),
  isImpersonationSession: () => false,
}))

import { deleteProduct, saveProduct, type ProductSaveInput } from './products-write'

/*
 * The product save and delete the native apps' routes and the public API
 * share (AGL-4235), called as already authorized: what each writes, refuses
 * and drops, apart from any door in front of it.
 */

const LATTE = {
  name: 'Latte',
  slug: 'latte',
  type: 'physical',
  status: 'active',
  deletedAt: null,
  variants: [{ id: 'small', priceUsd: 3.5, inventory: 4 }],
  stockHolds: { cs_1: { variantId: 'small', quantity: 1 } },
  subscription: { interval: 'month' },
}

function setup() {
  const memory = memoryFirestore(() => 5_000)
  memory.seed('hosts/h1', { memberRoles: {} })
  memory.seed('hosts/h1/products/p1', LATTE)
  memory.seed('hosts/h1/collections/c-coffee', { kind: 'catalog', mode: 'smart', matchAll: true, rules: [{ field: 'priceUsd', op: 'gt', value: 1 }] })
  const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
  const base = (overrides: Partial<ProductSaveInput>): ProductSaveInput => ({
    firestore: memory.firestore,
    hostId: 'h1',
    productId: 'p2',
    create: true,
    product: { name: 'Mocha', slug: 'mocha', type: 'physical', status: 'draft', variants: [{ id: 'default', priceUsd: 4 }] },
    org: { plan: 'pro' },
    createdBy: 'u-1',
    nowMs: 9_000,
    dropCache,
    cacheReason: 'spec',
    ...overrides,
  })
  return { memory, dropCache, base }
}

const outboxCount = (memory: ReturnType<typeof memoryFirestore>) =>
  [...memory.docs.keys()].filter((path) => path.startsWith('publishOutbox/')).length

describe('saveProduct', () => {
  it('creates with the derived fields, the membership and the stamps, and drops the cache', async () => {
    const { memory, dropCache, base } = setup()
    const saved = await saveProduct(base({ createStamps: { apiKeyName: 'Sync' } }))
    expect(saved).toEqual({ ok: true, id: 'p2', replayed: false })
    expect(memory.read('hosts/h1/products/p2')).toMatchObject({
      name: 'Mocha',
      nameLower: 'mocha',
      priceUsd: 4,
      collectionIds: ['c-coffee'],
      createdBy: 'u-1',
      apiKeyName: 'Sync',
      createdAtMs: 9_000,
      deletedAt: null,
    })
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['h1'], reason: 'spec' }))
    // The drop completed, so its outbox entry was settled.
    expect(outboxCount(memory)).toBe(0)
  })

  it('answers a replayed create with the product it made, writing nothing twice', async () => {
    const { memory, dropCache, base } = setup()
    await saveProduct(base({}))
    const again = await saveProduct(base({ product: { ...LATTE, name: 'Something else' } as never }))
    expect(again).toEqual({ ok: true, id: 'p2', replayed: true })
    expect(memory.read('hosts/h1/products/p2')!['name']).toBe('Mocha')
    expect(dropCache).toHaveBeenCalledTimes(1)
  })

  it('refuses a create the plan does not include, and one past the allowance, counted in the transaction', async () => {
    const { memory, base } = setup()
    expect(await saveProduct(base({ org: { plan: 'free' } }))).toMatchObject({ ok: false, status: 403, code: 'plan' })
    expect(await saveProduct(base({ org: { plan: 'pro', entitlements: { productsPerHost: 1 } } }))).toMatchObject({
      ok: false,
      status: 403,
      code: 'quota',
    })
    expect(memory.read('hosts/h1/products/p2')).toBeUndefined()
  })

  it('refuses a product the editor could not save', async () => {
    const { base } = setup()
    const tooMany = { name: 'Tee', slug: 'tee', type: 'physical', status: 'draft', variants: [{ id: 'default', priceUsd: 4 }], options: [
      { name: 'A', values: Array.from({ length: 11 }, (_, index) => `a${index}`) },
      { name: 'B', values: Array.from({ length: 10 }, (_, index) => `b${index}`) },
    ] }
    expect(await saveProduct(base({ product: tooMany as never }))).toMatchObject({ ok: false, status: 400, code: 'invalid' })
    expect(await saveProduct(base({ product: { ...tooMany, options: [], slug: 'Bad Slug' } as never }))).toMatchObject({ ok: false, status: 400, code: 'invalid' })
  })

  it('an edit keeps the live stock holds and the stored timestamps the product does not name', async () => {
    const { memory, base } = setup()
    // A stored Timestamp, as the server SDK reads one; the memory store keeps JSON.
    const createdAt = { toDate: () => new Date(0) }
    const written: Array<Record<string, unknown>> = []
    const firestore = {
      ...memory.firestore,
      runTransaction: (body: (tx: any) => Promise<unknown>) =>
        memory.firestore.runTransaction((tx: any) =>
          body({
            ...tx,
            get: async (target: any) => {
              const result = await tx.get(target)
              if (target.path !== 'hosts/h1/products/p1') return result
              return { ...result, data: () => ({ ...result.data(), createdAt }) }
            },
            set: (ref: any, data: Record<string, unknown>, options?: unknown) => {
              if (ref.path === 'hosts/h1/products/p1') written.push(data)
              return tx.set(ref, data, options)
            },
          }),
        ),
    } as unknown as FirebaseFirestore.Firestore
    const saved = await saveProduct(
      base({
        firestore,
        productId: 'p1',
        create: false,
        // A seed carrying a hold that has since settled is not the editor's to write.
        product: { ...LATTE, name: 'Oat latte', stockHolds: { stale: { variantId: 'small', quantity: 3 } } } as never,
      }),
    )
    expect(saved).toEqual({ ok: true, id: 'p1', replayed: false })
    expect(written[0]['createdAt']).toBe(createdAt)
    expect(memory.read('hosts/h1/products/p1')).toMatchObject({
      name: 'Oat latte',
      stockHolds: { cs_1: { variantId: 'small', quantity: 1 } },
      subscription: { interval: 'month' },
      deletedAt: null,
      updatedAtMs: 9_000,
    })
  })

  it('builds an edit from the stored product inside the transaction, and keeps a builder’s refusal', async () => {
    const { memory, dropCache, base } = setup()
    const saved = await saveProduct(
      base({
        productId: 'p1',
        create: false,
        product: (stored) => ({ ...(stored.data() as Record<string, unknown>), name: 'Flat white' }) as never,
      }),
    )
    expect(saved).toMatchObject({ ok: true })
    expect(memory.read('hosts/h1/products/p1')).toMatchObject({ name: 'Flat white', slug: 'latte', subscription: { interval: 'month' } })
    dropCache.mockClear()
    const refused = await saveProduct(base({ productId: 'p1', create: false, product: () => ({ refusal: { status: 404, error: 'No such variant' } }) }))
    expect(refused).toEqual({ ok: false, status: 404, code: 'refused', error: 'No such variant' })
    expect(dropCache).not.toHaveBeenCalled()
  })

  it('refuses an edit of a deleted product, which would bring it back past the allowance', async () => {
    const { memory, base } = setup()
    memory.seed('hosts/h1/products/p1', { ...LATTE, deletedAt: 1 })
    expect(await saveProduct(base({ productId: 'p1', create: false, product: LATTE as never }))).toMatchObject({
      ok: false,
      status: 404,
      code: 'missing',
    })
  })

  it('with uniqueSlug, refuses a slug another product holds, deleted or not, and allows its own', async () => {
    const { memory, base } = setup()
    memory.seed('hosts/h1/products/p9', { ...LATTE, slug: 'mocha', deletedAt: 1 })
    expect(await saveProduct(base({ uniqueSlug: true }))).toMatchObject({ ok: false, status: 409, code: 'slug_taken' })
    expect(await saveProduct(base({ productId: 'p1', create: false, uniqueSlug: true, product: LATTE as never }))).toMatchObject({ ok: true })
    // Without it, the native save's behaviour: no slug question.
    expect(await saveProduct(base({}))).toMatchObject({ ok: true })
  })
})

describe('deleteProduct', () => {
  it('soft-deletes once, answers already the second time, and 404s a product that never was', async () => {
    const { memory, dropCache } = setup()
    const input = { firestore: memory.firestore, hostId: 'h1', productId: 'p1', dropCache, cacheReason: 'spec' }
    expect(await deleteProduct(input)).toEqual({ ok: true, already: false })
    expect(memory.read('hosts/h1/products/p1')!['deletedAt']).toBe(5_000)
    expect(await deleteProduct(input)).toEqual({ ok: true, already: true })
    expect(dropCache).toHaveBeenCalledTimes(1)
    expect(await deleteProduct({ ...input, productId: 'nope' })).toMatchObject({ ok: false, status: 404, code: 'missing' })
  })
})
