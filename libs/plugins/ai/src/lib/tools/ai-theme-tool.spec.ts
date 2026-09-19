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
  COMPONENT_OVERRIDES_FIELD,
  DARK_SCHEME_FIELD,
  GOOGLE_FONT_OPTIONS,
  SYSTEM_FONT_VALUE,
  THEME_COLOR_FIELDS,
  THEME_EDITOR_CONTROLS,
  THEME_EDITOR_MEDIA_QUERIES,
} from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import {
  AI_THEME_COLOR_CONTROLS,
  AI_THEME_SUMMARY_MAX_CHARS,
  AI_THEME_TOOL_MAX_COMPONENT_LEAVES,
  AI_THEME_TOOL_META_PROPERTIES,
  AI_THEME_TOOL_NAME,
  AI_THEME_TOOL_PROPERTIES,
  aiThemeTool,
  aiThemeToolParity,
  carriesLiteralColor,
  normalizeThemeHex,
  parseAiThemeToolInput,
} from './ai-theme-tool'

/**
 * The theme tool and the theme editor offer the same controls (AGL-2938).
 *
 * Parity is checked here in both directions against the catalog the editor
 * renders from — `theme-editor.component.spec.tsx` in the console holds the
 * other half, that the editor renders exactly the catalog — so the model can
 * never be offered a control a person cannot set by hand, nor miss one a
 * person can.
 */

type Schema = Record<string, any>

const schema = () => aiThemeTool().inputSchema as Schema

/** Every object schema inside a schema, the root included. */
function objectSchemas(node: unknown, found: Schema[] = []): Schema[] {
  if (!node || typeof node !== 'object') return found
  const record = node as Schema
  if (record['type'] === 'object') found.push(record)
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) value.forEach((entry) => objectSchemas(entry, found))
    else objectSchemas(value, found)
  }
  return found
}

describe('the tool is the editor catalog, in both directions', () => {
  it('offers every control the editor has, and nothing the editor does not', () => {
    expect(aiThemeToolParity()).toEqual({ unoffered: [], unknown: [] })
    // ANTI-VACUITY: the check sees a control the tool does not carry, and a
    // tool field whose control the catalog no longer has.
    expect(
      aiThemeToolParity([...THEME_EDITOR_CONTROLS, { id: 'lineHeight' as never }]).unoffered,
    ).toEqual(['lineHeight'])
    expect(
      aiThemeToolParity(THEME_EDITOR_CONTROLS.filter((control) => control.id !== 'spacing')).unknown,
    ).toEqual(['spacing'])
  })

  it('has exactly the properties the mapping names, and its summary', () => {
    const properties = Object.keys(schema()['properties'])
    expect(properties.sort()).toEqual(
      [
        ...AI_THEME_TOOL_PROPERTIES.map((entry) => entry.property),
        ...AI_THEME_TOOL_META_PROPERTIES,
      ].sort(),
    )
  })

  it('offers the editor’s own values: tokens, fonts, the dark scheme, components and media', () => {
    const { properties } = schema()
    expect(properties['colors'].items.properties.token.enum).toEqual(
      THEME_COLOR_FIELDS.map((field) => field.token),
    )
    expect(AI_THEME_COLOR_CONTROLS).toHaveLength(THEME_COLOR_FIELDS.length)
    expect(properties['fontFamily'].anyOf[0].enum).toEqual([
      SYSTEM_FONT_VALUE,
      ...GOOGLE_FONT_OPTIONS.map((option) => option.family),
    ])
    expect(properties['darkScheme'].anyOf[0].enum).toEqual(
      DARK_SCHEME_FIELD.options.map((option) => option.value),
    )
    const leaf = properties['componentOverrides'].items.properties
    expect(leaf.component.enum).toEqual([...COMPONENT_OVERRIDES_FIELD.components])
    expect(leaf.media.anyOf[0].enum).toEqual(Object.keys(THEME_EDITOR_MEDIA_QUERIES))
  })

  it('states each number control’s bounds as the catalog has them', () => {
    const { properties } = schema()
    const numbers = AI_THEME_TOOL_PROPERTIES.filter((entry) =>
      entry.controls.every(
        (id) => THEME_EDITOR_CONTROLS.find((control) => control.id === id)?.kind === 'number',
      ),
    )
    expect(numbers.map((entry) => entry.property)).toEqual([
      'borderRadius',
      'spacing',
      'navHeightMobile',
      'navHeightDesktop',
    ])
    for (const { property, controls } of numbers) {
      const control = THEME_EDITOR_CONTROLS.find((entry) => entry.id === controls[0])
      expect(properties[property].description).toContain(`from ${control?.min} to ${control?.max}`)
    }
  })

  it('is strict: every object forbids extra keys and requires every key it has', () => {
    const tool = aiThemeTool()
    expect(tool.name).toBe(AI_THEME_TOOL_NAME)
    expect(tool.strict).toBe(true)
    const objects = objectSchemas(tool.inputSchema)
    expect(objects.length).toBeGreaterThanOrEqual(3)
    for (const object of objects) {
      expect(object['additionalProperties']).toBe(false)
      expect([...object['required']].sort()).toEqual(Object.keys(object['properties']).sort())
    }
  })

  it('is the same bytes on every call, so it stays inside the cached prefix', () => {
    expect(JSON.stringify(aiThemeTool())).toBe(JSON.stringify(aiThemeTool()))
  })
})

describe('parseAiThemeToolInput holds an answer to the editor', () => {
  const empty = {
    summary: 'Warmer colors.',
    colors: [],
    darkScheme: null,
    fontFamily: null,
    borderRadius: null,
    spacing: null,
    navHeightMobile: null,
    navHeightDesktop: null,
    componentOverrides: [],
    resetComponentOverrides: false,
  }

  it('reads colors as the picker writes them, and says what it refused', () => {
    const parsed = parseAiThemeToolInput({
      ...empty,
      colors: [
        { token: 'primary', light: '#C2410C', dark: '#FDBA74' },
        { token: 'background.default', light: '#fff', dark: null },
        { token: 'tint.primary', light: 'default', dark: 'orange' },
        { token: 'primary', light: '#000000', dark: '#000000' },
        { token: 'accent', light: '#123456', dark: null },
      ],
    })
    expect(parsed.changes).toEqual([
      { control: 'color.primary', scheme: 'light', value: '#c2410c' },
      { control: 'color.primary', scheme: 'dark', value: '#fdba74' },
      { control: 'color.background.default', scheme: 'light', value: '#ffffff' },
      { control: 'color.tint.primary', scheme: 'light', value: null },
    ])
    expect(parsed.dropped).toEqual([
      'color.tint.primary (dark): "orange" is not a hex color',
      'color.primary: named twice; the first value is kept',
      'colors[4]: "accent" is not a theme color',
    ])
  })

  it('reads the dark scheme and the font from their lists, and the default font as no font', () => {
    const parsed = parseAiThemeToolInput({ ...empty, darkScheme: 'off', fontFamily: 'Lora' })
    expect(parsed.changes).toEqual([
      { control: 'darkScheme', scheme: null, value: 'off' },
      { control: 'fontFamily', scheme: null, value: 'Lora' },
    ])
    expect(
      parseAiThemeToolInput({ ...empty, darkScheme: 'auto', fontFamily: SYSTEM_FONT_VALUE }).changes,
    ).toEqual([
      { control: 'darkScheme', scheme: null, value: null },
      { control: 'fontFamily', scheme: null, value: null },
    ])
    const refused = parseAiThemeToolInput({ ...empty, darkScheme: 'dim', fontFamily: 'Comic Sans' })
    expect(refused.changes).toEqual([])
    expect(refused.dropped).toHaveLength(2)
  })

  it('brings numbers inside the editor’s bounds, whole, and names the adjustment', () => {
    const parsed = parseAiThemeToolInput({
      ...empty,
      borderRadius: 40,
      spacing: 6.4,
      navHeightMobile: 'default',
      navHeightDesktop: 'tall',
    })
    expect(parsed.changes).toEqual([
      { control: 'borderRadius', scheme: null, value: 24 },
      { control: 'spacing', scheme: null, value: 6 },
      { control: 'navHeight.xs', scheme: null, value: null },
    ])
    expect(parsed.notes).toEqual([
      'Border radius: 40 is outside from 0 to 24, so 24 is proposed.',
      'Spacing unit (px): 6.4 is outside from 2 to 16, so 6 is proposed.',
    ])
    expect(parsed.dropped).toEqual(['Nav height, desktop (px): "tall" is not a number'])
  })

  it('keeps component leaves the editor’s JSON would hold, and refuses a literal color or a hostile value', () => {
    const leaf = (patch: Record<string, unknown>) => ({
      component: 'MuiButton',
      target: 'styleOverrides',
      slot: 'root',
      property: 'textTransform',
      media: null,
      value: 'none',
      ...patch,
    })
    const parsed = parseAiThemeToolInput({
      ...empty,
      componentOverrides: [
        leaf({}),
        leaf({ component: 'MuiTypography', slot: 'h1', property: 'fontSize', media: 'mobile', value: '2.25rem' }),
        leaf({ target: 'defaultProps', slot: null, property: 'disableElevation', value: true }),
        leaf({ property: 'border', value: '1px solid red' }),
        leaf({ property: 'boxShadow', value: '0 1px 2px #000' }),
        leaf({ property: 'color', value: 'rgb(0, 0, 0)' }),
        leaf({ property: 'width', value: 'expression(alert(1))' }),
        leaf({ property: 'p', value: 2 }),
        leaf({ target: 'defaultProps', slot: null, property: 'href', value: 'https' }),
        leaf({ component: 'MuiDrawer' }),
      ],
    })
    expect(parsed.components).toEqual([
      { component: 'MuiButton', target: 'styleOverrides', slot: 'root', property: 'textTransform', media: null, value: 'none' },
      { component: 'MuiTypography', target: 'styleOverrides', slot: 'h1', property: 'fontSize', media: 'mobile', value: '2.25rem' },
      { component: 'MuiButton', target: 'defaultProps', slot: null, property: 'disableElevation', media: null, value: true },
    ])
    expect(parsed.dropped).toHaveLength(7)
    expect(parsed.dropped.filter((line) => line.includes('belongs to the palette'))).toHaveLength(3)
  })

  it('caps the leaves, the summary, and reads a reset only when it is true', () => {
    const many = Array.from({ length: AI_THEME_TOOL_MAX_COMPONENT_LEAVES + 2 }, () => ({
      component: 'MuiCard',
      target: 'defaultProps',
      slot: null,
      property: 'elevation',
      media: null,
      value: 0,
    }))
    const parsed = parseAiThemeToolInput({
      ...empty,
      summary: 'x'.repeat(AI_THEME_SUMMARY_MAX_CHARS + 50),
      componentOverrides: many,
      resetComponentOverrides: 'yes',
    })
    expect(parsed.components).toHaveLength(AI_THEME_TOOL_MAX_COMPONENT_LEAVES)
    expect(parsed.dropped).toContain(
      `componentOverrides: 2 past the ${AI_THEME_TOOL_MAX_COMPONENT_LEAVES}-leaf limit`,
    )
    expect(parsed.summary).toHaveLength(AI_THEME_SUMMARY_MAX_CHARS)
    expect(parsed.resetComponents).toBe(false)
    expect(parseAiThemeToolInput({ ...empty, resetComponentOverrides: true }).resetComponents).toBe(true)
  })
})

describe('literal colors and hex values', () => {
  it('finds a literal color however it is written', () => {
    expect(carriesLiteralColor('#fff')).toBe(true)
    expect(carriesLiteralColor('rgba(0, 0, 0, 0.2)')).toBe(true)
    expect(carriesLiteralColor('1px solid RebeccaPurple')).toBe(true)
    expect(carriesLiteralColor('none')).toBe(false)
    expect(carriesLiteralColor('2.25rem')).toBe(false)
    expect(carriesLiteralColor('uppercase')).toBe(false)
    expect(carriesLiteralColor('transparent')).toBe(false)
  })

  it('normalizes a hex to six lowercase digits, and refuses anything else', () => {
    expect(normalizeThemeHex(' #ABC ')).toBe('#aabbcc')
    expect(normalizeThemeHex('#0F766E')).toBe('#0f766e')
    expect(normalizeThemeHex('#0f766e80')).toBeNull()
    expect(normalizeThemeHex('teal')).toBeNull()
  })
})
