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

import { deriveTransferRow } from './derive'
import type { RowMatchOutcome } from './match'
import type { PlannedTransferRow } from './plan'
import { createTransferPolicy } from './policy'
import type { TransferField } from './resource'
import {
  summarizeTransferDerivations,
  transferAmbiguities,
  transferDateOrderOptions,
  transferMatchReview,
  transferPlanConflicts,
  transferPlanSample,
} from './review'

const FIELDS: TransferField[] = [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'born', label: 'Born', type: 'date' },
]
const BY_ID = new Map(FIELDS.map((field) => [field.id, field]))

describe('the review of a whole file', () => {
  it('reads a field’s ambiguous dates in the order the person chose, and counts them either way', () => {
    const cells = { born: '03/04/2020' }
    const chosen = deriveTransferRow(BY_ID, cells, {}, transferDateOrderOptions({ born: 'dmy' }))
    expect(chosen.values['born']).toBe('2020-04-03')
    const [summary] = summarizeTransferDerivations([BY_ID.get('born') as TransferField], [{ index: 0, cells, ...chosen }])
    expect(summary).toMatchObject({ fieldId: 'born', filled: 1, ambiguousDates: 1 })
  })

  it('lists at most so many rows of each match outcome, and counts them all', () => {
    const outcomes: RowMatchOutcome[] = [
      { kind: 'new' },
      { kind: 'new' },
      { kind: 'new' },
      { kind: 'ambiguous', recordIds: ['r1', 'r2'], via: { fieldId: 'email', value: 'a@b.c' } },
    ]
    const review = transferMatchReview([], outcomes, [{ name: 'A' }, {}, {}, { name: 'D' }], 2)
    expect(review.summary).toEqual({ new: 3, matched: 0, ambiguous: 1, duplicateInFile: 0 })
    expect(review.rows.map((row) => [row.row, row.label])).toEqual([
      [0, 'A'],
      [1, undefined],
      [3, 'D'],
    ])
    expect(transferAmbiguities(outcomes)).toEqual([{ row: 3, via: { fieldId: 'email', value: 'a@b.c' }, recordIds: ['r1', 'r2'] }])
  })

  it('names a conflict only where both sides hold a value and they differ', () => {
    const conflicts = transferPlanConflicts({
      fields: BY_ID,
      rows: [
        { index: 0, values: { name: 'Ada L', born: '1815-12-10' } },
        { index: 1, values: { name: 'Same' } },
      ],
      matches: [
        { kind: 'matched', recordId: 'r1', via: { fieldId: 'id', value: 'r1' } },
        { kind: 'matched', recordId: 'r2', via: { fieldId: 'id', value: 'r2' } },
      ],
      existing: new Map([
        ['r1', { name: 'Ada', born: null }],
        ['r2', { name: 'Same' }],
      ]),
      policy: createTransferPolicy({}),
    })
    expect(conflicts).toEqual([
      {
        row: 0,
        recordId: 'r1',
        fields: [{ fieldId: 'name', before: 'Ada', incoming: 'Ada L', after: 'Ada', mode: 'fillBlanks', source: 'default' }],
      },
    ])
  })

  it('shows no conflict for a value the resource folds, and compares an outcome it supplied (AGL-3548)', () => {
    const fields = new Map<string, TransferField>([['status', { id: 'status', label: 'Status', type: 'text' }]])
    const input = {
      fields,
      rows: [{ index: 0, values: { status: 'Published' } }],
      matches: [{ kind: 'matched', recordId: 'e1', via: { fieldId: 'id', value: 'e1' } }] as RowMatchOutcome[],
      existing: new Map([['e1', { status: 'published' }]]),
      policy: createTransferPolicy({}),
    }
    expect(transferPlanConflicts(input)).toHaveLength(1)
    expect(
      transferPlanConflicts({
        ...input,
        valuesEqual: (field, a, b) => (field.id === 'status' ? String(a).toLowerCase() === String(b).toLowerCase() : undefined),
      }),
    ).toEqual([])
  })

  it('samples the planned rows by verdict, in row order', () => {
    const row = (index: number, verdict: PlannedTransferRow['verdict']) =>
      ({ index, verdict, recordId: null, diff: [], heldBack: [], warnings: [], match: { kind: 'new' } }) as PlannedTransferRow
    const rows = [row(0, 'create'), row(1, 'create'), row(2, 'fail'), row(3, 'create')]
    expect(transferPlanSample(rows, 2).map((entry) => entry.index)).toEqual([0, 1, 2])
  })
})
