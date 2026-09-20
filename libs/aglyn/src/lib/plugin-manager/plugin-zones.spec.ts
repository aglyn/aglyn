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
  definePluginZone,
  listPluginZones,
  pluginIdForZone,
  pluginZone,
  registerPluginZone,
  type PluginZoneProps,
} from './plugin-zones'
import {
  resetPluginServicesForTests,
  unregisterPluginServices,
} from './plugin-services'

/**
 * The seam with no commerce and no CRM in it: a `cellar` plugin hosts a zone
 * on its own bottle page and says what the zone hands a widget, and an
 * unrelated `almanac` plugin writes a widget for it knowing only the token.
 * Neither plugin appears in this file's imports, and neither prop shape is
 * spelled anywhere in the core.
 */

/** The cellar plugin's own zone, declared where the plugin lives. */
interface BottleDetailZoneProps {
  hostId: string
  bottle: { id: string; name: string; vintage: number }
  /** Stages a tasting note on the page as an unsaved edit; Save is the write. */
  proposeNote: (note: string, key: string) => void
}

const BOTTLE_DETAIL = definePluginZone<BottleDetailZoneProps>('bottleDetail')
const SHELF_LIST = definePluginZone<{ hostId: string }>('shelfList')

function declareCellarZones(): void {
  registerPluginZone({
    zone: BOTTLE_DETAIL,
    label: 'Bottle detail',
    surface: 'console',
    description: 'A widget here proposes a tasting note; the page saves it.',
  })
  registerPluginZone({ zone: SHELF_LIST, label: 'Shelf list', surface: 'console' })
}

/**
 * The almanac's widget. It takes its props off the cellar's token, so the
 * shape is checked at compile time without the almanac importing the cellar's
 * model — which is the whole point of carrying the type on the token.
 */
function almanacWidget(props: PluginZoneProps<typeof BOTTLE_DETAIL>): string {
  return `${props.bottle.name} ${props.bottle.vintage}`
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('plugin zones', () => {
  it('lets a plugin declare its own zones and hands a widget author their props', () => {
    setRegisteringPluginId('cellar')
    declareCellarZones()
    setRegisteringPluginId(undefined)

    expect(pluginZone('bottleDetail')).toEqual({
      zone: BOTTLE_DETAIL,
      label: 'Bottle detail',
      surface: 'console',
      description: 'A widget here proposes a tasting note; the page saves it.',
      pluginId: 'cellar',
    })
    expect(pluginIdForZone('shelfList')).toBe('cellar')
    expect(listPluginZones().map((one) => one.zone.id)).toEqual([
      'bottleDetail',
      'shelfList',
    ])
    expect(
      almanacWidget({
        hostId: 'host-1',
        bottle: { id: 'b-1', name: 'Rye barrel', vintage: 2019 },
        proposeNote: () => undefined,
      }),
    ).toBe('Rye barrel 2019')
  })

  it('carries the props at the type level only, so a token ships nothing', () => {
    // The whole token, field for field: `__props` is never written, so a
    // published page that reaches a zone id carries no prop shape with it.
    expect(Object.keys(BOTTLE_DETAIL)).toEqual(['id'])
    expect(JSON.stringify(BOTTLE_DETAIL)).toBe('{"id":"bottleDetail"}')
  })

  it('answers null for a zone nobody declares, and after its owner unloads', () => {
    expect(pluginZone('bottleDetail')).toBeNull()
    expect(pluginIdForZone('bottleDetail')).toBeUndefined()

    registerPluginZone(
      { zone: BOTTLE_DETAIL, label: 'Bottle detail', surface: 'console' },
      { pluginId: 'cellar' },
    )
    expect(pluginZone('bottleDetail')?.pluginId).toBe('cellar')

    unregisterPluginServices('cellar')
    expect(pluginZone('bottleDetail')).toBeNull()
    expect(listPluginZones()).toEqual([])
  })

  it('keeps one owner per zone: a second plugin is refused naming both, and the owner re-declares its own', () => {
    registerPluginZone(
      { zone: BOTTLE_DETAIL, label: 'Bottle detail', surface: 'console' },
      { pluginId: 'cellar' },
    )
    expect(() =>
      registerPluginZone(
        { zone: BOTTLE_DETAIL, label: 'Almanac detail', surface: 'console' },
        { pluginId: 'almanac' },
      ),
    ).toThrow('zone "bottleDetail" is already declared by "cellar"; refused "almanac"')
    expect(pluginZone('bottleDetail')?.label).toBe('Bottle detail')

    // The owner re-declaring replaces its own, rather than adding a second.
    registerPluginZone(
      { zone: BOTTLE_DETAIL, label: 'Bottle', surface: 'besigner' },
      { pluginId: 'cellar' },
    )
    expect(pluginZone('bottleDetail')).toEqual({
      zone: BOTTLE_DETAIL,
      label: 'Bottle',
      surface: 'besigner',
      pluginId: 'cellar',
    })

    // A zone of the almanac's own is its own key, and the two coexist.
    const seasons = definePluginZone<{ orgId: string }>('seasonPanel')
    registerPluginZone(
      { zone: seasons, label: 'Seasons', surface: 'console' },
      { pluginId: 'almanac' },
    )
    expect(listPluginZones().map((one) => [one.zone.id, one.pluginId])).toEqual([
      ['bottleDetail', 'cellar'],
      ['seasonPanel', 'almanac'],
    ])
  })

  it('needs an id, a label and an owner', () => {
    expect(() => definePluginZone('  ')).toThrow('a plugin zone needs an id')
    expect(() =>
      registerPluginZone(
        { zone: { id: '' }, label: 'Nameless', surface: 'console' },
        { pluginId: 'cellar' },
      ),
    ).toThrow('a plugin zone needs an id')
    expect(() =>
      registerPluginZone(
        { zone: SHELF_LIST, label: '   ', surface: 'console' },
        { pluginId: 'cellar' },
      ),
    ).toThrow('plugin zone "shelfList" needs a label')
    expect(() =>
      registerPluginZone({ zone: SHELF_LIST, label: 'Shelf', surface: 'console' }),
    ).toThrow(/no owner/)
  })
})
