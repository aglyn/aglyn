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
 * A plugin's field type reaches every path that validates a record
 * (AGL-2773).
 *
 * Two ways it could fail to, both silent — an unregistered type validates as
 * "no error":
 *
 * - The type registers from the app's boot declarations, in the module graph
 *   `instrumentation.ts` is compiled into, and a route reads the registry
 *   from its own graph. A module-scoped map would be two maps (AGL-3412).
 * - The boot declarations failed in this process. A write whose model names
 *   a type nobody registered runs the app's boot step again first.
 */

import type * as CustomFields from './custom-fields'
import type * as Repair from './plugin-declarations-repair'

const RATING: CustomFields.CustomFieldType = {
  name: 'spec-rating',
  pluginId: 'spec',
  label: 'Rating',
  baseType: 'int32',
  validate: (value) => (Number(value) <= 5 ? null : 'must be 0 to 5'),
}

const RATED = {
  order: ['stars'],
  fields: { stars: { customType: 'spec-rating' } },
}

/** A fresh copy of the modules, as a separately compiled graph would hold. */
function freshGraph(): { fields: typeof CustomFields; repair: typeof Repair } {
  let fields!: typeof CustomFields
  let repair!: typeof Repair
  jest.isolateModules(() => {
    fields = jest.requireActual('./custom-fields')
    repair = jest.requireActual('./plugin-declarations-repair')
  })
  return { fields, repair }
}

describe('the custom field registry', () => {
  it('is one registry across module graphs', () => {
    const boot = freshGraph()
    const route = freshGraph()
    expect(route.fields).not.toBe(boot.fields)

    boot.fields.registerCustomFieldType(RATING)

    expect(route.fields.getCustomFieldType('spec-rating')).toBe(RATING)
    expect(route.fields.validateCustomFieldValue('spec-rating', 9)).toBe(
      'must be 0 to 5',
    )
  })
})

describe('ensureDeclaredCustomFieldTypes', () => {
  it('runs the app’s boot step when a named type is not registered', async () => {
    const boot = freshGraph()
    const route = freshGraph()
    const run = jest.fn(async () =>
      boot.fields.registerCustomFieldType({ ...RATING, name: 'late-rating' }),
    )
    boot.repair.registerPluginDeclarationsRepair(run)

    expect(route.fields.validateCustomFieldValue('late-rating', 9)).toBeNull()
    await route.fields.ensureDeclaredCustomFieldTypes({
      order: ['stars'],
      fields: { stars: { customType: 'late-rating' } },
    })

    expect(run).toHaveBeenCalledTimes(1)
    expect(route.fields.validateCustomFieldValue('late-rating', 9)).toBe(
      'must be 0 to 5',
    )
  })

  it('costs nothing when every named type is registered, or none is named', async () => {
    const { fields, repair } = freshGraph()
    const run = jest.fn(async (): Promise<void> => undefined)
    repair.registerPluginDeclarationsRepair(run)
    fields.registerCustomFieldType(RATING)

    await fields.ensureDeclaredCustomFieldTypes(RATED)
    await fields.ensureDeclaredCustomFieldTypes({
      order: ['title'],
      fields: { title: {} },
    })

    expect(run).not.toHaveBeenCalled()
  })

  it('never throws when the boot step fails', async () => {
    const { fields, repair } = freshGraph()
    repair.registerPluginDeclarationsRepair(async () => {
      throw new Error('declarations broke')
    })
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      fields.ensureDeclaredCustomFieldTypes({
        order: ['stars'],
        fields: { stars: { customType: 'never-registered' } },
      }),
    ).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  afterEach(() => {
    freshGraph().repair.resetPluginDeclarationsRepairForTests()
  })
})
