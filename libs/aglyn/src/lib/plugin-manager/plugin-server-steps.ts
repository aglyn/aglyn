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
import { PLUGIN_SERVER_STEPS_DECLARED } from './first-party-plugins.generated'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * A SERVER STEP ANOTHER PLUGIN RUNS (AGL-3080).
 *
 * An interaction's steps are the platform's client steps plus whatever steps
 * the plugins add (`site-interactions.ts`), and every step that is not a
 * client step is the server's to run. The plugin that runs a server run — the
 * automation engine — knows its own steps. A step that acts on ANOTHER
 * plugin's records is that plugin's: writing a dataset row is the data
 * plugin's, moving a contact's stage is the CRM's. The engine used to carry
 * each of those writes itself, which made it the keeper of every plugin's
 * storage.
 *
 * So the plugin that owns a step REGISTERS ITS EXECUTOR here, by step type,
 * and the engine hands it the step when a run reaches one. The engine keeps
 * what every step shares — the step's guard, the run's order, its history,
 * the nesting cap — and the executor does the step's one write. Neither
 * imports the other: both meet at this module, which names no plugin, so a
 * marketplace plugin adds a step the same way a first-party one does.
 *
 * ## Declared, then registered — and an absent executor is refused
 *
 * The executor is registered from the owning plugin's `serverDeclarations`
 * entry, which every app runs at boot. An empty registry must not read as an
 * answer: a step whose executor never registered would otherwise fall through
 * the engine as a step nobody runs, and a run history would say the record
 * was written when it was not.
 *
 * So a first-party plugin also DECLARES the steps it runs, under
 * `serverSteps` in `plugins.config.json`, compiled into core. The three cases
 * are kept apart:
 *
 * - registered — the executor runs the step, declared or not (a marketplace
 *   plugin's steps are registered and never compiled);
 * - declared and NOT registered — the boot failed. The app's declarations
 *   step is run again ({@link runPluginDeclarationsRepair}); if the executor
 *   is still missing, {@link pluginServerStepExecutor} THROWS
 *   {@link ServerStepUnavailableError}, which the engine records as the
 *   step's failure;
 * - neither — no plugin runs the type, and the caller answers `null` as it
 *   would for any step it does not know.
 *
 * A type the engine runs itself never reaches this registry, so a
 * registration cannot replace one of the engine's own steps.
 *
 * Reached by path, never through a barrel: only server code asks.
 */

/** The automation a step belongs to, as its history and its records name it. */
export interface ServerStepRunRef {
  /** Which kind of automation is running — the engine's own vocabulary. */
  kind: string
  /** The automation's document id. */
  id: string
  /** Its name at the time of the run. */
  name: string
}

/** One step, handed to the plugin that runs it. */
export interface ServerStepRequest {
  /** The site the run is on. Every write is scoped to what this site may see. */
  hostId: string
  /**
   * The owning organization's billing document, already read by the gate
   * that admitted the run, and its id beside it — so an executor gating on
   * the plan or counting against a cap pays no second read. Null when the
   * site has no resolvable organization, which every gate reads as Free.
   */
  org: unknown
  orgId: string | null
  /** The automation whose step this is. */
  run: ServerStepRunRef
  /** The event the run is answering. */
  event: string
  /** The event's payload: the values a step reads. */
  payload: Record<string, unknown>
  /** The step exactly as it is stored. */
  step: { type: string; [field: string]: unknown }
}

/**
 * What one step did.
 *
 * Nothing set is a step that did its work. `error` is a step that did not —
 * the run records it and goes on to the next step, so an executor answers a
 * refusal rather than throwing one; a throw is read the same way.
 */
export interface ServerStepAnswer {
  /** Why nothing was written, when nothing was — a line of the run history. */
  error?: string
  /** The one fact worth carrying into the run summary: a record's name, a status. */
  detail?: string
  /**
   * An event this step's write earned, for the ENGINE to raise. Not raised
   * by the executor: an automation whose step causes the event it listens
   * for would otherwise run until a meter stopped it, and only the engine
   * holds the nesting cap that stops it first.
   */
  emit?: { event: string; payload: Record<string, unknown> }
}

/** Runs one step of the types it was registered for. */
export type ServerStepExecutor = (request: ServerStepRequest) => Promise<ServerStepAnswer>

/** The compiled declaration: which plugin runs which step type. */
export interface ServerStepDeclaration {
  pluginId: string
  /** The stored step `type`. */
  type: string
}

/** Every server step a first-party plugin declares, in `plugins.config.json` order. */
export function declaredServerSteps(): readonly ServerStepDeclaration[] {
  return PLUGIN_SERVER_STEPS_DECLARED
}

/** The declaration of this step type, or `null` for one no plugin declares. */
export function declaredServerStep(type: string): ServerStepDeclaration | null {
  return PLUGIN_SERVER_STEPS_DECLARED.find((declaration) => declaration.type === type) ?? null
}

/** A registered executor, with the plugin it belongs to. */
export interface RegisteredServerStepExecutor {
  pluginId: string
  run: ServerStepExecutor
}

/**
 * One table per process, on `globalThis` (AGL-3412): the app registers from
 * `instrumentation.ts`, which Next compiles apart from the routes that run
 * steps, and a module-scoped map would be filled in one copy and read empty
 * in the other.
 */
const EXECUTORS_KEY = Symbol.for('@aglyn/aglyn:server-step-executors')

const globalScope = globalThis as typeof globalThis & {
  [EXECUTORS_KEY]?: Map<string, RegisteredServerStepExecutor>
}

const executors: Map<string, RegisteredServerStepExecutor> =
  globalScope[EXECUTORS_KEY] ?? (globalScope[EXECUTORS_KEY] = new Map())

const PLAIN_TYPE = /^[a-z][A-Za-z0-9]*$/

/**
 * Registers the executor of one or more step types. Returns the unregister,
 * which removes each type only while this executor still holds it.
 *
 * The owner is the plugin whose register fn is running, or the `pluginId`
 * passed for a boot declaration, where the loader's marker is not set. A
 * registration with neither is refused; so is a type another plugin declares
 * or already holds, because two executors for one step would each write the
 * other's records. The same plugin registering again replaces its own (a
 * second surface, a repeated boot). Nothing is registered unless every type
 * is accepted.
 */
export function registerServerStepExecutor(
  types: readonly string[],
  run: ServerStepExecutor,
  options?: { pluginId?: string },
): () => void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a server step executor was registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  const list = [...new Set(types.map((type) => type.trim()))]
  if (!list.length) throw new Error(`"${pluginId}" registered a server step executor for no step type`)
  for (const type of list) {
    if (!PLAIN_TYPE.test(type)) {
      throw new Error(`"${pluginId}" registered a server step executor for "${type}", which is not a plain step type`)
    }
    const declared = declaredServerStep(type)
    if (declared && declared.pluginId !== pluginId) {
      throw new Error(
        `server step "${type}" is declared by "${declared.pluginId}"; refused an executor from "${pluginId}"`,
      )
    }
    const held = executors.get(type)
    if (held && held.pluginId !== pluginId) {
      throw new Error(
        `server step "${type}" already has an executor from "${held.pluginId}"; refused "${pluginId}"`,
      )
    }
  }
  const entry: RegisteredServerStepExecutor = { pluginId, run }
  for (const type of list) executors.set(type, entry)
  return () => {
    for (const type of list) if (executors.get(type) === entry) executors.delete(type)
  }
}

/** The executor registered for a step type, with its owner, or `null`. Never repairs. */
export function registeredServerStepExecutor(type: string): RegisteredServerStepExecutor | null {
  return executors.get(type) ?? null
}

/** Only for specs: forgets every registered executor. */
export function resetServerStepExecutorsForTests(): void {
  executors.clear()
}

/**
 * The declared step's executor was not registered, even after the app's
 * declarations step ran again. Its message is the step's line in the run
 * history, so it says what happened in the words a site owner reads.
 */
export class ServerStepUnavailableError extends Error {
  constructor(readonly declaration: ServerStepDeclaration) {
    super(
      `the "${declaration.type}" step did not run: the plugin that runs it ` +
        `("${declaration.pluginId}") is not loaded on this server`,
    )
    this.name = 'ServerStepUnavailableError'
  }
}

/**
 * The executor for a step type, for a run that has reached one. See the
 * module note for the three cases: registered answers it, declared but
 * missing throws after the repair has had its turn, and neither answers
 * `null`.
 */
export async function pluginServerStepExecutor(
  type: string,
): Promise<RegisteredServerStepExecutor | null> {
  const registered = executors.get(type)
  if (registered) return registered
  const declared = declaredServerStep(type)
  if (!declared) return null
  try {
    await runPluginDeclarationsRepair()
  } catch (error) {
    console.error('[server-steps] the declarations repair failed', error)
  }
  const repaired = executors.get(type)
  if (!repaired) throw new ServerStepUnavailableError(declared)
  return repaired
}
