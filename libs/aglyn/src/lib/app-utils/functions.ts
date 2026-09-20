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
 * No-code functions (Component Builder, AGL-92): the mockup's Edit Function
 * model — parameters, local variables, conditional SET operations, and a
 * return value — plus a small, safe expression evaluator. No eval(), no
 * loops, bounded operation count; expressions only reference declared
 * names, numeric/string/boolean literals, + - * / ( ), and the fixed table
 * of built-ins below.
 *
 * WHAT A REAL CALCULATOR NEEDED (AGL-3202). The first page built on this — a
 * cost sheet comparing five platforms — could compute its static table and
 * could not carry its interactive half, for three reasons that live here:
 *
 * - No `min`, no rounding, no number formatting. "Cheapest of three plans"
 *   took three compares, a per-site cost could not be shown at all, and
 *   "$1,396" was built by peeling thousands off with a ladder of six
 *   compares. {@link BUILTINS} closes that: a FIXED table, called as
 *   `name(args)`. Nothing a site author writes can add to it, so the
 *   evaluator's promise — no eval, no loops, bounded — is unchanged.
 * - A function could not read a site variable, so a widget's function had
 *   to repeat every price as a literal. `globals` on
 *   {@link EvaluateFunctionOptions} is that outer scope: readable, never
 *   settable, and shadowed by a parameter or local of the same name.
 * - A parameter was a bare identifier and a type. It may now carry what a
 *   visitor should see and start with: `label`, `options`, `defaultValue`.
 */

export type FunctionValueType = 'number' | 'text' | 'boolean'

/** One entry of a parameter's choice list (AGL-3202). */
export interface HostFunctionParameterOption {
  /** What the function receives; coerced to the parameter's type. */
  value: string
  /** What the visitor reads; the value when absent. */
  label?: string
}

/**
 * A choice list as ONE line of text (AGL-3202):
 * `cms: A CMS and room to grow, entry: The entry plan only`. A bare entry is
 * both the value and what the visitor reads.
 *
 * One line, not a nested editor, because every surface that asks for choices
 * already asks for several other things in the same row. The cost is that a
 * value cannot itself contain a comma, and a label cannot either; a choice
 * that needs one is a sign the question wants rewording.
 *
 * In core because two plugins read it — the function builder that stores a
 * parameter's choices and the canvas element that offers its own — and a
 * plugin may not import another.
 */
export function parseFunctionParameterOptions(
  text: string | null | undefined,
): HostFunctionParameterOption[] {
  const options: HostFunctionParameterOption[] = []
  const seen = new Set<string>()
  for (const part of String(text ?? '').split(',')) {
    const colon = part.indexOf(':')
    const value = (colon < 0 ? part : part.slice(0, colon)).trim()
    // The second copy of a value is a typo, not a second choice: a select
    // with two identical values cannot tell the function which was picked.
    if (!value || seen.has(value)) continue
    seen.add(value)
    const label = colon < 0 ? '' : part.slice(colon + 1).trim()
    options.push(label && label !== value ? { value, label } : { value })
  }
  return options
}

/** The inverse, for showing a stored list in that one line. */
export function formatFunctionParameterOptions(
  options: HostFunctionParameterOption[] | null | undefined,
): string {
  return (options ?? [])
    .map((option) =>
      option.label && option.label !== option.value
        ? `${option.value}: ${option.label}`
        : option.value,
    )
    .join(', ')
}

export interface HostFunctionParameter {
  name: string
  type: FunctionValueType
  required?: boolean
  /**
   * What a visitor reads above the input (AGL-3202). The identifier is an
   * authoring name — `client_sites` — and was the only label a Function
   * Widget had.
   */
  label?: string
  /**
   * A fixed list to choose from; the widget renders a select. There is no
   * other way to ASK a visitor for a choice: a free-text box that has to be
   * typed into exactly is not a question.
   */
  options?: HostFunctionParameterOption[]
  /**
   * What the input starts with, and what an empty input evaluates as. It
   * satisfies `required`: a parameter with a default is never missing.
   */
  defaultValue?: string
}

export interface HostFunctionVariable {
  name: string
  type: FunctionValueType
}

export type FunctionComparator = '==' | '!=' | '<' | '<=' | '>' | '>='

export interface FunctionSetOperation {
  /** Variable (or parameter) name receiving the value. */
  set: string
  /** Expression text, e.g. `P1 + P2` or `(P1 + 1) * 2`. */
  expression: string
  /**
   * Workflow (by name) whose result to assign instead of `expression`
   * (AGL-129). Runs with the function's current scope visible; only
   * honored when the caller provides a workflow runner.
   */
  workflow?: string
}

/** The mockup's numbered operation card: if / then / otherwise. */
export interface FunctionConditionalOperation {
  if: { left: string; comparator: FunctionComparator; right: string }
  then: FunctionSetOperation[]
  otherwise: FunctionSetOperation[]
}

/** `hosts/{hostId}/functions/{id}` doc. */
export interface HostFunction {
  name: string
  parameters: HostFunctionParameter[]
  variables: HostFunctionVariable[]
  operations: FunctionConditionalOperation[]
  /** Name whose final value the function returns. */
  returnValue?: string
}

export const FUNCTION_MAX_OPERATIONS = 100

type Scope = Record<string, number | string | boolean>

// ── Expression parsing (recursive descent, standard precedence) ────────────

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (/\s/.test(char)) {
      index += 1
    } else if ('+-*/'.includes(char)) {
      tokens.push({ kind: 'op', value: char as any })
      index += 1
    } else if (char === '(') {
      tokens.push({ kind: 'lparen' })
      index += 1
    } else if (char === ')') {
      tokens.push({ kind: 'rparen' })
      index += 1
    } else if (char === ',') {
      // Only meaningful between a built-in's arguments; anywhere else the
      // parser reports it as trailing input.
      tokens.push({ kind: 'comma' })
      index += 1
    } else if (char === "'" || char === '"') {
      const end = text.indexOf(char, index + 1)
      if (end < 0) throw new Error('Unterminated string')
      tokens.push({ kind: 'string', value: text.slice(index + 1, end) })
      index = end + 1
    } else if (/[0-9.]/.test(char)) {
      const match = /^[0-9]*\.?[0-9]+/.exec(text.slice(index))
      if (!match) throw new Error(`Bad number at "${text.slice(index)}"`)
      tokens.push({ kind: 'number', value: Number(match[0]) })
      index += match[0].length
    } else if (/[a-zA-Z_]/.test(char)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(index))!
      const word = match[0]
      if (word === 'true' || word === 'false') {
        tokens.push({ kind: 'boolean', value: word === 'true' })
      } else {
        tokens.push({ kind: 'ident', value: word })
      }
      index += word.length
    } else {
      throw new Error(`Unexpected character "${char}"`)
    }
  }
  return tokens
}

// ── Built-ins (AGL-3202) ───────────────────────────────────────────────────

type Value = number | string | boolean

/** More arguments than any built-in can use; a typo, not a calculation. */
const MAX_CALL_ARGUMENTS = 16
/** Decimal places `round` and `format` accept. */
const MAX_DIGITS = 10

function digitsOf(value: Value | undefined): number {
  if (value === undefined) return 0
  const digits = Math.trunc(toNumber(value))
  if (digits < 0 || digits > MAX_DIGITS) {
    throw new Error(`Decimal places must be between 0 and ${MAX_DIGITS}`)
  }
  return digits
}

/**
 * Half away from zero, on the DECIMAL value. The exponent form is what makes
 * `round(1.005, 2)` answer 1.01: multiplying by 100 first gives
 * 100.49999999999999 and rounds it down.
 */
function roundTo(value: number, digits: number): number {
  const magnitude = Number(
    `${Math.round(Number(`${Math.abs(value)}e${digits}`))}e-${digits}`,
  )
  return value < 0 ? -magnitude : magnitude
}

function arity(name: string, args: Value[], least: number, most: number): void {
  if (args.length < least || args.length > most) {
    const wanted = least === most ? `${least}` : `${least} to ${most}`
    throw new Error(`${name}() takes ${wanted} argument(s)`)
  }
}

/**
 * THE WHOLE TABLE, and it is closed. A site author calls these; nothing they
 * write can add one, and none of them loops, allocates by input size or
 * reaches outside its arguments.
 *
 * `format` is pinned to `en-US` on purpose. The same function runs on the
 * server for a `{{fn:…}}` token and in a visitor's browser for a widget, and
 * the machine's own locale would make those two disagree about "1,396".
 */
const BUILTINS: Record<string, (args: Value[]) => Value> = {
  min: (args) => {
    arity('min', args, 1, MAX_CALL_ARGUMENTS)
    return Math.min(...args.map(toNumber))
  },
  max: (args) => {
    arity('max', args, 1, MAX_CALL_ARGUMENTS)
    return Math.max(...args.map(toNumber))
  },
  round: (args) => {
    arity('round', args, 1, 2)
    return roundTo(toNumber(args[0]), digitsOf(args[1]))
  },
  floor: (args) => {
    arity('floor', args, 1, 1)
    return Math.floor(toNumber(args[0]))
  },
  ceil: (args) => {
    arity('ceil', args, 1, 1)
    return Math.ceil(toNumber(args[0]))
  },
  abs: (args) => {
    arity('abs', args, 1, 1)
    return Math.abs(toNumber(args[0]))
  },
  format: (args) => {
    arity('format', args, 1, 2)
    const digits = digitsOf(args[1])
    return roundTo(toNumber(args[0]), digits).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  },
}

/** The built-in names, for an editor's help text and for tests. */
export const FUNCTION_BUILTIN_NAMES: readonly string[] = Object.keys(BUILTINS)

function isBuiltin(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTINS, name)
}

/**
 * The names an expression READS, in order, without evaluating it: every
 * identifier that is not a built-in being called. Malformed text names
 * nothing — the evaluator is where a bad expression is reported.
 */
export function expressionIdentifiers(text: string): string[] {
  let tokens: Token[]
  try {
    tokens = tokenize(String(text ?? ''))
  } catch {
    return []
  }
  const names: string[] = []
  tokens.forEach((token, index) => {
    if (token.kind !== 'ident') return
    if (tokens[index + 1]?.kind === 'lparen' && isBuiltin(token.value)) return
    names.push(token.value)
  })
  return names
}

/** Evaluates an expression against the scope. Throws on any invalid input. */
export function evaluateExpression(
  text: string,
  scope: Scope,
): number | string | boolean {
  const tokens = tokenize(text)
  let position = 0

  const peek = () => tokens[position]
  const next = () => tokens[position++]

  function factor(): number | string | boolean {
    const token = next()
    if (!token) throw new Error('Unexpected end of expression')
    if (token.kind === 'number' || token.kind === 'string' || token.kind === 'boolean') {
      return token.value
    }
    if (token.kind === 'ident') {
      // A CALL, only when the parenthesis follows. A scope may still hold a
      // value named `min` and read it as `min`, which is what every
      // definition written before the built-ins existed relies on.
      if (peek()?.kind === 'lparen') {
        if (!isBuiltin(token.value)) {
          throw new Error(`Unknown function "${token.value}"`)
        }
        next()
        const args: Value[] = []
        if (peek()?.kind !== 'rparen') {
          args.push(expression())
          while (peek()?.kind === 'comma') {
            next()
            args.push(expression())
          }
        }
        const closing = next()
        if (!closing || closing.kind !== 'rparen') {
          throw new Error('Missing closing parenthesis')
        }
        return BUILTINS[token.value](args)
      }
      // OWN properties only: `in` walks the prototype chain, so `toString`
      // and `constructor` used to read as names every scope declared.
      if (!Object.prototype.hasOwnProperty.call(scope, token.value)) {
        throw new Error(`Unknown name "${token.value}"`)
      }
      return scope[token.value]
    }
    if (token.kind === 'lparen') {
      const value = expression()
      const closing = next()
      if (!closing || closing.kind !== 'rparen') {
        throw new Error('Missing closing parenthesis')
      }
      return value
    }
    if (token.kind === 'op' && token.value === '-') {
      return -toNumber(factor())
    }
    throw new Error('Unexpected token')
  }

  function term(): number | string | boolean {
    let value = factor()
    while (peek()?.kind === 'op' && ['*', '/'].includes((peek() as any).value)) {
      const operator = (next() as any).value
      const right = toNumber(factor())
      value =
        operator === '*' ? toNumber(value) * right : toNumber(value) / right
    }
    return value
  }

  function expression(): number | string | boolean {
    let value = term()
    while (peek()?.kind === 'op' && ['+', '-'].includes((peek() as any).value)) {
      const operator = (next() as any).value
      const right = term()
      if (operator === '+') {
        // `+` concatenates when either side is a string, like the templates.
        value =
          typeof value === 'string' || typeof right === 'string'
            ? String(value) + String(right)
            : toNumber(value) + toNumber(right)
      } else {
        value = toNumber(value) - toNumber(right)
      }
    }
    return value
  }

  const result = expression()
  if (position < tokens.length) throw new Error('Unexpected trailing input')
  return result
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`"${value}" is not a number`)
  }
  return parsed
}

function compare(
  left: number | string | boolean,
  comparator: FunctionComparator,
  right: number | string | boolean,
): boolean {
  switch (comparator) {
    case '==':
      return left === right
    case '!=':
      return left !== right
    case '<':
      return toNumber(left) < toNumber(right)
    case '<=':
      return toNumber(left) <= toNumber(right)
    case '>':
      return toNumber(left) > toNumber(right)
    case '>=':
      return toNumber(left) >= toNumber(right)
    default:
      throw new Error(`Unknown comparator "${comparator}"`)
  }
}

function defaultValue(type: FunctionValueType): number | string | boolean {
  return type === 'number' ? 0 : type === 'boolean' ? false : ''
}

function coerce(
  type: FunctionValueType,
  value: unknown,
): number | string | boolean {
  if (type === 'number') return toNumber(value)
  if (type === 'boolean') return value === true || value === 'true'
  return String(value ?? '')
}

export type FunctionRunResult =
  | { ok: true; value: number | string | boolean; scope: Scope }
  | { ok: false; error: string }

/**
 * Runs a function definition against arguments: parameters coerce/validate
 * into scope, variables initialize to type defaults, each conditional
 * evaluates its `if` and applies the matching SET list in order, and the
 * `returnValue` name's final value comes back.
 */
export interface EvaluateFunctionOptions {
  /**
   * Workflow invoker for `set.workflow` operations (AGL-129); wired by
   * `runWorkflow` so cross-calls share one depth guard. Absent means
   * workflow operations fail with a clear error.
   */
  invokeWorkflow?: (
    name: string,
    scope: Scope,
  ) => number | string | boolean
  /**
   * Site variables by NAME (AGL-3202): the scope outside the function.
   *
   * READ-ONLY, and the function's own names win. A parameter or local of the
   * same name shadows the variable, so adding a site variable can never
   * change what an existing function computes; and a SET may only target a
   * parameter or a local, so a function cannot appear to change a value that
   * every other page reads.
   */
  globals?: Scope
}

export function evaluateHostFunction(
  definition: HostFunction,
  args: Record<string, unknown>,
  options?: EvaluateFunctionOptions,
): FunctionRunResult {
  try {
    const scope: Scope = {}
    for (const [name, value] of Object.entries(options?.globals ?? {})) {
      scope[name] = value
    }
    // What a SET may target: the function's own names, never a global.
    const writable = new Set<string>()
    for (const parameter of definition.parameters ?? []) {
      const provided = args[parameter.name]
      const fallback = parameter.defaultValue
      if (provided == null || provided === '') {
        if (fallback != null && fallback !== '') {
          scope[parameter.name] = coerce(parameter.type, fallback)
        } else if (parameter.required) {
          throw new Error(`Parameter "${parameter.name}" is required`)
        } else {
          scope[parameter.name] = defaultValue(parameter.type)
        }
      } else {
        scope[parameter.name] = coerce(parameter.type, provided)
      }
      writable.add(parameter.name)
    }
    for (const variable of definition.variables ?? []) {
      scope[variable.name] = defaultValue(variable.type)
      writable.add(variable.name)
    }

    const operations = definition.operations ?? []
    let applied = 0
    for (const operation of operations) {
      const passed = compare(
        evaluateExpression(operation.if.left, scope),
        operation.if.comparator,
        evaluateExpression(operation.if.right, scope),
      )
      for (const setOperation of passed
        ? (operation.then ?? [])
        : (operation.otherwise ?? [])) {
        if ((applied += 1) > FUNCTION_MAX_OPERATIONS) {
          throw new Error('Operation limit exceeded')
        }
        if (!writable.has(setOperation.set)) {
          throw new Error(
            Object.prototype.hasOwnProperty.call(scope, setOperation.set)
              ? `"${setOperation.set}" is a site variable: a function can ` +
                  'read it, not set it'
              : `Unknown variable "${setOperation.set}"`,
          )
        }
        if (setOperation.workflow) {
          if (!options?.invokeWorkflow) {
            throw new Error('Workflow calls are not available here')
          }
          scope[setOperation.set] = options.invokeWorkflow(
            setOperation.workflow,
            scope,
          )
        } else {
          scope[setOperation.set] = evaluateExpression(
            setOperation.expression,
            scope,
          )
        }
      }
    }

    const returnName = definition.returnValue
    const value =
      returnName && Object.prototype.hasOwnProperty.call(scope, returnName)
        ? scope[returnName]
        : ''
    return { ok: true, value, scope }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * The OUTSIDE names a function reads (AGL-3202): every identifier in its
 * conditions and expressions that is not one of its own parameters or
 * locals. Compose uses this to hand a Function Widget only the site
 * variables its function asks for, so a published page never carries a
 * variable nobody named.
 */
export function functionReferencedNames(definition: HostFunction): string[] {
  const own = new Set<string>([
    ...(definition.parameters ?? []).map((parameter) => parameter.name),
    ...(definition.variables ?? []).map((variable) => variable.name),
  ])
  const names = new Set<string>()
  const read = (text: unknown) => {
    for (const name of expressionIdentifiers(String(text ?? ''))) {
      if (!own.has(name)) names.add(name)
    }
  }
  for (const operation of definition.operations ?? []) {
    read(operation.if?.left)
    read(operation.if?.right)
    for (const setOperation of [
      ...(operation.then ?? []),
      ...(operation.otherwise ?? []),
    ]) {
      read(setOperation.expression)
    }
  }
  return [...names]
}
