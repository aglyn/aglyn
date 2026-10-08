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
 * How the buyer gets the order, chosen at the cart (AGL-3624): a store with
 * no pickup location and no local delivery shows nothing and sends nothing;
 * one that offers them shows the choice, and the checkout is sent the
 * location, or the postal code and window — never a fee. Checkout is mocked
 * at `siteFetch`, the options at `fetch`; nothing reaches Stripe.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'

const CART = {
  lines: [{ productId: 'bread', quantity: 2, name: 'Bread', unitAmountCents: 1_500 }],
  count: 2,
  subtotalCents: 3_000,
}

let options: Record<string, unknown> = {}
const optionRequests: Array<Record<string, unknown>> = []

beforeEach(() => {
  options = {}
  optionRequests.length = 0
  mockSiteFetch.mockReset()
  mockSiteFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'stop' }) })
  ;(global as any).fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/commerce/local-fulfillment-options')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      optionRequests.push(body)
      const delivery = options['delivery'] as Record<string, unknown> | undefined
      return {
        ok: true,
        json: async () => ({
          ...options,
          ...(delivery && body.postalCode
            ? {
                delivery: {
                  ...delivery,
                  quote:
                    body.postalCode === '62704'
                      ? { zoneId: 'near', zoneName: 'Downtown', feeCents: 500, shortfallCents: 0 }
                      : { unavailable: `We don’t deliver to ${body.postalCode}.` },
                },
              }
            : {}),
        }),
      }
    }
    return {
      ok: true,
      json: async () => (String(url).startsWith('/api/commerce/cart-extras') ? { extras: [] } : CART),
    }
  })
})

function checkoutBody(): Record<string, unknown> {
  const call = mockSiteFetch.mock.calls.find(([url]) => url === '/api/commerce/cart-checkout')
  return JSON.parse(String(call?.[1]?.body ?? '{}'))
}

const PICKUP = [
  { id: 'main', name: 'Main Street', address: '1 Main St', hours: 'Mo-Fr 09:00-17:00', instructions: 'Side door' },
  { id: 'mill', name: 'Mill Road', address: '4 Mill Rd' },
]

describe('how the buyer gets the order (AGL-3624)', () => {
  it('asks nothing, and sends nothing, for a store that only ships', async () => {
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(checkoutBody()).not.toHaveProperty('fulfillment')
  })

  it('sends the pickup location the buyer chose, and shows its hours and instructions', async () => {
    options = { pickup: PICKUP, delivery: null }
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Pick up in store' }))
    expect(screen.getByText('1 Main St')).toBeTruthy()
    expect(screen.getByText('Mo-Fr 09:00-17:00')).toBeTruthy()
    expect(screen.getByText('Side door')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Pickup location' }))
    fireEvent.click(within(await screen.findByRole('listbox')).getByText('Mill Road'))
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    expect(checkoutBody().fulfillment).toEqual({ method: 'pickup', locationId: 'mill' })
  })

  it('quotes a postal code and holds checkout until a delivery time is chosen', async () => {
    options = {
      pickup: [],
      delivery: {
        country: 'US',
        needsAddress: false,
        windows: [{ id: '1700000000000', startMs: 1_700_000_000_000, endMs: 1_700_010_800_000, label: 'Tue, 9:00 AM – 12:00 PM' }],
      },
    }
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Local delivery' }))
    const checkout = screen.getByRole('button', { name: 'Checkout' }) as HTMLButtonElement
    expect(checkout.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Postal code' }), { target: { value: '90210' } })
    expect(await screen.findByText('We don’t deliver to 90210.', {}, { timeout: 2000 })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Postal code' }), { target: { value: '62704' } })
    expect(await screen.findByText('Delivery: $5.00', {}, { timeout: 2000 })).toBeTruthy()
    expect(checkout.disabled).toBe(true)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Delivery time' }))
    fireEvent.click(within(await screen.findByRole('listbox')).getByText('Tue, 9:00 AM – 12:00 PM'))
    await waitFor(() => expect(checkout.disabled).toBe(false))
    fireEvent.click(checkout)
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    expect(checkoutBody().fulfillment).toEqual({
      method: 'local_delivery',
      postalCode: '62704',
      windowStartMs: 1_700_000_000_000,
    })
    expect(checkoutBody()).not.toHaveProperty('feeCents')
  })

  it('offers a mobile number for texts only when the store can send them', async () => {
    options = { pickup: PICKUP.slice(0, 1), delivery: null, texts: true }
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Pick up at Main Street' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Mobile number (optional)' }), {
      target: { value: '217 555 0100' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    expect(checkoutBody().fulfillment).toEqual({ method: 'pickup', locationId: 'main', textPhone: '217 555 0100' })
  })

  it('asks the options again when checkout says the pickup location went away', async () => {
    options = { pickup: PICKUP, delivery: null }
    mockSiteFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'That pickup location is no longer available. Choose another.', fulfillmentChanged: 'pickup' }),
    })
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Pick up in store' }))
    const before = optionRequests.length
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }))
    expect(await screen.findByText('That pickup location is no longer available. Choose another.')).toBeTruthy()
    await waitFor(() => expect(optionRequests.length).toBeGreaterThan(before))
  })
})
