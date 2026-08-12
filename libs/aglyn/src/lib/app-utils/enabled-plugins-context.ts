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

import { createContext, useContext } from 'react'

/**
 * The EDITOR's view of per-site plugin enablement (AGL-1014).
 *
 * `enabledPlugins` is a boundary, not a preference, and the issue names four
 * surfaces that must enforce it identically: console navigation, the editor,
 * published sites, and API dispatch. The other three read
 * `resolveHostEnabledPlugins` on the server or subtract the deny-list in the
 * console shell. This context is how the same answer reaches the besigner —
 * the host app resolves it (only it can read an org and a host) and publishes
 * it; the designer stays storage-agnostic.
 *
 * It has to be a READ-TIME filter rather than a narrower load. The preset
 * registry is a module-global union that only ever grows: `consolePluginLoader`
 * never unloads a bundle, and a plugin whose site components registered while
 * editing site A goes on offering palette entries on site B. Loading less
 * cannot un-register what is already there, so the component drawer filters
 * every entry against this set instead.
 *
 * `undefined` means no set was supplied and leaves consumers unfiltered — the
 * same opt-in shape `listConsoleExtensions` uses, so surfaces with no host
 * (the platform email editor, tests) behave exactly as before.
 */
export const EnabledPluginsContext = createContext<
  readonly string[] | undefined
>(undefined)
EnabledPluginsContext.displayName = 'EnabledPluginsContext'

/** The edited site's effective plugin ids, or undefined where none is set. */
export function useEnabledPlugins(): readonly string[] | undefined {
  return useContext(EnabledPluginsContext)
}

/**
 * Whether a registry entry's owning plugin runs on the site being edited.
 *
 * An entry with no `pluginId` belongs to no plugin, so no deny-list entry can
 * name it and it passes; so does everything when no set was supplied.
 */
export function isFromEnabledPlugin(
  item: { pluginId?: string } | undefined,
  enabledPluginIds: readonly string[] | undefined,
): boolean {
  if (!enabledPluginIds) return true
  const pluginId = item?.pluginId
  return !pluginId || enabledPluginIds.includes(pluginId)
}

export default EnabledPluginsContext
