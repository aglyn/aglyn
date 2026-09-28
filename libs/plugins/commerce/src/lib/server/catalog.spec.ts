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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import {
  type QueryFakeFirestore,
  queryFakeFirestore,
} from '@aglyn/tenant-data-admin/server/test-firestore-queries'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import {
  PRODUCT_LIST_INDEX_BASE,
  PRODUCT_LIST_QUERY,
} from '../constants/product-list-query'
import {
  STOREFRONT_CATALOG_BASE_PATHS,
  STOREFRONT_CATALOG_DECLARATION,
} from '../constants/storefront-catalog-query'
import { productCollectionIds, productSearchFields, productStockFields } from '../model/commerce'
import {
  catalogHandler,
  createCatalogReadScope,
  queryPublicCatalog,
} from './catalog'

/*
 * The storefront catalog against a fake that ANSWERS queries (AGL-3321):
 * filters, orders, cursors and limits evaluated the way Firestore evaluates
 * them — a document missing an ordered or filtered field is not returned. The
 * old spec's stub returned every seeded product for any query, which is the
 * one thing that let a handler narrowing `limit(500)` in memory pass.
 */

let fake: QueryFakeFirestore
/** Reads per collection name, counted at `get()` and `getAll()`. */
const reads: Record<string, number> = {}

function counted(target: any, path: string): any {
  return new Proxy(target, {
    get(object, property) {
      const value = object[property]
      if (typeof value !== 'function') return value
      return (...args: any[]) => {
        if (property === 'get' || property === 'getAll') {
          const segments = path.split('/').filter(Boolean)
          const name =
            property === 'getAll'
              ? 'getAll'
              : segments.length % 2 === 1
                ? segments[segments.length - 1]
                : segments[segments.length - 2]
          reads[name] = (reads[name] ?? 0) + 1
        }
        const out = value.apply(object, args)
        if (
          out &&
          typeof out === 'object' &&
          typeof out.then !== 'function' &&
          ['collection', 'doc', 'where', 'orderBy', 'limit', 'startAfter'].includes(
            String(property),
          )
        ) {
          const next =
            property === 'collection' || property === 'doc'
              ? `${path}/${String(args[0])}`
              : path
          return counted(out, next)
        }
        return out
      }
    },
  })
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => counted(fake, '') }),
    firestore: { FieldPath, Timestamp },
  },
}))

const HOST = 'hosts/host-1'

/**
 * A product as the writers store it: live (`deletedAt: null`, as the create
 * route stamps it), its keys stamped by `productSearchFields` and
 * `productStockFields`.
 */
function seedProduct(id: string, overrides: Record<string, unknown> = {}) {
  const variants = (overrides['variants'] as any[]) ?? [
    { id: 'default', priceUsd: 10, inventory: null },
  ]
  const name = String(overrides['name'] ?? id)
  fake.seed(`${HOST}/products/${id}`, {
    slug: id.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    type: 'physical',
    status: 'active',
    createdAtMs: 1,
    deletedAt: null,
    ...overrides,
    ...productSearchFields({ name, variants }),
    ...productStockFields({
      variants,
      oversellPolicy: overrides['oversellPolicy'] as never,
    }),
    variants,
  })
}

function makeRequest(query: Record<string, string>): PluginApiRequest {
  return {
    method: 'GET',
    query: { hostId: 'host-1', ...query },
    body: {},
    headers: {},
    cookies: {},
    socket: {},
  }
}

function makeResponse() {
  const result = { status: 0, body: undefined as any, headers: {} as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader(name, value) {
      result.headers[name] = value
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  }
  return { res, result }
}

async function run(query: Record<string, string>) {
  const { res, result } = makeResponse()
  await catalogHandler(makeRequest(query), res)
  return result
}

const names = (result: { body: any }) =>
  (result.body?.items ?? []).map((item: any) => item.name)

beforeEach(() => {
  fake = queryFakeFirestore()
  for (const key of Object.keys(reads)) delete reads[key]
})

describe('catalog handler params (AGL-561)', () => {
  beforeEach(() => {
    seedProduct('blue-hat', {
      name: 'Blue Hat',
      tags: ['summer'],
      categoryIds: ['cat-apparel'],
      createdAtMs: 300,
      variants: [{ id: 'default', priceUsd: 30, inventory: null }],
    })
    seedProduct('red-scarf', {
      name: 'Red Scarf',
      description: 'Warm wool for winter',
      categoryIds: ['cat-apparel'],
      createdAtMs: 100,
      variants: [{ id: 'default', priceUsd: 20, inventory: null }],
    })
    seedProduct('ebook', {
      name: 'Ebook',
      type: 'digital',
      createdAtMs: 200,
      variants: [{ id: 'default', priceUsd: 5, inventory: null }],
    })
    fake.seed(`${HOST}/productCategories/cat-apparel`, {
      name: 'Apparel',
      slug: 'apparel',
      order: 2,
    })
    fake.seed(`${HOST}/productCategories/cat-books`, {
      name: 'Books',
      slug: 'books',
      order: 1,
    })
  })

  it('rejects a missing hostId', async () => {
    const { res, result } = makeResponse()
    await catalogHandler(
      { ...makeRequest({}), query: {} } as PluginApiRequest,
      res,
    )
    expect(result.status).toBe(400)
  })

  it('searches by a word prefix of the product name via q', async () => {
    expect(names(await run({ q: 'BLUE' }))).toEqual(['Blue Hat'])
    expect(names(await run({ q: 'sca' }))).toEqual(['Red Scarf'])
    // Word-prefix, over the name only: the description and the tags are not
    // searched, and a mid-word fragment finds nothing.
    expect(names(await run({ q: 'wool' }))).toEqual([])
    expect(names(await run({ q: 'carf' }))).toEqual([])
    expect(names(await run({ q: '  ' }))).toHaveLength(3)
  })

  it('says search reads the first word of a longer query', async () => {
    const result = await run({ q: 'blue hat' })
    expect(names(result)).toEqual(['Blue Hat'])
    expect(result.body.notices).toEqual([
      'Search matches one word at a time: showing results for "blue".',
    ])
  })

  it('filters by categoryId and resolves a category slug', async () => {
    expect(names(await run({ categoryId: 'cat-apparel' }))).toEqual([
      'Blue Hat',
      'Red Scarf',
    ])
    expect(names(await run({ category: 'apparel' }))).toEqual([
      'Blue Hat',
      'Red Scarf',
    ])
    expect(names(await run({ category: 'no-such' }))).toHaveLength(3)
  })

  it('filters by tag', async () => {
    expect(names(await run({ tag: 'summer' }))).toEqual(['Blue Hat'])
  })

  it('filters by product type, ignoring unknown values', async () => {
    expect(names(await run({ type: 'digital' }))).toEqual(['Ebook'])
    expect(names(await run({ type: 'nonsense' }))).toHaveLength(3)
  })

  it('sorts by price and recency', async () => {
    expect(names(await run({ sort: 'price-asc' }))).toEqual([
      'Ebook',
      'Red Scarf',
      'Blue Hat',
    ])
    expect(names(await run({ sort: 'price-desc' }))).toEqual([
      'Blue Hat',
      'Red Scarf',
      'Ebook',
    ])
    expect(names(await run({ sort: 'newest' }))).toEqual([
      'Blue Hat',
      'Ebook',
      'Red Scarf',
    ])
    // Default: name A–Z.
    expect(names(await run({}))).toEqual(['Blue Hat', 'Ebook', 'Red Scarf'])
  })

  it('pages by the cursor it returns, with no gap and no repeat', async () => {
    const first = await run({ limit: '2' })
    expect(names(first)).toEqual(['Blue Hat', 'Ebook'])
    expect(typeof first.body.nextCursor).toBe('string')
    const second = await run({ limit: '2', after: first.body.nextCursor })
    expect(names(second)).toEqual(['Red Scarf'])
    expect(second.body.nextCursor).toBeUndefined()
  })

  it('applies q before paging so filtered sets page correctly', async () => {
    seedProduct('blue-mug', { name: 'Blue Mug' })
    const result = await run({ q: 'blue', limit: '1' })
    expect(names(result)).toEqual(['Blue Hat'])
    const next = await run({ q: 'blue', limit: '1', after: result.body.nextCursor })
    expect(names(next)).toEqual(['Blue Mug'])
    expect(next.body.nextCursor).toBeUndefined()
  })

  it('returns ordered category facets only when facets=1', async () => {
    const plain = await run({})
    expect(plain.body.categories).toBeUndefined()
    const faceted = await run({ facets: '1' })
    expect(faceted.body.categories).toEqual([
      { id: 'cat-books', name: 'Books', slug: 'books' },
      { id: 'cat-apparel', name: 'Apparel', slug: 'apparel' },
    ])
  })

  // Price-range filter (AGL-564). Displayed prices in cents:
  // Blue Hat 3000, Red Scarf 2000, Ebook 500.
  it('filters by minPriceCents/maxPriceCents inclusively', async () => {
    expect(names(await run({ minPriceCents: '1000' }))).toEqual([
      'Red Scarf',
      'Blue Hat',
    ])
    expect(names(await run({ maxPriceCents: '2000' }))).toEqual([
      'Ebook',
      'Red Scarf',
    ])
    expect(
      names(await run({ minPriceCents: '1500', maxPriceCents: '2500' })),
    ).toEqual(['Red Scarf'])
    // Invalid or negative values are ignored, matching type/sort.
    expect(
      names(await run({ minPriceCents: 'abc', maxPriceCents: '-5' })),
    ).toHaveLength(3)
  })

  it('keeps a high-to-low sort while the price slider orders by price', async () => {
    // A range leads the order, and the order it leads with is the one asked.
    expect(
      names(await run({ minPriceCents: '1000', sort: 'price-desc' })),
    ).toEqual(['Blue Hat', 'Red Scarf'])
  })

  it('filters multi-price products on their displayed (lowest) price', async () => {
    seedProduct('variant-pack', {
      name: 'Variant Pack',
      variants: [
        { id: 'a', priceUsd: 90, inventory: null },
        { id: 'b', priceUsd: 40, inventory: null },
      ],
    })
    // Displayed as "From $40" — in range even though its first variant is $90.
    expect(names(await run({ maxPriceCents: '4000' }))).toContain(
      'Variant Pack',
    )
    expect(names(await run({ minPriceCents: '5000' }))).toEqual([])
  })

  it('reports price bounds facets unaffected by the price filter', async () => {
    expect((await run({})).body.priceBounds).toBeUndefined()
    const faceted = await run({ facets: '1' })
    expect(faceted.body.priceBounds).toEqual({ minCents: 500, maxCents: 3000 })
    // Bounds ignore the price filter itself, so a slider stays anchored…
    const narrowed = await run({ facets: '1', minPriceCents: '1000' })
    expect(narrowed.body.priceBounds).toEqual({
      minCents: 500,
      maxCents: 3000,
    })
    expect(names(narrowed)).toEqual(['Red Scarf', 'Blue Hat'])
    // …but respect every other filter.
    const typed = await run({ facets: '1', type: 'digital' })
    expect(typed.body.priceBounds).toEqual({ minCents: 500, maxCents: 500 })
    // An empty result set has no bounds.
    const empty = await run({ facets: '1', q: 'zzz' })
    expect(empty.body.priceBounds).toBeUndefined()
  })

  it('refuses by name a category it cannot combine with a search', async () => {
    const result = await run({ q: 'red', categoryId: 'cat-apparel' })
    // The search is served over the WHOLE catalog, and the category is said
    // to be unapplied rather than applied to whatever happened to load.
    expect(names(result)).toEqual(['Red Scarf'])
    // The plan's own refusal, which the grid names (`listQueryRefusals`).
    expect(result.body.refused).toEqual([
      {
        clause: { field: 'category', op: 'contains', value: 'cat-apparel' },
        reason: 'cannot be combined with the search — clear the search to use it',
      },
    ])
  })

  /**
   * A delete stamps `deletedAt` and leaves `status` alone, so the scope has to
   * ask for both. Forced red by dropping `deletedAt == null` from
   * `STOREFRONT_CATALOG_BASE`: "Gone Hat", deleted while active, is listed.
   */
  it('never lists a deleted or unpublished product', async () => {
    seedProduct('gone', { name: 'Gone Hat', status: 'active', deletedAt: 5 })
    seedProduct('archived', { name: 'Archived Hat', status: 'archived' })
    seedProduct('draft', { name: 'Draft Hat', status: 'draft' })
    expect(names(await run({ q: 'hat' }))).toEqual(['Blue Hat'])
    expect(names(await run({ ids: 'gone,archived,draft,blue-hat' }))).toEqual(['Blue Hat'])
  })

  /**
   * The In stock chip is a query (`soldOut == false`), not a filter over the
   * cards returned. Forced red by answering `inStock` in memory over the page:
   * with `limit=1` the first page holds only the sold-out product.
   */
  it('serves the In stock chip on the query', async () => {
    seedProduct('aa-gone', {
      name: 'Aardvark Mug',
      variants: [{ id: 'default', priceUsd: 5, inventory: 0 }],
    })
    seedProduct('backorder', {
      name: 'Backorder Mug',
      oversellPolicy: 'backorder',
      variants: [{ id: 'default', priceUsd: 5, inventory: 0 }],
    })
    const all = await run({ q: 'mug' })
    expect(names(all)).toEqual(['Aardvark Mug', 'Backorder Mug'])
    expect(all.body.items[0].soldOut).toBe(true)
    expect(names(await run({ q: 'mug', inStock: '1', limit: '1' }))).toEqual(['Backorder Mug'])
    expect(names(await run({ inStock: '1' }))).toEqual([
      'Backorder Mug',
      'Blue Hat',
      'Ebook',
      'Red Scarf',
    ])
  })

  it('says a price range orders by price rather than the sort chosen', async () => {
    const result = await run({ minPriceCents: '1000', sort: 'name' })
    expect(names(result)).toEqual(['Red Scarf', 'Blue Hat'])
    expect(result.body.notices).toEqual([
      'Sorted by price, low to high, while a price range is set — Name applies again when it is cleared.',
    ])
    expect((await run({ sort: 'newest' })).body.notices).toBeUndefined()
  })

  it('says a collection’s price rule orders it by price, without promising the sort returns', async () => {
    fake.seed(`${HOST}/collections/under-25`, {
      kind: 'catalog',
      name: 'Under $25',
      slug: 'under-25',
      mode: 'smart',
      rules: [{ field: 'priceUsd', op: 'lt', value: 25 }],
    })
    const result = await run({ collectionId: 'under-25', sort: 'name' })
    expect(names(result)).toEqual(['Ebook', 'Red Scarf'])
    // The rule is the collection's, which a visitor cannot clear.
    expect(result.body.notices).toEqual([
      'Sorted by price, low to high — this collection picks its products by price, so it cannot be sorted by Name.',
    ])
  })
})

/**
 * THE REGRESSION (AGL-3321). The handler read `limit(500)` products with no
 * order and narrowed them in memory, so every control answered "no products
 * match" for a product past that window. Six hundred products, and the one
 * being looked for sorts last by id.
 *
 * Forced red by reverting `queryPublicCatalog` to the `limit(500)` read: all
 * three lookups below then come back empty.
 */
describe('a catalog past the old 500-product window', () => {
  beforeEach(() => {
    for (let index = 0; index < 600; index += 1) {
      seedProduct(`p${String(index).padStart(4, '0')}`, {
        name: `Plain Item ${index}`,
      })
    }
    seedProduct('zz-last', {
      name: 'Walnut Chair',
      categoryIds: ['cat-furniture'],
      tags: ['wood'],
      variants: [{ id: 'default', priceUsd: 900, inventory: null }],
    })
  })

  it('finds it by search, by category, by tag and by price', async () => {
    expect(names(await run({ q: 'walnut' }))).toEqual(['Walnut Chair'])
    expect(names(await run({ categoryId: 'cat-furniture' }))).toEqual(['Walnut Chair'])
    expect(names(await run({ tag: 'wood' }))).toEqual(['Walnut Chair'])
    expect(names(await run({ minPriceCents: '50000' }))).toEqual(['Walnut Chair'])
  })

  it('reads a page, not the catalog', async () => {
    const result = await run({ limit: '24' })
    expect(result.body.items).toHaveLength(24)
    expect(typeof result.body.nextCursor).toBe('string')
  })
})

describe('collections', () => {
  beforeEach(() => {
    for (let index = 0; index < 600; index += 1) {
      seedProduct(`p${String(index).padStart(4, '0')}`, { name: `Plain Item ${index}` })
    }
    seedProduct('zz-chair', { name: 'Walnut Chair', tags: ['wood'] })
    seedProduct('zz-table', { name: 'Walnut Table', tags: ['wood'], type: 'digital' })
    seedProduct('zz-draft', { name: 'Walnut Draft', tags: ['wood'], status: 'draft' })
  })

  it('reads a manual collection whole, by id, in the merchant order', async () => {
    fake.seed(`${HOST}/collections/picks`, {
      kind: 'catalog',
      name: 'Picks',
      slug: 'picks',
      mode: 'manual',
      productIds: ['zz-table', 'zz-draft', 'zz-chair', 'p0003'],
    })
    expect(names(await run({ collectionId: 'picks' }))).toEqual([
      'Walnut Table',
      'Walnut Chair',
      'Plain Item 3',
    ])
    // Every visitor control answers over the WHOLE collection.
    expect(names(await run({ collectionId: 'picks', q: 'walnut' }))).toEqual([
      'Walnut Table',
      'Walnut Chair',
    ])
    expect(names(await run({ collectionSlug: 'picks', type: 'digital' }))).toEqual([
      'Walnut Table',
    ])
  })

  it('serves a smart collection whose rules a query can hold', async () => {
    fake.seed(`${HOST}/collections/wood`, {
      kind: 'catalog',
      name: 'Wood',
      slug: 'wood',
      mode: 'smart',
      rules: [{ field: 'tag', op: 'eq', value: 'wood' }],
    })
    expect(names(await run({ collectionId: 'wood' }))).toEqual([
      'Walnut Chair',
      'Walnut Table',
    ])
    expect(names(await run({ collectionId: 'wood', type: 'digital' }))).toEqual([
      'Walnut Table',
    ])
  })

  it('reads a smart collection no query can express by its stored membership', async () => {
    const rules = [{ field: 'name' as const, op: 'contains' as const, value: 'walnut' }]
    fake.seed(`${HOST}/collections/named`, {
      kind: 'catalog',
      name: 'Named',
      slug: 'named',
      mode: 'smart',
      rules,
    })
    // Stamped as every writer (and the membership route) stamps it — the
    // members sit past the old 500-product window.
    const named = [{ id: 'named', rules }]
    const membership = (name: string) =>
      productCollectionIds({ name, variants: [], type: 'physical' }, named)
    seedProduct('zz-chair', { name: 'Walnut Chair', tags: ['wood'], collectionIds: membership('Walnut Chair') })
    seedProduct('zz-table', {
      name: 'Walnut Table',
      tags: ['wood'],
      type: 'digital',
      collectionIds: membership('Walnut Table'),
    })
    seedProduct('zz-draft', {
      name: 'Walnut Draft',
      tags: ['wood'],
      status: 'draft',
      collectionIds: membership('Walnut Draft'),
    })
    expect(membership('Plain Item 3')).toEqual([])
    const result = await run({ collectionId: 'named' })
    expect(names(result)).toEqual(['Walnut Chair', 'Walnut Table'])
    expect(result.body.notices ?? []).toEqual([])
    // The collection holds the query's one array clause, so the search is
    // refused by name rather than answered over some of it.
    const searched = await run({ collectionId: 'named', q: 'walnut' })
    expect(searched.body.refused?.map((entry: { clause: unknown }) => entry.clause)).toEqual([
      'search',
    ])
  })
})

describe('explicit id lists', () => {
  it('keeps the given order and drops what is not on sale', async () => {
    seedProduct('a', { name: 'Alpha' })
    seedProduct('b', { name: 'Beta', status: 'draft' })
    seedProduct('c', { name: 'Gamma' })
    expect(names(await run({ ids: 'c,missing,b,a' }))).toEqual(['Gamma', 'Alpha'])
  })
})

/**
 * A storefront page can carry several product grids, and each one seeds
 * itself through `queryPublicCatalog`. Grids asking the SAME question share
 * one answer; each different question reads only its own page.
 */
describe('catalog read scope', () => {
  beforeEach(() => {
    seedProduct('a', { name: 'Alpha' })
    seedProduct('b', { name: 'Beta' })
  })

  /**
   * Forced red by dropping `reads` from the four calls below: `products`
   * then reports 4 instead of 1.
   */
  it('answers four identical grids sharing a scope with one read', async () => {
    const scope = createCatalogReadScope()
    const results = await Promise.all([
      queryPublicCatalog({ hostId: 'host-1', reads: scope }),
      queryPublicCatalog({ hostId: 'host-1', reads: scope }),
      queryPublicCatalog({ hostId: 'host-1', reads: scope }),
      queryPublicCatalog({ hostId: 'host-1', reads: scope }),
    ])

    expect(reads['products']).toBe(1)
    for (const result of results) {
      expect(result.items.map((item) => item.id).sort()).toEqual(['a', 'b'])
    }
  })

  it('reads once per call when no scope is passed', async () => {
    await queryPublicCatalog({ hostId: 'host-1' })
    await queryPublicCatalog({ hostId: 'host-1' })

    expect(reads['products']).toBe(2)
  })

  it('reads the taxonomy once for every faceted grid, and not at all without', async () => {
    const scope = createCatalogReadScope()
    await Promise.all([
      queryPublicCatalog({ hostId: 'host-1', reads: scope }),
      queryPublicCatalog({ hostId: 'host-1', reads: scope, sort: 'newest' }),
    ])
    expect(reads['productCategories']).toBeUndefined()

    const faceted = createCatalogReadScope()
    await Promise.all([
      queryPublicCatalog({ hostId: 'host-1', reads: faceted, facets: true }),
      queryPublicCatalog({ hostId: 'host-1', reads: faceted, facets: true, sort: 'newest' }),
    ])
    expect(reads['productCategories']).toBe(1)
  })
})

/**
 * Every shape the storefront can ask has its composite (AGL-3321): the
 * declaration's equalities and array clauses under each order it offers, the
 * scope's two equalities included. The console products table's composites
 * are pinned beside them, and the storefront reuses those four it shares.
 */
describe('the index file serves every storefront shape', () => {
  const indexFile = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', '..', '..', '..', 'cloud/firebase-firestore.indexes.json'), 'utf8'),
  )
  const storefront = listQueryIndexes(STOREFRONT_CATALOG_DECLARATION, STOREFRONT_CATALOG_BASE_PATHS)
  const hub = listQueryIndexes(PRODUCT_LIST_QUERY, PRODUCT_LIST_INDEX_BASE)
  const shape = (index: { fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }> }) =>
    index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(',')

  it('holds every composite both products lists need', () => {
    expect(missingListQueryIndexes(indexFile, 'products', storefront, 'COLLECTION')).toEqual([])
    expect(missingListQueryIndexes(indexFile, 'products', hub, 'COLLECTION')).toEqual([])
  })

  it('needs eight predicates under four orders, four of them shared with the table', () => {
    expect(storefront).toHaveLength(32)
    const hubShapes = new Set(hub.map(shape))
    expect(storefront.map(shape).filter((entry) => hubShapes.has(entry)).sort()).toEqual([
      'deletedAt:ASCENDING,nameLower:ASCENDING',
      'nameTokens:CONTAINS,nameLower:ASCENDING',
      'status:ASCENDING,nameLower:ASCENDING',
      'type:ASCENDING,nameLower:ASCENDING',
    ])
  })
})
