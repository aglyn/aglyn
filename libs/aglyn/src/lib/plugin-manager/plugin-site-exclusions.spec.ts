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
 * Where a plugin runs across a workspace's sites (AGL-4047): read from each
 * site's deny-list, written back into it, with no storage of its own.
 */

import { isHostPluginEnabled, resolveHostEnabledPlugins } from './enabled-plugins'
import {
  planPluginRunsOn,
  pluginRunsOnOf,
  pluginRunsOnOptInNote,
  siteLeavesOutPlugin,
  type PluginSiteEntry,
} from './plugin-site-exclusions'

const org = { enabledPlugins: ['crm', 'commerce', 'accounts', 'bookings'] }
const sites = (): PluginSiteEntry[] => [
  { id: 'a' },
  { id: 'b', disabledPlugins: ['bookings'] },
  { id: 'c', disabledPlugins: [] },
]

describe('pluginRunsOnOf', () => {
  it('reads All sites when no site leaves the plugin out', () => {
    expect(pluginRunsOnOf('crm', sites())).toEqual({ mode: 'all' })
  })

  it('reads the sites whose own deny-list names it as the ones left out', () => {
    expect(pluginRunsOnOf('bookings', sites())).toEqual({ mode: 'allExcept', exceptHostIds: ['b'] })
  })

  it('reads every site left out as it is, rather than as All sites', () => {
    const all = sites().map((site) => ({ ...site, disabledPlugins: ['crm'] }))
    expect(pluginRunsOnOf('crm', all)).toEqual({ mode: 'allExcept', exceptHostIds: ['a', 'b', 'c'] })
  })

  it('treats a missing or damaged deny-list as leaving nothing out', () => {
    expect(siteLeavesOutPlugin({ disabledPlugins: null }, 'crm')).toBe(false)
    expect(siteLeavesOutPlugin({ disabledPlugins: 'crm' as never }, 'crm')).toBe(false)
    expect(siteLeavesOutPlugin(undefined, 'crm')).toBe(false)
  })
})

describe('planPluginRunsOn', () => {
  it('writes the plugin into the deny-list of each site left out, and nothing else', () => {
    const plan = planPluginRunsOn({
      pluginId: 'crm',
      choice: { mode: 'allExcept', exceptHostIds: ['b'] },
      org,
      sites: sites(),
    })
    expect(plan.problem).toBeNull()
    expect(plan.writes).toEqual([{ hostId: 'b', disabledPlugins: ['bookings', 'crm'], leftOut: true }])
  })

  it('takes it back out of a site that is no longer left out, keeping its other entries', () => {
    const plan = planPluginRunsOn({
      pluginId: 'bookings',
      choice: { mode: 'allExcept', exceptHostIds: ['c'] },
      org,
      sites: sites(),
    })
    expect(plan.writes).toEqual([
      { hostId: 'b', disabledPlugins: [], leftOut: false },
      { hostId: 'c', disabledPlugins: ['bookings'], leftOut: true },
    ])
  })

  it('All sites clears every site’s entry for it', () => {
    const plan = planPluginRunsOn({ pluginId: 'bookings', choice: { mode: 'all' }, org, sites: sites() })
    expect(plan.writes).toEqual([{ hostId: 'b', disabledPlugins: [], leftOut: false }])
  })

  it('writes nothing when the choice is what the sites already say', () => {
    const plan = planPluginRunsOn({
      pluginId: 'bookings',
      choice: { mode: 'allExcept', exceptHostIds: ['b'] },
      org,
      sites: sites(),
    })
    expect(plan).toEqual({ writes: [], problem: null, stranded: [] })
  })

  it('a new site has no entry, so the result runs the plugin there', () => {
    const plan = planPluginRunsOn({
      pluginId: 'crm',
      choice: { mode: 'allExcept', exceptHostIds: ['b'] },
      org,
      sites: sites(),
    })
    const stored = new Map((plan.writes ?? []).map((write) => [write.hostId, write.disabledPlugins]))
    expect(isHostPluginEnabled(org, { disabledPlugins: stored.get('b') }, 'crm')).toBe(false)
    expect(isHostPluginEnabled(org, { disabledPlugins: stored.get('a') }, 'crm')).toBe(true)
    expect(isHostPluginEnabled(org, {}, 'crm')).toBe(true)
  })

  it('drops a site the workspace doesn’t hold', () => {
    const plan = planPluginRunsOn({
      pluginId: 'crm',
      choice: { mode: 'allExcept', exceptHostIds: ['b', 'elsewhere'] },
      org,
      sites: sites(),
    })
    expect(plan.writes?.map((write) => write.hostId)).toEqual(['b'])
  })

  it('refuses leaving nothing out, and leaving every site out', () => {
    expect(
      planPluginRunsOn({ pluginId: 'crm', choice: { mode: 'allExcept', exceptHostIds: [] }, org, sites: sites() })
        .problem,
    ).toBe('Choose at least one site to leave out, or choose All sites.')
    expect(
      planPluginRunsOn({
        pluginId: 'crm',
        choice: { mode: 'allExcept', exceptHostIds: ['a', 'b', 'c'] },
        org,
        sites: sites(),
      }).problem,
    ).toBe('Keep at least one site in. To stop CRM on every site, switch it off for the workspace.')
  })

  it('refuses the base library, which runs on every site', () => {
    const plan = planPluginRunsOn({
      pluginId: 'mui',
      choice: { mode: 'allExcept', exceptHostIds: ['a'] },
      org,
      sites: sites(),
    })
    expect(plan.writes).toBeNull()
    expect(plan.problem).toMatch(/can’t be left out/)
  })

  it('refuses a plugin the workspace has switched off', () => {
    const plan = planPluginRunsOn({
      pluginId: 'crm',
      choice: { mode: 'allExcept', exceptHostIds: ['a'] },
      org: { enabledPlugins: ['commerce'] },
      sites: sites(),
    })
    expect(plan.problem).toBe('CRM is switched off for this workspace, so it runs on no site. Switch it on first.')
  })

  it('offers a plugin on for every workspace and switchable per site, such as AI', () => {
    const plan = planPluginRunsOn({
      pluginId: 'ai',
      choice: { mode: 'allExcept', exceptHostIds: ['a'] },
      org,
      sites: sites(),
    })
    expect(plan.writes).toEqual([{ hostId: 'a', disabledPlugins: ['ai'], leftOut: true }])
  })

  it('refuses leaving Commerce out where User Accounts runs, naming the site', () => {
    const withAccounts: PluginSiteEntry[] = [
      { id: 'a', enabledPlugins: ['accounts'] },
      { id: 'b' },
    ]
    const plan = planPluginRunsOn({
      pluginId: 'commerce',
      choice: { mode: 'allExcept', exceptHostIds: ['a'] },
      org,
      sites: withAccounts,
      siteName: (id) => (id === 'a' ? 'Bakery' : id),
    })
    expect(plan.writes).toBeNull()
    expect(plan.stranded).toEqual([{ hostId: 'a', pluginId: 'accounts', missing: ['commerce'] }])
    expect(plan.problem).toBe(
      'User Accounts on Bakery needs Commerce. Switch it off on that site first, or keep the site in.',
    )
  })

  it('lets Commerce be left out where User Accounts never ran', () => {
    const plan = planPluginRunsOn({
      pluginId: 'commerce',
      choice: { mode: 'allExcept', exceptHostIds: ['b'] },
      org,
      sites: [{ id: 'a', enabledPlugins: ['accounts'] }, { id: 'b' }],
    })
    expect(plan.problem).toBeNull()
  })

  it('a deny beats User Accounts’ opt-in, and the opt-in list is never written', () => {
    const site: PluginSiteEntry = { id: 'a', enabledPlugins: ['accounts'] }
    const plan = planPluginRunsOn({
      pluginId: 'accounts',
      choice: { mode: 'allExcept', exceptHostIds: ['a'] },
      org,
      sites: [site, { id: 'b' }],
    })
    expect(plan.writes).toEqual([{ hostId: 'a', disabledPlugins: ['accounts'], leftOut: true }])
    expect(
      resolveHostEnabledPlugins(org, { enabledPlugins: ['accounts'], disabledPlugins: ['accounts'] }),
    ).not.toContain('accounts')
  })

  it('does not count a site already missing what one of its plugins needs against this choice', () => {
    // Site a already runs User Accounts with Commerce off, by its own switches.
    const plan = planPluginRunsOn({
      pluginId: 'crm',
      choice: { mode: 'allExcept', exceptHostIds: ['a'] },
      org,
      sites: [{ id: 'a', enabledPlugins: ['accounts'], disabledPlugins: ['commerce'] }, { id: 'b' }],
    })
    expect(plan.problem).toBeNull()
  })
})

describe('pluginRunsOnOptInNote', () => {
  it('speaks only for a plugin a site opts into', () => {
    expect(pluginRunsOnOptInNote('accounts')).toMatch(/still runs only on the sites that turned it on/)
    expect(pluginRunsOnOptInNote('crm')).toBeNull()
  })
})
