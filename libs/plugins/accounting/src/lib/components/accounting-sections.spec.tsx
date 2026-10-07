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
import type { AccountingConnectionView, AccountingStatusResponse } from '../model/accounting.types'
import { EMPTY_ACCOUNTING_MAPPING } from '../model/accounting.types'
import { AccountingActivitySection } from './accounting-activity-section'
import { AccountingConnectionSection, connectLabel } from './accounting-connection-section'
import type { AccountingApi } from './use-accounting-api'

/**
 * The Accounting page's two sections (AGL-3614): what a deployment with no
 * ledger credentials shows (no card at all), the Connect buttons for exactly
 * the providers it has, finishing a connect the provider sent back, the
 * mapping form, and the Needs attention list with its Retry buttons. The
 * routes are stubbed through the sections' `api` prop.
 */

const mockUser = { data: { uid: 'uid-owner' } }
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => mockUser }))

function api(overrides: Partial<AccountingApi> = {}): AccountingApi {
  return {
    status: jest.fn(),
    connect: jest.fn(),
    completeConnect: jest.fn(),
    selectTenant: jest.fn(),
    options: jest.fn(async () => ({ accounts: [], taxCodes: [] })),
    saveSettings: jest.fn(),
    log: jest.fn(async () => ({ items: [], nextBefore: null })),
    retry: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  }
}

const status = (overrides: Partial<AccountingStatusResponse> = {}): AccountingStatusResponse => ({
  providers: { quickbooks: false, xero: false, codat: false },
  connection: null,
  counts: { pending: 0, synced: 0, needsAttention: 0 },
  seenTaxKeys: [],
  ...overrides,
})

const connection = (overrides: Partial<AccountingConnectionView> = {}): AccountingConnectionView => ({
  provider: 'quickbooks',
  status: 'connected',
  tenantId: '9130',
  tenantName: 'Sandbox Company',
  homeCurrency: 'USD',
  multiCurrency: false,
  environment: 'sandbox',
  connectedAtMs: Date.UTC(2026, 9, 6),
  connectedByEmail: 'owner@example.com',
  mapping: EMPTY_ACCOUNTING_MAPPING,
  missingRoles: ['income', 'clearing', 'feeExpense', 'payoutBank'],
  lastSyncAtMs: null,
  lastError: null,
  ...overrides,
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('the Connection section', () => {
  it('draws no connect card, only one sentence, on a deployment with no ledger credentials', async () => {
    render(<AccountingConnectionSection orgId="org-1" api={api({ status: jest.fn(async () => status()) })} />)
    expect(await screen.findByText('Connecting accounting software is not available yet.')).toBeTruthy()
    expect(screen.queryByText('Connect your books')).toBeNull()
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull()
  })

  it('offers a Connect button for exactly the providers configured, and sends the browser to consent', async () => {
    const navigate = jest.fn()
    const routes = api({
      status: jest.fn(async () => status({ providers: { quickbooks: true, xero: false, codat: false } })),
      connect: jest.fn(async () => ({ url: 'https://appcenter.intuit.com/connect/oauth2?x=1' })),
    })
    render(<AccountingConnectionSection orgId="org-1" api={routes} navigate={navigate} />)
    const button = await screen.findByRole('button', { name: connectLabel('quickbooks') })
    expect(screen.queryByRole('button', { name: connectLabel('xero') })).toBeNull()
    fireEvent.click(button)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://appcenter.intuit.com/connect/oauth2?x=1'))
    expect(routes.connect).toHaveBeenCalledWith('quickbooks')
  })

  it('offers other accounting software only once Codat is configured, and names connected books by company and software', async () => {
    const hidden = api({ status: jest.fn(async () => status({ providers: { quickbooks: true, xero: true, codat: false } })) })
    const { unmount } = render(<AccountingConnectionSection orgId="org-1" api={hidden} />)
    await screen.findByRole('button', { name: connectLabel('quickbooks') })
    expect(screen.queryByRole('button', { name: 'Connect other accounting software' })).toBeNull()
    unmount()

    const navigate = jest.fn()
    const offered = api({
      status: jest.fn(async () => status({ providers: { quickbooks: false, xero: false, codat: true } })),
      connect: jest.fn(async () => ({ url: 'https://link.codat.io/company/c-1?state=s' })),
    })
    const second = render(<AccountingConnectionSection orgId="org-1" api={offered} navigate={navigate} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect other accounting software' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://link.codat.io/company/c-1?state=s'))
    expect(offered.connect).toHaveBeenCalledWith('codat')
    second.unmount()

    const connected = api({
      status: jest.fn(async () =>
        status({
          providers: { quickbooks: false, xero: false, codat: true },
          connection: connection({ provider: 'codat', tenantName: 'Acme Inc (NetSuite)', environment: null, status: 'reconnect-required' }),
        }),
      ),
    })
    render(<AccountingConnectionSection orgId="org-1" api={connected} />)
    expect(await screen.findAllByText('Acme Inc (NetSuite)')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Reconnect your accounting software' })).toBeTruthy()
  })

  it('finishes a connect the provider sent back, once, and clears the code from the address', async () => {
    window.history.replaceState(null, '', '/acme/accounting/connection#accounting=code&code=c-1&state=as1.s&realmId=9130')
    const routes = api({
      status: jest.fn(async () => status({ providers: { quickbooks: true, xero: true, codat: false }, connection: connection() })),
      completeConnect: jest.fn(async () => ({ connection: connection() })),
    })
    render(<AccountingConnectionSection orgId="org-1" api={routes} />)
    expect(await screen.findByText(/Connected QuickBooks Online — Sandbox Company/)).toBeTruthy()
    expect(routes.completeConnect).toHaveBeenCalledTimes(1)
    expect(routes.completeConnect).toHaveBeenCalledWith({ code: 'c-1', state: 'as1.s', realmId: '9130' })
    expect(window.location.hash).toBe('')
  })

  it('says so when the provider was refused access', async () => {
    window.history.replaceState(null, '', '/acme/accounting/connection#accounting=error&reason=access_denied')
    render(<AccountingConnectionSection orgId="org-1" api={api({ status: jest.fn(async () => status({ providers: { quickbooks: true, xero: false, codat: false } })) })} />)
    expect(await screen.findByText('Access was not granted, so nothing was connected.')).toBeTruthy()
  })

  it('shows the mapping form for a connected ledger, with bank accounts only for clearing', async () => {
    const routes = api({
      status: jest.fn(async () => status({ providers: { quickbooks: true, xero: false, codat: false }, connection: connection() })),
      options: jest.fn(async () => ({
        accounts: [
          { id: '79', code: null, name: 'Sales', type: 'Income', classification: 'income' as const, currency: 'USD' },
          { id: '35', code: null, name: 'Stripe clearing', type: 'Bank', classification: 'bank' as const, currency: 'USD' },
        ],
        taxCodes: [{ id: 'TAX', name: 'Taxable', ratePercent: null }],
      })),
    })
    render(<AccountingConnectionSection orgId="org-1" api={routes} />)
    expect(await screen.findByText('Choose your accounts below. Nothing is posted until they are set.')).toBeTruthy()
    expect(await screen.findByLabelText('Stripe clearing account')).toBeTruthy()
    expect(screen.getByText('Sandbox company')).toBeTruthy()
    // The daily summary's tax account appears only in that mode.
    expect(screen.queryByLabelText('Sales tax liability')).toBeNull()
    fireEvent.click(screen.getByLabelText('One summary journal entry per day'))
    expect(await screen.findByLabelText('Sales tax liability')).toBeTruthy()
  })

  it('asks for a reconnect when the grant was refused', async () => {
    render(
      <AccountingConnectionSection
        orgId="org-1"
        api={api({
          status: jest.fn(async () =>
            status({
              providers: { quickbooks: true, xero: false, codat: false },
              connection: connection({ status: 'reconnect-required', lastError: 'invalid_grant' }),
            }),
          ),
        })}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Reconnect QuickBooks Online' })).toBeTruthy()
  })
})

describe('the Sync activity section', () => {
  it('lists what needs attention with its reason, and retries one', async () => {
    const routes = api({
      log: jest.fn(async () => ({
        items: [
          {
            id: 'sale_h_o',
            kind: 'sale' as const,
            label: 'Order #1042',
            externalId: 'K3XQ-1042',
            status: 'needs_attention' as const,
            attempts: 1,
            nextAttemptAtMs: null,
            lastError: 'Business Validation Error: Account is inactive',
            providerDocId: null,
            amountCents: 4930,
            currency: 'USD',
            occurredAtMs: Date.UTC(2026, 9, 6),
            updatedAtMs: Date.UTC(2026, 9, 6),
          },
        ],
        nextBefore: null,
      })),
      retry: jest.fn(async () => ({ retried: 1 })),
    })
    render(<AccountingActivitySection orgId="org-1" api={routes} />)
    expect(await screen.findByText('Business Validation Error: Account is inactive')).toBeTruthy()
    expect(screen.getByText('$49.30')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(routes.retry).toHaveBeenCalledWith({ itemId: 'sale_h_o' }))
    expect(await screen.findByText('1 item will be posted again on the next sync.')).toBeTruthy()
  })

  it('says when nothing needs attention', async () => {
    render(<AccountingActivitySection orgId="org-1" api={api()} />)
    expect(await screen.findByText('Nothing needs your attention.')).toBeTruthy()
  })
})
