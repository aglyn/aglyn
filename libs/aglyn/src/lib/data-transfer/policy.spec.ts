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
  DEFAULT_TRANSFER_FIELD_POLICY,
  DEFAULT_TRANSFER_RECORD_POLICY,
  appendTransferList,
  applyFieldPolicy,
  compareTransferValues,
  createTransferPolicy,
  isBlankTransferValue,
  resolveFieldPolicy,
  resolveRecordPolicy,
  startingTransferPolicy,
  transferPolicyDefaultsFor,
  transferPolicyProblems,
  transferValuesEqual,
  withTransferPolicyDefaults,
} from './policy'
import type { TransferField } from './resource'

const name: TransferField = { id: 'name', label: 'Name', type: 'text' }
const tags: TransferField = { id: 'tags', label: 'Tags', type: 'tags' }
const stage: TransferField = { id: 'stage', label: 'Stage', type: 'picklist', picklistId: 'stage' }
const consent: TransferField = { id: 'consent', label: 'Consent', type: 'boolean' }
const fields = [name, tags, stage, consent]

describe('createTransferPolicy', () => {
  it('defaults to update, create, ask; fill blanks and leave on blank', () => {
    const policy = createTransferPolicy()
    expect(policy.record).toEqual(DEFAULT_TRANSFER_RECORD_POLICY)
    expect(policy.record).toEqual({ onMatch: 'update', onNew: 'create', onAmbiguous: 'ask' })
    expect(policy.fieldDefault).toEqual(DEFAULT_TRANSFER_FIELD_POLICY)
    expect(policy.fieldDefault).toEqual({ mode: 'fillBlanks', blank: 'leave' })
  })

  it('keeps what a partial policy says', () => {
    expect(createTransferPolicy({ record: { onMatch: 'skip' } as never }).record).toEqual({
      onMatch: 'skip',
      onNew: 'create',
      onAmbiguous: 'ask',
    })
  })
})

describe('resolveFieldPolicy', () => {
  const policy = createTransferPolicy({
    fieldDefault: { mode: 'fillBlanks', blank: 'leave' },
    fields: { name: { mode: 'overwrite' }, stage: { mode: 'overwrite', blank: 'clear' } },
    locked: [
      { fieldId: 'stage', reason: 'A stage never moves backward.', forced: { mode: 'fillBlanks' } },
      { fieldId: 'consent', reason: 'Consent is never asserted from a file.', refuseValues: true },
    ],
    rows: { 3: { fields: { name: { mode: 'keepExisting', blank: 'clear' }, tags: { mode: 'append' } } } },
  })

  it('takes a locked rule over everything, with its reason', () => {
    expect(resolveFieldPolicy(policy, 0, stage)).toMatchObject({
      mode: 'fillBlanks',
      blank: 'clear',
      source: 'locked',
      locked: { reason: 'A stage never moves backward.' },
    })
    expect(resolveFieldPolicy(policy, 0, consent)).toMatchObject({ refuseValues: true, source: 'default' })
  })

  it('takes a row override over a field choice, and a field choice over the default', () => {
    expect(resolveFieldPolicy(policy, 3, name)).toMatchObject({ mode: 'keepExisting', blank: 'clear', source: 'row' })
    expect(resolveFieldPolicy(policy, 0, name)).toMatchObject({ mode: 'overwrite', blank: 'leave', source: 'field' })
  })

  it('appends to lists by default and never appends to a single value', () => {
    expect(resolveFieldPolicy(policy, 0, tags)).toMatchObject({ mode: 'append', source: 'type' })
    const odd = createTransferPolicy({ fields: { name: { mode: 'append' } } })
    expect(resolveFieldPolicy(odd, 0, name).mode).toBe('overwrite')
  })
})

describe('resolveRecordPolicy', () => {
  it('folds in a row choice', () => {
    const policy = createTransferPolicy({ rows: { 2: { action: 'update', recordId: 'r9' } } })
    expect(resolveRecordPolicy(policy, 2)).toEqual({ ...DEFAULT_TRANSFER_RECORD_POLICY, action: 'update', recordId: 'r9' })
    expect(resolveRecordPolicy(policy, 1)).toEqual(DEFAULT_TRANSFER_RECORD_POLICY)
  })
})

describe('transferPolicyProblems', () => {
  it('reports unknown fields, appends to single values and choices a lock overrides', () => {
    const policy = createTransferPolicy({
      fields: { ghost: { mode: 'overwrite' }, name: { mode: 'append' }, stage: { mode: 'overwrite' } },
      locked: [
        { fieldId: 'stage', reason: 'A stage never moves backward.', forced: { mode: 'fillBlanks' } },
        { fieldId: 'phantom', reason: 'x' },
      ],
      rows: { 0: { fields: { name: { mode: 'append' } } } },
    })
    expect(transferPolicyProblems(policy, fields)).toEqual([
      'A field choice names "ghost", which is not a field.',
      'A field choice: "Name" is not a list, so it cannot be appended to.',
      'A field choice: "Stage" is locked — A stage never moves backward.',
      'Row 1: "Name" is not a list, so it cannot be appended to.',
      'A locked rule names "phantom", which is not a field.',
    ])
  })
})

describe('values', () => {
  it('knows what blank is', () => {
    expect(isBlankTransferValue(null)).toBe(true)
    expect(isBlankTransferValue('  ')).toBe(true)
    expect(isBlankTransferValue([])).toBe(true)
    expect(isBlankTransferValue({ city: '' })).toBe(true)
    expect(isBlankTransferValue(0)).toBe(false)
    expect(isBlankTransferValue(false)).toBe(false)
    expect(isBlankTransferValue(new Date(0))).toBe(false)
  })

  it('compares lists as caseless sets and objects by their values', () => {
    expect(transferValuesEqual(['A', 'b'], ['B', 'a'])).toBe(true)
    expect(transferValuesEqual(['a'], ['a', 'b'])).toBe(false)
    expect(transferValuesEqual({ a: 1, b: null }, { a: 1 })).toBe(true)
    expect(transferValuesEqual(null, '')).toBe(true)
    expect(transferValuesEqual(new Date(5), new Date(5))).toBe(true)
    expect(transferValuesEqual(1, '1')).toBe(false)
  })

  it('appends only the items a list lacks', () => {
    expect(appendTransferList(['vip', 'beta'], ['VIP', 'new'])).toEqual(['vip', 'beta', 'new'])
    expect(appendTransferList(null, 'one')).toEqual(['one'])
  })
})

describe('applyFieldPolicy', () => {
  const at = (mode: 'overwrite' | 'fillBlanks' | 'keepExisting' | 'append', blank: 'leave' | 'clear' = 'leave') => ({
    mode,
    blank,
    refuseValues: false,
  })

  it('overwrites, fills only blanks, or keeps', () => {
    expect(applyFieldPolicy(at('overwrite'), 'old', 'new')).toEqual({ after: 'new', changed: true, rule: 'written' })
    expect(applyFieldPolicy(at('overwrite'), 'same', 'same')).toEqual({ after: 'same', changed: false, rule: 'written' })
    expect(applyFieldPolicy(at('fillBlanks'), 'old', 'new')).toEqual({ after: 'old', changed: false, rule: 'kept' })
    expect(applyFieldPolicy(at('fillBlanks'), '', 'new')).toEqual({ after: 'new', changed: true, rule: 'filled' })
    expect(applyFieldPolicy(at('keepExisting'), '', 'new')).toEqual({ after: '', changed: false, rule: 'kept' })
  })

  it('appends list items', () => {
    expect(applyFieldPolicy(at('append'), ['a'], ['b'])).toEqual({ after: ['a', 'b'], changed: true, rule: 'appended' })
    expect(applyFieldPolicy(at('append'), ['a'], ['A'])).toEqual({ after: ['a'], changed: false, rule: 'appended' })
  })

  it('clears on a blank cell only when told to, and never under fill-blanks or keep', () => {
    expect(applyFieldPolicy(at('overwrite', 'clear'), 'old', '')).toEqual({ after: null, changed: true, rule: 'cleared' })
    expect(applyFieldPolicy(at('append', 'clear'), ['a'], [])).toEqual({ after: null, changed: true, rule: 'cleared' })
    expect(applyFieldPolicy(at('overwrite', 'leave'), 'old', null)).toEqual({ after: 'old', changed: false, rule: 'leftBlank' })
    expect(applyFieldPolicy(at('fillBlanks', 'clear'), 'old', '')).toEqual({ after: 'old', changed: false, rule: 'leftBlank' })
    expect(applyFieldPolicy(at('overwrite', 'clear'), null, '')).toEqual({ after: null, changed: false, rule: 'cleared' })
  })

  it('never writes a refused value', () => {
    expect(applyFieldPolicy({ ...at('overwrite'), refuseValues: true }, false, true)).toEqual({
      after: false,
      changed: false,
      rule: 'refused',
    })
  })
})

describe('a resource sets where the person starts (AGL-3548)', () => {
  const score: TransferField = { id: 'score', label: 'Score', type: 'integer', derived: true }

  it('keeps only the defaults that hold for these fields', () => {
    expect(transferPolicyDefaultsFor(undefined, fields)).toEqual({})
    expect(
      transferPolicyDefaultsFor(
        {
          record: { onMatch: 'skip', onNew: 'sometimes' as never },
          fieldDefault: { mode: 'overwrite', blank: 'nope' as never },
          fields: {
            name: { mode: 'append' },
            tags: { mode: 'append', blank: 'clear' },
            score: { mode: 'overwrite' },
            gone: { mode: 'overwrite' },
          },
          note: '  Why.  ',
        },
        [...fields, score],
      ),
    ).toEqual({
      record: { onMatch: 'skip' },
      fieldDefault: { mode: 'overwrite' },
      fields: { tags: { mode: 'append', blank: 'clear' } },
      note: 'Why.',
    })
  })

  it('starts the wizard on the resource defaults over the core ones', () => {
    expect(startingTransferPolicy(undefined)).toEqual({
      record: DEFAULT_TRANSFER_RECORD_POLICY,
      fieldDefault: DEFAULT_TRANSFER_FIELD_POLICY,
      fields: {},
      rows: {},
    })
    expect(startingTransferPolicy({ fieldDefault: { mode: 'overwrite' }, fields: { name: { blank: 'clear' } } })).toEqual({
      record: DEFAULT_TRANSFER_RECORD_POLICY,
      fieldDefault: { mode: 'overwrite', blank: 'leave' },
      fields: { name: { blank: 'clear' } },
      rows: {},
    })
  })

  it('lets every part the person chose win, and fills the rest from the resource', () => {
    const defaults = { record: { onNew: 'skip' as const }, fieldDefault: { mode: 'overwrite' as const }, fields: { name: { mode: 'keepExisting' as const } } }
    const none = createTransferPolicy(withTransferPolicyDefaults(defaults))
    expect(none.record).toEqual({ ...DEFAULT_TRANSFER_RECORD_POLICY, onNew: 'skip' })
    expect(none.fieldDefault).toEqual({ mode: 'overwrite', blank: 'leave' })
    expect(none.fields).toEqual({ name: { mode: 'keepExisting' } })
    const chosen = createTransferPolicy(
      withTransferPolicyDefaults(defaults, { record: { ...DEFAULT_TRANSFER_RECORD_POLICY }, fieldDefault: { mode: 'fillBlanks', blank: 'leave' }, fields: {} }),
    )
    expect(chosen.record.onNew).toBe('create')
    expect(chosen.fieldDefault.mode).toBe('fillBlanks')
    // Field choices sent are the whole set: one the person took back stays taken back.
    expect(chosen.fields).toEqual({})
  })
})

describe('a resource may say two values are the same (AGL-3548)', () => {
  const folded = (field: TransferField, a: unknown, b: unknown) =>
    field.id === 'stage' && typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : undefined

  it('asks the resource first and the core for what it leaves', () => {
    expect(compareTransferValues(stage, 'Won', 'won', folded)).toBe(true)
    expect(compareTransferValues(name, 'Won', 'won', folded)).toBe(false)
    expect(compareTransferValues(stage, 'Won', 'won')).toBe(false)
  })

  it('makes a folded value no change under any mode', () => {
    const equal = (a: unknown, b: unknown) => compareTransferValues(stage, a, b, folded)
    expect(applyFieldPolicy({ mode: 'overwrite', blank: 'leave', refuseValues: false }, 'won', 'Won', equal)).toEqual({
      after: 'Won',
      changed: false,
      rule: 'written',
    })
  })
})
