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

import { createResourceUid } from '@aglyn/aglyn'
import {
  SYSTEM_EMAIL_COLLECTION,
  buildDefaultEmailNodeMap,
  type SystemEmailTemplateDefinition,
} from '@aglyn/shared-util-email'
import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore'

/**
 * Resolves the version a staff editor should open for a system email,
 * creating one on first edit (AGL-749).
 *
 * There is no "new system email" action anywhere — the catalog is code, so
 * a template document only ever comes into existence because somebody
 * pressed Edit. That makes this the create path as well as the open path.
 *
 * The version document is written BEFORE the pointer on the template. A
 * failure between the two leaves an orphan version, which nothing reads;
 * the other order would leave the template pointing at a version that does
 * not exist, which is a 404 in the editor.
 *
 * "Reset to default" nulls the pointer rather than deleting anything
 * (AGL-748), so editing after a reset deliberately starts a fresh version
 * instead of resurrecting the design that was reset away.
 */
export async function openSystemEmailVersion(
  firestore: Firestore,
  definition: SystemEmailTemplateDefinition,
): Promise<string> {
  const templateRef = doc(firestore, SYSTEM_EMAIL_COLLECTION, definition.key)
  const snapshot = await getDoc(templateRef)
  const existing = snapshot.exists()
    ? (snapshot.get('versionId') as string | undefined)
    : undefined
  if (existing) return existing

  const versionId = createResourceUid()
  const timestamp = Timestamp.now()
  await setDoc(
    doc(templateRef, 'versions', versionId),
    {
      templateKey: definition.key,
      createdAt: timestamp,
      updatedAt: timestamp,
      // Same builder the send-time default render uses (AGL-766), so the
      // version staff open is exactly what a test/send produces.
      nodes: buildDefaultEmailNodeMap(definition),
    },
  )
  await setDoc(
    templateRef,
    {
      // Seeded from the catalog so the first save does not silently ship an
      // empty subject line to a customer.
      subject: snapshot.get('subject') ?? definition.defaultSubject,
      versionId,
      updatedAt: timestamp,
    },
    { merge: true },
  )
  return versionId
}

export default openSystemEmailVersion
