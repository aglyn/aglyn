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
  canonicalPluginId,
  classifyEnabledPlugins,
  DEFAULT_ENABLED_PLUGINS,
  FIRST_PARTY_PLUGINS,
  filterPluginsByReleaseFlags,
  isFirstPartyPlugin,
  isHostPluginEnabled,
  isLockedOnForSite,
  isLockedOnForWorkspace,
  isPluginEnabled,
  pluginForReleaseFlag,
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
  resolvePluginSiteState,
  subtractDisabledPlugins,
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

/**
 * AGL-2595 renamed `contacts` to `crm` and read the old id through an alias
 * while the backfill ran; AGL-2614 retired the alias once the backfill
 * reported zero documents carrying the old id. The seam stays for the next
 * rename, and today it aliases nothing: a stored `contacts` is a marketplace
 * listing id like any other unknown string, not the CRM.
 */
describe('the plugin-id seam aliases nothing today (AGL-2614)', () => {
  it('reads every id as itself', () => {
    expect(canonicalPluginId('contacts')).toBe('contacts')
    expect(canonicalPluginId('crm')).toBe('crm')
    expect(canonicalPluginId('acme-widgets')).toBe('acme-widgets')
  })

  it('an org that still listed the retired id does not have the CRM by it', () => {
    // The backfill rewrote every such list; a stored `contacts` after it
    // would be a document written by something other than the console, and
    // it must not quietly switch a plugin on under an id nothing writes.
    const enabled = resolveEnabledPlugins({ enabledPlugins: ['contacts'] })
    expect(enabled).not.toContain('crm')
    expect(isPluginEnabled({ enabledPlugins: ['contacts'] }, 'crm')).toBe(false)
  })

  it('a site that disabled the retired id has not disabled the CRM', () => {
    const enabled = resolveHostEnabledPlugins(
      { enabledPlugins: ['crm', 'bookings'] },
      { disabledPlugins: ['contacts'] },
    )
    expect(enabled).toContain('crm')
    expect(enabled).toContain('bookings')
  })

  it('the catalog never carries a retired id', () => {
    for (const plugin of FIRST_PARTY_PLUGINS) {
      expect(canonicalPluginId(plugin.id)).toBe(plugin.id)
    }
    expect(FIRST_PARTY_PLUGINS.map((plugin) => plugin.id)).not.toContain('contacts')
  })
})

describe('resolveHostEnabledPlugins (AGL-1014)', () => {
  it('an org-installed plugin the host disables is NOT in the set', () => {
    const enabled = resolveHostEnabledPlugins(
      { enabledPlugins: ['bookings', 'commerce'] },
      { disabledPlugins: ['commerce'] },
    )
    expect(enabled).toContain('bookings')
    expect(enabled).not.toContain('commerce')
  })

  it('defaults to the full org set: absent deny-list disables nothing', () => {
    const org = { enabledPlugins: ['bookings', 'acme-widgets'] }
    expect(resolveHostEnabledPlugins(org, undefined)).toEqual(
      resolveEnabledPlugins(org),
    )
    expect(resolveHostEnabledPlugins(org, {})).toEqual(
      resolveEnabledPlugins(org),
    )
  })

  it('is narrow-only: a host id outside the org set cannot widen it', () => {
    // The deny-list can only subtract — there is no per-host allow field,
    // so an org-disabled plugin stays off no matter what the host stores.
    const enabled = resolveHostEnabledPlugins(
      { enabledPlugins: ['bookings'] },
      { disabledPlugins: [] },
    )
    expect(enabled).not.toContain('commerce')
  })

  it('always-on plugins survive a per-site disable', () => {
    const enabled = resolveHostEnabledPlugins(
      { enabledPlugins: ['mui', 'data'] },
      { disabledPlugins: ['mui', 'data'] },
    )
    expect(enabled).toContain('mui')
    expect(enabled).not.toContain('data')
  })

  it('subtracts marketplace listing ids the same as bundle ids', () => {
    const enabled = resolveHostEnabledPlugins(
      { enabledPlugins: ['bookings', 'acme-widgets'] },
      { disabledPlugins: ['acme-widgets'] },
    )
    expect(enabled).toContain('bookings')
    expect(enabled).not.toContain('acme-widgets')
  })

  it('subtractDisabledPlugins keeps order and copies on no-op', () => {
    const ids = ['mui', 'bookings', 'data']
    const untouched = subtractDisabledPlugins(ids, [])
    expect(untouched).toEqual(ids)
    expect(untouched).not.toBe(ids)
    expect(subtractDisabledPlugins(ids, ['bookings'])).toEqual(['mui', 'data'])
  })
})

/**
 * On for every workspace, switchable for one site (AGL-3028).
 *
 * The workspace half must never stop — AI's add-on, credits and overage
 * billing carry no site — so the id is unioned into every org's set as the
 * base library is. The site half is an ordinary deny-list entry, which is what
 * makes "on by default" free: every host document written before the switch
 * existed has no such entry, so nothing needs migrating and nothing turns off.
 */
describe('a plugin on for every workspace is switchable per site (AGL-3028)', () => {
  const WORKSPACE_LOCKED = FIRST_PARTY_PLUGINS.filter(
    (plugin) => plugin.alwaysOnForWorkspace,
  ).map((plugin) => plugin.id)

  it('is exactly the plugins whose workspace half carries no site', () => {
    expect(WORKSPACE_LOCKED).toEqual(['ai'])
  })

  it('never also claims `alwaysOn`, which would make the site switch inert', () => {
    for (const plugin of FIRST_PARTY_PLUGINS.filter((p) => p.alwaysOnForWorkspace)) {
      expect(plugin.alwaysOn).toBeFalsy()
    }
  })

  it.each(WORKSPACE_LOCKED)(
    '%s survives a workspace list saved without it, including an empty one',
    (id) => {
      expect(resolveEnabledPlugins({ enabledPlugins: [] })).toContain(id)
      expect(resolveEnabledPlugins({ enabledPlugins: ['mui', 'commerce'] })).toContain(id)
      expect(isPluginEnabled({ enabledPlugins: ['commerce'] }, id)).toBe(true)
    },
  )

  it.each(WORKSPACE_LOCKED)(
    '%s is ON for a site whose document predates the switch',
    (id) => {
      // Every shape a stored host document can have today: none, no fields,
      // empty lists, and lists that name OTHER plugins.
      const org = { enabledPlugins: ['mui', 'commerce', 'bookings'] }
      for (const host of [
        undefined,
        null,
        {},
        { disabledPlugins: [] },
        { enabledPlugins: [] },
        { disabledPlugins: ['commerce'], enabledPlugins: ['accounts'] },
      ]) {
        expect(isHostPluginEnabled(org, host, id)).toBe(true)
        expect(resolvePluginSiteState(org, host, id)).toBe('runs-here')
      }
    },
  )

  it.each(WORKSPACE_LOCKED)('%s is OFF for a site that switched it off', (id) => {
    const org = { enabledPlugins: ['mui', 'commerce'] }
    const host = { disabledPlugins: [id] }
    expect(isHostPluginEnabled(org, host, id)).toBe(false)
    expect(resolveHostEnabledPlugins(org, host)).not.toContain(id)
    expect(resolvePluginSiteState(org, host, id)).toBe('off-for-site')
    // The workspace still runs it — only this site does not.
    expect(isPluginEnabled(org, id)).toBe(true)
  })

  it.each(WORKSPACE_LOCKED)(
    '%s switched off on one site stays on for its sibling sites',
    (id) => {
      const org = {}
      expect(isHostPluginEnabled(org, { disabledPlugins: [id] }, id)).toBe(false)
      expect(isHostPluginEnabled(org, { disabledPlugins: [] }, id)).toBe(true)
    },
  )

  it('the base library still survives a per-site disable', () => {
    expect(
      resolveHostEnabledPlugins({}, { disabledPlugins: ['mui', ...WORKSPACE_LOCKED] }),
    ).toContain('mui')
    expect(resolvePluginSiteState({}, { disabledPlugins: ['mui'] }, 'mui')).toBe(
      'always-on',
    )
  })

  it('locks the WORKSPACE switch for both kinds and the SITE switch for the base library alone', () => {
    expect(isLockedOnForWorkspace('mui')).toBe(true)
    expect(isLockedOnForSite('mui')).toBe(true)
    for (const id of WORKSPACE_LOCKED) {
      expect(isLockedOnForWorkspace(id)).toBe(true)
      expect(isLockedOnForSite(id)).toBe(false)
    }
    expect(isLockedOnForWorkspace('commerce')).toBe(false)
    expect(isLockedOnForSite('commerce')).toBe(false)
  })

  it.each(WORKSPACE_LOCKED)(
    '%s says what switching it off for a site stops and what it keeps',
    (id) => {
      const entry = FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === id)
      expect(entry?.siteOff?.stops).toMatch(/\S/)
      expect(entry?.siteOff?.keeps).toMatch(/\S/)
    },
  )
})

describe('filterPluginsByReleaseFlags (AGL-422)', () => {
  it('every non-always-on first-party plugin carries a REAL release flag', () => {
    for (const plugin of FIRST_PARTY_PLUGINS) {
      // A plugin on for every workspace carries no flag either: its doors
      // gate themselves, and a flag on the bundle would switch off the
      // workspace half with the site half.
      if (plugin.alwaysOn || plugin.alwaysOnForWorkspace) continue
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
