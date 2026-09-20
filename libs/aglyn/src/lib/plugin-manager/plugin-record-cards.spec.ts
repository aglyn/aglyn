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
  listPluginRecordCardKinds,
  pluginRecordCardReader,
  readPluginRecordCard,
  registerPluginRecordCardReader,
  type PluginRecordCardReader,
} from './plugin-record-cards'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * The seam with no commerce or email in it: a `cellar` plugin publishes what a
 * bottle looks like, and an unrelated `almanac` plugin draws one knowing only
 * the record kind. The almanac never learns where a bottle is stored or how
 * its price is worked out.
 */

const asked: Array<{ hostId: string; id: string }> = []
const CELLAR_BOTTLES: PluginRecordCardReader = {
  async read(request) {
    asked.push(request)
    if (request.id === 'gone') return null
    return {
      title: `Bottle ${request.id}`,
      caption: '$42',
      imageUrl: `https://cdn.example/${request.id}.jpg`,
      path: `/cellar/${request.id}`,
    }
  },
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
  asked.length = 0
})

describe('a record kind’s card, published by its owner', () => {
  it('answers a caller that knows only the kind', async () => {
    registerPluginRecordCardReader('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    expect(await readPluginRecordCard('bottle', { hostId: 'site1', id: 'b7' })).toEqual({
      title: 'Bottle b7',
      caption: '$42',
      imageUrl: 'https://cdn.example/b7.jpg',
      path: '/cellar/b7',
    })
    expect(asked).toEqual([{ hostId: 'site1', id: 'b7' }])
  })

  it('answers null for a kind no plugin publishes, without reading anything', async () => {
    registerPluginRecordCardReader('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    expect(await readPluginRecordCard('cask', { hostId: 'site1', id: 'c1' })).toBeNull()
    expect(asked).toEqual([])
  })

  it('answers null for a record that is not there', async () => {
    registerPluginRecordCardReader('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    expect(await readPluginRecordCard('bottle', { hostId: 'site1', id: 'gone' })).toBeNull()
    // THE CONTROL: the null above came from the reader, not from a registry
    // that was empty.
    expect(asked).toEqual([{ hostId: 'site1', id: 'gone' }])
  })

  it('takes its owner from the loader’s marker inside a register fn', () => {
    setRegisteringPluginId('cellar')
    registerPluginRecordCardReader('bottle', CELLAR_BOTTLES)
    setRegisteringPluginId(undefined)
    expect(pluginRecordCardReader('bottle')?.pluginId).toBe('cellar')
    expect(listPluginRecordCardKinds()).toEqual([{ kind: 'bottle', pluginId: 'cellar' }])
  })

  it('refuses a second plugin’s card for a kind, naming both, and keeps the incumbent', () => {
    registerPluginRecordCardReader('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    expect(() =>
      registerPluginRecordCardReader('bottle', { read: async () => null }, { pluginId: 'almanac' }),
    ).toThrow(/"cellar".*"almanac"/)
    expect(pluginRecordCardReader('bottle')?.pluginId).toBe('cellar')
  })

  it('lets the owner register again, replacing its own', async () => {
    registerPluginRecordCardReader('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    registerPluginRecordCardReader(
      'bottle',
      { read: async () => ({ title: 'Relabelled' }) },
      { pluginId: 'cellar' },
    )
    expect(listPluginRecordCardKinds()).toHaveLength(1)
    expect(await readPluginRecordCard('bottle', { hostId: 'site1', id: 'b7' })).toEqual({
      title: 'Relabelled',
    })
  })

  it('refuses a registration with no kind, and one with no owner', () => {
    expect(() =>
      registerPluginRecordCardReader(' ', CELLAR_BOTTLES, { pluginId: 'cellar' }),
    ).toThrow(/needs a record kind/)
    expect(() => registerPluginRecordCardReader('bottle', CELLAR_BOTTLES)).toThrow(/no owner/)
  })
})
