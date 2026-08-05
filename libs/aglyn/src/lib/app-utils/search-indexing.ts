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

import { HostScreenVisibility } from '../foundation/definitions/platform.types'

/**
 * Search-indexing policy (AGL-1263): the single answer to "may a crawler
 * index this?", shared by every surface that has to agree about it.
 *
 * Four surfaces answer that question and they must never disagree — the
 * server `generateMetadata`, its client `<Head>` twin, `robots.txt` and
 * `sitemap.xml`. Before this module three of them had their own copy of the
 * rule and the fourth had none: the sitemap listed whatever was in the host's
 * routing map, so an UNLISTED page was simultaneously told "do not index me"
 * in its own head and advertised as a canonical URL in the site's sitemap.
 * That is not a harmless duplication — a sitemap entry is an explicit
 * submission, and submitting a page you have marked noindex is the shape that
 * gets a site flagged for conflicting directives.
 *
 * There are two controls and they compose:
 *
 * - **Site-level** `host.seo.discourageSearchEngines` — the staged-launch
 *   switch. Everything about the site goes dark to crawlers at once.
 * - **Per-screen** `screen.visibility` — the existing
 *   {@link HostScreenVisibility} model, NOT a parallel `noindex` flag.
 *   `UNLISTED` is literally `PUBLIC | (1 << 2)`: "public, plus the not-listed
 *   bit". A second per-screen field would be a field that can disagree with
 *   this one, and every render surface would then need a rule for which wins.
 */

/** The host fields this module reads; keeps callers free of the full doc. */
export interface SearchIndexingHost {
  seo?: {
    /**
     * Site-wide "discourage search engines" (AGL-1263). PERSISTED NAME — the
     * wording matches the switch an author sees, so support conversations and
     * the document agree.
     */
    discourageSearchEngines?: boolean
  } | null
}

/** The screen fields this module reads. */
export interface SearchIndexingScreen {
  visibility?: HostScreenVisibility | null
}

/**
 * Site-wide opt-out. Absent means "index me" — the default a site is created
 * with, and the only safe default: a missing field must never be read as
 * "hide this site", or a schema slip would quietly de-index every customer.
 */
export function isSearchDiscouraged(
  host: SearchIndexingHost | null | undefined,
): boolean {
  return host?.seo?.discourageSearchEngines === true
}

/**
 * Whether a screen may be indexed on its own merits, ignoring the site-level
 * switch.
 *
 * Only `PUBLIC` — and an absent value, which every screen predating the
 * visibility model carries — is indexable. Everything else is excluded, and
 * that is wider than the old `=== UNLISTED` test on purpose: a
 * password-protected, members-only or private screen has nothing a crawler
 * can reach, so listing it in a sitemap published a URL that answers with a
 * gate. `UNLISTED` was the only one anyone remembered because it is the only
 * one whose *name* is about search.
 */
export function isScreenIndexable(
  screen: SearchIndexingScreen | null | undefined,
): boolean {
  const visibility = screen?.visibility
  if (visibility == null) return true
  return visibility === HostScreenVisibility.PUBLIC
}

/** Both controls together — what a render surface actually wants to know. */
export function isPageIndexable(options: {
  host?: SearchIndexingHost | null
  screen?: SearchIndexingScreen | null
}): boolean {
  if (isSearchDiscouraged(options.host)) return false
  return isScreenIndexable(options.screen)
}

/**
 * The `robots.txt` body for a host.
 *
 * When search is discouraged the file disallows everything AND the pages
 * carry `noindex`, which reads like a contradiction and is not. `Disallow`
 * only asks a crawler not to FETCH; a URL linked from elsewhere can still be
 * indexed without ever being fetched, and a crawler that obeys the disallow
 * never sees the `noindex` that would have stopped it. Belt and braces is the
 * documented remedy, and it is what every other builder's equivalent switch
 * does.
 *
 * The `Sitemap:` line is dropped in that state rather than kept: handing a
 * crawler an index of the site you just asked it not to crawl is the
 * contradiction the rest of this module exists to remove.
 */
export function buildRobotsTxt(options: {
  host?: SearchIndexingHost | null
  /** Absolute origin (no trailing slash); omitted when unresolvable. */
  origin?: string
}): string {
  if (isSearchDiscouraged(options.host)) {
    return 'User-agent: *\nDisallow: /\n'
  }
  return (
    'User-agent: *\nAllow: /\n' +
    (options.origin ? `Sitemap: ${options.origin}/sitemap.xml\n` : '')
  )
}
