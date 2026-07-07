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
  parseDatasetFields,
  sanitizeRecordValues,
  sortDatasetRecords,
} from './datasets'

describe('datasets', () => {
  it('parses field lists, dropping invalid and duplicate names', () => {
    expect(parseDatasetFields('title, price, image_url')).toEqual([
      'title',
      'price',
      'image_url',
    ])
    expect(parseDatasetFields('title, 9bad, Title, sp ace,\nbody')).toEqual([
      'title',
      'body',
    ])
    expect(parseDatasetFields('')).toEqual([])
  })

  it('sanitizes record values to declared fields as strings', () => {
    expect(
      sanitizeRecordValues(['title', 'price'], {
        title: 'Widget',
        price: 9,
        hack: 'nope',
        missing: undefined,
      }),
    ).toEqual({ title: 'Widget', price: '9' })
  })

  it('sorts records by order then id, unordered last', () => {
    const sorted = sortDatasetRecords([
      { $id: 'c' },
      { $id: 'b', order: 2 },
      { $id: 'a', order: 1 },
    ])
    expect(sorted.map((record) => record.$id)).toEqual(['a', 'b', 'c'])
  })
})
