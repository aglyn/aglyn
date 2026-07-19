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

import { readSxValue, writeSxValue } from './responsive-sx'
import {
  buildStyleFieldGroups,
  computeStylePartial,
  pickStyleValues,
  styleGroupFieldNames,
} from './style-field-groups'

/**
 * Keys the base styles panel already owns (main form, BoxStyler, and the
 * text-align toggle). Group fields must never collide with them — a
 * collision would let two auto-saving forms fight over one sx key.
 */
const BASE_PANEL_KEYS = [
  'display',
  'color',
  'backgroundColor',
  'float',
  'flexDirection',
  'flexGrow',
  'flexBasis',
  'flexWrap',
  'gap',
  'columnGap',
  'rowGap',
  'alignItems',
  'alignContent',
  'alignSelf',
  'justifyContent',
  'justifyItems',
  'justifySelf',
  'textAlign',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
]

describe('style field groups (AGL-540)', () => {
  const groups = buildStyleFieldGroups(['#123456'])

  it('covers the audited gaps', () => {
    const labels = groups.map((group) => group.label)
    expect(labels).toEqual([
      'Sizing',
      'Typography',
      'Borders & Shadows',
      'Position & Overflow',
      'Grid & Flex Child',
    ])
    const names = groups.flatMap(styleGroupFieldNames)
    for (const expected of [
      'width',
      'height',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
      'fontSize',
      'fontWeight',
      'fontFamily',
      'lineHeight',
      'letterSpacing',
      'textTransform',
      'textDecoration',
      'border',
      'borderColor',
      'borderRadius',
      'outline',
      'boxShadow',
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'zIndex',
      'overflow',
      'opacity',
      'cursor',
      'gridTemplateColumns',
      'gridTemplateRows',
      'gridAutoFlow',
      'gridColumn',
      'gridRow',
      'flexShrink',
      'order',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('keeps field names unique across groups and off base-panel keys', () => {
    const names = groups.flatMap(styleGroupFieldNames)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(BASE_PANEL_KEYS).not.toContain(name)
    }
  })

  it('feeds the theme palette into color pickers', () => {
    const borderColor = groups
      .flatMap((group) => group.fields)
      .find((field) => field.name === 'borderColor') as any
    expect(borderColor?.presetColors).toEqual(['#123456'])
  })

  describe('computeStylePartial', () => {
    const sizing = groups[0]
    const names = styleGroupFieldNames(sizing)

    it('only ever produces keys the group owns', () => {
      const partial = computeStylePartial(names, {
        width: '320px',
        // Keys owned by other panels must not leak into the partial —
        // a group save would otherwise clear them.
        color: '#fff',
        boxShadow: 'none',
      })
      expect(Object.keys(partial).sort()).toEqual([...names].sort())
      expect(partial['width']).toBe('320px')
      expect(partial).not.toHaveProperty('color')
      expect(partial).not.toHaveProperty('boxShadow')
    })

    it('clears fields the user emptied', () => {
      const partial = computeStylePartial(names, { height: undefined })
      expect(partial['height']).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(partial, 'height')).toBe(
        true,
      )
    })
  })

  describe('pickStyleValues', () => {
    it('selects only defined own values', () => {
      const picked = pickStyleValues(['width', 'height'], {
        width: '50%',
        color: 'red',
      })
      expect(picked).toEqual({ width: '50%' })
    })
  })

  it('round-trips group fields through the responsive-sx pipeline', () => {
    // Representative new keys must respect breakpoint scoping (AGL-333).
    let sx: Record<string, any> = { width: '100%' }
    sx = writeSxValue(sx, 'width', '320px', 'md')
    expect(readSxValue(sx, 'width', null)).toBe('100%')
    expect(readSxValue(sx, 'width', 'md')).toBe('320px')
    expect(readSxValue(sx, 'width', 'xl')).toBe('320px')

    sx = writeSxValue(sx, 'boxShadow', 'none', null)
    expect(readSxValue(sx, 'boxShadow', 'sm')).toBe('none')
  })
})
