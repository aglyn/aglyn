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
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  deleteField,
  doc,
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
