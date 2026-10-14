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
 * The store's built-in product page (AGL-3676). `/products/{slug}` rendered
 * only through a product template the merchant designated in Store settings,
 * and 404ed without one — behind every card a Product grid links. A store a
 * guided start built has no template, so its catalog linked nowhere. Now a
 * store with none answers with the product block in the site's own header and
 * footer, seeded server-side as a template page is.
 */

const mockChrome = jest.fn()
const mockStore: Record<string, unknown> = {}
const mockProducts: Array<{ id: string; data: () => Record<string, unknown> }> = []
const mockOrg: { org: Record<string, unknown> | null } = { org: null }

jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: async () => null,
  composeNodesWithChrome: (...args: unknown[]) => mockChrome(...args),
}))
jest.mock('@aglyn/tenant-runtime/built-in-page-layout', () => ({
  resolveBuiltInPageLayoutId: async () => 'layout-1',
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: async () => ({ screen: null }),
}))
jest.mock('./reviews', () => ({
  readProductReviews: async () => ({ reviews: [], aggregate: { count: 0, average: 0 } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  getOrgForHost: async () => ({ org: mockOrg.org }),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) => ({
              doc: () => ({ get: async () => ({ get: (field: string) => mockStore[field] }) }),
              where: () => ({ limit: () => ({ get: async () => ({ docs: name === 'products' ? mockProducts : [] }) }) }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import {
  buildProductPageNodes,
  commerceSitePageResolver,
  productPriceText,
  productReturnWindow,
} from './site-page-resolver'

const HOST = { $id: 'host-1', subdomain: 'ember-wick' }
const resolve = (path: string) =>
  commerceSitePageResolver({ hostId: 'host-1', host: HOST, path, slugSegments: path.split('/').filter(Boolean) }) as Promise<any>

const candle = (patch: Record<string, unknown> = {}) => ({
  id: 'p1',
  data: () => ({
    name: 'Signature Soy Candle',
    slug: 'signature-soy-candle',
    status: 'active',
    description: 'Hand-poured in small batches.',
    mediaUrls: ['/media/candle.jpg'],
    variants: [{ id: 'default' }],
    ...patch,
  }),
})

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(mockStore)) delete mockStore[key]
  mockOrg.org = null
  mockProducts.splice(0, mockProducts.length, candle())
  mockChrome.mockImplementation(async () => ({ root: {} }))
})

describe('a store with no product template', () => {
  it('answers a product’s page with the product block in the site’s layout, seeded server-side', async () => {
    const page = await resolve('/products/signature-soy-candle')
    expect(mockChrome).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'host-1', layoutId: 'layout-1', screenNodes: buildProductPageNodes('signature-soy-candle') }),
    )
    expect(page.props.data.screen.data.displayName).toBe('Signature Soy Candle')
    expect(page.props.pageData.commerce.product).toMatchObject({
      id: 'p1',
      slug: 'signature-soy-candle',
      // Listed before it has a price: no price, never $0.
      variants: [{ id: 'default', priceUsd: null }],
    })
  })

  it('answers nothing for a product that is not on sale — a draft, an archived or a deleted one', async () => {
    for (const patch of [{ status: 'draft' }, { status: 'archived' }, { deletedAt: 5 }]) {
      mockProducts.splice(0, mockProducts.length, candle(patch))
      expect(await resolve('/products/signature-soy-candle')).toBeUndefined()
    }
    expect(mockChrome).not.toHaveBeenCalled()
  })

  it('draws the product block for the routed slug, then the related products', () => {
    const nodes = buildProductPageNodes('signature-soy-candle')
    const detail = Object.values(nodes).find((node) => node.componentId === 'product-detail')
    expect(detail?.props).toMatchObject({ slug: 'signature-soy-candle' })
    expect(Object.values(nodes).some((node) => node.componentId === 'related-products')).toBe(true)
  })
})

describe('the built-in product page looks like a storefront’s', () => {
  it('opens the Details and Shipping & returns folds under the description', () => {
    const nodes = buildProductPageNodes('signature-soy-candle')
    const detail = Object.values(nodes).find((node) => node.componentId === 'product-detail')
    expect(detail?.props).toEqual({ slug: 'signature-soy-candle', showDetails: true, showShipping: true })
  })

  it('draws the related products as a grid of photo cards', () => {
    const nodes = buildProductPageNodes('signature-soy-candle')
    const related = Object.values(nodes).find((node) => node.componentId === 'related-products')
    expect(related?.props).toMatchObject({ heading: 'You may also like', layout: 'grid' })
  })

  it('places the reviews only where the store’s plan collects them, before the related products', async () => {
    expect(Object.values(buildProductPageNodes('x')).some((node) => node.componentId === 'product-reviews')).toBe(false)
    const withReviews = buildProductPageNodes('x', { reviews: true })
    const container = withReviews['pdp__container'] as { nodes: string[] }
    expect(container.nodes).toEqual(['pdp__detail', 'pdp__reviews', 'pdp__related'])

    await resolve('/products/signature-soy-candle')
    expect(mockChrome.mock.calls[0][0].screenNodes['pdp__reviews']).toBeUndefined()
    mockOrg.org = { entitlements: { features: { productReviews: true } } }
    await resolve('/products/signature-soy-candle')
    expect(mockChrome.mock.calls[1][0].screenNodes['pdp__reviews']).toMatchObject({ componentId: 'product-reviews' })
  })

  it('seeds the store’s own return window, and none where it takes no returns of the kind', async () => {
    mockStore['returns'] = { enabled: true, windowDays: 14, eligibleTypes: ['physical'] }
    const page = await resolve('/products/signature-soy-candle')
    expect(page.props.pageData.commerce.returns).toEqual({ windowDays: 14 })

    mockStore['returns'] = { enabled: false, windowDays: 14 }
    const closed = await resolve('/products/signature-soy-candle')
    expect(closed.props.pageData.commerce.returns).toBeUndefined()
  })

  it('reads the return window from the settings the return form enforces', () => {
    expect(productReturnWindow({ type: 'physical' }, undefined)).toEqual({ windowDays: 30 })
    expect(productReturnWindow({ type: 'digital' }, undefined)).toBeUndefined()
    expect(productReturnWindow({ type: 'physical' }, { enabled: false })).toBeUndefined()
    expect(productReturnWindow({ type: 'physical' }, { windowDays: 0 })).toBeUndefined()
  })
})

describe('{{product.price}}', () => {
  it('says the price, from the lowest, or that it is coming soon — never $0', () => {
    expect(productPriceText({ variants: [{ id: 'a', priceUsd: 18 }] }, 18, 18)).toBe('$18')
    expect(productPriceText({ variants: [{ id: 'a', priceUsd: 18 }, { id: 'b', priceUsd: 24 }] }, 18, 24)).toBe('From $18')
    expect(productPriceText({ variants: [{ id: 'a' } as never] }, 0, 0)).toBe('Price coming soon')
  })
})
