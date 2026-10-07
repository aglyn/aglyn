/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
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
 * The product draft writer (AGL-3616), against the real product model and
 * the real plan table: only the Admin SDK is a double, one that honors
 * transactions, counts a collection and answers `==` and `in` queries.
 *
 *  - THE DOCUMENT is the draft the products card makes from a proposal:
 *    unpriced unless priced, no photo, off the storefront.
 *  - THE REFUSAL is the resources route's: plan feature, role, allowance.
 *  - THE WRITE is idempotent under its id, and takes a slug no product holds.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { productPriceMissing, validateProduct, type HostProduct } from '../model/commerce'
import {
  checkProductDraftContent,
  createProductDraftWriter,
  PRODUCT_DRAFT_PLAN_REFUSAL,
  PRODUCT_DRAFT_RESOURCE,
  PRODUCT_DRAFT_ROLE_REFUSAL,
  productDraftLimitRefusal,
  productDraftWriter,
  registerProductDraftWriter,
} from './product-drafts'

const NOW = new Date('2026-10-06T15:00:00.000Z')

// ── Firestore double ─────────────────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>()
let commits: string[] = []

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

const childrenOf = (path: string) =>
  [...store.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function queryOf(path: string, filters: Array<[string, string, unknown]>): Record<string, unknown> {
  return {
    kind: 'query',
    where: (field: string, op: string, value: unknown) => queryOf(path, [...filters, [field, op, value]]),
    get: async () => ({
      docs: childrenOf(path)
        .map(snapshotOf)
        .filter((doc) =>
          filters.every(([field, op, value]) =>
            op === 'in' ? (value as unknown[]).includes(doc.get(field)) : doc.get(field) === value,
          ),
        ),
    }),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const counted = {
    kind: 'count',
    get: async () => ({ data: () => ({ count: childrenOf(path).length }) }),
  }
  return {
    path,
    doc: (id: string) => docRef(`${path}/${id}`),
    count: () => counted,
    where: (field: string, op: string, value: unknown) => queryOf(path, [[field, op, value]]),
  }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { kind: string; path: string; get: () => Promise<unknown> }) =>
        target.kind === 'doc' ? snapshotOf(target.path) : target.get(),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const writer = createProductDraftWriter({ firestore: () => firestore })

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Free: no commerce. */
const FREE = { plan: 'free' }
/** Business: commerce on, products well past what these cases make. */
const BUSINESS = { plan: 'business' }

const CONTENT = {
  name: 'Sourdough loaf',
  type: 'physical',
  description: 'Two-day ferment, baked every morning.',
  tags: ['bread', ' bread ', 'sourdough'],
  options: [{ name: 'Size', values: ['Half', 'Whole'] }],
  seoTitle: 'Sourdough loaf',
  seoDescription: 'Fresh sourdough, baked daily.',
  categoryIds: ['cat-bread', 'cat-missing'],
}

const request = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: BUSINESS as Record<string, unknown>,
  now: NOW,
  id: 'draft-1',
  name: 'Sourdough loaf',
  content: CONTENT,
  ...patch,
})

const stored = () => store.get('hosts/host-1/products/draft-1') as Record<string, unknown> & HostProduct

beforeEach(() => {
  store.clear()
  commits = []
  store.set('hosts/host-1', { memberRoles: { 'uid-1': 'editor', 'uid-2': 'viewer' } })
  store.set('hosts/host-1/productCategories/cat-bread', { name: 'Bread', slug: 'bread' })
  store.set('hosts/host-1/collections/smart-bread', {
    kind: 'catalog',
    mode: 'smart',
    rules: [{ field: 'tag', op: 'eq', value: 'bread' }],
  })
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the product writer', () => {
  it('writes an unpriced draft with no photo, marked for the merchant to price', async () => {
    const written = await writer.write(request())
    expect(written).toEqual({
      ok: true,
      replayed: false,
      id: 'draft-1',
      name: 'Sourdough loaf',
      versionId: null,
      facts: { status: 'draft', slug: 'sourdough-loaf', type: 'physical', variants: 2, priceMissing: true },
    })
    const product = stored()
    expect(product).toMatchObject({
      name: 'Sourdough loaf',
      slug: 'sourdough-loaf',
      status: 'draft',
      type: 'physical',
      tags: ['bread', 'sourdough'],
      options: [{ name: 'Size', values: ['Half', 'Whole'] }],
      seo: { title: 'Sourdough loaf', description: 'Fresh sourdough, baked daily.' },
      // A category the site lacks is dropped; the smart collection the tags answer is stamped.
      categoryIds: ['cat-bread'],
      collectionIds: ['smart-bread'],
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
      createdAtMs: NOW.getTime(),
      nameLower: 'sourdough loaf',
      soldOut: false,
    })
    expect(product.variants).toHaveLength(2)
    expect(product.variants.every((variant) => !('priceUsd' in variant))).toBe(true)
    expect(productPriceMissing(product)).toBe(true)
    // No photo, and no flat price that would read as free.
    for (const field of ['mediaUrls', 'imageUrl', 'priceUsd']) expect(product).not.toHaveProperty(field)
    // The editor's own rule refuses to save it until it is priced.
    expect(validateProduct(product)).toBe('Set a price for every variant')
  })

  it('prices every variant when the content states a price', async () => {
    const written = await writer.write(request({ content: { ...CONTENT, priceUsd: 9.5 } }))
    expect(written).toMatchObject({ ok: true, facts: { priceMissing: false } })
    const product = stored()
    expect(product.variants.map((variant) => variant.priceUsd)).toEqual([9.5, 9.5])
    expect(product).toMatchObject({ priceUsd: 9.5, priceFromCents: 950, status: 'draft' })
    expect(validateProduct(product)).toBeNull()
  })

  it('takes a slug no product holds, a deleted one included', async () => {
    store.set('hosts/host-1/products/old', { name: 'Sourdough loaf', slug: 'sourdough-loaf', deletedAt: 1 })
    store.set('hosts/host-1/products/old-2', { name: 'Sourdough loaf', slug: 'sourdough-loaf-2', deletedAt: null })
    await writer.write(request())
    expect(stored().slug).toBe('sourdough-loaf-3')
  })

  it('finds its draft when asked again under the same id, and writes nothing more', async () => {
    await writer.write(request())
    commits = []
    const again = await writer.write(request({ name: 'Rye loaf' }))
    expect(again).toMatchObject({ ok: true, replayed: true, id: 'draft-1', name: 'Sourdough loaf' })
    expect(commits).toEqual([])
    expect(await writer.read({ hostId: 'host-1', id: 'draft-1' })).toMatchObject({
      id: 'draft-1',
      facts: { status: 'draft', priceMissing: true },
    })
    expect(await writer.read({ hostId: 'host-1', id: 'nothing' })).toBeNull()
  })

  it('refuses content the check refuses, with its first problem', async () => {
    const written = await writer.write(request({ content: { ...CONTENT, type: 'ticket' } }))
    expect(written).toEqual({ ok: false, status: 400, error: 'The type is physical, digital or service' })
    expect(commits).toEqual([])
  })
})

describe('the refusal', () => {
  it('admits an editor on a plan with room', async () => {
    expect(await writer.refusal(request())).toBeNull()
  })

  it('refuses a plan without commerce, in the resources route’s words', async () => {
    const refusal = { status: 403, error: PRODUCT_DRAFT_PLAN_REFUSAL }
    expect(await writer.refusal(request({ org: FREE }))).toEqual(refusal)
    expect(await writer.write(request({ org: FREE }))).toEqual({ ok: false, ...refusal })
  })

  it('refuses a member who may not write the site', async () => {
    const refusal = { status: 403, error: PRODUCT_DRAFT_ROLE_REFUSAL }
    expect(await writer.refusal(request({ uid: 'uid-2' }))).toEqual(refusal)
    expect(await writer.write(request({ uid: 'uid-2' }))).toEqual({ ok: false, ...refusal })
  })

  it('refuses at the allowance, counted inside the write', async () => {
    const org = { ...BUSINESS, entitlements: { productsPerHost: 1 } }
    expect(await writer.refusal(request({ org }))).toBeNull()
    store.set('hosts/host-1/products/existing', { name: 'Baguette', slug: 'baguette', deletedAt: null })
    const refusal = { status: 403, error: productDraftLimitRefusal(1) }
    expect(refusal.error).toBe('Your plan includes 1 product — upgrade in Billing for more')
    expect(await writer.refusal(request({ org }))).toEqual(refusal)
    expect(await writer.write(request({ org }))).toEqual({ ok: false, ...refusal })
    expect(store.has('hosts/host-1/products/draft-1')).toBe(false)
  })
})

describe('the check', () => {
  const problemsOf = (patch: Record<string, unknown>) => {
    const check = checkProductDraftContent({ ...CONTENT, ...patch })
    return check.ok === false ? check.problems : []
  }

  it('passes a proposal with what it would store', () => {
    expect(checkProductDraftContent(CONTENT)).toEqual({
      ok: true,
      facts: { status: 'draft', slug: 'sourdough-loaf', type: 'physical', variants: 2, priceMissing: true },
    })
    expect(checkProductDraftContent({ name: 'Gift card' })).toMatchObject({ ok: true, facts: { variants: 1 } })
  })

  it('needs a name, a known type, and a stated price that is one', () => {
    expect(problemsOf({ name: '  ' })).toEqual(['The product needs a name'])
    expect(problemsOf({ type: 'ticket' })).toEqual(['The type is physical, digital or service'])
    expect(problemsOf({ priceUsd: -1 })).toHaveLength(1)
    expect(problemsOf({ priceUsd: 1.005 })).toHaveLength(1)
    expect(problemsOf({ priceUsd: 100_000 })).toHaveLength(1)
    expect(problemsOf({ priceUsd: 0 })).toEqual([])
  })

  it('refuses options the editor would refuse, before building any variant', () => {
    expect(problemsOf({ options: [{ name: 'Size', values: [] }] })).toEqual([
      'Each option needs a name and at least one value',
    ])
    expect(
      problemsOf({ options: [{ name: 'Size', values: ['S'] }, { name: 'Size', values: ['M'] }] }),
    ).toEqual(['Each option needs its own name'])
    const many = Array.from({ length: 25 }, (_, index) => `v${index}`)
    expect(
      problemsOf({ options: [{ name: 'A', values: many }, { name: 'B', values: many }] }),
    ).toEqual(['Those options make 625 variants; a product holds at most 100'])
  })
})

describe('registration', () => {
  it('registers the writer under its resource, owned by the commerce plugin', () => {
    registerProductDraftWriter()
    expect(pluginResourceDraftWriter(PRODUCT_DRAFT_RESOURCE)).toEqual({
      pluginId: 'commerce',
      writer: productDraftWriter,
    })
    registerProductDraftWriter()
    expect(pluginResourceDraftWriter(PRODUCT_DRAFT_RESOURCE)?.pluginId).toBe('commerce')
  })
})
