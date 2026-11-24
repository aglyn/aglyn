/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * Site search finds a store's products: the commerce plugin's REAL source,
 * registered through core's `core.site-search` contract exactly as its boot
 * does, over a seeded products collection. What is asserted is the whole
 * path a visitor's "hoodie" takes — which products the store offers, how the
 * typed word matches them, where they sit among the pages, and the tabs.
 */

const HOST_ID = 'host_store'

type Doc = Record<string, unknown>

/** The documents under the host, by subcollection. */
const stored: Record<string, Map<string, Doc>> = {}

const snapshotOf = (id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => data?.[field],
})

/** A query over one subcollection: `==` and `array-contains`, then `limit`. */
function query(name: string, filters: Array<[string, string, unknown]>): any {
  return {
    where: (field: string, op: string, value: unknown) =>
      query(name, [...filters, [field, op, value]]),
    limit: (count: number) => ({
      get: async () => ({
        docs: [...(stored[name] ?? new Map()).entries()]
          .filter(([, data]) =>
            filters.every(([field, op, value]) =>
              op === 'array-contains'
                ? Array.isArray(data[field]) &&
                  (data[field] as unknown[]).includes(value)
                : data[field] !== undefined && data[field] === value,
            ),
          )
          .slice(0, count)
          .map(([id, data]) => snapshotOf(id, data)),
      }),
    }),
  }
}

const hostRef = {
  collection: (name: string) => ({
    ...query(name, []),
    doc: (id: string) => ({
      get: async () => snapshotOf(id, stored[name]?.get(id)),
    }),
  }),
}
const firestore = { collection: () => ({ doc: () => hostRef }) }

// Factories, not bare `jest.mock`: the module graph under
// `@aglyn/tenant-data-admin` reaches `undici`, and an auto-mock still
// evaluates the real graph to derive its shape.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
}))
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: jest.fn(
    async (options: { read: () => Promise<unknown> }) => options.read(),
  ),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
  })),
}))
jest.mock('@aglyn/tenant-runtime/get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ version: undefined, error: null })),
}))
jest.mock('@aglyn/aglyn/plugin-manager/repeat-rows', () => ({
  __esModule: true,
  readRepeatRows: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/aglyn/app-utils/tenant-apex', () => ({ TENANT_APEX: 'aglyn.app' }))
// The REAL helpers, reached by file path so the stub stays light — the
// matcher above all: a faked one would assert nothing about typos.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  screenRoutePathToUrl: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/screen-route',
  ).screenRoutePathToUrl,
  hostCollectionKind: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-kind',
  ).hostCollectionKind,
  decodeStoredNodes: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/stored-nodes',
  ).decodeStoredNodes,
  repeatKeys: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/expand-repeatables',
  ).repeatKeys,
  COLLECTION_SEARCH_FUSE_OPTIONS: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entries',
  ).COLLECTION_SEARCH_FUSE_OPTIONS,
  formatCollectionEntryDate: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entries',
  ).formatCollectionEntryDate,
}))

import {
  registerPluginSiteSearchSource,
  type PluginSiteSearchSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-search'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { commerceSiteSearch } from '@aglyn/plugins-commerce/server/site-search'
import { withRenderCache } from '@aglyn/tenant-data-admin/render-cache'
import searchContent, {
  filterSearchResults,
  searchResultFacets,
} from '../utils/search-content'

const COMMERCE = 'commerce'
const STORE_ON = ['mui', COMMERCE]

const product = (overrides: Doc = {}): Doc => ({
  name: 'Team Hoodie',
  slug: 'team-hoodie',
  description: 'Heavyweight fleece pullover.',
  type: 'physical',
  status: 'active',
  deletedAt: null,
  mediaUrls: ['https://cdn.example.com/hoodie.jpg'],
  variants: [
    { id: 's', options: {}, priceUsd: 45, sku: 'HD-S' },
    { id: 'l', options: {}, priceUsd: 50, sku: 'HD-L' },
  ],
  ...overrides,
})

/** A site with one page about hoodies and the given products. */
const seed = (products: Record<string, Doc>) => {
  for (const key of Object.keys(stored)) delete stored[key]
  stored['screens'] = new Map([
    ['s_shop', { displayName: 'Hoodie season', description: 'Our hoodies' }],
  ])
  stored['products'] = new Map(Object.entries(products))
  return { $id: HOST_ID, screens: { s_shop: 'shop' } } as any
}

/** How many times the store was asked, through a counting wrapper. */
let asked = 0
const countingSource: PluginSiteSearchSource = {
  ...commerceSiteSearch,
  items: async (request) => {
    asked += 1
    return commerceSiteSearch.items(request)
  },
}

beforeEach(() => {
  asked = 0
  jest.clearAllMocks()
  unregisterPluginServices(COMMERCE)
  registerPluginSiteSearchSource(countingSource, { pluginId: COMMERCE })
})

describe('searchContent: store products', () => {
  it('finds a product by its name, ahead of the page that mentions it', async () => {
    const host = seed({ p1: product() })

    const results = await searchContent({
      host,
      query: 'hoodie',
      enabledPlugins: STORE_ON,
    })

    expect(results).toEqual([
      {
        kind: 'product',
        title: 'Team Hoodie',
        url: '/products/team-hoodie',
        snippet: 'Heavyweight fleece pullover.',
        group: { key: 'products', label: 'Products' },
        imageUrl: 'https://cdn.example.com/hoodie.jpg',
        caption: 'From $45',
      },
      expect.objectContaining({ kind: 'page', url: '/shop' }),
    ])
  })

  it('forgives a typo in the name, as a collection entry does', async () => {
    const host = seed({ p1: product() })

    const results = await searchContent({
      host,
      query: 'hodie',
      enabledPlugins: STORE_ON,
    })

    expect(results.map((result) => result.url)).toEqual([
      '/products/team-hoodie',
    ])
  })

  it('finds a product by a SKU, after the pages', async () => {
    const host = seed({ p1: product({ name: 'Pullover' }) })
    stored['screens'].set('s_shop', { displayName: 'HD-L sizing guide' })

    const results = await searchContent({
      host,
      query: 'hd-l',
      enabledPlugins: STORE_ON,
    })

    expect(results.map((result) => result.kind)).toEqual(['page', 'product'])
  })

  it.each([
    ['not sold online', { sellOnline: false }],
    ['a draft', { status: 'draft' }],
    ['deleted', { deletedAt: 1_700_000_000_000 }],
  ])('leaves out a product that is %s', async (_label, overrides) => {
    const host = seed({ p1: product(overrides) })

    const results = await searchContent({
      host,
      query: 'hoodie',
      enabledPlugins: STORE_ON,
    })

    expect(results.map((result) => result.kind)).toEqual(['page'])
  })

  it('never asks the store on a site without commerce', async () => {
    const host = seed({ p1: product() })

    const withoutStore = await searchContent({
      host,
      query: 'hoodie',
      enabledPlugins: ['mui'],
    })
    const noPlugins = await searchContent({ host, query: 'hoodie' })

    expect(withoutStore.map((result) => result.kind)).toEqual(['page'])
    expect(noPlugins.map((result) => result.kind)).toEqual(['page'])
    expect(asked).toBe(0)
  })

  it('counts a Products tab beside Pages, and filters to it', async () => {
    const host = seed({
      p1: product(),
      p2: product({ name: 'Zip Hoodie', slug: 'zip-hoodie' }),
    })

    const results = await searchContent({
      host,
      query: 'hoodie',
      enabledPlugins: STORE_ON,
    })

    expect(searchResultFacets(results)).toEqual([
      { key: 'all', label: 'All', count: 3 },
      { key: 'products', label: 'Products', count: 2 },
      { key: 'pages', label: 'Pages', count: 1 },
    ])
    expect(
      filterSearchResults(results, 'products').map((result) => result.url),
    ).toEqual(['/products/team-hoodie', '/products/zip-hoodie'])
    expect(
      filterSearchResults(results, 'pages').map((result) => result.url),
    ).toEqual(['/shop'])
  })

  it('keeps the pages when the store cannot answer', async () => {
    const host = seed({ p1: product() })
    unregisterPluginServices(COMMERCE)
    registerPluginSiteSearchSource(
      {
        ...commerceSiteSearch,
        items: async () => {
          throw new Error('products unreadable')
        },
      },
      { pluginId: COMMERCE },
    )
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const results = await searchContent({
      host,
      query: 'hoodie',
      enabledPlugins: STORE_ON,
    })

    expect(results.map((result) => result.kind)).toEqual(['page'])
    quiet.mockRestore()
  })

  it('keys the cache on the sources in force, and leaves a site without them on its old key', async () => {
    const host = seed({ p1: product() })

    await searchContent({ host, query: 'hoodie', enabledPlugins: STORE_ON })
    await searchContent({ host, query: 'hoodie', enabledPlugins: ['mui'] })

    const keys = (withRenderCache as jest.Mock).mock.calls.map(
      ([options]) => options.key,
    )
    expect(keys).toEqual([
      ['tenant-site-search', HOST_ID, 'hoodie', 'UTC', 'sources:products'],
      ['tenant-site-search', HOST_ID, 'hoodie', 'UTC'],
    ])
    expect(
      (withRenderCache as jest.Mock).mock.calls.map(([options]) => options.tags),
    ).toEqual([[`tenant-data:${HOST_ID}`], [`tenant-data:${HOST_ID}`]])
  })
})
