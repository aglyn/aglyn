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
import type { OrgEntitlements, OrgFeatureFlags } from '../foundation'
import {
  listPluginEntitlementKeys,
  listPluginEntitlementKeysOfKind,
  pluginEntitlementKey,
  pluginIdForEntitlementKey,
  registerPluginEntitlementKeys,
  resetPluginEntitlementKeysForTests,
  unregisterPluginEntitlementKeys,
} from './plugin-entitlement-keys'

/**
 * The seam with no AI, CRM, commerce or marketplace in it: a `cellar` plugin
 * sells a bottle allowance and gates tasting notes, and an unrelated `almanac`
 * plugin sells its own. Both the TYPE and the registration come from the
 * plugin; the core shapes are read here unchanged and carry the plugins' keys.
 */

declare module './plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    bottlesPerHost?: number
  }
  interface PluginEntitlementFeatures {
    cellarTastings?: boolean
  }
}

/** The cellar's own register fn, as its manifest entry would call it. */
function registerCellarKeys(): void {
  registerPluginEntitlementKeys({
    pluginId: 'cellar',
    keys: [
      {
        key: 'bottlesPerHost',
        kind: 'quota',
        label: 'Bottles per site',
        description:
          'Counts the CATALOG, never a pour: how many bottles a site may ' +
          'list, not how many tastings it may pour from them.',
      },
      { key: 'cellarTastings', kind: 'feature', label: 'Tasting notes' },
    ],
  })
}

beforeEach(() => {
  resetPluginEntitlementKeysForTests()
  setRegisteringPluginId(undefined)
})

describe('plugin entitlement keys', () => {
  it('composes a plugin’s keys into the core shapes without the core naming them', () => {
    // `OrgEntitlements` and `OrgFeatureFlags` are the shapes every reader
    // already uses; neither file mentions a bottle.
    const entitlements: OrgEntitlements = {
      hostLimit: 3,
      bottlesPerHost: 250,
    }
    const flags: OrgFeatureFlags = { versioning: true, cellarTastings: true }
    expect(entitlements.bottlesPerHost).toBe(250)
    expect(flags.cellarTastings).toBe(true)
  })

  it('records who declared each key, and what kind it is', () => {
    setRegisteringPluginId('cellar')
    registerCellarKeys()
    setRegisteringPluginId(undefined)

    expect(pluginIdForEntitlementKey('bottlesPerHost')).toBe('cellar')
    expect(pluginEntitlementKey('cellarTastings')).toEqual({
      key: 'cellarTastings',
      kind: 'feature',
      label: 'Tasting notes',
      pluginId: 'cellar',
    })
    expect(
      listPluginEntitlementKeysOfKind('quota').map((one) => one.key),
    ).toEqual(['bottlesPerHost'])
    expect(
      listPluginEntitlementKeysOfKind('feature').map((one) => one.key),
    ).toEqual(['cellarTastings'])
  })

  it('declares no price, so nothing here can disagree with the pricing table', () => {
    registerCellarKeys()
    const declaration = pluginEntitlementKey('bottlesPerHost')
    expect(Object.keys(declaration ?? {}).sort()).toEqual([
      'description',
      'key',
      'kind',
      'label',
      'pluginId',
    ])
  })

  it('answers nothing for a key nobody declares, and after its owner unloads', () => {
    expect(pluginEntitlementKey('bottlesPerHost')).toBeNull()
    expect(pluginIdForEntitlementKey('bottlesPerHost')).toBeUndefined()

    registerCellarKeys()
    expect(listPluginEntitlementKeys()).toHaveLength(2)

    unregisterPluginEntitlementKeys('cellar')
    expect(listPluginEntitlementKeys()).toEqual([])
    expect(pluginEntitlementKey('bottlesPerHost')).toBeNull()
  })

  it('keeps one owner per key: a second plugin is refused naming both, and registers nothing from that call', () => {
    registerCellarKeys()
    expect(() =>
      registerPluginEntitlementKeys({
        pluginId: 'almanac',
        keys: [
          { key: 'seasonsPerOrg', kind: 'quota', label: 'Seasons' },
          { key: 'bottlesPerHost', kind: 'quota', label: 'Bottles' },
        ],
      }),
    ).toThrow(
      'entitlement key "bottlesPerHost" is already declared by "cellar"; refused "almanac"',
    )
    expect(pluginEntitlementKey('seasonsPerOrg')).toBeNull()
    expect(pluginEntitlementKey('bottlesPerHost')?.label).toBe('Bottles per site')

    // Its own keys are its own, and both plugins' declarations stand.
    registerPluginEntitlementKeys({
      pluginId: 'almanac',
      keys: [{ key: 'seasonsPerOrg', kind: 'quota', label: 'Seasons' }],
    })
    expect(
      listPluginEntitlementKeys().map((one) => [one.key, one.pluginId]),
    ).toEqual([
      ['bottlesPerHost', 'cellar'],
      ['cellarTastings', 'cellar'],
      ['seasonsPerOrg', 'almanac'],
    ])

    // The owner re-registering replaces its own declarations.
    registerPluginEntitlementKeys({
      pluginId: 'cellar',
      keys: [{ key: 'bottlesPerHost', kind: 'quota', label: 'Bottles per site' }],
    })
    expect(listPluginEntitlementKeys()).toHaveLength(2)
    expect(pluginEntitlementKey('cellarTastings')).toBeNull()
  })

  it('needs a key, a label and an owner', () => {
    expect(() =>
      registerPluginEntitlementKeys({
        pluginId: 'cellar',
        keys: [{ key: ' ', kind: 'quota', label: 'Bottles' }],
      }),
    ).toThrow('a plugin entitlement key needs a key')
    expect(() =>
      registerPluginEntitlementKeys({
        pluginId: 'cellar',
        keys: [{ key: 'bottlesPerHost', kind: 'quota', label: '  ' }],
      }),
    ).toThrow('plugin entitlement key "bottlesPerHost" needs a label')
    expect(() =>
      registerPluginEntitlementKeys({
        pluginId: '',
        keys: [{ key: 'bottlesPerHost', kind: 'quota', label: 'Bottles' }],
      }),
    ).toThrow(/no owner/)
  })
})
