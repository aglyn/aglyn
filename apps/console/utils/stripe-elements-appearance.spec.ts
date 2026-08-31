/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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

/**
 * Stripe Elements has to look like the inputs beside it.
 *
 * Two failures are guarded here, and the second is the one that would ship:
 *
 *  1. **Hardcoded color.** The appearance object must be built FROM the theme,
 *     so a scheme change moves the card form with everything else. A copy of
 *     the palette would keep rendering last quarter's colors and nothing would
 *     fail.
 *  2. **An unresolved CSS variable.** The console's theme is served through
 *     MUI's `cssVariables` surfaces, so a palette read can return the STRING
 *     `var(--mui-palette-primary-main)`. Elements paints inside a cross-origin
 *     iframe on Stripe's domain, where our custom properties do not exist — the
 *     variable resolves to nothing and the field falls back to Stripe's default
 *     styling. Silently. On a surface nobody re-checks after a theme change.
 *
 * The whole point of the resolver is (2), so most of this file is about it.
 */

export {}

import { createTheme } from '@mui/material/styles'
import {
  resolveThemeColor,
  stripeAppearanceFromTheme,
} from './stripe-elements-appearance'
import { consoleThemeLight, consoleThemeDark } from '@aglyn/shared-ui-theme'

/** A resolver standing in for `getComputedStyle` on the document root. */
const vars: Record<string, string> = {
  '--mui-palette-primary-main': '#00b0ff',
  '--mui-palette-background-paper': '#FFFFFF',
  '--mui-palette-error-main': '#d32f2f',
  '--indirect': 'var(--mui-palette-primary-main)',
}
const resolve = (name: string) => vars[name] ?? ''

describe('a value that crosses into Stripe’s iframe is always a literal', () => {
  it('passes a plain color through untouched', () => {
    expect(resolveThemeColor('#00b0ff', resolve)).toBe('#00b0ff')
    expect(resolveThemeColor('rgba(0, 0, 0, 0.23)', resolve)).toBe(
      'rgba(0, 0, 0, 0.23)',
    )
  })

  it('resolves the var() form MUI emits on a cssVariables surface', () => {
    expect(resolveThemeColor('var(--mui-palette-primary-main)', resolve)).toBe(
      '#00b0ff',
    )
  })

  it('honors the declared fallback when the variable is undefined', () => {
    // What the browser itself would do. A theme that names a var we do not
    // define should still paint the color it nominated.
    expect(resolveThemeColor('var(--nope, #123456)', resolve)).toBe('#123456')
  })

  it('follows a variable that points at another variable', () => {
    expect(resolveThemeColor('var(--indirect)', resolve)).toBe('#00b0ff')
  })

  it('gives up rather than looping on a self-referential variable', () => {
    // A malformed theme must not hang the billing page.
    const loop = (name: string) => (name === '--loop' ? 'var(--loop)' : '')
    expect(resolveThemeColor('var(--loop)', loop)).toBe('')
  })

  it('CONTROL — an unresolved variable does NOT come back as a var() string', () => {
    // This is the actual bug. Before the resolver existed, the appearance
    // object carried `var(--mui-palette-primary-main)` verbatim across the
    // iframe boundary, where it means nothing. Anything is better than that
    // string surviving — so assert specifically that it does not.
    const out = resolveThemeColor('var(--mui-palette-primary-main)', () => '')
    expect(out).not.toContain('var(')
  })
})

describe('the appearance is built from the theme, not written down', () => {
  it('takes its colors, radius and font from the theme it is given', () => {
    // A theme with values that appear nowhere in the source. If the builder
    // hardcoded anything, these would not come out the other side.
    const theme = createTheme({
      palette: {
        mode: 'light',
        primary: { main: '#ABCDEF' },
        error: { main: '#FEDCBA' },
        background: { paper: '#F0E1D2' },
      },
      shape: { borderRadius: 11 },
      typography: { fontFamily: 'Testface, sans-serif' },
    })
    const appearance = stripeAppearanceFromTheme(theme, resolve)
    expect(appearance.variables.colorPrimary).toBe('#ABCDEF')
    expect(appearance.variables.colorDanger).toBe('#FEDCBA')
    expect(appearance.variables.colorBackground).toBe('#F0E1D2')
    expect(appearance.variables.borderRadius).toBe('11px')
    expect(appearance.variables.fontFamily).toBe('Testface, sans-serif')
  })

  it('switches Stripe’s base theme with the scheme, not just the colors', () => {
    // Stripe's base decides icon artwork, the dropdown surface and autofill
    // styling — things the variables do not reach. A light base wearing dark
    // colors shows through on exactly those.
    expect(stripeAppearanceFromTheme(consoleThemeLight, resolve).theme).toBe(
      'stripe',
    )
    expect(stripeAppearanceFromTheme(consoleThemeDark, resolve).theme).toBe(
      'night',
    )
  })

  it('draws the input border from the token that exists for it', () => {
    // `inputOutline` is a token because MUI has none — `OutlinedInput`
    // hardcodes the value inside its own styles. Using `divider` instead
    // (half the weight) is the mismatch it exists to prevent, so assert the
    // border is the outline and NOT the divider.
    const light = stripeAppearanceFromTheme(consoleThemeLight, resolve)
    expect(light.rules['.Input'].border).toContain(
      String(consoleThemeLight.palette.inputOutline),
    )
    expect(light.rules['.Input'].border).not.toContain(
      String(consoleThemeLight.palette.divider),
    )

    // And it flips with the scheme rather than being one literal.
    const dark = stripeAppearanceFromTheme(consoleThemeDark, resolve)
    expect(dark.rules['.Input'].border).not.toBe(light.rules['.Input'].border)
  })

  it('CONTROL — no appearance value survives as an unresolved variable', () => {
    // The end-to-end version of the trap, over the REAL console theme rather
    // than a rigged one: whatever form the palette arrives in, nothing that
    // reaches Stripe may still be a `var()`.
    for (const theme of [consoleThemeLight, consoleThemeDark]) {
      const appearance = stripeAppearanceFromTheme(theme, resolve)
      const everything = [
        ...Object.values(appearance.variables),
        ...Object.values(appearance.rules).flatMap((rule) =>
          Object.values(rule),
        ),
      ].join(' ')
      expect(everything).not.toContain('var(')
    }
  })

  it('CONTROL — the console theme really does define what is being read', () => {
    // A builder reading undefined palette keys would emit empty strings and
    // pass every "not a var()" assertion above. Prove the inputs exist.
    expect(consoleThemeLight.palette.inputOutline).toBeTruthy()
    expect(consoleThemeDark.palette.inputOutline).toBeTruthy()
    expect(consoleThemeLight.palette.inputOutline).not.toBe(
      consoleThemeDark.palette.inputOutline,
    )
    const appearance = stripeAppearanceFromTheme(consoleThemeLight, resolve)
    expect(appearance.variables.colorPrimary).toBeTruthy()
    expect(appearance.variables.colorText).toBeTruthy()
    expect(appearance.variables.fontFamily).toBeTruthy()
  })
})
