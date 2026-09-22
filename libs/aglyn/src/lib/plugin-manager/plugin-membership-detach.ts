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
 * A plugin's share of taking a CONTAINER away (AGL-3254).
 *
 * A container — a campaign is the first — is a document other records join
 * by naming it in a membership array on their OWN documents
 * (`app-utils/campaign-membership.ts` says why the edge lives on the
 * member). When the container is removed, its owner clears the id off every
 * member it can name. A plugin that keeps members of its own where that
 * walk does not reach — records under the org, in collections the owner
 * does not know — registers a detacher here, and the removal runs every
 * detacher with the container's id, the membership field it is held in,
 * the site and the org, so the plugin can clear its own records.
 *
 * Detachers run BEFORE the container is deleted, for the reason the owner's
 * own passes do: a run that stops between them leaves records already out
 * of the container, which every surface draws correctly, while deleting
 * first would leave a plugin's record naming an id nothing can resolve. A
 * detacher that reports `remaining` holds the deletion, exactly as the
 * owner's own pass does when the container is on more records than one
 * request can clear.
 *
 * Detachers run in registration order and are ISOLATED: a throw is logged
 * against its plugin, recorded as `null`, and does not stop the next one.
 * The owner reads a `null` as "this plugin's records may still name the
 * container" and refuses to remove it, which is the direction a failure
 * here has to fall.
 *
 * Registered from a plugin's declarations — `consoleServerDeclarations`,
 * since a container is removed from the console — so the detacher is in
 * place in a process that never loaded the plugin's API surface. The core
 * never imports a plugin; this is how a removal one plugin performs reaches
 * another plugin's records.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** The container being removed, and where its members may be. */
export interface PluginMembershipDetachRequest {
  /** The site the container belongs to. */
  hostId: string
  /** The site's organization, or `''` for a site with no org behind it. */
  orgId: string
  /** The membership field a member holds the container's id in. */
  field: string
  /** The container's document id — what the field names. */
  id: string
}

/**
 * What a detacher reports: how many of its records it took the container
 * off, and whether any were left for a second run. Counts, never content.
 */
export interface PluginMembershipDetachReport {
  detached: number
  remaining: boolean
}

export type PluginMembershipDetacher = (
  request: PluginMembershipDetachRequest,
) => Promise<PluginMembershipDetachReport>

interface Registration {
  pluginId: string
  detacher: PluginMembershipDetacher
}

const registrations: Registration[] = []

/**
 * Registers a plugin's membership detacher. Owner = the loader's marker
 * inside a register fn, else `options.pluginId`; a detacher with neither
 * throws. One detacher per plugin: registering again replaces the plugin's
 * earlier detacher in place, so a module evaluated twice does not run twice.
 */
export function registerPluginMembershipDetacher(
  detacher: PluginMembershipDetacher,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a plugin membership detacher was registered with no owner: pass ' +
        '{ pluginId } when registering outside a plugin register fn',
    )
  }
  const index = registrations.findIndex((entry) => entry.pluginId === pluginId)
  if (index >= 0) registrations[index] = { pluginId, detacher }
  else registrations.push({ pluginId, detacher })
}

/**
 * Runs every detacher, in registration order, and answers each plugin's
 * report by plugin id: the detacher's own report, or `null` for one that
 * threw. Never throws.
 */
export async function runPluginMembershipDetachers(
  request: PluginMembershipDetachRequest,
): Promise<Record<string, PluginMembershipDetachReport | null>> {
  const reports: Record<string, PluginMembershipDetachReport | null> = {}
  for (const { pluginId, detacher } of [...registrations]) {
    try {
      const report = await detacher({ ...request })
      reports[pluginId] = {
        detached: Math.max(0, Math.floor(Number(report?.detached ?? 0)) || 0),
        remaining: report?.remaining === true,
      }
    } catch (error) {
      reports[pluginId] = null
      console.error(
        `[plugins] ${pluginId} failed to detach ${request.field} ${request.id} on host ${request.hostId}`,
        error,
      )
    }
  }
  return reports
}

/** The plugins with a detacher in place, in registration order. Only for specs and the guards. */
export function listPluginMembershipDetachers(): string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Test seam: forget every detacher. */
export function resetPluginMembershipDetachersForTests(): void {
  registrations.length = 0
}
