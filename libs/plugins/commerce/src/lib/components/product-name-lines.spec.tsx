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
 * A product card's name wraps to two lines before its ellipsis, on both
 * Product grid card styles and both Related products layouts, so two
 * products whose names start alike never read as one on a phone.
 */

import { render, screen } from '@testing-library/react'
import ProductGrid from './product-grid'
import { PRODUCT_NAME_LINES, PRODUCT_NAME_SX } from './product-name-lines'
import RelatedProducts from './related-products'

const fetchMock = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => (...args: unknown[]) => fetchMock(...args),
}))

const LONG_NAME = 'Touchscreen reader, 4G-capable (Model B)'

const ITEMS = [
  {
    id: 'reader',
    name: LONG_NAME,
    slug: 'reader',
    priceUsd: 249,
    maxPriceUsd: 249,
    soldOut: false,
    imageUrl: 'https://cdn.example.test/reader.png',
  },
]

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => {
      const path = String(url)
      if (path.startsWith('/api/commerce/related')) return { productIds: ['reader'] }
      if (path.startsWith('/api/commerce/catalog')) return { items: ITEMS }
      return {}
    },
  }))
  ;(global as any).fetch = fetchMock
})

function expectClampedName(name: HTMLElement) {
  // No single-line cut…
  expect(name.className).not.toMatch(/MuiTypography-noWrap/)
  const style = getComputedStyle(name)
  expect(style.whiteSpace).not.toBe('nowrap')
  expect(style.textOverflow).not.toBe('ellipsis')
  // …but a box that clips at its lines rather than growing without end.
  expect(style.overflow).toBe('hidden')
}

describe('product names on storefront cards', () => {
  it('wrap to two lines, then ellipsis, with two lines always reserved', () => {
    expect(PRODUCT_NAME_LINES).toBe(2)
    expect(PRODUCT_NAME_SX).toEqual({
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      overflowWrap: 'anywhere',
      minHeight: '2lh',
    })
  })

  describe.each(['outlined', 'photo'] as const)('product grid, %s cards', (cardStyle) => {
    it('is not cut to one line', async () => {
      render(<ProductGrid cardStyle={cardStyle} />)
      expectClampedName(await screen.findByText(LONG_NAME))
    })
  })

  describe.each(['strip', 'grid'] as const)('related products, %s layout', (layout) => {
    it('is not cut to one line', async () => {
      render(<RelatedProducts productId="anchor" layout={layout} />)
      expectClampedName(await screen.findByText(LONG_NAME))
    })
  })
})
