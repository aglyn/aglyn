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
 * Another plugin's way to pay in the cart (AGL-3630): drawn only when the
 * cart's server answer names one, sent as WHICH provider and never as an
 * amount, and a different attempt from the card checkout. A store with no
 * provider draws and sends exactly what it did. Checkout is mocked at
 * `siteFetch`; nothing reaches a processor.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'

const LINES = [{ productId: 'lamp', quantity: 1, name: 'Lamp', unitAmountCents: 10_000 }]
let cart: Record<string, unknown> = {}

beforeEach(() => {
  cart = { lines: LINES, count: 1, subtotalCents: 10_000 }
  mockSiteFetch.mockReset()
  mockSiteFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'stop' }) })
  ;(global as any).fetch = jest.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith('/api/commerce/cart-extras') ? { extras: [] } : cart),
  }))
})

const checkoutCalls = () => mockSiteFetch.mock.calls.filter(([url]) => url === '/api/commerce/cart-checkout')
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit)?.body ?? '{}'))
const keyOf = (call: unknown[]) => ((call[1] as RequestInit)?.headers as Record<string, string>)['Idempotency-Key']

describe('another way to pay in the cart (AGL-3630)', () => {
  it('draws no other button, and sends no provider, when the store offers none', async () => {
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(checkoutCalls()).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /Pay with/ })).toBeNull()
    expect(bodyOf(checkoutCalls()[0])).not.toHaveProperty('paymentProvider')
  })

  it('offers the provider beside Checkout, and sends which one', async () => {
    cart = { ...cart, paymentOptions: [{ providerId: 'paypal', label: 'PayPal', methods: ['PayPal', 'Venmo'] }] }
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay with PayPal or Venmo' }))
    await waitFor(() => expect(checkoutCalls()).toHaveLength(1))
    expect(bodyOf(checkoutCalls()[0])).toMatchObject({ hostId: 'host-1', paymentProvider: 'paypal' })
  })

  it('keeps the card checkout and the provider as separate attempts', async () => {
    cart = { ...cart, paymentOptions: [{ providerId: 'paypal', label: 'PayPal', methods: ['PayPal'] }] }
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay with PayPal' }))
    await waitFor(() => expect(checkoutCalls()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(checkoutCalls()).toHaveLength(2))
    const [provider, card] = checkoutCalls()
    expect(bodyOf(card)).not.toHaveProperty('paymentProvider')
    expect(keyOf(card)).not.toBe(keyOf(provider))
  })
})
