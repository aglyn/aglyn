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

import { isReleaseFlagKey } from '../app-utils/release-flags'
import {
  classifyEnabledPlugins,
  DEFAULT_ENABLED_PLUGINS,
  FIRST_PARTY_PLUGINS,
  filterPluginsByReleaseFlags,
  isFirstPartyPlugin,
  isPluginEnabled,
  pluginForReleaseFlag,
  resolveEnabledPlugins,
} from './enabled-plugins'

describe('resolveEnabledPlugins (AGL-416)', () => {
  it('defaults to every first-party plugin when the field is absent', () => {
    expect(resolveEnabledPlugins(undefined)).toEqual([
      ...DEFAULT_ENABLED_PLUGINS,
    ])
    expect(resolveEnabledPlugins({})).toEqual([...DEFAULT_ENABLED_PLUGINS])
  })

  it('respects an explicit list', () => {
    const enabled = resolveEnabledPlugins({ enabledPlugins: ['bookings'] })
    expect(enabled).toContain('bookings')
    expect(enabled).not.toContain('commerce')
  })

  it('unions always-on plugins back in', () => {
    const enabled = resolveEnabledPlugins({ enabledPlugins: [] })
    for (const plugin of FIRST_PARTY_PLUGINS.filter((p) => p.alwaysOn)) {
      expect(enabled).toContain(plugin.id)
    }
  })

  it('keeps unknown (marketplace realm) ids and dedupes', () => {
    const enabled = resolveEnabledPlugins({
      enabledPlugins: ['acme-widgets', 'acme-widgets', 'mui'],
    })
    expect(enabled.filter((id) => id === 'acme-widgets')).toHaveLength(1)
    expect(enabled.filter((id) => id === 'mui')).toHaveLength(1)
  })

  it('isPluginEnabled answers per id', () => {
    expect(isPluginEnabled({ enabledPlugins: ['data'] }, 'data')).toBe(true)
    expect(isPluginEnabled({ enabledPlugins: ['data'] }, 'email')).toBe(false)
    expect(isPluginEnabled(undefined, 'email')).toBe(true)
  })
})

describe('filterPluginsByReleaseFlags (AGL-422)', () => {
  it('every non-always-on first-party plugin carries a REAL release flag', () => {
    for (const plugin of FIRST_PARTY_PLUGINS) {
      if (plugin.alwaysOn) continue
      expect(plugin.releaseFlag).toBeDefined()
      expect(isReleaseFlagKey(String(plugin.releaseFlag))).toBe(true)
      expect(pluginForReleaseFlag(String(plugin.releaseFlag))?.id).toBe(
        plugin.id,
      )
    }
  })

  it('drops a flagged-off plugin and keeps the rest', () => {
    const filtered = filterPluginsByReleaseFlags(
      ['mui', 'bookings', 'commerce'],
      (flagKey) => flagKey !== 'release_bookings',
    )
    expect(filtered).toEqual(['mui', 'commerce'])
  })

  it('keeps unknown marketplace ids and always-on plugins regardless', () => {
    const filtered = filterPluginsByReleaseFlags(
      ['mui', 'acme-widgets', 'email'],
      () => false,
    )
    expect(filtered).toEqual(['mui', 'acme-widgets'])
  })

  it('staff bypass keeps everything', () => {
    const filtered = filterPluginsByReleaseFlags(
      ['bookings', 'email'],
      () => false,
      { staffBypass: true },
    )
    expect(filtered).toEqual(['bookings', 'email'])
  })
})

/**
 * `enabledPlugins` is a flat mix of first-party bundle ids and marketplace
 * listing ids (AGL-777). This classifier is the single place that tells them
 * apart, so an install sync can never toggle a platform bundle by accident.
 */
describe('classifyEnabledPlugins / isFirstPartyPlugin (AGL-777)', () => {
  it('recognizes every registered first-party id as a bundle', () => {
    for (const plugin of FIRST_PARTY_PLUGINS) {
      expect(isFirstPartyPlugin(plugin.id)).toBe(true)
    }
  })

  it('treats anything else (marketplace listing doc ids) as not first-party', () => {
    expect(isFirstPartyPlugin('acme-widgets')).toBe(false)
    // A realistic Firestore listing doc id.
    expect(isFirstPartyPlugin('8sKQ2m1nZpLdRt09aBcd')).toBe(false)
    expect(isFirstPartyPlugin('')).toBe(false)
  })

  it('splits a mixed list into bundles vs listings, order preserved', () => {
    const { bundles, listings } = classifyEnabledPlugins([
      'mui',
      'acme-widgets',
      'commerce',
      '8sKQ2m1nZpLdRt09aBcd',
    ])
    expect(bundles).toEqual(['mui', 'commerce'])
    expect(listings).toEqual(['acme-widgets', '8sKQ2m1nZpLdRt09aBcd'])
  })

  it('handles the empty list', () => {
    expect(classifyEnabledPlugins([])).toEqual({ bundles: [], listings: [] })
  })
})
