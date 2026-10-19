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

/**
 * WHAT A PLUGIN LETS THE ONE-BOX SEARCH FIND, ON THE SERVER (AGL-3943).
 *
 * The console's palette reads a plugin's `ConsoleSearchSource`s in the
 * browser, through the Firestore rules. The native apps' one box asks the
 * console's `/api/search` instead, which reads with the Admin SDK, so it
 * needs the same sources in a server process that never loads a plugin's
 * console bundle. A plugin registers them here from its
 * `consoleServerDeclarations`, usually the very objects its console
 * extension lists, with the extension's own gates beside them.
 *
 * The Admin SDK bypasses the rules, so the route applies every gate itself:
 * the plugin on for the workspace and the site, the plan flag and quota, the
 * permission, the reader's host role (`hostAccess`), and each org-shared
 * row's `visibleTo` against the reader's reach.
 *
 * The core never imports a plugin; this is how its search reaches one.
 */

import type { ListQueryDeclaration } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import type { ConsoleSearchSource } from './feature-plugins'

/** A plugin's search source as the server reads it. */
export interface PluginSearchSource extends ConsoleSearchSource {
  /**
   * Who on the site may find these rows: any member (the default), or only
   * the members who may read the site's sensitive documents (admin and
   * editor, the rules' `canReadHostSensitive`), as for orders.
   */
  hostAccess?: 'member' | 'sensitive'
  /**
   * Read through the list's own query rather than a capped window: the
   * search word goes on `listQuery.search` (a stored token array), planned
   * by `planListQuery`, so the rows are the list's own matches, newest first,
   * on the index the list already uses.
   */
  listQuery?: ListQueryDeclaration
  /** The row's label when no name field says it (an order's number). */
  label?(row: Readonly<Record<string, unknown>>): string
  /** One line under the label (an order's buyer). */
  detail?(row: Readonly<Record<string, unknown>>): string | null
}

/** The gates the plugin's console extension puts on every source it lists. */
export interface PluginSearchSourceGates {
  /** The plan flag the extension needs (`ConsoleExtension.featureFlag`). */
  featureFlag?: string
  /** The permission the extension needs (`ConsoleExtension.permission`). */
  permission?: string
}

export interface RegisteredPluginSearchSource {
  pluginId: string
  gates: PluginSearchSourceGates
  source: PluginSearchSource
}

/**
 * On `globalThis` under `Symbol.for`, never at module scope (AGL-3947). The
 * sources are registered at boot, from `instrumentation.ts`, which Next
 * compiles apart from the routes, so the boot and `/api/search` each hold
 * their own copy of this module.
 */
const REGISTRY_KEY = Symbol.for('@aglyn/aglyn:plugin-search-sources')
const globalScope = globalThis as typeof globalThis & {
  [REGISTRY_KEY]?: RegisteredPluginSearchSource[]
}
const registrations: RegisteredPluginSearchSource[] =
  globalScope[REGISTRY_KEY] ?? (globalScope[REGISTRY_KEY] = [])

/**
 * Registers a plugin's server search sources. Owner = the loader's marker
 * inside a register fn, else `options.pluginId`; neither throws. Registering
 * again replaces the plugin's earlier sources, so a module evaluated twice
 * does not list a group twice.
 */
export function registerPluginSearchSources(
  sources: readonly PluginSearchSource[],
  options: PluginSearchSourceGates & { pluginId?: string } = {},
): void {
  const pluginId = (getRegisteringPluginId() ?? options.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'plugin search sources were registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  const gates: PluginSearchSourceGates = {
    ...(options.featureFlag ? { featureFlag: options.featureFlag } : {}),
    ...(options.permission ? { permission: options.permission } : {}),
  }
  for (let index = registrations.length - 1; index >= 0; index -= 1) {
    if (registrations[index].pluginId === pluginId) registrations.splice(index, 1)
  }
  for (const source of sources) {
    if (source?.id) registrations.push({ pluginId, gates, source })
  }
}

/**
 * The sources of the plugins in `enabledPluginIds` (every registered one
 * when omitted), in registration order. A second source with an id already
 * listed is dropped, as the palette drops it.
 */
export function listPluginSearchSources(
  enabledPluginIds?: readonly string[],
): RegisteredPluginSearchSource[] {
  const on = enabledPluginIds ? new Set(enabledPluginIds) : null
  const seen = new Set<string>()
  const out: RegisteredPluginSearchSource[] = []
  for (const entry of registrations) {
    if (on && !on.has(entry.pluginId)) continue
    if (seen.has(entry.source.id)) continue
    seen.add(entry.source.id)
    out.push(entry)
  }
  return out
}

/** Only for specs: forgets every source. */
export function resetPluginSearchSourcesForTests(): void {
  registrations.length = 0
}
