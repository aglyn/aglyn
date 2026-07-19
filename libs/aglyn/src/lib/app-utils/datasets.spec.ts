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
  buildDatasetRecordValues,
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

  describe('buildDatasetRecordValues (AGL-556)', () => {
    // Model whose display names were BOTH renamed after creation — the
    // fieldIds are the original slugs and must stay the binding keys.
    const renamedModel = {
      fields: {
        satisfaction: { name: 'Happiness score', type: 'int32' as const },
        comments: { name: 'Visitor feedback', type: 'text' as const },
      },
      order: ['satisfaction', 'comments'],
    }

    it('stores mapped values under the stable fieldId despite renames', () => {
      expect(
        buildDatasetRecordValues(
          { model: renamedModel },
          { rating: '4', feedback: 'Great' },
          { rating: 'satisfaction', feedback: 'comments' },
        ),
      ).toEqual({ satisfaction: '4', comments: 'Great' })
    })

    it('drops fieldMap entries whose fieldId is not in the model', () => {
      expect(
        buildDatasetRecordValues(
          { model: renamedModel },
          { rating: '4', hack: 'nope' },
          { rating: 'satisfaction', hack: 'values.__proto__' },
        ),
      ).toEqual({ satisfaction: '4' })
    })

    it('falls back to name-intersection without a fieldMap', () => {
      expect(
        buildDatasetRecordValues(
          { model: renamedModel },
          { satisfaction: 5, other: 'dropped' },
        ),
      ).toEqual({ satisfaction: '5' })
    })

    it('mixes mapped and name-matched keys, mappings winning', () => {
      expect(
        buildDatasetRecordValues(
          { model: renamedModel },
          { rating: '3', comments: 'By name' },
          { rating: 'satisfaction' },
        ),
      ).toEqual({ satisfaction: '3', comments: 'By name' })
    })

    it('never lets a mapped submitted key double as a name match', () => {
      // `satisfaction` is explicitly re-mapped to `comments`; it must not
      // ALSO land under the same-named fieldId.
      expect(
        buildDatasetRecordValues(
          { model: renamedModel },
          { satisfaction: 'text answer' },
          { satisfaction: 'comments' },
        ),
      ).toEqual({ comments: 'text answer' })
    })

    it('derives the model from legacy flat fields', () => {
      expect(
        buildDatasetRecordValues(
          { fields: ['title', 'price'] },
          { title: 'Widget', price: 9, hack: 'nope' },
        ),
      ).toEqual({ title: 'Widget', price: '9' })
    })
  })
})
