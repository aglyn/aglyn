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

import { fireEvent, render, screen } from '@testing-library/react'
import { taxServiceUse, type StoreTaxSettingsView, type TaxEngineConnectionView } from '../model/tax-engines'
import { STORE_TAXES_CARD_ELEMENT_ID, TaxEngineCard } from './tax-engine-card.component'

/**
 * The Tax service card under each Taxes setting (AGL-3693). Checkout and the
 * register ask the connected service only while Taxes is on Manual rates with
 * prices that exclude tax (commerce's `storeTaxAllowsEngine`), and only orders
 * it priced are recorded there. On any other setting the card says the
 * service is not used and never that it is calculating tax.
 */

let connection: TaxEngineConnectionView | null
let storeTax: StoreTaxSettingsView | null | undefined
const request = jest.fn()

jest.mock('./tax-engines-api', () => ({
  useTaxEnginesFetch: () => request,
  useTaxEngineConnection: () => ({
    loading: false,
    available: true,
    providers: [
      { id: 'avalara', label: 'Avalara AvaTax' },
      { id: 'taxjar', label: 'TaxJar' },
    ],
    connection,
    refresh: jest.fn(),
    replace: jest.fn(),
  }),
  useStoreTaxSettings: () => storeTax,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

const CONNECTION: TaxEngineConnectionView = {
  provider: 'avalara',
  providerLabel: 'Avalara AvaTax',
  environment: 'production',
  accountId: '1100',
  companyCode: 'DEFAULT',
  shipFrom: { line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
  shipFromValidated: true,
  defaultTaxCode: null,
  recordTransactions: true,
  lastTestOk: true,
  lastTestAtMs: 1,
  lastError: null,
  updatedAtMs: 1,
}

const CALCULATING = /ask Avalara AvaTax for the tax on every sale/

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue({ exemptions: [] })
  connection = CONNECTION
  storeTax = { mode: 'manual' }
})

describe('taxServiceUse', () => {
  it('uses the service only on Manual rates with prices that exclude tax', () => {
    expect(taxServiceUse({ mode: 'manual' })).toEqual({ applies: true })
    expect(taxServiceUse({ mode: 'manual', pricesIncludeTax: true })).toEqual({
      applies: false,
      reason: 'prices-include-tax',
    })
    expect(taxServiceUse({ mode: 'stripe' })).toEqual({ applies: false, reason: 'stripe' })
    expect(taxServiceUse({ mode: 'none' })).toEqual({ applies: false, reason: 'none' })
    expect(taxServiceUse(null)).toEqual({ applies: false, reason: 'undecided' })
    expect(taxServiceUse({})).toEqual({ applies: false, reason: 'undecided' })
  })
})

describe('the connected Tax service card', () => {
  it('on Manual rates, says checkout asks the service and falls back to the store’s rates', () => {
    render(<TaxEngineCard hostId="host-1" />)
    expect(screen.getByText(CALCULATING)).toBeTruthy()
    expect(screen.queryByText(/Applies only when Taxes is set to Manual rates/)).toBeNull()
  })

  it('under Stripe Tax, says the service is not used and never that it calculates tax', () => {
    storeTax = { mode: 'stripe' }
    render(<TaxEngineCard hostId="host-1" />)
    expect(
      screen.getByText(
        'Applies only when Taxes is set to Manual rates. Your store uses automatic tax (Stripe Tax) ' +
          'now, so Avalara AvaTax is not asked for the tax on any sale and new orders are not recorded there.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(CALCULATING)).toBeNull()
    expect(screen.queryByText(/does not answer within 5 seconds/)).toBeNull()
  })

  it('says so when prices include tax, when the store collects none, and before it decides', () => {
    storeTax = { mode: 'manual', pricesIncludeTax: true }
    const { unmount } = render(<TaxEngineCard hostId="host-1" />)
    expect(screen.getByText(/Your store’s prices include tax now, so Avalara AvaTax is not asked/)).toBeTruthy()
    expect(screen.queryByText(CALCULATING)).toBeNull()
    unmount()

    storeTax = { mode: 'none' }
    const second = render(<TaxEngineCard hostId="host-1" />)
    expect(screen.getByText(/set not to collect sales tax now/)).toBeTruthy()
    second.unmount()

    storeTax = null
    render(<TaxEngineCard hostId="host-1" />)
    expect(screen.getByText(/has not chosen how it handles sales tax yet/)).toBeTruthy()
    expect(screen.queryByText(CALCULATING)).toBeNull()
  })

  it('claims nothing about the setting until it is read', () => {
    storeTax = undefined
    render(<TaxEngineCard hostId="host-1" />)
    expect(screen.queryByText(CALCULATING)).toBeNull()
    expect(screen.queryByText(/Applies only when Taxes/)).toBeNull()
  })

  it('takes the merchant to the Taxes setting', () => {
    storeTax = { mode: 'stripe' }
    const taxes = document.createElement('div')
    taxes.id = STORE_TAXES_CARD_ELEMENT_ID
    taxes.scrollIntoView = jest.fn()
    document.body.appendChild(taxes)
    try {
      render(<TaxEngineCard hostId="host-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Go to Taxes' }))
      expect(taxes.scrollIntoView).toHaveBeenCalled()
    } finally {
      taxes.remove()
    }
  })
})

describe('the Tax service card before a connection', () => {
  it('under Stripe Tax, says a connected service would not be used', () => {
    connection = null
    storeTax = { mode: 'stripe' }
    render(<TaxEngineCard hostId="host-1" />)
    expect(screen.getByText(/Your store uses automatic tax \(Stripe Tax\) now, so a connected service is not asked/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go to Taxes' })).toBeTruthy()
  })
})
