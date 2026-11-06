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

import type {
  EditorConnectionVariable,
  EditorPluginConnections,
} from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import type { PluginConnectionSiteRecord } from '@aglyn/aglyn/app-utils/plugin-connection-records'
import {
  pluginConnectionRecordVariables,
  pluginConnectionVariableId,
  validatePluginConnections,
  type PluginConnectionDeclaration,
} from '@aglyn/aglyn/app-utils/plugin-connections'

/*
 * WHAT THE EDITOR IS HANDED OF A SITE'S DECLARED CONNECTIONS (AGL-4196).
 *
 * Pure: the provider reads the site's realm installs, their pins and the
 * records, and this turns them into core's `EditorPluginConnections`, the
 * same attribution and the same variables the published page gets.
 */

/** A realm install as far as the editor needs it: the listing and its namespace. */
export interface EditorRealmInstall {
  listingId: string
  identity?: string
}

/** One installed listing's declared connections that sync, from its pin. */
export interface EditorListingConnections {
  listingId: string
  connections: PluginConnectionDeclaration[]
}

/** The connections a pin's manifest declares that run a sync: only those write a record. */
export function syncingConnectionsOf(manifest: unknown): PluginConnectionDeclaration[] {
  const verdict = validatePluginConnections((manifest as { connections?: unknown } | null | undefined)?.connections)
  return verdict.ok ? verdict.value.filter((connection) => Boolean(connection.sync)) : []
}

/** A declared field name as a person reads it: `reviewCount` → `Review count`. */
export function connectionFieldLabel(field: string): string {
  const words = field
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : field
}

/** The listing whose namespace `componentId` is in, longest identity first. */
export function listingForComponent(installs: readonly EditorRealmInstall[]): (componentId: string) => string | null {
  const namespaces = installs
    .filter((install) => typeof install.identity === 'string' && install.identity)
    .map((install) => ({ prefix: `${install.identity}.`, listingId: install.listingId }))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  return (componentId) => namespaces.find((one) => componentId.startsWith(one.prefix))?.listingId ?? null
}

/**
 * Core's `EditorPluginConnections` for a site: which listing a component is
 * whose, each listing's records, and one variable per declared summary
 * field, named for a person and holding what the last sync wrote (or `null`
 * before one, so an author can bind it before the first sync).
 */
export function editorPluginConnections(input: {
  installs: readonly EditorRealmInstall[]
  listings: readonly EditorListingConnections[]
  records: Readonly<Record<string, Readonly<Record<string, PluginConnectionSiteRecord>>>>
}): EditorPluginConnections {
  const variables: EditorConnectionVariable[] = []
  for (const listing of input.listings) {
    for (const connection of listing.connections) {
      const record = input.records[listing.listingId]?.[connection.id]
      const values = pluginConnectionRecordVariables(listing.listingId, connection, record?.fields)
      for (const field of Object.keys(connection.sync?.record.fields ?? {})) {
        const id = pluginConnectionVariableId(listing.listingId, connection.id, field)
        if (!id) continue
        variables.push({ id, label: `${connection.label}: ${connectionFieldLabel(field)}`, value: values[id]?.value ?? null })
      }
    }
  }
  return { listingFor: listingForComponent(input.installs), records: input.records, variables }
}
