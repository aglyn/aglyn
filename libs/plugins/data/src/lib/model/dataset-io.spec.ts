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
  datasetRecordsToCsv,
  mapImportColumns,
  parseCsv,
  parseImportRows,
  serializeDatasetValue,
} from './dataset-io'
import { type DatasetModel, coerceDocumentValues } from './dataset-models'

const model: DatasetModel = {
  order: ['title', 'price', 'launchedAt', 'location', 'tags'],
  fields: {
    title: { name: 'Title', type: 'text' },
    price: { name: 'Price', type: 'float' },
    launchedAt: { name: 'Launched', type: 'timestamp' },
    location: { name: 'Location', type: 'coordinates' },
    tags: { name: 'Tags', type: 'sorted' },
  },
}

describe('serializeDatasetValue / csv round-trip', () => {
  it('serializes typed values predictably and re-imports losslessly', () => {
    const row = {
      title: 'Widget, "deluxe"',
      price: 9.5,
      launchedAt: Date.parse('2026-01-15T00:00:00.000Z'),
      location: { latitude: 45.1, longitude: -122.6 },
      tags: ['red', 'blue'],
    }
    const csv = datasetRecordsToCsv(model, [row])
    const parsed = parseImportRows(csv)
    expect(parsed).toHaveLength(1)
    const coerced = coerceDocumentValues(model, parsed![0])
    expect(coerced['title']).toBe('Widget, "deluxe"')
    expect(coerced['price']).toBe(9.5)
    expect(coerced['launchedAt']).toBe(row.launchedAt)
    expect(coerced['location']).toEqual(row.location)
    expect(coerced['tags']).toEqual(['red', 'blue'])
  })
})

describe('parseCsv', () => {
  it('handles quotes, escapes, and CRLF', () => {
    expect(parseCsv('a,"b,1"\r\n"say ""hi""",c')).toEqual([
      ['a', 'b,1'],
      ['say "hi"', 'c'],
    ])
  })
})

describe('parseImportRows', () => {
  it('parses JSON arrays of objects', () => {
    expect(parseImportRows('[{"title":"A","price":1}]')).toEqual([
      { title: 'A', price: '1' },
    ])
  })

  it('returns null for junk', () => {
    expect(parseImportRows('')).toBeNull()
    expect(parseImportRows('not json and no header')).toBeNull()
  })
})

describe('mapImportColumns', () => {
  it('matches fieldIds and display names, reporting the rest', () => {
    const { mapping, unmatched } = mapImportColumns(model, [
      'title',
      'Price',
      'LAUNCHED',
      'mystery',
    ])
    expect(mapping).toEqual({
      title: 'title',
      Price: 'price',
      LAUNCHED: 'launchedAt',
    })
    expect(unmatched).toEqual(['mystery'])
  })
})
