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
  type AdminAuditIndexSource,
  withAdminAuditIndex,
} from '@aglyn/aglyn/app-utils/admin-audit-index'

/*
 * THE ONE DOOR INTO `adminAudit` (AGL-3321).
 *
 * The staff audit page queries each row by the `actionGroup` and
 * `searchTokens` the writer stamped (`withAdminAuditIndex`). A row written
 * without them is a row the Action group filter and the search can never
 * find, while it still lists normally, so the gap would show only as an
 * audit search that quietly misses one entry. Every server write therefore
 * goes through these two functions, and
 * `apps/console/specs/admin-audit-writes-are-stamped.spec.ts` refuses a
 * write to the collection anywhere else.
 *
 * The Firestore instance is the caller's, never looked up here. A route's
 * own handle is the one its spec replaces, and this module imports no
 * Firebase at all, so reaching it costs a caller nothing it did not already
 * load.
 */

export const ADMIN_AUDIT_COLLECTION = 'adminAudit'

/** A batch or a transaction: anything that sets a document. */
type AuditWriter = Pick<FirebaseFirestore.WriteBatch, 'set'> | Pick<FirebaseFirestore.Transaction, 'set'>

/** Add one audit row, stamped. Resolves to the new document's reference. */
export function addAdminAudit<Entry extends AdminAuditIndexSource>(
  firestore: FirebaseFirestore.Firestore,
  entry: Entry,
): Promise<FirebaseFirestore.DocumentReference> {
  return firestore.collection(ADMIN_AUDIT_COLLECTION).add(withAdminAuditIndex(entry))
}

/**
 * Set one new audit row inside a batch or a transaction, stamped, so it
 * commits with the change it records. Returns the new document's reference.
 */
export function setAdminAudit<Entry extends AdminAuditIndexSource>(
  writer: AuditWriter,
  firestore: FirebaseFirestore.Firestore,
  entry: Entry,
): FirebaseFirestore.DocumentReference {
  const ref = firestore.collection(ADMIN_AUDIT_COLLECTION).doc()
  ;(writer as Pick<FirebaseFirestore.WriteBatch, 'set'>).set(ref, withAdminAuditIndex(entry))
  return ref
}
