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
 * A plugin's share of a workspace erasure (AGL-2978).
 *
 * The workspace erasure destroys what the platform holds for an
 * organization: its document tree, its sites, and the top-level records
 * keyed to it by a field. A plugin that holds something those deletes cannot
 * finish on their own registers an eraser here — a grant at a provider that
 * only the plugin can revoke, or a record outside every path and field the
 * erasure sweeps — and the erasure runs every eraser with the organization's
 * id.
 *
 * Erasers run BEFORE the erasure deletes anything of its own. The
 * organization, its roster and every record the erasure is about to sweep
 * still exist when an eraser runs, so an eraser that has to act through a
 * record — open a stored grant to revoke it — finds the record there. What
 * the erasure deletes on its own stays its to delete: an eraser adds to the
 * erasure, and the erasure does not wait on one to finish its own sweeps.
 *
 * Erasers run in registration order and are ISOLATED: a throw is logged
 * against its plugin, recorded as `null`, and does not stop the next one or
 * the erasure. An erasure runs against a legal clock, and one plugin's
 * outage must not keep every other plugin's data, or the workspace, past it.
 * The `null` is how the erasure's audit record says that plugin's share may
 * not be done, which a report of zero would hide.
 *
 * A DRY RUN is handed to every eraser, which must then touch no provider and
 * write nothing: it counts what it would do. A plan that reached a vendor
 * would be an erasure that happened without anybody deciding it should.
 *
 * Registered from a plugin's declarations — `serverDeclarations`, or
 * `consoleServerDeclarations` for an eraser that opens a credential only the
 * console holds — so the eraser is in place in a server process that never
 * loaded the plugin's API surface.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** What an eraser is asked to erase. */
export interface PluginOrgErasureRequest {
  /** The workspace being erased. */
  orgId: string
  /**
   * A plan, not an erasure: count, touch no provider, write nothing. The
   * erasure's own sweeps honor the same flag.
   */
  dryRun: boolean
}

/**
 * What an eraser reports for the erasure's audit record: counts and flags,
 * never the erased content, because the record outlives the data by design.
 * A `null` field is a figure the eraser could not measure, which is not zero.
 */
export type PluginOrgErasureReport = Readonly<Record<string, number | boolean | null>>

export type PluginOrgEraser = (
  request: PluginOrgErasureRequest,
) => Promise<PluginOrgErasureReport>

interface Registration {
  pluginId: string
  eraser: PluginOrgEraser
}

const registrations: Registration[] = []

/**
 * Registers a plugin's workspace eraser. Owner = the loader's marker inside a
 * register fn, else `options.pluginId`; an eraser with neither throws. One
 * eraser per plugin: registering again replaces the plugin's earlier eraser
 * in place, so a module evaluated twice does not erase twice.
 */
export function registerPluginOrgEraser(
  eraser: PluginOrgEraser,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a plugin org eraser was registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  const index = registrations.findIndex((entry) => entry.pluginId === pluginId)
  if (index >= 0) registrations[index] = { pluginId, eraser }
  else registrations.push({ pluginId, eraser })
}

/**
 * Runs every eraser, in registration order, and answers each plugin's
 * report by plugin id: the eraser's own report, or `null` for one that
 * threw. Never throws.
 */
export async function runPluginOrgErasers(
  request: PluginOrgErasureRequest,
): Promise<Record<string, PluginOrgErasureReport | null>> {
  const reports: Record<string, PluginOrgErasureReport | null> = {}
  for (const { pluginId, eraser } of [...registrations]) {
    try {
      reports[pluginId] = await eraser({ orgId: request.orgId, dryRun: request.dryRun })
    } catch (error) {
      reports[pluginId] = null
      console.error(`[plugins] ${pluginId} failed to erase org ${request.orgId}`, error)
    }
  }
  return reports
}

/** The plugins with a workspace eraser, in the order they run. */
export function listPluginOrgErasers(): string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Test seam: forget every eraser. */
export function resetPluginOrgErasersForTests(): void {
  registrations.length = 0
}
