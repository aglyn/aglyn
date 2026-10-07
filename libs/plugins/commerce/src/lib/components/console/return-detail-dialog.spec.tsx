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
 * THE RETURN DIALOG DRIVES THE RETURNS ROUTE (AGL-3611).
 *
 * Each action is offered only where the state machine allows it
 * (`canTransitionReturn`), and each one is a POST to `/api/commerce/returns`
 * — asserted on the body the route receives, decomposed, since a call count
 * would pass on the wrong action with an empty body.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as CommerceModel from '../../model'

let mockReturn: Record<string, any> = {}
let mockLocations: any[] = []
let mockZoneProps: Record<string, any> | null = null

const order = {
  status: 'fulfilled',
  lineItems: [
    { productId: 'p1', name: 'Ceramic mug', quantity: 2, unitAmountCents: 1500, productType: 'physical' },
    { productId: 'p2', name: 'Tee', variantLabel: 'Large', quantity: 1, unitAmountCents: 2000, productType: 'physical' },
  ],
  totals: { itemsCents: 5000, shippingCents: 0, taxCents: 0, discountCents: 0, totalCents: 5000 },
  shippingAddress: { name: 'Ada Lovelace', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
  timeline: [],
}

const baseReturn = {
  orderId: 'order-1',
  orderNumber: '#1042',
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  lines: [
    { lineItemId: 0, quantity: 2, reason: 'damaged' },
    { lineItemId: 1, quantity: 1, reason: 'size_or_fit' },
  ],
  requestedBy: 'buyer',
  customerNote: 'The handle came off.',
  timeline: [{ atMs: 1, event: 'requested' }],
  createdAtMs: 1,
  updatedAtMs: 1,
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: any, ...constraints: unknown[]) => ({ path: base.path, constraints }),
  limit: (value: number) => ({ limit: value }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: jest.fn(async () => 'tok-return') } }),
  useFirestoreDoc: (build: () => any) => {
    const path = build()?.path
    if (path === 'hosts/host-1/returns/ret-1') return { data: mockReturn }
    if (path === 'hosts/host-1/orders/order-1') return { data: order }
    if (path === 'hosts/host-1/settings/store') return { data: { currency: 'USD' } }
    return { data: undefined }
  },
  useFirestoreCollection: (build: () => any) => ({ data: build() ? mockLocations : [] }),
}))

jest.mock('@aglyn/aglyn/app-utils/console-widget-slot-context', () => ({
  useConsoleWidgetSlot: () => (props: Record<string, any>) => {
    mockZoneProps = props
    return null
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const enqueueSnackbar = jest.fn()
  return { useSnackbar: () => ({ enqueueSnackbar }), __snackbar: enqueueSnackbar }
})

jest.mock('@aglyn/shared-ui-jsx', () => {
  const confirm = jest.fn(async () => undefined)
  return { useConfirmationContext: () => ({ confirm }), __confirm: confirm }
})

import ReturnDetailDialog from './return-detail-dialog.component'

const confirm = (jest.requireMock('@aglyn/shared-ui-jsx') as { __confirm: jest.Mock }).__confirm
const snackbar = (jest.requireMock('@aglyn/shared-ui-snackstack') as { __snackbar: jest.Mock })
  .__snackbar
const fetchMock = jest.fn()

const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as never

const show = (status: string, extra: Record<string, unknown> = {}) => {
  mockReturn = { ...baseReturn, status, ...extra }
  return render(<ReturnDetailDialog hostId="host-1" returnId="ret-1" onClose={jest.fn()} />)
}

const button = (name: string) => screen.queryByRole('button', { name })
const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body)

beforeEach(() => {
  jest.clearAllMocks()
  mockLocations = []
  mockZoneProps = null
  ;(global as { fetch: unknown }).fetch = fetchMock
  fetchMock.mockResolvedValue(answer(200, { ok: true, status: 'approved' }))
})

describe('the actions a return offers follow its state', () => {
  it.each([
    ['requested', ['Approve', 'Decline', 'Close return'], ['Mark received…', 'Refund…']],
    ['approved', ['Mark received…', 'Refund…', 'Close return'], ['Approve', 'Decline']],
    ['received', ['Refund…', 'Close return'], ['Approve', 'Decline', 'Mark received…']],
    ['declined', ['Close return'], ['Approve', 'Decline', 'Mark received…', 'Refund…']],
    ['refunded', ['Close return'], ['Approve', 'Decline', 'Mark received…', 'Refund…']],
    ['closed', [], ['Approve', 'Decline', 'Mark received…', 'Refund…', 'Close return']],
  ])('%s', (status, shown, hidden) => {
    show(status)
    for (const name of shown) expect(button(name)).not.toBeNull()
    for (const name of hidden) expect(button(name)).toBeNull()
  })

  it('shows the lines with their reasons, and the customer note', () => {
    show('requested')
    expect(screen.getByText('2× Ceramic mug')).toBeTruthy()
    expect(screen.getByText('1× Tee — Large')).toBeTruthy()
    expect(screen.getByText('Arrived damaged')).toBeTruthy()
    expect(screen.getByText('Size or fit')).toBeTruthy()
    expect(screen.getByText('The handle came off.')).toBeTruthy()
  })
})

describe('approve and decline', () => {
  it('approves with the note to the buyer and notify on by default', async () => {
    show('requested')
    fireEvent.click(button('Approve')!)
    fireEvent.change(screen.getByLabelText('Note to the customer (optional)'), {
      target: { value: 'Use the prepaid label.' },
    })
    fireEvent.click(button('Approve return')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/commerce/returns')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-return')
    expect(sentBody()).toEqual({
      hostId: 'host-1',
      returnId: 'ret-1',
      action: 'approve',
      merchantNote: 'Use the prepaid label.',
      notify: true,
    })
  })

  it('declines without telling the buyer when Notify customer is cleared', async () => {
    show('requested')
    fireEvent.click(button('Decline')!)
    fireEvent.click(screen.getByLabelText('Notify customer'))
    fireEvent.click(button('Decline return')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody()).toEqual({
      hostId: 'host-1',
      returnId: 'ret-1',
      action: 'decline',
      notify: false,
    })
  })

  it('surfaces the route refusing as a warning in its own words', async () => {
    fetchMock.mockResolvedValue(answer(409, { error: 'A return that is declined cannot be approved' }))
    show('requested')
    fireEvent.click(button('Approve')!)
    fireEvent.click(button('Approve return')!)
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith('A return that is declined cannot be approved', {
        variant: 'warning',
        allowDuplicate: true,
      }),
    )
  })
})

describe('receive', () => {
  it('restocks each line at its returned quantity unless changed, to the default location', async () => {
    mockLocations = [
      { $id: 'loc-b', name: 'Backroom' },
      { $id: 'loc-a', name: 'Warehouse', isDefault: true },
    ]
    show('approved')
    fireEvent.click(button('Mark received…')!)
    expect(screen.getByLabelText('Location')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Restock (of 1)'), { target: { value: '0' } })
    fireEvent.click(button('Confirm received')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody()).toEqual({
      hostId: 'host-1',
      returnId: 'ret-1',
      action: 'receive',
      restock: [
        { lineItemId: 0, quantity: 2 },
        { lineItemId: 1, quantity: 0 },
      ],
      locationId: 'loc-a',
    })
  })

  it('sends no location for a store without locations', async () => {
    show('approved')
    fireEvent.click(button('Mark received…')!)
    expect(screen.queryByLabelText('Location')).toBeNull()
    fireEvent.click(button('Confirm received')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody()).not.toHaveProperty('locationId')
  })
})

describe('refund', () => {
  it('suggests what the returned lines were paid and sends it in cents after confirming', async () => {
    const suggested = CommerceModel.returnRefundCents(order as never, baseReturn.lines)
    show('received')
    fireEvent.click(button('Refund…')!)
    expect((screen.getByLabelText('Refund amount') as HTMLInputElement).value).toBe(
      (suggested / 100).toFixed(2),
    )
    fireEvent.click(button('Refund')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(sentBody()).toEqual({
      hostId: 'host-1',
      returnId: 'ret-1',
      action: 'refund',
      amountCents: suggested,
    })
  })

  it('sends an edited amount as integer cents', async () => {
    show('approved')
    fireEvent.click(button('Refund…')!)
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '12.5' } })
    fireEvent.click(button('Refund')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody().amountCents).toBe(1250)
  })

  it('sends nothing when the confirmation is declined', async () => {
    confirm.mockRejectedValueOnce(undefined)
    show('approved')
    fireEvent.click(button('Refund…')!)
    fireEvent.click(button('Refund')!)
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('close and note', () => {
  it('closes through the route', async () => {
    show('declined')
    fireEvent.click(button('Close return')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody()).toEqual({ hostId: 'host-1', returnId: 'ret-1', action: 'close' })
  })

  it('saves the merchant note through the route', async () => {
    show('approved')
    fireEvent.change(screen.getByLabelText('Merchant note'), { target: { value: 'Box was crushed' } })
    fireEvent.click(button('Save note')!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody()).toEqual({
      hostId: 'host-1',
      returnId: 'ret-1',
      action: 'note',
      merchantNote: 'Box was crushed',
    })
  })
})

describe('the returnDetail zone', () => {
  it('hands a widget the return, the from address and attachReturnLabel', async () => {
    show('approved')
    expect(mockZoneProps?.['slot']).toBe('returnDetail')
    expect(mockZoneProps?.['return']).toEqual(
      expect.objectContaining({
        id: 'ret-1',
        status: 'approved',
        orderId: 'order-1',
        orderNumber: '#1042',
        returnLabel: null,
        lines: [
          { lineItemId: 0, name: 'Ceramic mug', variantLabel: null, quantity: 2, reason: 'damaged' },
          { lineItemId: 1, name: 'Tee', variantLabel: 'Large', quantity: 1, reason: 'size_or_fit' },
        ],
      }),
    )
    expect(mockZoneProps?.['return'].fromAddress).toEqual(
      expect.objectContaining({ line1: '1 Main St', postalCode: '78701' }),
    )
    await mockZoneProps?.['attachReturnLabel']({
      carrier: 'USPS',
      trackingNumber: '9400',
      labelUrl: 'https://labels.example/1.pdf',
    })
    expect(sentBody()).toEqual({
      hostId: 'host-1',
      returnId: 'ret-1',
      action: 'attach-label',
      label: { carrier: 'USPS', trackingNumber: '9400', labelUrl: 'https://labels.example/1.pdf' },
    })
  })

  it('throws the route refusal back at the widget', async () => {
    fetchMock.mockResolvedValue(answer(409, { error: 'A return label needs an https link' }))
    show('approved')
    await expect(
      mockZoneProps?.['attachReturnLabel']({ carrier: 'USPS', trackingNumber: '1', labelUrl: 'http://x' }),
    ).rejects.toThrow('A return label needs an https link')
  })

  it('shows a label once attached', () => {
    show('approved', {
      returnLabel: {
        carrier: 'USPS',
        trackingNumber: '9400',
        labelUrl: 'https://labels.example/1.pdf',
        trackingUrl: 'https://track.example/9400',
        attachedAtMs: 2,
      },
    })
    const label = screen.getByText('Return label').parentElement!
    expect(within(label).getByText('USPS · 9400')).toBeTruthy()
    expect(within(label).getByRole('link', { name: 'Print label' }).getAttribute('href')).toBe(
      'https://labels.example/1.pdf',
    )
  })
})
