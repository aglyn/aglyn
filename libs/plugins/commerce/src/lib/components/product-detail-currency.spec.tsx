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
 * The product page in the shopper's currency (AGL-4248): a New Zealand
 * shopper sees NZ$ for the price, the compare-at and each add-on (a fixed
 * amount winning), and buy-now asks to be charged in NZD.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProductDetail from './product-detail'
import { resetShopperCurrencyCache } from './shopper-currency'

const mockSite: { hostId: string; pageData?: unknown } = { hostId: 'host-1' }

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => mockSite,
}))

const fetchMock = jest.fn()

const ANSWER = {
  base: 'USD',
  currencies: [
    { code: 'USD', rounding: 'none' },
    { code: 'NZD', rounding: 'whole' },
  ],
  autoDetect: true,
  // Per 1 EUR: 1 USD = 1.80 / 1.05 NZD (1.7142857…).
  rates: { base: 'EUR', asOfMs: Date.now(), rates: { USD: 1.05, NZD: 1.8 } },
}

beforeEach(() => {
  resetShopperCurrencyCache()
  window.localStorage.clear()
  window.sessionStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/commerce/currency')) return { ok: true, json: async () => ANSWER }
    if (url === '/api/consent/region') return { ok: true, json: async () => ({ country: 'NZ' }) }
    if (String(url).startsWith('/api/commerce/checkout')) {
      return { ok: false, status: 400, json: async () => ({ error: 'stop here' }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  ;(global as any).fetch = fetchMock
  mockSite.pageData = {
    commerce: {
      product: {
        id: 'p1',
        name: 'Candle Gift Set',
        slug: 'candle-gift-set',
        type: 'physical',
        mediaUrls: [],
        options: [],
        variants: [{ id: 'v1', priceUsd: 25, compareAtPriceUsd: 40, soldOut: false }],
        modifierGroups: [
          {
            id: 'extras',
            name: 'Extras',
            min: 0,
            max: 1,
            online: true,
            options: [
              { id: 'wrap', name: 'Gift wrap', priceCents: 500, fixedPriceCents: { NZD: 900 } },
              { id: 'card', name: 'Card', priceCents: 300 },
            ],
          },
        ],
      },
    },
  }
})

describe('the product page in NZD', () => {
  it('prints the price, compare-at and add-ons in the shopper currency', async () => {
    render(<ProductDetail />)
    // The cached page's first paint is the store currency.
    expect(screen.getAllByText('$25.00').length).toBeGreaterThan(0)
    // 25 × 1.714… = 42.86, rounded up to a whole NZ$43; 40 → NZ$69.
    await waitFor(() => expect(screen.getAllByText('NZ$43.00').length).toBeGreaterThan(0))
    expect(screen.getByText('NZ$69.00')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('combobox'))
    // The fixed NZ$9.00, and a $3 card converted unrounded: NZ$5.15.
    expect(screen.getByText('Gift wrap (+NZ$9.00)')).toBeTruthy()
    expect(screen.getByText('Card (+NZ$5.15)')).toBeTruthy()
  })

  it('asks buy-now to charge in NZD', async () => {
    render(<ProductDetail />)
    await waitFor(() => expect(screen.getAllByText('NZ$43.00').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Buy now' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/commerce/checkout'))).toBe(true),
    )
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).startsWith('/api/commerce/checkout'))
    expect(JSON.parse(init.body).currency).toBe('NZD')
  })
})
