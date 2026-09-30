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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  pluginRecordIndex,
  registerPluginRecordIndex,
  type PluginRecordIndex,
} from './plugin-record-index'
import { resetPluginServicesForTests } from './plugin-services'

const index = (name: string): PluginRecordIndex => ({
  list: async () => ({ records: [{ id: 'r1', name, facts: {} }], truncated: false }),
  get: async ({ id }) => ({ id, name, facts: {} }),
})

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('record indexes (AGL-3080)', () => {
  it('answers the index a plugin published for a kind, with its owner', async () => {
    registerPluginRecordIndex('product', index('Lamp'), { pluginId: 'shop' })
    const found = pluginRecordIndex('product')
    expect(found?.pluginId).toBe('shop')
    await expect(found?.index.get({ hostId: 'h1', id: 'p1' })).resolves.toEqual({
      id: 'p1',
      name: 'Lamp',
      facts: {},
    })
  })

  it('answers nothing for a kind no plugin keeps here', () => {
    expect(pluginRecordIndex('product')).toBeNull()
  })

  it('refuses a second plugin on a kind, and the first keeps serving', async () => {
    registerPluginRecordIndex('product', index('Lamp'), { pluginId: 'shop' })
    expect(() =>
      registerPluginRecordIndex('product', index('Other'), { pluginId: 'other-shop' }),
    ).toThrow(/already indexed by "shop"; refused "other-shop"/)
    const found = pluginRecordIndex('product')
    expect(found?.pluginId).toBe('shop')
    await expect(found?.index.list({ hostId: 'h1', limit: 5 })).resolves.toMatchObject({
      records: [{ name: 'Lamp' }],
    })
  })

  it('lets the owner register again, replacing its own', async () => {
    registerPluginRecordIndex('product', index('Lamp'), { pluginId: 'shop' })
    registerPluginRecordIndex('product', index('Shade'), { pluginId: 'shop' })
    await expect(
      pluginRecordIndex('product')?.index.get({ hostId: 'h1', id: 'p1' }),
    ).resolves.toMatchObject({ name: 'Shade' })
  })

  it('refuses an index with no kind or no owner', () => {
    expect(() => registerPluginRecordIndex(' ', index('x'), { pluginId: 'shop' })).toThrow(/kind/)
    expect(() => registerPluginRecordIndex('product', index('x'))).toThrow(/no owner/)
  })
})
