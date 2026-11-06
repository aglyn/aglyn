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
 * The product builder's data (AGL-4205): a choice's or a variant's picture
 * and note, a combo's contents, the free-mockup switch, and the quantity a
 * request carries into a quote. What the product page is sent of them.
 */

import { liftLegacyProduct, validateProduct, type HostProduct } from '../model/commerce'
import {
  builderPicksLabel,
  encodeProductFieldValue,
  parseProductFieldValue,
  quoteLinesFromFieldData,
} from '../model/commerce-quote-request'
import {
  choiceCardProblem,
  comboIncludesProblem,
  modifierGroupsProblem,
  modifierOptionIsCombo,
  PRODUCT_CHOICE_NOTE_MAX,
  PRODUCT_COMBO_MAX_ITEMS,
  type ProductModifierGroup,
} from '../model/product-modifiers'
import { publicModifierGroups, toPublicProductDetail } from './product'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

const walls = (option: Record<string, unknown>): ProductModifierGroup[] => [
  {
    id: 'walls',
    name: 'Walls',
    min: 0,
    max: 1,
    online: true,
    options: [{ id: 'kit', name: 'Weekend kit', priceCents: 19_900, ...option }],
  },
]

const canopy = (patch: Partial<HostProduct> = {}): HostProduct =>
  ({
    name: 'Canopy',
    slug: 'canopy',
    type: 'physical',
    status: 'active',
    options: [{ name: 'Size', values: ['10x10'] }],
    variants: [{ id: 'small', options: { Size: '10x10' }, priceUsd: 900 }],
    ...patch,
  }) as HostProduct

describe('a choice’s card', () => {
  it('saves a picture, a note and a combo’s contents', () => {
    expect(
      modifierGroupsProblem(
        walls({
          imageUrl: 'https://cdn.example/kit.jpg',
          note: 'Everything for a windy weekend',
          includes: ['Side wall ×2', 'Weights ×4'],
        }),
      ),
    ).toBeNull()
  })

  it('refuses a note past its length, a combo past its items, and an unnamed item, saying which', () => {
    expect(modifierGroupsProblem(walls({ note: 'x'.repeat(PRODUCT_CHOICE_NOTE_MAX + 1) }))).toBe(
      `Keep the note on “Weekend kit” to ${PRODUCT_CHOICE_NOTE_MAX} characters`,
    )
    expect(
      modifierGroupsProblem(walls({ includes: Array.from({ length: PRODUCT_COMBO_MAX_ITEMS + 1 }, (_, i) => `Item ${i}`) })),
    ).toBe(`“Weekend kit” lists more than ${PRODUCT_COMBO_MAX_ITEMS} items`)
    expect(modifierGroupsProblem(walls({ includes: ['Bag', '  '] }))).toBe('Name every item “Weekend kit” includes')
    expect(modifierGroupsProblem(walls({ imageUrl: 42 }))).toBe('Choose the picture for “Weekend kit” again')
    expect(comboIncludesProblem('Bag', 'Kit')).toBe('What “Kit” includes must be a list')
    expect(choiceCardProblem({ note: 5 }, 'Kit')).toBe('The note on “Kit” must be text')
  })

  it('is a combo only when it lists what it includes', () => {
    expect(modifierOptionIsCombo({ includes: ['Bag'] })).toBe(true)
    expect(modifierOptionIsCombo({ includes: [] })).toBe(false)
    expect(modifierOptionIsCombo({})).toBe(false)
  })
})

describe('a product with picture cards and a free mockup', () => {
  it('saves a variant’s note and the mockup switch, and refuses a note past its length', () => {
    expect(
      validateProduct(
        canopy({
          mockupRequests: true,
          variants: [{ id: 'small', options: { Size: '10x10' }, priceUsd: 900, note: 'Fits two tables' }],
        }),
      ),
    ).toBeNull()
    expect(
      validateProduct(
        canopy({
          variants: [{ id: 'small', options: { Size: '10x10' }, priceUsd: 900, note: 'x'.repeat(PRODUCT_CHOICE_NOTE_MAX + 1) }],
        }),
      ),
    ).toBe(`Keep the note on “10x10” to ${PRODUCT_CHOICE_NOTE_MAX} characters`)
    expect(validateProduct(canopy({ mockupRequests: 'yes' as unknown as boolean }))).toBe(
      'Offering a free mockup is on or off',
    )
  })

  it('sends the page every card’s picture, note and contents, and the mockup switch only when on', () => {
    const product = liftLegacyProduct(
      canopy({
        mockupRequests: true,
        variants: [{ id: 'small', options: { Size: '10x10' }, priceUsd: 900, note: ' Fits two tables ' }],
        modifierGroups: walls({ imageUrl: 'https://cdn.example/kit.jpg', note: 'Windy days', includes: ['Bag'] }),
      }),
    )
    const detail = toPublicProductDetail('canopy', product)
    expect(detail.mockupRequests).toBe(true)
    expect(detail.variants[0].note).toBe('Fits two tables')
    expect(detail.modifierGroups?.[0].options[0]).toEqual({
      id: 'kit',
      name: 'Weekend kit',
      priceCents: 19_900,
      imageUrl: 'https://cdn.example/kit.jpg',
      note: 'Windy days',
      includes: ['Bag'],
    })
    const plain = toPublicProductDetail('canopy', liftLegacyProduct(canopy({ mockupRequests: false })))
    expect('mockupRequests' in plain).toBe(false)
    expect('note' in plain.variants[0]).toBe(false)
    expect(publicModifierGroups({ modifierGroups: walls({ includes: [] }) })[0].options[0]).toEqual({
      id: 'kit',
      name: 'Weekend kit',
      priceCents: 19_900,
    })
  })
})

describe('the quantity a request carries into a quote', () => {
  it('rides the field’s value and starts the quote’s line', () => {
    const raw = encodeProductFieldValue({ productId: 'canopy', variantId: 'small', quantity: 3 })
    expect(parseProductFieldValue(raw)).toEqual({ productId: 'canopy', variantId: 'small', quantity: 3 })
    expect(quoteLinesFromFieldData({ product__data: raw })).toEqual([
      { kind: 'catalog', productId: 'canopy', variantId: 'small', quantity: 3 },
    ])
  })

  it('reads one for none, and caps or ignores a quantity that is not a whole number from 1', () => {
    expect(encodeProductFieldValue({ productId: 'canopy', quantity: 1 })).toBe('{"productId":"canopy"}')
    const parsed = (quantity: unknown) => parseProductFieldValue(JSON.stringify({ productId: 'canopy', quantity }))
    expect(parsed(500)?.quantity).toBe(500)
    expect(parsed(50_000)?.quantity).toBe(9_999)
    expect(parsed('4')?.quantity).toBe(4)
    expect(parsed(0)?.quantity).toBeUndefined()
    expect(parsed(2.5)?.quantity).toBeUndefined()
    expect(quoteLinesFromFieldData({ product__data: JSON.stringify({ productId: 'canopy' }) })[0].quantity).toBe(1)
  })

  it('reads in words: the product, its options, its add-ons and how many', () => {
    expect(builderPicksLabel('Canopy', { Size: '10x20' }, ['Full wall', 'Printed roof'], 2)).toBe(
      'Canopy — 10x20 + Full wall, Printed roof × 2',
    )
    expect(builderPicksLabel('Canopy', undefined, [])).toBe('Canopy')
  })
})
