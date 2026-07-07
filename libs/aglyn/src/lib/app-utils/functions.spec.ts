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

describe('evaluateExpression', () => {
  const scope = { P1: 4, P2: 10, name: 'Zach', flag: true }

  it('handles precedence, parens, unary minus, and concatenation', () => {
    expect(evaluateExpression('P1 + P2 * 2', scope)).toBe(24)
    expect(evaluateExpression('(P1 + P2) * 2', scope)).toBe(28)
    expect(evaluateExpression('-P1 + 5', scope)).toBe(1)
    expect(evaluateExpression("'Hi ' + name", scope)).toBe('Hi Zach')
    expect(evaluateExpression('flag', scope)).toBe(true)
  })

  it('rejects unknown names and malformed input', () => {
    expect(() => evaluateExpression('nope + 1', scope)).toThrow('Unknown name')
    expect(() => evaluateExpression('P1 +', scope)).toThrow()
    expect(() => evaluateExpression('P1 ; P2', scope)).toThrow()
  })
})

describe('evaluateHostFunction', () => {
  // The mockup's example: if P1 <= P2 then P3 = P1 + P2, return P3.
  const definition: HostFunction = {
    name: 'Message',
    parameters: [
      { name: 'P1', type: 'number', required: true },
      { name: 'P2', type: 'number', required: true },
    ],
    variables: [{ name: 'P3', type: 'number' }],
    operations: [
      {
        if: { left: 'P1', comparator: '<=', right: 'P2' },
        then: [{ set: 'P3', expression: 'P1 + P2' }],
        otherwise: [{ set: 'P3', expression: 'P1 - P2' }],
      },
    ],
    returnValue: 'P3',
  }

  it('runs the then branch when the condition holds', () => {
    const result = evaluateHostFunction(definition, { P1: 3, P2: 7 })
    expect(result).toMatchObject({ ok: true, value: 10 })
  })

  it('runs the otherwise branch when it does not', () => {
    const result = evaluateHostFunction(definition, { P1: 9, P2: 2 })
    expect(result).toMatchObject({ ok: true, value: 7 })
  })

  it('coerces string args and enforces required parameters', () => {
    expect(
      evaluateHostFunction(definition, { P1: '1', P2: '2' }),
    ).toMatchObject({ ok: true, value: 3 })
    const missing = evaluateHostFunction(definition, { P1: 1 })
    expect(missing.ok).toBe(false)
    expect((missing as any).error).toContain('required')
  })

  it('fails safely on bad expressions instead of throwing', () => {
    const broken: HostFunction = {
      ...definition,
      operations: [
        {
          if: { left: 'P1', comparator: '<=', right: 'P2' },
          then: [{ set: 'P3', expression: 'P1 + nope' }],
          otherwise: [],
        },
      ],
    }
    const result = evaluateHostFunction(broken, { P1: 1, P2: 2 })
    expect(result.ok).toBe(false)
  })
})
