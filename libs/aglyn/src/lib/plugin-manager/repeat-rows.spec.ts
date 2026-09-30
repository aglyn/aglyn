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
 * A published page's repeats never read an empty registry as "no rows"
 * (AGL-3080).
 *
 * The composition asks `readRepeatRows` and renders whatever comes back, so
 * the only thing standing between a broken boot and a customer's list
 * collapsing to one row is this module refusing to answer. These cases hold
 * the three answers apart: nothing declared, declared and registered, and
 * declared but missing — which must THROW, after the repair has had its turn.
 *
 * `PLUGIN_REPEAT_SOURCE_DECLARED` is read from the real compiled config except
 * where a case replaces it, so the first case also pins what ships: the data
 * plugin declares datasets as the source.
 */

let mockDeclared: unknown = undefined

jest.mock('./first-party-plugins.generated', () => {
  const actual = jest.requireActual('./first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_REPEAT_SOURCE_DECLARED() {
      return mockDeclared === undefined
        ? actual.PLUGIN_REPEAT_SOURCE_DECLARED
        : mockDeclared
    },
  }
})

import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'
import {
  declaredRepeatSource,
  readRepeatRows,
  registerRepeatRowReader,
  RepeatRowsUnavailableError,
  repeatRowReader,
  resetRepeatRowReadersForTests,
} from './repeat-rows'

const TEAM = { records: [{ name: 'Ada' }] }

beforeEach(() => {
  mockDeclared = undefined
  resetRepeatRowReadersForTests()
  resetPluginDeclarationsRepairForTests()
})

describe('the declared repeat source', () => {
  it('is the data plugin’s datasets, compiled from the config', () => {
    expect(declaredRepeatSource()).toEqual({ pluginId: 'data', id: 'dataset' })
  })
})

describe('readRepeatRows', () => {
  it('asks nobody for a page that repeats over nothing', async () => {
    const reader = jest.fn()
    registerRepeatRowReader('dataset', reader, { pluginId: 'data' })
    await expect(readRepeatRows({ hostId: 'h1', keys: [' ', ''] })).resolves.toEqual({})
    expect(reader).not.toHaveBeenCalled()
  })

  it('hands the registered reader the keys trimmed, sorted and once each', async () => {
    const reader = jest.fn(async () => ({ Team: TEAM }))
    registerRepeatRowReader('dataset', reader, { pluginId: 'data' })
    await expect(
      readRepeatRows({ hostId: 'h1', keys: ['Team ', 'Menu', 'Team'] }),
    ).resolves.toEqual({ Team: TEAM })
    expect(reader).toHaveBeenCalledWith({ hostId: 'h1', keys: ['Menu', 'Team'] })
  })

  it('answers no rows when no plugin declares a source — a repeat renders once', async () => {
    mockDeclared = null
    await expect(readRepeatRows({ hostId: 'h1', keys: ['Team'] })).resolves.toEqual({})
  })

  it('THROWS when the declared source has no reader — never "no rows"', async () => {
    await expect(readRepeatRows({ hostId: 'h1', keys: ['Team'] })).rejects.toBeInstanceOf(
      RepeatRowsUnavailableError,
    )
  })

  it('runs the app’s declarations step once more before refusing', async () => {
    const repair = jest.fn(async () => {
      registerRepeatRowReader('dataset', async () => ({ Team: TEAM }), {
        pluginId: 'data',
      })
    })
    registerPluginDeclarationsRepair(repair)
    await expect(readRepeatRows({ hostId: 'h1', keys: ['Team'] })).resolves.toEqual({
      Team: TEAM,
    })
    expect(repair).toHaveBeenCalledTimes(1)
  })

  it('still refuses when the repair itself fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginDeclarationsRepair(async () => {
      throw new Error('boot is broken')
    })
    await expect(readRepeatRows({ hostId: 'h1', keys: ['Team'] })).rejects.toBeInstanceOf(
      RepeatRowsUnavailableError,
    )
    spy.mockRestore()
  })
})

describe('registerRepeatRowReader', () => {
  it('refuses a reader for a declared source from any other plugin', () => {
    expect(() =>
      registerRepeatRowReader('dataset', async () => ({}), { pluginId: 'commerce' }),
    ).toThrow(/declared by "data"/)
    expect(repeatRowReader('dataset')).toBeNull()
  })

  it('refuses a reader with no owner', () => {
    expect(() => registerRepeatRowReader('dataset', async () => ({}))).toThrow(/no owner/)
  })

  it('lets the owner replace its own reader, and unregister only its own', async () => {
    const first = registerRepeatRowReader('dataset', async () => ({}), { pluginId: 'data' })
    registerRepeatRowReader('dataset', async () => ({ Team: TEAM }), { pluginId: 'data' })
    first()
    await expect(readRepeatRows({ hostId: 'h1', keys: ['Team'] })).resolves.toEqual({
      Team: TEAM,
    })
  })

  it('refuses a second plugin on an undeclared source', () => {
    registerRepeatRowReader('products', async () => ({}), { pluginId: 'commerce' })
    expect(() =>
      registerRepeatRowReader('products', async () => ({}), { pluginId: 'bookings' }),
    ).toThrow(/already has a reader from "commerce"/)
  })
})
