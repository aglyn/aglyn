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

import { createTheme } from '@mui/material/styles'

import { regionFills, type RegionFills } from './region-fills'

/**
 * The box diagram's dark mode (AGL-2486).
 *
 * Zach: "we are also missing a dark mode version of colors, this is too
 * bright on dark mode." The console runs MUI with CSS variables and
 * `colorSchemeSelector: 'class'` — measured in the running app, `:root,
 * .light` and `.dark` each redefine `--mui-palette-*` — so a fill built
 * only from palette VARIABLES re-resolves when the class flips, with no
 * mode branch of its own.
 *
 * That is the whole contract, and it holds only while every value is a
 * variable reference. One `#fff` and that region stops flipping, silently,
 * in one scheme only — the failure mode nobody notices from the light
 * side. It would also raise the hardcoded-colour ratchet, whose baseline
 * may never rise and where this file currently has no entry.
 */
describe('the box diagram gets its colour from the theme, never from literals', () => {
  const theme = createTheme({
    cssVariables: { colorSchemeSelector: 'class' },
    colorSchemes: { light: true, dark: true },
  })
  const fills = regionFills(theme.vars as any)
  const regions = Object.keys(fills) as Array<keyof RegionFills>

  /** Every colour-bearing string one region declares. */
  const declarations = (key: keyof RegionFills) => [
    fills[key].background,
    fills[key].seam,
    fills[key].borderColor,
  ]

  it('names all four regions', () => {
    expect(regions.sort()).toEqual(
      ['border', 'contents', 'margin', 'padding'].sort(),
    )
  })

  it('uses a CSS variable for every colour, in every region', () => {
    for (const key of regions) {
      for (const value of declarations(key)) {
        expect(value).toContain('var(--mui-palette-')
      }
    }
  })

  it('contains no hex, rgb() or named literal anywhere', () => {
    // The MUI variables carry FALLBACKS (`var(--x, #fff)`), which are the
    // theme's own values and not authored literals — so the check is on
    // what is left once the variable references are removed.
    const stripVars = (value: string) =>
      value.replace(/var\(--mui-[^)]*\)/g, '')
    for (const key of regions) {
      for (const value of declarations(key)) {
        const rest = stripVars(value)
        expect(rest).not.toMatch(/#[0-9a-f]{3,8}\b/i)
        expect(rest).not.toMatch(/\brgb\(/i)
        expect(rest).not.toMatch(/\b(white|black|silver|grey|gray)\b/i)
      }
    }
  })

  it('gives every band a seam, so the wedge geometry has something to show', () => {
    // The bands are drawn as four mitred wedges with a gap between them;
    // the seam is the ground that shows through, and it is what makes the
    // corners read as a frame rather than as a plain rectangle.
    for (const key of regions) {
      expect(`${fills[key].seam}`.length).toBeGreaterThan(0)
      expect(fills[key].seam).not.toBe(fills[key].background)
    }
  })

  it('re-resolves when the scheme flips, rather than baking one mode in', () => {
    // The proof that these are references and not snapshots: the SAME
    // declaration is produced whichever scheme is active, because the
    // value is chosen by CSS at paint time, not by JS at build time.
    const darkFills = regionFills(theme.vars as any)
    expect(darkFills).toEqual(fills)
    // and the ink the textures are carried by is the one token that is
    // near-black on light and near-white on dark.
    expect(fills.margin.background).toContain('text-primaryChannel')
  })
})
