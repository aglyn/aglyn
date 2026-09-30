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
import { FORM_COMPONENT_ID } from '../app-utils/forms'
import { PLUGIN_FORM_RECORD_TARGET_DECLARED } from './first-party-plugins.generated'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * WHERE A FORM'S SUBMISSION IS ALSO SAVED AS A RECORD (AGL-3080).
 *
 * A form on a published page can file every submission as a record another
 * plugin keeps — a row in a dataset, today. The form is one plugin's element
 * and the record is another plugin's storage, so neither may know the other:
 * this is the contract between them, and core names neither the target nor
 * where it keeps anything.
 *
 * It has two halves, because the decision of where a record lands must be
 * made where the visitor cannot reach it:
 *
 * 1. {@link stampFormRecordTargets} — the page's composition hands the target
 *    the tree it is about to ship, and the target stamps each form it will
 *    write for with whatever it needs to trust at submit time (a signed
 *    binding). The submit route is public and unauthenticated, so nothing
 *    the body says on its own may choose a destination.
 * 2. {@link writeFormRecordTarget} — the submit route hands the target the
 *    submission as posted, after the submission itself is stored. The target
 *    reads back what it stamped, writes the record or refuses it, and answers
 *    what to note on the submission (`routing`) so the Inbox can say where it
 *    went or why it did not.
 *
 * ## Declared, then registered — and an absent target is loud
 *
 * The target registers from its plugin's `serverDeclarations` entry, which
 * every app runs at boot, and also DECLARES itself in `plugins.config.json`
 * (`formRecordTarget`), compiled into core. A registry alone would read a
 * failed boot as "no form writes anywhere", and every bound form would keep
 * accepting submissions while its records quietly stopped — the AGL-3025
 * shape. With the declaration the three cases are distinct:
 *
 * - nothing declared — this deployment ships no plugin that keeps records; no
 *   form is stamped and no submission writes one, which is a real answer;
 * - declared and registered — the target answers;
 * - declared and NOT registered — the app's declarations step runs again. If
 *   the target is still missing, a page carrying a form THROWS at render (the
 *   cache keeps the last good page, and the logs are red), and a submission
 *   is kept — the Inbox copy is written before this is asked — with the
 *   failure logged and noted on it under `routing.recordTargetUnavailable`.
 *
 * Server-only, and reached by path, never through a barrel.
 */

/** One submission, as the route stored it. */
export interface FormRecordWriteRequest {
  /** The site the form was submitted on. */
  hostId: string
  /** The organization that owns the site, when it has one. */
  orgId: string | null
  /** The organization's billing document — the entitlements a write is held to. */
  orgBilling: unknown
  /**
   * The request body as posted. The target reads back only what it stamped
   * onto the form, and must trust nothing else in it.
   */
  body: Readonly<Record<string, unknown>>
  /** The submitted values, sanitized, keyed by the name each field submits under. */
  fields: Readonly<Record<string, string>>
}

/** What a target answers for one submission. */
export interface FormRecordWriteOutcome {
  /**
   * Written as the stored submission's `routing` when present: where the
   * record went, or why it was refused. Absent when the form writes nowhere.
   */
  routing?: Record<string, unknown>
}

/** A plugin that keeps the records forms may file into. */
export interface FormRecordTarget {
  /**
   * Stamps each form in a composed tree this target will write for. Never
   * mutates `nodes`, and answers the same object when it stamps nothing.
   */
  stamp<N extends Record<string, unknown>>(nodes: N, hostId: string): Promise<N>
  /**
   * Writes one submission's record, or refuses it. Never rejects: a record
   * that cannot be written is no reason to fail a submission already stored.
   */
  write(request: FormRecordWriteRequest): Promise<FormRecordWriteOutcome>
}

/** The compiled declaration: which plugin keeps the records forms file into. */
export interface FormRecordTargetDeclaration {
  pluginId: string
  id: string
}

/** The plugin declared as the forms' record target, or `null` when none is. */
export function declaredFormRecordTarget(): FormRecordTargetDeclaration | null {
  return PLUGIN_FORM_RECORD_TARGET_DECLARED
}

interface RegisteredTarget {
  pluginId: string
  target: FormRecordTarget
}

/**
 * One slot per process, on `globalThis` (AGL-3412): the app registers from
 * `instrumentation.ts`, which Next compiles apart from the routes that read.
 */
const TARGET_KEY = Symbol.for('@aglyn/aglyn:submission-record-target')

const globalScope = globalThis as typeof globalThis & {
  [TARGET_KEY]?: RegisteredTarget | null
}

/**
 * Registers the target. The owner is the plugin whose register fn is running,
 * or the `pluginId` passed for a boot declaration; with neither, or from a
 * plugin other than the one declared, it throws. The same plugin registering
 * again replaces its target. Returns the unregister.
 */
export function registerFormRecordTarget(
  target: FormRecordTarget,
  options?: { pluginId?: string },
): () => void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'the form record target was registered with no owner: pass ' +
        '{ pluginId } when registering outside a plugin register fn',
    )
  }
  const declared = declaredFormRecordTarget()
  if (declared && declared.pluginId !== pluginId) {
    throw new Error(
      `the form record target is declared by "${declared.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  const held = globalScope[TARGET_KEY]
  if (held && held.pluginId !== pluginId) {
    throw new Error(
      `the form record target is already registered by "${held.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  const entry: RegisteredTarget = { pluginId, target }
  globalScope[TARGET_KEY] = entry
  return () => {
    if (globalScope[TARGET_KEY] === entry) globalScope[TARGET_KEY] = null
  }
}

/** The registered target with its owner, or `null`. */
export function formRecordTarget(): RegisteredTarget | null {
  return globalScope[TARGET_KEY] ?? null
}

/** Only for specs: forgets the registered target. */
export function resetFormRecordTargetForTests(): void {
  globalScope[TARGET_KEY] = null
}

/**
 * The declared target's registration was not found, even after the app's
 * declarations step ran again.
 */
export class FormRecordTargetUnavailableError extends Error {
  constructor(readonly declared: FormRecordTargetDeclaration) {
    super(
      `the form record target is declared by "${declared.pluginId}" but none ` +
        'is registered in this process — its server declarations did not run. ' +
        'Refusing to treat bound forms as writing nowhere.',
    )
    this.name = 'FormRecordTargetUnavailableError'
  }
}

/** The declared target, repaired once if missing; `null` when none is declared. */
async function requireDeclaredTarget(): Promise<FormRecordTarget | null> {
  const declared = declaredFormRecordTarget()
  if (!declared) return null
  let registered = formRecordTarget()
  if (!registered) {
    try {
      await runPluginDeclarationsRepair()
    } catch (error) {
      console.error('[submission-record-target] the declarations repair failed', error)
    }
    registered = formRecordTarget()
  }
  if (!registered) throw new FormRecordTargetUnavailableError(declared)
  return registered.target
}

const placesAForm = (nodes: Record<string, unknown>): boolean =>
  Object.values(nodes).some(
    (node) =>
      (node as { componentId?: unknown } | null)?.componentId === FORM_COMPONENT_ID,
  )

/**
 * The tree a page ships, with each form the target writes for stamped.
 *
 * A tree with no form asks nobody and comes back as the same object. A tree
 * with one THROWS when the declared target is missing — see the module note.
 */
export async function stampFormRecordTargets<N extends Record<string, unknown>>(
  nodes: N,
  hostId: string,
): Promise<N> {
  if (!placesAForm(nodes)) return nodes
  const target = await requireDeclaredTarget()
  return target ? target.stamp(nodes, hostId) : nodes
}

/**
 * Files one stored submission as a record where the page's form said to.
 *
 * Never rejects. With no target declared it answers nothing; with the declared
 * target missing it logs the failure and answers a `routing` note saying so,
 * because the submission is already kept and losing it now would be worse.
 */
export async function writeFormRecordTarget(
  request: FormRecordWriteRequest,
): Promise<FormRecordWriteOutcome> {
  let target: FormRecordTarget | null
  try {
    target = await requireDeclaredTarget()
  } catch (error) {
    console.error('[submission-record-target] a submission could not be filed', error)
    return { routing: { recordTargetUnavailable: true } }
  }
  if (!target) return {}
  try {
    return await target.write(request)
  } catch (error) {
    console.error('[submission-record-target] the target failed a write', error)
    return {}
  }
}
