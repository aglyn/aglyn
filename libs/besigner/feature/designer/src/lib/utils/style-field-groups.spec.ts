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

import { FieldComponentType } from '@aglyn/aglyn'
import { SX_SCHEME_DARK_KEY } from '@aglyn/aglyn-node-renderer'
import { readSxValue, writeSxValue } from './responsive-sx'
import {
  applyStylePartialToSx,
  buildFlexGapGroup,
  buildStyleFieldGroups,
  computeEffectiveStyleValues,
  computeStylePartial,
  isSchemeScopedStyleField,
  pickStyleValues,
  SCHEME_SCOPED_STYLE_FIELDS,
  styleGroupFieldNames,
} from './style-field-groups'

/**
 * Keys the styles panel owns outside the accordion field groups (the
 * flexbox toggle controls, BoxStyler, and the text-align toggle). Group
 * fields must never collide with them — a collision would let two
 * auto-applying controls fight over one sx key (AGL-587).
 */
const BASE_PANEL_KEYS = [
  'flexDirection',
  'flexWrap',
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

describe('style field groups (AGL-540/587)', () => {
  const groups = buildStyleFieldGroups(['#123456'])
  const gapGroup = buildFlexGapGroup()

  it('gives every consolidated field exactly one home', () => {
    const labels = groups.map((group) => group.label)
    expect(labels).toEqual([
      'Layout',
      'Colors',
      'Sizing',
      'Typography',
      'Borders & Shadows',
      'Position & Overflow',
      'Grid & Flex Child',
    ])
    const names = groups.flatMap(styleGroupFieldNames)
    for (const expected of [
      // Layout (ex loose base form, AGL-587).
      'display',
      'float',
      // Colors (ex loose base form, AGL-587).
      'color',
      'backgroundColor',
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
      // Per-side borders (AGL-1199): a divider under a bar or a rule
      // between columns cannot be written with the shorthand alone.
      'borderTop',
      'borderRight',
      'borderBottom',
      'borderLeft',
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
      // Per-item flex fields live together in Grid & Flex Child
      // (flexGrow/flexBasis moved out of the loose base form, AGL-587).
      'flexGrow',
      'flexShrink',
      'flexBasis',
      'order',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('keeps the container gap controls in their own Flexbox & Grids home', () => {
    expect(styleGroupFieldNames(gapGroup)).toEqual([
      'gap',
      'rowGap',
      'columnGap',
    ])
  })

  it('keeps field names unique across groups and off panel-owned keys', () => {
    const names = [
      ...groups.flatMap(styleGroupFieldNames),
      ...styleGroupFieldNames(gapGroup),
    ]
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(BASE_PANEL_KEYS).not.toContain(name)
    }
  })

  // Number box + unit picker for lengths (AGL-1219). Asserted at the
  // DECLARATION end so a field that quietly reverts to free text — or a
  // theme-multiple field that gets swept into the dimension editor — fails
  // here rather than in a screenshot.
  describe('length editors', () => {
    const componentOf = (name: string) =>
      [...groups.flatMap((group) => group.fields), ...gapGroup.fields].find(
        (field) => field.name === name,
      )?.['component']

    it.each([
      'width',
      'height',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
      'fontSize',
      'letterSpacing',
      'top',
      'right',
      'bottom',
      'left',
      'flexBasis',
    ])('gives %s a number box and a unit picker', (name) => {
      expect(componentOf(name)).toBe(FieldComponentType.CSS_DIMENSION)
    })

    it.each([
      // A NUMBER in these means a theme multiple, not pixels: `gap: 2` is
      // 16px (× the spacing unit) and `borderRadius: 2` is 8px (×
      // shape.borderRadius). A px picker would show "2" and turn the next
      // nudge into 3px — a silent 8× shrink.
      'gap',
      'rowGap',
      'columnGap',
      'borderRadius',
      // Unitless by convention; a unit picker would push px onto 1.5.
      'lineHeight',
    ])('keeps %s free text — its bare number is not pixels', (name) => {
      expect(componentOf(name)).toBe(FieldComponentType.TEXT_FIELD)
    })

    it('tells the sizing keys that a fraction is a percentage', () => {
      // MUI's sizingTransform: width: 0.5 renders 50%, not 0.5px.
      const sizing = groups.find((group) => group.$id === 'sizing')!
      for (const field of sizing.fields) {
        expect(field['numberAs']).toBe('mui-sizing')
      }
      // Everything else is plain CSS, where a number IS pixels.
      const fontSize = groups
        .flatMap((group) => group.fields)
        .find((field) => field.name === 'fontSize')
      expect(fontSize?.['numberAs']).toBeUndefined()
    })
  })

  // Per-field help tips (AGL-600, wired in AGL-1220). Asserted at the
  // DECLARATION end: the panel's accordion copy promises a ? on exactly
  // these fields, and for years there was none anywhere because
  // withStyleFieldHelp was never called.
  describe('help tips', () => {
    const allFields = [
      ...groups.flatMap((group) => group.fields),
      ...gapGroup.fields,
    ]
    const helpOf = (name: string) =>
      allFields.find((field) => field.name === name)?.['help'] as
        { title: string; excerpt: string; href: string } | undefined

    it.each(['borderRadius', 'gap', 'rowGap', 'columnGap', 'lineHeight'])(
      'warns on %s that its bare number is not pixels',
      (name) => {
        const help = helpOf(name)
        expect(help).toBeDefined()
        expect(help!.excerpt).toMatch(/not pixels/)
        expect(help!.title).toBeTruthy()
        // Clicking the tip must land on the style-groups docs section.
        expect(help!.href).toContain('#style-groups')
      },
    )

    it('leaves every other field to its inline description', () => {
      // The tip's value is saying what the helper line CANNOT. Tipping
      // all ~40 described fields duplicates the visible text and drops a
      // ? onto each field's top border — deliberately not shipped.
      const tipped = allFields
        .filter((field) => field['help'])
        .map((field) => field.name)
        .sort()
      expect(tipped).toEqual([
        'borderRadius',
        'columnGap',
        'gap',
        'lineHeight',
        'rowGap',
      ])
      // …and every untipped field still explains itself inline.
      for (const field of allFields) {
        if (!field['help']) expect(field['description']).toBeTruthy()
      }
    })
  })

  it('feeds the theme palette into every color picker', () => {
    for (const fieldName of ['borderColor', 'color', 'backgroundColor']) {
      const field = groups
        .flatMap((group) => group.fields)
        .find((candidate) => candidate.name === fieldName) as any
      expect(field?.presetColors).toEqual(['#123456'])
    }
  })

  describe('computeStylePartial', () => {
    const sizing = groups.find((group) => group.$id === 'sizing')!
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
      expect(Object.prototype.hasOwnProperty.call(partial, 'height')).toBe(true)
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

  // Styles-panel scheme routing (AGL-588): while the artboard previews
  // dark, only COLOR-BEARING fields write into the sx dark slice —
  // everything else stays a scheme-agnostic base write.
  describe('scheme routing (AGL-588)', () => {
    it('declares exactly the color-bearing panel fields as scheme-scoped', () => {
      expect([...SCHEME_SCOPED_STYLE_FIELDS].sort()).toEqual([
        'backgroundColor',
        'borderColor',
        'color',
      ])
      expect(isSchemeScopedStyleField('color')).toBe(true)
      expect(isSchemeScopedStyleField('width')).toBe(false)
    })

    it('routes color fields to the dark slice and others to the base while dark', () => {
      const sx = applyStylePartialToSx(
        { color: '#111' },
        { color: '#eee', backgroundColor: '#000', width: '320px' },
        null,
        'dark',
      )
      expect(sx['color']).toBe('#111')
      expect(sx['width']).toBe('320px')
      expect(sx[SX_SCHEME_DARK_KEY]).toEqual({
        color: '#eee',
        backgroundColor: '#000',
      })
    })

    it('edits the base (and never creates a slice) while previewing light', () => {
      const sx = applyStylePartialToSx(
        {},
        { color: '#111', width: '50%' },
        null,
        null,
      )
      expect(sx).toEqual({ color: '#111', width: '50%' })
      expect(SX_SCHEME_DARK_KEY in sx).toBe(false)
    })

    it('composes scheme with the active breakpoint (scheme outer, breakpoints inner)', () => {
      let sx: Record<string, any> = {}
      sx = applyStylePartialToSx(sx, { color: '#ddd' }, null, 'dark')
      sx = applyStylePartialToSx(sx, { color: '#eee' }, 'md', 'dark')
      expect(sx[SX_SCHEME_DARK_KEY]).toEqual({
        color: { xs: '#ddd', md: '#eee' },
      })
    })

    it('never pins inherited base colors into the slice by round-tripping', () => {
      // The form shows '#111' (base fallback) in dark preview; saving it
      // back unchanged must NOT create a dark override.
      const sx = applyStylePartialToSx(
        { color: '#111' },
        { color: '#111' },
        null,
        'dark',
      )
      expect(SX_SCHEME_DARK_KEY in sx).toBe(false)
    })

    it('resolves effective values through the slice with base fallback', () => {
      const sx = {
        color: '#111',
        backgroundColor: '#fff',
        width: '320px',
        [SX_SCHEME_DARK_KEY]: { color: '#eee' },
      }
      expect(computeEffectiveStyleValues(sx, null, 'dark')).toEqual({
        color: '#eee',
        backgroundColor: '#fff',
        width: '320px',
      })
      expect(computeEffectiveStyleValues(sx, null, null)).toEqual({
        color: '#111',
        backgroundColor: '#fff',
        width: '320px',
      })
    })

    it('surfaces dark-only overrides that have no base value', () => {
      const sx = { [SX_SCHEME_DARK_KEY]: { backgroundColor: '#000' } }
      expect(computeEffectiveStyleValues(sx, null, 'dark')).toEqual({
        backgroundColor: '#000',
      })
      // Light preview shows no value — nothing renders in light.
      expect(computeEffectiveStyleValues(sx, null, null)).toEqual({})
    })

    it('clearing a dark override falls back to the base color', () => {
      let sx: Record<string, any> = {
        color: '#111',
        [SX_SCHEME_DARK_KEY]: { color: '#eee' },
      }
      sx = applyStylePartialToSx(sx, { color: '' }, null, 'dark')
      expect(SX_SCHEME_DARK_KEY in sx).toBe(false)
      expect(computeEffectiveStyleValues(sx, null, 'dark')).toEqual({
        color: '#111',
      })
    })
  })

  it('round-trips relocated fields through the responsive-sx pipeline', () => {
    // Moved fields (AGL-587) must keep breakpoint scoping intact.
    let sx: Record<string, any> = {}
    sx = writeSxValue(sx, 'display', 'grid', null)
    sx = writeSxValue(sx, 'gap', '24px', 'md')
    sx = writeSxValue(sx, 'flexBasis', '30%', 'lg')
    sx = writeSxValue(sx, 'backgroundColor', '#fff', null)
    expect(readSxValue(sx, 'display', 'xs')).toBe('grid')
    expect(readSxValue(sx, 'gap', null)).toBeUndefined()
    expect(readSxValue(sx, 'gap', 'md')).toBe('24px')
    expect(readSxValue(sx, 'gap', 'xl')).toBe('24px')
    expect(readSxValue(sx, 'flexBasis', 'md')).toBeUndefined()
    expect(readSxValue(sx, 'flexBasis', 'lg')).toBe('30%')
    expect(readSxValue(sx, 'backgroundColor', 'sm')).toBe('#fff')
  })
})

describe('per-side borders (AGL-1199)', () => {
  const SIDES = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']

  it('sits in Borders & Shadows beside the shorthand it complements', () => {
    const group = buildStyleFieldGroups([]).find((g) => g.$id === 'borders')
    const names = group!.fields.map((f) => f.name)
    for (const side of SIDES) expect(names).toContain(side)
    // Ordered after the shorthand and its colour, before radius, so the
    // panel reads shorthand → sides → shape.
    expect(names.indexOf('borderTop')).toBeGreaterThan(names.indexOf('border'))
    expect(names.indexOf('borderLeft')).toBeLessThan(
      names.indexOf('borderRadius'),
    )
  })

  it('writes one side without touching the others', () => {
    // The bug this fixes: `border` is the only control, so a bottom
    // divider had to be drawn on all four edges.
    const sx = applyStylePartialToSx(
      undefined,
      { borderBottom: '1px solid' },
      null,
    )
    expect(sx).toEqual({ borderBottom: '1px solid' })
    expect(sx['border']).toBeUndefined()
  })

  it('is scheme-agnostic — only the colour follows dark mode', () => {
    // borderColor is scheme-scoped; the widths are not, so previewing
    // dark must not fork a divider into the dark slice.
    for (const side of SIDES) expect(isSchemeScopedStyleField(side)).toBe(false)
    expect(isSchemeScopedStyleField('borderColor')).toBe(true)
  })
})
