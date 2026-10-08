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
  isImpersonationSession: (decoded: { impersonatedBy?: string }) => Boolean(decoded.impersonatedBy),
}))

import { createProductSaveHandler, createProductStockHandler, stockAttemptId, storedTimestamps } from './products-write'

const TOKENS: Record<string, Record<string, unknown> & { uid: string }> = {
  editor: { uid: 'u-editor', email_verified: true },
  author: { uid: 'u-author', email_verified: true },
  viewer: { uid: 'u-viewer', email_verified: true },
  unverified: { uid: 'u-editor', email_verified: false },
  staff: { uid: 'u-staff', staff: true },
}

function setup(options: { org?: Record<string, unknown>; locked?: boolean } = {}) {
  const memory = memoryFirestore(() => 5_000)
  memory.seed('hosts/h1', { memberRoles: { 'u-editor': 'editor', 'u-author': 'author', 'u-viewer': 'viewer' } })
  memory.seed('hosts/h1/products/p1', {
    name: 'Latte',
    slug: 'latte',
    type: 'physical',
    status: 'active',
    deletedAt: null,
    variants: [{ id: 'small', priceUsd: 3.5, inventory: 4 }],
    stockHolds: { cs_1: { variantId: 'small', quantity: 1 } },
  })
  memory.seed('hosts/h1/collections/c-coffee', { kind: 'catalog', mode: 'smart', matchAll: true, rules: [{ field: 'priceUsd', op: 'gt', value: 1 }] })
  const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
  const deps = {
    firestore: () => memory.firestore,
    verifyIdToken: async (token: string) => {
      const decoded = TOKENS[token]
      if (!decoded) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
      return decoded
    },
    orgForHost: async () => ({ org: options.org ?? { plan: 'business' } }),
    lockdown: async () => (options.locked ? { scope: 'platform' } : null),
    dropCache,
    now: () => 9_000,
  }
  return { memory, dropCache, save: createProductSaveHandler(deps), stock: createProductStockHandler(deps) }
}

function call(handler: any, token: string | null, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (code: number) => ((res.statusCode = code), res)
  res.json = (value: unknown) => ((res.body = value), res)
  return Promise.resolve(
    handler({ method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body }, res),
  ).then(() => res)
}

const edited = { name: 'Oat latte', slug: 'latte', type: 'physical', status: 'active', variants: [{ id: 'small', priceUsd: 4, inventory: 9 }] }

describe('commerce/products/save', () => {
  it('replaces the live product with the editor fields, keeping its live holds, and drops the cache', async () => {
    const { memory, dropCache, save } = setup()
    const res = await call(save, 'editor', { hostId: 'h1', productId: 'p1', product: edited })
    expect(res.statusCode).toBe(200)
    const stored = memory.read('hosts/h1/products/p1')!
    expect(stored).toMatchObject({ name: 'Oat latte', priceUsd: 4, deletedAt: null, stockHolds: { cs_1: { variantId: 'small', quantity: 1 } }, updatedAtMs: 9_000 })
    expect(stored['collectionIds']).toEqual(['c-coffee'])
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['h1'] }))
  })

  it('creates under the minted id, and a retry is the same product', async () => {
    const { memory, save } = setup()
    const first = await call(save, 'author', { hostId: 'h1', productId: 'p2', create: true, product: { ...edited, slug: 'new-latte' } })
    expect(first.body).toEqual({ ok: true, id: 'p2', replayed: false })
    expect(memory.read('hosts/h1/products/p2')).toMatchObject({ createdBy: 'u-author', createdAtMs: 9_000, deletedAt: null })
    const again = await call(save, 'author', { hostId: 'h1', productId: 'p2', create: true, product: { ...edited, slug: 'new-latte' } })
    expect(again.body).toEqual({ ok: true, id: 'p2', replayed: true })
  })

  it.each([
    ['no token', null, 401],
    ['an unknown token', 'nobody', 401],
    ['an unverified email', 'unverified', 403],
    ['a role that cannot write', 'viewer', 403],
  ])('refuses %s', async (_case, token, status) => {
    const { memory, save } = setup()
    const res = await call(save, token, { hostId: 'h1', productId: 'p1', product: edited })
    expect(res.statusCode).toBe(status)
    expect(memory.read('hosts/h1/products/p1')!['name']).toBe('Latte')
  })

  it('refuses a frozen site, but staff write through as the rules allow', async () => {
    const frozen = setup({ locked: true })
    expect((await call(frozen.save, 'editor', { hostId: 'h1', productId: 'p1', product: edited })).statusCode).toBe(423)
    const open = setup()
    expect((await call(open.save, 'staff', { hostId: 'h1', productId: 'p1', product: edited })).statusCode).toBe(200)
  })

  it('refuses a create the plan does not include, or past its product limit', async () => {
    const free = setup({ org: { plan: 'free' } })
    expect((await call(free.save, 'editor', { hostId: 'h1', productId: 'p2', create: true, product: edited })).statusCode).toBe(403)
    const full = setup({ org: { plan: 'business', entitlements: { productsPerHost: 1 } } })
    expect((await call(full.save, 'editor', { hostId: 'h1', productId: 'p2', create: true, product: edited })).statusCode).toBe(403)
    expect(full.memory.read('hosts/h1/products/p2')).toBeUndefined()
  })

  it('refuses an invalid product and an unknown site', async () => {
    const { save } = setup()
    expect((await call(save, 'editor', { hostId: 'h1', productId: 'p1', product: { ...edited, slug: 'Bad Slug' } })).statusCode).toBe(400)
    expect((await call(save, 'editor', { hostId: 'h9', productId: 'p1', product: edited })).statusCode).toBe(404)
  })
})

describe('commerce/products/stock', () => {
  it('moves the count and appends one ledger row per attempt', async () => {
    const { memory, stock } = setup()
    const body = { hostId: 'h1', productId: 'p1', variantId: 'small', delta: 3, reason: 'restock' }
    const first = await call(stock, 'editor', body, { 'idempotency-key': 'k1' })
    expect(first.body).toMatchObject({ ok: true, replayed: false })
    const again = await call(stock, 'editor', body, { 'idempotency-key': 'k1' })
    expect(again.body).toMatchObject({ ok: true, replayed: true })
    expect((memory.read('hosts/h1/products/p1')!['variants'] as Array<{ inventory: number }>)[0].inventory).toBe(7)
    expect(memory.read(`hosts/h1/inventoryAdjustments/${stockAttemptId('u-editor', 'k1')}`)).toEqual({
      productId: 'p1',
      variantId: 'small',
      delta: 3,
      reason: 'restock',
      atMs: 9_000,
    })
  })

  it('refuses without a key, an unknown reason, no units, a viewer and a missing variant', async () => {
    const { stock } = setup()
    const body = { hostId: 'h1', productId: 'p1', variantId: 'small', delta: 1, reason: 'restock' }
    expect((await call(stock, 'editor', body)).statusCode).toBe(400)
    expect((await call(stock, 'editor', { ...body, reason: 'sale' }, { 'idempotency-key': 'k' })).statusCode).toBe(400)
    expect((await call(stock, 'editor', { ...body, delta: 0 }, { 'idempotency-key': 'k' })).statusCode).toBe(400)
    expect((await call(stock, 'viewer', body, { 'idempotency-key': 'k' })).statusCode).toBe(403)
    expect((await call(stock, 'editor', { ...body, variantId: 'gone' }, { 'idempotency-key': 'k' })).statusCode).toBe(404)
  })
})

it('an edit keeps the stored timestamps the request cannot carry', () => {
  const createdAt = { toDate: () => new Date(0) }
  expect(storedTimestamps({ createdAt, name: 'Latte', publishedAt: createdAt }, { publishedAt: null, name: 'x' })).toEqual({ createdAt })
})
