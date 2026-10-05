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
  coerceDocumentValues,
  coerceListValue,
  type DatasetModel,
  datasetValueToInput,
  deriveModelFromFields,
  effectiveDatasetModel,
  validateDocument,
} from './dataset-models'

const model: DatasetModel = {
  order: ['title', 'price', 'inStock', 'launchedAt', 'location', 'tier'],
  fields: {
    title: {
      name: 'Title',
      type: 'text',
      required: true,
      validation: { min: 3, max: 20 },
    },
    price: { name: 'Price', type: 'float', validation: { min: 0 } },
    inStock: { name: 'In stock', type: 'bool' },
    launchedAt: { name: 'Launched', type: 'timestamp' },
    location: { name: 'Location', type: 'coordinates' },
    tier: {
      name: 'Tier',
      type: 'text',
      validation: { options: ['basic', 'plus'] },
    },
  },
}

describe('deriveModelFromFields / effectiveDatasetModel', () => {
  it('derives optional text fields from v1 columns', () => {
    const derived = deriveModelFromFields(['name', 'roast_preference'])
    expect(derived.order).toEqual(['name', 'roast_preference'])
    // Ids stay the stable keys; display names humanize (AGL-558).
    expect(derived.fields['name']).toEqual({ name: 'Name', type: 'text' })
    expect(derived.fields['roast_preference']).toEqual({
      name: 'Roast preference',
      type: 'text',
    })
  })

  it('prefers a stored model and falls back to v1 fields', () => {
    expect(effectiveDatasetModel({ model }).order).toContain('price')
    expect(effectiveDatasetModel({ fields: ['a'] }).fields['a'].type).toBe(
      'text',
    )
  })
})

describe('validateDocument', () => {
  it('accepts a valid document', () => {
    expect(
      validateDocument(model, {
        title: 'Widget',
        price: 9.5,
        inStock: true,
        launchedAt: Date.now(),
        location: { latitude: 45.1, longitude: -122.6 },
        tier: 'plus',
      }),
    ).toEqual({})
  })

  it('reports required, bounds, enum, and type errors per field', () => {
    const errors = validateDocument(model, {
      title: 'ab',
      price: -1,
      inStock: 'yes',
      location: { latitude: 99, longitude: 0 },
      tier: 'gold',
    })
    expect(errors['title']).toMatch(/at least 3/)
    expect(errors['price']).toMatch(/≥ 0/)
    expect(errors['inStock']).toMatch(/true or false/)
    expect(errors['location']).toMatch(/coordinates/)
    expect(errors['tier']).toMatch(/one of/)
    expect(validateDocument(model, {})['title']).toMatch(/required/)
  })
})

describe('coerceDocumentValues', () => {
  it('parses strings into storage form per type', () => {
    const values = coerceDocumentValues(model, {
      title: 'Widget',
      price: '9.50',
      inStock: 'true',
      launchedAt: '2026-01-15T00:00:00Z',
      location: '45.1, -122.6',
    })
    expect(values['price']).toBe(9.5)
    expect(values['inStock']).toBe(true)
    expect(values['launchedAt']).toBe(Date.parse('2026-01-15T00:00:00Z'))
    expect(values['location']).toEqual({ latitude: 45.1, longitude: -122.6 })
  })

  it('passes unparseable input through for validation to report', () => {
    const values = coerceDocumentValues(model, {
      price: 'not-a-number',
      inStock: 'maybe',
    })
    expect(values['price']).toBe('not-a-number')
    expect(validateDocument(model, values)['price']).toMatch(/number/)
    expect(validateDocument(model, values)['inStock']).toMatch(/true or false/)
  })
})

/**
 * List values (AGL-3496). The EDR Services dataset stored its `categories` as
 * `["[\"Residential\"", "\"Commercial\"]"]`: a JSON array arrived as a
 * string and was split on its commas, so no repeat filter ever matched it.
 */
describe('coerceListValue', () => {
  it('takes a real array as the list — entries stringified and trimmed, empties dropped', () => {
    expect(coerceListValue([' Residential ', 'Commercial', '', null, 3, true])).toEqual([
      'Residential',
      'Commercial',
      '3',
      'true',
    ])
    expect(coerceListValue([])).toEqual([])
  })

  it('takes a string that parses as a JSON array of scalars as that array', () => {
    expect(coerceListValue('["Residential","Commercial"]')).toEqual(['Residential', 'Commercial'])
    expect(coerceListValue('  [ "a, b" , 2 ]  ')).toEqual(['a, b', '2'])
    expect(coerceListValue('[]')).toEqual([])
  })

  it('comma-splits any other string, as typed into the form', () => {
    expect(coerceListValue('Residential, Commercial')).toEqual(['Residential', 'Commercial'])
    expect(coerceListValue(' a ,, b ,')).toEqual(['a', 'b'])
    // Bracketed but not JSON: still a comma list.
    expect(coerceListValue('[draft], final')).toEqual(['[draft]', 'final'])
    expect(coerceListValue('[a, b]')).toEqual(['[a', 'b]'])
  })

  it('leaves junk for validation to refuse', () => {
    expect(coerceListValue(42)).toBe(42)
    expect(coerceListValue({ a: 1 })).toEqual({ a: 1 })
    expect(coerceListValue([{ a: 1 }, 'b'])).toEqual([{ a: 1 }, 'b'])
    // A JSON array holding objects is not a list of values: comma-split as
    // any other string would be, never flattened into `[object Object]`.
    expect(coerceListValue('[{"a":1}]')).toEqual(['[{"a":1}]'])
  })

  it('repairs a record stored as fragments when the console form re-saves it', () => {
    const listModel: DatasetModel = {
      order: ['categories'],
      fields: { categories: { name: 'Categories', type: 'sorted' } },
    }
    const field = listModel.fields['categories']
    const corrupted = ['["Residential"', '"Commercial"]']
    // What the record form shows for the stored value, then saves back.
    const shown = datasetValueToInput(field, corrupted)
    expect(coerceDocumentValues(listModel, { categories: shown })).toEqual({
      categories: ['Residential', 'Commercial'],
    })
  })
})

describe('coerceDocumentValues on list fields (AGL-3496)', () => {
  const listModel: DatasetModel = {
    order: ['categories', 'related', 'author'],
    fields: {
      categories: { name: 'Categories', type: 'sorted', required: true },
      related: { name: 'Related', type: 'reference', reference: { datasetId: 'd2', multiple: true } },
      author: { name: 'Author', type: 'reference', reference: { datasetId: 'd3' } },
    },
  }

  it('coerces a sorted and a multiple reference field through the one list coercion', () => {
    const values = coerceDocumentValues(listModel, {
      categories: '["Residential","Commercial"]',
      related: '["r1","r2"]',
      author: 'a1',
    })
    expect(values).toEqual({
      categories: ['Residential', 'Commercial'],
      related: ['r1', 'r2'],
      author: 'a1',
    })
    expect(validateDocument(listModel, values)).toEqual({})
  })

  it('normalizes an array an API client sent, and refuses what is not a list', () => {
    expect(coerceDocumentValues(listModel, { categories: [' a ', ''], related: ['r1', ''] })).toEqual({
      categories: ['a'],
      related: ['r1'],
    })
    expect(validateDocument(listModel, coerceDocumentValues(listModel, { categories: 7 }))['categories']).toMatch(
      /must be a list/,
    )
    expect(
      validateDocument(listModel, coerceDocumentValues(listModel, { categories: [{ a: 1 }] }))['categories'],
    ).toMatch(/must be a list/)
    expect(validateDocument(listModel, { categories: 'Residential' })['categories']).toMatch(/must be a list/)
  })

  it('treats an empty list as missing for a required field', () => {
    const values = coerceDocumentValues(listModel, { categories: ' , ' })
    expect(values['categories']).toEqual([])
    expect(validateDocument(listModel, values)['categories']).toMatch(/required/)
  })
})
