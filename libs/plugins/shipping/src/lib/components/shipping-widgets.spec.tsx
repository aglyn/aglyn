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
import { OrderLabelsWidget, type OrderLabelsWidgetProps } from './order-labels-widget.component'
import { OrdersBatchWidget } from './orders-batch-widget.component'
import { ProductShippingFields } from './product-shipping-fields.component'

/**
 * The console widgets the shipping plugin puts in commerce's zones. Every
 * one renders NOTHING until the deployment names a provider — that is what
 * keeps carrier rates and labels invisible where the env is not set — and
 * once it does, each shows what it says it shows.
 */

let available = false
const request = jest.fn()

jest.mock('./shipping-api', () => ({
  ...jest.requireActual('./shipping-api'),
  useShippingAvailability: () => ({ loading: false, available, provider: 'Shippo', testMode: false }),
  useShippingFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

const ORDER: OrderLabelsWidgetProps['order'] = {
  id: 'order-1',
  number: '1001',
  status: 'paid',
  currency: 'usd',
  shippingAddress: {
    name: 'Ann',
    line1: '2 B St',
    line2: null,
    city: 'Boston',
    state: 'MA',
    postalCode: '02108',
    country: 'US',
    phone: null,
  },
  lines: [{ lineItemId: 0, name: 'Candle', quantity: 2, fulfilledQuantity: 0, remainingQuantity: 2, requiresShipping: true }],
}

beforeEach(() => {
  available = false
  request.mockReset()
})

describe('hidden until the deployment names a provider', () => {
  it('renders none of the widgets', () => {
    const product = { id: 'p1', type: 'physical' }
    const { container } = render(
      <>
        <ProductShippingFields hostId="host-1" product={product} proposeValues={jest.fn()} />
        <OrderLabelsWidget hostId="host-1" order={ORDER} />
        <OrdersBatchWidget hostId="host-1" selectedOrderIds={['order-1']} />
      </>,
    )
    expect(container.innerHTML).toBe('')
    expect(request).not.toHaveBeenCalled()
  })
})

describe('once a provider is configured', () => {
  beforeEach(() => {
    available = true
  })

  it('asks a physical product for its packed size and customs facts, and stages what is typed', () => {
    const proposeValues = jest.fn()
    render(
      <ProductShippingFields
        hostId="host-1"
        product={{ id: 'p1', type: 'physical', shipping: { lengthCm: 20, widthCm: null, heightCm: null, hsCode: '', originCountry: '' } }}
        proposeValues={proposeValues}
      />,
    )
    expect((screen.getByLabelText('Packed length (cm)') as HTMLInputElement).value).toBe('20')
    fireEvent.change(screen.getByLabelText('Packed width (cm)'), { target: { value: '500' } })
    expect(proposeValues).toHaveBeenLastCalledWith({ shipping: { widthCm: 300 } }, 'shipping-fields')
    fireEvent.change(screen.getByLabelText('Country of origin'), { target: { value: 'us1' } })
    expect(proposeValues).toHaveBeenLastCalledWith({ shipping: { originCountry: 'US' } }, 'shipping-fields')
    fireEvent.change(screen.getByLabelText('HS tariff code'), { target: { value: '3406.00abc' } })
    expect(proposeValues).toHaveBeenLastCalledWith({ shipping: { hsCode: '3406.00' } }, 'shipping-fields')
  })

  it('stays out of a digital product’s editor', () => {
    const { container } = render(<ProductShippingFields hostId="host-1" product={{ id: 'p1', type: 'digital' }} proposeValues={jest.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('lists an order’s labels with print and void, and offers Buy label', async () => {
    request.mockResolvedValue({
      labels: [
        {
          labelId: 'lbl_1',
          kind: 'outbound',
          status: 'purchased',
          carrier: 'USPS',
          serviceLabel: 'USPS Ground Advantage',
          trackingNumber: '9400111',
          trackingUrl: null,
          trackingStatus: 'in_transit',
          labelUrl: 'https://example.com/l.pdf',
          commercialInvoiceUrl: null,
          costCents: 625,
          chargeCents: 625,
          currency: 'usd',
          billingMethod: 'account_debit',
          billingState: 'charged',
          billingFailure: null,
          recordShipmentRefusal: null,
          createdAtMs: 1,
        },
      ],
    })
    render(<OrderLabelsWidget hostId="host-1" order={ORDER} />)
    expect(await screen.findByText(/USPS Ground Advantage · 9400111 · In transit/)).toBeTruthy()
    expect(request).toHaveBeenCalledWith('shipping/labels', { query: { hostId: 'host-1', recordId: 'order-1' } })
    expect((screen.getByRole('button', { name: 'Buy label' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
    request.mockResolvedValueOnce({ label: {} }).mockResolvedValue({ labels: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Void' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('shipping/labels/void', { body: { hostId: 'host-1', labelId: 'lbl_1' } }),
    )
  })

  it('will not buy a label for an order with nothing left to ship', async () => {
    request.mockResolvedValue({ labels: [] })
    render(
      <OrderLabelsWidget
        hostId="host-1"
        order={{ ...ORDER, lines: [{ ...ORDER.lines[0], fulfilledQuantity: 2, remainingQuantity: 0 }] }}
      />,
    )
    expect(((await screen.findByRole('button', { name: 'Buy label' })) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Return label' })).toBeTruthy()
  })

  it('warns of an address the carrier could not deliver to, checked when the order was paid', async () => {
    request.mockResolvedValue({
      labels: [],
      addressCheck: { verdict: 'invalid', messages: ['Unknown street'], suggested: null, source: 'checkout', checkedAtMs: 1 },
    })
    render(<OrderLabelsWidget hostId="host-1" order={ORDER} />)
    expect(await screen.findByText(/The carrier cannot deliver to this order’s address\. Unknown street/)).toBeTruthy()
  })

  it('offers batch labels only while orders are selected', () => {
    const { container, rerender } = render(<OrdersBatchWidget hostId="host-1" selectedOrderIds={[]} />)
    expect(container.innerHTML).toBe('')
    rerender(<OrdersBatchWidget hostId="host-1" selectedOrderIds={['order-1', 'order-2']} />)
    expect(container.innerHTML).not.toBe('')
  })
})
