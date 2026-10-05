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
  TRANSFER_BATCH_WRITES_MAX,
  TRANSFER_CHUNK_ROWS,
  TRANSFER_JOB_STATUSES,
  TRANSFER_JOB_TRANSITIONS,
  TRANSFER_UNDO_WINDOW_MS,
  TRANSFER_WRITE_CONCURRENCY,
  TransferJobTransitionError,
  canTransitionTransferJob,
  parseTransferLedgerKey,
  planTransferUndo,
  summarizeTransferResults,
  transferChunkOfRow,
  transferChunkRanges,
  transferLedgerKey,
  transferUndoAvailable,
  transferUndoExpiresAt,
  transferWriteBatches,
  transitionTransferJob,
} from './job'
import type { TransferJob } from './job'

const job: TransferJob = {
  id: 'job1',
  resource: 'people',
  kind: 'records',
  direction: 'import',
  format: 'csv',
  status: 'draft',
  orgId: 'org1',
  createdBy: 'u1',
  createdAt: 0,
  updatedAt: 0,
}

describe('constants', () => {
  it('chunks 200 rows, batches at most 500 writes, writes 8 at once, undoes for 7 days', () => {
    expect(TRANSFER_CHUNK_ROWS).toBe(200)
    expect(TRANSFER_BATCH_WRITES_MAX).toBe(500)
    expect(TRANSFER_WRITE_CONCURRENCY).toBe(8)
    expect(TRANSFER_UNDO_WINDOW_MS).toBe(604_800_000)
  })
})

describe('the job state machine', () => {
  it('walks the happy path', () => {
    let next = job
    for (const [to, at] of [
      ['analyzed', 1],
      ['planned', 2],
      ['applying', 3],
      ['applying', 4],
      ['applied', 5],
      ['undone', 6],
    ] as const) {
      next = transitionTransferJob(next, to, at)
    }
    expect(next).toMatchObject({ status: 'undone', updatedAt: 6, appliedAt: 5, undoneAt: 6 })
  })

  it('refuses moves the machine does not allow', () => {
    expect(canTransitionTransferJob('draft', 'applying')).toBe(false)
    expect(canTransitionTransferJob('applied', 'applying')).toBe(false)
    expect(() => transitionTransferJob(job, 'applied', 1)).toThrow(TransferJobTransitionError)
    expect(() => transitionTransferJob({ ...job, status: 'undone' }, 'applied', 1)).toThrow(
      'A transfer job cannot move from undone to applied.',
    )
  })

  it('resumes a failed job and clears its error', () => {
    const failed = transitionTransferJob({ ...job, status: 'applying' }, 'failed', 1, {
      error: { code: 'write', message: 'Timed out', chunk: 3 },
    })
    expect(failed.error?.chunk).toBe(3)
    const resumed = transitionTransferJob(failed, 'applying', 2)
    expect(resumed.error).toBeUndefined()
    expect(resumed.status).toBe('applying')
  })

  it('names every state in the transition table and ends at undone', () => {
    expect(Object.keys(TRANSFER_JOB_TRANSITIONS).sort()).toEqual([...TRANSFER_JOB_STATUSES].sort())
    expect(TRANSFER_JOB_TRANSITIONS.undone).toEqual([])
  })
})

describe('undo window', () => {
  it('is open for seven days after apply and only for an applied job', () => {
    const applied = { status: 'applied' as const, appliedAt: 1_000 }
    expect(transferUndoAvailable(applied, 1_000 + TRANSFER_UNDO_WINDOW_MS)).toBe(true)
    expect(transferUndoAvailable(applied, 1_001 + TRANSFER_UNDO_WINDOW_MS)).toBe(false)
    expect(transferUndoAvailable({ status: 'undone', appliedAt: 1_000 }, 1_000)).toBe(false)
    expect(transferUndoExpiresAt(applied)).toBe(1_000 + TRANSFER_UNDO_WINDOW_MS)
    expect(transferUndoExpiresAt({})).toBeNull()
  })
})

describe('ledger keys', () => {
  it('round-trips a job id and row index', () => {
    expect(transferLedgerKey('job1', 42)).toBe('job1:42')
    expect(parseTransferLedgerKey('job1:42')).toEqual({ jobId: 'job1', rowIndex: 42 })
    expect(parseTransferLedgerKey('nope')).toBeNull()
  })

  it('refuses ids that would make the key ambiguous', () => {
    expect(() => transferLedgerKey('a:b', 1)).toThrow()
    expect(() => transferLedgerKey('a/b', 1)).toThrow()
    expect(() => transferLedgerKey('a', -1)).toThrow()
    expect(() => transferLedgerKey('a', 1.5)).toThrow()
  })
})

describe('chunks and batches', () => {
  it('cuts a file into chunk ranges', () => {
    expect(transferChunkRanges(450)).toEqual([
      { index: 0, start: 0, end: 200 },
      { index: 1, start: 200, end: 400 },
      { index: 2, start: 400, end: 450 },
    ])
    expect(transferChunkRanges(0)).toEqual([])
    expect(transferChunkRanges(5, 0)).toEqual([])
    expect(transferChunkOfRow(399)).toBe(1)
    expect(transferChunkOfRow(400)).toBe(2)
  })

  it('cuts writes into batches', () => {
    expect(transferWriteBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(transferWriteBatches(Array.from({ length: 1001 }, (_, i) => i)).map((batch) => batch.length)).toEqual([
      500, 500, 1,
    ])
  })

  it('counts results by outcome', () => {
    expect(
      summarizeTransferResults([
        { row: 0, outcome: 'created', recordId: 'a' },
        { row: 1, outcome: 'failed', message: 'x' },
        { row: 2, outcome: 'created', recordId: 'b' },
      ]),
    ).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0, failed: 1, total: 3 })
  })
})

describe('planTransferUndo', () => {
  it('deletes an untouched created record and asks about one edited since', () => {
    const entry = { row: 0, recordId: 'r1', action: 'created' as const, written: { name: 'New' } }
    expect(planTransferUndo(entry, { name: 'New' })).toEqual({ action: 'delete', recordId: 'r1' })
    expect(planTransferUndo(entry, { name: 'Edited' })).toEqual({
      action: 'conflict',
      recordId: 'r1',
      fields: ['name'],
      values: {},
    })
    expect(planTransferUndo(entry, null)).toEqual({ action: 'nothing', recordId: 'r1', why: 'gone' })
  })

  it('restores the previous values of an updated record', () => {
    const entry = {
      row: 0,
      recordId: 'r2',
      action: 'updated' as const,
      previous: { name: 'Old', tags: ['a'] },
      written: { name: 'New', tags: ['a', 'b'] },
    }
    expect(planTransferUndo(entry, { name: 'New', tags: ['b', 'a'] })).toEqual({
      action: 'restore',
      recordId: 'r2',
      values: { name: 'Old', tags: ['a'] },
    })
  })

  it('asks about a field edited since the import, and does nothing when already reverted', () => {
    const entry = { row: 0, recordId: 'r3', action: 'updated' as const, previous: { name: 'Old' }, written: { name: 'New' } }
    expect(planTransferUndo(entry, { name: 'Edited later' })).toEqual({
      action: 'conflict',
      recordId: 'r3',
      fields: ['name'],
      values: { name: 'Old' },
    })
    expect(planTransferUndo(entry, { name: 'Old' })).toEqual({ action: 'nothing', recordId: 'r3', why: 'alreadyReverted' })
  })

  it('restores a field that had no value to null', () => {
    const entry = { row: 0, recordId: 'r4', action: 'updated' as const, previous: {}, written: { phone: '+15125550107' } }
    expect(planTransferUndo(entry, { phone: '+15125550107' })).toEqual({
      action: 'restore',
      recordId: 'r4',
      values: { phone: null },
    })
  })
})
