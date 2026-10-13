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

import { evaluateExpression, expressionSyntaxError } from '@aglyn/aglyn'
import {
  buildFormula,
  FORMULA_OPERATION_ORDER,
  formulaDraftFor,
  formulaNames,
} from './formula'

const name = (value: string) => ({ source: 'name' as const, name: value })
const number = (value: string) => ({ source: 'number' as const, value })
const text = (value: string) => ({ source: 'text' as const, value })

/** Builds, checks the evaluator can read it, and runs it. */
function run(
  draft: Parameters<typeof buildFormula>[0],
  scope: Record<string, number | string | boolean> = {},
  current = '',
) {
  const expression = buildFormula(draft, current)
  expect(expression).not.toBeNull()
  expect(expressionSyntaxError(expression as string)).toBeNull()
  return { expression, value: evaluateExpression(expression as string, scope) }
}

describe('a formula built by picking (AGL-3757)', () => {
  it('writes the arithmetic an author would have typed', () => {
    expect(
      run({ operation: 'add', operands: [name('P1'), name('P2'), number('3')] }, { P1: 1, P2: 2 }),
    ).toEqual({ expression: 'P1 + P2 + 3', value: 6 })
    expect(
      run({ operation: 'divide', operands: [name('total'), number('4')] }, { total: 10 }),
    ).toEqual({ expression: 'total / 4', value: 2.5 })
    expect(
      run({ operation: 'subtract', operands: [number('5'), number('-2')] }).value,
    ).toBe(7)
  })

  it('writes min, max, rounding and absolute with the built-ins', () => {
    expect(run({ operation: 'min', operands: [number('4'), number('9')] }).expression).toBe(
      'min(4, 9)',
    )
    expect(run({ operation: 'max', operands: [number('4'), number('9')] }).value).toBe(9)
    expect(
      run({ operation: 'round', operands: [number('2.456')], places: 2 }).value,
    ).toBe(2.46)
    expect(run({ operation: 'roundDown', operands: [number('2.9')] }).value).toBe(2)
    expect(run({ operation: 'roundUp', operands: [number('2.1')] }).value).toBe(3)
    expect(run({ operation: 'absolute', operands: [number('-7')] }).value).toBe(7)
  })

  it('formats money and big numbers as the docs promise', () => {
    expect(
      run({ operation: 'currency', operands: [number('1396')], places: 0 }),
    ).toEqual({ expression: "'$' + format(1396, 0)", value: '$1,396' })
    expect(
      run({ operation: 'currency', operands: [name('price')], symbol: '€' }, { price: 12.5 })
        .value,
    ).toBe('€12.50')
    expect(run({ operation: 'number', operands: [number('1234567')] }).value).toBe(
      '1,234,567',
    )
  })

  it('joins text, numbers included, without adding them', () => {
    expect(
      run({ operation: 'join', operands: [text("It's"), name('n')] }, { n: 3 }),
    ).toEqual({ expression: `"It's" + ' ' + n`, value: "It's 3" })
    expect(
      run({ operation: 'join', operands: [number('1'), number('2')], separator: '' }).value,
    ).toBe('12')
  })

  it('reads a dictionary member and wraps what the box held', () => {
    expect(
      run(
        { operation: 'multiply', operands: [{ source: 'current' }, number('12')] },
        { P1: 2, P2: 3 },
        'P1 + P2',
      ),
    ).toEqual({ expression: '(P1 + P2) * 12', value: 60 })
    expect(buildFormula({ operation: 'value', operands: [name('plan_pro.annual')] })).toBe(
      'plan_pro.annual',
    )
  })

  it('writes nothing until every value is chosen', () => {
    expect(buildFormula({ operation: 'add', operands: [name('P1'), name('')] })).toBeNull()
    expect(buildFormula({ operation: 'add', operands: [name('P1')] })).toBeNull()
    expect(buildFormula({ operation: 'value', operands: [number('abc')] })).toBeNull()
  })

  it('starts every operation complete enough to fill in', () => {
    for (const operation of FORMULA_OPERATION_ORDER) {
      const draft = formulaDraftFor(operation, undefined, 'P1')
      expect(draft.operands[0]).toEqual({ source: 'current' })
      expect(draft.operands.length).toBeGreaterThan(0)
    }
  })
})

describe('what a formula can read', () => {
  it('lists parameters, locals, then site variables with dictionary members', () => {
    expect(
      formulaNames({
        parameters: [{ name: 'P1' }, { name: 'bad name' }],
        locals: [{ name: 'P3' }, { name: 'P1' }],
        siteVariables: [
          { name: 'tax', type: 'number', value: '0.08' },
          { name: 'plan_pro', type: 'dictionary', value: '{"annual":39,"tiers":[1]}' },
          { name: 'tags', type: 'collection', value: '["a"]' },
        ],
      }),
    ).toEqual([
      { value: 'P1', label: 'P1', group: 'Parameters' },
      { value: 'P3', label: 'P3', group: 'This function’s variables' },
      { value: 'plan_pro.annual', label: 'plan_pro → annual', group: 'Site variables' },
      { value: 'tax', label: 'tax', group: 'Site variables' },
    ])
  })
})
