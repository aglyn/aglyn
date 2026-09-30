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

import type { BindingRefVia } from '../app-utils/binding-tokens'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * WHAT DEPENDS ON A THING, answered by the plugins whose records refer to it.
 *
 * The "Used by" scan (`/api/hosts/where-used`) tells a person what they would
 * break by deleting or renaming one of a site's things — a variable, a
 * function, a workflow. What refers to it from a published page is the
 * platform's to find: the scan reads the published screens and layouts
 * itself. What refers to it from inside a plugin's records — a step that
 * calls a function, a variable whose value is computed from somewhere else —
 * is that plugin's: its storage, its field names, and its rule for what
 * counts as a reference.
 *
 * So a plugin that keeps referring records registers a DEPENDENTS SOURCE: the
 * kinds of thing it finds references to, and a `find` that answers the
 * referring records of one site. The scan asks every source registered for
 * the kind and lists what they answer beside its own findings. That is also
 * how one plugin learns what another plugin's records need of its own: the
 * owner of a thing asks the scan, and whichever plugin keeps the references
 * answers, with neither importing the other.
 *
 * Its siblings: `plugin-record-index` lists a plugin's records for another
 * surface to work on; this answers which of them point at something.
 *
 * ## Not registered is an answer; failing is not
 *
 * No source for a kind means no plugin keeps records that refer to one in
 * this process, and the answer is complete. A source that THROWS is a scan
 * that did not finish: its answer is marked incomplete, exactly as a scan
 * that stopped at its read cap is, so "nothing uses this" is never said on
 * the strength of a reader that failed.
 */

/** One record that refers to the thing asked about. */
export interface PluginDependent {
  /** What kind of record refers to it, in the words the scan lists it under ("variable"). */
  type: string
  id: string
  /** What a person calls it. */
  name: string
  /**
   * How it refers: `id` survives a rename, `name` is a name reference a
   * rename breaks. Both when the record carries both and both match.
   */
  via: BindingRefVia[]
}

/** The thing a scan asks about, on one site. */
export interface PluginDependentsRequest {
  hostId: string
  /** What kind of thing it is: "function", "workflow". */
  kind: string
  /** Its document id. */
  id: string
  /** Its current name, for records that refer to it by name. */
  name?: string
}

export interface PluginDependentsAnswer {
  dependents: PluginDependent[]
  /** The source read less than all of its records, so more may refer to it. */
  truncated: boolean
}

export interface PluginDependentsSource {
  /** The kinds of thing this source finds references to. */
  kinds: readonly string[]
  find(request: PluginDependentsRequest): Promise<PluginDependentsAnswer>
}

export const PLUGIN_DEPENDENTS_SOURCES = definePluginServiceContract<PluginDependentsSource>(
  'core.dependents-source',
  { multiple: true },
)

/**
 * Registers a plugin's dependents source. The owner is the loader's marker
 * when a register fn is running, else `options.pluginId`; with neither the
 * registration throws. A plugin registering several sources tells them apart
 * with `key`; registering the same key again replaces it in place.
 */
export function registerPluginDependentsSource(
  source: PluginDependentsSource,
  options?: { pluginId?: string; key?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error('a dependents source was registered with no owner')
  }
  const kinds = source.kinds.map((kind) => kind.trim()).filter(Boolean)
  if (!kinds.length) {
    throw new Error(`the dependents source of "${pluginId}" names no kind it answers for`)
  }
  registerPluginService(PLUGIN_DEPENDENTS_SOURCES, source, {
    pluginId,
    key: options?.key ?? kinds.join(','),
  })
}

/**
 * Every dependent the registered sources answer for one thing, in
 * registration order, and whether the answer is COMPLETE: `false` when any
 * source read only part of its records or failed to answer at all.
 */
export async function findPluginDependents(
  request: PluginDependentsRequest,
): Promise<{ dependents: PluginDependent[]; complete: boolean }> {
  const kind = request.kind.trim()
  const sources = resolvePluginServices(PLUGIN_DEPENDENTS_SOURCES).filter((entry) =>
    entry.impl.kinds.some((one) => one.trim() === kind),
  )
  const answers = await Promise.all(
    sources.map(async ({ pluginId, impl }) => {
      try {
        return await impl.find({ ...request, kind })
      } catch (error) {
        console.error(`dependents source of "${pluginId}" failed for a ${kind}`, error)
        return null
      }
    }),
  )
  const dependents: PluginDependent[] = []
  let complete = true
  for (const answer of answers) {
    if (!answer) {
      complete = false
      continue
    }
    if (answer.truncated) complete = false
    dependents.push(...answer.dependents)
  }
  return { dependents, complete }
}
