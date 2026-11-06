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
'use client'

import {
  EditorPluginConnectionsContext,
  type EditorPluginConnections,
} from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import type { CanvasBindingLookups } from '@aglyn/besigner-ui'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, limit, query } from 'firebase/firestore'
import { useContext, useMemo } from 'react'
import useFirestoreCollection from './use-firestore-collection'

/**
 * A site's variable and function documents, as the Besigner reads them for
 * bindings: the insert picker, the canvas's live values and the save that
 * converts typed names (AGL-3481).
 *
 * One pair of queries for all three, so they cannot disagree about which
 * variables exist — and the Firestore SDK shares one listener per identical
 * query, so an editor that reads them here and through the picker pays for
 * one listen, not two.
 */
export function useHostBindingDocs(hostId: string) {
  const firestore = useFirestore()
  const variables = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'variables'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const functions = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'functions'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  return {
    variableDocs: variables.data,
    functionDocs: functions.data,
    loaded: variables.status === 'success' && functions.status === 'success',
  }
}

/**
 * The site's variables and functions keyed by id AND by name, deleted and
 * unnamed ones left out.
 *
 * Id keys serve `resolveBindings`, which reads nothing else (AGL-97, AGL-194).
 * Name keys serve typed-name normalization, which looks a typed `{{name}}` up
 * by its name (`normalizeBindingTokens`). Names first so an id key wins a
 * collision — the id is the reference that survives a rename.
 */
/**
 * The variables a site's declared plugin connections give it (AGL-4196), as
 * documents the lookups read like the site's own: keyed by the
 * `{{var:<listingId>__<connectionId>-<field>}}` id, named for a person (the
 * connection's label and the field), holding what the last sync wrote. The
 * canvas then prints the value the published page will, and a bound token
 * reads by its name rather than its id.
 */
export function connectionVariableDocs(
  connections: EditorPluginConnections | undefined,
): Array<{ $id: string; name: string; value: string; connection: true }> {
  return (connections?.variables ?? []).map((variable) => ({
    $id: variable.id,
    name: variable.label,
    value: variable.value ?? '',
    connection: true,
  }))
}

export function bindingLookupsFromDocs(
  variableDocs: readonly any[] | undefined,
  functionDocs: readonly any[] | undefined,
  connections?: EditorPluginConnections,
): { variables: Record<string, any>; functions: Record<string, any> } {
  const live = (docs: readonly any[] | undefined) =>
    (docs ?? []).filter((one) => !one?.deletedAt && one?.name)
  const keyed = (docs: readonly any[] | undefined) => {
    const map: Record<string, any> = {}
    for (const one of live(docs)) map[one.name] = one
    for (const one of live(docs)) map[one.$id] = one
    return map
  }
  // The connections' first, so a site variable that happens to share a name
  // keeps it; their ids can never be a site's own (`pluginConnectionVariableId`).
  return {
    variables: keyed([...connectionVariableDocs(connections), ...(variableDocs ?? [])]),
    functions: keyed(functionDocs),
  }
}

/**
 * The lookups every Besigner save converts typed names against
 * (`useBesignerDocument`'s `bindingLookups`, AGL-3481), or `null` until both
 * lists have loaded — a save before then keeps its tokens as typed rather
 * than reading an empty list as "this site has no variables".
 */
export function useBindingTokenLookups(
  hostId: string,
): CanvasBindingLookups | null {
  const { variableDocs, functionDocs, loaded } = useHostBindingDocs(hostId)
  const connections = useContext(EditorPluginConnectionsContext)
  return useMemo(
    () => (loaded ? bindingLookupsFromDocs(variableDocs, functionDocs, connections) : null),
    [loaded, variableDocs, functionDocs, connections],
  )
}

export default useBindingTokenLookups
