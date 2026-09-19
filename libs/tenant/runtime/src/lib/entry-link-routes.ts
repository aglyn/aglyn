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

import {
  collectionEntryRoutePath,
  formatEntryLinkValue,
  parseEntryLinkValue,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import {
  isDueScheduled,
  isLive,
  isPendingScheduled,
  type SchedulePermission,
  scheduledPublishingPermission,
} from './get-collection-content'

/**
 * The most entries one page's links are resolved for (AGL-3118).
 *
 * A real page names a handful — a "read next" row, the links in a post — so
 * this is not a budget anything should approach. It is the bound on what one
 * pathological page can cost: a single batched read of at most this many
 * documents per regeneration. Past it, the keys that sort last are not read,
 * and their links render as plain text.
 */
export const ENTRY_LINK_ROUTES_MAX = 100

/**
 * The fields an entry link is decided from: whether the entry is live (the
 * three `isLive` reads) and where it is served (its slug). Projected, because
 * an entry document carries its whole body and a link needs none of it.
 */
const ENTRY_LINK_FIELDS = ['status', 'publishAt', 'scheduleStatus', 'slug']

/**
 * A document id Firestore will address. A reference is authored data, and
 * one id `getAll` refuses fails the whole batch, which would take every
 * other entry link on the page down with it.
 */
function isAddressableId(id: string): boolean {
  return (
    id.length <= 500 && id !== '.' && id !== '..' && !/^__.*__$/.test(id)
  )
}

/** One referenced entry, by its canonical key and the ids it names. */
interface EntryLinkTarget {
  key: string
  collectionId: string
  entryId: string
}

/** What the cached read answers — plain data, so a hit equals a miss. */
interface EntryLinkFacts {
  /** Entry key → the entry's slug, for each referenced entry that is live. */
  slugs: Record<string, string>
  /**
   * The read saw an entry whose liveness will change with no write — a
   * schedule still waiting on its time, or a due one whose plan could not be
   * read — so the answer is served but not stored.
   */
  unsettled?: boolean
}

/**
 * The live slugs of exactly these entries: one batched `getAll` of the
 * documents, projected to {@link ENTRY_LINK_FIELDS}. Throws on a failed
 * read, so the failure is never stored.
 */
async function readEntryLinkFacts(
  hostId: string,
  targets: readonly EntryLinkTarget[],
): Promise<EntryLinkFacts> {
  const firestore = firebaseAdmin.app().firestore()
  const collections = firestore
    .collection('hosts')
    .doc(hostId)
    .collection('collections')
  const refs = targets.map(({ collectionId, entryId }) =>
    collections.doc(collectionId).collection('entries').doc(entryId),
  )
  // Snapshots come back in the order the references were asked in.
  const snapshots = await firestore.getAll(...refs, {
    fieldMask: ENTRY_LINK_FIELDS,
  })
  const values = snapshots.map((snapshot) =>
    snapshot.exists ? (snapshot.data() ?? null) : null,
  )
  // The plan is read only when one of these entries is due, as on the entry's
  // own route — which is almost never.
  const due = values.some((value) => value !== null && isDueScheduled(value))
  const permission: SchedulePermission = due
    ? await scheduledPublishingPermission(hostId)
    : 'allowed'
  const slugs: Record<string, string> = {}
  values.forEach((value, index) => {
    const key = targets[index]?.key
    if (!key || !value || !isLive(value, permission)) return
    const slug = typeof value['slug'] === 'string' ? value['slug'].trim() : ''
    // The entry route matches one path segment against `slug`, so an entry
    // with none — or with a slash in it — has no address to link to.
    if (slug && !slug.includes('/')) slugs[key] = slug
  })
  const unsettled =
    values.some((value) => value !== null && isPendingScheduled(value)) ||
    (due && permission === 'unresolved')
  return unsettled ? { slugs, unsettled: true } : { slugs }
}

/**
 * Where each entry a page's links name is served now (AGL-3118): entry key
 * → `{collectionSlug}/{entrySlug}`, the map format `linkableScreenRoutes`
 * takes as `entryRoutes`.
 *
 * Only LIVE entries answer — published, or scheduled and due on a plan that
 * allows it, judged by the same `isLive` as the entry's own route — so a
 * link can never offer a page that route would 404. A draft, an unpublished
 * or a deleted entry is simply absent, and its links render inert.
 *
 * The reads are the minimum the question allows:
 *
 * - NONE for a page that names no entry, the common case — nor for
 *   references whose collection has no listing, which no read could route;
 * - otherwise ONE batched read of exactly the named documents (at most
 *   {@link ENTRY_LINK_ROUTES_MAX}), cached like the rest of the site's
 *   published data: keyed by the host and the sorted key set, busted by the
 *   `tenant-data:{hostId}` tag an entry save announces, and held for the
 *   same window as every other published read;
 * - and none for the collections' slugs, which the caller hands over from
 *   the routing read the render already made. Only the ENTRY facts are
 *   cached, and the path is assembled per call, so a renamed collection
 *   moves its entries' links as soon as the routing read has the new slug.
 *
 * Fails open to `{}` — a failed read renders inert links, never a 500 — and
 * the failure is not cached, so the next render asks again.
 */
export async function resolveEntryLinkRoutes(options: {
  hostId: string
  /** Entry keys, as `collectEntryLinkRefs` answers them. */
  refs: readonly string[]
  /** Content collection id → slug: the routing read's `collectionListings`. */
  collectionSlugs: Record<string, string> | null | undefined
}): Promise<Record<string, string>> {
  const { hostId, collectionSlugs } = options
  if (!hostId || !collectionSlugs) return {}
  const slugOf = (collectionId: string): string => {
    const slug = collectionSlugs[collectionId]
    return typeof slug === 'string' ? slug.trim() : ''
  }
  const targets = new Map<string, EntryLinkTarget>()
  for (const ref of options.refs) {
    const entry = parseEntryLinkValue(ref)
    if (!entry || !slugOf(entry.collectionId)) continue
    if (!isAddressableId(entry.collectionId) || !isAddressableId(entry.entryId)) {
      continue
    }
    const key = formatEntryLinkValue(entry.collectionId, entry.entryId)
    targets.set(key, { key, ...entry })
  }
  if (!targets.size) return {}
  const wanted = [...targets.keys()].sort().slice(0, ENTRY_LINK_ROUTES_MAX)
  try {
    const facts = await withRenderCache<EntryLinkFacts>({
      // One key part for the whole set, so no two sets can join to the same
      // string.
      key: ['tenant-entry-link-routes', hostId, JSON.stringify(wanted)],
      revalidate: PUBLISHED_SITE_DATA_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read: () =>
        readEntryLinkFacts(
          hostId,
          wanted.flatMap((key) => targets.get(key) ?? []),
        ),
      store: (value) => !value.unsettled,
    })
    const routes: Record<string, string> = {}
    for (const [key, entrySlug] of Object.entries(facts?.slugs ?? {})) {
      const entry = parseEntryLinkValue(key)
      const collectionSlug = entry ? slugOf(entry.collectionId) : ''
      if (!collectionSlug) continue
      routes[key] = collectionEntryRoutePath(collectionSlug, entrySlug)
    }
    return routes
  } catch (error) {
    console.error('entry link lookup failed:', error)
    return {}
  }
}

export default resolveEntryLinkRoutes
