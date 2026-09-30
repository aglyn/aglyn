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
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * A plugin's records, listed and read for ANOTHER plugin (AGL-3080).
 *
 * A plugin that works over records it does not own — an AI job enriching a
 * site's products, a composer binding the products an email names — used to
 * read the owner's Firestore collection itself: the path, the field names,
 * what "deleted" looks like. That is a plugin's storage reached around the
 * plugin, invisible to `check:lib-boundaries` because a collection name is
 * not an import, and it breaks the day the owner changes a field.
 *
 * So the owner publishes an INDEX for each record kind it keeps: `list` names
 * the live records of a scope, `get` reads one — each as an id, a name and the
 * FACTS the owner chooses to share, in a shape its registration documents.
 * The reader never learns where the records are stored or what a deleted one
 * looks like; the owner answers only live records.
 *
 * Its siblings: `plugin-record-cards` (how one record LOOKS, for a campaign
 * sender) and `plugin-record-facts` (what a record SAYS, for a summary);
 * `plugin-resource-drafts` is the WRITE side. This is the side that finds and
 * reads records to work on.
 *
 * ## Not registered is an answer
 *
 * No index for a kind means no plugin keeps it in this process — the owner is
 * not installed, or not loaded. A reader treats that as "none here" and says
 * so, rather than reaching for the collection itself. Registered from the
 * owner's server declarations, so every server process that boots the
 * declarations has it.
 *
 * ## One index per kind
 *
 * A second plugin registering an index for a kind another plugin already
 * keeps is refused, naming both, and the incumbent keeps serving.
 */

/** One record, as its owner shares it. */
export interface PluginIndexedRecord {
  id: string
  /** What a person calls it. Never empty: the owner leaves an unnamed record out. */
  name: string
  /** What else the owner shares, in the shape its registration documents. */
  facts: Readonly<Record<string, unknown>>
}

/** Which records a reader asks about. */
export interface PluginRecordIndexScope {
  /** The organization the records belong to, where the kind is org-scoped. */
  orgId?: string | null
  /** The site the records belong to, where the kind is site-scoped. */
  hostId?: string | null
}

export interface PluginRecordIndex {
  /**
   * The live records of the scope, at most `limit`, in the owner's order.
   * `truncated` says the scope holds more than were answered.
   */
  list(
    request: PluginRecordIndexScope & { limit: number },
  ): Promise<{ records: PluginIndexedRecord[]; truncated: boolean }>
  /** One live record, or `null` — gone, deleted, or not the scope's. */
  get(request: PluginRecordIndexScope & { id: string }): Promise<PluginIndexedRecord | null>
}

export const PLUGIN_RECORD_INDEXES = definePluginServiceContract<PluginRecordIndex>(
  'core.record-index',
  { multiple: true },
)

/**
 * Publishes the index for one record kind. The owner is the loader's marker
 * when a register fn is running, else `options.pluginId`; with neither the
 * registration throws. A kind another plugin keeps throws naming both.
 */
export function registerPluginRecordIndex(
  kind: string,
  index: PluginRecordIndex,
  options?: { pluginId?: string },
): void {
  const key = kind.trim()
  if (!key) throw new Error('a record index needs a record kind')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(`the record index for "${key}" was registered with no owner`)
  }
  const incumbent = resolvePluginServices(PLUGIN_RECORD_INDEXES).find(
    (entry) => entry.key === key,
  )
  if (incumbent && incumbent.pluginId !== pluginId) {
    throw new Error(
      `record kind "${key}" is already indexed by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_RECORD_INDEXES, index, { pluginId, key })
}

/** The index for a kind, with the plugin that keeps it, or `null` when none does here. */
export function pluginRecordIndex(
  kind: string,
): { pluginId: string; index: PluginRecordIndex } | null {
  const key = kind.trim()
  const entry = resolvePluginServices(PLUGIN_RECORD_INDEXES).find((one) => one.key === key)
  return entry ? { pluginId: entry.pluginId, index: entry.impl } : null
}
