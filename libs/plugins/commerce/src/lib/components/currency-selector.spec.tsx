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
 * The Currency selector (AGL-4248): hidden on a store selling in one
 * currency, otherwise a compact list of the store's currencies that switches
 * the shopper's and remembers it.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CurrencySelector, { currencyOptionLabel } from './currency-selector'
import { resetShopperCurrencyCache, shopperCurrencyStorageKey } from './shopper-currency'

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
}))

function mockAnswer(currencies: string[]) {
  const fetchMock = jest.fn(async (url: string) => {
    if (url.startsWith('/api/commerce/currency')) {
      return {
        ok: true,
        json: async () => ({
          base: 'USD',
          currencies: currencies.map((code) => ({ code, rounding: 'none' })),
          autoDetect: true,
          rates:
            currencies.length > 1
              ? { base: 'EUR', asOfMs: Date.now(), rates: { USD: 1.05, NZD: 1.8 } }
              : null,
        }),
      }
    }
    return { ok: true, json: async () => ({ country: 'US' }) }
  })
  ;(global as any).fetch = fetchMock
  return fetchMock
}

beforeEach(() => {
  resetShopperCurrencyCache()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('the currency selector', () => {
  it('names each currency by code, sign and name', () => {
    expect(currencyOptionLabel('NZD')).toBe('NZD $ · New Zealand dollar')
    expect(currencyOptionLabel('EUR', false)).toBe('EUR €')
  })

  it('renders nothing on a store that sells in one currency', async () => {
    const fetchMock = mockAnswer(['USD'])
    const { container } = render(<CurrencySelector />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('lists the store’s currencies and switches the shopper’s', async () => {
    mockAnswer(['USD', 'NZD'])
    render(<CurrencySelector />)
    const select = await screen.findByRole('combobox')
    expect(select.textContent).toBe('USD $ · US dollar')
    fireEvent.mouseDown(select)
    fireEvent.click(within(screen.getByRole('listbox')).getByText('NZD $ · New Zealand dollar'))
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toBe('NZD $ · New Zealand dollar'))
    expect(window.localStorage.getItem(shopperCurrencyStorageKey('host-1'))).toBe('NZD')
  })
})
