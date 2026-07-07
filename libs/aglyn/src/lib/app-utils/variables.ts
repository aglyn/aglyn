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

import {
  evaluateExpression,
  evaluateHostFunction,
  type HostFunction,
} from './functions'

/**
 * Host variables (Component Builder, AGL-91): typed values authored in the
 * console and bound into component text props with `{{name}}` — and, since
 * AGL-93, function results with `{{fn:name(args)}}`. Pure data module
 * shared by the console editor UI and the tenant compose pipeline.
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
const FUNCTION_BINDING_PATTERN =
  /\{\{\s*fn:([a-zA-Z_][a-zA-Z0-9_ ]{0,59}?)\s*\(([^)]*)\)\s*\}\}/g

/** A function definition lookup keyed by function name (AGL-93). */
export type HostFunctionLookup = Record<string, HostFunction>

/** Variable values as an expression scope (numbers stay numeric). */
function variableScope(
  variables: Record<string, HostVariable>,
): Record<string, number | string | boolean> {
  const scope: Record<string, number | string | boolean> = {}
  for (const [name, variable] of Object.entries(variables)) {
    if (variable.type === 'number') scope[name] = Number(variable.value ?? 0)
    else if (variable.type === 'boolean') scope[name] = variable.value === 'true'
    else scope[name] = variable.value ?? ''
  }
  return scope
}

/**
 * Replaces `{{name}}` tokens with variable values and
 * `{{fn:name(arg, ...)}}` tokens with function results (AGL-91/93).
 * Function args are expressions over literals and variable names. Unknown
 * names and failed runs keep the literal token so problems stay visible
 * instead of vanishing silently.
 */
export function resolveBindings(
  text: string,
  variables: Record<string, HostVariable>,
  functions: HostFunctionLookup = {},
): string {
  const withFunctions = text.replace(
    FUNCTION_BINDING_PATTERN,
    (token, rawName, rawArgs) => {
      const definition = functions[String(rawName).trim()]
      if (!definition) return token
      try {
        const scope = variableScope(variables)
        const argValues = String(rawArgs)
          .split(',')
          .map((argument) => argument.trim())
          .filter((argument) => argument.length > 0)
          .map((argument) => evaluateExpression(argument, scope))
        const args: Record<string, unknown> = {}
        definition.parameters?.forEach((parameter, index) => {
          args[parameter.name] = argValues[index]
        })
        const result = evaluateHostFunction(definition, args)
        return result.ok ? String(result.value) : token
      } catch {
        return token
      }
    },
  )
  return withFunctions.replace(BINDING_PATTERN, (token, name) => {
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
/** Component id of the interactive function widget (plugins-ui-mui). */
export const FUNCTION_WIDGET_COMPONENT_ID = 'functionWidget'

/**
 * Injects each function widget's definition into its props at compose time
 * (AGL-93): the client runs the shared evaluator locally, so the published
 * page carries the definition instead of calling home. Unknown names leave
 * the node untouched (the widget renders its editor placeholder).
 */
export function attachFunctionDefinitions<T extends Record<string, any>>(
  nodes: T,
  functions: HostFunctionLookup,
): T {
  if (!Object.keys(functions).length) return nodes
  const next: Record<string, any> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const name =
      node?.componentId === FUNCTION_WIDGET_COMPONENT_ID
        ? node?.props?.functionName
        : undefined
    const definition = name ? functions[String(name).trim()] : undefined
    next[id] = definition
      ? { ...node, props: { ...node.props, definition } }
      : node
  }
  return next as T
}

export function resolveNodesBindings<T extends Record<string, any>>(
  nodes: T,
  variables: Record<string, HostVariable>,
  functions: HostFunctionLookup = {},
): T {
  if (!Object.keys(variables).length && !Object.keys(functions).length) {
    return nodes
  }
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
        nextProps[key] = resolveBindings(value, variables, functions)
        changed = true
      }
    }
    next[id] = changed ? { ...node, props: nextProps } : node
  }
  return next as T
}
