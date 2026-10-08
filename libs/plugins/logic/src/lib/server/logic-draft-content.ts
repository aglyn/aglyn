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
  expressionSyntaxError,
  FUNCTION_MAX_OPERATIONS,
  functionReferencedNames,
  type FunctionComparator,
  type FunctionValueType,
  type HostFunction,
  type HostFunctionParameter,
} from '@aglyn/aglyn/app-utils/functions'
import { type HostVariableType, VARIABLE_NAME_PATTERN } from '@aglyn/aglyn/app-utils/variables'
import type { PluginDraftCheck } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'

/**
 * WHAT A VARIABLE OR A FUNCTION ANOTHER PLUGIN ASKS FOR MUST BE (AGL-3616).
 *
 * The pure half of this plugin's `variable` and `function` draft writers
 * (`logic-drafts.ts`): the content a caller sends, read into the document the
 * Variables and Functions cards save, or every problem that stops it. No I/O
 * and no Admin SDK, so the writers' synchronous `check` is answered from a
 * module the console's boot can load without the server half.
 *
 * The rules are the editors', held where the editors leave a gap a person
 * would never fill in:
 *
 *  - A NAME is the binding grammar both cards and the AI proposals use
 *    (`VARIABLE_NAME_PATTERN`): a letter or `_`, then letters, digits or `_`,
 *    at most 40. Its uniqueness is the cards' — case-insensitive, among the
 *    site's live records — and needs the store, so the writer asks it.
 *  - A VARIABLE's value is written AS STORED, the string the Variables editor
 *    keeps for its type and `formatVariableValue` renders: digits; `true` or
 *    `false`; a date; `HH:MM`; a JSON object for a dictionary; a JSON list
 *    for a collection.
 *  - A FUNCTION is the shape the Functions card saves and the evaluator runs:
 *    typed parameters and locals with distinct names, if/then/otherwise
 *    operations whose every expression parses in the evaluator's grammar
 *    (`expressionSyntaxError`), assignments only to its own names, and a
 *    return value that is one of them. Which SITE variables it reads is
 *    reported, not judged: they live in the store, and the AI step that
 *    writes functions holds a definition to them and runs it once first.
 */

/** The resource names the writers are registered under. */
export const VARIABLE_DRAFT_RESOURCE = 'variable'
export const FUNCTION_DRAFT_RESOURCE = 'function'

/** The longest name a binding reads, from `VARIABLE_NAME_PATTERN`. */
export const LOGIC_DRAFT_NAME_MAX = 40
/** The longest variable value a draft keeps; the AI proposals' own bound. */
export const VARIABLE_DRAFT_VALUE_MAX = 2_000
/** The most parameters and locals a function draft keeps. */
export const FUNCTION_DRAFT_PARAMETERS_MAX = 20
export const FUNCTION_DRAFT_LOCALS_MAX = 40
/** The longest expression, label or default a function draft keeps. */
export const FUNCTION_DRAFT_EXPRESSION_MAX = 400
export const FUNCTION_DRAFT_LABEL_MAX = 80
/** The most choices one parameter offers. */
export const FUNCTION_DRAFT_OPTIONS_MAX = 20

/** Every type the Variables editor offers. */
export const VARIABLE_DRAFT_TYPES: readonly HostVariableType[] = [
  'text',
  'number',
  'boolean',
  'date',
  'time',
  'dictionary',
  'collection',
]

const VALUE_TYPES: readonly FunctionValueType[] = ['number', 'text', 'boolean']
const COMPARATORS: readonly FunctionComparator[] = ['==', '!=', '<', '<=', '>', '>=']

/** Markup no editor field is for: a value or an expression holding it is refused. */
const MARKUP = /<\s*\/?\s*(script|iframe|style|object|embed)\b|javascript:/i

/** `HH:MM`, or `HH:MM:SS`, as a time input stores one. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Whether a name is one a binding can read. */
export function logicDraftNameProblem(noun: 'variable' | 'function', name: string): string | null {
  if (!name) return `The ${noun} needs a name`
  return VARIABLE_NAME_PATTERN.test(name)
    ? null
    : `The ${noun} name must start with a letter or _, then letters, digits or _; at most ${LOGIC_DRAFT_NAME_MAX} characters`
}

/** The case-insensitive key two names collide under, as both cards compare them. */
export function logicNameKey(name: string): string {
  return name.trim().toLowerCase()
}

// ── Variables ─────────────────────────────────────────────────────────────

/** The variable as the Variables card saves it: never computed, so no workflow. */
export interface VariableDraftDocument {
  name: string
  type: HostVariableType
  value: string
  workflowId: ''
  workflowName: ''
}

export type LogicDraftRead<T> = { ok: true; value: T } | { ok: false; problems: string[] }

/** What is wrong with a value for its type, as the editor stores it; `null` when nothing is. */
export function variableDraftValueProblem(type: HostVariableType, value: string): string | null {
  if (value.length > VARIABLE_DRAFT_VALUE_MAX) {
    return `The value is longer than ${VARIABLE_DRAFT_VALUE_MAX} characters`
  }
  if (MARKUP.test(value)) return 'The value holds markup'
  switch (type) {
    case 'number':
      return value.trim() !== '' && Number.isFinite(Number(value)) ? null : 'A number variable’s value is a number, such as 49 or 0.5'
    case 'boolean':
      return value === 'true' || value === 'false' ? null : 'A boolean variable’s value is true or false'
    case 'date':
      return value.trim() !== '' && !Number.isNaN(new Date(value).getTime())
        ? null
        : 'A date variable’s value is a date, such as 2026-10-01'
    case 'time':
      return TIME.test(value) ? null : 'A time variable’s value is HH:MM, such as 09:30'
    case 'dictionary':
    case 'collection': {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        parsed = undefined
      }
      if (type === 'collection') {
        return Array.isArray(parsed) ? null : 'A collection’s value is a JSON list, such as ["red","green"]'
      }
      return isRecord(parsed) ? null : 'A dictionary’s value is a JSON object, such as {"starter":19,"pro":49}'
    }
    default:
      return null
  }
}

/** The content as the variable writer stores it, or every problem that stops it. */
export function readVariableDraftContent(content: Readonly<Record<string, unknown>>): LogicDraftRead<VariableDraftDocument> {
  const problems: string[] = []
  const name = text(content['name'])
  const nameProblem = logicDraftNameProblem('variable', name)
  if (nameProblem) problems.push(nameProblem)
  const type = content['type'] ?? 'text'
  if (!(VARIABLE_DRAFT_TYPES as readonly unknown[]).includes(type)) {
    problems.push(`A variable’s type is one of ${VARIABLE_DRAFT_TYPES.join(', ')}`)
  }
  const rawValue = content['value'] ?? ''
  if (typeof rawValue !== 'string') problems.push('The value is text, written as the editor stores it')
  else if ((VARIABLE_DRAFT_TYPES as readonly unknown[]).includes(type)) {
    const valueProblem = variableDraftValueProblem(type as HostVariableType, rawValue)
    if (valueProblem) problems.push(valueProblem)
  }
  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    value: { name, type: type as HostVariableType, value: rawValue as string, workflowId: '', workflowName: '' },
  }
}

/** Whether content is a variable this plugin would store, with what it says about it. Pure. */
export function checkVariableDraftContent(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readVariableDraftContent(content)
  if (read.ok === false) return read
  return { ok: true, facts: variableDraftFacts(read.value) }
}

/** What the writer reports about a variable: its type. */
export function variableDraftFacts(variable: Partial<VariableDraftDocument>): Readonly<Record<string, unknown>> {
  return { type: variable.type ?? 'text' }
}

// ── Functions ─────────────────────────────────────────────────────────────

/** The function as the Functions card saves it. */
export type FunctionDraftDocument = HostFunction & { returnValue: string }

/** The content as the function writer stores it, or every problem that stops it. */
export function readFunctionDraftContent(content: Readonly<Record<string, unknown>>): LogicDraftRead<FunctionDraftDocument> {
  const problems: string[] = []
  const name = text(content['name'])
  const nameProblem = logicDraftNameProblem('function', name)
  if (nameProblem) problems.push(nameProblem)

  const own = new Set<string>()
  const ownName = (raw: unknown, what: string): string => {
    const value = text(raw)
    if (!VARIABLE_NAME_PATTERN.test(value)) {
      problems.push(`A ${what} name must start with a letter or _, then letters, digits or _`)
    } else if (own.has(value)) {
      problems.push(`The name ${value} is used twice; each parameter and local needs its own`)
    }
    own.add(value)
    return value
  }
  const typeOf = (raw: unknown): FunctionValueType => {
    if ((VALUE_TYPES as readonly unknown[]).includes(raw)) return raw as FunctionValueType
    problems.push('A parameter or local’s type is number, text or boolean')
    return 'number'
  }
  const list = (key: string, noun: string, max: number, min = 0): Record<string, unknown>[] => {
    const raw = content[key] ?? []
    if (!Array.isArray(raw) || raw.some((entry) => !isRecord(entry))) {
      problems.push(`The ${noun} are a list`)
      return []
    }
    if (raw.length < min || raw.length > max) {
      problems.push(min ? `A function has between ${min} and ${max} ${noun}` : `A function has at most ${max} ${noun}`)
    }
    return (raw as Record<string, unknown>[]).slice(0, max)
  }
  const label = (raw: unknown, where: string): string => {
    const value = text(raw)
    if (value.length > FUNCTION_DRAFT_LABEL_MAX) problems.push(`${where} is longer than ${FUNCTION_DRAFT_LABEL_MAX} characters`)
    if (MARKUP.test(value)) problems.push(`${where} holds markup`)
    return value
  }

  const parameters = list('parameters', 'parameters', FUNCTION_DRAFT_PARAMETERS_MAX).map((raw, index) => {
    const where = `Parameter ${index + 1}`
    const parameter: HostFunctionParameter = {
      name: ownName(raw['name'], 'parameter'),
      type: typeOf(raw['type']),
      required: raw['required'] === true,
    }
    const shown = label(raw['label'], `${where}'s label`)
    if (shown) parameter.label = shown
    const start = label(raw['defaultValue'], `${where}'s starting value`)
    if (start) parameter.defaultValue = start
    if (raw['options'] !== undefined) {
      const options = Array.isArray(raw['options']) ? raw['options'] : null
      if (!options || options.some((option) => !isRecord(option) || !text(option['value']))) {
        problems.push(`${where}'s choices each have a value`)
      } else if (options.length > FUNCTION_DRAFT_OPTIONS_MAX) {
        problems.push(`${where} offers at most ${FUNCTION_DRAFT_OPTIONS_MAX} choices`)
      } else if (options.length) {
        parameter.options = (options as Record<string, unknown>[]).map((option) => {
          const value = label(option['value'], `${where}'s choice`)
          const read = label(option['label'], `${where}'s choice`)
          return read && read !== value ? { value, label: read } : { value }
        })
      }
    }
    return parameter
  })
  const variables = list('variables', 'locals', FUNCTION_DRAFT_LOCALS_MAX).map((raw) => ({
    name: ownName(raw['name'], 'local'),
    type: typeOf(raw['type']),
  }))

  const expression = (raw: unknown, where: string): string => {
    const value = text(raw)
    if (!value) {
      problems.push(`${where} is empty`)
      return value
    }
    if (value.length > FUNCTION_DRAFT_EXPRESSION_MAX || MARKUP.test(value)) {
      problems.push(`${where} is not an expression the function can run`)
      return value
    }
    const syntax = expressionSyntaxError(value)
    if (syntax) problems.push(`${where} cannot be read: ${syntax}`)
    return value
  }
  let assignments = 0
  const sets = (raw: unknown, where: string): HostFunction['operations'][number]['then'] => {
    if (raw !== undefined && !Array.isArray(raw)) {
      problems.push(`${where} is a list of assignments`)
      return []
    }
    return ((raw ?? []) as unknown[]).map((set, index) => {
      const at = `${where}, assignment ${index + 1}`
      const entry = isRecord(set) ? set : {}
      assignments += 1
      const target = text(entry['set'])
      if (!own.has(target)) problems.push(`${at} sets ${target || 'nothing'}, which is not one of the function's parameters or locals`)
      const workflow = text(entry['workflow'])
      // A value a workflow computes needs no expression; the editor keeps one anyway.
      const written = workflow && !text(entry['expression']) ? '' : expression(entry['expression'], at)
      return { set: target, expression: written, ...(workflow ? { workflow } : {}) }
    })
  }
  const operations = list('operations', 'operations', FUNCTION_MAX_OPERATIONS, 1).map((raw, index) => {
    const where = `Operation ${index + 1}`
    const condition = isRecord(raw['if']) ? raw['if'] : {}
    const comparator = condition['comparator']
    if (!(COMPARATORS as readonly unknown[]).includes(comparator)) {
      problems.push(`${where}'s condition compares with one of ${COMPARATORS.join(' ')}`)
    }
    return {
      if: {
        left: expression(condition['left'], `${where}'s condition (left)`),
        comparator: ((COMPARATORS as readonly unknown[]).includes(comparator) ? comparator : '==') as FunctionComparator,
        right: expression(condition['right'], `${where}'s condition (right)`),
      },
      then: sets(raw['then'], `${where} (then)`),
      otherwise: sets(raw['otherwise'], `${where} (otherwise)`),
    }
  })
  if (assignments > FUNCTION_MAX_OPERATIONS) {
    problems.push(`A function makes at most ${FUNCTION_MAX_OPERATIONS} assignments`)
  }
  const returnValue = text(content['returnValue'])
  if (!own.has(returnValue)) problems.push('The return value names one of the function’s own parameters or locals')

  if (problems.length) return { ok: false, problems: [...new Set(problems)] }
  return { ok: true, value: { name, parameters, variables, operations, returnValue } }
}

/** What the writer reports about a function: its size, and the site variables it reads. */
export function functionDraftFacts(definition: Partial<HostFunction>): Readonly<Record<string, unknown>> {
  return {
    parameters: definition.parameters?.length ?? 0,
    operations: definition.operations?.length ?? 0,
    reads: functionReferencedNames({
      name: definition.name ?? '',
      parameters: definition.parameters ?? [],
      variables: definition.variables ?? [],
      operations: definition.operations ?? [],
    }),
  }
}

/** Whether content is a function this plugin would store, with what it says about it. Pure. */
export function checkFunctionDraftContent(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readFunctionDraftContent(content)
  if (read.ok === false) return read
  return { ok: true, facts: functionDraftFacts(read.value) }
}
