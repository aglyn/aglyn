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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProductGrid from './product-grid'

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
}))

const item = (name: string, tags?: string[]) => ({
  id: name,
  name,
  slug: name.toLowerCase().replace(/ /g, '-'),
  priceUsd: 10,
  maxPriceUsd: 10,
  soldOut: false,
  ...(tags ? { tags } : {}),
})

function payloadFor(url: string) {
  const params = new URL(`http://test${url}`).searchParams
  if (params.get('after')) {
    return { items: [item('More product')] }
  }
  if (params.get('q') && params.get('categoryId')) {
    // The catalog's own answer to two array clauses (AGL-3321).
    return {
      items: [item('Searched product')],
      // The plan's refusal as the handler returns it; the grid names it.
      refused: [
        {
          clause: { field: 'category', op: 'contains', value: params.get('categoryId') },
          reason: 'cannot be combined with the search — clear the search to use it',
        },
      ],
    }
  }
  if (params.get('tag')) {
    return { items: [item('Tagged product', ['summer'])] }
  }
  if (params.get('inStock') === '1') {
    return { items: [item('Stocked product')] }
  }
  return {
    items: [item('First product', ['summer']), item('Second product', ['winter'])],
    nextCursor: 'cursor-2',
    categories: [{ id: 'c1', name: 'Apparel', slug: 'apparel' }],
    priceBounds: { minCents: 1200, maxCents: 4900 },
  }
}

const fetchMock = jest.fn()
const lastUrl = () => String(fetchMock.mock.calls.at(-1)?.[0] ?? '')

/** Storefront catalog UX (AGL-561): the controls drive server params. */
describe('product grid catalog controls', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => payloadFor(url),
    }))
    ;(global as any).fetch = fetchMock
  })

  it('loads server items, facets, and appends pages via Load more', async () => {
    render(
      <ProductGrid showSearch showCategories showSort pageSize={2} />,
    )
    await screen.findByText('First product')
    expect(lastUrl()).toContain('facets=1')
    expect(lastUrl()).toContain('limit=2')
    // Category chips come from the facets payload.
    await screen.findByText('Apparel')

    fireEvent.click(screen.getByText('Load more'))
    await screen.findByText('More product')
    // Paged by the query's own cursor (AGL-3321), not by a position.
    expect(lastUrl()).toContain('after=cursor-2')
    expect(lastUrl()).not.toContain('offset=')
    expect(lastUrl()).not.toContain('facets=1')
    // Appended, not replaced.
    expect(screen.getByText('First product')).toBeTruthy()
  })

  it('debounces search input into a server q param', async () => {
    render(<ProductGrid showSearch />)
    await screen.findByText('First product')
    const initialCalls = fetchMock.mock.calls.length
    const input = screen.getByLabelText('Search products')
    fireEvent.change(input, { target: { value: 'ha' } })
    fireEvent.change(input, { target: { value: 'hat' } })
    await waitFor(() => expect(lastUrl()).toContain('q=hat'))
    // One debounced request for the two keystrokes.
    expect(fetchMock.mock.calls.length).toBe(initialCalls + 1)
  })

  it('filters by category chip and product type server-side', async () => {
    render(<ProductGrid showCategories showTypeFilter />)
    await screen.findByText('Apparel')
    fireEvent.click(screen.getByText('Apparel'))
    await waitFor(() => expect(lastUrl()).toContain('categoryId=c1'))
    fireEvent.click(screen.getByText('All'))
    await waitFor(() => expect(lastUrl()).not.toContain('categoryId'))
    fireEvent.click(screen.getByText('Digital'))
    await waitFor(() => expect(lastUrl()).toContain('type=digital'))
  })

  it('drives debounced minPriceCents/maxPriceCents from the price slider', async () => {
    render(<ProductGrid showPriceFilter />)
    await screen.findByText('First product')
    // The price facets ride the same facets=1 request as categories.
    expect(lastUrl()).toContain('facets=1')
    const initialCalls = fetchMock.mock.calls.length
    // Bounds 1200–4900 cents widen to whole dollars: $12–$49.
    const minThumb = await screen.findByLabelText('Minimum price')
    fireEvent.change(minThumb, { target: { value: '15' } })
    fireEvent.change(minThumb, { target: { value: '20' } })
    await waitFor(() => expect(lastUrl()).toContain('minPriceCents=2000'))
    expect(lastUrl()).toContain('maxPriceCents=4900')
    // One debounced request for the two drags, like search keystrokes.
    expect(fetchMock.mock.calls.length).toBe(initialCalls + 1)
  })

  /**
   * A tag chip ASKS the catalog for that tag (AGL-3321). It used to hide the
   * loaded cards that lacked it, so a product carrying the tag one page
   * further on was answered "not here".
   *
   * Forced red by restoring the in-memory `visible.filter` on `activeTag`:
   * no request then carries `tag=summer`.
   */
  it('asks the server for a picked tag rather than narrowing the cards', async () => {
    render(<ProductGrid showFilters />)
    await screen.findByText('First product')
    fireEvent.click(screen.getByText('summer'))
    await waitFor(() => expect(lastUrl()).toContain('tag=summer'))
    await screen.findByText('Tagged product')
  })

  /**
   * The In stock chip ASKS the catalog (`inStock=1`, served as
   * `soldOut == false`) rather than hiding the sold-out cards on screen.
   *
   * Forced red by restoring the in-memory `visible.filter(!soldOut)`: no
   * request then carries `inStock=1`.
   */
  it('asks the server for in-stock products rather than hiding cards', async () => {
    render(<ProductGrid showFilters />)
    await screen.findByText('First product')
    fireEvent.click(screen.getByText('In stock'))
    await waitFor(() => expect(lastUrl()).toContain('inStock=1'))
    await screen.findByText('Stocked product')
  })

  it('says which control the query could not apply', async () => {
    render(<ProductGrid showSearch showCategories />)
    await screen.findByText('Apparel')
    fireEvent.click(screen.getByText('Apparel'))
    await waitFor(() => expect(lastUrl()).toContain('categoryId=c1'))
    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: 'hat' },
    })
    await screen.findByText('Searched product')
    expect(
      await screen.findByText(
        'Category contains Apparel is not applied: cannot be combined with the search — clear the search to use it.',
      ),
    ).toBeTruthy()
  })

  it('clears the search when a category chip is picked', async () => {
    render(<ProductGrid showSearch showCategories />)
    await screen.findByText('Apparel')
    const input = screen.getByLabelText('Search products') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hat' } })
    await waitFor(() => expect(lastUrl()).toContain('q=hat'))
    fireEvent.click(screen.getByText('Apparel'))
    await waitFor(() => expect(lastUrl()).toContain('categoryId=c1'))
    expect(lastUrl()).not.toContain('q=')
    expect(input.value).toBe('')
  })

  it('passes the authored sort through to the catalog API', async () => {
    render(<ProductGrid sort="newest" />)
    await screen.findByText('First product')
    expect(lastUrl()).toContain('sort=newest')
  })
})

/*
 * A product listed before it has a price (AGL-3676) — a guided start's — says
 * so where its price would be, never "$0"; and photo cards lead with the
 * picture, each still linking its product's page.
 */
describe('product grid cards', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        items: [
          { ...item('Soy Candle'), priceUsd: 0, maxPriceUsd: 0, priceComingSoon: true, imageUrl: '/media/candle.jpg' },
          item('Wax Melts'),
        ],
      }),
    }))
    ;(global as any).fetch = fetchMock
  })

  it('says “Price coming soon” for a product with no price yet, and the price for the rest', async () => {
    render(<ProductGrid cardStyle="photo" />)
    await screen.findByText('Soy Candle')
    expect(screen.getByText('Price coming soon')).toBeTruthy()
    expect(screen.queryByText('$0')).toBeNull()
    expect(screen.getByText('$10')).toBeTruthy()
    expect(screen.getByAltText('Soy Candle').closest('a')?.getAttribute('href')).toBe('/products/soy-candle')
  })
})

/*
 * A store that opens before its first products (AGL-3676): the live Hearth &
 * Wick start's products step failed, and its Shop page must still read as a
 * storefront — a headline, a line and one way to hear more, never sample
 * products and never a sort select over nothing.
 */
describe('product grid with nothing listed yet', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ items: [], categories: [] }) }))
    ;(global as any).fetch = fetchMock
  })

  it('opens as the empty panel, with its action, and no controls', async () => {
    render(
      <ProductGrid
        cardStyle="photo"
        showSort
        showCategories
        pageSize={12}
        emptyTitle="New pieces are on the way"
        emptyText="Our first pieces are being finished now."
        emptyActionLabel="Get in touch"
        emptyActionHref="/contact"
      />,
    )
    expect(await screen.findByRole('heading', { name: 'New pieces are on the way' })).toBeTruthy()
    expect(screen.getByText('Our first pieces are being finished now.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Get in touch' }).getAttribute('href')).toBe('/contact')
    expect(screen.queryByLabelText('Sort products')).toBeNull()
    expect(screen.queryByText('Sample product')).toBeNull()
  })

  it('keeps the plain line where no headline is set', async () => {
    render(<ProductGrid emptyText="Nothing yet." />)
    expect(await screen.findByText('Nothing yet.')).toBeTruthy()
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
