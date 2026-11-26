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

import { parseCollectionRoute } from './collection-entries'
import { findScreenIdByRoutePath } from './screen-route'
import { SCREEN_ROOT_PATH } from './screen-slug'

/**
 * Which page of a site a counted path is, for the Analytics page's Pages
 * table (AGL-4253).
 *
 * ## Why paths and not screens
 *
 * The table grouped by SCREEN (`screenAnalytics/{screenId}:{day}`), and every
 * product, store collection and blog post renders through ONE template
 * screen. So a store with forty products showed one row, `cr-product 145`,
 * and nobody could say which product was looked at. The host day-doc's
 * `paths` map is per URL — exactly a record's granularity — so it is the
 * source here, and the template is only how a path gets its LABEL.
 *
 * ## The order is the site loader's
 *
 * A path is answered the way `load-page-data.ts` answers it: a routed screen
 * first (unless that screen is a template, which the loader drops from the
 * routing map), then a plugin's records (`/products/{slug}`), then a content
 * collection's list or entry. Classifying in any other order would label a
 * page as something the visitor was never shown.
 */
export type PagePathClass =
  /** A page the platform or a plugin serves at a fixed address: sign-in. */
  | { kind: 'builtIn'; title: string }
  /** One of the site's own pages, routed at this path. */
  | { kind: 'page'; screenId: string }
  /** A plugin's record page: `/{segment}/{slug}`. */
  | { kind: 'record'; segment: string; slug: string }
  /** A content collection's list, or one of its paged / category lists. */
  | { kind: 'collectionList'; collectionSlug: string }
  /** One entry of a content collection: `/{collection}/{entry}`. */
  | { kind: 'entry'; collectionSlug: string; entrySlug: string }
  /** Nothing on the site answers this path now. */
  | { kind: 'other' }

export interface PagePathContext {
  /** The host doc's routing map: screen id → route path (`/` or `a/b`). */
  routes: Record<string, string> | null | undefined
  /** Screens a collection or the store renders records through. */
  templateScreenIds: ReadonlySet<string>
  /** Path segments a plugin serves records under (`products`). */
  recordSegments: ReadonlySet<string>
  /** Slugs of the site's content collections. */
  contentCollectionSlugs: ReadonlySet<string>
  /**
   * Pages a plugin serves at a fixed address (`order-status` → `Order
   * status`). The core's own sign-in pages are always included.
   */
  builtInPages?: ReadonlyMap<string, string>
}

/**
 * The pages every site serves at a fixed address, ahead of its own routing
 * map (`load-page-data.ts` answers these first): a visit there is a real page,
 * never an address "nothing answers".
 */
export const CORE_BUILT_IN_PAGES: ReadonlyMap<string, string> = new Map([
  ['signin', 'Sign in'],
  ['signup', 'Sign up'],
  ['recover', 'Reset password'],
])

/**
 * A counted path in the form the routing map stores: no leading or trailing
 * slash, the root as {@link SCREEN_ROOT_PATH}. Counts are keyed by
 * `analyticsPathKey`, which already folded the unsafe characters.
 */
export function normalizeCountedPath(path: string): string {
  const trimmed = String(path ?? '')
    .split('?')[0]
    .replace(/^\/+|\/+$/g, '')
  return trimmed || SCREEN_ROOT_PATH
}

/** The path as a visitor types it: always one leading slash. */
export function displayCountedPath(path: string): string {
  const normalized = normalizeCountedPath(path)
  return normalized === SCREEN_ROOT_PATH ? '/' : `/${normalized}`
}

export function classifyPagePath(
  path: string,
  context: PagePathContext,
): PagePathClass {
  const normalized = normalizeCountedPath(path)
  const core = CORE_BUILT_IN_PAGES.get(normalized)
  if (core) return { kind: 'builtIn', title: core }
  const screenId = findScreenIdByRoutePath(context.routes as never, normalized)
  if (screenId && !context.templateScreenIds.has(screenId)) {
    return { kind: 'page', screenId }
  }
  if (normalized === SCREEN_ROOT_PATH) return { kind: 'other' }
  const declared = context.builtInPages?.get(normalized)
  if (declared) return { kind: 'builtIn', title: declared }
  const segments = normalized.split('/')
  if (segments.length === 2 && context.recordSegments.has(segments[0])) {
    return { kind: 'record', segment: segments[0], slug: segments[1] }
  }
  if (context.contentCollectionSlugs.has(segments[0])) {
    const route = parseCollectionRoute(segments)
    if (route?.entrySlug) {
      return {
        kind: 'entry',
        collectionSlug: route.collectionSlug,
        entrySlug: route.entrySlug,
      }
    }
    if (route) return { kind: 'collectionList', collectionSlug: route.collectionSlug }
  }
  return { kind: 'other' }
}

/**
 * Every path's views over the window, newest counts merged by the path's
 * normalized form — `/shop` and `/shop/` are one page to a visitor and one
 * row here. Zero and negative counts are dropped: a path nobody visited is
 * not listed as visited.
 */
export function rollUpPathViews(
  days: ReadonlyArray<{ paths?: Record<string, number> | null }>,
): Array<{ path: string; views: number }> {
  const totals = new Map<string, number>()
  for (const day of days) {
    for (const [key, count] of Object.entries(day.paths ?? {})) {
      const views = Number(count)
      if (!Number.isFinite(views) || views <= 0) continue
      const path = normalizeCountedPath(key)
      totals.set(path, (totals.get(path) ?? 0) + views)
    }
  }
  return [...totals.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views || (a.path < b.path ? -1 : 1))
}

/** Splits `values` into chunks Firestore's `in` filter accepts (30). */
export function chunkForInQuery<T>(values: readonly T[], size = 30): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}
