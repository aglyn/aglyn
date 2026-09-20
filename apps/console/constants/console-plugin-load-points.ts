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

import { isPluginUsedInConsole, type ConsoleLoadWhere } from '@aglyn/aglyn'
import { CONSOLE_PLUGIN_MANIFEST } from './plugins.client.generated'

/**
 * Which of a workspace's plugins belong at a place in the console (AGL-3142).
 *
 * The console used to load every enabled plugin with the shell, so a
 * workspace that had installed one paid for its console code on every screen
 * — the plugins hub, the billing pages, the besigner — whether or not
 * anything there drew it. Each place now asks for what it draws, and the
 * answer comes from each plugin's own declaration, carried on its manifest
 * entry: no screen names a plugin, and adding one to the catalog changes no
 * screen.
 *
 * Always a subset of `enabledPluginIds`, in that list's order, so this can
 * never load a plugin the workspace has switched off. A plugin the manifest
 * does not list is a realm install, which has a declaration of its own and is
 * placed by {@link isPluginUsedInConsole} directly — never silently dropped
 * here.
 */
export function consolePluginsAt(
  enabledPluginIds: readonly string[],
  where: ConsoleLoadWhere,
): string[] {
  return enabledPluginIds.filter(
    (id) =>
      DECLARED.has(id) && isPluginUsedInConsole(DECLARED.get(id), where),
  )
}

/**
 * Each manifest plugin's declaration, read once.
 *
 * Every zone on a screen resolves its plugins on every render — the host
 * dashboard mounts four — so this is a lookup rather than a scan.
 */
const DECLARED = new Map(
  CONSOLE_PLUGIN_MANIFEST.map((entry) => [entry.id, entry.contributes]),
)

/**
 * A stable cache key for a set of plugin ids, for the effects that load them.
 *
 * Sorted, because the same set asked for in two orders is one load: the
 * loader keys its own memo the same way, and an effect that re-ran on order
 * alone would register nothing and still re-render everything under it.
 */
export function consolePluginsKey(ids: readonly string[]): string {
  return [...ids].sort().join(',')
}
