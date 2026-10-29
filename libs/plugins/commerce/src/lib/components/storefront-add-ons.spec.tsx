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
 * One product page configures a canopy (AGL-4100): the size is the variant,
 * the frame (required) and walls are add-ons, the back wall dearer on the
 * large size. The page offers each group as a picker with its prices, shows
 * the configured price live, and will not add to the cart or buy until the
 * required frame is chosen. What it sends is ids; the server prices them.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProductDetail, { productPageAddOns } from './product-detail'

const mockSite: { hostId: string; pageData?: unknown } = { hostId: 'host-1' }

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => mockSite,
}))

const fetchMock = jest.fn()

const CANOPY = {
  id: 'canopy',
  name: 'Canopy',
  slug: 'canopy',
  type: 'physical',
  mediaUrls: [],
  options: [{ name: 'Size', values: ['10x10', '10x20'] }],
  variants: [
    { id: 'small', options: { Size: '10x10' }, priceUsd: 900, soldOut: false },
    { id: 'large', options: { Size: '10x20' }, priceUsd: 1400, soldOut: false },
  ],
  modifierGroups: [
    {
      id: 'frame',
      name: 'Frame',
      min: 1,
      max: 1,
      options: [
        { id: 'steel', name: 'Steel frame', priceCents: 0 },
        { id: 'alu', name: 'Aluminum frame', priceCents: 20000 },
      ],
    },
    {
      id: 'walls',
      name: 'Walls',
      min: 0,
      max: 2,
      options: [
        { id: 'back', name: 'Back wall', priceCents: 9000, priceCentsByVariant: { large: 15000 } },
        { id: 'side', name: 'Side wall', priceCents: 7500 },
      ],
    },
  ],
}

beforeEach(() => {
  mockSite.hostId = 'host-1'
  mockSite.pageData = { commerce: { product: CANOPY } }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) =>
    String(url) === '/api/commerce/cart'
      ? { ok: true, status: 200, json: async () => ({ lines: [], count: 1 }) }
      : { ok: false, status: 404, json: async () => ({}) },
  )
  ;(global as any).fetch = fetchMock
})

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

async function choose(label: RegExp, option: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: label }))
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option))
}

describe('the page’s add-ons, checked and priced as the server will', () => {
  it('is ready only once every required group is answered, and adds each pick on the variant', () => {
    expect(productPageAddOns(CANOPY, [], 'small')).toEqual({
      ready: false,
      extraCents: 0,
      error: 'Choose frame for Canopy.',
    })
    expect(
      productPageAddOns(
        CANOPY,
        [
          { groupId: 'frame', optionId: 'alu' },
          { groupId: 'walls', optionId: 'back' },
        ],
        'large',
      ),
    ).toEqual({ ready: true, extraCents: 35000 })
    expect(productPageAddOns({ name: 'Mug' }, [], 'default')).toEqual({ ready: true, extraCents: 0 })
  })
})

describe('a product page with add-ons', () => {
  it('offers each group with its prices and marks the required one', async () => {
    render(<ProductDetail />)
    const frame = await screen.findByRole('combobox', { name: /Frame/ })
    expect(frame.closest('.MuiFormControl-root')?.querySelector('.MuiFormLabel-asterisk')).toBeTruthy()
    fireEvent.mouseDown(frame)
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByText('Aluminum frame (+$200.00)')).toBeTruthy()
    expect(within(listbox).queryByText('None')).toBeNull()
    fireEvent.keyDown(listbox, { key: 'Escape' })
    // Several choices: checkboxes, each with what it adds on this size.
    expect(screen.getByRole('checkbox', { name: 'Back wall (+$90.00)' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Side wall (+$75.00)' })).toBeTruthy()
  })

  it('refuses Add to cart and Buy now until the frame is chosen, and says what is missing', async () => {
    render(<ProductDetail />)
    await screen.findByRole('combobox', { name: /Frame/ })
    expect(button('Add to cart').disabled).toBe(true)
    expect(button('Buy now').disabled).toBe(true)
    expect(screen.getByText('Choose frame for Canopy.')).toBeTruthy()
    fireEvent.click(button('Add to cart'))
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/commerce/cart')).toBe(false)

    await choose(/Frame/, 'Steel frame')
    expect(button('Add to cart').disabled).toBe(false)
    expect(screen.queryByText('Choose frame for Canopy.')).toBeNull()
  })

  it('shows the configured price live: the variant plus its add-ons, times the quantity, in dollars and cents', async () => {
    render(<ProductDetail />)
    await screen.findByRole('combobox', { name: /Frame/ })
    expect(screen.getByText('$900.00')).toBeTruthy()
    expect(screen.getByText('Total: $900.00')).toBeTruthy()

    await choose(/Frame/, 'Aluminum frame (+$200.00)')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Back wall (+$90.00)' }))
    expect(screen.getByText('Total: $1,190.00')).toBeTruthy()

    // On the large size the back wall costs more.
    await choose(/^Size/, '10x20')
    expect(screen.getByRole('checkbox', { name: 'Back wall (+$150.00)' })).toBeTruthy()
    expect(screen.getByText('$1,750.00')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '2' } })
    expect(screen.getByText('Total for 2: $3,500.00')).toBeTruthy()
  })

  it('sends the picks as ids with the line, never a price', async () => {
    render(<ProductDetail />)
    await choose(/Frame/, 'Aluminum frame (+$200.00)')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Side wall (+$75.00)' }))
    await act(async () => {
      fireEvent.click(button('Add to cart'))
    })
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[0] === '/api/commerce/cart')).toBe(true))
    const cartCall = fetchMock.mock.calls.find((call) => call[0] === '/api/commerce/cart')
    expect(JSON.parse(cartCall?.[1]?.body)).toEqual({
      hostId: 'host-1',
      action: 'add',
      productId: 'canopy',
      variantId: 'small',
      quantity: 1,
      modifiers: [
        { groupId: 'frame', optionId: 'alu' },
        { groupId: 'walls', optionId: 'side' },
      ],
    })
  })

  it('shows the cart’s refusal when the server turns the line away', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url) === '/api/commerce/cart'
        ? { ok: false, status: 400, json: async () => ({ error: 'A choice on Canopy is no longer offered. Remove it and add it again.' }) }
        : { ok: false, status: 404, json: async () => ({}) },
    )
    render(<ProductDetail />)
    await choose(/Frame/, 'Steel frame')
    await act(async () => {
      fireEvent.click(button('Add to cart'))
    })
    expect(await screen.findByText(/no longer offered/)).toBeTruthy()
  })

  it('leaves a product without add-ons as it was, its price in dollars and cents', async () => {
    mockSite.pageData = {
      commerce: {
        product: { ...CANOPY, modifierGroups: undefined, variants: [{ ...CANOPY.variants[0], priceUsd: 29.5 }], options: [] },
      },
    }
    render(<ProductDetail />)
    expect(screen.getByText('$29.50')).toBeTruthy()
    expect(screen.queryByText(/^Total/)).toBeNull()
    expect(button('Add to cart').disabled).toBe(false)
  })
})
