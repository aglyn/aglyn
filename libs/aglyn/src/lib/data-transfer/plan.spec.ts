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
import { buildMatchLookup, matchRows } from './match'
import type { MatchKeySpec, RowMatchOutcome } from './match'
import {
  ACKNOWLEDGED_WARNING_CLASSES,
  buildTransferPlan,
  canApplyTransferPlan,
  missingAcknowledgements,
  plannedWrites,
} from './plan'
import type { BuildTransferPlanInput, TransferPlanRow } from './plan'
import { createTransferPolicy } from './policy'
import type { TransferField } from './resource'

const fields: TransferField[] = [
  { id: 'id', label: 'Aglyn ID', type: 'text', system: true, readOnly: true, matchKey: true },
  { id: 'email', label: 'Email', type: 'email', required: true },
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'tags', label: 'Tags', type: 'tags' },
  { id: 'since', label: 'Since', type: 'date' },
  { id: 'consent', label: 'Consent', type: 'boolean' },
  { id: 'score', label: 'Score', type: 'integer', derived: true },
]
const byId = new Map(fields.map((field) => [field.id, field]))
const keys: MatchKeySpec[] = [
  { fieldId: 'id', normalizer: 'aglynId' },
  { fieldId: 'email', normalizer: 'email' },
]

const existing = new Map<string, Record<string, unknown>>([
  ['r1', { email: 'jane@example.com', name: 'Jane', tags: ['vip'], since: null }],
  ['r2', { email: 'bob@example.com', name: '', tags: [] }],
  ['r3', { email: 'twin@example.com', name: 'Twin A' }],
  ['r4', { email: 'twin@example.com', name: 'Twin B' }],
])

function rowsFrom(cells: Record<string, unknown>[]): TransferPlanRow[] {
  return cells.map((cell, index) => ({ index, ...deriveTransferRow(byId, cell) }))
}

function plan(cells: Record<string, unknown>[], patch: Partial<BuildTransferPlanInput> = {}) {
  const rows = rowsFrom(cells)
  const lookup = buildMatchLookup(
    [...existing].map(([id, values]) => ({ id, values })),
    keys,
  )
  return buildTransferPlan({
    fields,
    rows,
    matches: matchRows(
      rows.map((row) => row.values),
      keys,
      lookup,
    ),
    existing,
    policy: createTransferPolicy(),
    ...patch,
  })
}

describe('buildTransferPlan verdicts', () => {
  it('creates new rows, updates matched ones and leaves identical ones unchanged', () => {
    const result = plan([
      { email: 'new@example.com', name: 'New', tags: 'a|b' },
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'jane@example.com', name: 'Jane' },
    ])
    expect(result.rows.map((row) => [row.verdict, row.recordId])).toEqual([
      ['create', null],
      ['update', 'r2'],
      ['unchanged', 'r1'],
    ])
    expect(result.rows[0]?.diff.map((change) => [change.fieldId, change.before, change.after])).toEqual([
      ['email', null, 'new@example.com'],
      ['name', null, 'New'],
      ['tags', null, ['a', 'b']],
    ])
    expect(result.rows[1]?.diff).toEqual([
      { fieldId: 'name', before: '', after: 'Bob', mode: 'fillBlanks', source: 'default', rule: 'filled' },
    ])
    expect(result.summary).toEqual({ create: 1, update: 1, unchanged: 1, skip: 0, fail: 0, total: 3 })
  })

  it('fills blanks by default and warns before overwriting a value', () => {
    const kept = plan([{ email: 'jane@example.com', name: 'Janet' }])
    expect(kept.rows[0]?.verdict).toBe('unchanged')
    const overwritten = plan([{ email: 'jane@example.com', name: 'Janet' }], {
      policy: createTransferPolicy({ fields: { name: { mode: 'overwrite' } } }),
    })
    expect(overwritten.rows[0]?.diff[0]).toMatchObject({ before: 'Jane', after: 'Janet', mode: 'overwrite', source: 'field' })
    expect(overwritten.warnings.find((entry) => entry.class === 'overwriteNonBlank')).toMatchObject({
      count: 1,
      rows: 1,
      fieldIds: ['name'],
      samples: [{ row: 0, fieldId: 'name', value: 'Jane', detail: '→ Janet' }],
      requiresAcknowledgement: true,
    })
  })

  it('appends to lists without an overwrite warning', () => {
    const result = plan([{ email: 'jane@example.com', tags: 'new' }])
    expect(result.rows[0]?.diff[0]).toMatchObject({ fieldId: 'tags', before: ['vip'], after: ['vip', 'new'], rule: 'appended' })
    expect(result.warnings.map((entry) => entry.class)).toEqual([])
  })

  it('clears a value on a blank cell when told to, with a warning', () => {
    const result = plan([{ email: 'jane@example.com', name: '' }], {
      policy: createTransferPolicy({ fields: { name: { mode: 'overwrite', blank: 'clear' } } }),
    })
    expect(result.rows[0]?.diff[0]).toMatchObject({ fieldId: 'name', before: 'Jane', after: null, rule: 'cleared' })
    expect(result.warnings.map((entry) => entry.class)).toEqual(['clearValue'])
  })

  it('skips matched or new rows when the record policy says so', () => {
    const result = plan([{ email: 'jane@example.com' }, { email: 'fresh@example.com' }], {
      policy: createTransferPolicy({ record: { onMatch: 'skip', onNew: 'skip', onAmbiguous: 'ask' } }),
    })
    expect(result.rows.map((row) => [row.verdict, row.reason])).toEqual([
      ['skip', 'matchedSkipped'],
      ['skip', 'newSkipped'],
    ])
  })

  it('creates a duplicate of a matched record when asked', () => {
    const result = plan([{ email: 'jane@example.com', name: 'Copy' }], {
      policy: createTransferPolicy({ record: { onMatch: 'duplicate', onNew: 'create', onAmbiguous: 'ask' } }),
    })
    expect(result.rows[0]?.verdict).toBe('create')
  })

  it('holds back an ambiguous row until the person picks a record', () => {
    const asked = plan([{ email: 'twin@example.com', name: 'X' }])
    expect(asked.rows[0]).toMatchObject({ verdict: 'skip', reason: 'ambiguousUnresolved' })
    expect(asked.warnings[0]).toMatchObject({ class: 'ambiguousMatch', samples: [{ detail: '2 records match' }] })
    const skipped = plan([{ email: 'twin@example.com' }], {
      policy: createTransferPolicy({ record: { onMatch: 'update', onNew: 'create', onAmbiguous: 'skip' } }),
    })
    expect(skipped.rows[0]?.reason).toBe('ambiguousSkipped')
    const chosen = plan([{ email: 'twin@example.com', name: 'Twin B2' }], {
      policy: createTransferPolicy({ rows: { 0: { recordId: 'r4' } }, fields: { name: { mode: 'overwrite' } } }),
    })
    expect(chosen.rows[0]).toMatchObject({ verdict: 'update', recordId: 'r4' })
  })

  it('obeys a row action over the match', () => {
    const result = plan([{ email: 'jane@example.com' }, { email: 'bob@example.com', name: 'Bob' }], {
      policy: createTransferPolicy({ rows: { 0: { action: 'create' }, 1: { action: 'skip' } } }),
    })
    expect(result.rows.map((row) => [row.verdict, row.reason])).toEqual([
      ['create', undefined],
      ['skip', 'skippedByChoice'],
    ])
  })

  it('skips a duplicate within the file and names the first row', () => {
    const result = plan([{ email: 'a@example.com' }, { email: 'A@example.com' }])
    expect(result.rows[1]).toMatchObject({ verdict: 'skip', reason: 'duplicateInFile' })
    expect(result.warnings.find((entry) => entry.class === 'duplicateInFile')?.samples[0]).toMatchObject({
      row: 1,
      detail: 'Same as row 1',
    })
  })

  it('warns when another key points at a different record', () => {
    const result = plan([{ id: 'r2', email: 'jane@example.com', name: 'Bob' }])
    expect(result.rows[0]).toMatchObject({ verdict: 'update', recordId: 'r2' })
    expect(result.warnings.map((entry) => entry.class)).toEqual(['ambiguousMatch'])
  })

  it('fails a create missing a required field, and a match whose record is gone', () => {
    const missing = plan([{ name: 'No email' }])
    expect(missing.rows[0]).toMatchObject({ verdict: 'fail', reason: 'missingRequired', missing: ['email'] })
    const gone = buildTransferPlan({
      fields,
      rows: rowsFrom([{ email: 'x@example.com' }]),
      matches: [{ kind: 'matched', recordId: 'ghost', via: { fieldId: 'email', value: 'x@example.com' } }],
      existing,
      policy: createTransferPolicy(),
    })
    expect(gone.rows[0]).toMatchObject({ verdict: 'fail', reason: 'matchedRecordMissing', recordId: 'ghost' })
  })

  it('never writes derived or system fields', () => {
    const result = plan([{ email: 'bob@example.com', score: '9', id: 'r2' }])
    expect(result.rows[0]?.verdict).toBe('unchanged')
  })
})

describe('locked rules', () => {
  it('holds back a refused value on creates and updates, with the reason', () => {
    const policy = createTransferPolicy({
      locked: [{ fieldId: 'consent', reason: 'Consent is never asserted from a file.', refuseValues: true }],
    })
    const result = plan([{ email: 'new@example.com', consent: 'yes' }, { email: 'bob@example.com', consent: 'yes' }], {
      policy,
    })
    expect(result.rows.map((row) => [row.verdict, row.heldBack])).toEqual([
      ['create', ['consent']],
      ['unchanged', ['consent']],
    ])
    expect(result.rows[0]?.diff.map((change) => change.fieldId)).toEqual(['email'])
    expect(result.warnings.find((entry) => entry.class === 'lockedRule')).toMatchObject({
      count: 2,
      samples: [
        { row: 0, fieldId: 'consent', value: 'true', detail: 'Consent is never asserted from a file.' },
        { row: 1, fieldId: 'consent', value: 'true', detail: 'Consent is never asserted from a file.' },
      ],
    })
  })

  it('reports a forced mode that keeps the existing value', () => {
    const policy = createTransferPolicy({
      fields: { name: { mode: 'overwrite' } },
      locked: [{ fieldId: 'name', reason: 'Names are kept.', forced: { mode: 'keepExisting' } }],
    })
    const result = plan([{ email: 'jane@example.com', name: 'Other' }], { policy })
    expect(result.rows[0]).toMatchObject({ verdict: 'unchanged', heldBack: ['name'] })
  })
})

describe('derivations, problems and notes', () => {
  it('counts derivations, splits out ambiguous dates, and drops unreadable cells', () => {
    const result = plan([
      { email: 'NEW@example.com', since: '03/04/2024' },
      { email: 'two@example.com', since: 'someday' },
    ])
    const classes = Object.fromEntries(result.warnings.map((entry) => [entry.class, entry]))
    expect(classes['derivation']).toMatchObject({ count: 1, requiresAcknowledgement: false })
    expect(classes['ambiguousDate']).toMatchObject({ count: 1, requiresAcknowledgement: true, fieldIds: ['since'] })
    expect(classes['droppedCell']).toMatchObject({ count: 1, samples: [{ row: 1, fieldId: 'since', value: 'someday' }] })
    expect(result.rows[1]?.verdict).toBe('create')
  })

  it('requires acknowledgement of a derivation class holding a flagged guess', () => {
    const result = plan([{ email: 'new@example.com', since: '45356' }])
    expect(result.warnings.find((entry) => entry.class === 'derivation')?.requiresAcknowledgement).toBe(true)
  })

  it('fails a row a note refuses and counts the note', () => {
    const rows: TransferPlanRow[] = [
      {
        index: 0,
        values: { email: 'a@example.com' },
        notes: [{ class: 'unmatchedPicklist', fieldId: 'stage', value: 'Spam', refuse: true }],
      },
      {
        index: 1,
        values: { email: 'b@example.com' },
        notes: [{ class: 'newPicklistValue', fieldId: 'stage', value: 'Lukewarm' }],
      },
    ]
    const matches: RowMatchOutcome[] = [{ kind: 'new' }, { kind: 'new' }]
    const result = buildTransferPlan({ fields, rows, matches, existing, policy: createTransferPolicy() })
    expect(result.rows.map((row) => [row.verdict, row.reason])).toEqual([
      ['fail', 'refusedValue'],
      ['create', undefined],
    ])
    expect(result.acknowledgementsRequired).toEqual(['unmatchedPicklist', 'newPicklistValue'])
  })
})

describe('plan limits', () => {
  it('fails creates past the limit and keeps updates within the write limit', () => {
    const result = plan(
      [{ email: 'a@example.com' }, { email: 'b@example.com' }, { email: 'bob@example.com', name: 'Bob' }],
      { limits: { maxCreates: 1 } },
    )
    expect(result.rows.map((row) => [row.verdict, row.reason])).toEqual([
      ['create', undefined],
      ['fail', 'planLimit'],
      ['update', undefined],
    ])
    const writes = plan([{ email: 'a@example.com' }, { email: 'bob@example.com', name: 'Bob' }], { limits: { maxWrites: 1 } })
    expect(writes.rows.map((row) => row.verdict)).toEqual(['create', 'fail'])
    expect(writes.warnings.map((entry) => entry.class)).toEqual(['planLimit'])
  })
})

describe('acknowledgement', () => {
  it('lists the classes still to acknowledge and allows apply once all are', () => {
    const result = plan([{ email: 'jane@example.com', name: '' }], {
      policy: createTransferPolicy({ fields: { name: { mode: 'overwrite', blank: 'clear' } } }),
    })
    expect(missingAcknowledgements(result, [])).toEqual(['clearValue'])
    expect(canApplyTransferPlan(result, [])).toBe(false)
    expect(canApplyTransferPlan(result, ['clearValue'])).toBe(true)
    expect(plannedWrites(result).map((row) => row.index)).toEqual([0])
  })

  it('does not allow applying a plan that writes nothing', () => {
    expect(canApplyTransferPlan(plan([{ email: 'jane@example.com' }]), [])).toBe(false)
  })

  it('asks for acknowledgement of everything but plain derivations', () => {
    expect(ACKNOWLEDGED_WARNING_CLASSES).not.toContain('derivation')
    expect(ACKNOWLEDGED_WARNING_CLASSES).toContain('overwriteNonBlank')
  })
})
