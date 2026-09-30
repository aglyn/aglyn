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

import type { RepeatableDataset } from '../app-utils/expand-repeatables'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import { PLUGIN_REPEAT_SOURCE_DECLARED } from './first-party-plugins.generated'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * WHERE A PUBLISHED PAGE'S REPEATED ROWS COME FROM (AGL-3080).
 *
 * Any element can repeat, and the platform decides what a repeat MEANS — the
 * scope, the copies, the filter, the bound (`expand-repeatables.ts`). What it
 * does not decide is where the rows live. That is the plugin's that keeps
 * them, and the composition that renders a published page asks it here, with
 * the keys the page's tree repeats over, and never reads a collection itself.
 *
 * `repeat-sources.ts` is the editor's side of the same line: a hook the
 * besigner's canvas mounts to preview the rows. This is the server's side,
 * read once per compose, and it is a different registry because its readers
 * are different processes with different failure costs.
 *
 * ## Declared, then registered — and an absent reader is refused
 *
 * The reader is registered from the owning plugin's `serverDeclarations`
 * entry, which every app runs at boot, so every process that composes a page
 * has it before the first request. But a registry is only safe where an empty
 * one cannot be mistaken for an answer, and here it can: a page whose repeat
 * found no reader would render the template once where the author put a list,
 * and nothing anywhere would be red. That is the AGL-3025 shape on the most
 * public surface the product has.
 *
 * So the plugin that answers also DECLARES that it does, in
 * `plugins.config.json` (`repeatSource`), and the generator compiles that into
 * core. The two together tell the one case that is a real answer from the one
 * that is a broken boot:
 *
 * - nothing declared — this deployment ships no plugin that keeps rows, and a
 *   repeat renders its element once, as written, exactly as a key naming
 *   nothing does;
 * - declared and registered — the reader answers;
 * - declared and NOT registered — the boot failed. The app's declarations
 *   step is run again ({@link runPluginDeclarationsRepair}); if the reader is
 *   still missing, {@link readRepeatRows} THROWS. A render that throws keeps
 *   the page it last rendered in the cache and is loud in the logs, which is
 *   the right way round for a page that would otherwise go out wrong.
 *
 * Per-key failures are the reader's to absorb, as they always were: a deleted
 * or unreadable entry leaves its element rendering once and costs the page
 * nothing else.
 *
 * Reached by path, never through a barrel: only the server composition asks.
 */

/** One composition's question: the keys a page's tree repeats over. */
export interface RepeatRowsRequest {
  /** The site being rendered. A reader answers only what that site may see. */
  hostId: string
  /**
   * The keys exactly as the nodes store them (`repeatKeys`), trimmed,
   * sorted and without repeats.
   */
  keys: readonly string[]
}

/**
 * The rows for a request, under every key the expansion looks them up by: the
 * key as the node stores it, the entry's own id, and each entry a one-hop
 * reference in the rows reads. A key with nothing to render is absent.
 */
export type RepeatRowsAnswer = Record<string, RepeatableDataset>

/** Answers one composition's request. Never rejects for a single bad key. */
export type RepeatRowReader = (
  request: RepeatRowsRequest,
) => Promise<RepeatRowsAnswer>

/** The compiled declaration: which plugin answers, under which source id. */
export interface RepeatSourceDeclaration {
  pluginId: string
  /** The same id the plugin's editor source (`repeat-sources.ts`) uses. */
  id: string
}

/** The plugin declared to answer repeats, or `null` when none is. */
export function declaredRepeatSource(): RepeatSourceDeclaration | null {
  return PLUGIN_REPEAT_SOURCE_DECLARED
}

interface RegisteredReader {
  pluginId: string
  reader: RepeatRowReader
}

/**
 * One table per process, on `globalThis` (AGL-3412): the app registers from
 * `instrumentation.ts`, which Next compiles apart from the routes that read,
 * and a module-scoped map would be filled in one copy and read empty in the
 * other — the exact failure this module exists to refuse.
 */
const READERS_KEY = Symbol.for('@aglyn/aglyn:repeat-row-readers')

const globalScope = globalThis as typeof globalThis & {
  [READERS_KEY]?: Map<string, RegisteredReader>
}

const readers: Map<string, RegisteredReader> =
  globalScope[READERS_KEY] ?? (globalScope[READERS_KEY] = new Map())

/**
 * Registers the reader for a source. Returns the unregister, which removes it
 * only while it is still the one registered.
 *
 * The owner is the plugin whose register fn is running, or the `pluginId`
 * passed for a boot declaration, where the loader's marker is not set. A
 * registration with neither is refused, and so is one from a plugin other
 * than the one the declaration names — two readers for one source would each
 * answer for the other's rows. The same plugin registering again replaces its
 * reader (a second surface, a repeated boot).
 */
export function registerRepeatRowReader(
  sourceId: string,
  reader: RepeatRowReader,
  options?: { pluginId?: string },
): () => void {
  const id = sourceId.trim()
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!id) throw new Error('a repeat row reader needs a source id')
  if (!pluginId) {
    throw new Error(
      `repeat row reader "${id}" registered with no owner: pass { pluginId } ` +
        'when registering outside a plugin register fn',
    )
  }
  const declared = declaredRepeatSource()
  if (declared?.id === id && declared.pluginId !== pluginId) {
    throw new Error(
      `repeat source "${id}" is declared by "${declared.pluginId}"; ` +
        `refused a reader from "${pluginId}"`,
    )
  }
  const held = readers.get(id)
  if (held && held.pluginId !== pluginId) {
    throw new Error(
      `repeat source "${id}" already has a reader from "${held.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  const entry: RegisteredReader = { pluginId, reader }
  readers.set(id, entry)
  return () => {
    if (readers.get(id) === entry) readers.delete(id)
  }
}

/** The reader registered for a source, with its owner, or `null`. */
export function repeatRowReader(sourceId: string): RegisteredReader | null {
  return readers.get(sourceId) ?? null
}

/** Only for specs: forgets every registered reader. */
export function resetRepeatRowReadersForTests(): void {
  readers.clear()
}

/**
 * The declared source's reader was not registered, even after the app's
 * declarations step ran again. Thrown, never answered: see the module note.
 */
export class RepeatRowsUnavailableError extends Error {
  constructor(readonly source: RepeatSourceDeclaration) {
    super(
      `repeat source "${source.id}" is declared by "${source.pluginId}" but ` +
        'no reader is registered in this process — its server declarations ' +
        'did not run. Refusing to render repeats as if they had no rows.',
    )
    this.name = 'RepeatRowsUnavailableError'
  }
}

/**
 * The rows a composition's repeats render. See the module note for what each
 * of the three cases answers; with no keys it answers `{}` and asks nobody.
 */
export async function readRepeatRows(
  request: RepeatRowsRequest,
): Promise<RepeatRowsAnswer> {
  const keys = [
    ...new Set(request.keys.map((key) => key.trim()).filter(Boolean)),
  ].sort()
  if (!keys.length) return {}
  const declared = declaredRepeatSource()
  if (!declared) return {}
  let registered = readers.get(declared.id)
  if (!registered) {
    try {
      await runPluginDeclarationsRepair()
    } catch (error) {
      console.error('[repeat-rows] the declarations repair failed', error)
    }
    registered = readers.get(declared.id)
  }
  if (!registered) throw new RepeatRowsUnavailableError(declared)
  return registered.reader({ hostId: request.hostId, keys })
}
