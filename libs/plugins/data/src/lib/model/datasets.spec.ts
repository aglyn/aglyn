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

import { type DatasetModel, humanizeDatasetFieldId } from './dataset-models'
import {
  registerCustomFieldType,
  type CustomFieldType,
} from '@aglyn/aglyn/plugin-manager/custom-fields'
import {
  datasetDisplayName,
  describeDatasetRecordErrors,
  defaultDatasetFieldId,
  parseDatasetFieldEntries,
  parseDatasetFields,
  pickDatasetRecordInput,
  prepareDatasetRecordWrite,
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

  describe('field mapping of a form or automation write (AGL-556)', () => {
    // Model whose display names were BOTH renamed after creation — the
    // fieldIds are the original slugs and must stay the binding keys.
    const renamedModel = {
      fields: {
        satisfaction: { name: 'Happiness score', type: 'int32' as const },
        comments: { name: 'Visitor feedback', type: 'text' as const },
      },
      order: ['satisfaction', 'comments'],
    }
    const valuesOf = (
      input: Record<string, unknown>,
      fieldMap?: Record<string, string>,
    ) =>
      prepareDatasetRecordWrite({ model: renamedModel }, input, { fieldMap })
        .values

    it('stores mapped values under the stable fieldId despite renames', () => {
      expect(
        valuesOf(
          { rating: '4', feedback: 'Great' },
          { rating: 'satisfaction', feedback: 'comments' },
        ),
      ).toEqual({ satisfaction: 4, comments: 'Great' })
    })

    it('drops fieldMap entries whose fieldId is not in the model', () => {
      expect(
        valuesOf(
          { rating: '4', hack: 'nope' },
          { rating: 'satisfaction', hack: 'values.__proto__' },
        ),
      ).toEqual({ satisfaction: 4 })
    })

    it('falls back to name-intersection without a fieldMap', () => {
      expect(valuesOf({ satisfaction: 5, other: 'dropped' })).toEqual({
        satisfaction: 5,
      })
    })

    it('mixes mapped and name-matched keys, mappings winning', () => {
      expect(
        valuesOf(
          { rating: '3', comments: 'By name' },
          { rating: 'satisfaction' },
        ),
      ).toEqual({ satisfaction: 3, comments: 'By name' })
    })

    it('never lets a mapped submitted key double as a name match', () => {
      // `satisfaction` is explicitly re-mapped to `comments`; it must not
      // ALSO land under the same-named fieldId.
      expect(
        valuesOf({ satisfaction: 'text answer' }, { satisfaction: 'comments' }),
      ).toEqual({ comments: 'text answer' })
    })

    it('derives the model from legacy flat fields, where every field is text', () => {
      // A dataset from before models: every column is optional text, so a
      // number from an event payload is stored as the text it reads as —
      // exactly what these writes always stored.
      const write = prepareDatasetRecordWrite(
        { fields: ['title', 'price'] },
        { title: 'Widget', price: 9, hack: 'nope' },
      )
      expect(write.values).toEqual({ title: 'Widget', price: '9' })
      expect(write.errors).toEqual({})
    })

    it('picks raw values without coercing them', () => {
      expect(
        pickDatasetRecordInput(
          { model: renamedModel },
          { rating: '4', comments: 7 },
          { rating: 'satisfaction' },
        ),
      ).toEqual({ satisfaction: '4', comments: 7 })
    })
  })

  /**
   * AGL-2773, option B: a form's and an automation step's record is coerced
   * to the model's field types and refused, per field, when a value does not
   * fit. One case per field type, each with the value that coerces and the
   * value that is refused, so a type that silently stopped checking fails its
   * own row rather than hiding behind another's.
   */
  describe('prepareDatasetRecordWrite (AGL-2773)', () => {
    const typed: DatasetModel = {
      order: [
        'name',
        'tier',
        'subscribed',
        'seats',
        'bigSeats',
        'price',
        'startsAt',
        'location',
        'tags',
        'extra',
        'owner',
        'reviewers',
      ],
      fields: {
        name: { name: 'Name', type: 'text', validation: { max: 10 } },
        tier: {
          name: 'Tier',
          type: 'text',
          validation: { options: ['Gold', 'Silver'] },
        },
        subscribed: { name: 'Subscribed', type: 'bool' },
        seats: { name: 'Seats', type: 'int32', validation: { min: 1 } },
        bigSeats: { name: 'Big seats', type: 'int64' },
        price: { name: 'Price', type: 'float' },
        startsAt: { name: 'Starts', type: 'timestamp' },
        location: { name: 'Location', type: 'coordinates' },
        tags: { name: 'Tags', type: 'sorted' },
        extra: { name: 'Extra', type: 'map' },
        owner: {
          name: 'Owner',
          type: 'reference',
          reference: { datasetId: 'people' },
        },
        reviewers: {
          name: 'Reviewers',
          type: 'reference',
          reference: { datasetId: 'people', multiple: true },
        },
      },
    }
    const write = (input: Record<string, unknown>) =>
      prepareDatasetRecordWrite({ model: typed }, input)

    it.each([
      ['name', 'Ada', 'Ada', 'Ada Lovelace the First', /at most 10/],
      ['tier', 'Gold', 'Gold', 'Bronze', /one of: Gold, Silver/],
      ['subscribed', 'on', true, 'maybe', /true or false/],
      ['subscribed', 'false', false, 'perhaps', /true or false/],
      ['seats', '3', 3, '2.5', /whole number/],
      ['seats', '4', 4, '0', /≥ 1/],
      ['bigSeats', '9007199254740991', 9007199254740991, 'lots', /whole number/],
      ['price', '12.50', 12.5, 'twelve', /must be a number/],
      [
        'startsAt',
        '2026-09-30T12:00:00Z',
        Date.parse('2026-09-30T12:00:00Z'),
        'next Tuesday-ish',
        /must be a date/,
      ],
      [
        'location',
        '30.26, -97.74',
        { latitude: 30.26, longitude: -97.74 },
        '200, 10',
        /valid coordinates/,
      ],
      ['extra', '{"a":1}', { a: 1 }, '[1,2]', /must be a map/],
      ['owner', 'person-1', 'person-1', ['person-1'], /reference a document/],
    ] as const)(
      '%s: coerces %p and refuses %p',
      (fieldId, good, stored, bad, message) => {
        const accepted = write({ [fieldId]: good })
        expect(accepted.errors).toEqual({})
        expect(accepted.values[fieldId]).toEqual(stored)

        const refused = write({ [fieldId]: bad })
        expect(refused.errors[fieldId]).toMatch(message)
      },
    )

    it('splits a list and a multiple reference from the text a form posts', () => {
      // A checkbox group posts its ticked choices joined by `, `.
      const accepted = write({ tags: 'red, blue', reviewers: 'p1, p2' })
      expect(accepted.errors).toEqual({})
      expect(accepted.values).toEqual({
        tags: ['red', 'blue'],
        reviewers: ['p1', 'p2'],
      })
    })

    it('takes a JSON array or a real array for a list, as a workflow step or form sends one (AGL-3496)', () => {
      // An automation payload carries a list as the JSON it was serialized
      // to, or as the array itself. Split on commas it was stored as
      // `["[\"red\"", "\"blue\"]"]`.
      for (const input of [
        { tags: '["red","blue"]', reviewers: '["p1","p2"]' },
        { tags: ['red', ' blue '], reviewers: ['p1', 'p2', ''] },
      ]) {
        const accepted = write(input)
        expect(accepted.errors).toEqual({})
        expect(accepted.values).toEqual({
          tags: ['red', 'blue'],
          reviewers: ['p1', 'p2'],
        })
      }
      // The update leg merges through the same coercion.
      const merged = prepareDatasetRecordWrite({ model: typed }, { tags: '["green"]' }, {
        existing: { name: 'Ada', tags: ['red'] },
      })
      expect(merged.values).toEqual({ name: 'Ada', tags: ['green'] })
      expect(write({ tags: 7 }).errors['tags']).toMatch(/must be a list/)
    })

    it('stores a number or boolean sent to a text field as its text', () => {
      const accepted = write({ name: 42, tier: 'Gold' })
      expect(accepted.values['name']).toBe('42')
      expect(accepted.errors).toEqual({})
    })

    it('refuses a record that leaves a required field empty', () => {
      const model: DatasetModel = {
        order: ['email', 'note'],
        fields: {
          email: { name: 'Email', type: 'text', required: true },
          note: { name: 'Note', type: 'text' },
        },
      }
      const refused = prepareDatasetRecordWrite({ model }, { note: 'hi', email: '' })
      expect(refused.matched).toEqual(['email', 'note'])
      expect(refused.errors).toEqual({ email: 'Email is required' })
      expect(describeDatasetRecordErrors(refused.errors)).toBe(
        'Email is required',
      )
    })

    it('names every refused field in one line, in model order', () => {
      const refused = write({ seats: 'x', price: 'y' })
      expect(describeDatasetRecordErrors(refused.errors)).toBe(
        'Seats must be a whole number; Price must be a number',
      )
    })

    it('reports nothing matched when no submitted key is a field', () => {
      const none = write({ phone: '555' })
      expect(none.matched).toEqual([])
      expect(none.values).toEqual({})
    })

    describe('a merge into a stored row', () => {
      it('lays the coerced values over the stored ones', () => {
        const merged = prepareDatasetRecordWrite(
          { model: typed },
          { seats: '5' },
          { existing: { name: 'Ada', seats: 2 } },
        )
        expect(merged.errors).toEqual({})
        expect(merged.values).toEqual({ name: 'Ada', seats: 5 })
      })

      it('keeps a legacy text value it did not touch, and is not refused for it', () => {
        // Written by a form before AGL-2773: every value is text. The row
        // reads fine, and a merge that only sends `name` must not fail over
        // a `price` it never sent.
        const merged = prepareDatasetRecordWrite(
          { model: typed },
          { name: 'Grace' },
          { existing: { name: 'Ada', price: 'twelve', seats: '3' } },
        )
        expect(merged.errors).toEqual({})
        expect(merged.values).toEqual({
          name: 'Grace',
          price: 'twelve',
          seats: '3',
        })
      })

      it('still refuses a value it did send', () => {
        const merged = prepareDatasetRecordWrite(
          { model: typed },
          { seats: 'many' },
          { existing: { name: 'Ada' } },
        )
        expect(merged.errors).toEqual({
          seats: 'Seats must be a whole number',
        })
      })
    })

    it('runs a plugin field type’s validator once the type is registered', () => {
      const rating: CustomFieldType = {
        name: 'spec-rating',
        pluginId: 'spec',
        label: 'Rating',
        baseType: 'int32',
        validate: (value) =>
          Number(value) >= 0 && Number(value) <= 5 ? null : 'must be 0 to 5',
      }
      const model: DatasetModel = {
        order: ['stars'],
        fields: {
          stars: { name: 'Stars', type: 'int32', customType: 'spec-rating' },
        },
      }
      // Unregistered: the base type still guards storage, and 9 is an int.
      expect(prepareDatasetRecordWrite({ model }, { stars: '9' }).errors).toEqual(
        {},
      )
      registerCustomFieldType(rating)
      expect(prepareDatasetRecordWrite({ model }, { stars: '9' }).errors).toEqual({
        stars: 'Stars: must be 0 to 5',
      })
      const accepted = prepareDatasetRecordWrite({ model }, { stars: '4' })
      expect(accepted.errors).toEqual({})
      expect(accepted.values).toEqual({ stars: 4 })
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
