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
  deleteField,
  doc,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'

/**
 * Publishes a screen route: stores the slug on the screen doc and registers
 * the path in the host's `screens` routing map — the map is what the tenant
 * site matches request paths against, so a screen without an entry is
 * unreachable. Dotted field paths keep sibling map entries untouched.
 */
export async function publishScreenRoute(
  firestore: Firestore,
  ids: { hostId: HostUid; screenId: ScreenUid },
  path: string,
): Promise<void> {
  const { hostId, screenId } = ids
  await Promise.all([
    setDoc(
      doc(firestore, 'hosts', hostId, 'screens', screenId),
      { slug: path },
      { merge: true },
    ),
    updateDoc(doc(firestore, 'hosts', hostId), {
      [`screens.${screenId}`]: path,
    }),
  ])
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
    options?.clearSlug
      ? setDoc(
          doc(firestore, 'hosts', hostId, 'screens', screenId),
          { slug: deleteField() },
          { merge: true },
        )
      : Promise.resolve(),
  ])
}
