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
 * names, numeric/string/boolean literals, and + - * / ( ).
 */

export type FunctionValueType = 'number' | 'text' | 'boolean'

export interface HostFunctionParameter {
  name: string
  type: FunctionValueType
  required?: boolean
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
      if (!(token.value in scope)) {
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
export function evaluateHostFunction(
  definition: HostFunction,
  args: Record<string, unknown>,
): FunctionRunResult {
  try {
    const scope: Scope = {}
    for (const parameter of definition.parameters ?? []) {
      const provided = args[parameter.name]
      if (provided == null || provided === '') {
        if (parameter.required) {
          throw new Error(`Parameter "${parameter.name}" is required`)
        }
        scope[parameter.name] = defaultValue(parameter.type)
      } else {
        scope[parameter.name] = coerce(parameter.type, provided)
      }
    }
    for (const variable of definition.variables ?? []) {
      scope[variable.name] = defaultValue(variable.type)
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
        if (!(setOperation.set in scope)) {
          throw new Error(`Unknown variable "${setOperation.set}"`)
        }
        scope[setOperation.set] = evaluateExpression(
          setOperation.expression,
          scope,
        )
      }
    }

    const returnName = definition.returnValue
    const value =
      returnName && returnName in scope ? scope[returnName] : ''
    return { ok: true, value, scope }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
