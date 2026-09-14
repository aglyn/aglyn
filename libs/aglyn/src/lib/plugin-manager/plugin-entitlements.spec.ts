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
  listPluginFeatures,
  listPluginLockdownFeatures,
  listPluginSeatAddons,
  pluginIdForLockdownFeature,
  pluginLockdownFeature,
  pluginSeatAddon,
  registerPluginEntitlements,
  resetPluginEntitlementsForTests,
} from './plugin-entitlements'
import { listPluginPermissions } from './plugin-permissions'

const BAND = {
  free: 0,
  starter: 4_000,
  pro: 9_000,
  business: 19_000,
  scale: 34_000,
  advanced: 49_000,
  agency: 149_000,
  enterprise: 298_000,
} as const

const AI = {
  pluginId: 'ai',
  seatAddons: [
    {
      key: 'aiAddon',
      label: 'AI add-on',
      maxUnits: 1,
      quota: { key: 'assistCreditsPerMonth', perUnitByPlan: BAND },
      features: ['aiGenerative', 'aiAssist'],
    },
  ],
  features: [{ key: 'aiGenerative', label: 'Generative building' }],
  lockdownFeatures: [
    {
      key: 'ai-generate',
      label: 'AI generation',
      staffBypass: true,
      notice: { title: 'AI generation is paused', body: 'Try again shortly.' },
      apiPaths: { prefixes: ['ai/generate'] },
    },
  ],
}

const BACKUPS = {
  pluginId: 'zeta-backups',
  seatAddons: [
    {
      key: 'backupVaults',
      label: 'Backup vaults',
      quota: {
        key: 'storageGb',
        perUnitByPlan: { ...BAND, free: 10, starter: 10 },
      },
    },
  ],
  lockdownFeatures: [
    {
      key: 'backups',
      label: 'Backups',
      staffBypass: false,
      notice: { title: 'Backups are paused', body: 'Restores still work.' },
      apiPaths: { exact: ['backups/snapshot'] },
    },
  ],
  permissions: [
    {
      key: 'manageBackups',
      label: 'Manage backups',
      defaults: { admin: true, editor: false, viewer: false },
    },
  ],
}

beforeEach(() => resetPluginEntitlementsForTests())

describe('registerPluginEntitlements', () => {
  it('a first-party plugin declares an add-on, a feature and a lockdown lever', () => {
    registerPluginEntitlements(AI)
    expect(pluginSeatAddon('aiAddon')?.quota?.perUnitByPlan.pro).toBe(9_000)
    expect(listPluginFeatures().map((feature) => feature.key)).toEqual(['aiGenerative'])
    expect(pluginLockdownFeature('ai-generate')?.staffBypass).toBe(true)
    expect(pluginIdForLockdownFeature('ai-generate')).toBe('ai')
    expect(pluginLockdownFeature('warp-drive')).toBeUndefined()
  })

  it('a second, unrelated plugin adopts the same seam, and its permissions land', () => {
    registerPluginEntitlements(AI)
    registerPluginEntitlements(BACKUPS)
    expect(listPluginSeatAddons().map((addon) => addon.key)).toEqual([
      'aiAddon',
      'backupVaults',
    ])
    expect(listPluginLockdownFeatures().map((feature) => feature.key)).toEqual([
      'ai-generate',
      'backups',
    ])
    expect(
      listPluginPermissions().find((permission) => permission.key === 'manageBackups')
        ?.pluginId,
    ).toBe('zeta-backups')
  })

  it('lists in catalog order however the registrations arrived', () => {
    // Two marketplace ids register first and a catalog id last; the catalog
    // id still leads, and the unknown ids sort by name rather than arrival.
    registerPluginEntitlements(BACKUPS)
    registerPluginEntitlements({
      pluginId: 'acme-vaults',
      lockdownFeatures: [
        {
          key: 'vaults',
          label: 'Vaults',
          staffBypass: false,
          notice: { title: 'v', body: 'v' },
        },
      ],
    })
    registerPluginEntitlements({
      pluginId: 'commerce',
      lockdownFeatures: [
        {
          key: 'pos',
          label: 'Point of sale',
          staffBypass: false,
          notice: { title: 'p', body: 'p' },
        },
      ],
    })
    expect(listPluginLockdownFeatures().map((feature) => feature.key)).toEqual([
      'pos',
      'vaults',
      'backups',
    ])
  })

  it('re-registration by the owner replaces; a stolen key is refused', () => {
    registerPluginEntitlements(AI)
    registerPluginEntitlements({ ...AI, features: [] })
    expect(listPluginFeatures()).toEqual([])
    expect(() =>
      registerPluginEntitlements({
        ...BACKUPS,
        seatAddons: [{ key: 'aiAddon', label: 'x' }],
      }),
    ).toThrow(/seat add-on "aiAddon" is already declared by "ai"; refused "zeta-backups"/)
    expect(() =>
      registerPluginEntitlements({
        pluginId: 'other',
        lockdownFeatures: [AI.lockdownFeatures[0]],
      }),
    ).toThrow(/lockdown feature "ai-generate" is already declared by "ai"/)
    expect(() => registerPluginEntitlements({ pluginId: '' })).toThrow(
      /need a pluginId/,
    )
  })

  it('reset forgets everything', () => {
    registerPluginEntitlements(AI)
    resetPluginEntitlementsForTests()
    expect(listPluginSeatAddons()).toEqual([])
    expect(listPluginLockdownFeatures()).toEqual([])
  })
})
