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
import { catalogHandler, matchesCatalogQuery } from './catalog'

interface MockRow {
  id: string
  data: Record<string, unknown>
}

// Seedable host subcollections; the chainable stub mirrors only the
// call shapes the handler makes (same convention as the membership
// login spec).
const mockDb: Record<string, MockRow[]> = {
  products: [],
  productCategories: [],
  collections: [],
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) => {
              const rows = () => mockDb[name] ?? []
              const toDocs = (list: MockRow[]) => ({
                docs: list.map((row) => ({
                  id: row.id,
                  data: () => row.data,
                })),
              })
              return {
                limit: () => ({ get: async () => toDocs(rows()) }),
                get: async () => toDocs(rows()),
                where: (field: string, _op: string, value: unknown) => ({
                  limit: () => ({
                    get: async () =>
                      toDocs(
                        rows().filter((row) => row.data[field] === value),
                      ),
                  }),
                }),
                doc: (id: string) => ({
                  get: async () => {
                    const row = rows().find((entry) => entry.id === id)
                    return { exists: Boolean(row), data: () => row?.data }
                  },
                }),
              }
            },
          }),
        }),
      }),
    }),
  },
}))

function product(id: string, overrides: Record<string, unknown> = {}): MockRow {
  return {
    id,
    data: {
      name: id,
      slug: id,
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 10, inventory: null }],
      ...overrides,
    },
  }
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

describe('catalog handler params (AGL-561)', () => {
  beforeEach(() => {
    mockDb.products = [
      product('Blue Hat', {
        tags: ['summer'],
        categoryIds: ['cat-apparel'],
        createdAtMs: 300,
        variants: [{ id: 'default', priceUsd: 30, inventory: null }],
      }),
      product('Red Scarf', {
        description: 'Warm wool for winter',
        categoryIds: ['cat-apparel'],
        createdAtMs: 100,
        variants: [{ id: 'default', priceUsd: 20, inventory: null }],
      }),
      product('Ebook', {
        type: 'digital',
        createdAtMs: 200,
        variants: [{ id: 'default', priceUsd: 5, inventory: null }],
      }),
    ]
    mockDb.productCategories = [
      { id: 'cat-apparel', data: { name: 'Apparel', slug: 'apparel', order: 2 } },
      { id: 'cat-books', data: { name: 'Books', slug: 'books', order: 1 } },
    ]
    mockDb.collections = []
  })

  it('rejects a missing hostId', async () => {
    const { res, result } = makeResponse()
    await catalogHandler(
      { ...makeRequest({}), query: {} } as PluginApiRequest,
      res,
    )
    expect(result.status).toBe(400)
  })

  it('searches name, description, and tags case-insensitively via q', async () => {
    expect(names(await run({ q: 'BLUE' }))).toEqual(['Blue Hat'])
    expect(names(await run({ q: 'wool' }))).toEqual(['Red Scarf'])
    expect(names(await run({ q: 'summer' }))).toEqual(['Blue Hat'])
    expect(names(await run({ q: '  ' }))).toHaveLength(3)
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

  it('pages with offset/limit and reports nextOffset while more remain', async () => {
    const first = await run({ limit: '2' })
    expect(names(first)).toEqual(['Blue Hat', 'Ebook'])
    expect(first.body.nextOffset).toBe(2)
    const second = await run({ limit: '2', offset: '2' })
    expect(names(second)).toEqual(['Red Scarf'])
    expect(second.body.nextOffset).toBeUndefined()
  })

  it('applies q before paging so filtered sets page correctly', async () => {
    const result = await run({ q: 'a', limit: '1' })
    // 'a' matches Blue Hat ("Hat") and Red Scarf ("Scarf" + "Warm").
    expect(names(result)).toEqual(['Blue Hat'])
    expect(result.body.nextOffset).toBe(1)
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
      'Blue Hat',
      'Red Scarf',
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

  it('filters multi-price products on their displayed (lowest) price', async () => {
    mockDb.products.push(
      product('Variant Pack', {
        variants: [
          { id: 'a', priceUsd: 40, inventory: null },
          { id: 'b', priceUsd: 90, inventory: null },
        ],
      }),
    )
    // Displayed as "From $40" — in range even though one variant is $90.
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
    expect(names(narrowed)).toEqual(['Blue Hat', 'Red Scarf'])
    // …but respect every other filter.
    const typed = await run({ facets: '1', type: 'digital' })
    expect(typed.body.priceBounds).toEqual({ minCents: 500, maxCents: 500 })
    // An empty result set has no bounds.
    const empty = await run({ facets: '1', q: 'zzz' })
    expect(empty.body.priceBounds).toBeUndefined()
  })
})

describe('matchesCatalogQuery', () => {
  it('matches on name, description, or tag and blanks match all', () => {
    const item = {
      name: 'Canvas Tote',
      description: 'Everyday carry',
      tags: ['bags'],
    }
    expect(matchesCatalogQuery(item, 'tote')).toBe(true)
    expect(matchesCatalogQuery(item, 'CARRY')).toBe(true)
    expect(matchesCatalogQuery(item, 'bag')).toBe(true)
    expect(matchesCatalogQuery(item, '')).toBe(true)
    expect(matchesCatalogQuery(item, '  ')).toBe(true)
    expect(matchesCatalogQuery(item, 'shoes')).toBe(false)
    expect(matchesCatalogQuery({ name: 'Bare' }, 'bare')).toBe(true)
  })
})
