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

import { holdsStampedSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { SHIPPING_SITE_PERMISSIONS, SHIPPING_SITE_PRESETS, type ShippingSitePermission } from './shipping-permissions'

/** The rung each route asked before it was a key: 'admin' is the site Admin, 'editor' the Admin and Editor. */
const RUNG: Record<ShippingSitePermission, 'admin' | 'editor'> = {
  'shipping.viewSettings': 'editor',
  'shipping.settings': 'admin',
  'shipping.labelCharges': 'admin',
  'shipping.carrierAccounts': 'admin',
  'shipping.ownAccounts': 'admin',
  'shipping.labels': 'editor',
  'shipping.buyLabels': 'editor',
  'shipping.voidLabels': 'editor',
}
const RANK: Record<string, number> = { viewer: 1, author: 1, editor: 2, admin: 3 }
const KEYS = Object.keys(RUNG) as ShippingSitePermission[]

describe('Shipping: every key equals the role gate it replaced (AGL-4047)', () => {
  it('declares exactly these keys, each following the site role', () => {
    expect(SHIPPING_SITE_PERMISSIONS.map((entry) => entry.key)).toEqual(KEYS)
    for (const entry of SHIPPING_SITE_PERMISSIONS) {
      expect(entry.presetFromSiteRole).toBe(true)
      expect(entry.hostRoleDefaults).toEqual(SHIPPING_SITE_PRESETS[entry.key as ShippingSitePermission])
      expect(entry.description).toMatch(/Follows the site role/)
    }
  })

  describe.each(KEYS)('%s', (key) => {
    const asks = (role: string | undefined, stamp?: Record<string, boolean>) =>
      holdsStampedSiteKey(
        { memberRoles: role ? { u1: role } : {}, ...(stamp ? { memberPermissions: { u1: stamp } } : {}) },
        'u1',
        key,
        SHIPPING_SITE_PRESETS[key],
      )

    it.each(['admin', 'editor', 'author', 'viewer'])('the preset for a site %s is the rung', (role) => {
      expect(asks(role)).toBe(RANK[role] >= RANK[RUNG[key]])
    })

    it('refuses someone not on the site', () => {
      expect(asks(undefined)).toBe(false)
    })

    it('a stamp wins both ways: a role or a member can grant or refuse it', () => {
      expect(asks('viewer', { [key]: true })).toBe(true)
      expect(asks('admin', { [key]: false })).toBe(false)
    })
  })
})
