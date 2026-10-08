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
import { DEFAULT_SETTINGS, EMPTY_LISTING_SUMMARY, type MarketplaceConnectionView, type MarketplaceOrderView } from '../model/marketplaces'
import type { MarketplacesApi } from './marketplaces-api'
import { MarketplacesCard } from './marketplaces-card.component'
import { OrderMarketplaceWidget } from './order-marketplace-widget.component'

jest.mock('./marketplaces-api', () => ({ useMarketplacesApi: () => null }))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const connection = (overrides: Partial<MarketplaceConnectionView> = {}): MarketplaceConnectionView => ({
  id: 'h_ebay',
  marketplace: 'ebay',
  hostId: 'h',
  status: 'active',
  sandbox: false,
  accountName: 'pat-sells',
  settings: { ...DEFAULT_SETTINGS },
  sites: [],
  listings: { ...EMPTY_LISTING_SUMMARY, syncedAtMs: 1, offers: 12, updated: 3, unchanged: 8, notListed: 1 },
  orders: { imported: 4, skipped: 0, lastImportedAtMs: 1 },
  shipments: { confirmed: 3, failed: 0 },
  lastError: null,
  connectedAtMs: 1,
  ...overrides,
})

const orderView = (overrides: Partial<MarketplaceOrderView> = {}): MarketplaceOrderView => ({
  marketplace: 'etsy',
  externalOrderId: '3311',
  displayRef: '3311',
  sandbox: false,
  fees: [{ label: 'Transaction fee', amountMinor: 130 }],
  feesTotalMinor: 130,
  currency: 'USD',
  shipments: [],
  ...overrides,
})

function api(overrides: Partial<MarketplacesApi> = {}): MarketplacesApi {
  return {
    list: jest.fn(async () => ({ offered: [], connections: [] })),
    connect: jest.fn(async () => 'https://auth.test'),
    update: jest.fn(async (_marketplace, settings) => connection({ settings: { ...DEFAULT_SETTINGS, ...settings } })),
    disconnect: jest.fn(async () => undefined),
    syncNow: jest.fn(async () => connection()),
    activity: jest.fn(async () => ({ entries: [], problems: [] })),
    order: jest.fn(async () => null),
    retry: jest.fn(async () => orderView()),
    ...overrides,
  }
}

beforeEach(() => {
  mockSnack.mockReset()
  mockConfirm.mockReset()
  mockConfirm.mockImplementation(async () => undefined)
})

describe('MarketplacesCard (AGL-3638)', () => {
  it('draws nothing where the deployment offers no marketplace', async () => {
    const routes = api()
    const { container } = render(<MarketplacesCard hostId="h" api={routes} />)
    await waitFor(() => expect(routes.list).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('offers to connect each marketplace the deployment offers, in the card header', async () => {
    const routes = api({ list: jest.fn(async () => ({ offered: [{ id: 'etsy' as const, sandbox: false }], connections: [] })) })
    render(<MarketplacesCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Etsy' }))
    await waitFor(() => expect(routes.connect).toHaveBeenCalledWith('etsy', `${window.location.pathname}${window.location.search}`))
  })

  it('shows a connection’s counts and saves its settings', async () => {
    const routes = api({ list: jest.fn(async () => ({ offered: [{ id: 'ebay' as const, sandbox: false }], connections: [connection()] })) })
    render(<MarketplacesCard hostId="h" api={routes} />)
    expect(await screen.findByText(/4 orders imported/)).toBeTruthy()
    expect(screen.getByText(/12 products checked/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Send prices too'))
    await waitFor(() => expect(routes.update).toHaveBeenCalledWith('ebay', { syncPrices: true }))
    expect(await screen.findByLabelText('Price adjustment (%)')).toBeTruthy()
  })

  it('offers no price sync for Faire, whose prices are wholesale', async () => {
    const routes = api({
      list: jest.fn(async () => ({
        offered: [{ id: 'faire' as const, sandbox: false }],
        connections: [connection({ id: 'h_faire', marketplace: 'faire' })],
      })),
    })
    render(<MarketplacesCard hostId="h" api={routes} />)
    expect(await screen.findByText(/Faire prices are wholesale/)).toBeTruthy()
    expect(screen.queryByLabelText('Send prices too')).toBeNull()
  })

  it('lists the listings to look at and the activity', async () => {
    const routes = api({
      list: jest.fn(async () => ({ offered: [{ id: 'ebay' as const, sandbox: false }], connections: [connection()] })),
      activity: jest.fn(async () => ({
        entries: [{ id: 'l1', atMs: 1, kind: 'order_imported' as const, message: 'eBay order 12-3 is order #1042' }],
        problems: [{ offerId: 'a', sku: 'TEE', title: 'Tee', outcome: 'failed' as const, message: 'Needs a brand', atMs: 1 }],
      })),
    })
    render(<MarketplacesCard hostId="h" api={routes} />)
    expect(await screen.findByText('eBay order 12-3 is order #1042')).toBeTruthy()
    expect(screen.getByText('eBay listings to look at')).toBeTruthy()
    expect(screen.getByText('SKU TEE: Needs a brand')).toBeTruthy()
  })

  it('disconnects only after the merchant confirms', async () => {
    const routes = api({ list: jest.fn(async () => ({ offered: [{ id: 'ebay' as const, sandbox: false }], connections: [connection()] })) })
    render(<MarketplacesCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(routes.disconnect).toHaveBeenCalledWith('ebay'))
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disconnect eBay?' }))
  })
})

describe('OrderMarketplaceWidget (AGL-3638)', () => {
  const order = { id: 'rec-1', number: '#1042', status: 'paid' }

  it('draws nothing for an order no marketplace sold', async () => {
    const routes = api()
    const { container } = render(<OrderMarketplaceWidget hostId="h" order={order} api={routes} />)
    await waitFor(() => expect(routes.order).toHaveBeenCalledWith('rec-1'))
    expect(container.innerHTML).toBe('')
  })

  it('names the marketplace, its order and its recorded fees, and sends refused tracking again', async () => {
    const routes = api({
      order: jest.fn(async () =>
        orderView({
          shipments: [{ fulfillmentId: 'f1', trackingNumber: '9400', carrier: 'USPS', state: 'failed' as const, message: 'Refused', atMs: 1 }],
        }),
      ),
    })
    render(<OrderMarketplaceWidget hostId="h" order={order} api={routes} />)
    expect(await screen.findByText('Sold on Etsy')).toBeTruthy()
    expect(screen.getByText(/Etsy's fees: \$1\.30/)).toBeTruthy()
    expect(screen.getByText('Not confirmed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send tracking again' }))
    await waitFor(() => expect(routes.retry).toHaveBeenCalledWith('rec-1'))
  })
})
