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
 * The product page and the storefront blocks around it (AGL-3676 follow-up).
 * An AI-built store's product page showed a "Scent" select with nothing to
 * pick, a one-line description and nothing else, and its "You may also like"
 * drew a blank tile; a storefront home needs a reviews band that shows real
 * reviews or nothing.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProductDetail, { optionPresentation, productDetailFacts, productShippingLines } from './product-detail'
import ProductReviews from './product-reviews'
import RelatedProducts from './related-products'

const mockSite: { hostId: string; pageData?: unknown } = { hostId: 'host-1' }

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => mockSite,
}))

const fetchMock = jest.fn()

beforeEach(() => {
  mockSite.hostId = 'host-1'
  mockSite.pageData = undefined
  fetchMock.mockReset()
  // The product page's side reads (fulfillment, checkout return) answer
  // nothing in particular.
  fetchMock.mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  ;(global as any).fetch = fetchMock
})

const candle = (patch: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Candle Gift Set',
  slug: 'candle-gift-set',
  description: 'Three hand-poured candles.',
  type: 'physical',
  mediaUrls: ['/media/a.jpg', '/media/b.jpg'],
  options: [{ name: 'Scent', values: ['Lavender'] }],
  variants: [{ id: 'v1', options: { Scent: 'Lavender' }, priceUsd: 25, soldOut: false }],
  ...patch,
})

describe('which options are a choice', () => {
  it('shows a select only for two or more values the variants carry', () => {
    expect(
      optionPresentation(
        [
          { name: 'Scent', values: ['Lavender'] },
          { name: 'Size', values: ['S', 'L'] },
          { name: 'Wick', values: ['Cotton', 'Wood'] },
          { name: 'Empty', values: [] },
        ],
        [
          { options: { Scent: 'Lavender', Size: 'S', Wick: 'Cotton' } },
          { options: { Scent: 'Lavender', Size: 'L', Wick: 'Cotton' } },
        ],
      ).map((option) => [option.name, option.mode, option.values]),
    ).toEqual([
      ['Scent', 'text', ['Lavender']],
      ['Size', 'select', ['S', 'L']],
      // Listed twice, but every variant is cotton: not a choice.
      ['Wick', 'text', ['Cotton']],
      ['Empty', 'hidden', []],
    ])
  })

  it('offers no choice of an option one variant cannot be several of', () => {
    expect(optionPresentation([{ name: 'Scent', values: ['A', 'B'] }], [{ id: 'default' } as never])[0].mode).toBe(
      'hidden',
    )
  })
})

describe('the product page', () => {
  it('shows a single-value option as text, with no select', () => {
    mockSite.pageData = { commerce: { product: candle() } }
    render(<ProductDetail />)
    expect(screen.getByText('Scent: Lavender')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('opens a real choice on the first variant on sale, seeded server-side', () => {
    mockSite.pageData = {
      commerce: {
        product: candle({
          options: [{ name: 'Scent', values: ['Lavender', 'Cedar'] }],
          variants: [
            { id: 'v1', options: { Scent: 'Lavender' }, priceUsd: 25, soldOut: true },
            { id: 'v2', options: { Scent: 'Cedar' }, priceUsd: 27, soldOut: false },
          ],
        }),
      },
    }
    render(<ProductDetail />)
    expect(screen.getByRole('combobox').textContent).toBe('Cedar')
    expect(screen.getByText('$27')).toBeTruthy()
  })

  it('draws the Details and Shipping & returns folds only when asked', () => {
    mockSite.pageData = { commerce: { product: candle({ tags: ['gift'] }), returns: { windowDays: 30 } } }
    const { unmount } = render(<ProductDetail />)
    expect(screen.queryByText('Details')).toBeNull()
    expect(screen.queryByText('Shipping & returns')).toBeNull()
    unmount()

    render(<ProductDetail showDetails showShipping />)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText('gift')).toBeTruthy()
    fireEvent.click(screen.getByText('Shipping & returns'))
    expect(screen.getByText('Shipping is calculated at checkout.')).toBeTruthy()
    expect(screen.getByText(/Returns accepted within 30 days/)).toBeTruthy()
  })

  it('states only what the record holds, and no return policy the store has not set', () => {
    expect(productDetailFacts({ type: 'physical' }, undefined, [])).toEqual([])
    expect(productDetailFacts({ type: 'digital', tags: ['pdf'] }, { sku: 'EB-1' }, [])).toEqual([
      { label: 'Format', value: 'Digital product' },
      { label: 'SKU', value: 'EB-1' },
      { label: 'Tags', value: 'pdf' },
    ])
    expect(productShippingLines({ type: 'physical' }, undefined)).toEqual(['Shipping is calculated at checkout.'])
    expect(productShippingLines({ type: 'digital' }, undefined)).toEqual([
      'Delivered digitally after purchase — nothing ships.',
    ])
  })

  it('swaps the photo for a picked thumbnail', () => {
    mockSite.pageData = { commerce: { product: candle() } }
    const { container } = render(<ProductDetail />)
    const images = () => [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'))
    expect(images()[0]).toBe('/media/a.jpg')
    fireEvent.click(container.querySelectorAll('img')[2])
    expect(images()[0]).toBe('/media/b.jpg')
  })
})

describe('related products', () => {
  beforeEach(() => {
    mockSite.pageData = { commerce: { product: { id: 'p1' } } }
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith('/api/commerce/related')
          ? { productIds: ['p2', 'p3'] }
          : {
              items: [
                { id: 'p2', name: 'Travel Tin Soy Candle', slug: 'travel-tin', priceUsd: 12 },
                { id: 'p3', name: 'Pillar', slug: 'pillar', priceUsd: 18, imageUrl: '/media/p.jpg' },
              ],
            },
    }))
  })

  it('draws a product with no photo as a placeholder tile, never a blank one', async () => {
    render(<RelatedProducts layout="grid" />)
    await screen.findByText('Travel Tin Soy Candle')
    const placeholder = screen.getByTestId('product-image-placeholder')
    expect(placeholder.getAttribute('aria-label')).toBe('Travel Tin Soy Candle — no photo yet')
    expect(placeholder.textContent).toBe('T')
    // The seeded page's product is the anchor: no product lookup first.
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/commerce/related?hostId=host-1&productId=p1')
  })
})

describe('store-wide reviews', () => {
  const answer = (body: unknown) =>
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => body }))

  it('renders nothing on a published page with no approved reviews', async () => {
    answer({ reviews: [], aggregate: { count: 0, average: 0 } })
    const { container } = render(<ProductReviews scope="store" heading="Loved by customers" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // Past the answer, not just the request.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('scope=store')
    expect(screen.queryByText('Loved by customers')).toBeNull()
    expect(container.textContent).toBe('')
    expect((container.firstChild as HTMLElement).getAttribute('data-store-reviews-empty')).toBe('')
  })

  it('shows real reviews with stars, the aggregate and its heading, and no form', async () => {
    answer({
      reviews: [
        { id: 'r1', rating: 5, body: 'Smells wonderful.', authorName: 'Jane D.', verified: true, createdAtMs: 2, productName: 'Candle Gift Set', productSlug: 'candle-gift-set' },
      ],
      aggregate: { count: 3, average: 4.7 },
    })
    render(<ProductReviews scope="store" heading="Loved by customers" headingLevel={3} />)
    expect((await screen.findByText('Loved by customers')).tagName).toBe('H3')
    expect(screen.getByText('Smells wonderful.')).toBeTruthy()
    expect(screen.getByText('Jane D.')).toBeTruthy()
    expect(screen.getByText('Verified buyer')).toBeTruthy()
    expect(screen.getByText('4.7 out of 5 · 3 reviews')).toBeTruthy()
    expect(screen.getByRole('img', { name: '5 Stars' })).toBeTruthy()
    expect(screen.queryByText('Write a review')).toBeNull()
  })

  it('shows the editor a hint, never sample reviews', () => {
    mockSite.hostId = ''
    render(<ProductReviews scope="store" />)
    expect(screen.getByText(/Customer reviews appear here once shoppers review your products/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
