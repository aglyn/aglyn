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
 * Host variables (Component Builder, AGL-91): typed values authored in the
 * console and bound into component text props with `{{name}}`. Pure data
 * module shared by the console editor UI and the tenant compose pipeline.
 */

/** Types from the mockup's Edit Variable dialog ("Function" lands with AGL-92). */
export type HostVariableType =
  | 'date'
  | 'time'
  | 'text'
  | 'number'
  | 'boolean'
  | 'dictionary'
  | 'collection'

export const HOST_VARIABLE_TYPE_LABELS: Record<HostVariableType, string> = {
  date: 'Date',
  time: 'Time',
  text: 'Plain text',
  number: 'Number',
  boolean: 'True/false (boolean)',
  dictionary: 'Dictionary (key: value)',
  collection: 'Collection list (values)',
}

/** `hosts/{hostId}/variables/{id}` doc. */
export interface HostVariable {
  /** Binding identifier — `{{name}}`. */
  name: string
  type: HostVariableType
  /** Persisted as a string; formatted per type at resolve time. */
  value?: string
}

export const VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/

/** Human-readable rendering of a variable's value for text interpolation. */
export function formatVariableValue(variable: HostVariable): string {
  const raw = variable.value ?? ''
  switch (variable.type) {
    case 'boolean':
      return raw === 'true' ? 'true' : 'false'
    case 'number': {
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? String(parsed) : ''
    }
    case 'date': {
      const parsed = new Date(raw)
      return Number.isNaN(parsed.getTime())
        ? raw
        : parsed.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          })
    }
    case 'dictionary':
    case 'collection': {
      // Stored as JSON; render collections comma-joined and dictionaries
      // as `key: value` pairs so a bare {{name}} stays readable.
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.map(String).join(', ')
        if (parsed && typeof parsed === 'object') {
          return Object.entries(parsed)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ')
        }
      } catch {
        // fall through to the raw string
      }
      return raw
    }
    case 'time':
    case 'text':
    default:
      return raw
  }
}

const BINDING_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]{0,39})\s*\}\}/g

/**
 * Replaces `{{name}}` tokens with variable values. Unknown names keep the
 * literal token so typos stay visible instead of vanishing silently.
 */
export function resolveBindings(
  text: string,
  variables: Record<string, HostVariable>,
): string {
  return text.replace(BINDING_PATTERN, (token, name) => {
    const variable = variables[name]
    return variable ? formatVariableValue(variable) : token
  })
}

/** Fast pre-check so binding-free content skips the walk entirely. */
export function hasBindings(text: string): boolean {
  return /\{\{/.test(text)
}

/**
 * Applies `resolveBindings` to every string prop across a normalized nodes
 * map (mutating a shallow copy). String props only — objects/arrays (sx,
 * option lists) pass through untouched; unsafe values in hrefs remain
 * covered by the render-time SAFE_HREF/sanitizer checks.
 */
export function resolveNodesBindings<
  T extends Record<string, any>,
>(nodes: T, variables: Record<string, HostVariable>): T {
  if (!Object.keys(variables).length) return nodes
  const next: Record<string, any> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const props = node?.props
    if (!props) {
      next[id] = node
      continue
    }
    let changed = false
    const nextProps: Record<string, unknown> = { ...props }
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'string' && hasBindings(value)) {
        nextProps[key] = resolveBindings(value, variables)
        changed = true
      }
    }
    next[id] = changed ? { ...node, props: nextProps } : node
  }
  return next as T
}
