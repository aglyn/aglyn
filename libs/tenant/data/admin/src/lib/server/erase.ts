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

import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from './firebase-admin'

/**
 * Permanently erase a single site and everything it owns (AGL-488).
 * Unlike deleting the host doc alone (which orphans data), this cleans up
 * every trailing reference:
 *   - Storage objects under `hosts/{hostId}/` (media, CDN variants),
 *   - the `hostIndex/{hostId}` routing entry (subdomain/cname resolution),
 *   - the owning org's `hosts` routing-map entry, and
 *   - the host's Firestore tree (screens, layouts, versions, counters, …)
 *     via `recursiveDelete`.
 *
 * Shared by the self-serve delete-site route and the org-erasure pipeline
 * (AGL-487). Fail-soft on Storage/index cleanup so a partial failure never
 * blocks the Firestore delete; safe to re-run.
 */
export async function eraseHost(hostId: string): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  const orgId = hostSnapshot.get('orgId') as string | undefined

  // Storage first (best-effort — the object tree is derived, regenerable).
  try {
    await firebaseAdmin
      .app()
      .storage()
      .bucket()
      .deleteFiles({ prefix: `hosts/${hostId}/` })
  } catch (error) {
    console.error(`eraseHost: storage cleanup failed for ${hostId}`, error)
  }

  // Routing: the middleware resolves a request to a host via hostIndex and
  // the owning org's hosts map — drop both so the subdomain/cname 404s.
  await firestore
    .collection('hostIndex')
    .doc(hostId)
    .delete()
    .catch(() => undefined)
  if (orgId) {
    await firestore
      .collection('orgs')
      .doc(orgId)
      .set({ hosts: { [hostId]: FieldValue.delete() } }, { merge: true })
      .catch(() => undefined)
  }

  // The host document tree (screens/layouts/versions/counters/products/…).
  await firestore.recursiveDelete(hostRef)
}
