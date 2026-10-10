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
 * The staff Sites row menu says where each item goes (Zach, 2026-10-09:
 * "confusing menu items"), and an item a row cannot use says why on screen,
 * not only in a tooltip.
 */

import { staffSiteMenuItems } from '../components/staff-site-row-actions.component'

describe('the staff Sites row menu', () => {
  it('names each destination', () => {
    const items = staffSiteMenuItems({
      $id: 'h1',
      orgId: 'o1',
      homeScreenId: 'home',
      ownerUid: 'u1',
    })
    expect(items.map((item) => item.label)).toEqual([
      'Site details',
      'Preview home page',
      'Organization details',
      'Owner details',
    ])
    expect(items.every((item) => item.href && !item.disabled)).toBe(true)
    // Only the preview leaves the console's tab.
    expect(items.filter((item) => item.external).map((item) => item.key)).toEqual(['preview'])
    expect(items.some((item) => /^Open /.test(item.label))).toBe(false)
  })

  it('says on screen why an item is unavailable', () => {
    const items = staffSiteMenuItems({ $id: 'h1', orgId: null, homeScreenId: null, ownerUid: null })
    for (const item of items.slice(1)) {
      expect(item.disabled).toBe(true)
      expect(item.href).toBeUndefined()
      expect(item.description).toBeTruthy()
      expect(item.description).toBe(item.disabledReason)
    }
    expect(items[1].description).toBe('No home page published yet')
  })
})
