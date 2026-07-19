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

const item = (name: string) => ({
  id: name,
  name,
  slug: name.toLowerCase().replace(/ /g, '-'),
  priceUsd: 10,
  maxPriceUsd: 10,
  soldOut: false,
})

function payloadFor(url: string) {
  const params = new URL(`http://test${url}`).searchParams
  if (Number(params.get('offset') ?? 0) > 0) {
    return { items: [item('More product')] }
  }
  return {
    items: [item('First product'), item('Second product')],
    nextOffset: 2,
    categories: [{ id: 'c1', name: 'Apparel', slug: 'apparel' }],
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
    expect(lastUrl()).toContain('offset=2')
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

  it('passes the authored sort through to the catalog API', async () => {
    render(<ProductGrid sort="newest" />)
    await screen.findByText('First product')
    expect(lastUrl()).toContain('sort=newest')
  })
})
