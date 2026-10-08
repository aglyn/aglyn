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
  pluginProductWriter,
  registerPluginProductWriter,
  type PluginProductWriter,
} from './plugin-product-writer'
import { resetPluginServicesForTests } from './plugin-services'

/** The products' keeper, one owner (AGL-3641). */
describe('core.product-writer', () => {
  beforeEach(() => resetPluginServicesForTests())

  const writer = (): PluginProductWriter => ({
    upsertSourced: async () => ({ outcome: 'no_store' }),
  })

  it('answers undefined with nobody registered', () => {
    expect(pluginProductWriter()).toBeUndefined()
  })

  it('keeps the first owner and refuses a second plugin', () => {
    const first = writer()
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginProductWriter(first, { pluginId: 'commerce' })
    try {
      registerPluginProductWriter(writer(), { pluginId: 'other' })
    } catch {
      // A refusal may throw or log; either way the incumbent keeps serving.
    }
    expect(pluginProductWriter()).toBe(first)
    errors.mockRestore()
  })
})
