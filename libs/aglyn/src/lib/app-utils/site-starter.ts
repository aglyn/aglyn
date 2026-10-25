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
import { SCREEN_ROOT_PATH } from './screen-slug'

/**
 * Site starters (AGL-4049): a whole site a person picks before it exists,
 * every one of them a listing anyone may publish and price, the platform's own
 * included.
 *
 * This module is the vocabulary every reader of a starter shares: the artifact
 * type it is listed under, the facets a search filters on (stamped on the
 * listing as plain fields, so a query can match them), the payload a resolved
 * starter hands the site it creates, and the one check that payload must pass.
 * Who stores starters and how they are bought is the starter source's business
 * (`plugin-manager/plugin-site-starters.ts`); nothing here reads or writes.
 *
 * Pure data and readers, safe for any surface to import.
 */

/** The artifact type a site starter is listed and installed under (AGL-4049). */
export const SITE_STARTER_ARTIFACT_TYPE = 'siteStarter' as const

/**
 * How a starter fills the site it creates: `base` copies its pages as they
 * are; `ai` hands them to the AI site start with the answers it asks for, so
 * the pages are rewritten for the business.
 */
export type SiteStarterMode = 'base' | 'ai'

/**
 * The platform's built-in themes a site's look is layered on (AGL-3497,
 * AGL-4049), by the short name of the themes plugin's preset id
 * (`theme-presets.<name>`), and `starter`: the theme a new site is born with.
 * A starter on a built-in theme names one of these; the AI site start picks
 * among the same list.
 */
export const SITE_THEME_BASES = [
  'starter',
  'material-ui',
  'bootstrap',
  'minimal',
  'material3',
  'ant-design',
  'fluent',
  'carbon',
  'cupertino',
] as const
export type SiteThemeBase = (typeof SITE_THEME_BASES)[number]

/** Whether a value names one of the {@link SITE_THEME_BASES}. */
export function isSiteThemeBase(value: unknown): value is SiteThemeBase {
  return typeof value === 'string' && (SITE_THEME_BASES as readonly string[]).includes(value)
}

/**
 * A starter's theme (AGL-4049), one of two shapes: a built-in theme with the
 * starter's brand colors and font pairing over it, which is how a person's own
 * pick and edits are stored, or a full theme of its author's own.
 */
export type SiteStarterTheme =
  | {
      kind: 'builtin'
      /** One of the {@link SITE_THEME_BASES}. */
      base: string
      /** Palette overrides by scheme, as the theme editor stores them. */
      brand: { light: Record<string, string>; dark?: Record<string, string> }
      /** A font pairing id (`site-font-pairings.ts`), or `null` for the base theme's own fonts. */
      fonts: string | null
    }
  | { kind: 'full'; theme: HostTheme }

/**
 * What a starter search filters on (AGL-4049). `kind` is the kind of site it
 * is, an id the core does not interpret (the AI plugin keeps the kinds),
 * `base` a {@link SITE_THEME_BASES} name and `fonts` a font pairing id
 * (`site-font-pairings.ts`), each `null` where the starter names none;
 * `pages` is how many pages it creates.
 */
export interface SiteStarterFacets {
  kind: string | null
  base: string | null
  fonts: string | null
  pages: number
  mode: SiteStarterMode
}

/** A person's pick: the listing, and the version when one is pinned. */
export interface SiteStarterChoice {
  listingId: string
  version?: string
}

/** What a resolved starter hands the site it creates (AGL-4049). */
export interface SiteStarterPayload {
  mode: SiteStarterMode
  facets: SiteStarterFacets
  theme: SiteStarterTheme
  /**
   * The starter's pages, each carrying its routing `slug` as a starter
   * template's screens do: `'/'` is the home page, and a page without one is
   * unpublished.
   */
  screens: unknown[]
  /** The shared layout every page sits in: the header and footer. */
  layout: unknown | null
  /** The questions an `ai` starter asks before the site job runs; required for `ai`. */
  answers?: Record<string, unknown>
}

/** The most pages one starter may create. */
export const SITE_STARTER_MAX_SCREENS = 25

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const facetString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/**
 * A listing's starter facets, read defensively from the fields
 * {@link siteStarterFacetFields} stamps: a missing or malformed field reads as
 * none, a page count as a whole number from zero, and a mode as `base` unless
 * it says `ai`.
 */
export function siteStarterFacetsOf(doc: Record<string, unknown>): SiteStarterFacets {
  const pages = doc['starterPages']
  return {
    kind: facetString(doc['starterKind']),
    base: facetString(doc['starterBase']),
    fonts: facetString(doc['starterFonts']),
    pages: typeof pages === 'number' && Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 0,
    mode: doc['starterMode'] === 'ai' ? 'ai' : 'base',
  }
}

/** The listing fields a starter's publish stamps, the inverse of {@link siteStarterFacetsOf}. */
export function siteStarterFacetFields(facets: SiteStarterFacets): Record<string, unknown> {
  return {
    starterKind: facets.kind,
    starterBase: facets.base,
    starterFonts: facets.fonts,
    starterPages: facets.pages,
    starterMode: facets.mode,
  }
}

const FACET_KEYS: readonly (keyof SiteStarterFacets)[] = ['kind', 'base', 'fonts', 'pages', 'mode']

/** Whether a starter's facets meet a filter: every facet the filter names, equal; an absent one, any. */
export function matchSiteStarterFacets(
  facets: SiteStarterFacets,
  filter: Partial<SiteStarterFacets>,
): boolean {
  return FACET_KEYS.every((key) => filter[key] === undefined || facets[key] === filter[key])
}

/** Whether a page is the published home page: routed at the site root and not marked unpublished. */
const isPublishedHome = (screen: unknown): boolean =>
  isRecord(screen) && screen['slug'] === SCREEN_ROOT_PATH && screen['published'] !== false

/**
 * The ids a caller knows, by facet. `siteStarterRefusal` checks a kind, base
 * or font pairing id only against the set its caller passes: the core keeps
 * no list of kinds, and which bases and pairings are offered is the caller's
 * to say (`new Set(SITE_THEME_BASES)`, the ids of `SITE_FONT_PAIRINGS`).
 */
export interface SiteStarterKnownIds {
  kinds?: ReadonlySet<string>
  bases?: ReadonlySet<string>
  fonts?: ReadonlySet<string>
}

/**
 * Why a starter's payload cannot start a site, in the words its author is
 * told, or `null` when it can (AGL-4049). Checked when a starter is published
 * and again when one is resolved, since a site is created from it with no
 * step between to catch what is missing.
 */
export function siteStarterRefusal(payload: SiteStarterPayload, known: SiteStarterKnownIds = {}): string | null {
  const screens = Array.isArray(payload.screens) ? payload.screens : []
  if (!screens.some(isPublishedHome)) return 'A starter needs a published Home page at /'
  if (!isRecord(payload.layout)) return 'A starter needs a shared layout'
  if (screens.length > SITE_STARTER_MAX_SCREENS) {
    return `A starter can have at most ${SITE_STARTER_MAX_SCREENS} pages`
  }
  const unknown = (id: string | null, ids: ReadonlySet<string> | undefined) =>
    id !== null && ids !== undefined && !ids.has(id)
  const { facets, theme } = payload
  if (unknown(facets.kind, known.kinds)) return `Unknown site kind "${facets.kind}"`
  if (unknown(facets.base, known.bases)) return `Unknown base theme "${facets.base}"`
  if (unknown(facets.fonts, known.fonts)) return `Unknown font pairing "${facets.fonts}"`
  if (theme?.kind === 'builtin') {
    if (unknown(theme.base, known.bases)) return `Unknown base theme "${theme.base}"`
    if (unknown(theme.fonts, known.fonts)) return `Unknown font pairing "${theme.fonts}"`
  }
  if (payload.mode === 'ai' && !isRecord(payload.answers)) {
    return 'An AI starter needs the questions it asks'
  }
  return null
}
