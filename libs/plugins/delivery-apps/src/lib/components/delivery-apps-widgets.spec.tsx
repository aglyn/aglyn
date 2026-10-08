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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DeliveryOrderView, DeliveryStoreView } from '../model/delivery-apps'
import type { DeliveryAppsApi } from './delivery-apps-api'
import { DeliveryAppsCard } from './delivery-apps-card.component'
import { DeliveryQueue } from './delivery-queue.component'

jest.mock('./delivery-apps-api', () => ({ useDeliveryAppsApi: () => null }))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
const mockConfirm = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const storeView = (overrides: Partial<DeliveryStoreView> = {}): DeliveryStoreView => ({
  service: 'doordash',
  externalStoreId: 'store-7',
  settings: { autoAccept: false, prepMinutes: 15 },
  connectedAtMs: 1,
  menu: { publishedAtMs: null, items: 0, error: null },
  unmatched: 0,
  ...overrides,
})

const orderView = (overrides: Partial<DeliveryOrderView> = {}): DeliveryOrderView => ({
  id: 'doordash_1',
  service: 'doordash',
  externalRef: 'A1B2',
  status: 'new',
  handoff: 'courier',
  placedAtMs: Date.parse('2026-10-07T18:00:00Z'),
  pickupAtMs: Date.parse('2026-10-07T18:20:00Z'),
  customerName: 'Jamie R.',
  instructions: 'Leave at the door',
  lines: [{ name: 'Classic Burger', quantity: 2, unitPriceCents: 1300, options: ['Cheese'], instructions: 'No onions', matched: true }],
  currency: 'USD',
  subtotalCents: 2600,
  taxCents: 208,
  totalCents: 2808,
  refundedCents: 0,
  recordId: null,
  displayRef: null,
  oversold: 0,
  testMode: false,
  pending: null,
  error: null,
  updatedAtMs: 1,
  ...overrides,
})

function api(overrides: Partial<DeliveryAppsApi> = {}): DeliveryAppsApi {
  return {
    stores: jest.fn(async () => ({ offered: [], stores: [] })),
    connect: jest.fn(async (service, externalStoreId) => storeView({ service, externalStoreId })),
    update: jest.fn(async (_service, settings) => storeView({ settings })),
    disconnect: jest.fn(async () => undefined),
    sendMenu: jest.fn(async () => 3),
    items: jest.fn(async () => []),
    match: jest.fn(async () => undefined),
    searchCatalog: jest.fn(async () => [{ productId: 'fries', variantId: 'default', title: 'Fries', sku: 'FRY-1' }]),
    queue: jest.fn(async () => ({ connected: false, open: [], recent: [] })),
    act: jest.fn(async () => ({ message: null, order: null })),
    ...overrides,
  }
}

beforeEach(() => {
  mockSnack.mockReset()
  mockConfirm.mockReset()
  mockConfirm.mockImplementation(async () => undefined)
})

describe('DeliveryAppsCard (AGL-3644)', () => {
  it('draws nothing where the deployment offers no service', async () => {
    const routes = api()
    const { container } = render(<DeliveryAppsCard hostId="h" api={routes} />)
    await waitFor(() => expect(routes.stores).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('connects a store by the id the service shows', async () => {
    const routes = api({ stores: jest.fn(async () => ({ offered: [{ id: 'grubhub' as const, sandbox: true }], stores: [] })) })
    render(<DeliveryAppsCard hostId="h" api={routes} />)
    expect(await screen.findByText(/takes Grubhub test orders only/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Grubhub merchant ID'), { target: { value: ' 112233 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(routes.connect).toHaveBeenCalledWith('grubhub', '112233', { autoAccept: false, prepMinutes: 15 }))
    expect(await screen.findByText('Grubhub merchant ID: 112233')).toBeTruthy()
  })

  it('saves its settings, sends the menu from the header, and disconnects after asking', async () => {
    const routes = api({ stores: jest.fn(async () => ({ offered: [{ id: 'doordash' as const, sandbox: false }], stores: [storeView()] })) })
    render(<DeliveryAppsCard hostId="h" api={routes} />)
    fireEvent.click(await screen.findByLabelText('Accept orders automatically'))
    await waitFor(() => expect(routes.update).toHaveBeenCalledWith('doordash', { autoAccept: true, prepMinutes: 15 }))
    const prep = screen.getByLabelText('Prep time (minutes)')
    fireEvent.change(prep, { target: { value: '25' } })
    fireEvent.blur(prep)
    await waitFor(() => expect(routes.update).toHaveBeenCalledWith('doordash', { autoAccept: true, prepMinutes: 25 }))
    fireEvent.click(screen.getByRole('button', { name: 'Send menu' }))
    await waitFor(() => expect(mockSnack).toHaveBeenCalledWith('Menu sent to DoorDash: 3 items.', expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(routes.disconnect).toHaveBeenCalledWith('doordash'))
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disconnect DoorDash?' }))
  })

  it('lists the items that match no product and matches one', async () => {
    const routes = api({
      stores: jest.fn(async () => ({ offered: [{ id: 'doordash' as const, sandbox: false }], stores: [storeView({ unmatched: 1 })] })),
      items: jest.fn(async () => [{ externalItemId: 'FRY-9', name: 'Fries', productId: null, variantId: null, title: null, lastSeenAtMs: 1 }]),
    })
    render(<DeliveryAppsCard hostId="h" api={routes} />)
    expect(await screen.findByText(/1 item sold on DoorDash match no product/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Match' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('Product')
    fireEvent.change(input, { target: { value: 'fri' } })
    await waitFor(() => expect(routes.searchCatalog).toHaveBeenCalledWith('fri'))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByText('Fries · FRY-1'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Match' }))
    await waitFor(() =>
      expect(routes.match).toHaveBeenCalledWith(
        'doordash',
        expect.objectContaining({ externalItemId: 'FRY-9' }),
        { productId: 'fries', variantId: 'default', title: 'Fries', sku: 'FRY-1' },
      ),
    )
  })
})

describe('DeliveryQueue (AGL-3644)', () => {
  it('draws nothing until the site has a store connected', async () => {
    const routes = api()
    const { container } = render(<DeliveryQueue hostId="h" api={routes} pollMs={60_000} />)
    await waitFor(() => expect(routes.queue).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('shows what to make and the next step, and accepts', async () => {
    const routes = api({ queue: jest.fn(async () => ({ connected: true, open: [orderView()], recent: [] })) })
    render(<DeliveryQueue hostId="h" api={routes} pollMs={60_000} />)
    expect(await screen.findByText('DoorDash A1B2 · Jamie R.')).toBeTruthy()
    expect(screen.getByText('2 × Classic Burger')).toBeTruthy()
    expect(screen.getByText(/Cheese/)).toBeTruthy()
    expect(screen.getByText('Leave at the door')).toBeTruthy()
    expect(screen.getByText('$28.08')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(routes.act).toHaveBeenCalledWith('doordash_1', 'accept', undefined))
  })

  it('rejects with a reason the cashier picks', async () => {
    const routes = api({ queue: jest.fn(async () => ({ connected: true, open: [orderView()], recent: [] })) })
    render(<DeliveryQueue hostId="h" api={routes} pollMs={60_000} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(routes.act).toHaveBeenCalledWith('doordash_1', 'reject', 'An item is out of stock'))
  })

  it('offers ready for a service that takes it, picked up for one that does not, and a resend for a failed call', async () => {
    const routes = api({
      queue: jest.fn(async () => ({
        connected: true,
        open: [
          orderView({ id: 'a', status: 'accepted' }),
          orderView({ id: 'b', service: 'uber-eats', externalRef: 'U1', status: 'accepted' }),
          orderView({ id: 'c', externalRef: 'C1', status: 'ready', pending: 'ready', error: 'DoorDash had a problem (503)' }),
        ],
        recent: [orderView({ id: 'd', externalRef: 'D1', status: 'picked_up', displayRef: '#1001' })],
      })),
    })
    render(<DeliveryQueue hostId="h" api={routes} pollMs={60_000} />)
    const a = await screen.findByTestId('delivery-order-a')
    expect(within(a).getByRole('button', { name: 'Ready for pickup' })).toBeTruthy()
    expect(within(screen.getByTestId('delivery-order-b')).queryByRole('button', { name: 'Ready for pickup' })).toBeNull()
    expect(within(screen.getByTestId('delivery-order-b')).getByRole('button', { name: 'Picked up' })).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('delivery-order-c')).getByRole('button', { name: 'Send again' }))
    await waitFor(() => expect(routes.act).toHaveBeenCalledWith('c', 'retry', undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Finished' }))
    expect(await screen.findByText('#1001')).toBeTruthy()
  })

  it('announces an order that arrived since the last look, once', async () => {
    jest.useFakeTimers()
    try {
      const answers = [
        { connected: true, open: [], recent: [] },
        { connected: true, open: [orderView()], recent: [] },
        { connected: true, open: [orderView()], recent: [] },
      ]
      const routes = api({ queue: jest.fn(async () => answers.shift() ?? answers[0]) })
      render(<DeliveryQueue hostId="h" api={routes} pollMs={1000} />)
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        jest.advanceTimersByTime(1000)
      })
      await act(async () => {
        jest.advanceTimersByTime(1000)
      })
      expect(mockSnack.mock.calls.filter(([message]) => message === 'New DoorDash order A1B2')).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })
})
