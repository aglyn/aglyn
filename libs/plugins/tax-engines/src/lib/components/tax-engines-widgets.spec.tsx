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
import type { TaxEngineConnectionView, TaxEngineTransactionView } from '../model/tax-engines'
import { OrderTaxRecord } from './order-tax-record.component'
import { ProductTaxCodeField } from './product-tax-code-field.component'
import { TaxEngineCard } from './tax-engine-card.component'

/**
 * The console widgets the tax-engines plugin puts in commerce's zones
 * (AGL-3631). Each renders NOTHING until the server says the deployment and
 * the site can hold a connection — that is what keeps them invisible where
 * TAX_ENGINES_TOKEN_KEY is not set — and once it can, each shows what it says.
 */

let connectionState: {
  loading: boolean
  available: boolean
  providers: Array<{ id: string; label: string }>
  connection: TaxEngineConnectionView | null
}
const request = jest.fn()

jest.mock('./tax-engines-api', () => ({
  useTaxEnginesFetch: () => request,
  useTaxEngineConnection: () => ({ ...connectionState, refresh: jest.fn(), replace: jest.fn() }),
  // Taxes on Manual rates: the setting the service is used under (AGL-3693).
  useStoreTaxSettings: () => ({ mode: 'manual' }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

const CONNECTION: TaxEngineConnectionView = {
  provider: 'taxjar',
  providerLabel: 'TaxJar',
  environment: 'sandbox',
  accountId: null,
  companyCode: null,
  shipFrom: { line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
  shipFromValidated: true,
  defaultTaxCode: null,
  recordTransactions: true,
  lastTestOk: true,
  lastTestAtMs: 1,
  lastError: null,
  updatedAtMs: 1,
}

const RECORD: TaxEngineTransactionView = {
  orderId: 'order-1',
  provider: 'avalara',
  providerLabel: 'Avalara AvaTax',
  status: 'committed',
  code: 'order-1',
  taxCents: 412,
  refundedCents: 0,
  refunds: 0,
  fallbackReason: null,
  lastError: null,
  updatedAtMs: 1,
}

beforeEach(() => {
  request.mockReset()
  connectionState = { loading: false, available: false, providers: [], connection: null }
})

describe('the Tax service card', () => {
  it('draws nothing where the deployment cannot hold a connection', () => {
    const { container } = render(<TaxEngineCard hostId="host-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('offers to connect, and states who remains responsible for the tax', () => {
    connectionState = {
      ...connectionState,
      available: true,
      providers: [
        { id: 'avalara', label: 'Avalara AvaTax' },
        { id: 'taxjar', label: 'TaxJar' },
      ],
    }
    render(<TaxEngineCard hostId="host-1" />)
    expect(screen.getByLabelText('Account id')).toBeTruthy()
    expect(screen.getByLabelText('License key')).toBeTruthy()
    expect(screen.getAllByText(/You remain responsible for registering/).length).toBeGreaterThan(0)
  })

  it('shows a connection, the fallback it falls back to, and its exempt customers', async () => {
    connectionState = { ...connectionState, available: true, connection: CONNECTION }
    request.mockResolvedValue({ exemptions: [] })
    render(<TaxEngineCard hostId="host-1" />)
    expect(screen.getByText('Sandbox account')).toBeTruthy()
    expect(screen.getByText(/does not answer within 5 seconds/)).toBeTruthy()
    expect(screen.getByText('Confirmed')).toBeTruthy()
    expect(screen.getByText('Exempt customers')).toBeTruthy()
    await waitFor(() => expect(request).toHaveBeenCalled())
  })
})

describe('an order’s tax service record', () => {
  it('draws nothing for an order never sent to a service', async () => {
    request.mockResolvedValue({ transaction: null })
    const { container } = render(<OrderTaxRecord hostId="host-1" order={{ id: 'order-9' }} />)
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('says a sale fell back to the store’s own rates', async () => {
    request.mockResolvedValue({ transaction: { ...RECORD, fallbackReason: 'timeout' } })
    render(<OrderTaxRecord hostId="host-1" order={{ id: 'order-1', currency: 'usd' }} />)
    expect(await screen.findByText(/did not answer in time at checkout/)).toBeTruthy()
    expect(screen.getByText('Recorded')).toBeTruthy()
  })

  it('offers a retry for a refused record, and shows the service’s reason', async () => {
    request
      .mockResolvedValueOnce({ transaction: { ...RECORD, status: 'failed', lastError: 'Avalara: Address not found' } })
      .mockResolvedValueOnce({ transaction: { ...RECORD, status: 'committed' } })
    render(<OrderTaxRecord hostId="host-1" order={{ id: 'order-1' }} />)
    expect(await screen.findByText('Avalara: Address not found')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Record it again' }))
    expect(await screen.findByText('Recorded')).toBeTruthy()
    expect(request).toHaveBeenLastCalledWith('tax-engines/order-transaction/retry', {
      body: { hostId: 'host-1', orderId: 'order-1' },
    })
  })
})

describe('a product’s tax code', () => {
  it('draws nothing until a service is connected', () => {
    connectionState = { ...connectionState, available: true }
    const { container } = render(<ProductTaxCodeField hostId="host-1" product={{ id: 'prod-1' } as never} />)
    expect(container.innerHTML).toBe('')
  })
})
