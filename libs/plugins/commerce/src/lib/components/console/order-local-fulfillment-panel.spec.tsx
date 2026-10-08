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
import OrderDetailDialog from './order-detail-dialog.component'
import PickupDeliveryQueueCard from './pickup-delivery-queue-card.component'

/**
 * Pickup and local delivery in the console (AGL-3624): the order dialog's
 * panel and the Pickup & delivery queue. The route is the only writer; these
 * cases pin what is shown and what each step sends, and that every queue tab
 * is ONE query on the stamped fields.
 */

const mockQueries: any[] = []
const mockRows: Record<string, any[]> = {}
let mockStore: any = null

jest.mock('firebase/firestore', () => ({
  doc: (...path: unknown[]) => ({ kind: 'doc', path: path.slice(1).join('/') }),
  collection: (...path: unknown[]) => ({ kind: 'collection', path: path.slice(1).join('/') }),
  query: (source: any, ...clauses: any[]) => ({ kind: 'query', path: source.path, clauses }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
  limit: (count: number) => ({ limit: count }),
  updateDoc: jest.fn(async () => undefined),
  runTransaction: jest.fn(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (!built) return { data: [], status: 'idle' }
    mockQueries.push(built)
    return { data: mockRows[built.path] ?? [], status: 'success' }
  },
  useFirestoreDoc: () => ({ data: mockStore }),
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const built = build(26)
    if (built) mockQueries.push(built)
    return {
      rows: built ? (mockRows[built.path] ?? []) : [],
      status: 'success',
      page: 0,
      setPage: () => undefined,
      pageSize: 25,
      setPageSize: () => undefined,
      hasMore: false,
    }
  },
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: jest.fn(async () => 'tok-3624') } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const enqueueSnackbar = jest.fn()
  return { useSnackbar: () => ({ enqueueSnackbar }), __snackbar: enqueueSnackbar }
})

jest.mock('@aglyn/shared-ui-jsx', () => {
  const actual = jest.requireActual('@aglyn/shared-ui-jsx')
  const confirm = jest.fn(async () => undefined)
  return { ...actual, useConfirmationContext: () => ({ confirm }) }
})

jest.mock('@aglyn/aglyn/app-utils/console-widget-slot-context', () => ({
  useConsoleWidgetSlot: () => null,
}))

const snackbar = (jest.requireMock('@aglyn/shared-ui-snackstack') as { __snackbar: jest.Mock }).__snackbar
const fetchMock = jest.fn()
const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as never
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)[1].body)

const lines = [{ productId: 'p1', name: 'Bread', quantity: 2, unitAmountCents: 500, productType: 'physical' }]

const pickupOrder = {
  $id: 'order-1',
  number: 7,
  status: 'paid',
  customerName: 'Ada',
  fulfillmentMethod: 'pickup',
  pickup: { locationId: 'main', locationName: 'Main Street', address: '1 Main St', status: 'preparing' },
  lineItems: lines,
  totals: { itemsCents: 1000, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 1000 },
  timeline: [],
  createdAtMs: 1_700_000_000_000,
}

const deliveryOrder = {
  ...pickupOrder,
  $id: 'order-2',
  number: 8,
  fulfillmentMethod: 'local_delivery',
  pickup: undefined,
  shippingAddress: { line1: '2 Elm St', postalCode: '62704' },
  localDelivery: {
    zoneId: 'near',
    zoneName: 'Downtown',
    feeCents: 500,
    windowStartMs: 1,
    windowEndMs: 2,
    windowLabel: 'Tue, Oct 13, 9:00 AM – 12:00 PM',
    postalCode: '62704',
    status: 'out_for_delivery',
    addressOutsideZone: true,
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockQueries.length = 0
  for (const key of Object.keys(mockRows)) delete mockRows[key]
  mockStore = null
  ;(global as { fetch: unknown }).fetch = fetchMock
})

describe('the order dialog’s pickup and delivery panel', () => {
  it('shows where a pickup is collected and marks it ready through the route', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, status: 'paid' }))
    render(<OrderDetailDialog hostId="host-1" order={pickupOrder as never} onClose={jest.fn()} />)
    expect(screen.getByText('Main Street — 1 Main St')).toBeTruthy()
    expect(screen.getByText('Preparing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/commerce/local-fulfillment')
    expect(lastBody()).toEqual({ hostId: 'host-1', orderId: 'order-1', action: 'ready' })
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith('Marked ready — the buyer has been told', expect.objectContaining({ variant: 'success' })),
    )
  })

  it('flags a delivery address outside the zones, and asks why before marking a drop failed', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, status: 'paid' }))
    render(<OrderDetailDialog hostId="host-1" order={deliveryOrder as never} onClose={jest.fn()} />)
    expect(screen.getByText('Tue, Oct 13, 9:00 AM – 12:00 PM · Downtown · 62704')).toBeTruthy()
    expect(screen.getByText(/outside your delivery zones/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Couldn’t deliver' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('What happened (optional)'), { target: { value: 'Nobody home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastBody()).toEqual({ hostId: 'host-1', orderId: 'order-2', action: 'delivery_failed', reason: 'Nobody home' })
  })

  it('shows the route’s refusal in its own words', async () => {
    fetchMock.mockResolvedValue(answer(409, { error: 'This order can’t move on from "refunded"' }))
    render(<OrderDetailDialog hostId="host-1" order={pickupOrder as never} onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }))
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith('This order can’t move on from "refunded"', expect.objectContaining({ variant: 'warning' })),
    )
  })

  it('draws nothing for a shipped order', () => {
    render(
      <OrderDetailDialog
        hostId="host-1"
        order={{ ...pickupOrder, fulfillmentMethod: undefined, pickup: undefined } as never}
        onClose={jest.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Mark ready' })).toBeNull()
  })
})

describe('the Pickup & delivery queue', () => {
  it('draws nothing for a store with no pickup and no local delivery', () => {
    mockRows['hosts/host-1/locations'] = [{ $id: 'main', name: 'Main Street' }]
    const { container } = render(<PickupDeliveryQueueCard hostId="host-1" />)
    expect(container.textContent).toBe('')
    expect(mockQueries.some((built) => built.path === 'hosts/host-1/orders')).toBe(false)
  })

  it('queries one tab at a time on the stamped fields, and takes a row’s next step', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, status: 'paid' }))
    mockRows['hosts/host-1/locations'] = [
      { $id: 'main', name: 'Main Street', pickup: { enabled: true } },
      { $id: 'mill', name: 'Mill Road' },
    ]
    mockRows['hosts/host-1/orders'] = [pickupOrder]
    render(<PickupDeliveryQueueCard hostId="host-1" />)
    expect(screen.getByRole('tab', { name: 'To prepare' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'To deliver' })).toBeNull()
    const orders = mockQueries.filter((built) => built.path === 'hosts/host-1/orders').at(-1)
    expect(orders.clauses).toEqual([
      { where: ['fulfillmentKey', '==', 'pickup_preparing'] },
      { where: ['status', 'in', ['paid', 'partially_fulfilled', 'fulfilled']] },
      { orderBy: ['fulfillmentDueMs', 'asc'] },
      { limit: 26 },
    ])
    expect(screen.getByText('#7 · Ada · 2 items')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastBody()).toEqual({ hostId: 'host-1', orderId: 'order-1', action: 'ready' })
  })

  it('shows the delivery tabs once local delivery is on', () => {
    mockStore = { localDelivery: { enabled: true } }
    mockRows['hosts/host-1/locations'] = []
    render(<PickupDeliveryQueueCard hostId="host-1" />)
    expect(screen.getByRole('tab', { name: 'To deliver' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'To prepare' })).toBeNull()
    const orders = mockQueries.filter((built) => built.path === 'hosts/host-1/orders').at(-1)
    expect(orders.clauses[0]).toEqual({ where: ['fulfillmentKey', '==', 'delivery_scheduled'] })
  })
})
