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
  planPluginRunsOn,
  type PluginRunsOn,
  type PluginSiteStranding,
} from '@aglyn/aglyn/plugin-manager/plugin-site-exclusions'
import { orgHostIdsFromDoc } from './scope-sharing-sweep'

/**
 * WHERE A PLUGIN RUNS ACROSS A WORKSPACE, WRITTEN BY THE SERVER (AGL-4047).
 *
 * A workspace's "Runs on" choice for a plugin is stored nowhere of its own: a
 * site left out is a site whose `disabledPlugins` deny-list names the plugin,
 * the same entry that site's own Admin › Plugins switch writes
 * (`plugin-site-exclusions.ts`). So this writes those entries, every site in
 * one transaction that first reads the workspace document, which names the
 * sites: a site being created either lands first and is read here, or lands
 * after with no entry, which runs the plugin, as "all sites except…" says.
 *
 * Each site whose entry changes needs "Manage site settings" there, the key the
 * rules ask of a client write to that site's plugin lists. The caller asks the
 * workspace key first. Nobody can change a site's plugins through here who
 * couldn't on that site's own page.
 *
 * Two callers: the console's "Runs on" field for a built-in plugin
 * (`/api/orgs/plugin-sites`), and a marketplace plugin installed for the
 * workspace with "All sites except…" (the marketplace's install route), which
 * a site's switch stops since the realm join reads it.
 */

/** The most site ids one choice may name: far past any workspace. */
const RUNS_ON_MAX_IDS = 1000

/** A "Runs on" choice off the wire, or null for anything else. */
export function pluginRunsOnChoiceFrom(value: unknown): PluginRunsOn | null {
  const choice = (value ?? {}) as { mode?: unknown; exceptHostIds?: unknown }
  if (choice.mode === 'all') return { mode: 'all' }
  if (choice.mode !== 'allExcept') return null
  const ids = choice.exceptHostIds
  return Array.isArray(ids) &&
    ids.length <= RUNS_ON_MAX_IDS &&
    ids.every((id) => typeof id === 'string' && /^[^:/]+$/.test(id))
    ? { mode: 'allExcept', exceptHostIds: ids as string[] }
    : null
}

export type PluginRunsOnWrite =
  | {
      ok: false
      status: 400 | 403 | 404
      problem: string
      stranded?: PluginSiteStranding[]
    }
  | {
      ok: true
      /** Sites whose deny-list now names the plugin. */
      leftOutHostIds: string[]
      /** Sites whose deny-list no longer names it. */
      broughtBackHostIds: string[]
    }

/**
 * Writes a "Runs on" choice into each site's deny-list, in one transaction.
 *
 * Nothing is written when the choice can't be (`planPluginRunsOn`), when a
 * site whose entry changes refuses the member, or when the workspace is gone.
 */
export async function writePluginRunsOn(options: {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  pluginId: string
  choice: PluginRunsOn
  /** Whether the member may change this site's plugins: "Manage site settings" there. */
  mayChangeSite: (hostId: string) => Promise<boolean>
  /** The refusal for a site that says no. */
  refusedOnSite: (siteName: string) => string
  /** Server time for `updatedAt`. */
  now: () => unknown
  /** The plugin's name in a refusal, for one the catalog can't name. */
  label?: string
  /**
   * The plugin is being installed for the workspace in the same request: a
   * marketplace plugin with "All sites except…", written BEFORE its pin, so a
   * site left out never runs it, not even for one page (AGL-4047).
   *
   * Two things follow. The workspace reads it as on, since the install
   * switches it on. And the choice only ever LEAVES sites out: a site that
   * switched this plugin off for itself before (it had been installed and
   * removed) keeps its own switch, as a plain All sites install keeps it.
   */
  installing?: boolean
}): Promise<PluginRunsOnWrite> {
  const { firestore, orgId, pluginId, choice } = options
  const orgRef = firestore.collection('orgs').doc(orgId)
  return firestore.runTransaction(async (tx): Promise<PluginRunsOnWrite> => {
    const org = await tx.get(orgRef)
    if (!org.exists) return { ok: false, status: 404, problem: 'No such workspace' }
    const orgData = (org.data() ?? {}) as Record<string, unknown>
    const hostIds = orgHostIdsFromDoc(orgData)
    const hostRefs = hostIds.map((hostId) => firestore.collection('hosts').doc(hostId))
    const snapshots = hostRefs.length ? await tx.getAll(...hostRefs) : []
    // A site the workspace document still names but that is gone, or that
    // another workspace now holds, is not this workspace's to write.
    const held = snapshots.filter((snapshot) => snapshot.exists && snapshot.get('orgId') === orgId)
    const names = new Map(
      held.map((snapshot) => [
        snapshot.id,
        String(snapshot.get('displayName') || snapshot.get('subdomain') || 'a site'),
      ]),
    )
    const enabled = orgData['enabledPlugins']
    const plan = planPluginRunsOn({
      pluginId,
      choice,
      // The install switches it on for the workspace (`syncEnabledPlugins`),
      // so the choice is planned as for a plugin that is on.
      org: (options.installing && Array.isArray(enabled)
        ? { ...orgData, enabledPlugins: [...enabled.map(String), pluginId] }
        : orgData) as { enabledPlugins?: string[] },
      installedListings: options.installing ? [pluginId] : undefined,
      sites: held.map((snapshot) => ({
        id: snapshot.id,
        disabledPlugins: snapshot.get('disabledPlugins') ?? null,
        enabledPlugins: snapshot.get('enabledPlugins') ?? null,
      })),
      siteName: (hostId) => names.get(hostId) ?? 'a site',
      ...(options.label ? { label: options.label } : {}),
    })
    if (plan.problem !== null) {
      return { ok: false, status: 400, problem: plan.problem, stranded: plan.stranded }
    }
    const writes = options.installing ? plan.writes.filter((write) => write.leftOut) : plan.writes
    for (const write of writes) {
      if (!(await options.mayChangeSite(write.hostId))) {
        return {
          ok: false,
          status: 403,
          problem: options.refusedOnSite(names.get(write.hostId) ?? 'a site'),
        }
      }
    }
    for (const write of writes) {
      tx.update(firestore.collection('hosts').doc(write.hostId), {
        disabledPlugins: write.disabledPlugins,
        updatedAt: options.now(),
      })
    }
    return {
      ok: true,
      leftOutHostIds: writes.filter((write) => write.leftOut).map((write) => write.hostId),
      broughtBackHostIds: writes.filter((write) => !write.leftOut).map((write) => write.hostId),
    }
  })
}
