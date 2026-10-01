/**
 * @jest-environment node
 *
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

/**
 * A plugin's field validator runs before a dataset record is written
 * (AGL-2773, AGL-434).
 *
 * `validateCustomFieldValue` answers "no error" for a custom type nobody
 * registered, and a type is registered only when its plugin's console server
 * surface loads. So `loadCustomFieldTypes` asks the caller to load those
 * surfaces when — and only when — the model names a custom type.
 */

import type { CustomFieldType } from '@aglyn/aglyn'
import {
  registerCustomFieldType,
  validateDocument,
  type DatasetModel,
} from '@aglyn/aglyn/server'
import { loadCustomFieldTypes } from './custom-field-types'

/** A custom field type shaped like the marketplace's `rating`. */
const RATING_FIELD: CustomFieldType = {
  name: 'rating',
  pluginId: 'marketplace',
  label: 'Rating (0–5)',
  baseType: 'int32',
  description: 'Whole-number rating between 0 and 5.',
  validate: (value) => {
    const rating = Number(value)
    return Number.isInteger(rating) && rating >= 0 && rating <= 5
      ? null
      : 'must be a whole number from 0 to 5'
  },
}

/** A dataset with one field of the `rating` type. */
const RATED: DatasetModel = {
  order: ['stars'],
  fields: { stars: { name: 'Stars', type: 'int32', customType: 'rating' } },
}

const PLAIN: DatasetModel = {
  order: ['title'],
  fields: { title: { name: 'Title', type: 'text' } },
}

describe('loadCustomFieldTypes', () => {
  it('loads nothing for a dataset with no custom field', async () => {
    const load = jest.fn(async () => undefined)
    await loadCustomFieldTypes(PLAIN, load)
    expect(load).not.toHaveBeenCalled()
  })

  it('loads the plugins, so a custom validator refuses a bad value', async () => {
    // What the marketplace's console API registration does when it loads.
    const load = jest.fn(async () => {
      registerCustomFieldType(RATING_FIELD)
    })

    // Before the load nothing has registered `rating`, so nothing refuses 9.
    expect(validateDocument(RATED, { stars: 9 })).toEqual({})

    await loadCustomFieldTypes(RATED, load)

    expect(load).toHaveBeenCalledTimes(1)
    expect(validateDocument(RATED, { stars: 9 })).toEqual({
      stars: expect.stringContaining('0 to 5'),
    })
    expect(validateDocument(RATED, { stars: 4 })).toEqual({})
  })

  it('propagates a failed load rather than validating without the type', async () => {
    const load = jest.fn(async () => {
      throw new Error('loader down')
    })
    await expect(
      loadCustomFieldTypes({ order: ['mood'], fields: { mood: { customType: 'mood' } } }, load),
    ).rejects.toThrow('loader down')
  })
})
