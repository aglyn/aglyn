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
  datasetDisplayName,
  datasetPickerOptions,
  defaultDatasetFieldId,
  humanizeDatasetFieldId,
  parseDatasetFieldEntries,
  parseDatasetFields,
  sanitizeRecordValues,
  slugifyDatasetFieldId,
  sortDatasetRecords,
  validateDatasetFieldId,
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

  it('slugifies human names into stable field ids (AGL-558)', () => {
    expect(slugifyDatasetFieldId('Roast preference')).toBe('roast_preference')
    expect(slugifyDatasetFieldId('  Unit-Price ($) ')).toBe('unit_price')
    expect(slugifyDatasetFieldId('9 lives')).toBe('lives')
    expect(slugifyDatasetFieldId('???')).toBe('')
  })

  describe('reference id defaults + validation (AGL-578)', () => {
    it('defaults the reference id from the display name, unique within the dataset', () => {
      expect(defaultDatasetFieldId('Roast preference', new Set())).toBe(
        'roast_preference',
      )
      // Collides with an existing id → suffixes to stay unique.
      expect(defaultDatasetFieldId('Title', new Set(['title']))).toBe('title_2')
      expect(
        defaultDatasetFieldId('Title', new Set(['title', 'title_2'])),
      ).toBe('title_3')
      // Uniqueness check is case-insensitive.
      expect(defaultDatasetFieldId('Title', new Set(['TITLE']))).toBe('title_2')
      // Nothing salvageable → empty (caller keeps the field un-addable).
      expect(defaultDatasetFieldId('???', new Set())).toBe('')
    })

    it('validates a user-entered reference id', () => {
      expect(validateDatasetFieldId('roast_level', new Set())).toBeNull()
      expect(validateDatasetFieldId('  spacey  ', new Set())).toBeNull()
      expect(validateDatasetFieldId('', new Set())).toMatch(/required/i)
      expect(validateDatasetFieldId('   ', new Set())).toMatch(/required/i)
      // Must start with a letter; no spaces or punctuation.
      expect(validateDatasetFieldId('9lives', new Set())).toMatch(/letter/i)
      expect(validateDatasetFieldId('has space', new Set())).toMatch(/letter/i)
      expect(validateDatasetFieldId('kebab-case', new Set())).toMatch(/letter/i)
      // Uniqueness, case-insensitive.
      expect(validateDatasetFieldId('title', new Set(['title']))).toMatch(
        /already uses/i,
      )
      expect(validateDatasetFieldId('Title', new Set(['title']))).toMatch(
        /already uses/i,
      )
    })
  })

  it('humanizes raw ids for display', () => {
    expect(humanizeDatasetFieldId('roast_preference')).toBe('Roast preference')
    expect(humanizeDatasetFieldId('title')).toBe('Title')
  })

  it('parses human field entries keeping pretty names (AGL-558)', () => {
    expect(
      parseDatasetFieldEntries('Roast preference, flavors, Roast Preference'),
    ).toEqual([
      { id: 'roast_preference', name: 'Roast preference' },
      { id: 'flavors', name: 'Flavors' },
    ])
    expect(parseDatasetFieldEntries('???, ,')).toEqual([])
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

  /**
   * The Actions card's "Save to dataset" select is built from these. Every
   * path that creates a dataset today writes `displayName` and no `name`, so
   * a select that keys on `name` offers nothing for any dataset made since
   * AGL-536.
   */
  describe('datasetPickerOptions', () => {
    it('offers a dataset that carries only displayName', () => {
      expect(
        datasetPickerOptions([{ $id: 'leads', displayName: 'Leads' }]),
      ).toEqual([{ id: 'leads', name: 'Leads' }])
    })

    it('labels a pre-migration dataset by its legacy name', () => {
      expect(
        datasetPickerOptions([{ $id: 'old', name: 'Subscribers' }]),
      ).toEqual([{ id: 'old', name: 'Subscribers' }])
    })

    it('prefers displayName when a document carries both', () => {
      expect(
        datasetPickerOptions([
          { $id: 'both', displayName: 'Customers', name: 'customers_v1' },
        ]),
      ).toEqual([{ id: 'both', name: 'Customers' }])
    })

    it('leaves out a deleted dataset', () => {
      expect(
        datasetPickerOptions([
          { $id: 'gone', displayName: 'Gone', deletedAt: 1 },
          { $id: 'kept', displayName: 'Kept' },
        ]),
      ).toEqual([{ id: 'kept', name: 'Kept' }])
    })

    it('offers a dataset with no name under its id instead of hiding it', () => {
      expect(datasetPickerOptions([{ $id: 'unnamed' }])).toEqual([
        { id: 'unnamed', name: 'unnamed' },
      ])
    })

    it('sorts by the label it shows', () => {
      expect(
        datasetPickerOptions([
          { $id: 'b', displayName: 'Orders' },
          { $id: 'a', name: 'Bookings' },
        ]).map((option) => option.name),
      ).toEqual(['Bookings', 'Orders'])
    })
  })

  describe('datasetDisplayName', () => {
    it('reads displayName, then name, and trims', () => {
      expect(datasetDisplayName({ displayName: ' Leads ' })).toBe('Leads')
      expect(datasetDisplayName({ displayName: '  ', name: 'legacy' })).toBe(
        'legacy',
      )
      expect(datasetDisplayName({})).toBe('')
      expect(datasetDisplayName(null)).toBe('')
    })
  })
})
