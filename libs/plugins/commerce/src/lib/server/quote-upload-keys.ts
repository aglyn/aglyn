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

import { isVisitorUploadSegment } from '@aglyn/aglyn/app-utils/visitor-upload'

/*==========================================
 * A CUSTOMER'S FILES THAT WERE NEVER SENT (AGL-4096).
 *
 * The customer's artwork goes up before their answer does: `quote-upload`
 * keeps each file the moment it is finalized, and `quote-respond` names the
 * ones the answer carries. A customer who attaches a file and never sends
 * the answer leaves a file nobody will see, kept until the quote is deleted.
 *
 * So, as a form's files are (`forms/{formId}/formUploadKeys/{key}`), each one
 * is recorded as pending under its quote,
 * `hosts/{hostId}/orders/{quoteId}/quoteUploadKeys/{quoteId}`: the ticket
 * records its id before anything can be uploaded, the finalize records it
 * again, and `sweepAtMs` is a day after the latest of them. The answer takes
 * the files it sends off the record in the transaction that records the
 * answer, which is what keeps them. The console's sweep
 * (`quote-upload-sweep.ts`) deletes every file still on a record whose day
 * has passed, and the record with it.
 *
 * The record's id is the quote's, because the artwork's scope
 * (`quote-artwork/{quoteId}`) is the quote, as a form's files' scope is the
 * form's key. Only the Admin SDK reads or writes it: everything under an
 * order is closed to clients.
 *=========================================*/

/** Where a quote's pending artwork is recorded, under the quote. */
export const QUOTE_UPLOAD_KEYS_COLLECTION = 'quoteUploadKeys'

/** How long a file the customer attached may wait for their answer. */
export const QUOTE_UPLOAD_KEY_TTL_MS = 24 * 60 * 60 * 1000

/** What the upload route knows of a quote's unsent artwork. */
export interface QuoteUploadKeyRecord {
  hostId: string
  quoteId: string
  /** Each pending file's id, and when it was last recorded. */
  files: Record<string, number>
  /** When the console's sweep may delete the files still pending. */
  sweepAtMs: number
}

/** The pending record of one quote's artwork. */
export function quoteUploadKeyRef(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  quoteId: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('hosts')
    .doc(hostId)
    .collection('orders')
    .doc(quoteId)
    .collection(QUOTE_UPLOAD_KEYS_COLLECTION)
    .doc(quoteId)
}

/** The file ids a record holds, read defensively. */
export function quoteUploadKeyFiles(data: Record<string, unknown> | undefined): Record<string, number> {
  const files = (data?.['files'] ?? {}) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(files)
      .filter(([id]) => isVisitorUploadSegment(id))
      .map(([id, atMs]) => [id, Number(atMs) || 0]),
  )
}

/**
 * Records one of the customer's files as pending, and moves the record's
 * sweep to a day from now. A merge, so files recorded at once each keep
 * their own entry.
 */
export async function recordPendingQuoteUpload(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; quoteId: string; fileId: string; nowMs: number },
): Promise<void> {
  const { hostId, quoteId, fileId, nowMs } = input
  if (!isVisitorUploadSegment(fileId)) return
  await quoteUploadKeyRef(firestore, hostId, quoteId).set(
    { hostId, quoteId, files: { [fileId]: nowMs }, sweepAtMs: nowMs + QUOTE_UPLOAD_KEY_TTL_MS },
    { merge: true },
  )
}

/**
 * In the answer's transaction, after every read: the files the answer sends
 * are kept, so they leave the pending record, and a record left with none
 * is deleted. `pending` is the record as the transaction read it.
 */
export function keepSentQuoteUploads(
  transaction: FirebaseFirestore.Transaction,
  pending: FirebaseFirestore.DocumentSnapshot,
  ref: FirebaseFirestore.DocumentReference,
  sentIds: readonly string[],
): void {
  if (!pending.exists || !sentIds.length) return
  const files = quoteUploadKeyFiles(pending.data())
  const rest = Object.fromEntries(Object.entries(files).filter(([id]) => !sentIds.includes(id)))
  if (Object.keys(rest).length === Object.keys(files).length) return
  if (!Object.keys(rest).length) transaction.delete(ref)
  // The whole record, so the sent files leave the map rather than merge into it.
  else transaction.set(ref, { ...pending.data(), files: rest })
}
