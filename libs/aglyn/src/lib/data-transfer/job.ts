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

/*==========================================
 * TRANSFER JOBS — the shapes an import is stored and applied in.
 *
 * An import is a job that moves through fixed states:
 *
 *   draft → analyzed → planned → applying → applied → undone
 *                         ↑          ↓
 *                         └──── failed (resume, or re-plan)
 *
 *  - `draft` — the file is uploaded and nothing is read yet;
 *  - `analyzed` — headers matched and values collected; the person maps;
 *  - `planned` — the dry run is stored; the person reviews and acknowledges;
 *  - `applying` — chunks are being written; the cursor says how far;
 *  - `applied` — every chunk is written; undo is open for seven days;
 *  - `failed` — a chunk could not be written; resuming re-enters `applying`;
 *  - `undone` — the undo ran. Nothing follows it.
 *
 * Applying is chunked and idempotent: rows go in chunks of
 * {@link TRANSFER_CHUNK_ROWS}, writes in batches of at most
 * {@link TRANSFER_BATCH_WRITES_MAX}, and every row is recorded in a ledger
 * under {@link transferLedgerKey} before its write is acknowledged, so a
 * retried chunk never writes a row twice.
 *
 * ## Undo
 *
 * Before a row updates a record, the previous values of the fields it
 * touches are snapshotted; a created record's id is kept. Undo restores
 * the snapshot or deletes the created record — unless the record changed
 * since the import, in which case the person is asked (keep what it holds
 * now, or restore) rather than having a later edit silently thrown away.
 *=========================================*/

import type { TransferFieldMode, TransferPolicy } from './policy'
import type { TransferPlanSummary, TransferRowReason, TransferWarningClass } from './plan'
import { transferValuesEqual } from './policy'
import type { TransferFormat, TransferKind } from './resource'

/** Rows per chunk: a chunk is planned, applied and reported as one. */
export const TRANSFER_CHUNK_ROWS = 200

/** The most writes in one batch (Firestore's limit). */
export const TRANSFER_BATCH_WRITES_MAX = 500

/** How many records are written at once within a chunk. */
export const TRANSFER_WRITE_CONCURRENCY = 8

/** How long an applied import may be undone. */
export const TRANSFER_UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type TransferJobStatus = 'draft' | 'analyzed' | 'planned' | 'applying' | 'applied' | 'failed' | 'undone'

export const TRANSFER_JOB_STATUSES: readonly TransferJobStatus[] = [
  'draft',
  'analyzed',
  'planned',
  'applying',
  'applied',
  'failed',
  'undone',
]

/**
 * The moves each state allows. A state may be re-entered where the work is
 * repeatable: re-analyzing, re-planning after a changed choice, and
 * `applying` → `applying` as each chunk advances the cursor.
 */
export const TRANSFER_JOB_TRANSITIONS: Readonly<Record<TransferJobStatus, readonly TransferJobStatus[]>> = {
  draft: ['analyzed', 'failed'],
  analyzed: ['analyzed', 'planned', 'failed'],
  planned: ['analyzed', 'planned', 'applying', 'failed'],
  applying: ['applying', 'applied', 'failed'],
  applied: ['undone'],
  failed: ['applying', 'planned', 'analyzed'],
  undone: [],
}

/** Whether a job may move from `from` to `to`. */
export function canTransitionTransferJob(from: TransferJobStatus, to: TransferJobStatus): boolean {
  return TRANSFER_JOB_TRANSITIONS[from]?.includes(to) ?? false
}

/** A move the state machine does not allow. */
export class TransferJobTransitionError extends Error {
  constructor(
    readonly from: TransferJobStatus,
    readonly to: TransferJobStatus,
  ) {
    super(`A transfer job cannot move from ${from} to ${to}.`)
    this.name = 'TransferJobTransitionError'
  }
}

/** Where applying has reached: the next chunk to write. */
export interface TransferJobCursor {
  chunk: number
  /** Rows written so far (all chunks before `chunk`). */
  rowsDone: number
}

export interface TransferJobError {
  code: string
  message: string
  /** The chunk that failed, when one did. */
  chunk?: number
}

/** One import or export, as stored. */
export interface TransferJob {
  id: string
  /** The resource key. */
  resource: string
  kind: TransferKind
  direction: 'import' | 'export'
  format: TransferFormat
  status: TransferJobStatus
  orgId: string
  /** The site, for a host-scoped resource. */
  hostId?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  fileName?: string
  rowCount?: number
  chunkCount?: number
  /** Column → field id, as the person confirmed it. */
  mapping?: Record<number, string>
  matchKeys?: string[]
  policy?: TransferPolicy
  summary?: TransferPlanSummary
  acknowledged?: TransferWarningClass[]
  cursor?: TransferJobCursor
  error?: TransferJobError
  appliedAt?: number
  undoneAt?: number
}

/**
 * The job moved to `to` at `now`. Entering `applied` stamps `appliedAt`;
 * entering `undone` stamps `undoneAt`; leaving `failed` clears the error.
 * Throws {@link TransferJobTransitionError} for a move the machine refuses.
 */
export function transitionTransferJob(
  job: TransferJob,
  to: TransferJobStatus,
  now: number,
  patch: Partial<Omit<TransferJob, 'id' | 'status'>> = {},
): TransferJob {
  if (!canTransitionTransferJob(job.status, to)) throw new TransferJobTransitionError(job.status, to)
  const next: TransferJob = { ...job, ...patch, status: to, updatedAt: now }
  if (to === 'applied') next.appliedAt = now
  if (to === 'undone') next.undoneAt = now
  if (job.status === 'failed' && to !== 'failed' && !patch.error) delete next.error
  return next
}

/** Whether an applied job may still be undone at `now`. */
export function transferUndoAvailable(job: Pick<TransferJob, 'status' | 'appliedAt'>, now: number): boolean {
  return job.status === 'applied' && job.appliedAt !== undefined && now - job.appliedAt <= TRANSFER_UNDO_WINDOW_MS
}

/** When an applied job's undo closes, or `null` when it was never applied. */
export function transferUndoExpiresAt(job: Pick<TransferJob, 'appliedAt'>): number | null {
  return job.appliedAt === undefined ? null : job.appliedAt + TRANSFER_UNDO_WINDOW_MS
}

/** The ledger key that makes one row's write happen once: `<jobId>:<rowIndex>`. */
export function transferLedgerKey(jobId: string, rowIndex: number): string {
  if (!jobId || jobId.includes(':') || jobId.includes('/')) throw new Error(`"${jobId}" is not a job id.`)
  if (!Number.isInteger(rowIndex) || rowIndex < 0) throw new Error(`${rowIndex} is not a row index.`)
  return `${jobId}:${rowIndex}`
}

/** A ledger key read back, or `null` when it is not one. */
export function parseTransferLedgerKey(key: string): { jobId: string; rowIndex: number } | null {
  const match = /^([^:/]+):(\d+)$/.exec(String(key ?? ''))
  if (!match) return null
  return { jobId: match[1] as string, rowIndex: Number(match[2]) }
}

/** One chunk's span of the file. */
export interface TransferChunkRange {
  index: number
  /** First row index, inclusive. */
  start: number
  /** Last row index, exclusive. */
  end: number
}

/** A file of `rowCount` rows cut into chunks of `size`. */
export function transferChunkRanges(rowCount: number, size = TRANSFER_CHUNK_ROWS): TransferChunkRange[] {
  const ranges: TransferChunkRange[] = []
  if (!(size > 0)) return ranges
  for (let start = 0, index = 0; start < rowCount; start += size, index += 1) {
    ranges.push({ index, start, end: Math.min(rowCount, start + size) })
  }
  return ranges
}

/** The chunk a row falls in. */
export function transferChunkOfRow(rowIndex: number, size = TRANSFER_CHUNK_ROWS): number {
  return Math.floor(rowIndex / size)
}

/** Items cut into batches of at most `max` (one batch per commit). */
export function transferWriteBatches<T>(items: readonly T[], max = TRANSFER_BATCH_WRITES_MAX): T[][] {
  const batches: T[][] = []
  for (let at = 0; at < items.length; at += max) batches.push(items.slice(at, at + max))
  return batches
}

/** What applying did to one row. */
export type TransferRowOutcome = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed'

export interface TransferRowResult {
  row: number
  outcome: TransferRowOutcome
  recordId?: string
  reason?: TransferRowReason | string
  /** A sentence for a failure the plan did not foresee. */
  message?: string
}

/** One chunk's plan, as stored for the apply step. */
export interface TransferChunk<Row = unknown> {
  jobId: string
  index: number
  start: number
  end: number
  rows: Row[]
}

/** One chunk's results, as stored. */
export interface TransferChunkResult {
  jobId: string
  index: number
  results: TransferRowResult[]
  completedAt: number
}

/** Counts by outcome. */
export type TransferResultSummary = Record<TransferRowOutcome, number> & { total: number }

/** The results counted. */
export function summarizeTransferResults(results: Iterable<TransferRowResult>): TransferResultSummary {
  const summary: TransferResultSummary = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, total: 0 }
  for (const result of results) {
    summary[result.outcome] += 1
    summary.total += 1
  }
  return summary
}

/** What undo needs to reverse one row. */
export interface TransferUndoEntry {
  row: number
  recordId: string
  action: 'created' | 'updated'
  /** For an update: each touched field's value before the import (`null` for none). */
  previous?: Record<string, unknown>
  /** The values the import wrote, to tell a later edit from the import's own. */
  written: Record<string, unknown>
  /** The modes the fields were written under, for the undo screen. */
  modes?: Record<string, TransferFieldMode>
}

/** One chunk's undo entries, as stored. */
export interface TransferUndoSnapshot {
  jobId: string
  chunk: number
  entries: TransferUndoEntry[]
}

/** What undo does for one row. */
export type TransferUndoStep =
  | { action: 'delete'; recordId: string }
  | { action: 'restore'; recordId: string; values: Record<string, unknown> }
  | { action: 'conflict'; recordId: string; fields: string[]; values: Record<string, unknown> }
  | { action: 'nothing'; recordId: string; why: 'gone' | 'alreadyReverted' }

/**
 * The undo step for one entry against the record as it is now (`null` when
 * it no longer exists). A field the import wrote that still holds what the
 * import wrote is restored; a field edited since is a conflict, and the
 * person chooses. A created record is deleted only when untouched since;
 * otherwise deleting it is a conflict too.
 */
export function planTransferUndo(
  entry: TransferUndoEntry,
  current: Readonly<Record<string, unknown>> | null,
): TransferUndoStep {
  if (!current) return { action: 'nothing', recordId: entry.recordId, why: 'gone' }
  const edited = Object.keys(entry.written).filter(
    (fieldId) => !transferValuesEqual(current[fieldId], entry.written[fieldId]),
  )
  if (entry.action === 'created') {
    return edited.length
      ? { action: 'conflict', recordId: entry.recordId, fields: edited, values: {} }
      : { action: 'delete', recordId: entry.recordId }
  }
  const previous = entry.previous ?? {}
  const values: Record<string, unknown> = {}
  const conflicts: string[] = []
  for (const fieldId of Object.keys(entry.written)) {
    const was = previous[fieldId] ?? null
    if (transferValuesEqual(current[fieldId], was)) continue
    if (edited.includes(fieldId)) conflicts.push(fieldId)
    values[fieldId] = was
  }
  if (conflicts.length) return { action: 'conflict', recordId: entry.recordId, fields: conflicts, values }
  if (!Object.keys(values).length) return { action: 'nothing', recordId: entry.recordId, why: 'alreadyReverted' }
  return { action: 'restore', recordId: entry.recordId, values }
}
