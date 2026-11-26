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
 * The Currencies card (AGL-4248): a merchant turns on selling in other
 * currencies, adds one, picks its rounding, sees what a price becomes at
 * today's rate, and saves it to `settings/store.currencies` behind the same
 * seed guard as Store settings.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setSeedConfirmWaitMs } from '@aglyn/tenant-feature-instance/hooks/helpers/listen-confirmation'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import CurrenciesCard from './currencies-card.component'

const listener = { fromCache: false, status: 'success' as 'success' | 'error' }
let storeDoc: Record<string, unknown> = { currency: 'USD' }

/** ECB-shaped: per 1 EUR, so 1 USD = 1.7041 NZD. */
const setupAnswer = {
  base: 'USD',
  settings: null,
  allRates: {
    base: 'EUR',
    rates: { USD: 1.05, NZD: 1.05 * 1.7041, GBP: 0.84 },
    asOfMs: Date.parse('2026-11-25T16:00:00Z'),
  },
}

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(async () => ({ ok: true, json: async () => setupAnswer })),
}))

jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/site-wide-change-double')
    .siteWideChangeThroughSdk(() => jest.requireMock('firebase/firestore')),
)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: storeDoc, status: listener.status, fromCache: listener.fromCache }),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: async () => 'token' } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

beforeAll(() => setSeedConfirmWaitMs(0))
afterAll(() => setSeedConfirmWaitMs())
beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
  storeDoc = { currency: 'USD' }
})

function pick(combobox: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: combobox }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

const saveButton = () => screen.getByRole('button', { name: 'Save currencies' }) as HTMLButtonElement

describe('CurrenciesCard (AGL-4248)', () => {
  it('turns on other currencies, adds NZD, previews a price, and saves its rounding', async () => {
    render(<CurrenciesCard hostId="host-1" />)
    expect(saveButton().disabled).toBe(true)
    // Off, nothing but the switch.
    expect(screen.queryByRole('combobox', { name: 'Add a currency' })).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: 'Sell in other currencies' }))
    // The store's own currency is never offered.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Add a currency' }))
    expect(within(screen.getByRole('listbox')).queryByRole('option', { name: /^USD/ })).toBeNull()
    fireEvent.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: 'NZD · New Zealand dollar' }),
    )
    expect(screen.getByText('NZD · New Zealand dollar')).toBeTruthy()

    // As on Shopify: the daily rate, no rounding until it is turned on.
    // 250 × 1.7041 = 426.025, up to the cent.
    await waitFor(() =>
      expect(screen.getByTestId('currency-preview-NZD').textContent).toBe(
        '$250.00 → NZ$426.03 (rate 1.7041, as of Nov 25)',
      ),
    )
    expect(screen.getByTestId('currency-rates-updated').textContent).toMatch(/^Rates updated Nov 25/)
    expect(screen.getByTestId('currency-rate-NZD').textContent).toBe('Daily rate 1.7041, updated Nov 25')
    expect(screen.queryByRole('combobox', { name: 'Round up to (NZD)' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Round converted prices (NZD)' }))
    pick('Round up to (NZD)', 'Ends in .95 (28.95)')
    expect(screen.getByTestId('currency-preview-NZD').textContent).toBe(
      '$250.00 → NZ$426.95 (rate 1.7041, as of Nov 25)',
    )
    fireEvent.blur(screen.getByRole('textbox', { name: 'Price adjustment (%) (NZD)' }), {
      target: { value: '150' },
    })

    fireEvent.click(saveButton())
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload, options] = (setDoc as jest.Mock).mock.calls[0]
    expect(options).toEqual({ merge: true })
    expect(payload).toEqual({
      currencies: {
        enabled: true,
        // An adjustment past +100% is held to 100.
        currencies: [{ code: 'NZD', rounding: '95', bufferPct: 100, pricesIncludeTax: false }],
        autoDetect: true,
      },
    })
  })

  it('converts at a manual rate when one is set, and drops it when cleared', async () => {
    storeDoc = { currency: 'USD', currencies: { enabled: true, currencies: [{ code: 'NZD', rounding: 'none' }] } }
    render(<CurrenciesCard hostId="host-1" />)
    const manual = screen.getByRole('textbox', { name: 'Manual exchange rate (NZD)' })
    fireEvent.blur(manual, { target: { value: '2' } })
    expect(screen.getByTestId('currency-preview-NZD').textContent).toBe(
      '$250.00 → NZ$500.00 (manual rate 2.0000)',
    )
    expect(screen.getByTestId('currency-rate-NZD').textContent).toBe('Manual rate 2.0000')
    fireEvent.click(saveButton())
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect((setDoc as jest.Mock).mock.calls[0][1].currencies.currencies[0].manualRate).toBe(2)

    fireEvent.blur(manual, { target: { value: '' } })
    await waitFor(() =>
      expect(screen.getByTestId('currency-rate-NZD').textContent).toBe('Daily rate 1.7041, updated Nov 25'),
    )
  })

  it('keeps what is stored, and saves auto-detect off and tax-inclusive prices', async () => {
    storeDoc = {
      currency: 'USD',
      currencies: { enabled: true, currencies: [{ code: 'GBP', rounding: '99', bufferPct: 2 }] },
    }
    render(<CurrenciesCard hostId="host-1" />)
    expect(screen.getByText('GBP · British pound')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Prices in GBP include tax' }))
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Show each shopper prices in their own currency, picked from where they are browsing',
      }),
    )
    fireEvent.click(saveButton())
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.currencies).toEqual({
      enabled: true,
      currencies: [{ code: 'GBP', rounding: '99', bufferPct: 2, pricesIncludeTax: true }],
      autoDetect: false,
    })
  })

  it('refuses a save from a settings read that failed', async () => {
    listener.status = 'error'
    render(<CurrenciesCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('switch', { name: 'Sell in other currencies' }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
  })
})
