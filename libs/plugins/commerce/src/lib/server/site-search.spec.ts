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

/**
 * The store's products as the site's search page is offered them: only what
 * the storefront lists (live, active, sold online, never a sample), linked to
 * each product's page, captioned with its price, and read within two bounded
 * queries.
 */

type Doc = Record<string, unknown>

/** The documents the reads find, by collection under the host. */
const stored: Record<string, Map<string, Doc>> = {}
/** Every query the reader ran, as `collection where… limit`. */
const queries: string[] = []

const snapshotOf = (id: string, data: Doc) => ({
  id,
  data: () => data,
  get: (field: string) => data[field],
})

function query(name: string, filters: Array<[string, string, unknown]>): any {
  return {
    where: (field: string, op: string, value: unknown) =>
      query(name, [...filters, [field, op, value]]),
    limit: (count: number) => ({
      get: async () => {
        const where = filters
          .map(([f, o, v]) => `${f} ${o} ${String(v)}`)
          .join(' & ')
        queries.push([name, where, `limit ${count}`].filter(Boolean).join(' '))
        const rows = [...(stored[name] ?? new Map()).entries()]
          .filter(([, data]) =>
            filters.every(([field, op, value]) =>
              op === 'array-contains'
                ? Array.isArray(data[field]) &&
                  (data[field] as unknown[]).includes(value)
                : // Firestore's `==` never matches a field the document lacks.
                  Object.prototype.hasOwnProperty.call(data, field) &&
                  data[field] !== undefined &&
                  data[field] === value,
            ),
          )
          .slice(0, count)
        return { docs: rows.map(([id, data]) => snapshotOf(id, data)) }
      },
    }),
  }
}

const firestore = {
  collection: () => ({
    doc: () => ({ collection: (name: string) => query(name, []) }),
  }),
}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))
jest.mock('@aglyn/aglyn/app-utils/tenant-apex', () => ({
  TENANT_APEX: 'aglyn.app',
}))

import {
  commerceSiteSearch,
  productSiteSearchItem,
  SCAN_LIMIT,
  TOKEN_LIMIT,
} from './site-search'

const product = (overrides: Doc = {}): Doc => ({
  name: 'Team Hoodie',
  slug: 'team-hoodie',
  description: '<p>Heavyweight <b>fleece</b> pullover.</p>',
  type: 'physical',
  status: 'active',
  deletedAt: null,
  mediaUrls: ['https://cdn.example.com/hoodie.jpg'],
  tags: ['outerwear'],
  categoryIds: ['c-tops'],
  variants: [
    { id: 's', options: {}, priceUsd: 45, sku: 'HD-S' },
    { id: 'l', options: {}, priceUsd: 50, sku: 'HD-L' },
  ],
  nameTokens: [
    't',
    'te',
    'tea',
    'team',
    'h',
    'ho',
    'hoo',
    'hood',
    'hoodi',
    'hoodie',
  ],
  ...overrides,
})

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key]
  queries.length = 0
})

describe('productSiteSearchItem', () => {
  it('links a listed product to its page, with its photo, its price and its words', () => {
    const item = productSiteSearchItem(
      'p1',
      product(),
      new Map([['c-tops', 'Tops']]),
    )
    expect(item).toEqual({
      title: 'Team Hoodie',
      url: '/products/team-hoodie',
      snippet: 'Heavyweight fleece pullover.',
      imageUrl: 'https://cdn.example.com/hoodie.jpg',
      caption: 'From $45',
      terms: [
        'Heavyweight fleece pullover.',
        'team-hoodie',
        'HD-S',
        'HD-L',
        'outerwear',
        'Tops',
      ],
    })
  })

  it.each([
    ['a draft', { status: 'draft' }],
    ['an archived product', { status: 'archived' }],
    ['a deleted product', { deletedAt: 1_700_000_000_000 }],
    ['a product sold in person only', { sellOnline: false }],
    ['a sample a guided start made', { sample: true }],
    ['a product with no page', { slug: '' }],
  ])('offers nothing for %s', (_label, overrides) => {
    expect(productSiteSearchItem('p1', product(overrides))).toBeNull()
  })

  it('says a product with no price yet is coming soon, never $0', () => {
    const item = productSiteSearchItem(
      'p1',
      product({ variants: [{ id: 'a', options: {} }] }),
    )
    expect(item?.caption).toBe('Price coming soon')
  })
})

describe('commerceSiteSearch.items', () => {
  it('reads the storefront scope and the name-token match, each bounded', async () => {
    stored['products'] = new Map([['p1', product()]])
    stored['productCategories'] = new Map([['c-tops', { name: 'Tops' }]])
    const items = await commerceSiteSearch.items({
      hostId: 'host-1',
      query: 'hoodie',
      limit: 300,
    })
    expect(items.map((item) => item.url)).toEqual(['/products/team-hoodie'])
    expect(queries).toEqual(
      expect.arrayContaining([
        `products deletedAt == null & status == active limit ${SCAN_LIMIT}`,
        `products nameTokens array-contains hoodie limit ${TOKEN_LIMIT}`,
        'productCategories limit 200',
      ]),
    )
  })

  it('keeps the products the storefront does not list out, even when their name matches', async () => {
    stored['products'] = new Map([
      ['live', product()],
      ['draft', product({ slug: 'draft-hoodie', status: 'draft' })],
      ['gone', product({ slug: 'gone-hoodie', deletedAt: 5 })],
      ['till', product({ slug: 'till-hoodie', sellOnline: false })],
    ])
    const items = await commerceSiteSearch.items({
      hostId: 'host-1',
      query: 'hoodie',
      limit: 300,
    })
    expect(items.map((item) => item.url)).toEqual(['/products/team-hoodie'])
  })

  it('finds a product past the scan by its name token, once', async () => {
    stored['products'] = new Map([
      ['p1', product({ categoryIds: [] })],
      // Stored before the scope keys were stamped, so only the token read reaches it.
      [
        'p2',
        product({
          name: 'Zip Hoodie',
          slug: 'zip-hoodie',
          deletedAt: undefined,
          categoryIds: [],
        }),
      ],
    ])
    const items = await commerceSiteSearch.items({
      hostId: 'host-1',
      query: 'hoodie',
      limit: 300,
    })
    expect(items.map((item) => item.url).sort()).toEqual([
      '/products/team-hoodie',
      '/products/zip-hoodie',
    ])
    // No candidate names a category, so the categories are never read.
    expect(queries.some((line) => line.startsWith('productCategories'))).toBe(
      false,
    )
  })

  it('answers nothing for a host id that is not a document id', async () => {
    expect(
      await commerceSiteSearch.items({
        hostId: 'a/b',
        query: 'hoodie',
        limit: 300,
      }),
    ).toEqual([])
    expect(queries).toEqual([])
  })
})
