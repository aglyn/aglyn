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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * WOULD A VISITOR'S NEXT WRITE THROUGH A PLUGIN'S DOOR BE ACCEPTED (AGL-3080)?
 *
 * A plugin that keeps a public door — the forms plugin's `/api/forms/submit`
 * — runs gates of its own in front of the write: whether the site has the
 * plugin on, what the plan allows this month, the ceiling a flood trips. A
 * monitor that must not WRITE to find out (a synthetic submission would file
 * fake leads, bill the customer and notify the site's managers) has to ask
 * the same predicates about the same documents, and those are the door's
 * owner's to evaluate.
 *
 * So the owner registers an INTAKE GATE under the door's name (`form`), and
 * the monitor asks it. The gate answers what the door would answer for a
 * visitor arriving now, BEFORE its first write, and writes nothing:
 *
 * - `open` — accepted;
 * - `switched-off` — the site has the door's plugin off;
 * - `plan-exhausted` — the plan's monthly allowance is spent and the plan
 *   walls rather than meters;
 * - `flood-ceiling` — the site tripped the ceiling that contains a flood.
 *
 * The platform's own gates are not the gate's to answer: whether the site is
 * paused (lockdown), and who would be told, are asked by the monitor itself.
 * The caller hands over the site and organization documents it has already
 * read, so a gate reads only what is its own.
 *
 * ## Not registered is an answer
 *
 * No gate means no plugin keeps the door in this process; a caller runs the
 * app's declarations step once and asks again before it concludes the door
 * is shut. One gate per door: a second plugin registering one another plugin
 * already answers is refused, naming both.
 */

/** What a door would answer a visitor arriving now. */
export type PluginIntakeVerdict = 'open' | 'switched-off' | 'plan-exhausted' | 'flood-ceiling'

/** The site and organization the caller has read already. */
export interface PluginIntakeRequest {
  hostId: string
  /** The site's document, as read. */
  host: Readonly<Record<string, unknown>> | undefined
  /** The owning organization's document, as read; absent for a site with none. */
  org: Readonly<Record<string, unknown>> | undefined
}

/** Evaluates the door's own gates without writing. Throws what its reads throw. */
export type PluginIntakeGate = (request: PluginIntakeRequest) => Promise<PluginIntakeVerdict>

export const PLUGIN_INTAKE_GATES = definePluginServiceContract<PluginIntakeGate>(
  'core.intake-gates',
  { multiple: true },
)

/**
 * Registers the gate for one door. The owner is the loader's marker when a
 * register fn is running, else `options.pluginId`; with neither it throws. A
 * door another plugin already answers throws naming both.
 */
export function registerPluginIntakeGate(
  door: string,
  gate: PluginIntakeGate,
  options?: { pluginId?: string },
): void {
  const key = door.trim()
  if (!key) throw new Error('an intake gate needs the door it answers for')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) throw new Error(`the intake gate for "${key}" was registered with no owner`)
  const incumbent = resolvePluginServices(PLUGIN_INTAKE_GATES).find((entry) => entry.key === key)
  if (incumbent && incumbent.pluginId !== pluginId) {
    throw new Error(
      `door "${key}" is already gated by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_INTAKE_GATES, gate, { pluginId, key })
}

/** The gate for a door, with the plugin that keeps it, or `null` when none does here. */
export function pluginIntakeGate(
  door: string,
): { pluginId: string; gate: PluginIntakeGate } | null {
  const key = door.trim()
  const entry = resolvePluginServices(PLUGIN_INTAKE_GATES).find((one) => one.key === key)
  return entry ? { pluginId: entry.pluginId, gate: entry.impl } : null
}
