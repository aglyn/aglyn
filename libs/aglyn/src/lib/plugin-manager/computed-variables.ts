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

import type { HostFunction } from '../app-utils/functions'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import type { HostVariable } from '../app-utils/variables'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * A SITE VARIABLE WHOSE VALUE A PLUGIN COMPUTES when a page is composed.
 *
 * A site variable is the platform's: a typed value a page binds with
 * `{{var:id}}`, resolved by the tenant's compose pipeline. Some variables are
 * COMPUTED — their stored value is a fallback, and a record a plugin keeps
 * produces the value the page shows (a workflow's result, AGL-129). Where
 * that value comes from is the plugin's: its storage, the reference the
 * variable carries, and how the record runs. The compose pipeline used to
 * read the workflows plugin's collection and run its workflows itself.
 *
 * So a plugin that computes variables registers a VARIABLE COMPUTER, in two
 * halves, because the page's reads are issued together before any of them is
 * awaited (AGL-1428): `prepare(hostId)` starts whatever the computation reads
 * and is issued beside the site's variables and functions; it resolves to a
 * computation the pipeline applies once those are in hand.
 *
 * ## Failing open, as a missing record always has
 *
 * A computer that throws, or none registered, leaves every variable its
 * stored value — the fallback a computed variable has always shown when its
 * record was missing or its run failed. A page never fails to render because
 * a value could not be computed. With none registered the app's declarations
 * step is offered one more run first (`plugin-declarations-repair`), so a
 * boot that lost a computer is repaired rather than published as fallbacks;
 * the step memoizes itself, so this costs one attempt per process.
 */

/** What a computation is handed, keyed as the compose pipeline holds them. */
export interface VariableComputationInput {
  variables: Record<string, HostVariable>
  functions: Record<string, HostFunction>
}

/** The variables with the computed ones' values filled in; the rest unchanged. */
export type VariableComputation = (
  input: VariableComputationInput,
) => Record<string, HostVariable>

export interface VariableComputer {
  /** Starts reading what computing one site's variables needs; resolves to the computation. */
  prepare(hostId: string): Promise<VariableComputation>
}

export const VARIABLE_COMPUTERS = definePluginServiceContract<VariableComputer>(
  'core.variable-computer',
  { multiple: true },
)

/**
 * Registers a plugin's variable computer. The owner is the loader's marker
 * when a register fn is running, else `options.pluginId`; with neither the
 * registration throws. Registering again replaces the plugin's own.
 */
export function registerVariableComputer(
  computer: VariableComputer,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) throw new Error('a variable computer was registered with no owner')
  registerPluginService(VARIABLE_COMPUTERS, computer, { pluginId })
}

const unchanged: VariableComputation = ({ variables }) => variables

/**
 * Starts every registered computer for one site and resolves to their
 * computations applied in registration order. A computer that fails to
 * prepare, or whose computation throws, leaves the variables as they were.
 */
export async function prepareComputedVariables(hostId: string): Promise<VariableComputation> {
  let computers = resolvePluginServices(VARIABLE_COMPUTERS)
  if (!computers.length) {
    try {
      if (await runPluginDeclarationsRepair()) computers = resolvePluginServices(VARIABLE_COMPUTERS)
    } catch (error) {
      console.error('[computed-variables] the declarations repair failed', error)
    }
  }
  if (!computers.length) return unchanged
  const prepared = await Promise.all(
    computers.map(async ({ pluginId, impl }) => {
      try {
        return { pluginId, compute: await impl.prepare(hostId) }
      } catch (error) {
        console.error(`variable computer of "${pluginId}" failed to prepare`, error)
        return null
      }
    }),
  )
  return (input) =>
    prepared.reduce((variables, entry) => {
      if (!entry) return variables
      try {
        return entry.compute({ ...input, variables })
      } catch (error) {
        console.error(`variable computer of "${entry.pluginId}" failed`, error)
        return variables
      }
    }, input.variables)
}
