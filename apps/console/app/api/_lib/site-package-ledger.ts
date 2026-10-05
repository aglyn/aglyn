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

import { TRANSFER_UNDO_WINDOW_MS } from '@aglyn/aglyn/data-transfer'

/**
 * A site package import's record, and what undoing it needs (AGL-3533).
 *
 * `hosts/{hostId}/packageImports/{importId}` holds who imported what, when,
 * and each item's decision; beneath it, `snapshots/{n}` holds the content
 * every replaced or merged item had BEFORE the import, and `writtenPaths/{n}`
 * every document path the import wrote for each item. Undo writes the
 * snapshots back the way a restore writes an item, and deletes what the
 * import created — for seven days, the transfer engine's window
 * (`TRANSFER_UNDO_WINDOW_MS`).
 *
 * The snapshot and path lists are JSON split into pieces of at most
 * {@link LEDGER_PIECE_CHARS}, the engine's discipline for a plan chunk: a
 * whole site's previous content can run past a document's 1 MiB.
 *
 * Written by the import route on the Admin SDK only. The rules name
 * `packageImports` in the host catch-all's read and write exclusions, so no
 * client reads a previous copy of a site's content or forges what an undo
 * would write back. Every document of it expires
 * {@link PACKAGE_LEDGER_RETENTION_MS} after it is written.
 */

/** The host subcollection the ledger lives in. */
export const PACKAGE_IMPORTS_COLLECTION = 'packageImports'
/** The pieces of each item's content before the import. */
export const PACKAGE_IMPORT_SNAPSHOTS = 'snapshots'
/** The pieces of each item's written document paths. */
export const PACKAGE_IMPORT_WRITTEN_PATHS = 'writtenPaths'

/** The most characters one piece holds. */
export const LEDGER_PIECE_CHARS = 900_000

/** How long an import can be undone. */
export const PACKAGE_UNDO_WINDOW_MS = TRANSFER_UNDO_WINDOW_MS

/**
 * How long the ledger is kept (AGL-3543): the undo window and a day, so the
 * pieces filed while an import applied outlive its window too. A TTL policy
 * on `expiresAt` deletes the record and every piece; TTL does not cascade,
 * so each carries its own stamp.
 */
export const PACKAGE_LEDGER_RETENTION_MS = PACKAGE_UNDO_WINDOW_MS + 24 * 60 * 60 * 1000

/** The `expiresAt` of a ledger document written at `nowMs`. */
export function packageLedgerExpiry(nowMs: number): Date {
  return new Date(nowMs + PACKAGE_LEDGER_RETENTION_MS)
}

/** What happened to an import. */
export type PackageImportStatus = 'applying' | 'applied' | 'refused' | 'failed' | 'undone'

/** One item as the record lists it. */
export interface PackageImportRecordItem {
  /** Its key in the package. */
  key: string
  kind: string
  /** The id it was written under. */
  targetId: string
  decision: string
  name?: string
}

/** The import's record. */
export interface PackageImportRecord {
  status: PackageImportStatus
  actorUid: string
  actorEmail: string | null
  /** 1 for a converted `aglyn-site-export` backup, 2 for a package. */
  format: 1 | 2
  /** `restore` (every item under its own id) or `decide` (the person's decisions). */
  mode: 'restore' | 'decide'
  source: string | null
  startedAtMs: number
  appliedAtMs?: number
  undoneAtMs?: number
  /** The items an undo has reverted, by key: a second undo leaves them be. */
  undoneItems?: string[]
  /** When undo closes. */
  expiresAtMs?: number
  items: PackageImportRecordItem[]
  /** Items by decision. */
  counts: Record<string, number>
  snapshotPieces: number
  writtenPieces?: number
  error?: string
}

/** Content an item had before the import, in the wire form a file holds. */
export interface PackageImportSnapshot {
  kind: string
  id: string
  content: Record<string, unknown>
}

/** JSON in pieces of at most {@link LEDGER_PIECE_CHARS}. */
export function splitLedgerJson(value: unknown): string[] {
  const text = JSON.stringify(value)
  const pieces: string[] = []
  for (let at = 0; at < text.length; at += LEDGER_PIECE_CHARS) pieces.push(text.slice(at, at + LEDGER_PIECE_CHARS))
  return pieces.length ? pieces : ['null']
}

/** Pieces read back in order, joined and parsed. */
export function joinLedgerJson<T>(pieces: ReadonlyArray<{ n: number; json: string }>): T {
  return JSON.parse([...pieces].sort((a, b) => a.n - b.n).map((piece) => piece.json).join('')) as T
}

/** The record's ref. */
export function packageImportRef(
  hostRef: FirebaseFirestore.DocumentReference,
  importId: string,
): FirebaseFirestore.DocumentReference {
  return hostRef.collection(PACKAGE_IMPORTS_COLLECTION).doc(importId)
}

/** Writes JSON pieces under a record, one batch per piece so none nears the batch's byte ceiling. */
export async function writeLedgerPieces(
  firestore: FirebaseFirestore.Firestore,
  recordRef: FirebaseFirestore.DocumentReference,
  collection: string,
  value: unknown,
): Promise<number> {
  const pieces = splitLedgerJson(value)
  for (const [n, json] of pieces.entries()) {
    const batch = firestore.batch()
    batch.set(recordRef.collection(collection).doc(String(n)), { n, json, expiresAt: packageLedgerExpiry(Date.now()) })
    await batch.commit()
  }
  return pieces.length
}

/** Reads a record's pieces back. */
export async function readLedgerPieces<T>(
  recordRef: FirebaseFirestore.DocumentReference,
  collection: string,
  count: number,
): Promise<T> {
  const pieces = await Promise.all(
    Array.from({ length: count }, async (_unused, n) => {
      const snapshot = await recordRef.collection(collection).doc(String(n)).get()
      const json = snapshot.exists ? String(snapshot.get('json') ?? '') : ''
      if (!json) throw new Error(`package import ledger: ${collection} piece ${n} is missing`)
      return { n, json }
    }),
  )
  return joinLedgerJson<T>(pieces)
}

/** Whether an import may still be undone at `now`. */
export function packageImportUndoable(record: Pick<PackageImportRecord, 'status' | 'appliedAtMs'>, now: number): boolean {
  return (
    record.status === 'applied' &&
    typeof record.appliedAtMs === 'number' &&
    now - record.appliedAtMs <= PACKAGE_UNDO_WINDOW_MS
  )
}
