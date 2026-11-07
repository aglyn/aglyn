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

import { isFirstPartyPlugin } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  planPluginRunsOn,
  type PluginRunsOn,
  type PluginSiteStranding,
} from '@aglyn/aglyn/plugin-manager/plugin-site-exclusions'
import { orgHostIdsFromDoc } from '@aglyn/tenant-data-admin/server/scope-sharing-sweep'

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
 * rules ask of a client write to that site's plugin lists. The workspace key
 * the route asks first is the one its own switch asks. Nobody can change a
 * site's plugins through here who couldn't on that site's own page.
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

/** A plugin id this door writes: a built-in plugin. */
export function isRunsOnPluginId(value: unknown): value is string {
  return typeof value === 'string' && isFirstPartyPlugin(value)
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
    const plan = planPluginRunsOn({
      pluginId,
      choice,
      org: orgData as { enabledPlugins?: string[] },
      sites: held.map((snapshot) => ({
        id: snapshot.id,
        disabledPlugins: snapshot.get('disabledPlugins') ?? null,
        enabledPlugins: snapshot.get('enabledPlugins') ?? null,
      })),
      siteName: (hostId) => names.get(hostId) ?? 'a site',
    })
    if (plan.problem !== null) {
      return { ok: false, status: 400, problem: plan.problem, stranded: plan.stranded }
    }
    for (const write of plan.writes) {
      if (!(await options.mayChangeSite(write.hostId))) {
        return {
          ok: false,
          status: 403,
          problem: options.refusedOnSite(names.get(write.hostId) ?? 'a site'),
        }
      }
    }
    for (const write of plan.writes) {
      tx.update(firestore.collection('hosts').doc(write.hostId), {
        disabledPlugins: write.disabledPlugins,
        updatedAt: options.now(),
      })
    }
    return {
      ok: true,
      leftOutHostIds: plan.writes.filter((write) => write.leftOut).map((write) => write.hostId),
      broughtBackHostIds: plan.writes.filter((write) => !write.leftOut).map((write) => write.hostId),
    }
  })
}
