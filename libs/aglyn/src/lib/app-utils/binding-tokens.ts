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
 * Binding token grammar (AGL-185) — the single source of truth for what a
 * binding token looks like, shared by the besigner editor, the console
 * binding picker, and the tenant renderer.
 *
 * Two generations coexist:
 * - id tokens: `{{var:variableId}}` and `{{fn:functionId(args)}}` — the
 *   reference survives renames because only the display name changes.
 * - legacy name tokens: `{{name}}` and `{{fn:name(args)}}` — resolved as a
 *   fallback until AGL-188 migrates stored content.
 *
 * Resolution maps are therefore double-keyed (doc id AND name → same doc);
 * id entries are written last so an id match wins if the two ever collide.
 */

/** Firestore doc ids and legacy binding names both fit this shape. */
const REF = '[a-zA-Z0-9_-]{1,64}'

/** `{{var:variableId}}` — capture group 1 is the variable's doc id. */
export const VARIABLE_ID_TOKEN_PATTERN = new RegExp(
  `\\{\\{\\s*var:(${REF})\\s*\\}\\}`,
  'g',
)

/**
 * `{{fn:ref(args)}}` — capture 1 is a function doc id OR legacy name,
 * capture 2 the raw argument list. One pattern serves both generations;
 * lookup order (id first, then name) decides what the ref means.
 */
export const FUNCTION_TOKEN_PATTERN = new RegExp(
  `\\{\\{\\s*fn:(${REF}(?: ${REF})*)\\s*\\(([^)]*)\\)\\s*\\}\\}`,
  'g',
)

/** Legacy `{{name}}` — names never contain `:`, so `var:`/`fn:` can't match. */
export const NAME_TOKEN_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]{0,39})\s*\}\}/g

/** Renders the id-form variable token the picker inserts (AGL-186). */
export function formatVariableIdToken(variableId: string): string {
  return `{{var:${variableId}}}`
}

/** Renders the id-form function token with its parameter placeholders. */
export function formatFunctionIdToken(
  functionId: string,
  parameterNames: string[] = [],
): string {
  return `{{fn:${functionId}(${parameterNames.join(', ')})}}`
}

/**
 * Double-keys resource docs by id and name so one map serves both token
 * generations. Name entries are written first; id entries last, so an id
 * lookup wins on a (pathological) name/id collision.
 */
export function keyByIdAndName<T extends { name?: string }>(
  docs: Array<T & { id: string }>,
): Record<string, T> {
  const map: Record<string, T> = {}
  for (const { id: _id, ...doc } of docs) {
    if (doc.name) map[doc.name] = doc as T
  }
  for (const { id, ...doc } of docs) {
    map[id] = doc as T
  }
  return map
}

/**
 * Doc shape the editor-side helpers need: consoles pass Firestore docs
 * that carry their id as `$id` (reactfire idField) beside the name.
 */
export interface BindingDocRef {
  name?: string
  $id?: string
  parameters?: Array<{ name: string }>
}

/**
 * Rewrites legacy name tokens to their id forms when the name matches a
 * known doc (AGL-186 typing normalization): hand-typed `{{Message}}`
 * becomes `{{var:abc123}}` at save so it survives renames. Unknown names
 * are left alone — the variable may be created later, and legacy
 * resolution still covers them meanwhile.
 */
export function normalizeBindingTokens(
  text: string,
  variables: Record<string, BindingDocRef> = {},
  functions: Record<string, BindingDocRef> = {},
): string {
  const withFunctions = text.replace(
    FUNCTION_TOKEN_PATTERN,
    (token, ref, rawArgs) => {
      const definition = functions[String(ref).trim()]
      // Already an id (the ref maps to a doc whose $id is the ref itself)
      // or unknown: leave as-is.
      if (!definition?.$id || definition.$id === String(ref).trim()) {
        return token
      }
      return `{{fn:${definition.$id}(${String(rawArgs)})}}`
    },
  )
  return withFunctions.replace(NAME_TOKEN_PATTERN, (token, name) => {
    const variable = variables[name]
    return variable?.$id ? formatVariableIdToken(variable.$id) : token
  })
}

/** A variable/function referent to search for in stored content. */
export interface BindingRef {
  kind: 'variable' | 'function'
  /** Firestore doc id — matches id-form tokens. */
  id?: string
  /** Current name — matches legacy name-form tokens. */
  name?: string
}

/** How a dependent references the binding: rename-safe id or legacy name. */
export type BindingRefVia = 'id' | 'name'

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Which token generation(s) in `text` reference the given binding
 * (AGL-187 where-used). Returns matches so callers can distinguish
 * rename-safe id references from legacy name references — a rename only
 * endangers the latter.
 */
export function textReferencesBinding(
  text: string,
  ref: BindingRef,
): BindingRefVia[] {
  const via: BindingRefVia[] = []
  if (ref.kind === 'variable') {
    if (
      ref.id &&
      new RegExp(`\\{\\{\\s*var:${escapeRegExp(ref.id)}\\s*\\}\\}`).test(text)
    ) {
      via.push('id')
    }
    if (
      ref.name &&
      new RegExp(`\\{\\{\\s*${escapeRegExp(ref.name)}\\s*\\}\\}`).test(text)
    ) {
      via.push('name')
    }
  } else {
    if (
      ref.id &&
      new RegExp(`\\{\\{\\s*fn:${escapeRegExp(ref.id)}\\s*\\(`).test(text)
    ) {
      via.push('id')
    }
    if (
      ref.name &&
      new RegExp(`\\{\\{\\s*fn:${escapeRegExp(ref.name)}\\s*\\(`).test(text)
    ) {
      via.push('name')
    }
  }
  return via
}

/**
 * Scans a normalized nodes map's string props for references to the
 * binding; returns the union of match kinds across all nodes.
 */
export function nodesReferenceBinding(
  nodes: Record<string, { props?: Record<string, unknown> } | undefined>,
  ref: BindingRef,
): BindingRefVia[] {
  const via = new Set<BindingRefVia>()
  for (const node of Object.values(nodes ?? {})) {
    for (const value of Object.values(node?.props ?? {})) {
      if (typeof value !== 'string' || !value.includes('{{')) continue
      for (const match of textReferencesBinding(value, ref)) via.add(match)
    }
    if (via.size === 2) break
  }
  return [...via]
}

/** Editor display text for a token whose referent no longer exists. */
export const MISSING_BINDING_LABEL = 'missing binding'

/**
 * Rewrites id tokens to friendly name forms for editor display (AGL-186):
 * `{{var:abc123}}` shows as `{{Message}}` (the CURRENT name — renames
 * reflect immediately), and tokens whose doc was deleted show as
 * `{{missing binding}}` instead of leaking raw ids. Display only — never
 * persist the result.
 */
export function displayBindingTokens(
  text: string,
  variables: Record<string, BindingDocRef> = {},
  functions: Record<string, BindingDocRef> = {},
): string {
  const withVariables = text.replace(
    VARIABLE_ID_TOKEN_PATTERN,
    (_token, id) => {
      const variable = variables[String(id)]
      return `{{${variable?.name ?? MISSING_BINDING_LABEL}}}`
    },
  )
  return withVariables.replace(
    FUNCTION_TOKEN_PATTERN,
    (token, ref, rawArgs) => {
      const definition = functions[String(ref).trim()]
      // Name-form refs already read fine; only id-form refs get mapped.
      if (!definition || definition.name === String(ref).trim()) return token
      return `{{fn:${definition.name ?? MISSING_BINDING_LABEL}(${String(rawArgs)})}}`
    },
  )
}
