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

import type { DocumentData, Firestore, Query } from 'firebase/firestore'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * How many of a plugin's records one site produced, COUNTED in the console
 * for another plugin's figure (AGL-3080) — the count's half of
 * `plugin-record-lists`.
 *
 * A plugin that reports a share of another plugin's records — a campaign's
 * conversions out of every form submission, booking, lead or contact the site
 * holds — used to count the owner's collection from the browser itself: the
 * path, which ones a site may be credited with, the filter the owner's
 * security rules require. Each breaks the day the owner changes one.
 *
 * So the owner publishes a COUNT SOURCE for each record kind it keeps: the
 * query whose aggregate count is how many records of the kind one site
 * produced, provable by the signed-in member's read. The reader runs its own
 * aggregation over it (`getCountFromServer`) and never learns where the
 * records are stored. Which records a site "produced" is the owner's to say:
 * a site's own submissions, the leads it captured, or — for a kind the
 * organization holds once for all its sites — every one, which the reader
 * must then present as a total across sites.
 *
 * ## Not registered is an answer
 *
 * No source for a kind means no plugin keeps it in this console. A reader
 * withholds the figure rather than counting the collection itself.
 *
 * One source per kind; a second plugin claiming a kind another counts is
 * refused, naming both.
 */

/** Which site's records a reader counts. */
export interface PluginRecordCountRequest {
  hostId: string
  /** The site's organization, where the kind is held by the organization. */
  orgId?: string | null
}

export interface PluginRecordCountSource {
  /**
   * The query whose count is how many records of the kind the site
   * produced, or `null` where the site has none to count (an organization
   * not yet resolved).
   */
  query(firestore: Firestore, request: PluginRecordCountRequest): Query<DocumentData> | null
  /**
   * Whether the count is the ORGANIZATION's, shared by every site in it,
   * rather than this site's alone — a reader dividing a site's figure by it
   * must say the total crosses sites.
   */
  crossesSites?: boolean
}

export const PLUGIN_RECORD_COUNTS = definePluginServiceContract<PluginRecordCountSource>(
  'core.record-counts',
  { multiple: true },
)

/**
 * Publishes the count source for one record kind. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`; with neither
 * the registration throws. A kind another plugin counts throws naming both.
 */
export function registerPluginRecordCountSource(
  kind: string,
  source: PluginRecordCountSource,
  options?: { pluginId?: string },
): void {
  const key = kind.trim()
  if (!key) throw new Error('a record count source needs a record kind')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(`the record count source for "${key}" was registered with no owner`)
  }
  const incumbent = resolvePluginServices(PLUGIN_RECORD_COUNTS).find((entry) => entry.key === key)
  if (incumbent && incumbent.pluginId !== pluginId) {
    throw new Error(
      `record kind "${key}" is already counted by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_RECORD_COUNTS, source, { pluginId, key })
}

/** The count source for a kind, or `null` when no plugin counts it here. */
export function pluginRecordCountSource(kind: string): PluginRecordCountSource | null {
  const key = kind.trim()
  return resolvePluginServices(PLUGIN_RECORD_COUNTS).find((one) => one.key === key)?.impl ?? null
}
