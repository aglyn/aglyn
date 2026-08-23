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
  PICKER_RANK,
  rankPickerItem,
  rankPickerItems,
} from './rank-picker-results'

describe('rankPickerItem (AGL-2486)', () => {
  it('grades a name hit by how well it matches', () => {
    expect(rankPickerItem({ displayName: 'Icon' }, 'icon')).toBe(
      PICKER_RANK.EXACT_NAME,
    )
    expect(rankPickerItem({ displayName: 'Icon button' }, 'icon')).toBe(
      PICKER_RANK.NAME_PREFIX,
    )
    expect(rankPickerItem({ displayName: 'Icon button' }, 'but')).toBe(
      PICKER_RANK.NAME_WORD_PREFIX,
    )
    expect(rankPickerItem({ displayName: 'Debut' }, 'but')).toBe(
      PICKER_RANK.NAME_SUBSTRING,
    )
  })

  it('puts every other field below every name hit', () => {
    expect(
      rankPickerItem({ displayName: 'Button', description: 'has an icon' }, 'icon'),
    ).toBe(PICKER_RANK.OTHER_FIELD)
    expect(rankPickerItem({ displayName: 'Card', tags: ['icon'] }, 'icon')).toBe(
      PICKER_RANK.OTHER_FIELD,
    )
    expect(PICKER_RANK.OTHER_FIELD).toBeGreaterThan(PICKER_RANK.NAME_SUBSTRING)
  })

  it('falls back to the fuzzy floor when nothing literally matches', () => {
    expect(
      rankPickerItem({ displayName: 'Icon', description: 'a glyph' }, 'ikon'),
    ).toBe(PICKER_RANK.FUZZY_ONLY)
  })

  it('scores a multi-word query by its weakest term', () => {
    // `icon` alone would read as an exact name match; `button` does not
    // appear at all, so the item cannot claim one.
    expect(rankPickerItem({ displayName: 'Icon' }, 'icon button')).toBe(
      PICKER_RANK.FUZZY_ONLY,
    )
    expect(rankPickerItem({ displayName: 'Icon button' }, 'icon button')).toBe(
      PICKER_RANK.EXACT_NAME,
    )
  })

  it('drops nothing while reordering', () => {
    const items = [
      { displayName: 'Avatar', description: 'or an icon' },
      { displayName: 'Icon button' },
      { displayName: 'Icon' },
    ]
    const ranked = rankPickerItems(items, 'icon')
    expect(ranked.map((i) => i.displayName)).toEqual([
      'Icon',
      'Icon button',
      'Avatar',
    ])
    expect(ranked).toHaveLength(items.length)
  })

  it('leaves an unfiltered list exactly as it found it', () => {
    const items = [{ displayName: 'B' }, { displayName: 'A' }]
    expect(rankPickerItems(items, '')).toBe(items)
  })
})
