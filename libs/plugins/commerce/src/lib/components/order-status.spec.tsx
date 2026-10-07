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

import { render, screen, waitFor } from '@testing-library/react'
import { buildOrderStatusView } from '../model'
import OrderStatus from './order-status'

/**
 * The order-status block (AGL-3610) reads the signed link from the URL after
 * hydration, and shows what the route returned: status, shipments with their
 * tracking link, lines and totals.
 */
const mockSiteFetch = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

const view = buildOrderStatusView({
  order: {
    status: 'fulfilled',
    createdAtMs: Date.UTC(2026, 9, 1),
    lineItems: [{ productId: 'p', name: 'House Blend', quantity: 2, unitAmountCents: 1200 }],
    totals: { itemsCents: 2400, shippingCents: 500, taxCents: 0, discountCents: 0, totalCents: 2900, feeCents: 0 },
    fulfillments: [{ id: 'f1', lineItemIds: [0], carrier: 'USPS', trackingNumber: '9400', atMs: Date.UTC(2026, 9, 2) }],
    timeline: [{ atMs: Date.UTC(2026, 9, 1), event: 'paid' }],
  } as never,
  orderId: 'order-1',
  storeName: 'Northwind Coffee',
  number: '#1042',
})

beforeEach(() => {
  mockSiteFetch.mockReset()
  window.history.replaceState({}, '', '/order-status?o=order-1&t=tok')
})

describe('OrderStatus block', () => {
  it('loads the order from the signed link and shows its shipment', async () => {
    mockSiteFetch.mockResolvedValue({ ok: true, json: async () => view })
    render(<OrderStatus />)
    expect(await screen.findByText('Order #1042')).toBeTruthy()
    expect(mockSiteFetch).toHaveBeenCalledWith(
      '/api/commerce/order-status?hostId=host-1&o=order-1&t=tok',
    )
    expect(screen.getByText('Shipped', { selector: '.MuiChip-label' })).toBeTruthy()
    const track = screen.getByRole('link', { name: 'Track package' })
    expect(track.getAttribute('href')).toBe(
      'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400',
    )
    expect(screen.getByText('$29.00')).toBeTruthy()
  })

  it('says what to do when the link is missing or refused, and fetches nothing without one', async () => {
    window.history.replaceState({}, '', '/order-status')
    render(<OrderStatus />)
    expect(await screen.findByText('Open this page from the link in your order email.')).toBeTruthy()
    expect(mockSiteFetch).not.toHaveBeenCalled()
  })

  it('shows the route’s refusal', async () => {
    mockSiteFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'We could not find that order. Check the link in your email.' }),
    })
    render(<OrderStatus />)
    await waitFor(() =>
      expect(screen.getByText('We could not find that order. Check the link in your email.')).toBeTruthy(),
    )
  })
})
