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

/**
 * A plugin's field validator runs on every console path that writes a record
 * (AGL-2773).
 *
 * `validateCustomFieldValue` answers "no error" for a custom type nobody
 * registered, and a type is registered only when its plugin's server entry
 * loads. The console's record write paths — `/api/orgs/datasets`, the `/v1`
 * record handlers and site import — validate records but do not load plugins,
 * so a marketplace `rating` of 9 could pass the validation those paths run.
 *
 * Two halves: the helper does what it says, and each write path calls it
 * between deriving the model and validating against it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  registerCustomFieldType,
  validateDocument,
  type DatasetModel,
} from '@aglyn/aglyn/server'
import { RATING_FIELD } from '@aglyn/plugins-marketplace/model/rating-field'

const mockEnsureAll = jest.fn()

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: (...args: unknown[]) => mockEnsureAll(...args),
  },
}))

/** A dataset with one field of the marketplace's `rating` type. */
const RATED: DatasetModel = {
  order: ['stars'],
  fields: { stars: { name: 'Stars', type: 'int32', customType: 'rating' } },
}

const PLAIN: DatasetModel = {
  order: ['title'],
  fields: { title: { name: 'Title', type: 'text' } },
}

/** The console paths that validate a record before writing it. */
const RECORD_WRITERS = [
  'app/api/orgs/datasets/route.ts',
  'utils/api-v1-resources.ts',
  'app/api/hosts/import/route.ts',
]

describe('every console record write loads custom field types first', () => {
  it.each(RECORD_WRITERS)('%s', (file) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8')
    const validations = [...source.matchAll(/validateDocument\(/g)].map(
      (match) => match.index ?? 0,
    )
    // A path that stopped validating would pass the loop below vacuously.
    expect(validations.length).toBeGreaterThan(0)
    for (const at of validations) {
      const modelAt = source.lastIndexOf('effectiveDatasetModel(', at)
      expect(modelAt).toBeGreaterThan(-1)
      expect(source.slice(modelAt, at)).toContain('ensureCustomFieldTypes(')
    }
  })
})

describe('ensureCustomFieldTypes', () => {
  beforeEach(() => {
    mockEnsureAll.mockReset()
  })

  it('loads nothing for a dataset with no custom field', async () => {
    const { ensureCustomFieldTypes } = await import(
      '../utils/ensure-custom-field-types'
    )

    await ensureCustomFieldTypes(PLAIN)

    expect(mockEnsureAll).not.toHaveBeenCalled()
  })

  it('loads the plugins, so a custom validator refuses a bad value', async () => {
    const { ensureCustomFieldTypes } = await import(
      '../utils/ensure-custom-field-types'
    )
    // What the marketplace's console API registration does when it loads.
    mockEnsureAll.mockImplementation(async () =>
      registerCustomFieldType(RATING_FIELD),
    )

    // Before the load nothing has registered `rating`, so nothing refuses 9.
    expect(validateDocument(RATED, { stars: 9 })).toEqual({})

    await ensureCustomFieldTypes(RATED)

    expect(mockEnsureAll).toHaveBeenCalledWith(['consoleApi'])
    expect(validateDocument(RATED, { stars: 9 })).toEqual({
      stars: expect.stringContaining('0 to 5'),
    })
    expect(validateDocument(RATED, { stars: 4 })).toEqual({})
  })
})
