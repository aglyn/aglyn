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
  type DatasetModel,
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
    const derived = deriveModelFromFields(['name', 'city'])
    expect(derived.order).toEqual(['name', 'city'])
    expect(derived.fields['name']).toEqual({ name: 'name', type: 'text' })
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
