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
import type { InventoryConnectionView, InventoryOrderView } from '../model/inventory-sync'
import type { InventorySyncApi } from './inventory-sync-api'
import { InventorySyncCard } from './inventory-sync-card.component'
import { OrderInventoryWidget } from './order-inventory-widget.component'

jest.mock('./inventory-sync-api', () => ({ useInventorySyncApi: () => null }))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const connection = (overrides: Partial<InventoryConnectionView> = {}): InventoryConnectionView => ({
  hostId: 'h',
  provider: 'cin7-core',
  status: 'active',
  accountName: 'Acme Goods',
  stockSource: 'system',
  productSync: 'off',
  sendOrders: true,
  locationId: null,
  orderCustomer: 'Web Sales',
  taxRule: '',
  stock: { syncedAtMs: 1, direction: 'system', skus: 12, updated: 3, unchanged: 9, unknown: 0, untracked: 0, perLocation: 0, failed: 0 },
  products: { syncedAtMs: null, created: 0, updated: 0, unchanged: 0, failed: 0, more: false },
  lastError: null,
  connectedAtMs: 1,
  totals: { ordersSent: 4, ordersFailed: 1 },
  ...overrides,
})

const handOff = (overrides: Partial<InventoryOrderView> = {}): InventoryOrderView => ({
  recordId: 'o-1',
  displayRef: '#7',
  provider: 'cin7-core',
  status: 'failed',
  reference: 'AG7-aaaaaaaa',
  externalNumber: null,
  lines: [{ lineIndex: 0, sku: 'TEE-M', name: 'Tee', quantity: 2, unitAmountCents: 1999 }],
  note: 'Cin7 Core has no product with the SKU TEE-M.',
  attempts: 1,
  updatedAtMs: 1,
  ...overrides,
})

function api(overrides: Partial<InventorySyncApi> = {}): InventorySyncApi {
  return {
    connection: jest.fn(async () => ({ offered: [], connection: null, capabilities: { importProducts: false } })),
    connectKeys: jest.fn(async () => ({ offered: [{ id: 'cin7-core' as const }], connection: connection(), capabilities: { importProducts: false } })),
    connectOAuth: jest.fn(async () => 'https://oauth.test/authorize/shop'),
    update: jest.fn(async (settings) => connection(settings as never)),
    disconnect: jest.fn(async () => undefined),
    locations: jest.fn(async () => [{ id: 'Main', name: 'Main Warehouse' }]),
    syncNow: jest.fn(async () => connection()),
    log: jest.fn(async () => ({ entries: [] })),
    failedOrders: jest.fn(async () => ({ orders: [] })),
    order: jest.fn(async () => ({ connection: null, order: null })),
    send: jest.fn(async () => ({ order: handOff({ status: 'sent', externalNumber: 'SO-9', note: null }) })),
    ...overrides,
  }
}

beforeEach(() => {
  mockSnack.mockReset()
})

describe('the Inventory and ERP card (AGL-3642)', () => {
  it('draws nothing where the deployment offers no system', async () => {
    const routes = api()
    const { container } = render(<InventorySyncCard hostId="h" api={routes} />)
    await waitFor(() => expect(routes.connection).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('connects Cin7 Core with the pasted keys, its button in the card header', async () => {
    const routes = api({
      connection: jest.fn(async () => ({ offered: [{ id: 'cin7-core' as const }, { id: 'inflow' as const }], connection: null, capabilities: { importProducts: false } })),
    })
    render(<InventorySyncCard hostId="h" api={routes} />)
    const button = await screen.findByRole('button', { name: 'Connect Cin7 Core' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getAllByLabelText('Account ID')[0], { target: { value: ' acct-1 ' } })
    fireEvent.change(screen.getAllByLabelText('Application key')[0], { target: { value: 'key-1' } })
    fireEvent.click(button)
    await waitFor(() => expect(routes.connectKeys).toHaveBeenCalledWith('cin7-core', { accountId: 'acct-1', apiKey: 'key-1' }))
    expect(await screen.findByText('Stock counts')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect inFlow Inventory' })).toBeNull()
  })

  it('shows a connection’s settings, counts and the orders that need the merchant', async () => {
    const routes = api({
      connection: jest.fn(async () => ({ offered: [{ id: 'cin7-core' as const }], connection: connection(), capabilities: { importProducts: false } })),
      failedOrders: jest.fn(async () => ({ orders: [handOff()] })),
    })
    render(<InventorySyncCard hostId="h" api={routes} />)
    expect(await screen.findByText(/12 SKUs at All locations/)).toBeTruthy()
    expect(screen.getByText(/3 store counts changed/)).toBeTruthy()
    expect(await screen.findByText('Cin7 Core has no product with the SKU TEE-M.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    await waitFor(() => expect(routes.send).toHaveBeenCalledWith('o-1'))
    await waitFor(() => expect(mockSnack).toHaveBeenCalledWith('#7 sent to Cin7 Core.', expect.anything()))
  })

  it('pauses from the header', async () => {
    const routes = api({
      connection: jest.fn(async () => ({ offered: [{ id: 'cin7-core' as const }], connection: connection(), capabilities: { importProducts: false } })),
    })
    render(<InventorySyncCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(routes.update).toHaveBeenCalledWith({ paused: true }))
  })

  it('disconnects only once confirmed', async () => {
    const routes = api({
      connection: jest
        .fn()
        .mockResolvedValueOnce({ offered: [{ id: 'cin7-core' }], connection: connection(), capabilities: { importProducts: false } })
        .mockResolvedValue({ offered: [{ id: 'cin7-core' }], connection: null, capabilities: { importProducts: false } }),
    })
    render(<InventorySyncCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    await waitFor(() => expect(routes.disconnect).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Connect Cin7 Core' })).toBeTruthy()
  })

  it('asks Brightpearl merchants for their account code and sends them to sign in', async () => {
    window.history.replaceState({}, '', '/acme/s/settings')
    const routes = api({
      connection: jest.fn(async () => ({ offered: [{ id: 'brightpearl' as const }], connection: null, capabilities: { importProducts: false } })),
    })
    render(<InventorySyncCard hostId="h" api={routes} />)
    fireEvent.change(await screen.findByLabelText('Account code'), { target: { value: 'shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect Brightpearl' }))
    await waitFor(() => expect(routes.connectOAuth).toHaveBeenCalledWith('shop', '/acme/s/settings'))
  })
})

describe('the inventory system on an order (AGL-3642)', () => {
  it('draws nothing for an order never queued', async () => {
    const routes = api()
    const { container } = render(<OrderInventoryWidget hostId="h" order={{ id: 'o-1' }} api={routes} />)
    await waitFor(() => expect(routes.order).toHaveBeenCalledWith('o-1'))
    expect(container.innerHTML).toBe('')
  })

  it('shows why an order was not sent, and sends it again', async () => {
    const routes = api({ order: jest.fn(async () => ({ connection: { provider: 'cin7-core' as const, status: 'active' as const }, order: handOff() })) })
    render(<OrderInventoryWidget hostId="h" order={{ id: 'o-1' }} api={routes} />)
    expect(await screen.findByText('Cin7 Core has no product with the SKU TEE-M.')).toBeTruthy()
    expect(screen.getByText('2 × Tee (TEE-M)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    expect(await screen.findByText(/Cin7 Core SO-9/)).toBeTruthy()
  })

  it('offers no resend while the connection needs connecting again', async () => {
    const routes = api({ order: jest.fn(async () => ({ connection: { provider: 'cin7-core' as const, status: 'reconnect' as const }, order: handOff() })) })
    render(<OrderInventoryWidget hostId="h" order={{ id: 'o-1' }} api={routes} />)
    await screen.findByText('Not sent')
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull()
  })
})
