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
  type AppendOnlyHistoryRow,
  sortHistoryRows,
} from '@aglyn/aglyn/app-utils/append-only-history'
import { FieldValue } from 'firebase-admin/firestore'
import { setAdminAudit } from './admin-audit-write'

/*
 * THE WRITE SIDE OF AN APPEND-ONLY HISTORY (AGL-3959).
 *
 * A row is CREATED, never set over and never updated: `create` fails on an
 * id that exists, so no code path here can rewrite what happened. Each row
 * goes into the caller's batch beside the change it records, and — when a
 * staff member made the change — beside its `adminAudit` row, so the two
 * commit together or not at all. Reused by every approval-gated charge
 * (Site Care extra time now, AGL-3970's project invoices next); the row's
 * shape and rules are `@aglyn/aglyn/app-utils/append-only-history`.
 */

/** A batch or a transaction: anything that creates and sets a document. */
type HistoryWriter =
  | Pick<FirebaseFirestore.WriteBatch, 'create' | 'set'>
  | Pick<FirebaseFirestore.Transaction, 'create' | 'set'>

/** The staff audit row a history row is mirrored to. */
export interface HistoryAudit {
  action: string
  scope: string
  /** A path naming the org, so the staff org page's audit card finds it. */
  target: string
}

/**
 * Creates one history row in the writer, and its audit row beside it when
 * `audit` is given. Returns the new row's reference.
 */
export function appendHistoryRow(
  writer: HistoryWriter,
  firestore: FirebaseFirestore.Firestore,
  history: FirebaseFirestore.CollectionReference,
  row: AppendOnlyHistoryRow,
  audit?: HistoryAudit | null,
): FirebaseFirestore.DocumentReference {
  const ref = history.doc()
  ;(writer as Pick<FirebaseFirestore.WriteBatch, 'create'>).create(ref, row)
  if (audit) {
    setAdminAudit(writer as Pick<FirebaseFirestore.WriteBatch, 'set'>, firestore, {
      actorUid: row.byUid,
      actorEmail: row.byEmail,
      action: audit.action,
      scope: audit.scope,
      target: audit.target,
      reason: row.reason,
      note: row.summary,
      before: row.before,
      after: row.after,
      ...(row.stripe ? { stripe: row.stripe } : {}),
      at: FieldValue.serverTimestamp(),
    })
  }
  return ref
}

/** Writes one row on its own (with its audit row), for a step with no other write. */
export async function commitHistoryRow(
  firestore: FirebaseFirestore.Firestore,
  history: FirebaseFirestore.CollectionReference,
  row: AppendOnlyHistoryRow,
  audit?: HistoryAudit | null,
): Promise<void> {
  const batch = firestore.batch()
  appendHistoryRow(batch, firestore, history, row, audit)
  await batch.commit()
}

/** A history's rows, oldest first, with their ids. */
export async function readHistoryRows(
  history: FirebaseFirestore.CollectionReference,
  limit = 500,
): Promise<Array<AppendOnlyHistoryRow & { $id: string }>> {
  const snapshot = await history.orderBy('atMs', 'asc').limit(limit).get()
  return sortHistoryRows(
    snapshot.docs.map((doc) => ({ $id: doc.id, ...(doc.data() as AppendOnlyHistoryRow) })),
  )
}
