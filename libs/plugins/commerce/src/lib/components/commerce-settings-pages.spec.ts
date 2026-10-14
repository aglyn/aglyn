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
 * THE STORE'S SETTINGS, A PAGE EACH (AGL-3713).
 *
 * Products ▸ Settings was one section and one long column. It is eight
 * sections under a "Settings" group in the rail, each with its own zone, and
 * the old `/products/settings` opens Payments. Held here: the pages, their
 * order and group, which of them are zone-only, that every page's zone is
 * declared, that the retired id lands on a real page, and that every plugin
 * that contributes a store-settings card names a zone some page draws.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listPluginZones } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  COMMERCE_CONSOLE_SECTIONS,
  COMMERCE_RETIRED_SECTIONS,
  COMMERCE_SETTINGS_GROUP,
  COMMERCE_SETTINGS_PAGE_ZONES,
} from './commerce-console-sections'
import { registerCommerceStoreZones } from './console/store-zones'
import { BUNDLE_ID } from '../constants/bundle-common'

const SETTINGS = COMMERCE_CONSOLE_SECTIONS.filter(
  (section) => section.group === COMMERCE_SETTINGS_GROUP,
)

describe('the store settings pages', () => {
  it('are the eight pages, in rail order, after every working section', () => {
    expect(SETTINGS.map((section) => [section.id, section.label])).toEqual([
      ['payments', 'Payments'],
      ['checkout', 'Checkout'],
      ['taxes', 'Taxes'],
      ['shipping', 'Shipping & delivery'],
      ['notifications', 'Notifications'],
      ['pos', 'Point of sale'],
      ['channels', 'Sales channels'],
      ['integrations', 'Integrations'],
    ])
    // One run at the foot of the rail, so the group draws one divider.
    const firstSetting = COMMERCE_CONSOLE_SECTIONS.findIndex(
      (section) => section.group === COMMERCE_SETTINGS_GROUP,
    )
    expect(COMMERCE_CONSOLE_SECTIONS.slice(firstSetting)).toEqual(SETTINGS)
    expect(COMMERCE_CONSOLE_SECTIONS[0]?.id).toBe('catalog')
  })

  it('has no `settings` section any more', () => {
    expect(COMMERCE_CONSOLE_SECTIONS.map((section) => section.id)).not.toContain('settings')
  })

  it('maps every page to a zone of its own', () => {
    const ids = SETTINGS.map((section) => section.id).sort()
    expect(Object.keys(COMMERCE_SETTINGS_PAGE_ZONES).sort()).toEqual(ids)
    const zones = Object.values(COMMERCE_SETTINGS_PAGE_ZONES)
    expect(new Set(zones).size).toBe(zones.length)
    // A widget that names no page still lands somewhere.
    expect(COMMERCE_SETTINGS_PAGE_ZONES.integrations).toBe('commerceSettings')
  })

  it('leaves out only the pages that are nothing but other plugins’ cards', () => {
    const zoneOnly = SETTINGS.filter((section) => section.onlyWithZones?.length)
    expect(zoneOnly.map((section) => [section.id, section.onlyWithZones])).toEqual([
      ['channels', ['commerceSettingsChannels']],
      ['integrations', ['commerceSettings']],
    ])
  })

  it('sends the old Settings address to Payments, a page that exists', () => {
    expect(COMMERCE_RETIRED_SECTIONS).toEqual({ settings: 'payments' })
    for (const successor of Object.values(COMMERCE_RETIRED_SECTIONS))
      expect(COMMERCE_CONSOLE_SECTIONS.map((section) => section.id)).toContain(successor)
  })

  describe('zones', () => {
    beforeAll(registerCommerceStoreZones)
    afterAll(() => unregisterPluginServices(BUNDLE_ID))

    it('declares every page’s zone, owned by commerce', () => {
      const declared = new Map(
        listPluginZones().map((zone) => [zone.zone.id, zone.pluginId]),
      )
      for (const zone of Object.values(COMMERCE_SETTINGS_PAGE_ZONES))
        expect([zone, declared.get(zone)]).toEqual([zone, BUNDLE_ID])
    })
  })

  /*
   * A contributor restates a zone id rather than importing this package, so
   * a typo would be a card that silently draws nowhere. Read from the
   * catalog every plugin's console contributions are declared in.
   */
  it('every store-settings slot a plugin declares is one a page draws', () => {
    const config = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../plugins.config.json'), 'utf8'),
    ) as { plugins: Array<{ id: string; contributes?: { console?: { slots?: string[] } } }> }
    const pageZones = new Set(Object.values(COMMERCE_SETTINGS_PAGE_ZONES))
    const named = config.plugins.flatMap((plugin) =>
      (plugin.contributes?.console?.slots ?? [])
        .filter((slot) => slot.startsWith('commerceSettings'))
        .map((slot) => [plugin.id, slot] as const),
    )
    expect(named.length).toBeGreaterThan(0)
    for (const [plugin, slot] of named)
      expect([plugin, slot, pageZones.has(slot)]).toEqual([plugin, slot, true])
  })
})
