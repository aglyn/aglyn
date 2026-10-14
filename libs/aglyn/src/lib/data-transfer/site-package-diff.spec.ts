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
  packageItemChanges,
  packageJsonDiff,
  packageMergeKeys,
  packageRecordDiff,
  packageRecordField,
} from './site-package-diff'

describe('what an imported site item changes', () => {
  it('lists every leaf that differs, key by key, and counts the rows past the limit', () => {
    const { changes } = packageJsonDiff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 })
    expect(changes.map((one) => one.key)).toEqual(['b/c', 'd'])
    expect(changes[0]).toMatchObject({ label: 'b › c', before: 2, after: 3 })
    expect(packageJsonDiff({ a: 1, b: 2, c: 3 }, { a: 2, b: 3, c: 4 }, 2)).toMatchObject({ more: 1 })
    expect(packageJsonDiff('plain', 'other').changes[0]).toMatchObject({ key: '$', label: 'Whole item' })
  })

  it('keeps the site value of a merged key unless the site has none', () => {
    expect(packageMergeKeys({ a: 'x', b: '' }, { a: 'y', b: 'z', c: 1 }).map((one) => [one.key, one.merged])).toEqual([
      ['a', 'site'],
      ['b', 'package'],
      ['c', 'package'],
    ])
  })

  it('finds the one list of records by shape, and none where it is ambiguous', () => {
    expect(packageRecordField({ records: [{ $id: '1' }] }, { name: 'x' })).toBe('records')
    expect(packageRecordField({ a: [{ $id: '1' }], b: [{ $id: '2' }] })).toBeNull()
    expect(packageRecordField({ list: [1, 2] })).toBeNull()
  })

  it('matches records by id and names the fields that differ in order', () => {
    const diff = packageRecordDiff(
      [{ $id: '1', b: 1, a: 1 }, { $id: '2' }],
      [{ $id: '1', b: 2, a: 2 }, { $id: '3' }, { $id: '3' }],
    )
    expect(diff.rows.map((row) => [row.id, row.status, row.changed])).toEqual([
      ['1', 'changed', ['a', 'b']],
      ['3', 'added', []],
      ['2', 'removed', []],
    ])
  })

  it('sets an item’s records apart and says what each one changes', () => {
    const result = packageItemChanges(
      { name: 'Leads', records: [{ $id: '1', name: 'A' }, { $id: '2' }] },
      { name: 'Leads 2', records: [{ $id: '1', name: 'A2' }, { $id: '3' }] },
    )
    expect(result.recordField).toBe('records')
    expect(result.changes.map((one) => one.key)).toEqual(['name'])
    expect(result.records?.changes.map((one) => [one.label, one.status])).toEqual([
      ['1 › name', 'changed'],
      ['3', 'added'],
      ['2', 'removed'],
    ])
    expect(result.records?.summary).toBe('1 new record · 1 changed record · 1 record not in the file · 0 unchanged')
    expect(packageItemChanges(null, { title: 'Home' })).toMatchObject({ recordField: null, records: null })
  })
})
