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
 *
 * ## A REQUIRED eraser (AGL-3080)
 *
 * Isolation is right for a share whose failure leaves the workspace's data
 * gone and only a provider-side courtesy undone. It is wrong for a share the
 * erasure PROMISES: a public record naming the erased organization, a payout
 * identifier on a world-readable document. A plugin holding such a record
 * declares `"requiredOrgEraser": true` in `plugins.config.json`, compiled into
 * {@link PLUGIN_REQUIRED_ORG_ERASERS} so no registration can opt out of it, and:
 *
 * - an erasure REFUSES to start while a required eraser is not registered —
 *   a boot that failed to declare it must not produce a "complete" erasure
 *   with the record still standing;
 * - a required eraser that throws still lets every other eraser run, and then
 *   fails the erasure's `plugins` step, which the cron retries.
 *
 * ## Plugin collections keyed by the organization (AGL-3080)
 *
 * A plugin's TOP-LEVEL collection whose documents carry the organization's id
 * in a field is invisible to the erasure's path deletes. The plugin declares
 * it (`orgKeyedCollections`, compiled into {@link PLUGIN_ORG_KEYED_COLLECTIONS})
 * and the erasure sweeps it by that field in every process, with or without
 * the plugin loaded — a deletion that must not depend on which bundles an
 * erasing process happened to load, so it is data rather than an eraser.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'
import {
  PLUGIN_ORG_KEYED_COLLECTIONS,
  PLUGIN_REQUIRED_ORG_ERASERS,
} from './first-party-plugins.generated'

export { PLUGIN_ORG_KEYED_COLLECTIONS, PLUGIN_REQUIRED_ORG_ERASERS }

/**
 * A plugin's top-level collection whose documents name an organization in a
 * field, declared by that plugin. See the module note.
 */
export interface PluginOrgKeyedCollection {
  /** The plugin that declared it. */
  pluginId: string
  /** The top-level collection. */
  name: string
  /** The field naming the organization a document belongs to. */
  orgField: string
}

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

/**
 * One list per process, on `globalThis` (AGL-3464): the app registers its
 * plugins' erasers from `instrumentation.ts`, which Next compiles apart from
 * the route that runs the erasure, and a module-scoped list is filled in one
 * copy and read empty in the other — the AGL-3412 shape.
 */
const ERASERS_KEY = Symbol.for('@aglyn/aglyn:plugin-org-erasers')

const globalScope = globalThis as typeof globalThis & {
  [ERASERS_KEY]?: Registration[]
}

const registrations: Registration[] =
  globalScope[ERASERS_KEY] ?? (globalScope[ERASERS_KEY] = [])

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
 * threw.
 *
 * Throws in exactly two cases, both about a REQUIRED eraser (`required`,
 * the compiled {@link PLUGIN_REQUIRED_ORG_ERASERS} unless a spec passes its
 * own): before running anything, when one is not registered even after the
 * app's boot step has run once more; and after running every eraser, when
 * one threw.
 */
export async function runPluginOrgErasers(
  request: PluginOrgErasureRequest,
  required: readonly string[] = PLUGIN_REQUIRED_ORG_ERASERS,
): Promise<Record<string, PluginOrgErasureReport | null>> {
  const missing = await missingAfterRepair(required)
  if (missing.length) {
    throw new Error(
      `[plugins] erasing org ${request.orgId} refused: ${missing.join(', ')} ` +
        'declared a required org eraser and none is registered in this process',
    )
  }
  const reports: Record<string, PluginOrgErasureReport | null> = {}
  const failedRequired: string[] = []
  for (const { pluginId, eraser } of [...registrations]) {
    try {
      reports[pluginId] = await eraser({ orgId: request.orgId, dryRun: request.dryRun })
    } catch (error) {
      reports[pluginId] = null
      console.error(`[plugins] ${pluginId} failed to erase org ${request.orgId}`, error)
      if (required.includes(pluginId)) failedRequired.push(pluginId)
    }
  }
  if (failedRequired.length) {
    throw new Error(
      `[plugins] erasing org ${request.orgId} incomplete: the required eraser of ` +
        `${failedRequired.join(', ')} failed`,
    )
  }
  return reports
}

/**
 * The required erasers not registered in this process, after running the
 * app's boot step once when any is missing (AGL-3464): a boot whose
 * declarations failed looks the same from here as one that never declared
 * the eraser, and only the second is a reason to refuse.
 */
async function missingAfterRepair(required: readonly string[]): Promise<string[]> {
  const missing = () => {
    const registered = new Set(registrations.map((entry) => entry.pluginId))
    return required.filter((pluginId) => !registered.has(pluginId))
  }
  if (!missing().length) return []
  await runPluginDeclarationsRepair().catch((error: unknown) => {
    console.error('[plugins] the declarations repair failed before an org erasure', error)
  })
  return missing()
}

/** The plugins with a workspace eraser, in the order they run. */
export function listPluginOrgErasers(): string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Test seam: forget every eraser. */
export function resetPluginOrgErasersForTests(): void {
  registrations.length = 0
}

/**
 * Test seam: a no-op eraser for every REQUIRED plugin that has none, so a
 * spec about the erasure's own sweeps can run it without loading a plugin
 * (core and the data layer may not import one). A spec about a required
 * plugin's share registers the real one through the app's manifest instead.
 */
export function standInRequiredOrgErasersForTests(): void {
  const registered = new Set(registrations.map((entry) => entry.pluginId))
  for (const pluginId of PLUGIN_REQUIRED_ORG_ERASERS) {
    if (!registered.has(pluginId)) {
      registrations.push({ pluginId, eraser: async () => ({ standIn: true }) })
    }
  }
}
