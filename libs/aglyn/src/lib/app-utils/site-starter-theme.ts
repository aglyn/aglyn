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

import type { HostTheme, HostThemeSchemeColors } from '@aglyn/shared-data-types'
import {
  readThemeFonts,
  writeThemeFonts,
  type ThemeFontSelection,
} from '@aglyn/shared-util-tools/theme-fonts'
import type { ConsoleThemePreset } from '../plugin-manager/feature-plugins'
import { diffOverride, overrideWriteValue } from './artifact-overrides'
import { DEFAULT_SITE_THEME } from './default-site'
import { SITE_FONT_PAIRINGS, siteFontPairing, type SiteFontPairing } from './site-font-pairings'
import type { SiteStarterTheme } from './site-starter'
import { parseColor, resolveSiteTheme, themeArtifactContent } from './site-theme'
import {
  planThemeLibraryAction,
  presetEntryId,
  readThemeSelection,
  THEME_FIELD_DELETE,
  type ThemeLibraryAction,
  type ThemeLibraryEntryWrite,
  type ThemeLibraryHost,
} from './theme-library'

/**
 * A site starter's theme on the site it creates (AGL-4049).
 *
 * A starter names its look one of two ways (`SiteStarterTheme`): a built-in
 * theme with its brand colors and font pairing over it, or a full theme of
 * its author's own. Either way the new site's theme is stored the way a
 * person's own pick is: the built-in picked through the theme library with
 * the starter's colors and fonts as the override over it, or the full theme
 * installed into the library as a marketplace theme is. So the Theme page
 * names the base a site came from, and every edit there starts from it.
 *
 * Planned against an EMPTY host, because the site does not exist yet: the
 * create writes these fields in the same `set` that makes the host, and the
 * library entries beside it, in one transaction.
 *
 * Pure: no I/O. The caller passes the built-in themes it has registered.
 */

/**
 * The palette keys a built-in starter's brand sets: its three brand colors.
 * The status colors (error, warning, info, success) stay the base theme's,
 * since they mean the same thing on every site, and surfaces and text are the
 * base's design.
 */
export const SITE_STARTER_BRAND_KEYS = ['primary', 'secondary', 'tertiary'] as const

/** The built-in theme a starter's `base` names, as the themes plugin registers it. */
export const siteStarterPresetId = (base: string) => `theme-presets.${base}`

type BuiltinStarterTheme = Extract<SiteStarterTheme, { kind: 'builtin' }>
type Scheme = 'light' | 'dark'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * One scheme's colors with the brand over them, each brand color written the
 * way the theme editor writes a palette color (`writeThemeColor`): a record of
 * `main` alone, so MUI derives its light, dark and contrast text from it, and
 * the base's tint for that color dropped, since it was a wash of the old one.
 */
function brandScheme(
  colors: HostThemeSchemeColors | undefined,
  brand: Record<string, string> | undefined,
): HostThemeSchemeColors | undefined {
  let next: HostThemeSchemeColors | undefined = colors
  for (const key of SITE_STARTER_BRAND_KEYS) {
    const hex = brand?.[key]
    if (typeof hex !== 'string' || !hex.trim()) continue
    next = { ...next, [key]: { main: hex.trim() } }
    const tint = next.tint as Record<string, string> | undefined
    if (tint && key in tint) {
      const rest = { ...tint }
      delete rest[key]
      if (Object.keys(rest).length) next.tint = rest as HostThemeSchemeColors['tint']
      else delete next.tint
    }
  }
  return next
}

/**
 * A built-in base with the starter's brand colors and font pairing over it,
 * modeled on the AI start's look (`aiSiteTheme`) but driven by the starter's
 * `brand` and `fonts` rather than a style. Everything the base sets beyond
 * those stays the base's: its status colors, surfaces, shapes and component
 * styles. A brand with no `dark` map colors both schemes with `light`; a
 * `fonts` of `null`, or a pairing id the platform does not have, keeps the
 * base's own fonts.
 */
export function siteStarterTheme(theme: BuiltinStarterTheme, base: HostTheme): HostTheme {
  const brand = isRecord(theme?.brand) ? theme.brand : { light: {} }
  const light = isRecord(brand.light) ? brand.light : {}
  const dark = isRecord(brand.dark) ? brand.dark : light
  const brandFor: Record<Scheme, Record<string, string>> = { light, dark }
  const colorSchemes = { ...base.colorSchemes }
  for (const scheme of ['light', 'dark'] as const) {
    const colors = brandScheme(base.colorSchemes?.[scheme], brandFor[scheme])
    if (colors) colorSchemes[scheme] = colors
  }
  let next: HostTheme = { ...base }
  if (Object.keys(colorSchemes).length) next.colorSchemes = colorSchemes

  const pairing = siteFontPairing(theme?.fonts)
  if (!pairing) return next
  // The same write the AI site look makes for a pairing: the body family,
  // and the heading family where it differs.
  const sameFamily = pairing.heading.family === pairing.body.family
  next = writeThemeFonts(next, {
    body: {
      family: pairing.body.family,
      category: pairing.body.category,
      weights: [...pairing.body.weights],
      source: 'google',
    },
    heading: sameFamily
      ? null
      : {
          family: pairing.heading.family,
          category: pairing.heading.category,
          weights: [...new Set([pairing.heading.weight, pairing.heading.sub])].sort((a, b) => a - b),
          source: 'google',
        },
  })
  // A pairing whose heading is the body family loads the heading weights too.
  if (sameFamily && next.fonts?.[0]) {
    next.fonts = [
      {
        ...next.fonts[0],
        weights: [
          ...new Set([...(next.fonts[0].weights ?? []), pairing.heading.weight, pairing.heading.sub]),
        ].sort((a, b) => a - b),
      },
      ...next.fonts.slice(1),
    ]
  }
  return next
}

/** What a new site's host document and theme library start with. */
export interface SiteStarterThemePlan {
  /** Host fields, written in the `set` that creates the host. */
  host: Record<string, unknown>
  /** Library entries to create under `hosts/{id}/themes`. */
  entries: ThemeLibraryEntryWrite[]
}

/**
 * A plan's host fields as a new document takes them: a field the plan
 * deletes is simply not written, since an empty host has nothing to delete,
 * and an empty override is no field at all.
 */
function creatable(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== THEME_FIELD_DELETE && value !== null),
  )
}

/** The override a built-in starter stores over `base`, or `null` when it changes nothing. */
function starterOverride(theme: BuiltinStarterTheme, base: HostTheme): unknown {
  return overrideWriteValue(diffOverride(base, siteStarterTheme(theme, base)), null)
}

/**
 * The host fields and library entries a new site is born with for a
 * starter's theme, planned against an empty host through the same planner
 * the theme library runs (`planThemeLibraryAction`):
 *
 * - a full theme is installed, as the marketplace installs a theme, its
 *   entry named after the starter and its provenance the starter's listing;
 * - a built-in theme is picked as a preset, with the brand and fonts as the
 *   override over it;
 * - the `starter` base, or a base this deployment has no built-in for, is
 *   the theme every new site is born with (`DEFAULT_SITE_THEME`), with the
 *   brand and fonts as the override over it, and no library entry.
 */
export function planSiteStarterTheme(input: {
  theme: SiteStarterTheme
  presets: readonly ConsoleThemePreset[]
  listing: { listingId: string; version: string | number; displayName: string }
  newId: () => string
}): SiteStarterThemePlan {
  // `source`, not `listing`: this is the starter's id/version/name, not the
  // listing document the listing write-deny guard partitions (AGL-1361).
  const { theme, presets, listing: source, newId } = input
  const plan = (action: ThemeLibraryAction) => {
    const planned = planThemeLibraryAction({ host: {}, entries: {}, newId, action })
    return planned.ok === false ? null : planned
  }

  if (theme?.kind === 'full' && isRecord(theme.theme)) {
    const planned = plan({
      action: 'install',
      listingId: source.listingId,
      name: `${source.displayName} theme`,
      theme: themeArtifactContent(theme.theme),
      installedFrom: {
        listingId: source.listingId,
        version: source.version,
        artifactType: 'siteStarter',
      },
    })
    if (planned) return { host: creatable(planned.host), entries: planned.entries }
  }

  const builtin: BuiltinStarterTheme =
    theme?.kind === 'builtin' ? theme : { kind: 'builtin', base: 'starter', brand: { light: {} }, fonts: null }
  const preset =
    builtin.base === 'starter'
      ? null
      : (presets.find((entry) => entry?.id === siteStarterPresetId(builtin.base)) ?? null)
  if (preset) {
    const base = themeArtifactContent(preset.theme)
    const planned = plan({
      action: 'select',
      target: { kind: 'preset', id: preset.id, name: preset.name, theme: base },
    })
    if (planned) {
      return {
        host: creatable({ ...planned.host, themeOverride: starterOverride(builtin, base) }),
        entries: planned.entries,
      }
    }
  }
  return {
    host: creatable({
      theme: DEFAULT_SITE_THEME,
      themeOverride: starterOverride(builtin, DEFAULT_SITE_THEME),
    }),
    entries: [],
  }
}

/*==========================================
 * A SITE'S OWN BUILT-IN, READ BACK AS A STARTER THEME (AGL-4049).
 *
 * "Publish as a starter" offers a site that wears a built-in theme the
 * starter's built-in shape: the base it picked, the brand colors it set over
 * it, and its font pairing. Read so that a site created from the starter
 * wears what the publisher's site wears: a color the site never changed is
 * left to the base (its hand-tuned shades kept), each scheme names its own
 * colors (so a light brand never recolors the base's dark scheme), and fonts
 * the site never changed name no pairing.
 *=========================================*/

/** A site's built-in theme as a starter would carry it. */
export interface SiteStarterBuiltinReading {
  theme: BuiltinStarterTheme
  /** What the site's theme library calls the built-in it wears. */
  baseName: string
  /**
   * False when the site sets fonts that no pairing names: a built-in starter
   * names its fonts by pairing, so the starter wears the base's own fonts
   * and only the full theme keeps the site's.
   */
  fontsCarried: boolean
}

/** The `themeSelection` id a built-in starter base is picked under. */
const STARTER_PRESET_SELECTION = presetEntryId(siteStarterPresetId(''))

/** The `main` of one palette color, as the theme stores it. */
function paletteMain(colors: HostThemeSchemeColors | undefined, key: string): string | null {
  const value = (colors as Record<string, unknown> | undefined)?.[key]
  const main = isRecord(value) ? value['main'] : undefined
  return typeof main === 'string' && main.trim() ? main.trim() : null
}

/** A font selection's families, as one comparable key. */
const fontKey = (fonts: ThemeFontSelection) =>
  `${fonts.body?.family.trim().toLowerCase() ?? ''}|${fonts.heading?.family.trim().toLowerCase() ?? ''}`

/** A pairing's families, keyed as `readThemeFonts` reads them back once written. */
const pairingKey = (pairing: SiteFontPairing) => {
  const body = pairing.body.family.trim().toLowerCase()
  const heading = pairing.heading.family.trim().toLowerCase()
  return `${body}|${heading === body ? '' : heading}`
}

/**
 * The built-in theme a site wears, as a starter's `builtin` theme, or `null`
 * when it wears no built-in a starter can name: its own theme, a marketplace
 * theme, the platform default, or a built-in another plugin contributes.
 *
 * - `base` is the built-in the site picked (`themeSelection`), or `starter`
 *   for the theme every new site is born with, unchanged as its own.
 * - `brand` holds, per scheme, each of the three brand colors whose `main`
 *   the site changed from the base's.
 * - `fonts` is the pairing whose families the site sets, or `null` when it
 *   sets the base's own (or a pair no pairing names: `fontsCarried` false).
 *
 * Pure: reads the host document only.
 */
export function siteStarterBuiltinThemeOf(
  host: ThemeLibraryHost | null | undefined,
): SiteStarterBuiltinReading | null {
  if (!isRecord(host)) return null
  const base = themeArtifactContent(host.theme)
  const selection = readThemeSelection(host)
  let baseId: string | null = null
  if (selection.kind === 'preset' && selection.id.startsWith(STARTER_PRESET_SELECTION)) {
    const id = selection.id.slice(STARTER_PRESET_SELECTION.length)
    // A built-in registered under the starter's own name is never what
    // `starter` creates (`planSiteStarterTheme`).
    baseId = id && id !== 'starter' ? id : null
  } else if (
    selection.kind === 'custom' &&
    diffOverride(base, themeArtifactContent(DEFAULT_SITE_THEME)) === undefined
  ) {
    baseId = 'starter'
  }
  if (!baseId) return null

  const wears = resolveSiteTheme(host) ?? {}
  const brandOf = (scheme: Scheme): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const key of SITE_STARTER_BRAND_KEYS) {
      const main = paletteMain(wears.colorSchemes?.[scheme], key)
      if (!main || !parseColor(main)) continue
      if (main.toLowerCase() === paletteMain(base.colorSchemes?.[scheme], key)?.toLowerCase()) continue
      out[key] = main
    }
    return out
  }

  const siteFonts = readThemeFonts(wears)
  const sameFonts = fontKey(siteFonts) === fontKey(readThemeFonts(base))
  const pairing = sameFonts
    ? null
    : (SITE_FONT_PAIRINGS.find((entry) => pairingKey(entry) === fontKey(siteFonts)) ?? null)

  return {
    theme: {
      kind: 'builtin',
      base: baseId,
      // Both schemes always: a `dark` left out would be colored with `light`.
      brand: { light: brandOf('light'), dark: brandOf('dark') },
      fonts: pairing?.id ?? null,
    },
    baseName: selection.name,
    fontsCarried: sameFonts || !!pairing,
  }
}
