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

import { datasetPickerLabels } from './dataset-model-core'
import { datasetRecordListSource } from './dataset-record-list'
import { datasetIndexedRecord } from './dataset-record'

/**
 * A dataset picker names a dataset alone, and says who it is shared with only
 * where two in the list share a name (AGL-4047).
 */

const entry = (id: string, name: string, sharing: string, fields = 3) => ({ id, name, sharing, fields })

describe('datasetPickerLabels', () => {
  it('names a dataset alone when no other in the list has its name', () => {
    expect(datasetPickerLabels([entry('a', 'Services', 'Bakery only'), entry('b', 'Menu', 'Bakery only')])).toEqual({
      a: 'Services',
      b: 'Menu',
    })
  })

  it('adds who it is shared with where two share a name, compared as the search key is', () => {
    expect(
      datasetPickerLabels([
        entry('a', 'Services', 'Bakery only'),
        entry('b', ' services ', 'Downtown only'),
        entry('c', 'Menu', 'All sites'),
      ]),
    ).toEqual({ a: 'Services · Bakery only', b: ' services  · Downtown only', c: 'Menu' })
  })

  it('adds the field count where the sharing matches too', () => {
    expect(
      datasetPickerLabels([entry('a', 'Services', '1 site', 5), entry('b', 'Services', '1 site', 1), entry('c', 'Services', 'All sites')]),
    ).toEqual({
      a: 'Services · 1 site · 5 fields',
      b: 'Services · 1 site · 1 field',
      c: 'Services · All sites',
    })
  })
})

describe('the dataset list source names its records for a picker', () => {
  const record = (id: string, displayName: string, visibleTo: string[]) =>
    datasetIndexedRecord(id, { displayName, fields: ['name', 'price'], visibleTo }) as NonNullable<
      ReturnType<typeof datasetIndexedRecord>
    >

  it('says who each is shared with, naming the sites the reader knows', () => {
    const records = [record('a', 'Services', ['host:bakery']), record('b', 'Services', ['host:downtown']), record('c', 'Menu', ['org'])]
    expect(datasetRecordListSource.pickerLabels?.(records, { hostNames: { bakery: 'Bakery' } })).toEqual({
      a: 'Services · Bakery only',
      b: 'Services · 1 site',
      c: 'Menu',
    })
  })
})
