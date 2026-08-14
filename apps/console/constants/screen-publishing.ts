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

import type { HostUid, ScreenUid } from '@aglyn/aglyn'
import {
  isFirstPublishedRoute,
  trackEvent,
} from '@aglyn/aglyn/app-utils/analytics-events'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  deleteField,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'

/**
 * Publishes a screen route: stores the screen's OWN slug segment on the
 * screen doc and registers the fully COMPOSED path (ancestor segments +
 * own, see `composeScreenRoutePath`) in the host's `screens` routing map —
 * the map is what the tenant site matches request paths against, so a
 * screen without an entry is unreachable. Dotted field paths keep sibling
 * map entries untouched. `path` defaults to `slug` for parent-less screens.
 */
export async function publishScreenRoute(
  firestore: Firestore,
  ids: { hostId: HostUid; screenId: ScreenUid },
  slug: string,
  path: string = slug,
): Promise<void> {
  const { hostId, screenId } = ids
  // Read the routing map BEFORE writing to it (AGL-1588). `first_publish`
  // asks what the map looked like a moment ago, and a moment later it can
  // never be empty. One extra document read on a rare, deliberate, already
  // multi-write action; the alternative was threading the map through six
  // call sites as an optional argument, where a surface that forgot it would
  // simply report nothing and look identical to one that answered `false`.
  //
  // Left `undefined` when the read fails: the param is optional, the
  // sanitizer drops undefined, and one hit with no breakdown value is better
  // than one asserting a `false` nobody checked.
  let firstPublish: boolean | undefined
  try {
    const hostSnapshot = await getDoc(doc(firestore, 'hosts', hostId))
    firstPublish = isFirstPublishedRoute(
      hostSnapshot.get('screens') as Record<string, unknown> | undefined,
    )
  } catch {
    firstPublish = undefined
  }
  await Promise.all([
    // `publishedAt` records when the route went live; it rides the same merge
    // as the slug so publishing stamps it in one write (cleared on unpublish).
    setDoc(
      doc(firestore, 'hosts', hostId, 'screens', screenId),
      { slug, publishedAt: Timestamp.now() },
      { merge: true },
    ),
    updateDoc(doc(firestore, 'hosts', hostId), {
      [`screens.${screenId}`]: path,
    }),
  ])
  // "% who publish a site" — the GTM plan's headline activation metric
  // (AGL-1561). Fired HERE, at the routing-map write, rather than at each of
  // the five publish buttons: registering a path in the host's `screens` map
  // IS what makes a page reachable on the live site, so every surface that
  // publishes a route passes through this function and no new publish button
  // can be added that quietly forgets to be counted.
  //
  // Deliberately NOT fired for a version-pointer republish (swapping which
  // saved version a live route serves). That is a content update to a site
  // that is already published, and counting it here would let one activated
  // org look like many, which is the opposite of what an activation rate is
  // for. Only a route going live counts.
  //
  // No ids in the payload: the metric is "did this user ever publish", which
  // GA answers from the event alone, and a host id would be a resource
  // identifier bought for nothing.
  //
  // `first_publish` (AGL-1588) is the one param worth the space, and it is
  // registered as a custom dimension. It separates "the site came alive" from
  // "a page was added to a live site" — which is the difference between the
  // GTM §6 activation metric and a publish count, and is not back-fillable:
  // a publish that already happened cannot be re-reported as a first one.
  // See `isFirstPublishedRoute` for what all three publish paths mean by it.
  trackEvent('site_published', { first_publish: firstPublish })
}

/**
 * Applies a set of routing-map changes in one write: a `path` string sets
 * the entry, `null` removes it. Used to cascade descendant path rewrites
 * when a screen's slug or parent changes (hierarchical slugs).
 */
export async function syncScreenRouteEntries(
  firestore: Firestore,
  hostId: HostUid,
  entries: Record<ScreenUid, string | null>,
): Promise<void> {
  if (!Object.keys(entries).length) return
  const updates: Record<string, unknown> = {}
  for (const [screenId, path] of Object.entries(entries)) {
    updates[`screens.${screenId}`] = path ?? deleteField()
  }
  await updateDoc(doc(firestore, 'hosts', hostId), updates)
}

/**
 * Removes a screen's routing-map entry (and its stored slug when
 * `clearSlug`), making the path 404 after the tenant's ISR revalidate.
 * Used on unpublish and on screen delete.
 */
export async function unpublishScreenRoute(
  firestore: Firestore,
  ids: { hostId: HostUid; screenId: ScreenUid },
  options?: { clearSlug?: boolean },
): Promise<void> {
  const { hostId, screenId } = ids
  await Promise.all([
    updateDoc(doc(firestore, 'hosts', hostId), {
      [`screens.${screenId}`]: deleteField(),
    }),
    // Drop `publishedAt` too (the route is no longer live), and the slug when
    // asked. Always writes the screen doc now so an unpublished screen never
    // keeps a stale published date.
    setDoc(
      doc(firestore, 'hosts', hostId, 'screens', screenId),
      {
        publishedAt: deleteField(),
        ...(options?.clearSlug ? { slug: deleteField() } : {}),
      },
      { merge: true },
    ),
  ])
}
