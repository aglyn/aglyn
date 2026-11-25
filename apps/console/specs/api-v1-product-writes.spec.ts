/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
 *
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

/**
 * A site's products, written over the public REST API (AGL-4235):
 * `POST /v1/sites/{siteId}/products`, `PATCH` and `DELETE` on one, and
 * `PATCH` on one of its variants.
 *
 * Through the real site router and the commerce plugin's real registration,
 * into the plugin's real save (`saveProduct`, the one the native apps' route
 * calls) over an in-memory store that runs its transactions, queries and
 * counts. The only double is the site cache drop, which would call the
 * tenant. So each gate, each refusal and each stored field asserted here is
 * the shipped code's.
 */

jest.mock('firebase-admin/firestore', () => {
  const actual = jest.requireActual('firebase-admin/firestore')
  const memory = jest.requireActual('@aglyn/plugins-commerce/testing/pos-ops-memory-firestore')
  // The store's own sentinels, so a server timestamp lands as its clock;
  // the real Timestamp class, which `serialize` asks `instanceof` of.
  return { ...actual, FieldValue: memory.memoryFirestoreModule.FieldValue, FieldPath: memory.memoryFirestoreModule.FieldPath }
})

const mockDropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({
  ...jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-site-cache'),
  dropPluginSiteCache: (...args: unknown[]) => mockDropCache(...(args as [])),
}))

import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import { dispatchResource } from '../utils/api-v1-resources'

beforeAll(() => registerPluginServerDeclarations())

/** The commerce plugin's in-memory store, reached as the mocks above reach plugin code. */
interface MemoryStore {
  docs: Map<string, Record<string, unknown>>
  firestore: FirebaseFirestore.Firestore
  seed(path: string, data: Record<string, unknown>): void
  read(path: string): Record<string, unknown> | undefined
}
const { memoryFirestore } = jest.requireActual('@aglyn/plugins-commerce/testing/pos-ops-memory-firestore') as {
  memoryFirestore: (clock?: () => number) => MemoryStore
}

const SITE = 'host_1'
const EDITOR = 'u-editor'
const VIEWER = 'u-viewer'
const WRITE_SCOPES = ['products:read', 'products:write']

let memory = memoryFirestore()

function context(overrides: Partial<ApiV1Context> = {}): ApiV1Context {
  return {
    orgId: 'org-1',
    keyId: 'key-1',
    keyName: 'Catalog sync',
    credential: 'api_key',
    scopes: WRITE_SCOPES as ApiV1Context['scopes'],
    org: { plan: 'pro', hosts: { [SITE]: true } } as ApiV1Context['org'],
    firestore: memory.firestore,
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }
}

const connectedApp = (uid: string) => context({ credential: 'connected_app', uid, keyName: 'Assistant' })

async function call(
  method: string,
  path: string,
  body?: unknown,
  ctx: ApiV1Context = context(),
  headers: Record<string, string> = {},
) {
  const response = await dispatchResource(
    new Request(`https://app.example.com/api/v1/${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    ctx,
    path.split('/'),
  )
  return { status: response.status, body: await response.json() }
}

const stored = (id: string) => memory.read(`hosts/${SITE}/products/${id}`)

beforeEach(() => {
  memory = memoryFirestore(() => 1_800_000_000_000)
  mockDropCache.mockClear()
  memory.seed(`hosts/${SITE}`, { displayName: 'Bakery', memberRoles: { [EDITOR]: 'editor', [VIEWER]: 'viewer' } })
  memory.seed(`hosts/${SITE}/productCategories/cat_bread`, { name: 'Bread', slug: 'bread' })
  memory.seed(`hosts/${SITE}/products/p_loaf`, {
    name: 'Sourdough loaf',
    slug: 'sourdough-loaf',
    type: 'physical',
    status: 'active',
    deletedAt: null,
    options: [{ name: 'Size', values: ['Small', 'Large'] }],
    variants: [
      { id: 'v_small', options: { Size: 'Small' }, priceUsd: 6, inventory: 4, sku: 'LOAF-S' },
      { id: 'v_large', options: { Size: 'Large' }, priceUsd: 9, inventory: null },
    ],
    // Fields this API does not expose, which an update must keep.
    modifierGroups: [{ id: 'g1', name: 'Slicing', min: 0, max: 1, options: [{ id: 'o1', name: 'Sliced', priceCents: 0 }] }],
    stockHolds: { cs_1: { variantId: 'v_small', quantity: 1 } },
    seo: { imageUrl: 'https://cdn.example.com/share.png' },
    createdAtMs: 1_700_000_000_000,
  })
})

describe('the gates in front of every product write', () => {
  it('refuses a credential without products:write, and names the scope', async () => {
    const ctx = context({ scopes: ['products:read'] as ApiV1Context['scopes'] })
    const created = await call('POST', `sites/${SITE}/products`, { name: 'Rye' }, ctx)
    expect(created.status).toBe(403)
    expect(created.body.error).toMatchObject({ type: 'insufficient_scope', code: 'products:write' })
    const patched = await call('PATCH', `sites/${SITE}/products/p_loaf`, { name: 'Rye' }, ctx)
    expect(patched.body.error.code).toBe('products:write')
    expect(stored('p_loaf')!['name']).toBe('Sourdough loaf')
  })

  it('asks products:write before products:read, so a write-only key is not misled', async () => {
    const ctx = context({ scopes: ['products:write'] as ApiV1Context['scopes'] })
    expect((await call('PATCH', `sites/${SITE}/products/p_loaf`, { name: 'Rye' }, ctx)).status).toBe(200)
  })

  it('refuses an organization whose plan does not include commerce', async () => {
    const ctx = context({ org: { plan: 'free', hosts: { [SITE]: true } } as ApiV1Context['org'] })
    const { status, body } = await call('POST', `sites/${SITE}/products`, { name: 'Rye' }, ctx)
    expect(status).toBe(403)
    expect(body.error).toMatchObject({ type: 'plan_required', code: 'commerce' })
  })

  it('refuses a site commerce is switched off for, as the order writes do', async () => {
    memory.seed(`hosts/${SITE}`, { displayName: 'Bakery', disabledPlugins: ['commerce'], memberRoles: { [EDITOR]: 'editor' } })
    const { status, body } = await call('DELETE', `sites/${SITE}/products/p_loaf`)
    expect(status).toBe(404)
    expect(body.error.message).toBe('No such site')
    expect(stored('p_loaf')!['deletedAt']).toBeNull()
  })

  it('refuses a connected app whose person cannot edit the site’s content', async () => {
    const { status, body } = await call('PATCH', `sites/${SITE}/products/p_loaf`, { name: 'Rye' }, connectedApp(VIEWER))
    expect(status).toBe(403)
    expect(body.error.code).toBe('site_permission_required')
    expect(stored('p_loaf')!['name']).toBe('Sourdough loaf')
  })

  it('lets a connected app whose person edits the site write, stamped as that person', async () => {
    const { status, body } = await call('POST', `sites/${SITE}/products`, { name: 'Rye' }, connectedApp(EDITOR))
    expect(status).toBe(201)
    expect(stored(body.id)).toMatchObject({ createdBy: EDITOR, connectedAppName: 'Assistant' })
  })

  it('lets an API key write: it has no person to ask about', async () => {
    const { status, body } = await call('POST', `sites/${SITE}/products`, { name: 'Rye' })
    expect(status).toBe(201)
    expect(stored(body.id)).toMatchObject({ createdBy: null, apiKeyName: 'Catalog sync' })
  })

  it('still serves reads under products:read alone', async () => {
    const ctx = context({ scopes: ['products:read'] as ApiV1Context['scopes'] })
    const { status, body } = await call('GET', `sites/${SITE}/products/p_loaf`, undefined, ctx)
    expect(status).toBe(200)
    expect(body.seo).toEqual({ title: null, description: null })
  })
})

describe('createProduct', () => {
  it('makes a draft with a minted id and a slug from the name, as the editor starts one', async () => {
    const { status, body } = await call('POST', `sites/${SITE}/products`, { name: '  Rye bread ' })
    expect(status).toBe(201)
    expect(body).toMatchObject({ object: 'product', name: 'Rye bread', slug: 'rye-bread', status: 'draft', type: 'physical' })
    // Sent no price, it is saved unpriced, never at the editor's placeholder.
    expect(body.variants).toEqual([expect.objectContaining({ id: 'default', priceUsd: null, inventory: null })])
    expect(stored(body.id)).toMatchObject({ nameLower: 'rye bread', priceUsd: null, deletedAt: null })
    expect((stored(body.id)?.['variants'] as Record<string, unknown>[])[0]).not.toHaveProperty('priceUsd')
    expect(mockDropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: [SITE] }))
  })

  it('leaves every combination its options make unpriced until a variant is priced', async () => {
    const { status, body } = await call('POST', `sites/${SITE}/products`, {
      name: 'Mug',
      options: [{ name: 'Color', values: ['Red', 'Blue'] }],
      variants: [{ options: { Color: 'Blue' }, priceUsd: 14 }],
    })
    expect(status).toBe(201)
    const [red, blue] = body.variants
    expect(red).toMatchObject({ options: { Color: 'Red' }, priceUsd: null })
    expect(blue).toMatchObject({ options: { Color: 'Blue' }, priceUsd: 14 })
    // The legacy flat price is the first variant's, and it has none.
    expect(stored(body.id)).toMatchObject({ priceUsd: null })
  })

  it('may be created active, with options that make its variants, priced and stocked by their options', async () => {
    const { status, body } = await call('POST', `sites/${SITE}/products`, {
      name: 'Tee',
      status: 'active',
      categoryIds: ['cat_bread'],
      options: [{ name: 'Size', values: ['S', ' M ', ''] }],
      variants: [
        { options: { Size: 'S' }, priceUsd: 20, inventory: 0 },
        { options: { Size: 'M' }, priceUsd: 22, sku: 'TEE-M', inventory: null },
      ],
    })
    expect(status).toBe(201)
    expect(body.status).toBe('active')
    expect(body.options).toEqual([{ name: 'Size', values: ['S', 'M'] }])
    const [small, medium] = body.variants
    expect(small).toMatchObject({ options: { Size: 'S' }, priceUsd: 20, inventory: 0, inventoryTracked: true })
    expect(medium).toMatchObject({ options: { Size: 'M' }, priceUsd: 22, sku: 'TEE-M', inventory: null, inventoryTracked: false })
    // The search keys the save derives, from the variants as written.
    expect(stored(body.id)).toMatchObject({ skus: ['tee-m'], priceFromCents: 2000 })
  })

  it('a retry with the same Idempotency-Key answers the first product, not a second one', async () => {
    const key = { 'Idempotency-Key': 'create-rye-1' }
    const first = await call('POST', `sites/${SITE}/products`, { name: 'Rye' }, context(), key)
    const again = await call('POST', `sites/${SITE}/products`, { name: 'Rye' }, context(), key)
    expect(first.status).toBe(201)
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(first.body.id)
    const products = [...memory.docs.keys()].filter((path) => path.startsWith(`hosts/${SITE}/products/`))
    expect(products).toHaveLength(2)
  })

  it('names an unknown member in a 400, and writes nothing', async () => {
    const { status, body } = await call('POST', `sites/${SITE}/products`, { name: 'Rye', subscription: { interval: 'month' }, priceUsd: 4 })
    expect(status).toBe(400)
    expect(body.error.code).toBe('validation_failed')
    expect(Object.keys(body.error.fields)).toEqual(['subscription', 'priceUsd'])
  })

  it('needs a name, and refuses a digital product, which is made where its files are uploaded', async () => {
    expect((await call('POST', `sites/${SITE}/products`, { status: 'active' })).body.error.fields).toEqual({ name: 'Required, and not blank' })
    const digital = await call('POST', `sites/${SITE}/products`, { name: 'Ebook', type: 'digital' })
    expect(digital.status).toBe(400)
    expect(digital.body.error.fields.type).toMatch(/created .* in the console|console/)
    expect((await call('POST', `sites/${SITE}/products`, { name: 'Lesson', type: 'service' })).status).toBe(201)
  })

  it('refuses a sent slug another product holds, and claims the next free one from a name', async () => {
    const taken = await call('POST', `sites/${SITE}/products`, { name: 'Another loaf', slug: 'sourdough-loaf' })
    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('slug_taken')
    const named = await call('POST', `sites/${SITE}/products`, { name: 'Sourdough loaf' })
    expect(named.body.slug).toBe('sourdough-loaf-2')
  })

  it('refuses a category the site does not have', async () => {
    const { status, body } = await call('POST', `sites/${SITE}/products`, { name: 'Rye', categoryIds: ['cat_gone'] })
    expect(status).toBe(400)
    expect(body.error.fields.categoryIds).toContain('cat_gone')
  })

  it('refuses a create past the plan’s product allowance', async () => {
    const ctx = context({ org: { plan: 'pro', entitlements: { productsPerHost: 1 }, hosts: { [SITE]: true } } as ApiV1Context['org'] })
    const { status, body } = await call('POST', `sites/${SITE}/products`, { name: 'Rye' }, ctx)
    expect(status).toBe(403)
    expect(body.error).toMatchObject({ type: 'plan_required', code: 'product_quota' })
  })
})

describe('the search listing limits', () => {
  it('takes a title of 60 characters and a description of 155, and refuses one more', async () => {
    const ok = await call('PATCH', `sites/${SITE}/products/p_loaf`, { seo: { title: 't'.repeat(60), description: 'd'.repeat(155) } })
    expect(ok.status).toBe(200)
    expect(ok.body.seo).toEqual({ title: 't'.repeat(60), description: 'd'.repeat(155) })
    // The share image the editor holds beside them stays.
    expect(stored('p_loaf')!['seo']).toMatchObject({ imageUrl: 'https://cdn.example.com/share.png' })
    const long = await call('PATCH', `sites/${SITE}/products/p_loaf`, { seo: { title: 't'.repeat(61), description: 'd'.repeat(156) } })
    expect(long.status).toBe(400)
    expect(long.body.error.fields).toEqual({ 'seo.title': 'At most 60 characters', 'seo.description': 'At most 155 characters' })
    expect((await call('PATCH', `sites/${SITE}/products/p_loaf`, { seo: { imageUrl: 'x' } })).body.error.fields).toEqual({ 'seo.imageUrl': 'Not writable here' })
  })
})

describe('updateProduct', () => {
  it('changes only what it sends, keeping what the API does not expose', async () => {
    const { status, body } = await call('PATCH', `sites/${SITE}/products/p_loaf`, { name: 'Country loaf', tags: ['bread'] })
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: 'Country loaf', slug: 'sourdough-loaf', tags: ['bread'], status: 'active' })
    expect(stored('p_loaf')).toMatchObject({
      nameLower: 'country loaf',
      modifierGroups: [{ id: 'g1', name: 'Slicing' }],
      stockHolds: { cs_1: { variantId: 'v_small', quantity: 1 } },
      createdAtMs: 1_700_000_000_000,
      deletedAt: null,
    })
  })

  it('rebuilds the variants from new option values as the editor does, keeping the ones it still sells', async () => {
    const { body } = await call('PATCH', `sites/${SITE}/products/p_loaf`, { options: [{ name: 'Size', values: ['Small', 'Large', 'Family'] }] })
    expect(body.variants.map((variant: { id: string }) => variant.id).slice(0, 2)).toEqual(['v_small', 'v_large'])
    // A new combination starts at the first variant's price and stock.
    expect(body.variants[2]).toMatchObject({ options: { Size: 'Family' }, priceUsd: 6, inventory: 4 })
  })

  it('carries each variant through an option rename', async () => {
    const { body } = await call('PATCH', `sites/${SITE}/products/p_loaf`, { options: [{ name: 'Loaf size', values: ['Small', 'Large'] }] })
    expect(body.variants).toEqual([
      expect.objectContaining({ id: 'v_small', options: { 'Loaf size': 'Small' }, sku: 'LOAF-S' }),
      expect.objectContaining({ id: 'v_large', options: { 'Loaf size': 'Large' } }),
    ])
  })

  it('refuses more combinations than a product holds, and a variant the grid does not have', async () => {
    const values = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`)
    const tooMany = await call('PATCH', `sites/${SITE}/products/p_loaf`, { options: [{ name: 'A', values: values('a', 11) }, { name: 'B', values: values('b', 10) }] })
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error.message).toMatch(/110 combinations/)
    const missing = await call('PATCH', `sites/${SITE}/products/p_loaf`, { variants: [{ options: { Size: 'Huge' }, priceUsd: 1 }] })
    expect(missing.status).toBe(400)
    expect(Object.keys(missing.body.error.fields)).toEqual(['variants[0]'])
  })

  it('refuses a slug another product holds, and a deleted product', async () => {
    memory.seed(`hosts/${SITE}/products/p_rye`, { name: 'Rye', slug: 'rye', type: 'physical', status: 'draft', deletedAt: null, variants: [{ id: 'default', priceUsd: 5 }] })
    expect((await call('PATCH', `sites/${SITE}/products/p_loaf`, { slug: 'rye' })).status).toBe(409)
    memory.seed(`hosts/${SITE}/products/p_rye`, { name: 'Rye', slug: 'rye', deletedAt: 1, variants: [] })
    expect((await call('PATCH', `sites/${SITE}/products/p_rye`, { name: 'Back' })).status).toBe(404)
  })
})

describe('deleteProduct', () => {
  it('is the console’s soft delete, and answers the same receipt when repeated', async () => {
    const first = await call('DELETE', `sites/${SITE}/products/p_loaf`)
    expect(first).toEqual({ status: 200, body: { id: 'p_loaf', object: 'product', deleted: true } })
    expect(stored('p_loaf')).toMatchObject({ name: 'Sourdough loaf', deletedAt: 1_800_000_000_000 })
    expect(await call('DELETE', `sites/${SITE}/products/p_loaf`)).toEqual(first)
    expect(mockDropCache).toHaveBeenCalledTimes(1)
    expect((await call('GET', `sites/${SITE}/products/p_loaf`)).status).toBe(404)
    expect((await call('DELETE', `sites/${SITE}/products/p_never`)).status).toBe(404)
  })
})

describe('updateProductVariant', () => {
  it('changes one variant’s price, codes and weight, and answers the product', async () => {
    const { status, body } = await call('PATCH', `sites/${SITE}/products/p_loaf/variants/v_large`, {
      priceUsd: 10,
      compareAtPriceUsd: 12,
      barcode: '0123456789012',
      weightGrams: 800,
    })
    expect(status).toBe(200)
    expect(body.object).toBe('product')
    expect(body.variants[1]).toMatchObject({ id: 'v_large', priceUsd: 10, compareAtPriceUsd: 12, barcode: '0123456789012', weightGrams: 800 })
    expect(stored('p_loaf')).toMatchObject({ barcodes: ['0123456789012'], stockHolds: { cs_1: { variantId: 'v_small', quantity: 1 } } })
  })

  it('keeps untracked and sold out apart: null stops counting, 0 is sold out', async () => {
    const soldOut = await call('PATCH', `sites/${SITE}/products/p_loaf/variants/v_small`, { inventory: 0 })
    expect(soldOut.body.variants[0]).toMatchObject({ inventory: 0, inventoryTracked: true })
    expect(soldOut.body.inventory).toBe(0)
    const untracked = await call('PATCH', `sites/${SITE}/products/p_loaf/variants/v_small`, { inventory: null })
    expect(untracked.body.variants[0]).toMatchObject({ inventory: null, inventoryTracked: false })
    expect(untracked.body.inventory).toBeNull()
    expect((await call('PATCH', `sites/${SITE}/products/p_loaf/variants/v_small`, { inventory: -1 })).status).toBe(400)
    expect((await call('PATCH', `sites/${SITE}/products/p_loaf/variants/v_small`, { inventory: 1.5 })).status).toBe(400)
  })

  it('refuses stock on a digital subscription, which never counts it', async () => {
    memory.seed(`hosts/${SITE}/products/p_club`, { name: 'Club', slug: 'club', type: 'digital', status: 'active', deletedAt: null, subscription: { interval: 'month' }, variants: [{ id: 'default', priceUsd: 10, inventory: null }] })
    const counted = await call('PATCH', `sites/${SITE}/products/p_club/variants/default`, { inventory: 5 })
    expect(counted.status).toBe(400)
    expect(counted.body.error.fields.inventory).toMatch(/not tracked/)
    expect((await call('PATCH', `sites/${SITE}/products/p_club/variants/default`, { priceUsd: 12 })).status).toBe(200)
    expect(stored('p_club')).toMatchObject({ subscription: { interval: 'month' } })
  })

  it('refuses what the editor refuses, an unknown member, and a variant that is not there', async () => {
    const below = await call('PATCH', `sites/${SITE}/products/p_loaf/variants/v_small`, { compareAtPriceUsd: 5 })
    expect(below.status).toBe(400)
    expect(below.body.error.message).toBe('Compare-at price must exceed the price')
    expect((await call('PATCH', `sites/${SITE}/products/p_loaf/variants/v_small`, { options: { Size: 'Large' } })).body.error.fields).toEqual({ options: 'Not writable here' })
    expect((await call('PATCH', `sites/${SITE}/products/p_loaf/variants/v_gone`, { priceUsd: 1 })).status).toBe(404)
  })

  it('does not add or remove one variant: variants follow the options', async () => {
    expect((await call('POST', `sites/${SITE}/products/p_loaf/variants`, { priceUsd: 1 })).status).toBe(404)
    const removed = await call('DELETE', `sites/${SITE}/products/p_loaf/variants/v_small`)
    expect(removed.status).toBe(405)
    expect(stored('p_loaf')!['variants']).toHaveLength(2)
  })
})
