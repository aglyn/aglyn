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
import type { NetworkConnectionView, NetworkOrderView } from '../model/networks'
import type { FulfillmentNetworksApi } from './fulfillment-networks-api'
import { FulfillmentNetworksCard } from './fulfillment-networks-card.component'
import { OrderNetworksWidget } from './order-networks-widget.component'

jest.mock('./fulfillment-networks-api', () => ({ useFulfillmentNetworksApi: () => null }))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const connection = (overrides: Partial<NetworkConnectionView> = {}): NetworkConnectionView => ({
  id: 'h_shipbob',
  provider: 'shipbob',
  hostId: 'h',
  status: 'active',
  sandbox: false,
  accountName: 'Aglyn channel',
  routing: 'automatic',
  shippingMethod: 'Standard',
  shippingSpeed: 'Standard',
  marketplaceId: null,
  marketplaces: [],
  storeId: null,
  webhookSecretSet: false,
  syncInventory: false,
  inventory: { syncedAtMs: 1, skus: 12, updated: 0, unchanged: 0, unknown: 0, untracked: 0, perLocation: 0 },
  lastError: null,
  connectedAtMs: 1,
  totals: { sent: 4, shipped: 3, canceled: 0 },
  ...overrides,
})

const routing = (overrides: Partial<NetworkOrderView> = {}): NetworkOrderView => ({
  provider: 'shipbob',
  status: 'accepted',
  reference: 'agabc',
  lines: [{ lineIndex: 0, sku: 'TEE-S', name: 'Tee — S', quantity: 2, shippedQuantity: 0 }],
  shipments: [],
  note: null,
  cancelRequested: false,
  updatedAtMs: 1,
  ...overrides,
})

function api(overrides: Partial<FulfillmentNetworksApi> = {}): FulfillmentNetworksApi {
  return {
    list: jest.fn(async () => ({ offered: [], connections: [] })),
    connect: jest.fn(async () => 'https://auth.test'),
    connectKey: jest.fn(async () => ({ connection: null, webhook: null })),
    rotateWebhookSecret: jest.fn(async () => ({ url: 'https://c/hook', secret: 'whsec-new' })),
    update: jest.fn(async (_provider, settings) => connection(settings as never)),
    disconnect: jest.fn(async () => undefined),
    syncNow: jest.fn(async () => connection()),
    log: jest.fn(async () => ({ entries: [] })),
    order: jest.fn(async () => ({ connections: [], routings: [] })),
    send: jest.fn(async () => ({ connections: [], routings: [] })),
    cancel: jest.fn(async () => ({ connections: [], routings: [] })),
    ...overrides,
  }
}

beforeEach(() => {
  mockSnack.mockClear()
  mockConfirm.mockClear()
})

describe('the fulfillment networks card (AGL-3634)', () => {
  it('draws nothing where the deployment offers no network', async () => {
    const routes = api()
    const { container } = render(<FulfillmentNetworksCard hostId="h" api={routes} />)
    await waitFor(() => expect(routes.list).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('offers each network the deployment has, with Connect in the card header', async () => {
    const routes = api({ list: jest.fn(async () => ({ offered: [{ id: 'shipbob' as const, sandbox: false }, { id: 'amazon-mcf' as const, sandbox: true }], connections: [] })) })
    render(<FulfillmentNetworksCard hostId="h" api={routes} />)
    expect(await screen.findByText('ShipBob')).toBeTruthy()
    expect(screen.getByText('Amazon Multi-Channel Fulfillment')).toBeTruthy()
    expect(screen.getByText(/takes test orders only/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect ShipBob' }))
    await waitFor(() => expect(routes.connect).toHaveBeenCalledWith('shipbob', expect.any(String)))
  })

  it('shows a connection’s state and saves its settings', async () => {
    const routes = api({ list: jest.fn(async () => ({ offered: [{ id: 'shipbob' as const, sandbox: false }], connections: [connection()] })) })
    render(<FulfillmentNetworksCard hostId="h" api={routes} />)
    expect(await screen.findByText('Sending orders')).toBeTruthy()
    expect(screen.getByText(/4 orders sent · 3 parcels shipped/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Keep stock counts in step with ShipBob/))
    await waitFor(() => expect(routes.update).toHaveBeenCalledWith('shipbob', { syncInventory: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(routes.update).toHaveBeenCalledWith('shipbob', { paused: true }))
  })

  it('asks before disconnecting', async () => {
    const routes = api({ list: jest.fn(async () => ({ offered: [{ id: 'shipbob' as const, sandbox: false }], connections: [connection()] })) })
    render(<FulfillmentNetworksCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(routes.disconnect).toHaveBeenCalledWith('shipbob'))
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disconnect ShipBob?' }))
  })

  it('connects ShipMonk with the merchant’s own key and store id, then shows the webhook setup once (AGL-3697)', async () => {
    const shipmonk = connection({ id: 'h_shipmonk', provider: 'shipmonk', accountName: 'Store 11364', storeId: '11364', webhookSecretSet: true })
    const routes = api({
      list: jest.fn(async () => ({ offered: [{ id: 'shipmonk' as const, sandbox: false }], connections: [] })),
      connectKey: jest.fn(async () => ({ connection: shipmonk, webhook: { url: 'https://c/api/fulfillment-networks/webhooks/shipmonk?connection=h_shipmonk', secret: 'whsec-1' } })),
    })
    render(<FulfillmentNetworksCard hostId="h" api={routes} />)
    expect(await screen.findByText(/API key of your own ShipMonk API store/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect ShipMonk' }))
    expect(routes.connect).not.toHaveBeenCalled()
    const submit = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sm-live-key-1234' } })
    fireEvent.change(screen.getByLabelText('Store id'), { target: { value: '11364' } })
    fireEvent.click(submit)
    await waitFor(() => expect(routes.connectKey).toHaveBeenCalledWith('shipmonk', { apiKey: 'sm-live-key-1234', storeId: '11364' }))
    expect(await screen.findByDisplayValue('whsec-1')).toBeTruthy()
    expect(screen.getByDisplayValue(/webhooks\/shipmonk\?connection=h_shipmonk/)).toBeTruthy()
    expect(screen.getByLabelText('Shipping service')).toBeTruthy()
    expect(screen.queryByDisplayValue('sm-live-key-1234')).toBeNull()
  })

  it('makes a new ShipMonk webhook secret only after asking (AGL-3697)', async () => {
    const shipmonk = connection({ id: 'h_shipmonk', provider: 'shipmonk', storeId: '11364', webhookSecretSet: true })
    const routes = api({ list: jest.fn(async () => ({ offered: [{ id: 'shipmonk' as const, sandbox: false }], connections: [shipmonk] })) })
    render(<FulfillmentNetworksCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New webhook secret' }))
    await waitFor(() => expect(routes.rotateWebhookSecret).toHaveBeenCalledWith('shipmonk'))
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'New ShipMonk webhook secret?' }))
    expect(await screen.findByDisplayValue('whsec-new')).toBeTruthy()
  })

  it('asks to connect again when the grant was refused', async () => {
    const routes = api({
      list: jest.fn(async () => ({
        offered: [{ id: 'shipbob' as const, sandbox: false }],
        connections: [connection({ status: 'reconnect', lastError: 'ShipBob refused the connection. Connect again to keep orders moving.' })],
      })),
    })
    render(<FulfillmentNetworksCard hostId="h" api={routes} />)
    expect(await screen.findByText(/refused the connection/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
  })
})

const ORDER = {
  id: 'order-1',
  number: '#1042',
  status: 'paid',
  lines: [{ lineItemId: 0, name: 'Tee — S', remainingQuantity: 2, requiresShipping: true }],
}

describe('the order’s fulfillment networks (AGL-3634)', () => {
  it('draws nothing for a store with no network', async () => {
    const routes = api()
    const { container } = render(<OrderNetworksWidget hostId="h" order={ORDER} api={routes} />)
    await waitFor(() => expect(routes.order).toHaveBeenCalledWith('order-1'))
    expect(container.innerHTML).toBe('')
  })

  it('offers Send to a connected network for an unsent order', async () => {
    const routes = api({
      order: jest.fn(async () => ({ connections: [{ provider: 'shipbob' as const, status: 'active' as const, sandbox: false }], routings: [] })),
      send: jest.fn(async () => ({ connections: [], routings: [routing()] })),
    })
    render(<OrderNetworksWidget hostId="h" order={ORDER} api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send to ShipBob' }))
    await waitFor(() => expect(routes.send).toHaveBeenCalledWith('order-1', 'shipbob'))
    expect(await screen.findByText('With the network')).toBeTruthy()
  })

  it('shows what was sent, what shipped and why anything stayed, and cancels on confirm', async () => {
    const routes = api({
      order: jest.fn(async () => ({
        connections: [{ provider: 'shipbob' as const, status: 'active' as const, sandbox: false }],
        routings: [
          routing({
            status: 'partially_shipped',
            lines: [{ lineIndex: 0, sku: 'TEE-S', name: 'Tee — S', quantity: 2, shippedQuantity: 1 }],
            shipments: [{ id: 'p1', carrier: 'USPS', trackingNumber: '9400', trackingUrl: 'https://track.example/9400', trackingStatus: 'in_transit', atMs: 1 }],
            note: 'Kept for you to ship: Gift note (it has no SKU for ShipBob to match).',
          }),
        ],
      })),
    })
    render(<OrderNetworksWidget hostId="h" order={ORDER} api={routes} />)
    expect(await screen.findByText('Partly shipped')).toBeTruthy()
    expect(screen.getByText('2 × Tee — S (1 shipped)')).toBeTruthy()
    expect(screen.getByRole('link', { name: '9400' }).getAttribute('href')).toBe('https://track.example/9400')
    expect(screen.getByText(/Kept for you to ship/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to ShipBob' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel at ShipBob' }))
    await waitFor(() => expect(routes.cancel).toHaveBeenCalledWith('order-1', 'shipbob'))
  })
})
