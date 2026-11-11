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
 * The cart reads right while it loads, and asks where it ships up front:
 *
 * 1. Until the stored cart has been read it says it is loading, never "empty"
 *    (a cart with two items in it read as empty for as long as the read took).
 * 2. When the cart says checkout will need a destination, Ship to is shown
 *    with the other fields from the start, not after the first Checkout press.
 * 3. "Choose where you're shipping to." clears once a country is chosen.
 *
 * The cart read is mocked at `fetch`, checkout at `siteFetch`.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'

const EMPTY_TEXT = 'Your cart is empty. Card readers and accessories are in the shop.'
const LINES = {
  lines: [
    { productId: 'reader', quantity: 1, name: 'Pocket reader', unitAmountCents: 5_900 },
    { productId: 'stand', quantity: 1, name: 'Reader stand', unitAmountCents: 2_900 },
  ],
  count: 2,
  subtotalCents: 8_800,
}

let cart: Record<string, unknown> = {}
let releaseCart: (() => void) | null = null
let holdCart = false

beforeEach(() => {
  cart = { ...LINES }
  holdCart = false
  releaseCart = null
  mockSiteFetch.mockReset()
  mockSiteFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'stop' }) })
  ;(global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/commerce/cart-extras')) return { ok: true, json: async () => ({ extras: [] }) }
    if (holdCart) await new Promise<void>((resolve) => (releaseCart = resolve))
    return { ok: true, json: async () => cart }
  })
})

function checkoutBodies(): Array<Record<string, unknown>> {
  return mockSiteFetch.mock.calls
    .filter(([url]) => url === '/api/commerce/cart-checkout')
    .map((call) => JSON.parse(String(call?.[1]?.body ?? '{}')))
}

async function chooseShipTo(country: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Ship to/ }))
  fireEvent.click(within(await screen.findByRole('listbox')).getByText(country))
}

describe('while the stored cart is read', () => {
  it('says it is loading, never empty, until the lines arrive', async () => {
    holdCart = true
    render(<Cart variant="inline" emptyText={EMPTY_TEXT} />)
    expect(await screen.findByText('Loading your cart…')).toBeTruthy()
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull()
    await waitFor(() => expect(releaseCart).not.toBeNull())
    await act(async () => releaseCart?.())
    expect(await screen.findByText('Pocket reader')).toBeTruthy()
    expect(screen.queryByText('Loading your cart…')).toBeNull()
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull()
  })

  it('says empty once the cart truly is', async () => {
    cart = { lines: [], count: 0 }
    render(<Cart variant="inline" emptyText={EMPTY_TEXT} />)
    expect(await screen.findByText(EMPTY_TEXT)).toBeTruthy()
    expect(screen.queryByText('Loading your cart…')).toBeNull()
  })

  it('says it could not be read, not empty, when the read fails', async () => {
    ;(global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    render(<Cart variant="inline" emptyText={EMPTY_TEXT} />)
    expect(await screen.findByText('Your cart could not be loaded. Refresh the page to try again.')).toBeTruthy()
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull()
  })
})

describe('Ship to', () => {
  it('is shown from the start when the cart needs a destination, and Checkout waits for it', async () => {
    cart = { ...LINES, needsShippingCountry: true, shippingCountries: ['US', 'CA'] }
    render(<Cart variant="inline" />)
    const checkout = (await screen.findByRole('button', { name: 'Checkout' })) as HTMLButtonElement
    expect(screen.getByRole('combobox', { name: /Ship to/ })).toBeTruthy()
    expect(checkout.disabled).toBe(true)
    await chooseShipTo('Canada')
    expect(checkout.disabled).toBe(false)
    fireEvent.click(checkout)
    await waitFor(() => expect(checkoutBodies()).toHaveLength(1))
    expect(checkoutBodies()[0].shippingCountry).toBe('CA')
  })

  it('is not shown when the cart needs no destination', async () => {
    render(<Cart variant="inline" />)
    await screen.findByRole('button', { name: 'Checkout' })
    expect(screen.queryByRole('combobox', { name: /Ship to/ })).toBeNull()
  })

  it('clears "Choose where you’re shipping to." once a country is chosen', async () => {
    mockSiteFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Choose where you’re shipping to.',
        needsShippingCountry: true,
        shippingCountries: ['US', 'CA'],
      }),
    })
    render(<Cart variant="inline" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout' }))
    expect(await screen.findByText('Choose where you’re shipping to.')).toBeTruthy()
    await chooseShipTo('United States')
    expect(screen.queryByText('Choose where you’re shipping to.')).toBeNull()
    expect((screen.getByRole('button', { name: 'Checkout' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
