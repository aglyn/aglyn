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
  type InteractionStepBase,
  type SiteInteraction,
  validateInteraction,
} from '../app-utils/site-interactions'

/**
 * THE CHECK OF A STEP THE PLATFORM DOES NOT KNOW (AGL-3080).
 *
 * `validateInteraction` checks what is the platform's own — the name, the
 * trigger, the guards, the client steps and every declared pick — and leaves
 * any other step to its owner, through `validateStep`. A plugin that edits
 * interactions passes its own checks there. A plugin that only WRITES one —
 * a recipe installed into a site, a drafted interaction graded before it is
 * handed over — cannot import the plugin whose steps it wrote, and still has
 * to refuse what that plugin would refuse.
 *
 * So the plugin that holds a step type's check registers it here, from its
 * `declarations` entry (both apps and the console's browser run it at boot),
 * and {@link validateStoredInteraction} runs the platform's checks with the
 * registered ones. A step with no registered check is judged by the platform
 * alone, as `validateInteraction` judges every step it was not told about.
 *
 * Reached by path, never through a barrel.
 */

/** One step's complaint, after its `Step N` prefix; `null` passes it. */
export type InteractionStepCheck = (step: InteractionStepBase, label: string) => string | null

interface RegisteredCheck {
  pluginId: string
  check: InteractionStepCheck
}

/**
 * One table per process, on `globalThis` (AGL-3412): the server apps register
 * from `instrumentation.ts`, which Next compiles apart from the routes that
 * read, and a module-scoped map would be filled in one copy and read empty in
 * the other.
 */
const CHECKS_KEY = Symbol.for('@aglyn/aglyn:interaction-step-checks')

const globalScope = globalThis as typeof globalThis & {
  [CHECKS_KEY]?: Map<string, RegisteredCheck>
}

const checks: Map<string, RegisteredCheck> =
  globalScope[CHECKS_KEY] ?? (globalScope[CHECKS_KEY] = new Map())

const PLAIN_TYPE = /^[a-z][A-Za-z0-9]*$/

/**
 * Registers the check of one or more step types. Returns the unregister, which
 * removes each type only while this check still holds it.
 *
 * The owner is the plugin whose register fn is running, or the `pluginId`
 * passed for a boot declaration. A registration with neither is refused; so is
 * a type another plugin's check already holds, because two checks of one step
 * would each pass what the other refuses. The same plugin registering again
 * replaces its own. Nothing is registered unless every type is accepted.
 */
export function registerInteractionStepChecks(
  types: readonly string[],
  check: InteractionStepCheck,
  options?: { pluginId?: string },
): () => void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'an interaction step check was registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  const list = [...new Set(types.map((type) => type.trim()))]
  if (!list.length) throw new Error(`"${pluginId}" registered an interaction step check for no step type`)
  for (const type of list) {
    if (!PLAIN_TYPE.test(type)) {
      throw new Error(`"${pluginId}" registered a check for "${type}", which is not a plain step type`)
    }
    const held = checks.get(type)
    if (held && held.pluginId !== pluginId) {
      throw new Error(`step "${type}" is already checked by "${held.pluginId}"; refused "${pluginId}"`)
    }
  }
  const entry: RegisteredCheck = { pluginId, check }
  for (const type of list) checks.set(type, entry)
  return () => {
    for (const type of list) if (checks.get(type) === entry) checks.delete(type)
  }
}

/** The check registered for a step type, with its owner, or `null`. */
export function registeredInteractionStepCheck(type: string): RegisteredCheck | null {
  return checks.get(type) ?? null
}

/**
 * An interaction's problem as the platform and every registered step check see
 * it, or `null`: what a plugin that writes an interaction it does not edit
 * asks before it stores one.
 */
export function validateStoredInteraction(
  interaction: SiteInteraction<InteractionStepBase>,
): string | null {
  return validateInteraction(interaction, {
    validateStep: (step, label) => checks.get(step.type)?.check(step, label) ?? null,
  })
}

/** Only for specs: forgets every registered check. */
export function resetInteractionStepChecksForTests(): void {
  checks.clear()
}
