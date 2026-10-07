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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OrderDetailDialog from './order-detail-dialog.component'

/**
 * The order dialog's Fulfill items panel, shipment list and order zones
 * (AGL-3611). The route is the only writer; these cases pin what the dialog
 * sends it and what a zone widget is handed.
 */

jest.mock('firebase/firestore', () => ({
  doc: () => ({}),
  updateDoc: jest.fn(async () => undefined),
  runTransaction: jest.fn(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({
    data: { uid: 'uid-admin', getIdToken: jest.fn(async () => 'tok-3611') },
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const enqueueSnackbar = jest.fn()
  return { useSnackbar: () => ({ enqueueSnackbar }), __snackbar: enqueueSnackbar }
})

jest.mock('@aglyn/shared-ui-jsx', () => {
  const confirm = jest.fn(async () => undefined)
  return { useConfirmationContext: () => ({ confirm }), __confirm: confirm }
})

const mockZoneProps: Record<string, any> = {}
jest.mock('@aglyn/aglyn/app-utils/console-widget-slot-context', () => ({
  useConsoleWidgetSlot: () =>
    function Slot(props: Record<string, any>) {
      mockZoneProps[props.slot] = props
      return <div data-testid={`zone-${props.slot}`} />
    },
}))

const snackbar = (jest.requireMock('@aglyn/shared-ui-snackstack') as { __snackbar: jest.Mock }).__snackbar
const fetchMock = jest.fn()

const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as never

const order = {
  $id: 'order-1',
  number: 7,
  status: 'paid',
  customerEmail: 'buyer@example.com',
  shippingAddress: { name: 'Ada', line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
  lineItems: [
    { productId: 'p1', name: 'Mug', quantity: 3, unitAmountCents: 1000, productType: 'physical' },
    { productId: 'p2', name: 'E-book', quantity: 1, unitAmountCents: 500, productType: 'digital' },
  ],
  totals: { itemsCents: 3500, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 3500 },
  timeline: [],
}

const show = (subject: Record<string, unknown> = order) =>
  render(<OrderDetailDialog hostId="host-1" order={subject as never} onClose={jest.fn()} />)

const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)[1].body)
const lastHeaders = () => fetchMock.mock.calls.at(-1)[1].headers

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(mockZoneProps)) delete mockZoneProps[key]
  ;(global as { fetch: unknown }).fetch = fetchMock
})

describe('Fulfill items', () => {
  it('starts each shippable line at what is left, and the digital line at zero', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill…' }))
    expect((screen.getByLabelText('Quantity of Mug to fulfill') as HTMLInputElement).value).toBe('3')
    expect((screen.getByLabelText('Quantity of E-book to fulfill') as HTMLInputElement).value).toBe('0')
  })

  it('sends the picked units, the carrier, a keyed attempt and notify:false', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, status: 'partially_fulfilled', fulfillment: { id: 'f-1', lineItemIds: [0], atMs: 1 } }))
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill…' }))
    fireEvent.click(screen.getByRole('button', { name: 'One fewer Mug' }))
    fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'USPS' } })
    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '9400' } })
    fireEvent.click(screen.getByLabelText('Notify customer'))
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastBody()).toEqual({
      hostId: 'host-1',
      orderId: 'order-1',
      to: 'fulfilled',
      lineItems: [{ lineItemId: 0, quantity: 2 }],
      carrier: 'USPS',
      trackingNumber: '9400',
      notify: false,
    })
    expect(lastHeaders()['Idempotency-Key']).toEqual(expect.any(String))
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Items fulfilled — the rest are still to ship',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('reuses the attempt key after a lost response, and mints a new one after an answer', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const first = lastHeaders()['Idempotency-Key']
    fetchMock.mockResolvedValueOnce(answer(409, { error: 'Line 0 has only 1 left to fulfill, not 3' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Fulfill' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(lastHeaders()['Idempotency-Key']).toBe(first)
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Line 0 has only 1 left to fulfill, not 3',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })

  it('asks for a tracking link only for a carrier with no known tracker', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill…' }))
    fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'other' } })
    fireEvent.change(screen.getByLabelText('Carrier name'), { target: { value: 'Bike courier' } })
    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'B-1' } })
    expect(screen.getByLabelText('Tracking link')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'UPS' } })
    expect(screen.queryByLabelText('Tracking link')).toBeNull()
  })

  it('disables Fulfill when nothing is picked', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill…' }))
    fireEvent.change(screen.getByLabelText('Quantity of Mug to fulfill'), { target: { value: '0' } })
    expect((screen.getByRole('button', { name: 'Fulfill' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('never lets a quantity pass what is left', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill…' }))
    fireEvent.change(screen.getByLabelText('Quantity of Mug to fulfill'), { target: { value: '9' } })
    expect((screen.getByLabelText('Quantity of Mug to fulfill') as HTMLInputElement).value).toBe('3')
  })
})

describe('the shipment list', () => {
  const shipped = {
    ...order,
    status: 'partially_fulfilled',
    fulfillments: [
      { id: 'f-1', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 2 }], carrier: 'UPS', trackingNumber: '1Z', atMs: 5 },
    ],
  }

  it('shows each shipment with its tracking link, and the units on each line', () => {
    show(shipped)
    expect(screen.getByText('2× Mug')).toBeTruthy()
    expect(screen.getByRole('link', { name: '1Z' }).getAttribute('href')).toBe('https://www.ups.com/track?tracknum=1Z')
    expect(screen.getByText('2 of 3 fulfilled')).toBeTruthy()
  })

  it('edits the tracking through the route', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, status: 'partially_fulfilled' }))
    show(shipped)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tracking' }))
    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z-NEW' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save tracking' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastBody()).toEqual({
      hostId: 'host-1',
      orderId: 'order-1',
      action: 'update-tracking',
      fulfillmentId: 'f-1',
      carrier: 'UPS',
      trackingNumber: '1Z-NEW',
    })
  })

  it('cancels a shipment after confirming', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, status: 'paid' }))
    show(shipped)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel shipment' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastBody()).toMatchObject({ action: 'cancel-fulfillment', fulfillmentId: 'f-1' })
  })

  it('offers no edits on a delivered order', () => {
    show({ ...shipped, status: 'delivered' })
    expect(screen.queryByRole('button', { name: 'Edit tracking' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel shipment' })).toBeNull()
  })
})

describe('the order zones', () => {
  it('hands orderDetail the order in its own words, with what is left to ship', () => {
    show()
    const props = mockZoneProps.orderDetail
    expect(props.hostId).toBe('host-1')
    expect(props.order).toMatchObject({
      id: 'order-1',
      number: '#7',
      currency: 'USD',
      shippingAddress: { name: 'Ada', postalCode: '78701', phone: null },
    })
    expect(props.order.lines[0]).toMatchObject({ lineItemId: 0, remainingQuantity: 3, requiresShipping: true })
    expect(props.order.lines[1]).toMatchObject({ requiresShipping: false })
  })

  it('hands orderFulfillment the selection, and applyTracking fills the panel', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill…' }))
    expect(mockZoneProps.orderFulfillment.selection).toEqual([{ lineItemId: 0, quantity: 3 }])
    act(() =>
      mockZoneProps.orderFulfillment.applyTracking({
        carrier: 'USPS',
        trackingNumber: '9405',
        labelUrl: 'https://labels.example/1.pdf',
      }),
    )
    expect((screen.getByLabelText('Tracking number') as HTMLInputElement).value).toBe('9405')
    expect(screen.getByRole('link', { name: 'Shipping label' })).toBeTruthy()
  })

  it("records a widget's shipment through the route and returns it", async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        ok: true,
        status: 'fulfilled',
        fulfillment: { id: 'f-9', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 3 }], carrier: 'USPS', trackingNumber: '9405', labelUrl: 'https://labels.example/1.pdf', atMs: 9 },
      }),
    )
    show()
    let recorded: any
    await act(async () => {
      recorded = await mockZoneProps.orderDetail.recordFulfillment({
        carrier: 'USPS',
        trackingNumber: '9405',
        labelUrl: 'https://labels.example/1.pdf',
        idempotencyKey: 'label-1',
      })
    })
    expect(lastHeaders()['Idempotency-Key']).toBe('label-1')
    expect(lastBody()).toMatchObject({ labelUrl: 'https://labels.example/1.pdf', carrier: 'USPS' })
    expect(recorded).toMatchObject({ id: 'f-9', labelUrl: 'https://labels.example/1.pdf', status: 'active' })
  })

  it('throws when the route refuses a widget shipment', async () => {
    fetchMock.mockResolvedValue(answer(409, { error: 'Orders in "refunded" cannot be fulfilled' }))
    show()
    await expect(
      mockZoneProps.orderDetail.recordFulfillment({ carrier: 'USPS', trackingNumber: '1', idempotencyKey: 'k' }),
    ).rejects.toThrow(/not recorded/)
  })
})
