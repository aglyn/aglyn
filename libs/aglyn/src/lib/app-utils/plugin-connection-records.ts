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


/*
 * WHAT A SIGNED PLUGIN'S ELEMENT READS OF ITS DECLARED CONNECTION (AGL-4195).
 *
 * A marketplace plugin declares a connection in its manifest
 * (`plugin-connections.ts`); the platform runs it and keeps, per site, the
 * small public record the declared sync last mapped. The element shows that
 * record. It never fetches it: the page's server enricher (the distributing
 * plugin's) reads the records of the elements on the page and hands them
 * over as one page prop, so the element renders in the page's HTML.
 *
 * The prop is keyed by ELEMENT, not by plugin: `nodes` names, for each node
 * id of a signed element on the page, the listing whose namespace owns it,
 * and `records` holds each of those listings' records by connection id. The
 * hook (`usePluginConnectionRecord`) looks up the asking element's own node
 * (`RealmElementNodeContext`, provided by the renderer, not the bundle), so
 * an element is only ever handed its own listing's record: the cross-listing
 * read the contract forbids has no key to ask with.
 *
 * Nothing here is on the realm host surface: only the hook is. A bundle
 * cannot provide this context, or read the map whole.
 */

/** One value of a record, as the declaration typed it (`datetime` is epoch ms). */
export type PluginConnectionRecordValue = string | number | boolean | null

/** What an element is handed: the record its connection's last sync wrote for this site. */
export interface PluginConnectionSiteRecord {
  /** The declared summary fields (`sync.record.fields`). */
  fields: Record<string, PluginConnectionRecordValue>
  /** The declared list (`sync.record.items`), already capped to its `maxItems`. */
  items: Array<Record<string, PluginConnectionRecordValue>>
  /** When the sync that wrote it finished, epoch ms. */
  syncedAtMs: number
}

/** The page prop the records ride on, from the enricher to the page's provider. */
export const PLUGIN_CONNECTION_RECORDS_PROP = 'pluginConnectionRecords'

/** The page prop: which listing owns each signed element on the page, and each listing's records. */
export interface PluginConnectionRecordsPageData {
  /** Node id of a signed element → the listing whose namespace it is in. */
  nodes: Record<string, string>
  /** Listing id → connection id → record. */
  records: Record<string, Record<string, PluginConnectionSiteRecord>>
}

const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

/**
 * The record `nodeId`'s own listing holds for `connectionId`, or `null`.
 * `null` for a node the page does not attribute to a listing, a listing with
 * no record for that connection, and every malformed input.
 */
export function pluginConnectionRecordFor(
  data: PluginConnectionRecordsPageData | null | undefined,
  nodeId: string | null | undefined,
  connectionId: string,
): PluginConnectionSiteRecord | null {
  if (!data || !nodeId || typeof connectionId !== 'string' || !connectionId) return null
  const nodes = data.nodes
  const records = data.records
  if (!nodes || typeof nodes !== 'object' || !records || typeof records !== 'object') return null
  if (!own(nodes, nodeId)) return null
  const listingId = nodes[nodeId]
  if (typeof listingId !== 'string' || !own(records, listingId)) return null
  const byConnection = records[listingId]
  if (!byConnection || typeof byConnection !== 'object' || !own(byConnection, connectionId)) return null
  return byConnection[connectionId] ?? null
}
