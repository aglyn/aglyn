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
 * A plugin's share of an account erasure (AGL-2939).
 *
 * The account erasure deletes what core stores about a person: the user
 * document and its subcollections, the memberships, the public profile, the
 * delivery log and the auth record. A plugin that keeps data ABOUT a person
 * where none of that reaches — documents under an org keyed by the uid, a
 * collection carrying the uid as a field — registers an eraser here, and
 * the erasure runs every eraser with the person's uid and the workspaces
 * they belonged to.
 *
 * Erasers run in registration order and are ISOLATED: a throw is logged
 * against its plugin, recorded as `null`, and does not stop the next one.
 * An erasure runs against a legal clock, and one plugin's outage must not
 * keep every other plugin's data past it. The `null` is how the erasure's
 * audit record says that plugin's data may remain, which a report of zero
 * would hide.
 *
 * Registered from a plugin's `serverDeclarations` entry, so the eraser is in
 * place in a server process that never loaded the plugin's API surface.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** What an eraser is asked to erase. */
export interface PluginUserErasureRequest {
  /** The account being erased. */
  uid: string
  /**
   * Every workspace the person belonged to when the erasure began. Their
   * memberships are removed before the erasers run, so this is the only
   * record of them an eraser gets.
   */
  orgIds: readonly string[]
}

/**
 * What an eraser reports for the erasure's audit record: counts and flags,
 * never the erased content, because the record outlives the data by design.
 * A `null` field is a figure the eraser could not measure, which is not zero.
 */
export type PluginUserErasureReport = Readonly<Record<string, number | boolean | null>>

export type PluginUserEraser = (
  request: PluginUserErasureRequest,
) => Promise<PluginUserErasureReport>

interface Registration {
  pluginId: string
  eraser: PluginUserEraser
}

const registrations: Registration[] = []

/**
 * Registers a plugin's eraser. Owner = the loader's marker inside a register
 * fn, else `options.pluginId`; an eraser with neither throws. One eraser per
 * plugin: registering again replaces the plugin's earlier eraser in place,
 * so a module evaluated twice does not erase twice.
 */
export function registerPluginUserEraser(
  eraser: PluginUserEraser,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a plugin user eraser was registered with no owner: pass { pluginId } ' +
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
 */
export async function runPluginUserErasers(
  request: PluginUserErasureRequest,
): Promise<Record<string, PluginUserErasureReport | null>> {
  const reports: Record<string, PluginUserErasureReport | null> = {}
  for (const { pluginId, eraser } of [...registrations]) {
    try {
      reports[pluginId] = await eraser(request)
    } catch (error) {
      reports[pluginId] = null
      console.error(`[plugins] ${pluginId} failed to erase user ${request.uid}`, error)
    }
  }
  return reports
}

/** The plugins with an eraser, in the order they run. */
export function listPluginUserErasers(): string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Test seam: forget every eraser. */
export function resetPluginUserErasersForTests(): void {
  registrations.length = 0
}
