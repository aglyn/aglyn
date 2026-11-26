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
 * The shopper's currency (AGL-4248), the Shopify Markets way: their
 * country's currency where the store sells in it, their own saved choice
 * over that, and the store currency whenever anything is missing. One store
 * answer per page, however many blocks ask.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import { resetShopperCurrencyCache, shopperCurrencyStorageKey, useShopperCurrency } from './shopper-currency'

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
}))

const ANSWER = {
  base: 'USD',
  currencies: [
    { code: 'USD', rounding: 'none' },
    { code: 'NZD', rounding: 'whole' },
    { code: 'AUD', rounding: '99' },
  ],
  autoDetect: true,
  // Per 1 EUR: 1 USD = 1.80 / 1.05 NZD, 1.62 / 1.05 AUD.
  rates: { base: 'EUR', asOfMs: Date.now(), rates: { USD: 1.05, NZD: 1.8, AUD: 1.62 } },
}

function mockDoors(options: { answer?: unknown; country?: string | null; currencyFails?: boolean }) {
  const fetchMock = jest.fn(async (url: string) => {
    if (url.startsWith('/api/commerce/currency')) {
      if (options.currencyFails) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => options.answer ?? ANSWER }
    }
    if (url === '/api/consent/region') {
      return { ok: true, json: async () => ({ country: options.country ?? null }) }
    }
    throw new Error(`unexpected ${url}`)
  })
  ;(global as any).fetch = fetchMock
  return fetchMock
}

function Price(props: { label?: string }) {
  const shopper = useShopperCurrency()
  return (
    <div>
      <span data-testid={`code${props.label ?? ''}`}>{shopper.ready ? shopper.code : 'pending'}</span>
      <span data-testid={`price${props.label ?? ''}`}>{shopper.formatVariant({ priceUsd: 59 })}</span>
      <button onClick={() => shopper.setCurrency('AUD')}>{'AUD'}</button>
    </div>
  )
}

beforeEach(() => {
  resetShopperCurrencyCache()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('the shopper currency', () => {
  it('prints the store currency until the store answers, then the visitor country’s', async () => {
    mockDoors({ country: 'NZ' })
    render(<Price />)
    expect(screen.getByTestId('price').textContent).toBe('$59.00')
    await waitFor(() => expect(screen.getByTestId('code').textContent).toBe('NZD'))
    // 59 × 1.714… = 101.14, rounded up to a whole NZ$102; US$ is disambiguated nowhere here.
    expect(screen.getByTestId('price').textContent).toBe('NZ$102.00')
  })

  it('keeps a saved choice over the country, and remembers a switch', async () => {
    window.localStorage.setItem(shopperCurrencyStorageKey('host-1'), 'USD')
    mockDoors({ country: 'NZ' })
    render(<Price />)
    await waitFor(() => expect(screen.getByTestId('code').textContent).toBe('USD'))
    // Dollars the store sells in collide, so its own say which they are.
    expect(screen.getByTestId('price').textContent).toBe('US$59.00')
    act(() => screen.getByText('AUD').click())
    expect(screen.getByTestId('code').textContent).toBe('AUD')
    expect(window.localStorage.getItem(shopperCurrencyStorageKey('host-1'))).toBe('AUD')
    // 59 × 1.542… = 91.03, up to the next .99: A$91.99.
    expect(screen.getByTestId('price').textContent).toBe('A$91.99')
  })

  it('falls back to the store currency when the store’s door fails', async () => {
    const fetchMock = mockDoors({ currencyFails: true, country: 'NZ' })
    render(<Price />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => undefined)
    expect(screen.getByTestId('code').textContent).toBe('pending')
    expect(screen.getByTestId('price').textContent).toBe('$59.00')
    // No country is asked of a store that cannot say what it sells in.
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/consent/region')
  })

  it('sells in the store currency where the visitor’s country is not one the store sells in', async () => {
    mockDoors({ country: 'JP' })
    render(<Price />)
    await waitFor(() => expect(screen.getByTestId('code').textContent).toBe('USD'))
    expect(screen.getByTestId('price').textContent).toBe('US$59.00')
  })

  it('asks the store once however many blocks price, and never the country for one currency', async () => {
    const fetchMock = mockDoors({
      answer: { base: 'USD', currencies: [{ code: 'USD', rounding: 'none' }], autoDetect: true, rates: null },
    })
    render(
      <>
        <Price label="a" />
        <Price label="b" />
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('codea').textContent).toBe('USD'))
    expect(screen.getByTestId('priceb').textContent).toBe('$59.00')
    const urls = fetchMock.mock.calls.map(([url]) => url)
    expect(urls.filter((url) => url.startsWith('/api/commerce/currency'))).toHaveLength(1)
    expect(urls).not.toContain('/api/consent/region')
  })
})
