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
 * The record view describes a value; it does not stringify one.
 *
 * `formatDatasetValue` collapses every state that has no short string to
 * `''`, which the table prints as `--`. That is right for a cell and wrong
 * for a record view, and this file pins the states the collapse loses:
 *
 *  1. ABSENT, NULL AND EMPTY TEXT ARE THREE FACTS. All three format to `''`.
 *     A reader deciding whether a field was never filled in, was cleared, or
 *     holds a real empty string gets a different answer from each.
 *  2. AN UNRESOLVED REFERENCE SAYS SO. `String(id)` is what the table shows
 *     for a dangling FKey, which is indistinguishable from a resolved
 *     reference whose label reads like an ID.
 *  3. BINARY IS NOT TEXT. `bytes` reaches `String(value)`, so a Firestore
 *     `Bytes` prints `[object Object]` — a placeholder that looks like data.
 *  4. A STRUCTURE THAT WILL NOT SERIALIZE IS REPORTED, NOT PRINTED.
 *  5. THE RECORD IS THE UNION, NOT THE COLUMNS. A field declared without a
 *     display slot, and a stored value whose field the model no longer has,
 *     are both real and both invisible to a table built from `model.order`.
 *
 * A real value's text still comes from `formatDatasetValue`, so the two
 * surfaces cannot disagree about a value that has one.
 */

import {
  datasetRecordFields,
  describeDatasetValue,
} from './dataset-record-view'
import type { DatasetModel } from './dataset-models'

const model: DatasetModel = {
  order: ['title', 'note', 'count', 'inStock', 'tags', 'meta', 'owner', 'blob'],
  fields: {
    title: { name: 'Title', type: 'text', required: true },
    note: { name: 'Note', type: 'text' },
    count: { name: 'Count', type: 'int32' },
    inStock: { name: 'In stock', type: 'bool' },
    tags: { name: 'Tags', type: 'sorted' },
    meta: { name: 'Meta', type: 'map' },
    owner: {
      name: 'Owner',
      type: 'reference',
      reference: { datasetId: 'people', displayFieldId: 'name' },
    },
    blob: { name: 'Blob', type: 'bytes' },
  },
}

const describe1 = (fieldId: string, values: Record<string, unknown>) =>
  describeDatasetValue(model.fields[fieldId], values, fieldId)

describe('describeDatasetValue — the states a cell collapses', () => {
  it('tells absent, null and a real empty string apart', () => {
    // The contract in one assertion: three different stored realities, three
    // different kinds. The table shows `--` for all three.
    expect(describe1('note', {}).kind).toBe('absent')
    expect(describe1('note', { note: null }).kind).toBe('null')
    expect(describe1('note', { note: '' }).kind).toBe('empty-text')
    // And none of them carries text a renderer could mistake for content.
    for (const values of [{}, { note: null }, { note: '' }]) {
      expect(describe1('note', values).text).toBe('')
    }
  })

  it('reads a key stored as undefined as absent', () => {
    // Firestore cannot store `undefined`, but an in-memory row assembled by
    // an importer or a converter can carry one, and it means the same thing.
    expect(describe1('note', { note: undefined }).kind).toBe('absent')
  })

  it('distinguishes an empty list and an empty map from a missing one', () => {
    expect(describe1('tags', { tags: [] }).kind).toBe('empty-list')
    expect(describe1('meta', { meta: {} }).kind).toBe('empty-map')
    expect(describe1('tags', {}).kind).toBe('absent')
  })

  it('takes a real value’s text from the grid formatter', () => {
    // Not re-implemented here: the record view and the table must never
    // disagree about a value that has a short form.
    expect(describe1('title', { title: 'Kettle' })).toEqual({
      kind: 'value',
      text: 'Kettle',
      block: false,
    })
    expect(describe1('count', { count: 0 }).text).toBe('0')
    expect(describe1('inStock', { inStock: false }).text).toBe('—')
    expect(describe1('tags', { tags: ['a', 'b'] }).text).toBe('a, b')
  })

  it('keeps a stored zero and a stored false as values', () => {
    // The falsy pair a truthiness check loses. Both are real answers.
    expect(describe1('count', { count: 0 }).kind).toBe('value')
    expect(describe1('inStock', { inStock: false }).kind).toBe('value')
  })

  it('keeps a list’s items apart instead of joining them', () => {
    // The ambiguity being removed: both of these join to the same string.
    const two = describe1('tags', { tags: ['a', 'b'] })
    const one = describe1('tags', { tags: ['a, b'] })
    expect(two.text).toBe(one.text)
    expect(two.items).toEqual(['a', 'b'])
    expect(one.items).toEqual(['a, b'])
  })

  it('serializes a list item that is itself a structure', () => {
    // `String({})` is `[object Object]`, repeated once per item.
    const value = describe1('tags', { tags: [{ a: 1 }, 2, null] })
    expect(value.items).toEqual(['{\n  "a": 1\n}', '2', 'null'])
  })

  it('does not treat an array stored against a map field as a list', () => {
    // Declared `map`, holding an array: a mismatch `validateDocument` reports.
    // Printing it as a list would dress the mismatch up as a list field.
    const value = describe1('meta', { meta: [1, 2] })
    expect(value.items).toBeUndefined()
    expect(value.text).toBe('[\n  1,\n  2\n]')
  })

  it('pretty-prints a nested map across lines', () => {
    const value = describe1('meta', { meta: { a: { b: 1 } } })
    expect(value.kind).toBe('value')
    expect(value.block).toBe(true)
    expect(value.text).toBe('{\n  "a": {\n    "b": 1\n  }\n}')
  })

  it('reports a structure that will not serialize instead of printing it', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic['self'] = cyclic
    const value = describe1('meta', { meta: cyclic })
    expect(value.kind).toBe('opaque')
    expect(value.text).toBe('Value cannot be displayed')
    // The failure mode being refused: `String(value)` on this is
    // `[object Object]`, which reads as a value rather than as its absence.
    expect(value.text).not.toContain('[object Object]')
  })
})

describe('describeDatasetValue — references', () => {
  const resolve = (fieldId: string, id: string) =>
    fieldId === 'owner' && id === 'p1' ? 'Ada Lovelace' : null

  it('marks a resolved target with its label and an unresolved one as null', () => {
    const value = describeDatasetValue(
      model.fields['owner'],
      { owner: 'p1' },
      'owner',
      resolve,
    )
    expect(value.references).toEqual([{ id: 'p1', label: 'Ada Lovelace' }])

    const dangling = describeDatasetValue(
      model.fields['owner'],
      { owner: 'p9' },
      'owner',
      resolve,
    )
    // The whole point: the ID is still reported, and `label: null` is what
    // lets the renderer say it is unresolved rather than printing the ID as
    // though it were the answer.
    expect(dangling.references).toEqual([{ id: 'p9', label: null }])
  })

  it('flattens a multiple reference and resolves each target separately', () => {
    const value = describeDatasetValue(
      model.fields['owner'],
      { owner: ['p1', 'p9'] },
      'owner',
      resolve,
    )
    expect(value.references).toEqual([
      { id: 'p1', label: 'Ada Lovelace' },
      { id: 'p9', label: null },
    ])
    expect(value.text).toBe('Ada Lovelace, p9')
  })

  it('treats a reference array of blanks as an empty list', () => {
    const value = describeDatasetValue(
      model.fields['owner'],
      { owner: ['', '  '] },
      'owner',
      resolve,
    )
    expect(value.kind).toBe('empty-list')
    expect(value.references).toBeUndefined()
  })
})

describe('describeDatasetValue — binary', () => {
  it('describes raw octets rather than stringifying them', () => {
    const value = describe1('blob', { blob: new Uint8Array([1, 2, 3, 4]) })
    expect(value.kind).toBe('opaque')
    expect(value.text).toBe('Binary value · 4 bytes')
    // `String(new Uint8Array([1,2,3,4]))` is "1,2,3,4", which reads as a
    // four-item list of small numbers.
    expect(value.text).not.toBe('1,2,3,4')
  })

  it('measures a Firestore Bytes wrapper through its accessor', () => {
    const bytes = { toUint8Array: () => new Uint8Array(24) }
    expect(describe1('blob', { blob: bytes })).toEqual({
      kind: 'opaque',
      text: 'Binary value · 24 bytes',
      block: false,
    })
  })

  it('still says binary when the length cannot be read', () => {
    const bytes = {
      toUint8Array: () => {
        throw new Error('detached')
      },
    }
    expect(describe1('blob', { blob: bytes }).text).toBe('Binary value')
  })
})

describe('datasetRecordFields — the whole record, not a wider row', () => {
  const values = {
    title: 'Kettle',
    note: '',
    // Declared in `fields` and absent from `order`: a table built from the
    // columns cannot show this, and it holds a live FKey.
    auditedBy: 'p1',
    // Stored with no field in the model at all — a field the model used to
    // have, or a key an import wrote.
    legacy_code: 'X-17',
  }
  const withHidden: DatasetModel = {
    order: model.order,
    fields: {
      ...model.fields,
      auditedBy: {
        name: 'Audited by',
        type: 'reference',
        reference: { datasetId: 'people' },
      },
    },
  }

  it('lists the model’s order first, then declared-but-unordered fields', () => {
    const fields = datasetRecordFields(withHidden, values)
    expect(fields.slice(0, model.order.length).map((f) => f.fieldId)).toEqual(
      model.order,
    )
    const audited = fields.find((f) => f.fieldId === 'auditedBy')
    expect(audited?.source).toBe('model')
    expect(audited?.value.references).toEqual([{ id: 'p1', label: null }])
  })

  it('includes a stored value the model does not declare, marked extra', () => {
    const fields = datasetRecordFields(withHidden, values)
    const legacy = fields.find((f) => f.fieldId === 'legacy_code')
    expect(legacy).toMatchObject({
      source: 'extra',
      label: 'Legacy code',
      value: { kind: 'value', text: 'X-17' },
    })
    // Undeclared means no declared type — reporting one would be a guess.
    expect(legacy?.type).toBeUndefined()
  })

  it('lists a declared field the record does not carry', () => {
    // The other half of "the whole record": a model field with no stored
    // value is still part of the record's shape, and saying so is the only
    // way a reader can tell it apart from a field that does not exist.
    const fields = datasetRecordFields(model, { title: 'Kettle' })
    expect(fields.map((f) => f.fieldId)).toEqual(model.order)
    expect(fields.find((f) => f.fieldId === 'count')?.value.kind).toBe('absent')
  })

  it('carries the label, description and required flag from the model', () => {
    const described: DatasetModel = {
      order: ['title'],
      fields: {
        title: {
          name: 'Title',
          type: 'text',
          description: 'Shown in the picker',
          validation: { required: true },
        },
      },
    }
    expect(datasetRecordFields(described, {})[0]).toMatchObject({
      label: 'Title',
      description: 'Shown in the picker',
      required: true,
      type: 'text',
    })
  })

  it('never lists a field twice', () => {
    // `order` and `Object.keys(fields)` overlap by design, and the stored
    // keys overlap both.
    const ids = datasetRecordFields(withHidden, values).map((f) => f.fieldId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('holds up on a v1 dataset with no model at all', () => {
    const fields = datasetRecordFields(
      { fields: {}, order: [] },
      { a: 1, b: null },
    )
    expect(fields.map((f) => [f.fieldId, f.value.kind])).toEqual([
      ['a', 'value'],
      ['b', 'null'],
    ])
  })
})
