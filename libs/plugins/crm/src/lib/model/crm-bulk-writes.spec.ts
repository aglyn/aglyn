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

/**
 * The shared bulk runner (AGL-2621): batched, honest about which row was
 * refused, and paying the per-row pass only for the chunk that failed. The
 * route runner is the same tally, one request at a time, in order.
 */

import {
  bulkReport,
  CRM_BULK_WRITE_CHUNK,
  type CrmBulkWrite,
  runCrmBulkBatch,
  runCrmBulkCalls,
  runCrmBulkWrites,
} from './crm-bulk-writes'

const write = (n: number): CrmBulkWrite => ({
  id: `d${n}`,
  label: `Row ${n}`,
  kind: 'update',
  data: { n },
})

const refuse = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  })

describe('runCrmBulkWrites', () => {
  it('commits in chunks of the batch size', async () => {
    const batches: number[] = []
    const outcome = await runCrmBulkWrites(
      {
        commitBatch: async (writes) => void batches.push(writes.length),
        commitOne: async () => undefined,
      },
      Array.from({ length: CRM_BULK_WRITE_CHUNK + 1 }, (_, i) => write(i)),
      (entry) => entry.label,
    )
    expect(batches).toEqual([CRM_BULK_WRITE_CHUNK, 1])
    expect(outcome).toEqual({ done: CRM_BULK_WRITE_CHUNK + 1, refused: [] })
  })

  it('names the refused row after a batch fails, and keeps the rest', async () => {
    const singles: string[] = []
    const outcome = await runCrmBulkWrites(
      {
        commitBatch: async () => {
          throw refuse()
        },
        commitOne: async (entry) => {
          if (entry.id === 'd1') throw refuse()
          singles.push(entry.id)
        },
      },
      [write(0), write(1), write(2)],
      (entry) => entry.label,
    )
    expect(singles).toEqual(['d0', 'd2'])
    expect(outcome).toEqual({
      done: 2,
      refused: [{ label: 'Row 1', error: 'not permitted' }],
    })
  })

  it('pays the per-row pass only for the chunk that failed', async () => {
    let batchCalls = 0
    const singles: string[] = []
    await runCrmBulkWrites(
      {
        commitBatch: async () => {
          batchCalls += 1
          if (batchCalls === 1) throw new Error('first chunk fails')
        },
        commitOne: async (entry) => void singles.push(entry.id),
      },
      [write(0), write(1), write(2), write(3)],
      (entry) => entry.label,
      2,
    )
    expect(batchCalls).toBe(2)
    expect(singles).toEqual(['d0', 'd1'])
  })
})

describe('runCrmBulkCalls', () => {
  it('calls in order, and carries the route’s own sentence for a refusal', async () => {
    const order: string[] = []
    const outcome = await runCrmBulkCalls(
      ['a', 'b', 'c'],
      (item) => `Item ${item}`,
      async (item) => {
        order.push(item)
        if (item === 'b') throw new Error('This deal is not visible to this site.')
      },
    )
    expect(order).toEqual(['a', 'b', 'c'])
    expect(outcome).toEqual({
      done: 2,
      refused: [{ label: 'Item b', error: 'This deal is not visible to this site.' }],
    })
  })
})

describe('runCrmBulkBatch', () => {
  type Row = { id: string; title: string }
  const rows: Row[] = [
    { id: 'a', title: 'Call Ada' },
    { id: 'b', title: 'Send deck' },
    { id: 'c', title: 'Follow up' },
  ]
  const idOf = (row: Row) => row.id
  const labelOf = (row: Row) => row.title

  it('makes ONE call for the selection and tallies each row off the answers, naming a dropped row', async () => {
    const calls: unknown[] = []
    const outcome = await runCrmBulkBatch(rows, idOf, labelOf, async (items) => {
      calls.push(items.map(idOf))
      // `b` refused by the route, `c` never mentioned.
      return [
        { id: 'a', ok: true },
        { id: 'b', ok: false, error: 'That task is not visible to you.' },
      ]
    })
    expect(calls).toEqual([['a', 'b', 'c']])
    expect(outcome).toEqual({
      done: 1,
      refused: [
        { label: 'Send deck', error: 'That task is not visible to you.' },
        { label: 'Follow up', error: 'the write failed' },
      ],
    })
  })

  it('refuses every row by name when the request itself is refused, and calls nothing for no rows', async () => {
    const outcome = await runCrmBulkBatch(rows, idOf, labelOf, async () => {
      throw new Error('Editing tasks at the organization level requires the "Manage data" permission.')
    })
    expect(outcome.done).toBe(0)
    expect(outcome.refused.map((row) => row.label)).toEqual(['Call Ada', 'Send deck', 'Follow up'])
    expect(outcome.refused[0].error).toMatch(/Manage data/)
    const call = jest.fn(async () => [])
    expect(await runCrmBulkBatch([], idOf, labelOf, call)).toEqual({ done: 0, refused: [] })
    expect(call).not.toHaveBeenCalled()
  })
})

describe('bulkReport', () => {
  it('lists what the plan skipped, then what the store refused, and nothing for a clean run', () => {
    expect(
      bulkReport(
        { skipped: [{ label: 'Acme', reason: 'already has 20 tags' }] },
        { done: 1, refused: [{ label: 'Globex', error: 'not permitted' }] },
      ),
    ).toEqual([
      { label: 'Acme', reason: 'already has 20 tags' },
      { label: 'Globex', reason: 'not permitted' },
    ])
    expect(bulkReport({ skipped: [] }, { done: 3, refused: [] })).toBeNull()
  })
})
