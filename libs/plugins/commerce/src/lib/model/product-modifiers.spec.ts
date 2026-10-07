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
  lineLabelWithModifiers,
  modifierGroupsProblem,
  modifierSelectionKey,
  productModifierGroups,
  resolveLineModifiers,
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
