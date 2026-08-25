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

import { consoleThemeLight } from './console.theme'

/**
 * The Toolbar override targets the ROOT slot, while `disableGutters` only
 * drops the `gutters` slot — so before AGL-1230 the padding survived the prop
 * app-wide and the prop silently did nothing at >=sm. The marketing nav sat
 * 24px right of the page container at every width below the container clamp
 * because of it.
 */
describe('brand font weights (Zach 2026-08-25)', () => {
  const typography = consoleThemeLight.typography as unknown as Record<
    string,
    unknown
  >

  it('carries the three weights beyond MUI’s four', () => {
    // The brand ramp the press page documents: Black (heroes), ExtraBold
    // (H2), Bold, SemiBold, Regular, Light (numerals).
    expect(typography.fontWeightSemiBold).toBe(600)
    expect(typography.fontWeightExtraBold).toBe(800)
    expect(typography.fontWeightBlack).toBe(900)
  })

  it('leaves every weight MUI defines untouched', () => {
    // Additive is the whole safety argument — these ship into the console and
    // every tenant site, so nothing existing may move.
    expect(typography.fontWeightLight).toBe(300)
    expect(typography.fontWeightRegular).toBe(400)
    expect(typography.fontWeightMedium).toBe(500)
    expect(typography.fontWeightBold).toBe(700)
  })
})

describe('brand display ramp (Zach 2026-08-25)', () => {
  const typography = consoleThemeLight.typography as unknown as Record<
    string,
    any
  >

  it('makes a heading MEAN the brand, not MUI’s Light 300', () => {
    // The whole reason eleven /press headings shipped at Light 300: the
    // variant said Heading 2 and resolved to a Material display face nobody
    // chose, so every built page hand-wrote size and weight over the top.
    expect(typography.h1.fontWeight).toBe(900)
    expect(typography.h2.fontWeight).toBe(800)
  })

  it('leaves the variants the product actually uses alone', () => {
    // h3–h6 carry 95 `variant="hN"` usages across the console and overline
    // 19; h1/h2 carry none, which is why the ramp stops where it does.
    expect(typography.h3.fontWeight).toBe(400)
    expect(typography.h4.fontWeight).toBe(400)
    expect(typography.h5.fontWeight).toBe(400)
    expect(typography.h6.fontWeight).toBe(500)
    expect(typography.overline.fontWeight).toBe(400)
  })

  it('scales itself instead of being pinned to desktop pixels', () => {
    // `responsiveFontSizes` runs over these, so the small-screen value is the
    // base and the breakpoints climb to the desktop figure the frames show.
    const h2 = typography.h2
    const queries = Object.keys(h2).filter((key) => key.startsWith('@media'))
    expect(queries.length).toBeGreaterThan(0)
    const largest = h2[queries[queries.length - 1]].fontSize
    expect(Number.parseFloat(largest)).toBeGreaterThan(
      Number.parseFloat(h2.fontSize),
    )
  })
})

describe('MuiToolbar gutters (AGL-1230)', () => {
  const root = (consoleThemeLight.components?.MuiToolbar?.styleOverrides as any)?.root
  const call = (ownerState: unknown) =>
    typeof root === 'function'
      ? root({ theme: consoleThemeLight, ownerState })
      : root

  const smUp = consoleThemeLight.breakpoints.up('sm')

  it('pads a normal toolbar from sm up', () => {
    const styles = call({ disableGutters: false })
    expect(styles[smUp]).toEqual({ paddingLeft: '24px', paddingRight: '24px' })
  })

  it('adds nothing when disableGutters is set', () => {
    expect(call({ disableGutters: true })).toEqual({})
  })

  it('negative control: the padded branch is the one being suppressed', () => {
    // Guards against the assertion above passing because the override moved
    // or the slot was renamed — the two branches must actually differ.
    expect(call({ disableGutters: false })).not.toEqual(
      call({ disableGutters: true }),
    )
  })

  it('treats a missing ownerState as a normal toolbar', () => {
    // Never rely on the caller passing ownerState — an absent one must keep
    // the padding, not silently remove it from every toolbar in the app.
    expect(call(undefined)[smUp]).toBeTruthy()
  })
})
