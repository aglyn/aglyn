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

import { hostCollectionKind, screenRoutePathToUrl } from '@aglyn/aglyn/server'
import { collectionLivePageTarget } from '@aglyn/tenant-data-admin/server/collection-live-pages'
import type { Firestore } from 'firebase-admin/firestore'
import { announceLivePaths } from './announce-live-paths'

/**
 * The tenant's own `MAX_PATHS`: a drop naming more is cut there anyway, so
 * the entry reads stop at the same number.
 */
const MAX_PATHS = 250

/**
 * EVERY LIVE ADDRESS A COLLECTION'S SETTINGS DECIDE (AGL-3386).
 *
 * A content entry save names its own entry, and `/api/screens/revalidate`
 * drops that entry's page plus the collection's listings. A change to the
 * COLLECTION — its template screens, its slug, its categories — decides every
 * one of those pages at once: the entry template renders every entry, the
 * list screen renders every listing, and the slug is the first segment of
 * all of them. So the scope here is the same one an entry save uses
 * (`collectionLivePageTarget` — the listing, its cached pages, each category
 * listing and the screens that embed the collection), with EVERY published
 * entry's address in front of it instead of one.
 *
 * Read before a rename as well as after: the addresses a rename moves away
 * from are cached pages that belong to nothing once the slug has changed, and
 * after the write nothing can name them.
 *
 * A catalog collection is the store's, served at `/collections/{slug}` by the
 * commerce resolver; the content scope has nothing to say about it, so its
 * one address is named here.
 */
export async function collectionLivePaths(options: {
  firestore: Firestore
  hostId: string
  collectionId: string
}): Promise<string[]> {
  const { firestore, hostId, collectionId } = options
  const collectionRef = firestore
    .collection('hosts')
    .doc(hostId)
    .collection('collections')
    .doc(collectionId)
  const snapshot = await collectionRef.get()
  if (!snapshot.exists) return []
  const slug = String(snapshot.get('slug') ?? '').trim()
  if (hostCollectionKind(snapshot.data() ?? {}) !== 'content') {
    return slug && !slug.includes('/') ? [`/collections/${slug}`] : []
  }
  // Addresses only: the entry body is the bulk of the document, and nothing
  // here reads it. Stops at the tenant's path cap — an entry page past it
  // catches up on its own ISR window.
  const entries = await collectionRef
    .collection('entries')
    .where('status', '==', 'published')
    .select('slug')
    .limit(MAX_PATHS)
    .get()
  const entrySlugs = entries.docs
    .map((entry) => String(entry.get('slug') ?? '').trim())
    .filter(Boolean)
  const target = await collectionLivePageTarget({
    firestore,
    hostId,
    collectionId,
    entrySlugs,
  })
  return target?.paths ?? []
}

/**
 * Drop the addresses a collection change touched: those it answered before
 * the write, those it answers now, and the routes of any screens the write
 * demoted. Best effort and never throws — the write
 * has landed, and the hour-long window is the backstop.
 */
export async function announceCollectionChange(options: {
  firestore: Firestore
  hostId: string
  collectionId: string
  /** `collectionLivePaths` read BEFORE the write, on a rename. */
  before?: readonly string[]
  /**
   * Screens the write took off their own address — an entry template stops
   * being served at its route — resolved through the routing map here.
   */
  screenIds?: readonly string[]
}): Promise<boolean> {
  const { firestore, hostId, collectionId, before = [], screenIds = [] } =
    options
  try {
    const after = await collectionLivePaths({ firestore, hostId, collectionId })
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    const screens = (hostSnapshot.get('screens') ?? {}) as Record<string, string>
    const retired = screenIds
      .map((screenId) => screens[screenId])
      .filter((path): path is string => typeof path === 'string' && !!path)
      .map((path) => screenRoutePathToUrl(path))
    const paths = [...new Set([...retired, ...before, ...after])].slice(
      0,
      MAX_PATHS,
    )
    if (!paths.length) return false
    return await announceLivePaths({ hostSnapshot, hostId, paths })
  } catch (error) {
    console.error('[announce-collection-change]', hostId, collectionId, error)
    return false
  }
}
