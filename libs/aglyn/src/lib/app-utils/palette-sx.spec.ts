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

import { resolvePaletteVars, resolvePaletteVarsSx } from './palette-sx'
import { SX_SCHEME_DARK_KEY } from './scheme-sx'

/** A site palette, light scheme. */
const light = {
  mode: 'light',
  primary: { main: '#00B0FF' },
  secondary: { main: '#E040FB' },
  text: { primary: 'rgb(22, 28, 33)' },
}

/** The same site in dark — the leaf resolves against whichever is active. */
const dark = {
  mode: 'dark',
  primary: { main: '#66D3FF' },
  secondary: { main: '#F07BFF' },
}

const CTA =
  'linear-gradient(242deg, var(--mui-palette-primary-main, #00B0FF) 0%, ' +
  '#7A5CF0 55%, var(--mui-palette-secondary-main, #E040FB) 100%)'

describe('palette var substitution (AGL-1331)', () => {
  it('resolves token stops against the active palette', () => {
    expect(resolvePaletteVars(CTA, light)).toBe(
      'linear-gradient(242deg, #00B0FF 0%, #7A5CF0 55%, #E040FB 100%)',
    )
  })

  it('follows the scheme, because the ACTIVE theme is already light or dark', () => {
    // This is what makes a token stop behave like `backgroundColor:
    // 'primary.main'` does — no dark slice needed for the common case.
    expect(resolvePaletteVars(CTA, dark)).toBe(
      'linear-gradient(242deg, #66D3FF 0%, #7A5CF0 55%, #F07BFF 100%)',
    )
  })

  it('falls back to the literal rather than leaving a var() behind', () => {
    // A surviving var() is the hazard: the besigner canvas runs inside the
    // console's CssVarsProvider, which defines --mui-palette-* with the
    // CONSOLE's brand colours.
    expect(resolvePaletteVars(CTA, { primary: {} })).toBe(
      'linear-gradient(242deg, #00B0FF 0%, #7A5CF0 55%, #E040FB 100%)',
    )
    expect(resolvePaletteVars(CTA, undefined)).not.toContain('var(')
  })

  it('keeps a bare reference when there is neither a token nor a fallback', () => {
    // Nothing better to put there; leaving the reference at least lets a
    // CSS-variables theme resolve it.
    expect(resolvePaletteVars('var(--mui-palette-primary-main)', {})).toBe(
      'var(--mui-palette-primary-main)',
    )
  })

  it('captures a function fallback whole', () => {
    expect(
      resolvePaletteVars(
        'var(--mui-palette-text-primary, rgb(22, 28, 33))',
        undefined,
      ),
    ).toBe('rgb(22, 28, 33)')
    expect(
      resolvePaletteVars('var(--mui-palette-text-primary, rgb(0, 0, 0))', light),
    ).toBe('rgb(22, 28, 33)')
  })

  it('leaves other custom properties alone', () => {
    const value = 'var(--aglyn-brand-ink, #000)'
    expect(resolvePaletteVars(value, light)).toBe(value)
  })

  it('walks arrays, nested slices and callbacks', () => {
    const sx = {
      backgroundImage: CTA,
      md: { backgroundImage: CTA },
      '&:hover': { backgroundImage: CTA },
      [SX_SCHEME_DARK_KEY]: { backgroundImage: CTA },
    }
    const out = resolvePaletteVarsSx(sx, light) as any
    expect(out.backgroundImage).not.toContain('var(')
    expect(out.md.backgroundImage).not.toContain('var(')
    expect(out['&:hover'].backgroundImage).not.toContain('var(')
    expect(out[SX_SCHEME_DARK_KEY].backgroundImage).not.toContain('var(')

    const [first] = resolvePaletteVarsSx([{ backgroundImage: CTA }], light) as any
    expect(first.backgroundImage).not.toContain('var(')

    const callback = resolvePaletteVarsSx(
      () => ({ backgroundImage: CTA }),
      light,
    ) as () => any
    expect(callback().backgroundImage).not.toContain('var(')
  })

  it('returns an sx with no references by identity', () => {
    // Every leaf runs this on every render; an sx that uses no token must
    // not be reallocated (and must not break emotion's memoisation).
    const sx = { color: 'primary.main', width: '100%', md: { width: '50%' } }
    expect(resolvePaletteVarsSx(sx, light)).toBe(sx)
    expect(resolvePaletteVarsSx(undefined, light)).toBeUndefined()
    expect(resolvePaletteVarsSx(42, light)).toBe(42)
  })
})

/**
 * Alpha on a theme token (AGL-2486, item 6).
 *
 * The storage format is MUI's own channel form, `rgba(var(…Channel) / A)`
 * with a literal channel fallback. It is a REFERENCE, so these tests are the
 * ones that say the value still follows the palette; flattening to a literal
 * `rgba(0, 176, 255, 0.12)` at author time would pass no assertion here.
 */
describe('alpha on a palette token (AGL-2486)', () => {
  const WASH = 'rgba(var(--mui-palette-primary-mainChannel, 0 176 255) / 0.12)'

  it('derives the channel triplet from the palette colour', () => {
    expect(resolvePaletteVars(WASH, light)).toBe('rgba(0 176 255 / 0.12)')
  })

  it('follows a palette change instead of freezing the authored colour', () => {
    // The whole point: the same stored string paints the DARK brand blue
    // when the dark theme is active, and a white-label host's own colour
    // when it swaps the palette. A flattened literal could not do this.
    expect(resolvePaletteVars(WASH, dark)).toBe('rgba(102 211 255 / 0.12)')
    expect(
      resolvePaletteVars(WASH, { primary: { main: '#1F2937' } }),
    ).toBe('rgba(31 41 55 / 0.12)')
  })

  it('reads an rgb() palette entry as well as a hex one', () => {
    expect(
      resolvePaletteVars(
        'rgba(var(--mui-palette-text-primaryChannel, 0 0 0) / 0.6)',
        light,
      ),
    ).toBe('rgba(22 28 33 / 0.6)')
  })

  it('prefers a channel entry the theme itself defines', () => {
    // A CssVarsProvider theme really does carry `mainChannel`; its own value
    // must win over anything derived here.
    expect(
      resolvePaletteVars(WASH, {
        primary: { main: '#00B0FF', mainChannel: '1 2 3' },
      }),
    ).toBe('rgba(1 2 3 / 0.12)')
  })

  it('falls back to the literal channels, never to a bare var()', () => {
    // Same hazard as a token stop: a surviving var() would resolve against
    // the CONSOLE's palette on the besigner canvas.
    expect(resolvePaletteVars(WASH, { primary: {} })).toBe(
      'rgba(0 176 255 / 0.12)',
    )
    expect(resolvePaletteVars(WASH, undefined)).not.toContain('var(')
  })

  it('resolves inside a whole sx, which is what the leaf renders', () => {
    // The published page reaches CSS through `Leaf`, which runs
    // `resolvePaletteVarsSx` over the merged author sx — so a colour field's
    // alpha'd token resolves on the tenant exactly as it does on the canvas.
    const out = resolvePaletteVarsSx(
      { backgroundColor: WASH, md: { borderColor: WASH } },
      light,
    ) as any
    expect(out.backgroundColor).toBe('rgba(0 176 255 / 0.12)')
    expect(out.md.borderColor).toBe('rgba(0 176 255 / 0.12)')
  })
})
