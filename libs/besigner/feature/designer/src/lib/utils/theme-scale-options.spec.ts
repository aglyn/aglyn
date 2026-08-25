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

import { unstable_styleFunctionSx as styleFunctionSx } from '@mui/system'
import { createTheme } from '@mui/material/styles'

import { buildStyleFieldGroups } from './style-field-groups'
import {
  buildCornerRadiusChoices,
  buildFontFamilyChoices,
  buildFontSizeScaleOptions,
  buildFontWeightScaleOptions,
  buildGapChoices,
  buildShadowChoices,
  buildStyleThemeScales,
  buildTypographyVariantChoices,
  buildZIndexScaleOptions,
} from './theme-scale-options'

/**
 * Theme scales for font size, font weight and z-index (AGL-2486, item 12).
 *
 * The load-bearing claim is not that the panel shows a list — it is that the
 * value the panel STORES is a theme token path MUI resolves itself, so the
 * element keeps following the theme. That claim is only worth anything if it
 * is checked against MUI's own sx pipeline rather than restated, so these
 * tests run the stored values through `styleFunctionSx`.
 */
const theme = createTheme()
const scales = buildStyleThemeScales(theme as any)

/** What MUI actually emits for an sx holding one of these values. */
const resolve = (sx: Record<string, unknown>) =>
  styleFunctionSx({ theme, sx }) as Record<string, unknown>

describe('theme scales for the styles panel (AGL-2486)', () => {
  it('stores a token path that MUI resolves against the theme', () => {
    expect(resolve({ fontSize: 'h4.fontSize' }).fontSize).toBe(
      theme.typography.h4.fontSize,
    )
    expect(resolve({ fontWeight: 'fontWeightBold' }).fontWeight).toBe(
      theme.typography.fontWeightBold,
    )
    expect(resolve({ zIndex: 'appBar' }).zIndex).toBe(theme.zIndex.appBar)
  })

  it('still passes a raw value straight through', () => {
    // Arbitrary values are legitimate: the scale is an offer, not a gate.
    expect(resolve({ fontSize: '18px' }).fontSize).toBe('18px')
    expect(resolve({ fontWeight: '700' }).fontWeight).toBe('700')
    expect(resolve({ zIndex: 1400 }).zIndex).toBe(1400)
  })

  it('offers every option as a value the theme really resolves', () => {
    // The guard against a stale hardcoded list: an option whose token the
    // theme does not define would come back as its own path string.
    for (const option of scales.fontSize) {
      expect(resolve({ fontSize: option.value }).fontSize).not.toBe(
        option.value,
      )
    }
    for (const option of scales.zIndex) {
      expect(resolve({ zIndex: option.value }).zIndex).toBe(
        theme.zIndex[option.value as keyof typeof theme.zIndex],
      )
    }
  })

  it('names what each token resolves to, which is what makes it legible', () => {
    const h4 = scales.fontSize.find((option) => option.value === 'h4.fontSize')
    expect(h4?.label).toBe('Heading 4')
    expect(h4?.hint).toBe(`${theme.typography.h4.fontSize}`)
    const appBar = scales.zIndex.find((option) => option.value === 'appBar')
    expect(appBar?.label).toBe('App bar')
    expect(appBar?.hint).toBe(`${theme.zIndex.appBar}`)
  })

  it('orders the stacking layers by the layer they sit on', () => {
    const values = scales.zIndex.map(
      (option) => theme.zIndex[option.value as keyof typeof theme.zIndex],
    )
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('offers the theme weights AND the plain CSS ladder', () => {
    const values = scales.fontWeight.map((option) => option.value)
    expect(values).toContain('fontWeightBold')
    expect(values).toContain('700')
    // The theme-following answer comes first.
    expect(values.indexOf('fontWeightBold')).toBeLessThan(values.indexOf('700'))
  })

  it('offers nothing rather than guessing when there is no theme', () => {
    // A spec or a theme still loading must not produce a list of tokens the
    // host does not define — that would be a scale that resolves to nothing.
    expect(buildFontSizeScaleOptions(undefined)).toEqual([])
    expect(buildZIndexScaleOptions(undefined)).toEqual([])
    expect(
      buildFontWeightScaleOptions(undefined).every((option) =>
        /^[0-9]+$/.test(option.value),
      ),
    ).toBe(true)
    expect(buildFontSizeScaleOptions({ typography: {} })).toEqual([])
  })

  it('reaches the panel fields, not just the builder', () => {
    // Where this actually has to land: the three fields Zach named.
    const fields = buildStyleFieldGroups(['#123456']).flatMap(
      (group) => group.fields,
    )
    const field = (name: string) =>
      fields.find((entry) => entry.name === name) as Record<string, any>
    const withScales = buildStyleFieldGroups(['#123456'], {
      themeScales: scales,
    }).flatMap((group) => group.fields)
    const scaled = (name: string) =>
      withScales.find((entry) => entry.name === name) as Record<string, any>

    expect(scaled('fontSize')['scaleOptions']).toBe(scales.fontSize)
    expect(scaled('fontWeight')['scaleOptions']).toBe(scales.fontWeight)
    expect(scaled('zIndex')['scaleOptions']).toBe(scales.zIndex)
    // Without a theme the same fields are still there and still take a raw
    // value — the negative control for "the scale is an offer".
    expect(field('fontWeight')['scaleOptions']).toEqual([])
    expect(field('zIndex')['scaleOptions']).toEqual([])
  })
})

/**
 * The preset lists behind the three fields that stopped being raw CSS
 * (AGL-2486, Zach 2026-08-22).
 *
 * Same standard as the scales above: the claim is not "a list appears", it
 * is that the value STORED keeps following the theme. Corner radius is
 * checked through MUI's own sx pipeline for exactly that reason — a preset
 * that stopped being a number would render nothing at all and no snapshot
 * of the menu would say so.
 */
describe('preset choices (AGL-2486)', () => {
  it('stores a rounding preset as a NUMBER MUI multiplies by shape.borderRadius', () => {
    const rounded = buildCornerRadiusChoices(theme as any).find(
      (choice) => choice.label === 'Rounded',
    )!
    expect(typeof rounded.value).toBe('number')
    // Through MUI itself, not restated: 2 × the default shape radius.
    // MUI hands emotion the bare number and emotion appends the unit, so
    // the value out of `styleFunctionSx` is 8, not '8px' — asserting the
    // string here would have been asserting a step that happens later.
    expect(
      styleFunctionSx({ theme, sx: { borderRadius: rounded.value } }),
    ).toEqual({ borderRadius: 8 })
    expect(rounded.hint).toBe('8px')
  })

  it('follows a host that retuned its corner radius', () => {
    const chunky = createTheme({ shape: { borderRadius: 10 } })
    const rounded = buildCornerRadiusChoices(chunky as any).find(
      (choice) => choice.label === 'Rounded',
    )!
    expect(rounded.hint).toBe('20px')
    expect(
      styleFunctionSx({ theme: chunky, sx: { borderRadius: rounded.value } }),
    ).toEqual({ borderRadius: 20 })
  })

  it('keeps the two shape presets OFF the theme scale, on purpose', () => {
    // A pill and a circle are shapes, not spacing decisions — a theme
    // multiple cannot express either.
    const labels = buildCornerRadiusChoices(theme as any)
    expect(labels.find((choice) => choice.label === 'Pill')!.value).toBe(
      '9999px',
    )
    expect(labels.find((choice) => choice.label === 'Circle')!.value).toBe(
      '50%',
    )
  })

  it('names every shadow preset by what it looks like, not by its CSS', () => {
    for (const choice of buildShadowChoices()) {
      expect(choice.label).not.toMatch(/px|rgba|shadow:/i)
      expect(choice.label.length).toBeGreaterThan(0)
    }
    // "No shadow" is a real value — it removes one a component is drawing —
    // and is distinct from clearing the field.
    expect(buildShadowChoices()[0]).toEqual({
      value: 'none',
      label: 'No shadow',
    })
  })

  it('puts gaps on the theme spacing ladder, like margin and padding', () => {
    const choices = buildGapChoices(theme as any)
    expect(choices.length).toBeGreaterThan(0)
    // Stored as the multiple MUI's own `createUnaryUnit(theme, 'spacing')`
    // resolves — the same arithmetic the box styler's margins already use.
    for (const choice of choices) {
      expect(typeof choice.value).toBe('number')
      expect(resolve({ gap: choice.value }).gap).toBe(
        theme.spacing(choice.value as number),
      )
    }
    // A host that retunes its unit moves every gap with it.
    const wide = createTheme({ spacing: 10 })
    expect(
      styleFunctionSx({ theme: wide, sx: { gap: 2 } } as any),
    ).toMatchObject({ gap: '20px' })
  })

  it('offers a host’s own type rungs, not just MUI’s variants', () => {
    // Aglyn's theme carries lede/bodyCompact/micro for the 17/13/11px steps
    // MUI has no name for. Before they could be OFFERED, a page wanting 11px
    // had no choice but to write the pixels — /press carried 165 of them.
    const branded = createTheme({
      typography: {
        lede: { fontSize: '1.0625rem', fontWeight: 400 },
        bodyCompact: { fontSize: '0.8125rem', fontWeight: 400 },
        micro: { fontSize: '0.6875rem', fontWeight: 400 },
      } as any,
    })
    const sizes = buildFontSizeScaleOptions(branded as any)
    const values = sizes.map((o) => o.value)
    expect(values).toContain('micro.fontSize')
    expect(values).toContain('bodyCompact.fontSize')
    expect(values).toContain('lede.fontSize')
    // Named for a human, and the STORED token path resolves through the theme.
    expect(sizes.find((o) => o.value === 'micro.fontSize')?.label).toBe('Micro')
    expect(sizes.find((o) => o.value === 'bodyCompact.fontSize')?.label).toBe(
      'Body compact',
    )
    expect(
      styleFunctionSx({
        theme: branded,
        sx: { fontSize: 'micro.fontSize' },
      } as any),
    ).toMatchObject({ fontSize: '0.6875rem' })
    // MUI's own variants keep their curated order ahead of the extras.
    expect(values[0]).toBe('h1.fontSize')
    // And they show up as whole Text Styles too, not only as sizes.
    const styles = buildTypographyVariantChoices(branded as any).map(
      (o) => o.value,
    )
    expect(styles).toContain('micro')
    expect(styles).toContain('lede')
  })

  it('discovers a host’s own weight tokens instead of MUI’s four', () => {
    const branded = createTheme({
      typography: {
        fontWeightSemiBold: 600,
        fontWeightExtraBold: 800,
        fontWeightBlack: 900,
      } as any,
    })
    const options = buildFontWeightScaleOptions(branded as any)
    const tokens = options.filter((o) => String(o.value).startsWith('fontWeight'))
    const values = tokens.map((o) => o.value)
    expect(values).toContain('fontWeightExtraBold')
    expect(values).toContain('fontWeightBlack')
    // Light → heavy, not object-key order.
    const weights = tokens.map((o) => Number(o.hint))
    expect(weights).toEqual([...weights].sort((a, b) => a - b))
    // Named for a human, and the stored token resolves through the theme.
    expect(tokens.find((o) => o.value === 'fontWeightExtraBold')?.label).toBe(
      'Extra bold (theme)',
    )
    expect(
      styleFunctionSx({
        theme: branded,
        sx: { fontWeight: 'fontWeightExtraBold' },
      } as any),
    ).toMatchObject({ fontWeight: 800 })
    // The short form MUI's own docs use has to resolve too.
    expect(
      styleFunctionSx({ theme: branded, sx: { fontWeight: 'extraBold' } } as any),
    ).toMatchObject({ fontWeight: 800 })
  })

  it('stores shadows as theme ELEVATIONS, not bespoke CSS', () => {
    const choices = buildShadowChoices(theme as any)
    const elevations = choices.filter((c) => typeof c.value === 'number')
    expect(elevations.length).toBeGreaterThan(0)
    // The load-bearing claim: what is stored resolves through the host's own
    // ladder, so retuning `theme.shadows` moves every element that used it.
    for (const choice of elevations) {
      expect(resolve({ boxShadow: choice.value }).boxShadow).toBe(
        theme.shadows[choice.value as number],
      )
    }
    // The row still SHOWS the shadow it will draw, or the menu is unreadable.
    for (const choice of elevations) {
      expect(choice.preview).toBe(theme.shadows[choice.value as number])
    }
  })

  it('keeps the shadow menu short enough to read', () => {
    // The whole reason this control did not use `theme.shadows` before was
    // that 25 near-identical elevations is a worse menu than four that
    // visibly differ. Curating indices keeps the menu AND the token.
    expect(buildShadowChoices(theme as any).length).toBeLessThan(9)
    expect(theme.shadows.length).toBe(25)
  })

  it('falls back to literal shadows when a theme has no ladder', () => {
    const choices = buildShadowChoices({ typography: {} } as any)
    expect(choices[0]).toEqual({ value: 'none', label: 'No shadow' })
    expect(choices.length).toBeGreaterThan(1)
    for (const choice of choices.slice(1)) {
      expect(typeof choice.value).toBe('string')
    }
  })

  it('offers whole text styles that resolve to the theme variant', () => {
    const choices = buildTypographyVariantChoices(theme as any)
    const h2 = choices.find((c) => c.value === 'h2')
    expect(h2).toBeDefined()
    expect(h2?.label).toBe('Heading 2')
    // One pick has to bring the whole variant — size AND weight — or it is
    // just another single-property field wearing a better name.
    const applied = resolve({ typography: 'h2' })
    expect(applied.fontSize).toBe(theme.typography.h2.fontSize)
    expect(applied.fontWeight).toBe(theme.typography.h2.fontWeight)
  })

  it('names what a text style resolves to in THIS theme', () => {
    const branded = createTheme({ typography: { h2: { fontSize: '40px', fontWeight: 800 } } })
    const h2 = buildTypographyVariantChoices(branded as any).find(
      (c) => c.value === 'h2',
    )
    expect(h2?.hint).toContain('40px')
    expect(h2?.hint).toContain('800')
  })

  it('leads the font list with the SITE theme’s own faces', () => {
    const branded = createTheme({
      typography: { fontFamily: 'Poppins, sans-serif' },
    })
    const choices = buildFontFamilyChoices(branded as any)
    expect(choices[0]).toEqual({
      value: 'Poppins, sans-serif',
      label: 'Theme default font',
      hint: 'Poppins',
    })
    // …and the web-safe stacks are still offered after them.
    expect(choices.map((choice) => choice.value)).toContain('Georgia, serif')
  })

  it('offers a heading face separately when the theme has one', () => {
    const twoFaced = createTheme({
      typography: {
        fontFamily: 'Inter, sans-serif',
        h1: { fontFamily: 'Playfair Display, serif' },
      },
    })
    const labels = buildFontFamilyChoices(twoFaced as any).map((c) => c.label)
    expect(labels).toContain('Theme default font')
    expect(labels).toContain('Theme heading font')
  })

  it('offers one entry per face, however many variants share it', () => {
    // A theme using one family everywhere must not list it four times.
    const single = createTheme({ typography: { fontFamily: 'Inter, sans' } })
    const values = buildFontFamilyChoices(single as any).map((c) => c.value)
    expect(values.filter((value) => value === 'Inter, sans')).toHaveLength(1)
    expect(new Set(values).size).toBe(values.length)
  })

  it('still offers web-safe stacks with no theme at all', () => {
    // A theme still loading must not leave the picker empty — the field
    // would read as broken rather than as "nothing to choose yet".
    const choices = buildFontFamilyChoices(undefined)
    expect(choices.length).toBeGreaterThan(0)
    expect(choices.map((choice) => choice.value)).toContain('Georgia, serif')
  })

  it('reaches the panel fields, not just the builders', () => {
    const withScales = buildStyleFieldGroups(['#123456'], {
      themeScales: scales,
    }).flatMap((group) => group.fields)
    const field = (name: string) =>
      withScales.find((entry) => entry.name === name) as Record<string, any>
    expect(field('borderRadius')['choices']).toBe(scales.cornerRadius)
    expect(field('boxShadow')['choices']).toBe(scales.shadow)
    expect(field('fontFamily')['choices']).toBe(scales.fontFamily)
  })
})
