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

import { buildStyleFieldGroups } from './style-field-groups'
import {
  filterStyleGroup,
  matchesStyleQuery,
  scoreStyleEntry,
  STYLE_SECTION_ENTRIES,
  styleFieldEntry,
} from './style-field-search'

/**
 * Searching the styles panel (AGL-2486, item 13).
 *
 * The bar these tests hold the feature to is not "a filter exists" — it is
 * that a NON-DEVELOPER finds the control. Matching CSS property names alone
 * would pass a filter test and fail every author who does not know that
 * rounded corners are `border-radius`, so the alias index is what most of
 * this file asserts.
 */
const groups = buildStyleFieldGroups(['#123456'])
const group = (id: string) => groups.find((entry) => entry.$id === id)!

/** The field names a query leaves in one group. */
const found = (id: string, query: string): string[] => {
  const filtered = filterStyleGroup(group(id), query)
  return filtered ? filtered.fields.map((field) => field.name) : []
}

describe('styles panel search (AGL-2486)', () => {
  it('finds a field by the word an author would use, not the CSS name', () => {
    expect(found('borders', 'rounded')).toContain('borderRadius')
    expect(found('borders', 'shadow')).toContain('boxShadow')
    expect(found('position', 'see through')).toContain('opacity')
    expect(found('typography', 'bold')).toContain('fontWeight')
    expect(found('position', 'layer')).toContain('zIndex')
    expect(found('colors', 'fill')).toContain('backgroundColor')
  })

  it('still finds a field by its CSS property name', () => {
    // The alias index ADDS reach; it must not have replaced the obvious way.
    expect(found('borders', 'border-radius')).toContain('borderRadius')
    expect(found('position', 'zindex')).toContain('zIndex')
    expect(found('typography', 'letterSpacing')).toContain('letterSpacing')
  })

  it('ranks the field a word NAMES above one that merely lists it', () => {
    // `color` is Text Color's whole label and only an alias of Border Color;
    // an unranked filter would put them in schema order and bury the answer.
    const ranked = found('colors', 'color')
    expect(ranked[0]).toBe('color')
    expect(
      scoreStyleEntry(styleFieldEntry({ name: 'color', label: 'Text Color' }), 'color'),
    ).toBeGreaterThan(
      scoreStyleEntry(
        styleFieldEntry({ name: 'border', label: 'Border' }),
        'color',
      ),
    )
  })

  it('narrows on every term rather than widening', () => {
    // A query is a conjunction: `border color` must not return every border
    // field AND every colour field.
    const both = found('borders', 'border color')
    expect(both).toEqual(['borderColor'])
  })

  it('drops a group with nothing to show, so the panel can hide it', () => {
    // This is what lets a section collapse instead of rendering empty.
    expect(filterStyleGroup(group('typography'), 'rounded')).toBeUndefined()
  })

  it('returns the group unchanged, by identity, when not searching', () => {
    // The ordinary render must allocate nothing and must not reorder the
    // fields authors have learned.
    const typography = group('typography')
    expect(filterStyleGroup(typography, '')).toBe(typography)
    expect(filterStyleGroup(typography, '   ')).toBe(typography)
  })

  it('finds the sections that are not schema fields at all', () => {
    // The box stylers, the alignment toggle, the device bands and the raw
    // CSS editor are hand-rendered — searchable only if they are indexed.
    expect(matchesStyleQuery(STYLE_SECTION_ENTRIES['box'], 'padding')).toBe(true)
    expect(matchesStyleQuery(STYLE_SECTION_ENTRIES['box'], 'spacing')).toBe(true)
    expect(
      matchesStyleQuery(STYLE_SECTION_ENTRIES['visibility'], 'hide on mobile'),
    ).toBe(true)
    expect(matchesStyleQuery(STYLE_SECTION_ENTRIES['classes'], 'css')).toBe(true)
    expect(
      matchesStyleQuery(STYLE_SECTION_ENTRIES['textAlign'], 'centre'),
    ).toBe(true)
  })

  it('matches nothing for a word the panel has no control for', () => {
    // The negative control: a matcher that answered `true` for everything
    // would pass every assertion above.
    expect(matchesStyleQuery(STYLE_SECTION_ENTRIES['box'], 'gradient')).toBe(
      false,
    )
    expect(found('borders', 'gradient')).toEqual([])
    expect(found('sizing', 'shadow')).toEqual([])
  })

  it('matches everything while the query is empty', () => {
    expect(matchesStyleQuery(STYLE_SECTION_ENTRIES['box'], '')).toBe(true)
    expect(scoreStyleEntry(STYLE_SECTION_ENTRIES['box'], '')).toBe(0)
  })
})
