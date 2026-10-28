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

import { nameSearchKey, nameSearchToken, SCOPED_SEARCH_JOIN } from '@aglyn/aglyn/app-utils/name-search'
import { SITE_FONT_PAIRINGS } from '@aglyn/aglyn/app-utils/site-font-pairings'
import {
  SITE_THEME_BASES,
  siteStarterFacetsOf,
  type SiteStarterKnownIds,
} from '@aglyn/aglyn/app-utils/site-starter'
import type { SiteStarterSummary } from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import { BROWSE_EVERYONE } from './listing-query'

/**
 * A site starter as a marketplace listing (AGL-4049): the pure half of the
 * publish door and the starter source, so both read a starter one way.
 */

/**
 * The bases and font pairings a starter may name, checked by
 * `siteStarterRefusal` at publish and again at resolve. Kinds are left
 * unchecked: the core keeps no list of them.
 */
export const SITE_STARTER_KNOWN_IDS: SiteStarterKnownIds = {
  bases: new Set(SITE_THEME_BASES),
  fonts: new Set(SITE_FONT_PAIRINGS.map((pairing) => pairing.id)),
}

/** The most starters one search answers. */
export const SITE_STARTER_SEARCH_MAX = 50

/** Firestore's ceiling on the values of one `array-contains-any`. */
const ARRAY_CONTAINS_ANY_MAX = 30

/**
 * The `browseTokens` a typed search asks for: each word through the same
 * normalizer browse uses, scoped to everyone as the listing writers stamp
 * them (`*~word`), so a starter search finds only what anyone may see. At
 * most thirty, Firestore's ceiling for one `array-contains-any`; none for a
 * search with nothing searchable in it.
 */
export function siteStarterSearchTokens(word: string | null | undefined): string[] {
  const words = nameSearchKey(word).split(' ')
  const tokens = [...new Set(words.map((one) => nameSearchToken(one)).filter(Boolean))]
  return tokens
    .slice(0, ARRAY_CONTAINS_ANY_MAX)
    .map((token) => `${BROWSE_EVERYONE}${SCOPED_SEARCH_JOIN}${token}`)
}

/** A search's `limit`, as a whole number from 0 to {@link SITE_STARTER_SEARCH_MAX}. */
export function siteStarterSearchLimit(limit: unknown): number {
  const value = Math.floor(Number(limit))
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(value, SITE_STARTER_SEARCH_MAX)
}

/** One starter listing as a search lists it. */
export function siteStarterSummaryOf(
  listingId: string,
  listing: Record<string, any>,
  authorName: string,
): SiteStarterSummary {
  const price = Number(listing.priceUsd ?? 0)
  return {
    listingId,
    displayName: typeof listing.displayName === 'string' ? listing.displayName : '',
    description: typeof listing.description === 'string' ? listing.description : '',
    authorName,
    official: listing.official === true,
    priceUsd: Number.isFinite(price) && price > 0 ? price : 0,
    previewImageUrl:
      typeof listing.previewImageUrl === 'string' && listing.previewImageUrl
        ? listing.previewImageUrl
        : null,
    facets: siteStarterFacetsOf(listing),
  }
}

/**
 * The platform's own starters first, everything else in the order it came,
 * which is newest first. Ordering only: `official` decides nothing else.
 */
export function officialStartersFirst<T extends { official: boolean }>(rows: readonly T[]): T[] {
  return [...rows.filter((row) => row.official), ...rows.filter((row) => !row.official)]
}
