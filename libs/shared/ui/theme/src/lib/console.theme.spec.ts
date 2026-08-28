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
describe('brand font weights', () => {
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

describe('brand display ramp', () => {
  const typography = consoleThemeLight.typography as unknown as Record<
    string,
    any
  >

  it('makes a heading MEAN the brand, not MUI’s Light 300', () => {
    // Left at MUI's defaults, `variant="h2"` resolves to a Material display
    // face nobody chose, so every built page has to hand-write size and
    // weight over the top of it — and the ones that forget ship at Light 300.
    expect(typography.h1.fontWeight).toBe(900)
    expect(typography.h2.fontWeight).toBe(800)
    expect(typography.h3.fontWeight).toBe(700)
  })

  it('keeps the display ramp descending', () => {
    // h3 came down WITH h1/h2 rather than staying on MUI's scale: retuning
    // the two above it while h3 kept 48px left a Heading 3 larger than a
    // Heading 2. `responsiveFontSizes` scales the big variants hardest, so
    // compare the size each one REACHES, not its base.
    const ceiling = (v: Record<string, any>) =>
      Math.max(
        ...[
          v.fontSize,
          ...Object.keys(v)
            .filter((k) => k.startsWith('@media'))
            .map((k) => v[k]?.fontSize),
        ].map((x) => Number.parseFloat(String(x ?? '')) || 0),
      )
    const ramp = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((k) =>
      ceiling(typography[k]),
    )
    ramp.forEach((size, i) => {
      if (i > 0) expect(ramp[i - 1]).toBeGreaterThan(size)
    })
  })

  it('leaves the variants the product actually uses alone', () => {
    // h4–h6 carry 95 `variant="hN"` usages across the console and overline
    // 19. h1, h2 and h3 carry NONE — h3 was wrongly grouped here at first,
    // which is how the ramp came to invert; retuning it restyles no product
    // surface, so the line the brand stops at is h4, not h3.
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

/**
 * A TYPE STYLE IS NOT A HEADING (AGL-2486).
 *
 * MUI's own `defaultVariantMapping` sends `subtitle1` and `subtitle2` to
 * `<h6>`, so a component picking a subtitle for its LOOK also puts a level-6
 * heading in the document outline. Where the surrounding content sits above
 * `h5`, that is a skipped level — the `heading-order` accessibility failure.
 *
 * Measured across the 94 pages of aglyn.com's sitemap: 21 had a skipped level,
 * and 17 of those were this one defect, from two repo components that never
 * asked for a heading at all — `h2 to h6 "Share this article"` on every blog
 * post, `h3 to h6 "Get product updates"` on every blog listing.
 *
 * ⛔ Removing this mapping puts a stray `<h6>` back under all 37 subtitle call
 * sites on the render path at once, on every page that uses one, and the only
 * symptom is an audit nobody runs per-commit.
 */
describe('subtitle variants are not headings (AGL-2486)', () => {
  const mapping = (
    consoleThemeLight.components?.MuiTypography?.defaultProps as
      | { variantMapping?: Record<string, string> }
      | undefined
  )?.variantMapping

  it('maps both subtitles to `p`, as MUI already maps the body variants', () => {
    expect(mapping?.subtitle1).toBe('p')
    expect(mapping?.subtitle2).toBe('p')
  })

  it('is PARTIAL on purpose, so the heading variants keep their elements', () => {
    // MUI resolves `component || variantMapping[variant] ||
    // defaultVariantMapping[variant]`, so an unlisted variant falls through to
    // MUI's default rather than to the `'span'` last resort. Naming `h1`–`h6`
    // here would be restating MUI's answer and would go stale silently.
    for (const variant of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(mapping?.[variant]).toBeUndefined()
    }
  })
})
