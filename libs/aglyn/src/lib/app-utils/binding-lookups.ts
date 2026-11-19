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

import type { EditorPluginConnections } from './plugin-connection-editor'

/**
 * The binding lookups a site's variables and functions make (AGL-3481): the
 * one copy the Besigner's save, its picker and canvas, and the server's page
 * publish (AGL-4235) all key their documents with.
 */

/** A variable or function document as the lookups read it: its id in `$id`. */
export type BindingLookupDoc = any

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

/**
 * The site's variables and functions keyed by id AND by name, deleted and
 * unnamed ones left out.
 *
 * Id keys serve `resolveBindings`, which reads nothing else (AGL-97, AGL-194).
 * Name keys serve typed-name normalization, which looks a typed `{{name}}` up
 * by its name (`normalizeBindingTokens`). Names first so an id key wins a
 * collision — the id is the reference that survives a rename.
 */
export function bindingLookupsFromDocs(
  variableDocs: readonly BindingLookupDoc[] | undefined,
  functionDocs: readonly BindingLookupDoc[] | undefined,
  connections?: EditorPluginConnections,
): { variables: Record<string, BindingLookupDoc>; functions: Record<string, BindingLookupDoc> } {
  const live = (docs: readonly BindingLookupDoc[] | undefined) =>
    (docs ?? []).filter((one) => !one?.deletedAt && one?.name)
  const keyed = (docs: readonly BindingLookupDoc[] | undefined) => {
    const map: Record<string, BindingLookupDoc> = {}
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
