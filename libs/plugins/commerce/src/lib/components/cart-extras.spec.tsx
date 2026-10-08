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
 * The cart's optional lines (AGL-3635): an offer another plugin makes shows
 * as a box with its price, starts ticked only when the provider says so,
 * and the checkout sends WHICH offers were ticked — never a price. A store
 * with no offer shows nothing. Checkout is mocked at `siteFetch`; nothing
 * reaches Stripe.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'

const CART = {
  lines: [{ productId: 'lamp', quantity: 1, name: 'Lamp', unitAmountCents: 10_000 }],
  count: 1,
  subtotalCents: 10_000,
}

let offers: unknown[] = []

beforeEach(() => {
  offers = []
  mockSiteFetch.mockReset()
  mockSiteFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'stop' }) })
  ;(global as any).fetch = jest.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith('/api/commerce/cart-extras') ? { extras: offers } : CART),
  }))
})

function checkoutBody(): Record<string, unknown> {
  const call = mockSiteFetch.mock.calls.find(([url]) => url === '/api/commerce/cart-checkout')
  return JSON.parse(String(call?.[1]?.body ?? '{}'))
}

describe('the cart’s optional lines (AGL-3635)', () => {
  it('shows nothing, and sends nothing, when no plugin offers', async () => {
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    expect(screen.queryByRole('checkbox', { name: /protection/i })).toBeNull()
    expect(checkoutBody()).not.toHaveProperty('extras')
  })

  it('shows the offer with its price, ticked as the provider says, and sends its id when ticked', async () => {
    offers = [
      { id: 'post-purchase.package-protection', label: 'Package protection', description: 'Covers loss in transit.', amountCents: 198, defaultSelected: true },
    ]
    render(<Cart variant="inline" />)
    const box = (await screen.findByRole('checkbox', { name: 'Package protection ($1.98)' })) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(screen.getByText('Covers loss in transit.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    expect(checkoutBody().extras).toEqual(['post-purchase.package-protection'])
  })

  it('sends nothing for an offer the buyer unticked', async () => {
    offers = [{ id: 'post-purchase.package-protection', label: 'Package protection', amountCents: 198, defaultSelected: true }]
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Package protection ($1.98)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    expect(checkoutBody()).not.toHaveProperty('extras')
  })
})
