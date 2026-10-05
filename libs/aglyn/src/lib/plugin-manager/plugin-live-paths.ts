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

/**
 * The addresses a plugin serves FROM a site's screens, for the cache drops a
 * publish makes (AGL-3475).
 *
 * A publish drops the cached pages it changed, and it finds them through the
 * site's routing map: screen id → address. A page a plugin serves through a
 * site page resolver is not in that map. A record template draws
 * `/services/roofing`, `/services/siding` and every other record page, yet its
 * own entry in the map is an address that serves nothing — so publishing the
 * template dropped none of the pages it draws, and each kept its old design
 * until the cache window lapsed.
 *
 * So the plugin answers: given screens being published, which addresses does
 * it serve from them; given none, which addresses does it serve on the site at
 * all (a whole-site publish). The publish routes add the answers to the paths
 * they drop. The tenant's own route caps the paths it accepts, so an answer is
 * bounded by the plugin, and a plugin that cannot answer costs the publish
 * nothing: the host's data tag, which every publish busts, still refreshes the
 * pages behind it on their next visit.
 *
 * Best effort, by design. A reader that throws is logged and skipped, because
 * the publish it rides has already succeeded.
 *
 * Reached by its own subpath, never the barrel: only server routes ask.
 */

/** What a publish asks about. */
export interface PluginLivePathsRequest {
  hostId: string
  /**
   * The screens being published. Absent asks for every address the plugin
   * serves on the site.
   */
  screenIds?: readonly string[]
}

/** Answers with site-absolute paths: `/services/roofing`. */
export type PluginLivePathsReader = (request: PluginLivePathsRequest) => Promise<string[]>

/** The most paths one reader's answer contributes to one publish. */
export const PLUGIN_LIVE_PATHS_MAX = 200

/**
 * One table per process, on `globalThis` (AGL-3412): readers register from a
 * plugin's server declarations, which run in `instrumentation.ts`, compiled
 * apart from the routes that read.
 */
const READERS_KEY = Symbol.for('@aglyn/aglyn:plugin-live-paths')

const globalScope = globalThis as typeof globalThis & {
  [READERS_KEY]?: Map<string, PluginLivePathsReader>
}

const readers: Map<string, PluginLivePathsReader> =
  globalScope[READERS_KEY] ?? (globalScope[READERS_KEY] = new Map())

/**
 * Registers a plugin's reader. The owner is the plugin whose register fn is
 * running, or `options.pluginId`; with neither it throws. A plugin registering
 * again replaces its own reader. Returns the unregister.
 */
export function registerPluginLivePaths(
  reader: PluginLivePathsReader,
  options?: { pluginId?: string },
): () => void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a live paths reader registered with no owner: pass { pluginId } when ' +
        'registering outside a plugin register fn',
    )
  }
  readers.set(pluginId, reader)
  return () => {
    if (readers.get(pluginId) === reader) readers.delete(pluginId)
  }
}

/** Only for specs: forgets every registered reader. */
export function resetPluginLivePathsForTests(): void {
  readers.clear()
}

/**
 * Every address the registered plugins serve from the request's screens —
 * site-absolute, without duplicates, at most {@link PLUGIN_LIVE_PATHS_MAX}
 * from each plugin. Never throws.
 */
export async function pluginLivePaths(request: PluginLivePathsRequest): Promise<string[]> {
  if (!request.hostId || request.screenIds?.length === 0) return []
  const answers = await Promise.all(
    [...readers.entries()].map(async ([pluginId, reader]) => {
      try {
        return (await reader(request))
          .filter((path) => typeof path === 'string' && path.startsWith('/'))
          .slice(0, PLUGIN_LIVE_PATHS_MAX)
      } catch (error) {
        console.error('[plugin-live-paths] a reader failed', pluginId, error)
        return []
      }
    }),
  )
  return [...new Set(answers.flat())]
}
