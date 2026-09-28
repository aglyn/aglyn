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

/**
 * Which live pages a content collection's change makes stale (AGL-3340).
 *
 * Two callers ask, from two runtimes. The console asks when somebody saves,
 * publishes, schedules, re-dates or deletes an entry, and announces the answer
 * to the tenant over the shared secret. The tenant asks when a SCHEDULED entry
 * comes due, which is a change nobody makes: no write from the console, no
 * request, only the clock — so the tenant's own beat has to find the pages and
 * drop them in process. Two copies of this answer are how a scheduled post
 * would come to reach `/blog` and miss the home page's rail, so it is here and
 * both import it.
 *
 * Reads only. Announcing is the caller's, for the reason
 * `dataset-live-pages.ts` gives: the two runtimes drop caches differently.
 */

import {
  COLLECTION_CATEGORIES_MAX,
  COLLECTION_LIST_PAGE_SIZE,
  COLLECTION_SOURCE_MAX,
  collectionCategorySlug,
  collectionListUrl,
  hostCollectionKind,
  screenRoutePathToUrl,
} from '@aglyn/aglyn/server'
import type { Firestore } from 'firebase-admin/firestore'
import type { DatasetLivePageTarget } from './dataset-live-pages'
import {
  readUsageSources,
  screenIdsUsingCollectionDeep,
} from './live-page-usage'

/**
 * How many documents per collection the placement scan reads.
 *
 * The number every other cache-dropping scan uses, for their reason
 * (AGL-1161): this decides which caches get dropped, so a prefix scan reports
 * a refreshed site and leaves real pages stale. When the bound bites it is
 * returned as `truncated`, never absorbed.
 */
export const COLLECTION_SCAN_LIMIT = 2000

export interface CollectionLivePageScope {
  /**
   * Site-absolute addresses derived from the collection's slug — the entry
   * pages, the listing and its pages, each category listing — most important
   * first, because the tenant's path cap keeps the FIRST paths it is handed.
   */
  paths: string[]
  /** Screens that render the collection somewhere else, by id. */
  screenIds: string[]
  /** The placement scan read fewer documents than the site holds. */
  truncated: boolean
}

/**
 * What an entry change makes stale, for one content collection.
 *
 * A content entry is not published through a version pointer, so nothing here
 * looks like the publish paths above: the write is a client Firestore write,
 * and the page that renders it is reached by ADDRESS rather than by a screen
 * document. `/blog`, `/blog/page/2`, `/blog/category/guides` and
 * `/blog/my-post` are served by the catch-all's collection fallback, which may
 * have no screen of its own at all, so a routing-map lookup finds nothing to
 * drop and the site keeps serving the old post.
 *
 * Two halves, therefore, and both are needed:
 *
 * - the collection's own ADDRESSES, derived here from its slug;
 * - the SCREENS that render the collection somewhere else — a rail on the
 *   home page, category pills in a layout — which are found by searching node
 *   trees, exactly as a form's placements are.
 *
 * Refuses anything that is not a CONTENT collection. Commerce shares
 * `hosts/{hostId}/collections`, and a product collection's pages are routed by
 * the store's templates rather than by these shapes, so building content
 * addresses from one would drop paths that belong to nothing.
 */
export async function collectionLivePageScope(options: {
  firestore: Firestore
  hostId: string
  collectionId: string
  entrySlugs: readonly string[]
}): Promise<CollectionLivePageScope> {
  const { firestore, hostId, collectionId, entrySlugs } = options
  const empty: CollectionLivePageScope = {
    paths: [],
    screenIds: [],
    truncated: false,
  }
  const collectionSnapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('collections')
    .doc(collectionId)
    .get()
  if (!collectionSnapshot.exists) return empty
  const data = collectionSnapshot.data() ?? {}
  if (hostCollectionKind(data) !== 'content') return empty
  if (data['deletedAt']) return empty
  const collectionSlug = String(data['slug'] ?? '').trim()
  if (!collectionSlug || collectionSlug.includes('/')) return empty

  /**
   * Ordered by how much each address matters, because the tenant's path cap
   * takes the FIRST `MAX_PATHS` it is handed. A site whose collection is
   * rendered on more pages than the cap admits therefore loses its deepest
   * category listings rather than the post that was just edited.
   */
  const paths: string[] = []
  const add = (path: string) => {
    if (path && !paths.includes(path)) paths.push(path)
  }

  // The entry's own address first — the one page whose author is watching.
  // Both slugs when a save renamed it: the new address has never been
  // rendered, and the OLD one is a cached page that now belongs to nothing.
  for (const entrySlug of entrySlugs) add(`/${collectionSlug}/${entrySlug}`)
  add(collectionListUrl({ collectionSlug }))

  /**
   * Every page of the unfiltered listing that the CACHED read covers.
   *
   * A constant range rather than a count-derived one: dropping a page that
   * does not exist is a cache-key delete against a key nothing holds, which
   * costs nothing, while asking Firestore for the exact page count would trade
   * that for a read on every save and still be wrong the moment publishing an
   * entry adds a page.
   *
   * It used to be the whole range, because `COLLECTION_SOURCE_MAX` bounded the
   * LIVE SET and not merely one read of it — a listing had no eleventh page to
   * miss. AGL-3213 ended that: the constant still bounds the cached head every
   * listing address shares, but the collection now runs past it, and a page
   * that starts beyond the head is served by its own window read at its own
   * address.
   *
   * The range deliberately did not follow it there. `MAX_PATHS` takes the
   * FIRST paths it is handed, so extending this to a collection's real page
   * count would spend the budget on pages almost nobody opens and drop the
   * dependent screens below instead — and those deep pages are exactly the
   * ones whose entries did not change. They catch up on their own ISR window,
   * which is the argument the category listings below already make for
   * themselves.
   *
   * Since AGL-3219 there is nothing for them to catch up ON. A deep page is
   * addressed by the entry it continues from, so publishing at the head of
   * the collection does not change which entries it holds — a stale cursor
   * page is merely old, never wrong. It was POSITIONAL addressing that made
   * this lag visible: the head refreshed here, the tail did not, and the two
   * then disagreed by exactly the one entry that had been inserted above
   * them both.
   */
  const listPages = Math.ceil(COLLECTION_SOURCE_MAX / COLLECTION_LIST_PAGE_SIZE)
  for (let page = 2; page <= listPages; page += 1) {
    add(collectionListUrl({ collectionSlug, page }))
  }

  /**
   * Page one of every category listing.
   *
   * Every category rather than the changed entry's, because an entry can move
   * between two in one save and a delete leaves no entry to ask — so the set
   * that is certainly right is the collection's own, and it is bounded by
   * `COLLECTION_CATEGORIES_MAX`. Page one only: the same range applied to each
   * category is `COLLECTION_CATEGORIES_MAX` times as many paths as the
   * unfiltered listing, which would push the cap over on the categories alone
   * and take the dependent screens with it. Deeper category pages catch up on
   * their own ISR window.
   */
  const categories = Array.isArray(data['categories']) ? data['categories'] : []
  for (const category of categories.slice(0, COLLECTION_CATEGORIES_MAX)) {
    const name = String((category as { name?: unknown })?.name ?? '').trim()
    if (!name) continue
    const categorySlug = collectionCategorySlug(name)
    if (!categorySlug) continue
    add(collectionListUrl({ collectionSlug, categorySlug }))
  }

  const sources = await readUsageSources(
    firestore.collection('hosts').doc(hostId),
    COLLECTION_SCAN_LIMIT,
  )
  return {
    paths,
    screenIds: screenIdsUsingCollectionDeep(collectionSlug, sources.candidates),
    truncated: sources.truncated,
  }
}

/**
 * The same scope as ONE site's drop target: the collection's addresses with
 * the dependent screens resolved through the routing map, in the shape a
 * `LivePageDropper` takes.
 *
 * `null` when there is nothing to drop — a site with no subdomain has no
 * tenant deployment holding pages, and a collection that is gone or is the
 * store's has no content addresses.
 */
export async function collectionLivePageTarget(options: {
  firestore: Firestore
  hostId: string
  collectionId: string
  entrySlugs: readonly string[]
}): Promise<DatasetLivePageTarget | null> {
  const { firestore, hostId } = options
  const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
  if (!hostSnapshot.exists) return null
  const subdomain = String(hostSnapshot.get('subdomain') ?? '')
  if (!subdomain) return null

  const scope = await collectionLivePageScope(options)
  const screens = (hostSnapshot.get('screens') ?? {}) as Record<string, string>
  // The derived addresses lead, as they do on the console route: they are the
  // pages the change is about, and the cap keeps what it is handed first.
  const paths = [
    ...scope.paths,
    ...scope.screenIds
      .map((screenId) => screens[screenId])
      .filter((path): path is string => Boolean(path))
      .map((path) => screenRoutePathToUrl(path)),
  ].filter((path, index, all) => all.indexOf(path) === index)
  if (!paths.length) return null

  const cname = String(hostSnapshot.get('cname') ?? '')
  return {
    hostId,
    subdomain,
    ...(cname ? { cname } : {}),
    paths,
    truncated: scope.truncated,
  }
}
