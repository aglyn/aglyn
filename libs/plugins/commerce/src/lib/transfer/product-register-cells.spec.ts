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

import type { ProductModifierGroup } from '../model/product-modifiers'
import {
  addOnCellOf,
  addOnVariantIds,
  checkInCellOf,
  modifierGroupsFromAddOnCell,
  readAddOnCell,
  readCheckInCell,
  variantLabelKey,
  writeAddOnCell,
  writeCheckInCell,
} from './product-register-cells'

const read = (cell: string) => {
  const result = readAddOnCell(cell)
  if ('message' in result) throw new Error(result.message)
  return result.value
}

describe('an add-ons cell', () => {
  it('reads the format the docs give', () => {
    expect(read('Milk: Whole, Oat +$0.75; Extras (at most 3): Extra shot +$1.00, Syrup +$0.50')).toEqual([
      {
        name: 'Milk',
        min: 0,
        max: 1,
        online: true,
        choices: [
          { name: 'Whole', priceCents: 0, byVariant: [] },
          { name: 'Oat', priceCents: 75, byVariant: [] },
        ],
      },
      {
        name: 'Extras',
        min: 0,
        max: 3,
        online: true,
        choices: [
          { name: 'Extra shot', priceCents: 100, byVariant: [] },
          { name: 'Syrup', priceCents: 50, byVariant: [] },
        ],
      },
    ])
  })

  it('reads every setting, a price by variant, and the ways a person writes a price', () => {
    const [walls] = read('Walls (at least 2, register only): Back +50 (10x20 +$75.00, 20x20 $90), Side $40.5, Top +$.25')
    expect(walls).toMatchObject({ min: 2, max: 2, online: false })
    expect(walls?.choices).toEqual([
      {
        name: 'Back',
        priceCents: 5000,
        byVariant: [
          { label: '10x20', priceCents: 7500 },
          { label: '20x20', priceCents: 9000 },
        ],
      },
      { name: 'Side', priceCents: 4050, byVariant: [] },
      { name: 'Top', priceCents: 25, byVariant: [] },
    ])
  })

  it('takes a trailing comma or semicolon as nothing', () => {
    expect(read('Milk: Whole, ;')).toHaveLength(1)
    expect(read('Milk: Whole, ;')[0]?.choices).toHaveLength(1)
  })

  it('refuses a variant priced twice', () => {
    expect(readAddOnCell('Walls: Back +$1.00 (10x20 +$2.00, 10X20 +$3.00)')).toHaveProperty('message')
  })

  // A name of any shape comes back as itself: what a store already holds must survive a round trip.
  it.each([
    'Salt, pepper',
    'Half; half',
    '12:00 slot',
    'Walls (vinyl)',
    '12" wall',
    '"Quoted" name',
    'Vitamin C +5',
    'Buy 2 $5',
    'Discount -$1',
    ' padded ',
    'A+',
    '+1 shot',
    'Crème brûlée',
  ])('keeps the name %j whole, as a group, a choice and a variant', (name) => {
    const cell = writeAddOnCell([
      {
        name,
        min: 1,
        max: 2,
        online: false,
        choices: [
          { name, priceCents: 125, byVariant: [{ label: name, priceCents: 0 }] },
          { name: 'Other', priceCents: 0, byVariant: [] },
        ],
      },
    ])
    const [group] = read(cell)
    expect(group?.name).toBe(name)
    expect(group?.choices[0]).toEqual({ name, priceCents: 125, byVariant: [{ label: name, priceCents: 0 }] })
    expect(group?.choices[1]?.name).toBe('Other')
    expect(group).toMatchObject({ min: 1, max: 2, online: false })
    // One way to write it: reading and writing again is the same text.
    expect(writeAddOnCell(read(cell))).toBe(cell)
  })

  it.each([
    ['milk:whole,oat +0.75', 'milk: whole, oat +$0.75'],
    ['Milk (AT LEAST 1 , at most 1): Whole', 'Milk (at least 1): Whole'],
    ['Milk (at least 2, at most 2): A, B', 'Milk (at least 2): A, B'],
    ['Milk (at most 1): A', 'Milk: A'],
    ['Milk: A +$0.00', 'Milk: A'],
  ])('writes %s one way', (cell, canonical) => {
    expect(writeAddOnCell(read(cell))).toBe(canonical)
  })
})

describe('a stored product’s add-ons as a cell', () => {
  const groups: ProductModifierGroup[] = [
    {
      id: 'g1',
      name: 'Walls',
      min: 1,
      max: 2,
      online: true,
      options: [
        { id: 'o1', name: 'Back', priceCents: 5000, priceCentsByVariant: { a: 0, b: 7500, gone: 1 } },
        { id: 'o2', name: 'Side', priceCents: 0 },
      ],
    },
    { id: 'g2', name: 'Bag', min: 0, max: 1, options: [{ id: 'o3', name: 'Roller', priceCents: 2500 }] },
  ]
  const variants = [
    { id: 'a', options: { Size: '10x10' } },
    { id: 'b', options: { Size: '10x20' } },
  ]

  it('names each variant as the editor does, skips one the product no longer has, and says when a group is at the register only', () => {
    expect(addOnCellOf(groups, variants)).toBe(
      'Walls (at least 1, at most 2): Back +$50.00 (10x10 +$0.00, 10x20 +$75.00), Side; Bag (register only): Roller +$25.00',
    )
  })

  it('is blank for none', () => {
    expect(addOnCellOf(undefined, variants)).toBeNull()
    expect(addOnCellOf([], variants)).toBeNull()
  })

  it('gives back the same groups, ids and all, from its own cell', () => {
    const cell = addOnCellOf(groups, variants)
    const { groups: again, problem } = modifierGroupsFromAddOnCell(cell, groups, addOnVariantIds(variants))
    expect(problem).toBeNull()
    expect(again?.map((group) => group.id)).toEqual(['g1', 'g2'])
    expect(again?.[0]?.options[0]).toEqual({ id: 'o1', name: 'Back', priceCents: 5000, priceCentsByVariant: { a: 0, b: 7500 } })
    expect(again?.[0]?.options[1]).toEqual({ id: 'o2', name: 'Side', priceCents: 0 })
  })

  it('gives two groups with one name each their own id', () => {
    const twins: ProductModifierGroup[] = [
      { id: 'one', name: 'Same', min: 0, max: 1, options: [{ id: 'x', name: 'A', priceCents: 0 }] },
      { id: 'two', name: 'Same', min: 0, max: 1, options: [{ id: 'y', name: 'B', priceCents: 0 }] },
    ]
    const { groups: again } = modifierGroupsFromAddOnCell(addOnCellOf(twins, []), twins, {})
    expect(again?.map((group) => group.id)).toEqual(['one', 'two'])
  })

  it('mints the same new ids for the same names, unique ones, and one for a name with no letters', () => {
    const cell = 'Milk: Oat, Oat; Milk: Oat; ☕: ☕'
    const first = modifierGroupsFromAddOnCell(cell, [], {}).groups
    expect(first?.map((group) => group.id)).toEqual(['g-milk', 'g-milk-2', expect.stringMatching(/^g-/)])
    expect(first?.[0]?.options.map((option) => option.id)).toEqual(['o-oat', 'o-oat-2'])
    expect(modifierGroupsFromAddOnCell(cell, [], {}).groups).toEqual(first)
  })

  it('answers no groups, rather than none, for a cell it can’t read', () => {
    expect(modifierGroupsFromAddOnCell('Milk', groups, {}).groups).toBeNull()
  })

  it('finds a variant whichever order its values come in, in any case', () => {
    expect(variantLabelKey('Large / Red')).toBe(variantLabelKey('red/LARGE'))
    expect(addOnVariantIds([{ id: 'a' }, { id: 'b' }])).toEqual({ default: ['a', 'b'] })
  })
})

describe('a check-in cell', () => {
  it.each([
    ['No', { enabled: false }],
    ['false', { enabled: false }],
    ['Yes', { enabled: true, headcount: 1 }],
    ['TRUE', { enabled: true, headcount: 1 }],
    ['yes, 4 people', { enabled: true, headcount: 4 }],
    ['Yes, 1 person', { enabled: true, headcount: 1 }],
    ['Yes, ask which day', { enabled: true, headcount: 1, askUseDate: true }],
    ['Yes, 4 people, ask which day', { enabled: true, headcount: 4, askUseDate: true }],
  ])('reads %s', (cell, setting) => {
    expect(readCheckInCell(cell)).toEqual({ value: setting })
  })

  it.each(['', 'perhaps', 'No, 4 people', 'Yes, four people', 'Yes, 2.5 people', 'Yes, tomorrow'])('refuses %j', (cell) => {
    expect(readCheckInCell(cell)).toHaveProperty('message')
  })

  it.each([
    [{ enabled: false }, 'No'],
    [{ enabled: true }, 'Yes'],
    [{ enabled: true, headcount: 1 }, 'Yes'],
    [{ enabled: true, headcount: 4 }, 'Yes, 4 people'],
    [{ enabled: true, headcount: 4, askUseDate: true }, 'Yes, 4 people, ask which day'],
  ])('writes %j as %s, and reads it back', (setting, cell) => {
    expect(checkInCellOf(setting)).toBe(cell)
    const again = readCheckInCell(cell)
    expect('value' in again && writeCheckInCell(again.value)).toBe(cell)
  })

  it('is blank for a product with no setting', () => {
    expect(checkInCellOf(undefined)).toBeNull()
    expect(checkInCellOf({ headcount: 2 })).toBeNull()
  })
})
