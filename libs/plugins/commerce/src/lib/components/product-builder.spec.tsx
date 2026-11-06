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
 * The product builder (AGL-4205): a Product detail block set to show its
 * choices as picture cards. A canopy's size is the variant, its frame a
 * required add-on, its walls optional, and a weekend kit a combo. Each card
 * shows its picture, price and note; the total follows the picks; a combo
 * opens to show what it includes. A product that offers a free mockup opens
 * the request form dropped into the block, and the form's Product and
 * options field posts the shopper's picks.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProductDetail from './product-detail'
import { MOCKUP_LABEL_DEFAULT, productBuilderPicks } from './product-builder-mockup'
import { addOnPriceLabel, pressChoice, variantForOptionValue } from './product-choice-cards'
import ProductOptionsField from './product-options-field'
import { builderFieldValue } from './product-options-field-body'
import { parseProductFieldValue, quoteLinesFromFieldData } from '../model/commerce-quote-request'

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
    {
      id: 'small',
      options: { Size: '10x10' },
      priceUsd: 900,
      soldOut: false,
      imageUrl: 'https://cdn.example/small.jpg',
      note: 'Fits two tables',
    },
    { id: 'large', options: { Size: '10x20' }, priceUsd: 1400, soldOut: false, note: 'Fits a booth' },
  ],
  modifierGroups: [
    {
      id: 'frame',
      name: 'Frame',
      min: 1,
      max: 1,
      online: true,
      options: [
        { id: 'steel', name: 'Steel frame', priceCents: 0 },
        { id: 'alu', name: 'Aluminum frame', priceCents: 20000, note: 'Half the weight' },
      ],
    },
    {
      id: 'walls',
      name: 'Walls',
      min: 0,
      max: 2,
      online: true,
      options: [
        { id: 'back', name: 'Back wall', priceCents: 9000, priceCentsByVariant: { large: 15000 } },
        { id: 'side', name: 'Side wall', priceCents: 7500 },
        {
          id: 'kit',
          name: 'Weekend kit',
          priceCents: 19900,
          includes: ['Side wall ×2', 'Weights ×4', 'Carry bag'],
        },
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

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const card = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLElement
const box = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLElement

describe('the cards’ rules', () => {
  const walls = CANOPY.modifierGroups[1]
  const frame = CANOPY.modifierGroups[0]

  it('acts as radio buttons for a one-choice group: an optional one clears, a required one stays', () => {
    expect(pressChoice(frame, [], 'alu')).toEqual(['alu'])
    expect(pressChoice(frame, ['steel'], 'alu')).toEqual(['alu'])
    expect(pressChoice(frame, ['alu'], 'alu')).toEqual(['alu'])
    expect(pressChoice({ ...frame, min: 0 }, ['alu'], 'alu')).toEqual([])
  })

  it('adds and removes in a several-choice group, in the group’s order, never past its maximum', () => {
    expect(pressChoice(walls, ['side'], 'back')).toEqual(['back', 'side'])
    expect(pressChoice(walls, ['back', 'side'], 'kit')).toEqual(['back', 'side'])
    expect(pressChoice(walls, ['back', 'side'], 'back')).toEqual(['side'])
  })

  it('stands a size’s card for the variant the other picks make, else the first with that size', () => {
    const variants = [
      { id: 'a', options: { Size: 'S', Color: 'Red' }, priceUsd: 1 },
      { id: 'b', options: { Size: 'S', Color: 'Blue' }, priceUsd: 2 },
      { id: 'c', options: { Size: 'L', Color: 'Red' }, priceUsd: 3 },
    ]
    expect(variantForOptionValue(variants, { Size: 'L', Color: 'Blue' }, 'Size', 'S')?.id).toBe('b')
    expect(variantForOptionValue(variants, { Size: 'S', Color: 'Blue' }, 'Size', 'L')?.id).toBe('c')
  })

  it('says what a choice adds, or that it adds nothing', () => {
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
    expect(addOnPriceLabel(4500, money)).toBe('+$45.00')
    expect(addOnPriceLabel(0, money)).toBe('No extra charge')
  })
})

describe('a product page that shows its choices as picture cards', () => {
  it('draws a card per size and per add-on, each with its price and note, and marks the required group', async () => {
    render(<ProductDetail choiceStyle="cards" />)
    const small = await waitFor(() => card(/10x10/))
    expect(small.getAttribute('aria-checked')).toBe('true')
    expect(within(small).getByText('$900.00')).toBeTruthy()
    expect(within(small).getByText('Fits two tables')).toBeTruthy()
    expect(small.querySelector('img')).toBeTruthy()
    expect(within(card(/10x20/)).getByText('$1,400.00')).toBeTruthy()
    expect(within(card(/Aluminum frame/)).getByText('+$200.00')).toBeTruthy()
    expect(within(card(/Steel frame/)).getByText('No extra charge')).toBeTruthy()
    expect(within(box(/Back wall/)).getByText('+$90.00')).toBeTruthy()
    // The required group says so, the optional one how many it takes.
    // The size and the frame each take one.
    expect(screen.getAllByText('Choose one')).toHaveLength(2)
    expect(screen.getByText('Choose up to 2')).toBeTruthy()
    // No menus in this style.
    expect(screen.queryByRole('combobox', { name: /Frame/ })).toBeNull()
  })

  it('keeps the live total: the size plus its add-ons, times the quantity', async () => {
    render(<ProductDetail choiceStyle="cards" />)
    await waitFor(() => card(/10x10/))
    expect(screen.getByText('Total: $900.00')).toBeTruthy()
    fireEvent.click(card(/Aluminum frame/))
    fireEvent.click(box(/Back wall/))
    expect(screen.getByText('Total: $1,190.00')).toBeTruthy()
    // The large size: its own price, and the back wall at its price there.
    fireEvent.click(card(/10x20/))
    expect(card(/10x20/).getAttribute('aria-checked')).toBe('true')
    expect(within(box(/Back wall/)).getByText('+$150.00')).toBeTruthy()
    expect(screen.getByText('Total: $1,750.00')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '2' } })
    expect(screen.getByText('Total for 2: $3,500.00')).toBeTruthy()
  })

  it('folds a combo’s contents out on its card', async () => {
    render(<ProductDetail choiceStyle="cards" />)
    await waitFor(() => box(/Weekend kit/))
    expect(screen.getByText('Combo')).toBeTruthy()
    const open = button('What’s included')
    expect(open.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(open)
    const list = screen.getByRole('list', { name: 'Weekend kit includes' })
    expect(within(list).getByText('Weights ×4')).toBeTruthy()
    expect(button('Hide what’s included').getAttribute('aria-expanded')).toBe('true')
  })

  it('stops a several-choice group at its maximum', async () => {
    render(<ProductDetail choiceStyle="cards" />)
    await waitFor(() => box(/Back wall/))
    fireEvent.click(box(/Back wall/))
    fireEvent.click(box(/Side wall/))
    expect(box(/Weekend kit/).hasAttribute('disabled') || box(/Weekend kit/).getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.click(box(/Side wall/))
    expect(box(/Weekend kit/).hasAttribute('disabled')).toBe(false)
  })

  it('still sells a priced product: refused until the frame is picked, then sent to the cart as ids', async () => {
    render(<ProductDetail choiceStyle="cards" />)
    await waitFor(() => card(/Steel frame/))
    expect(button('Add to cart').disabled).toBe(true)
    expect(screen.getByText('Choose frame for Canopy.')).toBeTruthy()
    fireEvent.click(card(/Steel frame/))
    fireEvent.click(box(/Weekend kit/))
    expect(button('Add to cart').disabled).toBe(false)
    await act(async () => {
      fireEvent.click(button('Add to cart'))
    })
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[0] === '/api/commerce/cart')).toBe(true))
    const cartCall = fetchMock.mock.calls.find((call) => call[0] === '/api/commerce/cart')
    expect(JSON.parse(cartCall?.[1]?.body)).toMatchObject({
      productId: 'canopy',
      variantId: 'small',
      modifiers: [
        { groupId: 'frame', optionId: 'steel' },
        { groupId: 'walls', optionId: 'kit' },
      ],
    })
  })

  it('leaves a block without the setting on its menus', async () => {
    render(<ProductDetail />)
    expect(await screen.findByRole('combobox', { name: /Frame/ })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Steel frame/ })).toBeNull()
  })
})

describe('a free mockup', () => {
  const offering = { ...CANOPY, mockupRequests: true }
  const requestForm = (
    <form aria-label="Mockup request">
      <ProductOptionsField name="product" label="Your canopy" required />
    </form>
  )

  it('is not offered by a product that has not switched it on, nor where the block holds no form', async () => {
    const { unmount } = render(<ProductDetail choiceStyle="cards">{requestForm}</ProductDetail>)
    await waitFor(() => card(/10x10/))
    expect(screen.queryByRole('button', { name: MOCKUP_LABEL_DEFAULT })).toBeNull()
    expect(screen.queryByRole('form', { name: 'Mockup request' })).toBeNull()
    unmount()

    mockSite.pageData = { commerce: { product: offering } }
    render(<ProductDetail choiceStyle="cards" />)
    await waitFor(() => card(/10x10/))
    expect(screen.queryByRole('button', { name: MOCKUP_LABEL_DEFAULT })).toBeNull()
  })

  it('opens the request form with the shopper’s picks, add-ons and quantity, ready for a quote', async () => {
    mockSite.pageData = { commerce: { product: offering } }
    const { container } = render(
      <ProductDetail choiceStyle="cards" mockupLabel="Send me a mockup">
        {requestForm}
      </ProductDetail>,
    )
    await waitFor(() => card(/10x10/))
    const open = button('Send me a mockup')
    expect(open.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(open)
    expect(open.getAttribute('aria-expanded')).toBe('true')

    // Nothing is posted until the required frame is picked; the field says so.
    expect(await screen.findByText('Choose frame for Canopy.', { selector: 'p.MuiFormHelperText-root' })).toBeTruthy()
    const answer = () => container.querySelector('input[name="product"]') as HTMLInputElement
    const data = () => container.querySelector('input[name="product__data"]') as HTMLInputElement | null
    expect(answer().value).toBe('')
    expect(data()).toBeNull()

    fireEvent.click(card(/10x20/))
    fireEvent.click(card(/Aluminum frame/))
    fireEvent.click(box(/Weekend kit/))
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '2' } })

    await waitFor(() => expect(answer().value).toBe('Canopy — 10x20 + Aluminum frame, Weekend kit × 2'))
    const value = parseProductFieldValue(data()?.value)
    expect(value).toEqual({
      productId: 'canopy',
      variantId: 'large',
      options: { Size: '10x20' },
      modifiers: [
        { groupId: 'frame', optionId: 'alu' },
        { groupId: 'walls', optionId: 'kit' },
      ],
      quantity: 2,
    })
    // "Start a quote" on the request begins with that line.
    expect(quoteLinesFromFieldData({ product__data: data()?.value ?? '' })).toEqual([
      {
        kind: 'catalog',
        productId: 'canopy',
        variantId: 'large',
        quantity: 2,
        modifiers: [
          { groupId: 'frame', optionId: 'alu' },
          { groupId: 'walls', optionId: 'kit' },
        ],
      },
    ])
    expect(screen.getByText('Total: $3,598.00')).toBeTruthy()
  })

  it('offers it on a product with no price yet, where only a request can be made', async () => {
    mockSite.pageData = {
      commerce: {
        product: {
          ...offering,
          variants: offering.variants.map((variant) => ({ ...variant, priceUsd: null })),
        },
      },
    }
    render(<ProductDetail choiceStyle="cards">{requestForm}</ProductDetail>)
    await waitFor(() => card(/10x10/))
    expect(within(card(/10x10/)).getByText('Price coming soon')).toBeTruthy()
    // The add-ons still show, since the request carries them.
    expect(card(/Aluminum frame/)).toBeTruthy()
    expect(button(MOCKUP_LABEL_DEFAULT)).toBeTruthy()
  })
})

describe('a bulk order on a quantity tier (AGL-4205)', () => {
  // Shirts priced by how many: the tier is an option, the count is the quantity.
  const SHIRTS = {
    id: 'shirts',
    name: 'Custom shirts',
    slug: 'custom-shirts',
    type: 'physical',
    mediaUrls: [],
    options: [{ name: 'How many', values: ['24 to 99', '100 or more'] }],
    variants: [
      { id: 'small-run', options: { 'How many': '24 to 99' }, priceUsd: 12, soldOut: false },
      { id: 'bulk', options: { 'How many': '100 or more' }, priceUsd: 9, soldOut: false },
    ],
    modifierGroups: [
      {
        id: 'print',
        name: 'Print',
        min: 1,
        max: 1,
        online: true,
        options: [{ id: 'front', name: 'Front print', priceCents: 250 }],
      },
    ],
    mockupRequests: true,
  }
  const requestForm = (
    <form aria-label="Mockup request">
      <ProductOptionsField name="product" label="Your shirts" required />
    </form>
  )

  it('prices 150 on the "100 or more" tier, sends all 150 to the cart, and carries 150 into the quote', async () => {
    mockSite.pageData = { commerce: { product: SHIRTS } }
    const { container } = render(<ProductDetail choiceStyle="cards">{requestForm}</ProductDetail>)
    await waitFor(() => card(/100 or more/))
    fireEvent.click(card(/100 or more/))
    fireEvent.click(card(/Front print/))
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '150' } })
    expect((screen.getByLabelText('Qty') as HTMLInputElement).value).toBe('150')
    // ($9.00 + $2.50) × 150.
    expect(screen.getByText('Total for 150: $1,725.00')).toBeTruthy()

    fireEvent.click(button(MOCKUP_LABEL_DEFAULT))
    const data = () => container.querySelector('input[name="product__data"]') as HTMLInputElement | null
    await waitFor(() => expect(parseProductFieldValue(data()?.value)?.quantity).toBe(150))
    expect(quoteLinesFromFieldData({ product__data: data()?.value ?? '' })[0]).toMatchObject({
      variantId: 'bulk',
      quantity: 150,
    })

    await act(async () => {
      fireEvent.click(button('Add to cart'))
    })
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[0] === '/api/commerce/cart')).toBe(true))
    const cartCall = fetchMock.mock.calls.find((call) => call[0] === '/api/commerce/cart')
    expect(JSON.parse(cartCall?.[1]?.body)).toMatchObject({ variantId: 'bulk', quantity: 150 })
  })

  it('stops a line at 9,999, the same ceiling a quote line has', async () => {
    mockSite.pageData = { commerce: { product: SHIRTS } }
    render(<ProductDetail choiceStyle="cards" />)
    await waitFor(() => card(/100 or more/))
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '25000' } })
    expect((screen.getByLabelText('Qty') as HTMLInputElement).value).toBe('9999')
  })
})

describe('the picks a request form reads', () => {
  it('names the product, the variant, the add-ons in group order and the quantity', () => {
    const picks = productBuilderPicks({
      product: CANOPY as any,
      variant: CANOPY.variants[1],
      addOns: [
        { groupId: 'frame', optionId: 'alu' },
        { groupId: 'walls', optionId: 'side' },
      ],
      quantity: 3,
      ready: true,
      total: '$5,000.00',
    })
    expect(picks).toEqual({
      productId: 'canopy',
      productName: 'Canopy',
      variantId: 'large',
      options: { Size: '10x20' },
      modifiers: [
        { groupId: 'frame', optionId: 'alu' },
        { groupId: 'walls', optionId: 'side' },
      ],
      addOnNames: ['Aluminum frame', 'Side wall'],
      quantity: 3,
      ready: true,
      total: '$5,000.00',
    })
    expect(builderFieldValue(picks).answer).toBe('Canopy — 10x20 + Aluminum frame, Side wall × 3')
  })

  it('leaves a one-variant product’s default variant off, and posts nothing until ready', () => {
    const picks = productBuilderPicks({
      product: { id: 'mug', name: 'Mug' },
      variant: { id: 'default' },
      addOns: [],
      quantity: 1,
      ready: false,
      problem: 'Choose a lid for Mug.',
    })
    expect(picks.variantId).toBeUndefined()
    expect(builderFieldValue(picks)).toEqual({ answer: '', value: '' })
    expect(builderFieldValue({ ...picks, ready: true })).toEqual({
      answer: 'Mug',
      value: JSON.stringify({ productId: 'mug' }),
    })
  })
})
