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
 * The product grid as a storefront's shop page (AGL-3676 follow-up): a quick
 * add on each card, and the chip a link like /shop?category=candles asks for.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CART_UPDATED_EVENT } from '../constants/cart-events'
import ProductGrid, { browseParamsFromSearch, quickAddAction } from './product-grid'

const fetchMock = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => (...args: unknown[]) => fetchMock(...args),
}))

const item = (name: string, patch: Record<string, unknown> = {}) => ({
  id: name.toLowerCase().replace(/ /g, '-'),
  name,
  slug: name.toLowerCase().replace(/ /g, '-'),
  priceUsd: 10,
  maxPriceUsd: 10,
  soldOut: false,
  variantCount: 1,
  defaultVariantId: 'default',
  ...patch,
})

const ITEMS = [
  item('Tin Candle'),
  item('Pillar Candle', { variantCount: 3, defaultVariantId: undefined }),
  item('Soon Candle', { priceComingSoon: true }),
  item('Gone Candle', { soldOut: true }),
]

const urls = () => fetchMock.mock.calls.map((call) => String(call[0]))

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).startsWith('/api/commerce/catalog')
        ? {
            items: ITEMS,
            categories: [
              { id: 'c1', name: 'Candles', slug: 'candles' },
              { id: 'c2', name: 'Gifts', slug: 'gifts' },
            ],
          }
        : { ok: true },
  }))
  ;(global as any).fetch = fetchMock
  window.history.replaceState(null, '', '/shop')
})

describe('quick add', () => {
  it('decides from the catalog item: one priced variant in stock adds, several choose', () => {
    expect(quickAddAction({ variantCount: 1, defaultVariantId: 'v', soldOut: false })).toBe('add')
    expect(quickAddAction({ variantCount: 3, soldOut: false })).toBe('options')
    expect(quickAddAction({ variantCount: 1, defaultVariantId: 'v', soldOut: false, priceComingSoon: true })).toBeNull()
    expect(quickAddAction({ variantCount: 1, defaultVariantId: 'v', soldOut: true })).toBeNull()
    // An older payload with no variant facts offers nothing rather than guess.
    expect(quickAddAction({ soldOut: false })).toBeNull()
  })

  it('is off unless asked', async () => {
    render(<ProductGrid cardStyle="photo" />)
    await screen.findByText('Tin Candle')
    expect(screen.queryByText('Add to cart')).toBeNull()
  })

  it('adds the one variant to the cart without following the card, and refreshes the badge', async () => {
    const badge = jest.fn()
    window.addEventListener(CART_UPDATED_EVENT, badge)
    render(<ProductGrid cardStyle="photo" quickAdd />)
    await screen.findByText('Tin Candle')
    // One add, one choose, nothing for the unpriced or sold-out product.
    expect(screen.getAllByText('Add to cart')).toHaveLength(1)
    const choose = screen.getByText('Choose options').closest('a')
    expect(choose?.getAttribute('href')).toBe('/products/pillar-candle')

    const button = screen.getByRole('button', { name: 'Add Tin Candle to cart' })
    expect(button.closest('a')).toBeNull()
    fireEvent.click(button)
    await screen.findByText('Added ✓')
    const cartCall = fetchMock.mock.calls.find((call) => call[0] === '/api/commerce/cart')
    expect(JSON.parse(cartCall?.[1]?.body)).toEqual({
      hostId: 'host-1',
      action: 'add',
      productId: 'tin-candle',
      variantId: 'default',
      quantity: 1,
    })
    expect(badge).toHaveBeenCalled()
    window.removeEventListener(CART_UPDATED_EVENT, badge)
  })
})

describe('a shop page opened from a link', () => {
  it('reads ?category= and ?tag=', () => {
    expect(browseParamsFromSearch('?category=candles&tag=gift')).toEqual({ categorySlug: 'candles', tag: 'gift' })
    expect(browseParamsFromSearch('')).toEqual({ categorySlug: '', tag: '' })
  })

  it('opens with the linked category chip picked', async () => {
    window.history.replaceState(null, '', '/shop?category=gifts')
    render(<ProductGrid showCategories />)
    await waitFor(() => expect(urls().some((url) => url.includes('categoryId=c2'))).toBe(true))
  })

  it('opens filtered by the linked tag when the grid shows filters', async () => {
    window.history.replaceState(null, '', '/shop?tag=gift')
    render(<ProductGrid showFilters />)
    await waitFor(() => expect(urls().some((url) => url.includes('tag=gift'))).toBe(true))
  })

  it('ignores the address on a grid that does not browse', async () => {
    window.history.replaceState(null, '', '/shop?category=gifts&tag=gift')
    render(<ProductGrid />)
    await screen.findByText('Tin Candle')
    expect(urls().every((url) => !url.includes('categoryId') && !url.includes('tag='))).toBe(true)
  })
})
