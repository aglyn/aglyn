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
 * A product-page template in the Besigner's Preview (AGL-4211). Its Product
 * detail block has no product pinned and Preview has no `/products/{slug}`
 * address, so it drew a skeleton forever. It now shows the store's first
 * listed product, or the sample when the store lists none. A live page is
 * unchanged: it never asks the catalog.
 */

import { render, screen, waitFor } from '@testing-library/react'
import ProductDetail from './product-detail'
import { firstListedProductSlug } from './product-preview-slug'

const mockSite: { hostId: string; preview?: boolean } = { hostId: 'host-1', preview: true }

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => mockSite,
}))

const CANOPY = {
  id: 'canopy',
  name: 'Canopy',
  slug: 'canopy',
  type: 'physical',
  mediaUrls: [],
  options: [],
  variants: [{ id: 'default', priceUsd: 900, soldOut: false }],
}

const fetchMock = jest.fn()
let listed: Array<{ slug: string }> = []

beforeEach(() => {
  mockSite.preview = true
  listed = [{ slug: 'canopy' }]
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    const path = String(url)
    if (path.startsWith('/api/commerce/catalog')) return { ok: true, json: async () => ({ items: listed }) }
    if (path.startsWith('/api/commerce/product') && path.includes('slug=canopy')) {
      return { ok: true, json: async () => ({ product: CANOPY }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  ;(global as any).fetch = fetchMock
})

const asked = (prefix: string) => fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(prefix))

describe('a product-page template in Preview', () => {
  it('shows the store’s first listed product', async () => {
    render(<ProductDetail />)
    expect(await screen.findByRole('heading', { name: 'Canopy' })).toBeTruthy()
    expect(String(asked('/api/commerce/catalog')[0][0])).toBe('/api/commerce/catalog?hostId=host-1&limit=1')
    expect(String(asked('/api/commerce/product')[0][0])).toContain('slug=canopy')
  })

  it('shows the sample when the store lists no product', async () => {
    listed = []
    render(<ProductDetail />)
    expect(await screen.findByRole('heading', { name: 'Sample product' })).toBeTruthy()
    expect(asked('/api/commerce/product')).toHaveLength(0)
  })

  it('leaves a pinned product to its own slug', async () => {
    render(<ProductDetail slug="canopy" />)
    expect(await screen.findByRole('heading', { name: 'Canopy' })).toBeTruthy()
    expect(asked('/api/commerce/catalog')).toHaveLength(0)
  })

  it('never asks the catalog on a live page', async () => {
    mockSite.preview = false
    render(<ProductDetail />)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sample product' })).toBeNull())
    expect(asked('/api/commerce/catalog')).toHaveLength(0)
  })
})

describe('the first listed product', () => {
  it('reads the slug, and answers empty for no product, a refusal or a failure', async () => {
    const reply = (ok: boolean, body: unknown) => async () => ({ ok, json: async () => body }) as Response
    expect(await firstListedProductSlug('h', reply(true, { items: [{ slug: 'a' }] }))).toBe('a')
    expect(await firstListedProductSlug('h', reply(true, { items: [] }))).toBe('')
    expect(await firstListedProductSlug('h', reply(false, {}))).toBe('')
    expect(
      await firstListedProductSlug('h', async () => {
        throw new Error('offline')
      }),
    ).toBe('')
  })
})
