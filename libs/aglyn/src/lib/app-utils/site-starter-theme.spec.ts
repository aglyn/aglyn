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
import { diffOverride, overrideWriteValue, readArtifactOverride, resolveOverride } from './artifact-overrides'
import { DEFAULT_SITE_THEME } from './default-site'
import type { SiteStarterTheme } from './site-starter'
import { planSiteStarterTheme, siteStarterBuiltinThemeOf, siteStarterTheme } from './site-starter-theme'
import { THEME_FIELD_DELETE } from './theme-library'

/**
 * AGL-4049 · a starter's theme on the site it creates: a built-in with three
 * brand colors and a font pairing over it, MUI deriving every shade, or a
 * full theme installed into the library.
 */

const BOOTSTRAP: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#0d6efd', light: '#3d8bfd', dark: '#0a58ca', contrastText: '#ffffff' },
      secondary: { main: '#6c757d' },
      error: { main: '#dc3545' },
      tint: { primary: '#e7f1ff', secondary: '#f1f3f5' },
    },
    dark: {
      primary: { main: '#6ea8fe' },
      error: { main: '#ea868f' },
    },
  },
  fonts: [{ family: 'Roboto', weights: [400, 700], source: 'google' }],
  typography: { fontFamily: '"Roboto", sans-serif' },
  shape: { borderRadius: 6 },
}
const PRESET = { id: 'theme-presets.bootstrap', name: 'Bootstrap', theme: BOOTSTRAP }

const builtin = (
  brand: { light: Record<string, string>; dark?: Record<string, string> },
  fonts: string | null = null,
  base = 'bootstrap',
): Extract<SiteStarterTheme, { kind: 'builtin' }> => ({ kind: 'builtin', base, brand, fonts })

let ids = 0
const plan = (theme: SiteStarterTheme, presets = [PRESET]) =>
  planSiteStarterTheme({
    theme,
    presets,
    listing: { listingId: 'listing-1', version: 2, displayName: 'Bakery' },
    newId: () => `id-${++ids}`,
  })

/** What a stored override resolves to over its base, as the site renders it. */
const resolved = (base: HostTheme, stored: unknown): HostTheme =>
  resolveOverride<HostTheme>(base, readArtifactOverride({ overrides: stored })?.patch)

describe('siteStarterTheme', () => {
  it('writes each brand color as `main` alone, so MUI derives its shades', () => {
    const theme = siteStarterTheme(builtin({ light: { primary: '#0a4' } }), BOOTSTRAP)
    expect(theme.colorSchemes?.light?.primary).toEqual({ main: '#0a4' })
    // The status colors stay the base's.
    expect(theme.colorSchemes?.light?.error).toEqual({ main: '#dc3545' })
    expect(theme.colorSchemes?.dark?.error).toEqual({ main: '#ea868f' })
    // A color the brand does not name is the base's.
    expect(theme.colorSchemes?.light?.secondary).toEqual({ main: '#6c757d' })
    expect(theme.shape).toEqual({ borderRadius: 6 })
  })

  it("drops the base's tint for a recolored color, as the editor does", () => {
    const theme = siteStarterTheme(builtin({ light: { primary: '#0a4' } }), BOOTSTRAP)
    expect(theme.colorSchemes?.light?.tint).toEqual({ secondary: '#f1f3f5' })
  })

  it('colors both schemes with `light` when the brand has no `dark`', () => {
    expect(
      siteStarterTheme(builtin({ light: { primary: '#0a4' } }), BOOTSTRAP).colorSchemes?.dark?.primary,
    ).toEqual({ main: '#0a4' })
    expect(
      siteStarterTheme(builtin({ light: { primary: '#0a4' }, dark: { primary: '#6f6' } }), BOOTSTRAP).colorSchemes
        ?.dark?.primary,
    ).toEqual({ main: '#6f6' })
  })

  it('sets only the three brand colors', () => {
    const theme = siteStarterTheme(builtin({ light: { error: '#000000', tertiary: '#b45309' } }), BOOTSTRAP)
    expect(theme.colorSchemes?.light?.error).toEqual({ main: '#dc3545' })
    expect(theme.colorSchemes?.light?.tertiary).toEqual({ main: '#b45309' })
  })

  it('sets a pairing through the font writer: the body family, and the heading family where it differs', () => {
    const inter = siteStarterTheme(builtin({ light: {} }, 'inter'), BOOTSTRAP)
    expect(inter.typography?.fontFamily).toBe('"Inter", sans-serif')
    expect(inter.fonts?.[0]).toMatchObject({ family: 'Inter', source: 'google', weights: [400, 500, 600, 700] })
    expect(inter.typography?.variants?.h1?.fontFamily).toBeUndefined()

    const editorial = siteStarterTheme(builtin({ light: {} }, 'editorial'), BOOTSTRAP)
    expect(editorial.typography?.fontFamily).toBe('"Source Sans 3", sans-serif')
    expect(editorial.typography?.variants?.h1?.fontFamily).toBe('"Playfair Display", serif')
    expect(editorial.fonts?.map((font) => font.family)).toEqual(['Source Sans 3', 'Playfair Display'])
  })

  it("keeps the base's fonts for no pairing, or one the platform does not have", () => {
    expect(siteStarterTheme(builtin({ light: {} }, null), BOOTSTRAP)).toEqual(BOOTSTRAP)
    expect(siteStarterTheme(builtin({ light: {} }, 'comic'), BOOTSTRAP)).toEqual(BOOTSTRAP)
  })
})

describe('planSiteStarterTheme', () => {
  beforeEach(() => {
    ids = 0
  })

  it('picks a built-in the deployment has as a preset, the brand and fonts as its override', () => {
    const theme = builtin({ light: { primary: '#0a4' } }, 'inter')
    const { host, entries } = plan(theme)
    expect(host['theme']).toEqual(BOOTSTRAP)
    expect(host['themeSelection']).toEqual({
      kind: 'preset',
      id: 'preset--theme-presets.bootstrap',
      name: 'Bootstrap',
    })
    expect(resolved(BOOTSTRAP, host['themeOverride'])).toEqual(siteStarterTheme(theme, BOOTSTRAP))
    // Planned against an empty host: nothing to file, nothing to delete.
    expect(entries).toEqual([])
    expect(Object.values(host)).not.toContain(THEME_FIELD_DELETE)
    expect(Object.keys(host).sort()).toEqual(['theme', 'themeOverride', 'themeSelection'])
  })

  it('falls back to the theme every site is born with for an unknown built-in, or `starter`', () => {
    const theme = builtin({ light: { primary: '#0a4' } }, null, 'win95')
    const { host, entries } = plan(theme)
    expect(host['theme']).toEqual(DEFAULT_SITE_THEME)
    expect(resolved(DEFAULT_SITE_THEME, host['themeOverride'])).toEqual(
      siteStarterTheme(theme, DEFAULT_SITE_THEME),
    )
    expect(entries).toEqual([])
    expect(plan(builtin({ light: {} }, null, 'starter'), [PRESET]).host).toEqual({ theme: DEFAULT_SITE_THEME })
    // A preset registered under the starter's name is never what `starter` means.
    expect(plan(builtin({ light: {} }, null, 'starter'), [{ ...PRESET, id: 'theme-presets.starter' }]).host).toEqual({
      theme: DEFAULT_SITE_THEME,
    })
  })

  it('installs a full theme as the marketplace installs one, named for the starter', () => {
    const { host, entries } = plan({ kind: 'full', theme: BOOTSTRAP })
    const installedFrom = { listingId: 'listing-1', version: 2, artifactType: 'siteStarter' }
    expect(host).toMatchObject({
      theme: BOOTSTRAP,
      themeSelection: { kind: 'installed', id: 'installed--listing-1', name: 'Bakery theme' },
      themeInstalledFrom: installedFrom,
    })
    expect(Object.values(host)).not.toContain(THEME_FIELD_DELETE)
    expect(entries).toEqual([
      {
        id: 'installed--listing-1',
        op: 'create',
        data: { kind: 'installed', name: 'Bakery theme', theme: BOOTSTRAP, installedFrom },
      },
    ])
  })

  it('reads a malformed theme as the starter base with nothing over it', () => {
    expect(plan(undefined as never).host).toEqual({ theme: DEFAULT_SITE_THEME })
    expect(plan({ kind: 'full', theme: null } as never).host).toEqual({ theme: DEFAULT_SITE_THEME })
  })
})

/**
 * AGL-4049 phase 5 · "Publish as a starter": a site that wears a built-in
 * theme publishes it as that built-in, with the brand colors and the font
 * pairing it set over it, read so that a site created from the starter wears
 * what the publisher's site wears.
 */
describe('siteStarterBuiltinThemeOf', () => {
  beforeEach(() => {
    ids = 0
  })

  /** A site born from a built-in starter theme, as the create writes it. */
  const siteFrom = (theme: Extract<SiteStarterTheme, { kind: 'builtin' }>) => plan(theme).host

  /** What a host renders: its theme with its override over it. */
  const renders = (host: Record<string, unknown>) =>
    resolved((host['theme'] ?? {}) as HostTheme, host['themeOverride'])

  it('reads a built-in site as its base, the brand colors it set over it and its pairing', () => {
    const reading = siteStarterBuiltinThemeOf(
      siteFrom(builtin({ light: { primary: '#0a4' }, dark: { primary: '#6f6' } }, 'inter')),
    )
    expect(reading).toEqual({
      theme: {
        kind: 'builtin',
        base: 'bootstrap',
        brand: { light: { primary: '#0a4' }, dark: { primary: '#6f6' } },
        fonts: 'inter',
      },
      baseName: 'Bootstrap',
      fontsCarried: true,
    })
  })

  it('reads back what the site wears: a site created from the reading renders the same theme', () => {
    const site = siteFrom(builtin({ light: { primary: '#0a4', tertiary: '#b45309' } }, 'editorial'))
    const reading = siteStarterBuiltinThemeOf(site)
    expect(reading).not.toBeNull()
    expect(renders(plan(reading!.theme).host)).toEqual(renders(site))
  })

  it("keeps each scheme's own colors: a light brand never recolors the base's dark scheme", () => {
    const site = siteFrom(builtin({ light: { primary: '#0a4' }, dark: {} }))
    const reading = siteStarterBuiltinThemeOf(site)
    expect(reading?.theme.brand).toEqual({ light: { primary: '#0a4' }, dark: {} })
    expect(renders(plan(reading!.theme).host).colorSchemes?.dark?.primary).toEqual(BOOTSTRAP.colorSchemes?.dark?.primary)
  })

  it('names no brand colors and no fonts for a built-in the site has not changed', () => {
    expect(siteStarterBuiltinThemeOf(siteFrom(builtin({ light: {} })))?.theme).toEqual({
      kind: 'builtin',
      base: 'bootstrap',
      brand: { light: {}, dark: {} },
      fonts: null,
    })
  })

  it('reads the theme every site is born with as the starter base', () => {
    const reading = siteStarterBuiltinThemeOf({ theme: DEFAULT_SITE_THEME })
    expect(reading?.theme).toEqual({ kind: 'builtin', base: 'starter', brand: { light: {}, dark: {} }, fonts: null })
    expect(reading?.baseName).toBe('Site theme')
    const recolored = siteFrom(builtin({ light: { primary: '#0a4' } }, null, 'starter'))
    expect(siteStarterBuiltinThemeOf(recolored)?.theme).toMatchObject({
      base: 'starter',
      brand: { light: { primary: '#0a4' } },
    })
  })

  it("is null for a site's own theme, a marketplace theme, the platform default or another plugin's built-in", () => {
    expect(siteStarterBuiltinThemeOf({ theme: BOOTSTRAP })).toBeNull()
    expect(
      siteStarterBuiltinThemeOf({ theme: BOOTSTRAP, themeInstalledFrom: { listingId: 'listing-9' } }),
    ).toBeNull()
    expect(siteStarterBuiltinThemeOf({})).toBeNull()
    expect(
      siteStarterBuiltinThemeOf({
        theme: BOOTSTRAP,
        themeSelection: { kind: 'preset', id: 'preset--themes.bootstrap', name: 'Bootstrap' },
      }),
    ).toBeNull()
    // A preset registered under the starter's name is not what `starter` creates.
    expect(
      siteStarterBuiltinThemeOf({
        theme: BOOTSTRAP,
        themeSelection: { kind: 'preset', id: 'preset--theme-presets.starter', name: 'Starter' },
      }),
    ).toBeNull()
    expect(siteStarterBuiltinThemeOf(null)).toBeNull()
  })

  it('says so when the site sets fonts no pairing names, which a built-in starter cannot carry', () => {
    const site = siteFrom(builtin({ light: {} }))
    // A font the site picked in the theme editor, stored as the override
    // over the built-in's copy, as the editor stores every edit.
    const comic: HostTheme = {
      ...BOOTSTRAP,
      fonts: [{ family: 'Comic Neue', weights: [400], source: 'google' }],
      typography: { fontFamily: '"Comic Neue", sans-serif' },
    }
    const reading = siteStarterBuiltinThemeOf({
      ...site,
      themeOverride: overrideWriteValue(diffOverride(BOOTSTRAP, comic), null),
    })
    expect(reading?.theme.fonts).toBeNull()
    expect(reading?.fontsCarried).toBe(false)
  })
})
