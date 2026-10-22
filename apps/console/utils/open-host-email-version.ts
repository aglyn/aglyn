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

import { createResourceUid, encodeStoredNodes } from '@aglyn/aglyn'
import {
  TENANT_EMAIL_COLLECTION,
  buildDefaultEmailNodeMap,
  type TenantEmailEntry,
} from '@aglyn/shared-util-email'
import {
  Bytes,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore'

/**
 * Resolves the version a site owner should open for one of their site's
 * emails, creating one on first edit (AGL-770). The host-scoped sibling of
 * {@link openSystemEmailVersion}: the template lives at
 * `hosts/{hostId}/emailTemplates/{key}` rather than the staff collection.
 *
 * There is no "new site email" action — the catalog is code, so a template
 * document only exists because somebody pressed Design. The version is written
 * before the pointer, so a crash between the two leaves an orphan version
 * (which nothing reads) rather than a pointer to a missing version (a 404).
 */
export async function openHostEmailVersion(
  firestore: Firestore,
  hostId: string,
  entry: TenantEmailEntry,
): Promise<string> {
  const templateRef = doc(
    firestore,
    'hosts',
    hostId,
    TENANT_EMAIL_COLLECTION,
    entry.key,
  )
  const snapshot = await getDoc(templateRef)
  const existing = snapshot.exists()
    ? (snapshot.get('versionId') as string | undefined)
    : undefined
  if (existing) return existing

  const versionId = createResourceUid()
  const timestamp = Timestamp.now()
  await setDoc(doc(templateRef, 'versions', versionId), {
    templateKey: entry.key,
    createdAt: timestamp,
    updatedAt: timestamp,
    // Same builder the send-time default render uses, so the version a site
    // owner opens is exactly what a send produces before they change anything.
    // Compressed at rest like every other besigner document (AGL-1151); the
    // editor's converter writes the same form from here on, so the seed and
    // the first save agree rather than the document changing encoding under
    // its first edit.
    nodes: Bytes.fromUint8Array(
      encodeStoredNodes(buildDefaultEmailNodeMap(entry))!,
    ),
  })
  await setDoc(
    templateRef,
    {
      subject: snapshot.get('subject') ?? entry.defaultSubject ?? '',
      versionId,
      updatedAt: timestamp,
    },
    { merge: true },
  )
  return versionId
}

export default openHostEmailVersion
