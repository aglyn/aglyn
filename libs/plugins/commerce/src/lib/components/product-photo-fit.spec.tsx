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
 * The Photo fit element setting: a store owner can show each product photo
 * whole instead of cropped, on the Product grid and on Related products.
 * Blank or unknown stays `cover`, so no existing site changes.
 */

import { render, screen } from '@testing-library/react'
import ProductGrid, * as ProductGridModule from './product-grid'
import { productPhotoFit, productPhotoFitSx } from './product-photo-fit'
import RelatedProducts, * as RelatedProductsModule from './related-products'

const fetchMock = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => (...args: unknown[]) => fetchMock(...args),
}))

const ITEMS = [
  {
    id: 'dock',
    name: 'Charging Dock',
    slug: 'charging-dock',
    priceUsd: 40,
    maxPriceUsd: 40,
    soldOut: false,
    imageUrl: 'https://cdn.example.test/dock.png',
  },
]

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => {
      const path = String(url)
      if (path.startsWith('/api/commerce/related')) return { productIds: ['dock'] }
      if (path.startsWith('/api/commerce/catalog')) return { items: ITEMS }
      return {}
    },
  }))
  ;(global as any).fetch = fetchMock
})

const fitOf = (img: HTMLElement) => getComputedStyle(img).objectFit

describe('photo fit', () => {
  it('reads blank and unknown values as cover', () => {
    expect(productPhotoFit(undefined)).toBe('cover')
    expect(productPhotoFit('')).toBe('cover')
    expect(productPhotoFit('stretch')).toBe('cover')
    expect(productPhotoFit('cover')).toBe('cover')
    expect(productPhotoFit('contain')).toBe('contain')
  })

  it('frames a whole photo on the theme neutral with room around it, never a fixed colour', () => {
    expect(productPhotoFitSx('cover')).toEqual({ objectFit: 'cover' })
    expect(productPhotoFitSx('contain')).toEqual({
      objectFit: 'contain',
      boxSizing: 'border-box',
      p: 1.5,
      bgcolor: 'action.hover',
    })
  })

  it('is an element setting on both storefront card blocks, after the look it shapes', () => {
    for (const [schema, after] of [
      [ProductGridModule.schema, 'cardStyle'],
      [RelatedProductsModule.schema, 'layout'],
    ] as const) {
      const names = (schema.attributes ?? []).map((attribute) => attribute.name)
      expect(names.indexOf('photoFit')).toBe(names.indexOf(after) + 1)
      const attribute = schema.attributes?.find((a) => a.name === 'photoFit')
      expect(attribute?.label).toBe('Photo fit')
      expect(attribute?.options).toEqual([
        { label: 'Fill the frame (crops to fit)', value: 'cover' },
        { label: 'Show the whole photo', value: 'contain' },
      ])
    }
  })

  describe.each(['outlined', 'photo'] as const)('product grid, %s cards', (cardStyle) => {
    it('crops to the frame by default', async () => {
      render(<ProductGrid cardStyle={cardStyle} />)
      expect(fitOf(await screen.findByAltText('Charging Dock'))).toBe('cover')
    })

    it('shows the whole photo when asked', async () => {
      render(<ProductGrid cardStyle={cardStyle} photoFit="contain" />)
      expect(fitOf(await screen.findByAltText('Charging Dock'))).toBe('contain')
    })

    it('falls back to cover for a value it does not know', async () => {
      render(<ProductGrid cardStyle={cardStyle} photoFit={'stretch' as never} />)
      expect(fitOf(await screen.findByAltText('Charging Dock'))).toBe('cover')
    })
  })

  describe.each(['strip', 'grid'] as const)('related products, %s layout', (layout) => {
    it('crops to the frame by default', async () => {
      render(<RelatedProducts productId="anchor" layout={layout} />)
      expect(fitOf(await screen.findByAltText('Charging Dock'))).toBe('cover')
    })

    it('shows the whole photo when asked', async () => {
      render(<RelatedProducts productId="anchor" layout={layout} photoFit="contain" />)
      expect(fitOf(await screen.findByAltText('Charging Dock'))).toBe('contain')
    })

    it('falls back to cover for a value it does not know', async () => {
      render(<RelatedProducts productId="anchor" layout={layout} photoFit={'stretch' as never} />)
      expect(fitOf(await screen.findByAltText('Charging Dock'))).toBe('cover')
    })
  })
})
