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
  evaluateHostFunction,
  expressionSyntaxError,
  type FunctionComparator,
  type FunctionValueType,
  type HostFunction,
  functionReferencedNames,
} from '@aglyn/aglyn/app-utils/functions'
import {
  functionGlobals,
  type HostVariable,
  type HostVariableType,
  VARIABLE_NAME_PATTERN,
} from '@aglyn/aglyn/app-utils/variables'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'

/**
 * A `logic` job (AGL-3603): a site's Functions & Variables, by AI.
 *
 *  - `function` proposes a function — parameters, locals, the numbered
 *    if/then/otherwise operations and the value it returns — from a
 *    description, or, naming a saved function, a changed or fixed copy of
 *    it. Every expression is held to the evaluator's own grammar
 *    (`expressionSyntaxError`), every name it reads to the function's own
 *    names and the site's variables, and the whole definition is run once
 *    with each parameter at its starting value before anyone sees it.
 *  - `variable` proposes one site variable: a name, a type and a value in
 *    that type's stored form.
 *  - `explain` reads a saved function and answers in plain words what it
 *    computes, and anything in it worth checking.
 *
 * Nothing is written: a proposal rides on the job's output, and the logic
 * editor is where a person saves it, or does not.
 */

export const AI_LOGIC_JOB_MODES = ['function', 'variable', 'explain'] as const
export type AiLogicJobMode = (typeof AI_LOGIC_JOB_MODES)[number]

export type AiLogicJobInputs =
  | { mode: 'function'; functionId: string | null }
  | { mode: 'variable' }
  | { mode: 'explain'; functionId: string }

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

export const AI_LOGIC_PICK_FUNCTION_COPY = 'Pick the function to explain'

/** A job's inputs read into its mode, or the sentence that says what is wrong with them. */
export function parseAiLogicJobInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiLogicJobInputs | string {
  const mode = inputs?.['mode'] ?? 'function'
  if (!(AI_LOGIC_JOB_MODES as readonly unknown[]).includes(mode)) {
    return 'inputs.mode must be function, variable or explain'
  }
  if (mode === 'variable') return { mode }
  const functionId = inputs?.['functionId']
  const named = typeof functionId === 'string' && DOCUMENT_ID.test(functionId) ? functionId : null
  if (functionId != null && !named) return AI_LOGIC_PICK_FUNCTION_COPY
  if (mode === 'explain') return named ? { mode, functionId: named } : AI_LOGIC_PICK_FUNCTION_COPY
  return { mode: 'function', functionId: named }
}

// ── The bounds a proposal is held to ──────────────────────────────────────

export const AI_LOGIC_MAX_PARAMETERS = 12
export const AI_LOGIC_MAX_LOCALS = 20
export const AI_LOGIC_MAX_OPERATIONS = 24
export const AI_LOGIC_MAX_SETS = 12
export const AI_LOGIC_EXPRESSION_MAX_CHARS = 400
export const AI_LOGIC_LABEL_MAX_CHARS = 80
export const AI_LOGIC_VARIABLE_VALUE_MAX_CHARS = 2_000

export const AI_LOGIC_VALUE_TYPES: readonly FunctionValueType[] = ['number', 'text', 'boolean']
export const AI_LOGIC_COMPARATORS: readonly FunctionComparator[] = ['==', '!=', '<', '<=', '>', '>=']

/** The variable types a proposal may use: every type the Variables editor offers. */
export const AI_LOGIC_VARIABLE_TYPES: readonly HostVariableType[] = [
  'text',
  'number',
  'boolean',
  'date',
  'time',
  'dictionary',
  'collection',
]

/** A site variable as a proposal is checked against: its name, type and value. */
export type AiLogicSiteVariable = Pick<HostVariable, 'name' | 'type' | 'value'>

/** What a proposal's names are checked against: the site's variables and functions. */
export interface AiLogicContext {
  variables: readonly AiLogicSiteVariable[]
  /** The site's function names, which a new function's name must not repeat. */
  functions: readonly string[]
  /** The saved function a change starts from; its own name is free to keep. */
  editing?: string | null
}

export interface AiLogicCheckResult<T> {
  value: T | null
  violations: AiDoctrineViolation[]
}

const violation = (code: string, message: string): AiDoctrineViolation => ({ rule: null, code, message })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const MARKUP = /<\s*\/?\s*(script|iframe|style|object|embed)\b|javascript:/i

/** A starting value a parameter's type can hold, for the run every proposal is given. */
function sampleFor(type: FunctionValueType, defaultValue: string | undefined): string {
  if (defaultValue) return defaultValue
  return type === 'number' ? '1' : type === 'boolean' ? 'true' : 'sample'
}

/**
 * A `submit_function` answer read into a definition the function editor
 * opens, or the violations a re-ask names. Only what the evaluator can run
 * is kept: an expression it cannot parse, a name it cannot find, a SET on a
 * site variable, or a run that fails on starting values is refused.
 */
export function checkAiLogicFunction(
  answer: Record<string, unknown>,
  context: AiLogicContext,
): AiLogicCheckResult<HostFunction> {
  const violations: AiDoctrineViolation[] = []
  const name = str(answer['name'])
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    violations.push(
      violation('logic-name', 'The function name must start with a letter or _, then letters, digits or _; at most 40 characters.'),
    )
  } else if (name !== context.editing && context.functions.includes(name)) {
    violations.push(violation('logic-name-taken', `The site already has a function named ${name}. Choose another name.`))
  }

  const own = new Set<string>()
  const ownName = (raw: unknown, what: string): string => {
    const value = str(raw)
    if (!VARIABLE_NAME_PATTERN.test(value)) {
      violations.push(violation('logic-name', `A ${what} name must start with a letter or _, then letters, digits or _.`))
    } else if (own.has(value)) {
      violations.push(violation('logic-name-repeated', `The name ${value} is used twice. Each parameter and local needs its own name.`))
    }
    own.add(value)
    return value
  }
  const typeOf = (raw: unknown): FunctionValueType => {
    if ((AI_LOGIC_VALUE_TYPES as readonly unknown[]).includes(raw)) return raw as FunctionValueType
    violations.push(violation('logic-type', 'A type is number, text or boolean.'))
    return 'number'
  }

  const rawParameters = Array.isArray(answer['parameters']) ? answer['parameters'].filter(isRecord) : []
  const rawLocals = Array.isArray(answer['locals']) ? answer['locals'].filter(isRecord) : []
  const rawOperations = Array.isArray(answer['operations']) ? answer['operations'].filter(isRecord) : []
  if (rawParameters.length > AI_LOGIC_MAX_PARAMETERS) {
    violations.push(violation('logic-size', `At most ${AI_LOGIC_MAX_PARAMETERS} parameters.`))
  }
  if (rawLocals.length > AI_LOGIC_MAX_LOCALS) {
    violations.push(violation('logic-size', `At most ${AI_LOGIC_MAX_LOCALS} locals.`))
  }
  if (!rawOperations.length || rawOperations.length > AI_LOGIC_MAX_OPERATIONS) {
    violations.push(violation('logic-size', `Between 1 and ${AI_LOGIC_MAX_OPERATIONS} operations.`))
  }

  const parameters = rawParameters.slice(0, AI_LOGIC_MAX_PARAMETERS).map((raw) => {
    const parameter: HostFunction['parameters'][number] = {
      name: ownName(raw['name'], 'parameter'),
      type: typeOf(raw['type']),
      required: raw['required'] === true,
    }
    const label = str(raw['label']).slice(0, AI_LOGIC_LABEL_MAX_CHARS)
    if (label) parameter.label = label
    const start = str(raw['defaultValue']).slice(0, AI_LOGIC_LABEL_MAX_CHARS)
    if (start) parameter.defaultValue = start
    return parameter
  })
  const variables = rawLocals.slice(0, AI_LOGIC_MAX_LOCALS).map((raw) => ({
    name: ownName(raw['name'], 'local'),
    type: typeOf(raw['type']),
  }))

  const site = new Set(context.variables.map((variable) => variable.name))
  const expression = (raw: unknown, where: string): string => {
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text) {
      violations.push(violation('logic-expression', `${where} is empty. Write a value, a name or an expression.`))
      return text
    }
    if (text.length > AI_LOGIC_EXPRESSION_MAX_CHARS || MARKUP.test(text)) {
      violations.push(violation('logic-expression', `${where} is not an expression the function can run.`))
      return text
    }
    const problem = expressionSyntaxError(text)
    if (problem) violations.push(violation('logic-syntax', `${where} cannot be read: ${problem}.`))
    return text
  }
  const sets = (raw: unknown, where: string) => {
    const list = Array.isArray(raw) ? raw.filter(isRecord) : []
    if (list.length > AI_LOGIC_MAX_SETS) {
      violations.push(violation('logic-size', `${where} has more than ${AI_LOGIC_MAX_SETS} assignments.`))
    }
    return list.slice(0, AI_LOGIC_MAX_SETS).map((set, index) => {
      const target = str(set['set'])
      if (!own.has(target)) {
        violations.push(
          violation(
            'logic-set-target',
            site.has(target)
              ? `${where}, assignment ${index + 1}, sets the site variable ${target}. A function reads site variables and sets only its own parameters and locals.`
              : `${where}, assignment ${index + 1}, sets ${target || 'nothing'}, which is not one of the function's parameters or locals.`,
          ),
        )
      }
      return { set: target, expression: expression(set['expression'], `${where}, assignment ${index + 1}`) }
    })
  }
  const operations = rawOperations.slice(0, AI_LOGIC_MAX_OPERATIONS).map((raw, index) => {
    const where = `Operation ${index + 1}`
    const condition = isRecord(raw['if']) ? raw['if'] : {}
    const comparator = (AI_LOGIC_COMPARATORS as readonly unknown[]).includes(condition['comparator'])
      ? (condition['comparator'] as FunctionComparator)
      : null
    if (!comparator) violations.push(violation('logic-comparator', `${where}'s condition compares with one of == != < <= > >=.`))
    return {
      if: {
        left: expression(condition['left'], `${where}'s condition (left)`),
        comparator: comparator ?? '==',
        right: expression(condition['right'], `${where}'s condition (right)`),
      },
      then: sets(raw['then'], `${where} (then)`),
      otherwise: sets(raw['otherwise'], `${where} (otherwise)`),
    }
  })

  const returnValue = str(answer['returnValue'])
  if (!own.has(returnValue)) {
    violations.push(violation('logic-return', 'returnValue names one of the function’s own parameters or locals.'))
  }
  const definition: HostFunction = { name, parameters, variables, operations, returnValue }

  // Every name an expression reads that is not the function's own must be a site variable.
  const unknown = functionReferencedNames(definition).filter((read) => !site.has(read))
  if (unknown.length) {
    violations.push(
      violation(
        'logic-unknown-name',
        `The function reads ${unknown.join(', ')}, which is neither one of its own names nor a site variable. Use only the names listed.`,
      ),
    )
  }

  if (!violations.length) {
    // One run with every parameter at a starting value: what the editor's
    // own test run would show first, so a definition that cannot run on its
    // first try is refused here rather than handed to a person.
    const variablesByName = Object.fromEntries(
      context.variables.map((variable) => [variable.name, variable as HostVariable]),
    )
    const args = Object.fromEntries(
      parameters.map((parameter) => [parameter.name, sampleFor(parameter.type, parameter.defaultValue)]),
    )
    const run = evaluateHostFunction(definition, args, { globals: functionGlobals(definition, variablesByName) })
    if (run.ok === false) violations.push(violation('logic-run', `The function fails when it runs: ${run.error}.`))
  }
  return { value: violations.length ? null : definition, violations }
}

/** A `submit_variable` answer read into the variable the Variables editor opens. */
export function checkAiLogicVariable(
  answer: Record<string, unknown>,
  context: Pick<AiLogicContext, 'variables'>,
): AiLogicCheckResult<AiLogicSiteVariable> {
  const violations: AiDoctrineViolation[] = []
  const name = str(answer['name'])
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    violations.push(violation('logic-name', 'The variable name must start with a letter or _, then letters, digits or _; at most 40 characters.'))
  } else if (context.variables.some((variable) => variable.name === name)) {
    violations.push(violation('logic-name-taken', `The site already has a variable named ${name}. Choose another name.`))
  }
  const type = answer['type']
  if (!(AI_LOGIC_VARIABLE_TYPES as readonly unknown[]).includes(type)) {
    violations.push(violation('logic-type', `A variable's type is one of ${AI_LOGIC_VARIABLE_TYPES.join(', ')}.`))
  }
  const value = typeof answer['value'] === 'string' ? answer['value'] : ''
  if (value.length > AI_LOGIC_VARIABLE_VALUE_MAX_CHARS || MARKUP.test(value)) {
    violations.push(violation('logic-value', 'The value is too long, or holds markup.'))
  } else if (type === 'number' && !Number.isFinite(Number(value))) {
    violations.push(violation('logic-value', 'A number variable’s value is a number, such as 49 or 0.5.'))
  } else if (type === 'boolean' && value !== 'true' && value !== 'false') {
    violations.push(violation('logic-value', 'A boolean variable’s value is true or false.'))
  } else if (type === 'date' && Number.isNaN(new Date(value).getTime())) {
    violations.push(violation('logic-value', 'A date variable’s value is a date such as 2026-10-01.'))
  } else if (type === 'dictionary' || type === 'collection') {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = null
    }
    const fits = type === 'collection' ? Array.isArray(parsed) : isRecord(parsed)
    if (!fits) {
      violations.push(
        violation(
          'logic-value',
          type === 'collection'
            ? 'A collection’s value is a JSON list, such as ["red","green"].'
            : 'A dictionary’s value is a JSON object of names to values, such as {"starter":19,"pro":49}.',
        ),
      )
    }
  }
  return {
    value: violations.length ? null : { name, type: type as HostVariableType, value },
    violations,
  }
}

// ── What a job hands the logic editor ─────────────────────────────────────

/** The output resource a logic proposal rides on. */
export const AI_LOGIC_RESOURCE = 'logic'

/** A logic output's proposal: a function to open in the editor, or a variable. */
export type AiLogicProposal =
  | { kind: 'function'; functionId: string | null; definition: HostFunction }
  | { kind: 'variable'; variable: AiLogicSiteVariable }

/**
 * A proposal read back from a job's output, in the browser, before the
 * editor is handed it; `null` for anything that is not one. The server held
 * the definition to the grammar; this only refuses a shape that is not one.
 */
export function readAiLogicProposal(value: unknown): AiLogicProposal | null {
  if (!isRecord(value)) return null
  if (value['kind'] === 'variable' && isRecord(value['variable'])) {
    const variable = value['variable']
    if (typeof variable['name'] !== 'string' || typeof variable['type'] !== 'string') return null
    return {
      kind: 'variable',
      variable: {
        name: variable['name'],
        type: variable['type'] as HostVariableType,
        value: typeof variable['value'] === 'string' ? variable['value'] : '',
      },
    }
  }
  if (value['kind'] !== 'function' || !isRecord(value['definition'])) return null
  const definition = value['definition']
  if (
    typeof definition['name'] !== 'string' ||
    !Array.isArray(definition['parameters']) ||
    !Array.isArray(definition['variables']) ||
    !Array.isArray(definition['operations'])
  ) {
    return null
  }
  return {
    kind: 'function',
    functionId: typeof value['functionId'] === 'string' ? value['functionId'] : null,
    definition: definition as unknown as HostFunction,
  }
}

// ── What a job tells a person ─────────────────────────────────────────────

export const AI_LOGIC_NO_SITE_COPY = 'This logic job names a site this workspace does not have.'
export const AI_LOGIC_UNAVAILABLE_COPY = 'Turn on Logic for this site before starting the job.'
export const AI_LOGIC_GONE_COPY = 'That function no longer exists.'
export const AI_LOGIC_NO_FUNCTION_COPY =
  'The AI could not write a function the site can run from this description. Try describing what goes in, and what should come out.'
export const AI_LOGIC_NO_VARIABLE_COPY =
  'The AI could not write a variable from this description. Try naming what it holds, and its value.'
export const AI_LOGIC_NO_EXPLANATION_COPY = 'The AI could not explain this function. Try again.'
