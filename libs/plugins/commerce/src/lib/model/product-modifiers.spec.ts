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

import {
  cartLineModifierProblem,
  decodeModifierSelection,
  encodeModifierSelection,
  lineLabelWithModifiers,
  modifierGroupsProblem,
  modifierOptionPriceCents,
  modifierSelectionFrom,
  modifierSelectionKey,
  modifierSelectionOf,
  productModifierGroups,
  resolveLineModifiers,
  resolveWebsiteLineModifiers,
  soldLineModifiers,
  websiteModifierGroups,
  websiteModifiersRequired,
  type ProductModifierGroup,
} from './product-modifiers'
import { validateProduct } from './commerce'

const MILK: ProductModifierGroup = {
  id: 'milk',
  name: 'Milk',
  min: 1,
  max: 1,
  options: [
    { id: 'whole', name: 'Whole', priceCents: 0 },
    { id: 'oat', name: 'Oat', priceCents: 75 },
  ],
}

describe('modifier groups a product may save (AGL-3607)', () => {
  it('accepts none, and a well-formed group', () => {
    expect(modifierGroupsProblem(undefined)).toBeNull()
    expect(modifierGroupsProblem([MILK])).toBeNull()
  })

  it.each([
    [[{ ...MILK, name: ' ' }], 'Name every modifier group'],
    [[{ ...MILK, options: [] }], 'Add a choice'],
    [[{ ...MILK, max: 3 }], 'allows 1 to 2'],
    [[{ ...MILK, min: 2, max: 1 }], 'requires more choices'],
    [[{ ...MILK, options: [{ id: 'a', name: 'A', priceCents: -1 }] }], 'price of $0'],
    [[{ ...MILK, options: [{ id: 'a', name: 'A', priceCents: 1.5 }] }], 'price of $0'],
    [[MILK, MILK], 'unique ids'],
  ])('refuses %j', (groups, message) => {
    expect(modifierGroupsProblem(groups)).toContain(message)
  })

  it('blocks a product save with a broken group', () => {
    const product = {
      name: 'Latte',
      slug: 'latte',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 4 }],
      modifierGroups: [{ ...MILK, name: '' }],
    } as any
    expect(validateProduct(product)).toBe('Name every modifier group')
  })

  it('reads a malformed list as no groups rather than half of one', () => {
    expect(productModifierGroups({ modifierGroups: [{ ...MILK, options: [] }] })).toEqual([])
  })
})

describe('resolving a line', () => {
  const product = { name: 'Latte', modifierGroups: [MILK] }

  it('prices from the product and keeps group order', () => {
    expect(resolveLineModifiers(product, [{ groupId: 'milk', optionId: 'oat', priceCents: 0 }])).toEqual({
      ok: true,
      modifiers: [{ groupId: 'milk', optionId: 'oat', group: 'Milk', name: 'Oat', priceCents: 75 }],
      extraCents: 75,
    })
  })

  it('needs the required group', () => {
    expect(resolveLineModifiers(product, []).error).toBe('Choose milk for Latte.')
  })

  it('labels and keys lines by their choices, in any order', () => {
    expect(lineLabelWithModifiers('Large', [{ name: 'Oat' }, { name: 'Extra shot' }])).toBe(
      'Large / Oat, Extra shot',
    )
    expect(lineLabelWithModifiers(undefined, [])).toBe('')
    expect(
      modifierSelectionKey([
        { groupId: 'b', optionId: '1' },
        { groupId: 'a', optionId: '2' },
      ]),
    ).toBe(modifierSelectionKey([
      { groupId: 'a', optionId: '2' },
      { groupId: 'b', optionId: '1' },
    ]))
  })
})

/*
 * Add-ons on the website (AGL-4100): a canopy sold as one product page — the
 * size is the variant, the frame, walls and printing are add-ons — with walls
 * that cost more on the larger size.
 */
const FRAME: ProductModifierGroup = {
  id: 'frame',
  name: 'Frame',
  min: 1,
  max: 1,
  online: true,
  options: [
    { id: 'steel', name: 'Steel frame', priceCents: 0 },
    { id: 'alu', name: 'Aluminum frame', priceCents: 20_000, priceCentsByVariant: { '10x20': 30_000 } },
  ],
}
const WALLS: ProductModifierGroup = {
  id: 'walls',
  name: 'Walls',
  min: 0,
  max: 2,
  online: true,
  options: [
    { id: 'back', name: 'Back wall', priceCents: 9_000, priceCentsByVariant: { '10x20': 15_000 } },
    { id: 'side', name: 'Side wall', priceCents: 7_500 },
  ],
}
/** A register-only group, required at the counter: never the shopper's to answer. */
const STAKES: ProductModifierGroup = {
  id: 'stakes',
  name: 'Stakes',
  min: 1,
  max: 1,
  options: [{ id: 'kit', name: 'Stake kit', priceCents: 1_500 }],
}
const CANOPY = { name: 'Canopy', modifierGroups: [FRAME, WALLS, STAKES] }

describe('a choice priced by variant (AGL-4100)', () => {
  it('adds its price on the variant picked, and its own price elsewhere', () => {
    expect(modifierOptionPriceCents(WALLS.options[0], '10x20')).toBe(15_000)
    expect(modifierOptionPriceCents(WALLS.options[0], '10x10')).toBe(9_000)
    expect(modifierOptionPriceCents(WALLS.options[0])).toBe(9_000)
    expect(modifierOptionPriceCents(WALLS.options[1], '10x20')).toBe(7_500)
  })

  it('is priced on the variant by resolveLineModifiers', () => {
    const picks = [
      { groupId: 'frame', optionId: 'alu' },
      { groupId: 'walls', optionId: 'back' },
      { groupId: 'walls', optionId: 'side' },
      { groupId: 'stakes', optionId: 'kit' },
    ]
    const large = resolveLineModifiers(CANOPY, picks, '10x20')
    expect(large.ok).toBe(true)
    expect(large.modifiers.map((modifier) => [modifier.optionId, modifier.priceCents])).toEqual([
      ['alu', 30_000],
      ['back', 15_000],
      ['side', 7_500],
      ['kit', 1_500],
    ])
    expect(large.extraCents).toBe(54_000)
    expect(resolveLineModifiers(CANOPY, picks, '10x10').extraCents).toBe(38_000)
  })

  it('prices as it always did for a caller that names no variant (the register, the kiosk, offline)', () => {
    const latte = { name: 'Latte', modifierGroups: [MILK] }
    const picks = [{ groupId: 'milk', optionId: 'oat' }]
    expect(resolveLineModifiers(latte, picks)).toEqual(resolveLineModifiers(latte, picks, 'large'))
    expect(resolveLineModifiers(latte, picks).extraCents).toBe(75)
  })

  it('refuses a price by variant outside $0 to $1,000, and a website switch that is not on or off', () => {
    expect(
      modifierGroupsProblem([
        { ...WALLS, options: [{ id: 'back', name: 'Back wall', priceCents: 0, priceCentsByVariant: { a: -1 } }] },
      ]),
    ).toContain('for each option it is priced by')
    expect(
      modifierGroupsProblem([
        { ...WALLS, options: [{ id: 'back', name: 'Back wall', priceCents: 0, priceCentsByVariant: { a: 100_001 } }] },
      ]),
    ).toContain('$0 to $1,000')
    expect(
      modifierGroupsProblem([
        { ...WALLS, options: [{ id: 'back', name: 'Back wall', priceCents: 0, priceCentsByVariant: [1] as never }] },
      ]),
    ).toContain('not a list by option')
    expect(modifierGroupsProblem([{ ...WALLS, online: 'yes' as never }])).toContain('shown on the website or not')
    expect(modifierGroupsProblem([FRAME, WALLS, STAKES])).toBeNull()
  })
})

describe('the groups the website offers (AGL-4100)', () => {
  it('are those switched on; a group with no switch stays at the register', () => {
    expect(websiteModifierGroups(CANOPY).map((group) => group.id)).toEqual(['frame', 'walls'])
    expect(websiteModifierGroups({ modifierGroups: [MILK] })).toEqual([])
    expect(websiteModifiersRequired(CANOPY)).toBe(true)
    expect(websiteModifiersRequired({ modifierGroups: [WALLS, STAKES] })).toBe(false)
  })

  it('never asks the register-only group online, and refuses a pick of it', () => {
    const answered = resolveWebsiteLineModifiers(CANOPY, [{ groupId: 'frame', optionId: 'steel' }], '10x10')
    expect(answered).toMatchObject({ ok: true, extraCents: 0 })
    expect(answered.modifiers.map((modifier) => modifier.optionId)).toEqual(['steel'])
    expect(
      resolveWebsiteLineModifiers(
        CANOPY,
        [
          { groupId: 'frame', optionId: 'steel' },
          { groupId: 'stakes', optionId: 'kit' },
        ],
        '10x10',
      ).ok,
    ).toBe(false)
  })

  it('refuses a required group unanswered, in plain words', () => {
    expect(resolveWebsiteLineModifiers(CANOPY, [], '10x10')).toMatchObject({
      ok: false,
      error: 'Choose frame for Canopy.',
    })
    expect(cartLineModifierProblem('Choose frame for Canopy.')).toBe(
      'Choose frame for Canopy. Remove it and add it again from its page.',
    )
    expect(cartLineModifierProblem('A choice on Canopy is no longer offered. Remove it and add it again.')).toBe(
      'A choice on Canopy is no longer offered. Remove it and add it again.',
    )
  })
})

describe('a paid line’s add-ons (AGL-4100)', () => {
  it('names every pick the product still offers, with no minimum asked, priced on the variant', () => {
    expect(
      soldLineModifiers(
        CANOPY,
        [
          { groupId: 'walls', optionId: 'back' },
          { groupId: 'walls', optionId: 'gone' },
        ],
        '10x20',
      ),
    ).toEqual([{ groupId: 'walls', optionId: 'back', group: 'Walls', name: 'Back wall', priceCents: 15_000 }])
  })

  it('travels as one metadata value and back, and reads nothing from a value it did not write', () => {
    const selection = modifierSelectionOf(
      resolveWebsiteLineModifiers(
        CANOPY,
        [
          { groupId: 'walls', optionId: 'side' },
          { groupId: 'frame', optionId: 'alu' },
        ],
        '10x10',
      ).modifiers,
    )
    expect(selection).toEqual([
      { groupId: 'frame', optionId: 'alu' },
      { groupId: 'walls', optionId: 'side' },
    ])
    expect(decodeModifierSelection(encodeModifierSelection(selection))).toEqual(selection)
    expect(encodeModifierSelection([])).toBe('')
    expect(decodeModifierSelection('frame:alu')).toEqual([])
    expect(decodeModifierSelection('{"a":1}')).toEqual([])
    expect(decodeModifierSelection(undefined)).toEqual([])
    expect(modifierSelectionFrom([{ groupId: 1, optionId: null }, 'x'])).toEqual([
      { groupId: '1', optionId: '' },
      { groupId: '', optionId: '' },
    ])
  })
})
