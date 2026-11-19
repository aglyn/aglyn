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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMMERCE_CONSOLE_SECTIONS,
  COMMERCE_SETTINGS_GROUP,
  COMMERCE_SETTINGS_PAGE_ZONES,
  type CommerceSettingsSectionId,
} from './components/commerce-console-sections'
import { NATIVE_NAV_ROWS } from './native-nav'

/**
 * The console's Commerce Settings pages reach the apps the way the console reaches them: as
 * sections of Products, each opening a hub whose zone is the page's own.
 */
const screens = new Map<string, any>(
  (
    JSON.parse(
      readFileSync(join(__dirname, '../ios/Sources/AglynCommercePlugin/Resources/commerce.screens.json'), 'utf8'),
    ).screens as any[]
  ).map((screen) => [screen.id, screen]),
)

/** Point of sale waits for its registers and hardware screens. */
const NOT_YET: readonly CommerceSettingsSectionId[] = ['pos']

const products = NATIVE_NAV_ROWS.find((entry) => entry.row.id === 'products')!.row

describe('native commerce settings pages', () => {
  const settings = COMMERCE_CONSOLE_SECTIONS.filter(
    (section) => section.group === COMMERCE_SETTINGS_GROUP && !NOT_YET.includes(section.id as CommerceSettingsSectionId),
  )

  it('list each Settings page as a Products section, in the console order and words', () => {
    const native = (products.sections ?? []).filter((section) => settings.some((one) => one.id === section.id))
    expect(native.map((section) => [section.id, section.label])).toEqual(
      settings.map((section) => [section.id, section.label]),
    )
    for (const section of native) {
      expect(section.console).toEqual({ surface: 'hostPluginSection', id: `/products/${section.id}` })
    }
  })

  it("open a hub that ends with the page's own zone", () => {
    for (const section of products.sections ?? []) {
      const id = section.id as CommerceSettingsSectionId
      if (!(id in COMMERCE_SETTINGS_PAGE_ZONES)) continue
      const hub = screens.get(section.screen)
      expect(hub?.blocks.at(-1)).toMatchObject({ type: 'zone', name: COMMERCE_SETTINGS_PAGE_ZONES[id] })
      expect(hub.title).toBe(section.label)
    }
  })

  it('link only screens the plugin draws', () => {
    const linked = [...screens.values()]
      .filter((screen) => String(screen.id).startsWith('commerce.settings'))
      .flatMap((screen) => screen.blocks.filter((block: any) => block.type === 'links'))
      .flatMap((block: any) => block.items.map((item: any) => item.screen))
    const all = new Set<string>()
    const dir = join(__dirname, '../ios/Sources/AglynCommercePlugin/Resources')
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.screens.json'))) {
      const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      for (const screen of doc.screens) all.add(screen.id)
    }
    expect(linked.filter((id: string) => !all.has(id))).toEqual([])
  })
})
