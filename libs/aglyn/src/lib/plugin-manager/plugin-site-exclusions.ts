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
 * Where a plugin runs across a workspace's sites: All sites, or all sites
 * except some (AGL-4047).
 *
 * NO NEW STORAGE AND NO MARKER. A site that is left out is a site whose own
 * `disabledPlugins` deny-list names the plugin, which is exactly what that
 * site's Admin › Plugins switch writes. So the workspace's "Runs on" choice
 * is READ across the sites' deny-lists and WRITTEN into them, and nothing
 * else needs to know it exists:
 *
 * - A site added later has no entry, so it runs the plugin. That is what
 *   "all sites except…" promises, with no sweep to keep it true.
 * - A deleted site takes its entry with it.
 * - Anyone who may change a site's plugins can still turn it back on there,
 *   as today, and the workspace's choice then reads that site as included.
 *
 * "Selected sites" is not offered for an ordinary plugin: a site's deny-list
 * can't say "on only here", so it would have to deny every other site, and a
 * site added later would then get the plugin, which is the opposite of what
 * "selected" means.
 *
 * Pure: the console reads it to draw the field, and the route that writes it
 * (`/api/orgs/plugin-sites`) asks it again against what it read in its own
 * transaction.
 */

import {
  canonicalPluginId,
  FIRST_PARTY_PLUGINS,
  isDefaultOffPerSite,
  isLockedOnForSite,
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
  strandedDependents,
} from './enabled-plugins'

/** One site, as far as where a plugin runs is concerned. */
export interface PluginSiteEntry {
  /** The host document id. */
  id: string
  disabledPlugins?: readonly string[] | null
  enabledPlugins?: readonly string[] | null
}

/** Where a plugin runs, as a person would choose it. */
export type PluginRunsOn =
  | { mode: 'all' }
  | { mode: 'allExcept'; exceptHostIds: readonly string[] }

/** Whether a site's deny-list names this plugin. */
export function siteLeavesOutPlugin(
  site: Pick<PluginSiteEntry, 'disabledPlugins'> | null | undefined,
  pluginId: string,
): boolean {
  const id = canonicalPluginId(pluginId)
  return Array.isArray(site?.disabledPlugins)
    ? site.disabledPlugins.some((one) => canonicalPluginId(String(one)) === id)
    : false
}

/**
 * Where a plugin runs today, read across the workspace's sites: All sites
 * when no site's deny-list names it, else all sites except the ones that do.
 *
 * Every site may be named, which is a state a site's own switches can reach
 * and a choice this module refuses to WRITE (see {@link planPluginRunsOn}).
 * It is read as what it is, so the field can say so rather than pretend.
 */
export function pluginRunsOnOf(
  pluginId: string,
  sites: readonly Pick<PluginSiteEntry, 'id' | 'disabledPlugins'>[],
): PluginRunsOn {
  const exceptHostIds = sites
    .filter((site) => siteLeavesOutPlugin(site, pluginId))
    .map((site) => site.id)
  return exceptHostIds.length ? { mode: 'allExcept', exceptHostIds } : { mode: 'all' }
}

/** A site's deny-list with this plugin added or taken out, or null when unchanged. */
function nextDisabled(
  site: PluginSiteEntry,
  pluginId: string,
  leaveOut: boolean,
): string[] | null {
  const current = Array.isArray(site.disabledPlugins)
    ? site.disabledPlugins.map(String)
    : []
  const listed = siteLeavesOutPlugin(site, pluginId)
  if (leaveOut === listed) return null
  if (leaveOut) return [...current, pluginId]
  const id = canonicalPluginId(pluginId)
  return current.filter((one) => canonicalPluginId(one) !== id)
}

/** One site whose deny-list a choice changes. */
export interface PluginSiteWrite {
  hostId: string
  /** The whole deny-list as it should be stored. */
  disabledPlugins: string[]
  /** True when the plugin is taken off this site, false when it comes back. */
  leftOut: boolean
}

/** A plugin that would be left running on a site without one it needs. */
export interface PluginSiteStranding {
  hostId: string
  pluginId: string
  missing: string[]
}

export type PluginRunsOnPlan =
  | { writes: PluginSiteWrite[]; problem: null; stranded: [] }
  | { writes: null; problem: string; stranded: PluginSiteStranding[] }

const labelOf = (pluginId: string): string =>
  FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === pluginId)?.label ?? pluginId

/**
 * What a "Runs on" choice writes to each site, or why it can't be written.
 *
 * - The base library runs on every site and can't be left out anywhere.
 * - A plugin the workspace has switched off runs on no site, so there is no
 *   choice to make until it is switched back on.
 * - "All sites except…" must leave out at least one site and keep at least
 *   one in: leaving every site out is switching it off for the workspace,
 *   which is a different switch with a different reach.
 * - A site the choice names that the workspace doesn't hold is dropped, not
 *   refused: it is out either way.
 * - Leaving a site out is refused, naming the site and the plugin, when a
 *   plugin running there needs this one. Only what THIS choice would strand
 *   is counted, so a site already in that state doesn't block the others.
 * - Only sites whose deny-list changes are written. A site's opt-in list
 *   (`enabledPlugins`, for User Accounts) is never touched: a deny beats it.
 */
export function planPluginRunsOn(input: {
  pluginId: string
  choice: PluginRunsOn
  org: { enabledPlugins?: string[] } | null | undefined
  sites: readonly PluginSiteEntry[]
  /** The workspace's pinned marketplace listings, as `resolveEnabledPlugins` reads them. */
  installedListings?: readonly string[] | null
  /** How a site reads in a refusal. Its id when absent. */
  siteName?: (hostId: string) => string
  /**
   * The plugin's name in a refusal, for one the catalog can't name: a
   * marketplace plugin, whose id is its listing's (AGL-4047). The catalog's
   * label, else the id, when absent.
   */
  label?: string
}): PluginRunsOnPlan {
  const { pluginId, choice, org, sites } = input
  const refuse = (problem: string, stranded: PluginSiteStranding[] = []): PluginRunsOnPlan => ({
    writes: null,
    problem,
    stranded,
  })
  const label = input.label?.trim() || labelOf(pluginId)
  if (isLockedOnForSite(pluginId)) {
    return refuse(`${label} runs on every site, because sites are built out of it, so it can’t be left out.`)
  }
  if (!resolveEnabledPlugins(org, input.installedListings).includes(pluginId)) {
    return refuse(`${label} is switched off for this workspace, so it runs on no site. Switch it on first.`)
  }
  const siteIds = sites.map((site) => site.id)
  const except =
    choice.mode === 'allExcept'
      ? [...new Set(choice.exceptHostIds.map(String))].filter((id) => siteIds.includes(id))
      : []
  if (choice.mode === 'allExcept') {
    if (!except.length) {
      return refuse('Choose at least one site to leave out, or choose All sites.')
    }
    if (except.length === siteIds.length) {
      return refuse(
        `Keep at least one site in. To stop ${label} on every site, switch it off for the workspace.`,
      )
    }
  }
  const name = input.siteName ?? ((hostId: string) => hostId)
  const writes: PluginSiteWrite[] = []
  const stranded: PluginSiteStranding[] = []
  for (const site of sites) {
    const leaveOut = except.includes(site.id)
    const disabledPlugins = nextDisabled(site, pluginId, leaveOut)
    if (!disabledPlugins) continue
    if (leaveOut) {
      const optedIn = Array.isArray(site.enabledPlugins) ? site.enabledPlugins.map(String) : undefined
      const runs = (denied: readonly string[] | null | undefined) =>
        resolveHostEnabledPlugins(
          org,
          { disabledPlugins: Array.isArray(denied) ? denied.map(String) : undefined, enabledPlugins: optedIn },
          input.installedListings,
        )
      const before = new Set(strandedDependents(runs(site.disabledPlugins)).map((entry) => entry.pluginId))
      const after = strandedDependents(runs(disabledPlugins))
      for (const entry of after) {
        if (!before.has(entry.pluginId)) stranded.push({ hostId: site.id, ...entry })
      }
    }
    writes.push({ hostId: site.id, disabledPlugins, leftOut: leaveOut })
  }
  if (stranded.length) {
    const sentences = stranded.map(
      (entry) =>
        `${labelOf(entry.pluginId)} on ${name(entry.hostId)} needs ${entry.missing.map(labelOf).join(' and ')}`,
    )
    return refuse(
      `${sentences.join('; ')}. Switch ${stranded.length === 1 ? 'it' : 'them'} off on ` +
        `${stranded.length === 1 ? 'that site' : 'those sites'} first, or keep ` +
        `${stranded.length === 1 ? 'the site' : 'those sites'} in.`,
      stranded,
    )
  }
  return { writes, problem: null, stranded: [] }
}

/**
 * The sentence the console shows for a plugin that is still off on a site it
 * runs on by this choice, because that site never turned it on: User
 * Accounts, which a site opts into (`defaultOffPerSite`). Null for every other
 * plugin. The choice only ever takes a site out; it never turns a plugin on
 * for a site that hasn't asked for it.
 */
export function pluginRunsOnOptInNote(pluginId: string): string | null {
  return isDefaultOffPerSite(pluginId)
    ? `${labelOf(pluginId)} still runs only on the sites that turned it on. Leaving a site out ` +
        'here keeps it off there even if that site turned it on.'
    : null
}
