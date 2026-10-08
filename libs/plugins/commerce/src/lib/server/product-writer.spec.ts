/**
 * @jest-environment node
 */
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

import type { SourcedProduct } from '@aglyn/aglyn/plugin-manager/plugin-product-writer'
import { MemoryFirestore } from '../testing/memory-firestore'
import { upsertSourcedProduct } from './product-writer'

/**
 * Products another plugin brings from its own source (AGL-3641), through the
 * store's own rules: the plan's allowance, a free address, the derived keys,
 * the activity, and an update that rewrites only what it is told to.
 */

const HOST = 'host-tees'
let org: Record<string, unknown> = { plan: 'pro' }
const activity: Array<{ action: string; id: string }> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => null }),
    firestore: { Timestamp: { now: () => 'now' }, FieldValue: { delete: () => '__delete__' } },
  },
  getOrgForHost: async (hostId: string) => (hostId === HOST ? { orgId: 'org-tees', org } : null),
  logHostActivity: async (_hostId: string, _actor: unknown, action: string, target: { id: string }) => {
    activity.push({ action, id: target.id })
  },
}))

jest.mock('@aglyn/aglyn/server', () => {
  let next = 0
  return {
    createResourceUid: () => `u${String((next += 1)).padStart(9, '0')}xyzxyzxyz`,
    checkEntitlement: (value: { plan?: string }) => value?.plan !== 'free',
    checkQuota: (value: { productLimit?: number }, _key: string, used: number) => {
      const limit = value?.productLimit ?? 1000
      return { allowed: used < limit, limit, remaining: Math.max(0, limit - used) }
    },
  }
})

function tee(overrides: Partial<SourcedProduct> = {}): SourcedProduct {
  return {
    sourceKey: 'printful:501',
    name: 'Ocean Tee',
    description: 'Soft cotton.',
    mediaUrls: ['https://cdn.example/tee.png'],
    options: [{ name: 'Size', values: ['S', 'M'] }],
    variants: [
      { key: '9001', options: { Size: 'S' }, sku: 'TEE-S', priceMinor: 2499, available: true },
      { key: '9002', options: { Size: 'M' }, sku: 'TEE-M', priceMinor: 2599, available: false },
    ],
    ...overrides,
  }
}

let db: MemoryFirestore

beforeEach(() => {
  db = new MemoryFirestore()
  org = { plan: 'pro' }
  activity.length = 0
})

const products = () =>
  [...db.docs.entries()]
    .filter(([path]) => path.startsWith(`hosts/${HOST}/products/`))
    .map(([path, stored]): Record<string, any> => ({ id: path.split('/').pop() as string, ...stored.data }))

describe('upsertSourcedProduct', () => {
  it('creates a draft through the store’s rules, with an id for every variant', async () => {
    const outcome = await upsertSourcedProduct({ hostId: HOST, product: tee(), actorUid: 'uid-1' }, db as never)
    expect(outcome.outcome).toBe('created')
    if (outcome.outcome !== 'created') return
    const [stored] = products()
    expect(stored.id).toBe(outcome.productId)
    expect(stored).toMatchObject({
      name: 'Ocean Tee',
      slug: 'ocean-tee',
      status: 'draft',
      type: 'physical',
      deletedAt: null,
      nameLower: 'ocean tee',
      priceUsd: 24.99,
      createdBy: 'uid-1',
    })
    expect(stored.variants.map((variant: { priceUsd: number; inventory: number | null }) => [variant.priceUsd, variant.inventory])).toEqual([
      [24.99, null],
      [25.99, 0],
    ])
    expect(outcome.variants.map((variant) => variant.key)).toEqual(['9001', '9002'])
    expect(outcome.variants.map((variant) => variant.variantId)).toEqual(stored.variants.map((variant: { id: string }) => variant.id))
    expect(activity).toEqual([{ action: 'Imported product', id: outcome.productId }])
  })

  it('lists it when asked, and takes the next free address', async () => {
    db.write(`hosts/${HOST}/products/other`, { slug: 'ocean-tee', name: 'Ocean Tee', deletedAt: 5 })
    const outcome = await upsertSourcedProduct({ hostId: HOST, product: tee(), status: 'active' }, db as never)
    expect(outcome.outcome).toBe('created')
    const created = products().find((product) => product.id !== 'other')
    expect(created).toMatchObject({ slug: 'ocean-tee-2', status: 'active' })
  })

  it('refuses past the plan’s product allowance, writing nothing', async () => {
    org = { plan: 'pro', productLimit: 1 }
    db.write(`hosts/${HOST}/products/existing`, { slug: 'mug', name: 'Mug', deletedAt: null })
    const outcome = await upsertSourcedProduct({ hostId: HOST, product: tee() }, db as never)
    expect(outcome).toEqual({ outcome: 'plan_limit', limit: 1 })
    expect(products()).toHaveLength(1)
  })

  it('answers no_store for a site that does not sell', async () => {
    org = { plan: 'free' }
    expect(await upsertSourcedProduct({ hostId: HOST, product: tee() }, db as never)).toEqual({ outcome: 'no_store' })
    expect(await upsertSourcedProduct({ hostId: 'elsewhere', product: tee() }, db as never)).toEqual({ outcome: 'no_store' })
  })

  it('refuses a product the store would refuse, writing nothing', async () => {
    const outcome = await upsertSourcedProduct(
      { hostId: HOST, product: tee({ options: [{ name: 'Size', values: ['S', 'S'] }] }) },
      db as never,
    )
    expect(outcome).toEqual({ outcome: 'invalid', message: 'Option "Size" has duplicate values' })
    expect(products()).toHaveLength(0)
  })

  it('updates availability and variants but keeps the merchant’s prices and words unless told', async () => {
    const first = await upsertSourcedProduct({ hostId: HOST, product: tee() }, db as never)
    if (first.outcome !== 'created') throw new Error('not created')
    // The merchant edits the product in the store.
    const path = `hosts/${HOST}/products/${first.productId}`
    const stored = db.read(path) as Record<string, any>
    db.write(path, {
      ...stored,
      name: 'Ocean Tee (organic)',
      variants: stored.variants.map((variant: Record<string, unknown>) => ({ ...variant, priceUsd: 30, compareAtPriceUsd: 35 })),
    })
    const [small, medium] = first.variants
    const source = tee({
      name: 'Renamed at the source',
      options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
      variants: [
        { key: '9001', variantId: small.variantId, options: { Size: 'S' }, sku: 'TEE-S', priceMinor: 2999, available: false },
        { key: '9002', variantId: medium.variantId, options: { Size: 'M' }, sku: 'TEE-M', priceMinor: 2599, available: true },
        { key: '9003', options: { Size: 'L' }, sku: 'TEE-L', priceMinor: 2799, available: true },
      ],
    })
    const second = await upsertSourcedProduct({ hostId: HOST, product: source, productId: first.productId }, db as never)
    expect(second.outcome).toBe('updated')
    if (second.outcome !== 'updated') return
    const after = db.read(path) as Record<string, any>
    expect(after.name).toBe('Ocean Tee (organic)')
    expect(after.variants.map((variant: any) => [variant.id, variant.priceUsd, variant.compareAtPriceUsd, variant.inventory])).toEqual([
      [small.variantId, 30, 35, 0],
      [medium.variantId, 30, 35, null],
      [second.variants[2].variantId, 27.99, undefined, null],
    ])
    expect(activity.map((entry) => entry.action)).toEqual(['Imported product', 'Updated product from its source'])

    // With prices: a price at or above the compare-at drops the strike-through.
    const third = await upsertSourcedProduct(
      { hostId: HOST, product: { ...source, variants: second.variants.map((v, i) => ({ ...source.variants[i], variantId: v.variantId, priceMinor: 3600 })) }, productId: first.productId, prices: true, content: true },
      db as never,
    )
    expect(third.outcome).toBe('updated')
    const priced = db.read(path) as Record<string, any>
    expect(priced.name).toBe('Renamed at the source')
    expect(priced.variants.every((variant: any) => variant.priceUsd === 36 && variant.compareAtPriceUsd === undefined)).toBe(true)
  })

  it('answers unchanged for a repeat, and a variant the source dropped goes', async () => {
    const first = await upsertSourcedProduct({ hostId: HOST, product: tee() }, db as never)
    if (first.outcome !== 'created') throw new Error('not created')
    const again = tee({
      variants: tee().variants.map((variant, index) => ({ ...variant, variantId: first.variants[index].variantId })),
    })
    const repeat = await upsertSourcedProduct({ hostId: HOST, product: again, productId: first.productId }, db as never)
    expect(repeat.outcome).toBe('unchanged')
    const dropped = await upsertSourcedProduct(
      {
        hostId: HOST,
        product: { ...again, options: [{ name: 'Size', values: ['S'] }], variants: [again.variants[0]] },
        productId: first.productId,
      },
      db as never,
    )
    expect(dropped.outcome).toBe('updated')
    expect((db.read(`hosts/${HOST}/products/${first.productId}`) as any).variants).toHaveLength(1)
  })

  it('creates a new product when the one it made was deleted, unless told not to', async () => {
    const first = await upsertSourcedProduct({ hostId: HOST, product: tee() }, db as never)
    if (first.outcome !== 'created') throw new Error('not created')
    const path = `hosts/${HOST}/products/${first.productId}`
    db.write(path, { ...(db.read(path) as object), deletedAt: 123 })
    expect(
      await upsertSourcedProduct({ hostId: HOST, product: tee(), productId: first.productId, recreate: false }, db as never),
    ).toEqual({ outcome: 'missing' })
    expect(products()).toHaveLength(1)
    const second = await upsertSourcedProduct({ hostId: HOST, product: tee(), productId: first.productId }, db as never)
    expect(second.outcome).toBe('created')
    if (second.outcome === 'created') expect(second.productId).not.toBe(first.productId)
  })
})
