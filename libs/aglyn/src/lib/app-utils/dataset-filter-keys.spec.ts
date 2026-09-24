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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DATASET_FILTER_KEYS_MAX,
  datasetFilterKeys,
  datasetFilterToken,
  datasetFilterTokens,
  datasetFilterWords,
  datasetSearchToken,
} from './dataset-filter-keys'
import {
  datasetIntegrityFields,
  datasetIntegrityUpdate,
  type DatasetModel,
} from './dataset-models'

const model: DatasetModel = {
  order: ['title', 'status', 'active', 'price', 'count', 'tags', 'due', 'owner', 'meta'],
  fields: {
    title: { name: 'Title', type: 'text' },
    status: {
      name: 'Status',
      type: 'text',
      validation: { options: ['Open', 'Closed'] },
    },
    active: { name: 'Active', type: 'bool' },
    price: { name: 'Price', type: 'float' },
    count: { name: 'Count', type: 'int32' },
    tags: { name: 'Tags', type: 'sorted' },
    due: { name: 'Due', type: 'timestamp' },
    owner: {
      name: 'Owner',
      type: 'reference',
      reference: { datasetId: 'people' },
    },
    meta: { name: 'Meta', type: 'map' },
  },
}

describe('datasetFilterKeys', () => {
  const keys = datasetFilterKeys(model, {
    title: 'Red Kettle',
    status: 'Open',
    active: true,
    price: 19.5,
    count: 3,
    tags: ['Kitchen', 'sale'],
    due: 1_700_000_000_000,
    owner: 'person-1',
    meta: { a: 1 },
  })

  it('keeps an enum value exactly', () => {
    expect(keys).toContain('f:status=Open')
    expect(keys).not.toContain('f:status=open')
  })

  it('lower-cases plain text and adds a prefix token per word', () => {
    expect(keys).toContain('f:title=red kettle')
    for (const prefix of ['r', 're', 'red', 'k', 'ke', 'kettle']) {
      expect(keys).toContain(`f:title^${prefix}`)
    }
  })

  it('writes booleans, numbers and list members as `=` tokens', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'f:active=true',
        'f:price=19.5',
        'f:count=3',
        'f:tags=Kitchen',
        'f:tags=sale',
      ]),
    )
  })

  it('writes no field token for timestamps, references or maps', () => {
    expect(keys.some((key) => key.startsWith('f:due'))).toBe(false)
    expect(keys.some((key) => key.startsWith('f:owner'))).toBe(false)
    expect(keys.some((key) => key.startsWith('f:meta'))).toBe(false)
    // A reference id is not a word anyone searches for.
    expect(keys).not.toContain('s:person')
  })

  it('searches every text value, enums and list members included', () => {
    expect(keys).toEqual(
      expect.arrayContaining(['s:red', 's:kettle', 's:open', 's:kitchen', 's:sale']),
    )
  })

  it('is sorted and de-duplicated', () => {
    expect(keys).toEqual([...new Set(keys)].sort())
  })

  it('reads a number or boolean a form stored as text', () => {
    const fromForm = datasetFilterKeys(model, { price: '19.50', active: 'false' })
    expect(fromForm).toEqual(['f:active=false', 'f:price=19.5'])
  })

  it('clips a long value, a long word, and a long list of words', () => {
    const long = 'a'.repeat(100)
    const clipped = datasetFilterKeys(model, { title: long })
    expect(clipped).toContain(`f:title=${'a'.repeat(64)}`)
    expect(clipped).toContain(`f:title^${'a'.repeat(12)}`)
    expect(clipped).not.toContain(`f:title^${'a'.repeat(13)}`)

    const words = Array.from({ length: 60 }, (_, at) => `w${at}`).join(' ')
    const many = datasetFilterKeys(model, { title: words })
    expect(many).toContain('s:w39')
    expect(many).not.toContain('s:w40')
  })

  it('caps the array, keeping `=` tokens ahead of prefixes', () => {
    const wide: DatasetModel = { order: [], fields: {} }
    const values: Record<string, unknown> = {}
    for (let at = 0; at < 30; at += 1) {
      wide.fields[`t${at}`] = { name: `T${at}`, type: 'text' }
      wide.order.push(`t${at}`)
      values[`t${at}`] = Array.from({ length: 10 }, (_, w) => `word${at}x${w}`).join(' ')
    }
    const capped = datasetFilterKeys(wide, values)
    expect(capped).toHaveLength(DATASET_FILTER_KEYS_MAX)
    for (let at = 0; at < 30; at += 1) {
      expect(capped.some((key) => key.startsWith(`f:t${at}=`))).toBe(true)
    }
  })

  it('writes nothing for a record with no filterable value', () => {
    expect(datasetFilterKeys(model, { due: 5, title: '   ' })).toEqual([])
    expect(datasetFilterKeys(model, undefined)).toEqual([])
  })
})

describe('datasetFilterToken', () => {
  const token = (field: string, op: string, value: string) =>
    datasetFilterToken(model, { field, op, value })

  it('serves equality on every field that has an `=` token', () => {
    expect(token('status', 'equals', 'Open')).toBe('f:status=Open')
    expect(token('active', 'equals', 'true')).toBe('f:active=true')
    expect(token('active', 'is', 'false')).toBe('f:active=false')
    expect(token('price', '=', '19.50')).toBe('f:price=19.5')
    expect(token('tags', 'contains', 'Kitchen')).toBe('f:tags=Kitchen')
    expect(token('title', 'equals', '  Red KETTLE ')).toBe('f:title=red kettle')
  })

  it('serves a text `contains` as the first word’s prefix', () => {
    expect(token('title', 'contains', 'Ket')).toBe('f:title^ket')
    expect(token('title', 'contains', 'red kett')).toBe('f:title^red')
    expect(
      datasetFilterTokens(model, { field: 'title', op: 'contains', value: 'red kett' }),
    ).toEqual(['f:title^red', 'f:title^kett'])
  })

  it('serves nothing a token cannot answer', () => {
    expect(token('price', '>', '5')).toBeNull()
    expect(token('due', 'is', '2026-01-01')).toBeNull()
    expect(token('title', 'isEmpty', '')).toBeNull()
    expect(token('title', 'startsWith', 'red')).toBeNull()
    expect(token('status', 'isAnyOf', 'Open,Closed')).toBeNull()
    expect(token('status', 'doesNotEqual', 'Open')).toBeNull()
    expect(token('owner', 'equals', 'person-1')).toBeNull()
    expect(token('missing', 'equals', 'x')).toBeNull()
    expect(token('price', '=', 'abc')).toBeNull()
  })

  it('names a token the record actually holds', () => {
    // The whole design rests on this: a served clause is only as good as the
    // writer and the reader agreeing on the spelling.
    const keys = datasetFilterKeys(model, {
      title: 'Red Kettle',
      status: 'Open',
      price: 19.5,
    })
    for (const served of [
      token('title', 'contains', 'KETT'),
      token('title', 'equals', 'red kettle'),
      token('status', 'equals', 'Open'),
      token('price', '=', '19.5'),
      datasetSearchToken('Kettl'),
    ]) {
      expect(keys).toContain(served)
    }
  })
})

describe('datasetSearchToken', () => {
  it('lower-cases and clips a word to its stored prefix', () => {
    expect(datasetSearchToken('Kettle')).toBe('s:kettle')
    expect(datasetSearchToken('Extraordinarily')).toBe('s:extraordinar')
    expect(datasetSearchToken('---')).toBeNull()
    expect(datasetFilterWords("O'Brien café")).toEqual(['o', 'brien', 'café'])
  })
})

describe('the integrity writers carry the tokens', () => {
  it('omits an empty array on a create and clears it on a merge', () => {
    expect('filterKeys' in datasetIntegrityFields(model, { due: 5 })).toBe(false)
    expect(datasetIntegrityFields(model, { status: 'Open' }).filterKeys).toEqual([
      'f:status=Open',
      's:o',
      's:op',
      's:ope',
      's:open',
    ])
    const clear = Symbol('deleteField')
    expect(datasetIntegrityUpdate(model, { due: 5 }, clear).filterKeys).toBe(clear)
  })

  it('stays importable by a plain Node script', () => {
    // The backfill imports this file under Node's type stripping, which
    // erases `import type` and nothing else.
    const source = readFileSync(join(__dirname, 'dataset-filter-keys.ts'), 'utf8')
    const imports = source.match(/^import .*$/gm) ?? []
    expect(imports.every((line) => line.startsWith('import type '))).toBe(true)
  })
})
