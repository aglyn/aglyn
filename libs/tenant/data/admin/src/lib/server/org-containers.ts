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

import { pluginContainerKind } from '@aglyn/aglyn/plugin-manager/plugin-containers'
import { isDocumentId } from './document-id'

/**
 * AN ORGANIZATION'S CONTAINERS OF ONE KIND, read on the server by a plugin
 * that files its records under them and does not keep them.
 *
 * A container kind is declared by the plugin that keeps it
 * (`plugin-manager/plugin-containers.ts`): which org collection holds the
 * containers and which field names one. That declaration is the whole of what
 * another plugin may rely on — a container's id, its name, the sites its
 * `visibleTo` places it on, and whether its owner retired it (`deletedAt`) —
 * and this module reads exactly that, where the declaration says. A sequence
 * that validates the campaigns it is filed under, an import that matches
 * campaign names, a timeline entry that names the campaign a lead was filed
 * under: none of them names the owner's collection, so the owner may move it.
 *
 * A kind no plugin keeps reads nothing: every id answers as gone, and a list
 * is empty. That is the honest answer for a workspace without the owner.
 */

/** One container, as much of it as a plugin that files under it may read. */
export interface OrgContainerRecord {
  id: string
  /** The org holds a container under this id, retired or not. */
  exists: boolean
  /** It exists and its owner has not retired it. */
  live: boolean
  /** Its name, from the field its kind declares; `''` when it has none or is gone. */
  name: string
  /** Its `visibleTo` scope tokens; `[]` when it has none or is gone. */
  visibleTo: string[]
}

type Snapshot = Pick<FirebaseFirestore.DocumentSnapshot, 'exists' | 'get'>

function recordOf(id: string, snapshot: Snapshot | undefined, nameField: string): OrgContainerRecord {
  if (!snapshot?.exists) return { id, exists: false, live: false, name: '', visibleTo: [] }
  const visibleTo = snapshot.get('visibleTo')
  return {
    id,
    exists: true,
    live: !snapshot.get('deletedAt'),
    name: String(snapshot.get(nameField) ?? '').trim(),
    visibleTo: Array.isArray(visibleTo) ? visibleTo.map(String) : [],
  }
}

/**
 * The fields a reader may rely on, and the only ones a listing reads: a
 * container can be a large document, and nothing here needs the rest.
 */
const fieldsOf = (nameField: string) => [nameField, 'deletedAt', 'visibleTo']

/** The kind's collection under the org, or `null` when no plugin keeps the kind. */
function containersOf(
  firestore: FirebaseFirestore.Firestore,
  kind: string,
  orgId: string,
): { ref: FirebaseFirestore.CollectionReference; nameField: string } | null {
  const declared = pluginContainerKind(kind)
  if (!declared || !isDocumentId(orgId)) return null
  return {
    ref: firestore.collection('orgs').doc(orgId).collection(declared.orgCollection),
    nameField: declared.nameField,
  }
}

/**
 * The containers named by `ids`, one record per id in the order asked: one
 * keyed read each, in a single `getAll`. An id that cannot be a document id
 * is answered as gone without a read.
 *
 * Throws what the read throws; a caller that must not fail on it catches.
 */
export async function readOrgContainers(
  firestore: FirebaseFirestore.Firestore,
  kind: string,
  orgId: string,
  ids: readonly string[],
): Promise<OrgContainerRecord[]> {
  if (!ids.length) return []
  const containers = containersOf(firestore, kind, orgId)
  const readable = ids.filter((id) => isDocumentId(id))
  if (!containers || !readable.length) return ids.map((id) => recordOf(id, undefined, ''))
  // `getAll` answers in the order asked, so each snapshot is matched to its
  // id by position rather than by a field of the snapshot.
  const found = await firestore.getAll(...readable.map((id) => containers.ref.doc(id)))
  const byId = new Map(readable.map((id, index) => [id, found[index]]))
  return ids.map((id) => recordOf(id, byId.get(id), containers.nameField))
}

/**
 * Up to `ceiling` of the organization's containers of a kind, in document
 * order, retired ones included and marked: a caller that matches by name
 * decides what a retired one means to it. Read as a projection of the
 * fields a record carries.
 */
export async function listOrgContainers(
  firestore: FirebaseFirestore.Firestore,
  kind: string,
  orgId: string,
  ceiling: number,
): Promise<OrgContainerRecord[]> {
  const containers = containersOf(firestore, kind, orgId)
  if (!containers || ceiling <= 0) return []
  const snapshot = await containers.ref
    .select(...fieldsOf(containers.nameField))
    .limit(ceiling)
    .get()
  return snapshot.docs.map((doc) => recordOf(doc.id, doc, containers.nameField))
}

/**
 * Up to `limit` of the organization's containers of a kind whose declared
 * name field is exactly `name`, retired ones included and marked, so a caller
 * resolving a name can tell a live match from a retired one sharing it.
 */
export async function findOrgContainersByName(
  firestore: FirebaseFirestore.Firestore,
  kind: string,
  orgId: string,
  name: string,
  limit: number,
): Promise<OrgContainerRecord[]> {
  const containers = containersOf(firestore, kind, orgId)
  const wanted = name.trim()
  if (!containers || !wanted || limit <= 0) return []
  const snapshot = await containers.ref
    .where(containers.nameField, '==', wanted)
    .select(...fieldsOf(containers.nameField))
    .limit(limit)
    .get()
  return snapshot.docs.map((doc) => recordOf(doc.id, doc, containers.nameField))
}
