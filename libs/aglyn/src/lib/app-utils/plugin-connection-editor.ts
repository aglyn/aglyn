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

import { createContext } from 'react'
import type { PluginConnectionRecordsPageData, PluginConnectionSiteRecord } from './plugin-connection-records'
import type { PluginConnectionFieldTypes } from './plugin-connection-repeat'

/*
 * DECLARED CONNECTIONS IN THE EDITOR (AGL-4196).
 *
 * A published page hands each signed element its connection's record with
 * the page (`plugin-connection-records.ts`), and binds each record's summary
 * fields as `{{var:<listingId>__<connectionId>-<field>}}`. The Besigner and
 * Preview render in the console, where there is no page render to ride, so
 * the plugin that runs the connections (the marketplace) provides THIS
 * context to every editor surface instead: which listing a component id's
 * namespace belongs to, each listing's records, and the variables the
 * records give the site. The surfaces turn it into the same
 * `PluginConnectionRecordsContext` value the published page provides, so an
 * element reads its record through the same hook, and the binding picker
 * lists the variables by name.
 *
 * Core declares the seam and never names the plugin that fills it. Absent,
 * every element reads `null` and the picker lists nothing extra: the same
 * answer as a site that has not connected.
 */

/** One `{{var:…}}` a connection's record gives the site, as the binding picker lists it. */
export interface EditorConnectionVariable {
  /** The variable id (`pluginConnectionVariableId`): what the token carries. */
  id: string
  /** What a person reads: the connection's label and the field's name, never the id. */
  label: string
  /** The value the last sync wrote, as the published page would print it, or `null` before one. */
  value: string | null
}

/**
 * One declared connection an element can repeat over (AGL-4212): what the
 * Attributes panel's picker lists, what a `repeatConnection` value's
 * identity resolves to, and the fields its `{{item.*}}` tokens can name.
 */
export interface EditorConnectionRepeatable {
  /** `<publisher handle>.<manifest id>`: what a `repeatConnection` value names. */
  identity: string
  listingId: string
  connectionId: string
  /** The connection's own label, as the site's connections card shows it. */
  label: string
  /** The declared type of each summary field and each item field. */
  types: PluginConnectionFieldTypes
}

/** What the editor knows of the site's declared connections. */
export interface EditorPluginConnections {
  /** The listing whose namespace `componentId` is in (`<identity>.<role>`), or `null`. */
  listingFor(componentId: string): string | null
  /** Listing id → connection id → the record its last sync wrote. */
  records: Readonly<Record<string, Readonly<Record<string, PluginConnectionSiteRecord>>>>
  /** Every summary field of every declared connection, as site variables. */
  variables: readonly EditorConnectionVariable[]
  /**
   * Every declared connection of a namespaced install that writes a record,
   * for a repeat over it (AGL-4212). Absent from a provider that predates it,
   * which offers no such repeat.
   */
  repeatables?: readonly EditorConnectionRepeatable[]
}

export const EditorPluginConnectionsContext = createContext<EditorPluginConnections | undefined>(undefined)
EditorPluginConnectionsContext.displayName = 'EditorPluginConnectionsContext'

/** An editor node, as far as attributing it to a listing needs. */
export interface EditorConnectionNode {
  $id?: unknown
  componentId?: unknown
}

/**
 * The `PluginConnectionRecordsContext` value for `nodes` (a page's, or one
 * element's), attributed the way the published page's enricher attributes
 * them: a node whose component id is in a listing's namespace, and only when
 * that listing holds a record. `undefined` when none is.
 */
export function editorConnectionRecordsPageData(
  connections: EditorPluginConnections | undefined,
  nodes: Iterable<EditorConnectionNode | null | undefined>,
): PluginConnectionRecordsPageData | undefined {
  if (!connections) return undefined
  const attributed: Record<string, string> = {}
  const records: PluginConnectionRecordsPageData['records'] = {}
  for (const node of nodes) {
    const nodeId = node?.$id
    const componentId = node?.componentId
    if (typeof nodeId !== 'string' || !nodeId || typeof componentId !== 'string' || !componentId.includes('.')) continue
    const listingId = connections.listingFor(componentId)
    if (!listingId) continue
    const held = connections.records[listingId]
    if (!held || !Object.keys(held).length) continue
    attributed[nodeId] = listingId
    records[listingId] = { ...held }
  }
  return Object.keys(attributed).length ? { nodes: attributed, records } : undefined
}
