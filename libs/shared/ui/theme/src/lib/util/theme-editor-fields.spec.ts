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

import type { HostTheme } from '@aglyn/shared-data-types'
import { HOST_THEME_COMPONENT_WHITELIST, sanitizeHostTheme } from './host-theme'
import {
  BORDER_RADIUS_FIELD,
  buildToolbarMixin,
  copyThemeSchemeColors,
  DARK_SCHEME_FIELD,
  getSchemeColor,
  GOOGLE_FONT_OPTIONS,
  orderSensitiveKey,
  PALETTE_COLOR_FIELDS,
  readDarkScheme,
  readFontFamily,
  readThemeFonts,
  readThemeColor,
  readToolbarHeight,
  resetComponentOverrides,
  SPACING_FIELD,
  SURFACE_COLOR_FIELDS,
  SYSTEM_FONT_VALUE,
  THEME_COLOR_FIELDS,
  THEME_EDITOR_CONTROLS,
  THEME_EDITOR_MEDIA_QUERIES,
  themeEditorControl,
  TINT_COLOR_FIELDS,
  TOOLBAR_HEIGHT_FIELDS,
  TOOLBAR_LANDSCAPE_QUERY,
  TOOLBAR_SM_QUERY,
  writeBorderRadius,
  writeComponentOverride,
  writeDarkScheme,
  writeFontFamily,
  writeThemeFonts,
  writeSpacing,
  writeThemeColor,
  writeToolbarHeight,
} from './theme-editor-fields'

describe('buildToolbarMixin (AGL-1242)', () => {
  it('emits the landscape clause BEFORE the sm height', () => {
    // Load-bearing: these land in one CSS rule, so the last matching
    // declaration wins. Landscape last makes every desktop — a wide
    // LANDSCAPE window — take the 48px branch.
    const keys = Object.keys(buildToolbarMixin(56, 72))
    expect(keys).toEqual(['minHeight', TOOLBAR_LANDSCAPE_QUERY, TOOLBAR_SM_QUERY])
    expect(keys.indexOf(TOOLBAR_LANDSCAPE_QUERY)).toBeLessThan(
      keys.indexOf(TOOLBAR_SM_QUERY),
    )
  })

  it('is always complete, falling back to MUI defaults', () => {
    // `mixins.toolbar` REPLACES MUI's default, so a partial object drops the
    // breakpoints it omits — setting only a desktop height left portrait
    // phones with no min-height at all.
    expect(buildToolbarMixin(undefined, 72)).toEqual({
      minHeight: '56px',
      [TOOLBAR_LANDSCAPE_QUERY]: {
        '@media (orientation: landscape)': { minHeight: 48 },
      },
      [TOOLBAR_SM_QUERY]: { minHeight: '72px' },
    })
    expect(buildToolbarMixin(64, undefined)[TOOLBAR_SM_QUERY]).toEqual({
      minHeight: '64px',
    })
  })

  it('round-trips through readToolbarHeight', () => {
    const theme: HostTheme = { mixins: { toolbar: buildToolbarMixin(56, 72) } }
    expect(readToolbarHeight(theme, 'xs')).toBe(56)
    expect(readToolbarHeight(theme, 'sm')).toBe(72)
    expect(readToolbarHeight({}, 'xs')).toBeUndefined()
  })
})

describe('orderSensitiveKey (AGL-1242)', () => {
  it('distinguishes two mixins that differ ONLY by key order', () => {
    // The whole point: `deepEqual` calls these equal, so the Save button
    // stayed disabled on a change that really does alter the rendered CSS.
    const good: HostTheme = { mixins: { toolbar: buildToolbarMixin(56, 72) } }
    const bad: HostTheme = {
      mixins: {
        toolbar: {
          minHeight: '56px',
          [TOOLBAR_SM_QUERY]: { minHeight: '72px' },
          [TOOLBAR_LANDSCAPE_QUERY]: {
            '@media (orientation: landscape)': { minHeight: 48 },
          },
        },
      },
    }
    expect(orderSensitiveKey(good)).not.toBe(orderSensitiveKey(bad))
  })

  it('treats identical mixins as identical', () => {
    const a: HostTheme = { mixins: { toolbar: buildToolbarMixin(56, 72) } }
    const b: HostTheme = { mixins: { toolbar: buildToolbarMixin(56, 72) } }
    expect(orderSensitiveKey(a)).toBe(orderSensitiveKey(b))
    expect(orderSensitiveKey({})).toBe(orderSensitiveKey({ spacing: 8 }))
  })
})

describe('TINT_COLOR_FIELDS (AGL-1244)', () => {
  // Tints ride `SurfaceColorPath` rather than `PALETTE_COLOR_FIELDS` because
  // the palette fields all write `{ main: hex }` and a tint has no `main`.
  // This pins that the shared path machinery reads and writes the group the
  // converter actually looks for.
  it('round-trips through the shared surface-path accessors', () => {
    const theme: HostTheme = {
      colorSchemes: { light: { tint: { primary: '#E6F5FF' } } },
    }
    const colors = theme.colorSchemes?.light
    expect(getSchemeColor(colors, ['tint', 'primary'])).toBe('#E6F5FF')
    expect(getSchemeColor(colors, ['tint', 'secondary'])).toBeUndefined()
    expect(getSchemeColor(undefined, ['tint', 'primary'])).toBeUndefined()
  })

  it('offers all three tints and stays disjoint from the surface fields', () => {
    expect(TINT_COLOR_FIELDS.map(({ path }) => path.join('.'))).toEqual([
      'tint.primary',
      'tint.secondary',
      'tint.tertiary',
    ])
    const surfacePaths = SURFACE_COLOR_FIELDS.map(({ path }) => path.join('.'))
    for (const { path } of TINT_COLOR_FIELDS) {
      expect(surfacePaths).not.toContain(path.join('.'))
    }
  })
})

describe('THEME_EDITOR_CONTROLS (AGL-2938)', () => {
  it('lists every color field once, in the order the editor renders them', () => {
    const colorIds = THEME_EDITOR_CONTROLS.filter((control) => control.kind === 'color').map(
      (control) => control.id,
    )
    expect(colorIds).toEqual(THEME_COLOR_FIELDS.map(({ token }) => `color.${token}`))
    expect(new Set(colorIds).size).toBe(colorIds.length)
    // ANTI-VACUITY: the three field lists and the divider all made it in.
    expect(THEME_COLOR_FIELDS).toHaveLength(
      PALETTE_COLOR_FIELDS.length + SURFACE_COLOR_FIELDS.length + TINT_COLOR_FIELDS.length + 1,
    )
  })

  it('carries a unique id and a label for every control', () => {
    const ids = THEME_EDITOR_CONTROLS.map((control) => control.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const control of THEME_EDITOR_CONTROLS) {
      expect(control.label.trim()).not.toBe('')
      expect(themeEditorControl(control.id)).toBe(control)
    }
    expect(() => themeEditorControl('nope' as never)).toThrow('nope')
  })

  it('bounds every number control and offers every select its values', () => {
    for (const control of THEME_EDITOR_CONTROLS) {
      if (control.kind === 'number') {
        expect([control.id, typeof control.min, typeof control.max, control.step]).toEqual([
          control.id,
          'number',
          'number',
          1,
        ])
        expect(control.min).toBeLessThan(control.max as number)
      }
      if (control.kind === 'select') expect(control.options?.length).toBeGreaterThan(1)
    }
    expect(themeEditorControl('borderRadius')).toMatchObject({
      min: BORDER_RADIUS_FIELD.min,
      max: BORDER_RADIUS_FIELD.max,
    })
    expect(themeEditorControl('spacing')).toMatchObject({ min: SPACING_FIELD.min, max: SPACING_FIELD.max })
    expect(themeEditorControl('navHeight.xs')).toMatchObject({ min: TOOLBAR_HEIGHT_FIELDS.xs.min })
    expect(themeEditorControl('darkScheme').options).toEqual(
      DARK_SCHEME_FIELD.options.map((option) => option.value),
    )
    expect(themeEditorControl('fontFamily').options).toEqual([
      SYSTEM_FONT_VALUE,
      ...GOOGLE_FONT_OPTIONS.map((option) => option.family),
    ])
    expect(themeEditorControl('components').options).toEqual(HOST_THEME_COMPONENT_WHITELIST)
  })

  it('scopes a mobile style to just below the toolbar breakpoint, and a desktop one from it', () => {
    expect(THEME_EDITOR_MEDIA_QUERIES).toEqual({
      mobile: '@media (max-width:599.95px)',
      desktop: TOOLBAR_SM_QUERY,
    })
  })
})

describe('the editor writes (AGL-2938)', () => {
  it('sets a palette color on main and keeps the rest of its record', () => {
    const theme: HostTheme = {
      colorSchemes: { light: { primary: { main: '#111111', contrastText: '#fff' } } },
    }
    const next = writeThemeColor(theme, 'light', 'primary', '#222222')
    expect(next.colorSchemes?.light?.primary).toEqual({ main: '#222222', contrastText: '#fff' })
    expect(readThemeColor(next, 'light', 'primary')).toBe('#222222')
    // Cleared, the palette record goes with it and the slot inherits.
    const cleared = writeThemeColor(next, 'light', 'primary', undefined)
    expect(cleared.colorSchemes?.light).toEqual({})
    // The input is never mutated.
    expect(theme.colorSchemes?.light?.primary?.main).toBe('#111111')
  })

  it('writes a group member and drops a group it leaves empty', () => {
    const next = writeThemeColor({}, 'dark', 'background.paper', '#101010')
    expect(next.colorSchemes?.dark).toEqual({ background: { paper: '#101010' } })
    expect(readThemeColor(next, 'dark', 'background.paper')).toBe('#101010')
    expect(writeThemeColor(next, 'dark', 'background.paper', undefined).colorSchemes?.dark).toEqual(
      {},
    )
    const tinted = writeThemeColor({}, 'light', 'tint.secondary', '#fdf2ff')
    expect(getSchemeColor(tinted.colorSchemes?.light, ['tint', 'secondary'])).toBe('#fdf2ff')
    const divided = writeThemeColor({}, 'light', 'divider', '#e0e0e0')
    expect(readThemeColor(divided, 'light', 'divider')).toBe('#e0e0e0')
    expect(readThemeColor(divided, 'dark', 'divider')).toBeUndefined()
    expect(writeThemeColor(divided, 'light', 'divider', undefined).colorSchemes?.light).toEqual({})
  })

  it('copies one scheme over the other without sharing objects', () => {
    const theme = writeThemeColor({}, 'light', 'primary', '#123456')
    const copied = copyThemeSchemeColors(theme, 'light', 'dark')
    expect(copied.colorSchemes?.dark).toEqual(copied.colorSchemes?.light)
    expect(copied.colorSchemes?.dark).not.toBe(copied.colorSchemes?.light)
    expect(copyThemeSchemeColors({}, 'light', 'dark')).toEqual({})
  })

  it('writes only the dark scheme opt-out', () => {
    const off = writeDarkScheme({}, 'off')
    expect(off).toEqual({ darkScheme: 'off' })
    expect(readDarkScheme(off)).toBe('off')
    expect(writeDarkScheme(off, 'auto')).toEqual({})
    expect(readDarkScheme({})).toBe('auto')
  })

  it('loads a curated font, and the system value clears it', () => {
    const inter = writeFontFamily({ typography: { variants: { h1: { fontWeight: 700 } } } }, 'Inter')
    expect(inter.fonts).toEqual([
      { family: 'Inter', weights: [400, 500, 700], source: 'google', category: 'sans-serif' },
    ])
    expect(inter.typography?.fontFamily).toBe('"Inter", sans-serif')
    expect(readFontFamily(inter)).toBe('Inter')
    const system = writeFontFamily(inter, SYSTEM_FONT_VALUE)
    expect(system.fonts).toBeUndefined()
    expect(system.typography).toEqual({ variants: { h1: { fontWeight: 700 } } })
    expect(readFontFamily(system)).toBe(SYSTEM_FONT_VALUE)
    // A family outside the curated list changes nothing.
    expect(writeFontFamily(inter, 'Comic Sans MS')).toBe(inter)
  })

  it('keeps the heading font and the site’s own fonts when the body font changes (AGL-3656)', () => {
    const theme = {
      fonts: [
        { family: 'Inter', weights: [400], source: 'google' as const, category: 'sans-serif' as const },
        { family: 'Lora', weights: [700], source: 'google' as const, category: 'serif' as const },
        { family: 'Acme Sans', source: 'custom' as const, faces: [] },
      ],
      typography: {
        fontFamily: '"Inter", sans-serif',
        variants: { h1: { fontFamily: '"Lora", serif' } },
      },
    }
    const next = writeFontFamily(theme, 'Roboto')
    expect(readFontFamily(next)).toBe('Roboto')
    expect(next.fonts?.map((font) => font.family)).toEqual(['Roboto', 'Lora', 'Acme Sans'])
    expect(next.typography?.variants?.h1?.fontFamily).toContain('Lora')
    const system = writeFontFamily(next, SYSTEM_FONT_VALUE)
    expect(system.fonts?.map((font) => font.family)).toEqual(['Lora', 'Acme Sans'])
  })

  it('sets and clears the radius, the spacing and the nav heights', () => {
    expect(writeBorderRadius({}, 12)).toEqual({ shape: { borderRadius: 12 } })
    expect(writeBorderRadius({ shape: { borderRadius: 12 } }, undefined)).toEqual({})
    expect(writeSpacing({}, 6)).toEqual({ spacing: 6 })
    expect(writeSpacing({ spacing: 6 }, 0)).toEqual({})
    const both = writeToolbarHeight(writeToolbarHeight({}, 'xs', 60), 'sm', 80)
    expect(both.mixins?.toolbar).toEqual(buildToolbarMixin(60, 80))
    // The mixin is always complete (AGL-1242), so clearing one height while
    // the other is set writes MUI's own default for it — which renders
    // exactly as inheriting does.
    expect(writeToolbarHeight(both, 'xs', undefined).mixins?.toolbar).toEqual(
      buildToolbarMixin(undefined, 80),
    )
    // A height that is not a positive number writes no mixin at all.
    expect(writeToolbarHeight({}, 'sm', Number.NaN)).toEqual({})
  })

  it('sets one component override leaf and keeps the others', () => {
    const theme: HostTheme = {
      components: { MuiButton: { styleOverrides: { root: { borderRadius: 2 } } } },
    }
    const styled = writeComponentOverride(theme, {
      component: 'MuiButton',
      target: 'styleOverrides',
      slot: 'root',
      property: 'textTransform',
      media: null,
      value: 'none',
    })
    const responsive = writeComponentOverride(styled, {
      component: 'MuiTypography',
      target: 'styleOverrides',
      slot: 'h1',
      property: 'fontSize',
      media: 'mobile',
      value: '2.25rem',
    })
    const defaulted = writeComponentOverride(responsive, {
      component: 'MuiButton',
      target: 'defaultProps',
      slot: null,
      property: 'disableElevation',
      media: null,
      value: true,
    })
    expect(defaulted.components).toEqual({
      MuiButton: {
        styleOverrides: { root: { borderRadius: 2, textTransform: 'none' } },
        defaultProps: { disableElevation: true },
      },
      MuiTypography: {
        styleOverrides: { h1: { [THEME_EDITOR_MEDIA_QUERIES.mobile]: { fontSize: '2.25rem' } } },
      },
    })
    // What was written survives the save path's sanitizer untouched.
    expect(sanitizeHostTheme(defaulted).components).toEqual(defaulted.components)
    expect(resetComponentOverrides(defaulted).components).toBeUndefined()
    // The inputs are never mutated.
    expect(theme.components?.['MuiButton']).toEqual({
      styleOverrides: { root: { borderRadius: 2 } },
    })
  })
})

describe('readThemeFonts / writeThemeFonts (AGL-3656)', () => {
  const inter = {
    family: 'Inter',
    category: 'sans-serif' as const,
    weights: [400, 700],
    source: 'google' as const,
  }
  const playfair = {
    family: 'Playfair Display',
    category: 'serif' as const,
    weights: [700],
    italics: [700],
    source: 'google' as const,
  }

  it('writes a body font as the loaded entry and the theme-wide stack', () => {
    const theme = writeThemeFonts({ typography: { variants: { h1: { fontWeight: 800 } } } }, {
      body: inter,
      heading: null,
    })
    expect(theme.fonts).toEqual([
      { family: 'Inter', weights: [400, 700], source: 'google', category: 'sans-serif' },
    ])
    expect(theme.typography).toEqual({
      fontFamily: '"Inter", sans-serif',
      variants: { h1: { fontWeight: 800 } },
    })
    expect(readThemeFonts(theme)).toEqual({ body: inter, heading: null })
    // The AI plugin's read keeps naming the body font.
    expect(readFontFamily(theme)).toBe('Inter')
  })

  it('sets a heading font on displayXl and h1 to h6, and reads it back', () => {
    const theme = writeThemeFonts({}, { body: inter, heading: playfair })
    expect(theme.fonts?.map((font) => font.family)).toEqual(['Inter', 'Playfair Display'])
    for (const key of ['displayXl', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      expect(theme.typography?.variants?.[key]?.fontFamily).toBe('"Playfair Display", serif')
    }
    expect(readThemeFonts(theme)).toEqual({ body: inter, heading: playfair })
  })

  it('takes the heading font away again, keeping each heading’s own styles', () => {
    const both = writeThemeFonts(
      { typography: { variants: { h2: { fontWeight: 600 } } } },
      { body: inter, heading: playfair },
    )
    const bodyOnly = writeThemeFonts(both, { body: inter, heading: null })
    expect(bodyOnly.fonts?.map((font) => font.family)).toEqual(['Inter'])
    expect(bodyOnly.typography?.variants).toEqual({ h2: { fontWeight: 600 } })
    expect(readThemeFonts(bodyOnly).heading).toBeNull()
  })

  it('treats a heading font equal to the body font as no heading font', () => {
    const theme = writeThemeFonts({}, { body: inter, heading: { ...inter, weights: [800] } })
    expect(theme.fonts).toHaveLength(1)
    expect(theme.typography?.variants).toBeUndefined()
  })

  it('goes back to the theme default, keeping uploaded fonts and other styles', () => {
    const uploaded = { family: 'Brand Sans', source: 'custom' as const, weights: [400] }
    const theme: HostTheme = {
      fonts: [{ family: 'Inter', weights: [400], source: 'google' }, uploaded],
      typography: { fontFamily: '"Inter", sans-serif', variants: { body2: { fontSize: 14 } } },
    }
    const cleared = writeThemeFonts(theme, { body: null, heading: null })
    expect(cleared.fonts).toEqual([uploaded])
    expect(cleared.typography).toEqual({ variants: { body2: { fontSize: 14 } } })
    expect(readThemeFonts(cleared)).toEqual({ body: null, heading: null })
    expect(writeThemeFonts({}, { body: null, heading: null })).toEqual({})
  })

  it('keeps loading a family another text style still names', () => {
    const theme: HostTheme = {
      fonts: [
        { family: 'Inter', weights: [400], source: 'google' },
        { family: 'Space Mono', weights: [400], source: 'google' },
      ],
      typography: {
        fontFamily: '"Inter", sans-serif',
        variants: { overline: { fontFamily: '"Space Mono", monospace' } },
      },
    }
    const next = writeThemeFonts(theme, { body: playfair, heading: null })
    expect(next.fonts?.map((font) => font.family)).toEqual(['Playfair Display', 'Space Mono'])
  })

  it('reads a font with no category from its stack, and an uploaded body font', () => {
    const lora: HostTheme = {
      fonts: [{ family: 'Lora', weights: [700, 400] }],
      typography: { fontFamily: "'Lora', serif" },
    }
    expect(readThemeFonts(lora).body).toEqual({
      family: 'Lora',
      category: 'serif',
      weights: [400, 700],
      source: 'google',
    })
    // A listed font no stack names draws nothing: that is the theme default.
    expect(readThemeFonts({ fonts: [{ family: 'Lora', weights: [400, 700] }] }).body).toBeNull()
    expect(readThemeFonts({ fonts: [{ family: 'Lora' }], typography: { fontFamily: 'Lora' } }).body).toEqual({
      family: 'Lora',
      category: 'sans-serif',
      weights: [400],
      source: 'google',
    })
    const custom = writeThemeFonts({}, {
      body: { family: 'Brand Sans', category: 'sans-serif', weights: [400], source: 'custom' },
      heading: null,
    })
    expect(custom.fonts?.[0].source).toBe('custom')
    expect(readThemeFonts(custom).body?.source).toBe('custom')
  })
})
