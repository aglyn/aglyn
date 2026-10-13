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
 * A function step's expression, built by picking an operation and its values
 * instead of typing it (AGL-3757). What comes out is the SAME expression an
 * author could have typed — the evaluator, the stored definition and every
 * page that runs it are untouched; this only writes the text.
 */

export type FormulaOperation =
  | 'value'
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'min'
  | 'max'
  | 'round'
  | 'roundDown'
  | 'roundUp'
  | 'absolute'
  | 'currency'
  | 'number'
  | 'join'

/** One value an operation works on. */
export type FormulaOperand =
  /** A parameter, a local variable, a site variable or a dictionary member. */
  | { source: 'name'; name: string }
  | { source: 'number'; value: string }
  | { source: 'text'; value: string }
  /** Whatever the box holds already, so formulas can be layered. */
  | { source: 'current' }

export interface FormulaDraft {
  operation: FormulaOperation
  operands: FormulaOperand[]
  /** Decimal places for round, currency and number. */
  places?: number
  /** The sign written before a currency amount. */
  symbol?: string
  /** What goes between joined texts. */
  separator?: string
}

interface FormulaOperationSpec {
  label: string
  /** How many values it takes at least; `variadic` ones take more. */
  minOperands: number
  variadic?: boolean
  /** What each value box is called, in order; the last repeats. */
  operandLabels: string[]
  places?: boolean
}

export const FORMULA_OPERATIONS: Record<FormulaOperation, FormulaOperationSpec> = {
  value: { label: 'Use a value', minOperands: 1, operandLabels: ['Value'] },
  add: {
    label: 'Add',
    minOperands: 2,
    variadic: true,
    operandLabels: ['Value', 'Plus'],
  },
  subtract: {
    label: 'Subtract',
    minOperands: 2,
    operandLabels: ['Value', 'Minus'],
  },
  multiply: {
    label: 'Multiply',
    minOperands: 2,
    variadic: true,
    operandLabels: ['Value', 'Times'],
  },
  divide: {
    label: 'Divide',
    minOperands: 2,
    operandLabels: ['Value', 'Divided by'],
  },
  min: {
    label: 'Smallest of',
    minOperands: 2,
    variadic: true,
    operandLabels: ['Value', 'Or'],
  },
  max: {
    label: 'Largest of',
    minOperands: 2,
    variadic: true,
    operandLabels: ['Value', 'Or'],
  },
  round: {
    label: 'Round',
    minOperands: 1,
    operandLabels: ['Value'],
    places: true,
  },
  roundDown: { label: 'Round down', minOperands: 1, operandLabels: ['Value'] },
  roundUp: { label: 'Round up', minOperands: 1, operandLabels: ['Value'] },
  absolute: {
    label: 'Without its minus sign',
    minOperands: 1,
    operandLabels: ['Value'],
  },
  currency: {
    label: 'Format as money',
    minOperands: 1,
    operandLabels: ['Amount'],
    places: true,
  },
  number: {
    label: 'Format with thousands separators',
    minOperands: 1,
    operandLabels: ['Number'],
    places: true,
  },
  join: {
    label: 'Join text',
    minOperands: 2,
    variadic: true,
    operandLabels: ['Text', 'Then'],
  },
}

/** The operations, in the order the picker lists them. */
export const FORMULA_OPERATION_ORDER = Object.keys(
  FORMULA_OPERATIONS,
) as FormulaOperation[]

/** The label for a value box at `index` of `operation`. */
export function formulaOperandLabel(
  operation: FormulaOperation,
  index: number,
): string {
  const labels = FORMULA_OPERATIONS[operation].operandLabels
  return labels[Math.min(index, labels.length - 1)]
}

/**
 * A text as the evaluator reads it. Its strings have no escapes, so the
 * quote the text does not contain is used; a text holding both loses its
 * double quotes rather than writing an expression that cannot be read.
 */
function quoteText(value: string): string {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  return `'${value.replace(/"/g, '')}'`
}

const SIMPLE_EXPRESSION = /^\s*(?:-?[0-9]*\.?[0-9]+|[a-zA-Z_][a-zA-Z0-9_.]*)\s*$/

/**
 * One operand as expression text, or `null` while it is still blank. `bare`
 * is a built-in's argument, which its own parentheses already delimit.
 */
function operandText(
  operand: FormulaOperand,
  current: string,
  bare = false,
): string | null {
  switch (operand.source) {
    case 'name':
      return operand.name ? operand.name : null
    case 'number': {
      const text = operand.value.trim()
      if (!text) return null
      const parsed = Number(text)
      return Number.isFinite(parsed) ? String(parsed) : null
    }
    case 'text':
      return quoteText(operand.value)
    case 'current': {
      const text = current.trim()
      if (!text) return null
      return bare || SIMPLE_EXPRESSION.test(text) ? text : `(${text})`
    }
  }
}

function placesOf(draft: FormulaDraft, fallback: number): number {
  const places = Number(draft.places ?? fallback)
  return Number.isInteger(places) && places >= 0 && places <= 6 ? places : fallback
}

/**
 * The expression a draft writes, or `null` while a value it needs is blank.
 * `current` is what the box held when the builder opened.
 */
export function buildFormula(draft: FormulaDraft, current = ''): string | null {
  const spec = FORMULA_OPERATIONS[draft.operation]
  const operands = draft.operands.slice(
    0,
    spec.variadic ? draft.operands.length : spec.minOperands,
  )
  if (operands.length < spec.minOperands) return null
  const arithmetic = ['add', 'subtract', 'multiply', 'divide', 'join'].includes(
    draft.operation,
  )
  const parts = operands.map((operand) =>
    operandText(operand, current, !arithmetic && draft.operation !== 'value'),
  )
  if (parts.some((part) => part === null)) return null
  const values = parts as string[]
  const [first] = values
  switch (draft.operation) {
    case 'value':
      return first
    case 'add':
      return values.join(' + ')
    case 'subtract':
      return values.join(' - ')
    case 'multiply':
      return values.join(' * ')
    case 'divide':
      return values.join(' / ')
    case 'min':
      return `min(${values.join(', ')})`
    case 'max':
      return `max(${values.join(', ')})`
    case 'round':
      return `round(${first}, ${placesOf(draft, 0)})`
    case 'roundDown':
      return `floor(${first})`
    case 'roundUp':
      return `ceil(${first})`
    case 'absolute':
      return `abs(${first})`
    case 'currency':
      return `${quoteText(draft.symbol ?? '$')} + format(${first}, ${placesOf(draft, 2)})`
    case 'number':
      return `format(${first}, ${placesOf(draft, 0)})`
    case 'join': {
      // A leading '' keeps two numbers joined as text rather than added.
      const separator = draft.separator ?? ' '
      return separator
        ? values.join(` + ${quoteText(separator)} + `)
        : ['\'\'', ...values].join(' + ')
    }
  }
}

/** A fresh draft for `operation`, carrying over the values already chosen. */
export function formulaDraftFor(
  operation: FormulaOperation,
  previous?: FormulaDraft,
  current = '',
): FormulaDraft {
  const spec = FORMULA_OPERATIONS[operation]
  const blank = (index: number): FormulaOperand =>
    index === 0 && current.trim()
      ? { source: 'current' }
      : operation === 'join'
        ? { source: 'text', value: '' }
        : { source: 'name', name: '' }
  const operands = Array.from(
    { length: spec.minOperands },
    (_, index) => previous?.operands[index] ?? blank(index),
  )
  return {
    operation,
    operands,
    places: previous?.places,
    symbol: previous?.symbol,
    separator: previous?.separator,
  }
}

/** A name a formula can read, grouped the way the picker lists it. */
export interface FormulaName {
  value: string
  label: string
  group: string
}

const VALID_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/

/**
 * Everything a function's formula can read, in the order the evaluator
 * resolves a clash: its parameters, its own variables, then the site's
 * variables — each dictionary's members listed under it as `name.member`,
 * since that is how a step reads one (AGL-3202).
 */
export function formulaNames(input: {
  parameters: readonly { name: string }[]
  locals: readonly { name: string }[]
  siteVariables: readonly { name?: string; type?: string; value?: string }[]
}): FormulaName[] {
  const names: FormulaName[] = []
  const seen = new Set<string>()
  const push = (value: string, label: string, group: string) => {
    if (seen.has(value)) return
    seen.add(value)
    names.push({ value, label, group })
  }
  for (const parameter of input.parameters) {
    if (VALID_NAME.test(parameter.name)) {
      push(parameter.name, parameter.name, 'Parameters')
    }
  }
  for (const local of input.locals) {
    if (VALID_NAME.test(local.name)) {
      push(local.name, local.name, 'This function’s variables')
    }
  }
  const sorted = [...input.siteVariables].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  for (const variable of sorted) {
    const name = String(variable.name ?? '')
    if (!VALID_NAME.test(name)) continue
    if (variable.type === 'collection') continue
    if (variable.type !== 'dictionary') {
      push(name, name, 'Site variables')
      continue
    }
    let entries: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(String(variable.value ?? ''))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        entries = parsed as Record<string, unknown>
      }
    } catch {
      entries = null
    }
    for (const [member, value] of Object.entries(entries ?? {})) {
      if (!VALID_NAME.test(member)) continue
      if (!['number', 'string', 'boolean'].includes(typeof value)) continue
      push(`${name}.${member}`, `${name} → ${member}`, 'Site variables')
    }
  }
  return names
}
