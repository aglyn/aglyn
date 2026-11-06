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
 * The terms of sale in the cart (AGL-4038): a cart holding card reader
 * hardware the platform's own store sells asks for the terms of sale and
 * business use, keeps Checkout off until both are ticked, and sends both. A
 * cart the server refuses for want of them shows the boxes with its sentence.
 * Any other cart shows and sends nothing. Checkout is mocked at `siteFetch`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'

let cart: Record<string, unknown> = {}

beforeEach(() => {
  cart = {
    lines: [{ productId: 'reader', quantity: 1, name: 'Pocket reader (M2)', unitAmountCents: 9_900 }],
    count: 1,
    subtotalCents: 9_900,
  }
  mockSiteFetch.mockReset()
  mockSiteFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'stop' }) })
  ;(global as any).fetch = jest.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith('/api/commerce/cart-extras') ? { extras: [] } : cart),
  }))
})

function checkoutBodies(): Array<Record<string, unknown>> {
  return mockSiteFetch.mock.calls
    .filter(([url]) => url === '/api/commerce/cart-checkout')
    .map((call) => JSON.parse(String(call?.[1]?.body ?? '{}')))
}

describe('the terms of sale in the cart (AGL-4038)', () => {
  it('asks for both boxes when the cart holds hardware, and sends them once ticked', async () => {
    cart = { ...cart, hardwareTerms: true }
    render(<Cart variant="inline" />)
    const checkout = (await screen.findByRole('button', { name: 'Checkout' })) as HTMLButtonElement
    expect(checkout.disabled).toBe(true)
    const link = screen.getByRole('link', { name: /hardware terms of sale \(Terms, Sections 4\.26–4\.32\)/ })
    expect(link.getAttribute('href')).toMatch(/\/legal\/terms$/)
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the/ }))
    expect(checkout.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /for use in my business/ }))
    expect(checkout.disabled).toBe(false)
    fireEvent.click(checkout)
    await waitFor(() => expect(checkoutBodies()).toHaveLength(1))
    expect(checkoutBodies()[0].hardwareTerms).toEqual({ accepted: true, businessUse: true })
  })

  it('shows the boxes with the server’s sentence when a checkout is refused for want of them', async () => {
    mockSiteFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'To buy card reader hardware, accept the hardware terms of sale.', needsHardwareTerms: true }),
    })
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout' }))
    expect(await screen.findByText('To buy card reader hardware, accept the hardware terms of sale.')).toBeTruthy()
    expect(screen.getByTestId('hardware-terms-consent')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Checkout' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows and sends nothing for any other cart', async () => {
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout' }))
    await waitFor(() => expect(checkoutBodies()).toHaveLength(1))
    expect(screen.queryByTestId('hardware-terms-consent')).toBeNull()
    expect(checkoutBodies()[0]).not.toHaveProperty('hardwareTerms')
  })
})
