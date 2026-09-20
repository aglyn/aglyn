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
  FUNCTION_BUILTIN_NAMES,
  FUNCTION_MAX_OPERATIONS,
  evaluateExpression,
  evaluateHostFunction,
  expressionIdentifiers,
  formatFunctionParameterOptions,
  functionReferencedNames,
  parseFunctionParameterOptions,
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

describe('built-ins (AGL-3202)', () => {
  it('is a closed table', () => {
    expect([...FUNCTION_BUILTIN_NAMES].sort()).toEqual(
      ['abs', 'ceil', 'floor', 'format', 'max', 'min', 'round'].sort(),
    )
  })

  it('picks the cheapest of three plans in one expression', () => {
    // The shape that took three compares: a plan plus $20 for each site past
    // what it includes, for 50 sites.
    const scope = { sites: 50, extra: 20 }
    expect(
      evaluateExpression(
        'min(99 + max(0, sites - 10) * extra, 299 + max(0, sites - 25) * extra, 1049 + max(0, sites - 100) * extra)',
        scope,
      ),
    ).toBe(799)
  })

  it('rounds the decimal value, half away from zero', () => {
    expect(evaluateExpression('round(346 / 25, 2)', {})).toBe(13.84)
    // 1.005 * 100 is 100.49999999999999 in binary; the answer is still 1.01.
    expect(evaluateExpression('round(1.005, 2)', {})).toBe(1.01)
    expect(evaluateExpression('round(2.5)', {})).toBe(3)
    expect(evaluateExpression('round(-2.5)', {})).toBe(-3)
    expect(evaluateExpression('floor(13.99) + ceil(0.01) + abs(-4)', {})).toBe(
      18,
    )
  })

  it('formats the same on every machine', () => {
    expect(evaluateExpression("'$' + format(1396)", {})).toBe('$1,396')
    expect(evaluateExpression("'$' + format(346 / 25, 2)", {})).toBe('$13.84')
    expect(evaluateExpression('format(3000000)', {})).toBe('3,000,000')
    expect(evaluateExpression('format(99.5)', {})).toBe('100')
  })

  it('nests, and takes expressions as arguments', () => {
    expect(evaluateExpression('max(min(7, 3 + 1), round(1.2) * 2)', {})).toBe(4)
  })

  it('refuses a wrong argument count, an unknown call and a stray comma', () => {
    expect(() => evaluateExpression('round()', {})).toThrow('round() takes')
    expect(() => evaluateExpression('abs(1, 2)', {})).toThrow('abs() takes')
    expect(() => evaluateExpression('round(1, 11)', {})).toThrow(
      'Decimal places',
    )
    expect(() => evaluateExpression('nope(1)', {})).toThrow('Unknown function')
    expect(() => evaluateExpression('min(1, 2', {})).toThrow(
      'closing parenthesis',
    )
    expect(() => evaluateExpression('1, 2', {})).toThrow('trailing')
    expect(() => evaluateExpression("min('a', 2)", {})).toThrow('not a number')
  })

  it('leaves a VALUE named like a built-in alone', () => {
    // Definitions written before the table existed may hold a local called
    // `min` or `round`; without a parenthesis it is still their value.
    expect(evaluateExpression('min + max', { min: 2, max: 5 })).toBe(7)
    expect(evaluateExpression('min(min, max)', { min: 2, max: 5 })).toBe(2)
  })

  it('reads own names only, never the prototype chain', () => {
    expect(() => evaluateExpression('toString', {})).toThrow('Unknown name')
    expect(() => evaluateExpression('constructor', {})).toThrow('Unknown name')
  })
})

describe('expressionIdentifiers / functionReferencedNames (AGL-3202)', () => {
  it('names what an expression reads, not the built-ins it calls', () => {
    expect(expressionIdentifiers('min(a, b) + round(c / sites, 2)')).toEqual([
      'a',
      'b',
      'c',
      'sites',
    ])
    expect(expressionIdentifiers("'text with names' + true")).toEqual([])
    expect(expressionIdentifiers('a ; b')).toEqual([])
  })

  it('names only what a function reads from OUTSIDE itself', () => {
    const definition: HostFunction = {
      name: 'webflow',
      parameters: [{ name: 'sites', type: 'number' }],
      variables: [{ name: 'total', type: 'number' }],
      operations: [
        {
          if: { left: 'sites', comparator: '>', right: 'duda_included' },
          then: [{ set: 'total', expression: 'sites * webflow_site' }],
          otherwise: [{ set: 'total', expression: 'total + webflow_site' }],
        },
      ],
      returnValue: 'total',
    }
    expect(functionReferencedNames(definition).sort()).toEqual([
      'duda_included',
      'webflow_site',
    ])
  })
})

describe('site variables as the outer scope (AGL-3202)', () => {
  const definition: HostFunction = {
    name: 'cost',
    parameters: [{ name: 'sites', type: 'number', required: true }],
    variables: [{ name: 'total', type: 'number' }],
    operations: [
      {
        if: { left: '1', comparator: '==', right: '1' },
        then: [{ set: 'total', expression: 'sites * per_site' }],
        otherwise: [],
      },
    ],
    returnValue: 'total',
  }

  it('reads a global it names', () => {
    expect(
      evaluateHostFunction(
        definition,
        { sites: 10 },
        { globals: { per_site: 25 } },
      ),
    ).toMatchObject({ ok: true, value: 250 })
  })

  it('still fails, by name, when nobody supplies it', () => {
    const result = evaluateHostFunction(definition, { sites: 10 })
    expect(result).toMatchObject({ ok: false })
    expect((result as any).error).toContain('per_site')
  })

  it('lets the function’s own names win', () => {
    // A site variable called `sites` must not change what the visitor typed.
    expect(
      evaluateHostFunction(
        definition,
        { sites: 10 },
        { globals: { per_site: 25, sites: 999, total: 5 } },
      ),
    ).toMatchObject({ ok: true, value: 250 })
  })

  it('refuses to SET a global, and says which kind of name it is', () => {
    const writes: HostFunction = {
      ...definition,
      operations: [
        {
          if: { left: '1', comparator: '==', right: '1' },
          then: [{ set: 'per_site', expression: '1' }],
          otherwise: [],
        },
      ],
    }
    const result = evaluateHostFunction(
      writes,
      { sites: 1 },
      { globals: { per_site: 25 } },
    )
    expect(result).toMatchObject({ ok: false })
    expect((result as any).error).toContain('site variable')
    const unknown = evaluateHostFunction(writes, { sites: 1 })
    expect((unknown as any).error).toContain('Unknown variable')
  })
})

describe('parameter defaults (AGL-3202)', () => {
  const definition: HostFunction = {
    name: 'echo',
    parameters: [
      { name: 'sites', type: 'number', required: true, defaultValue: '25' },
      { name: 'cms', type: 'boolean', defaultValue: 'true' },
      { name: 'note', type: 'text' },
    ],
    variables: [{ name: 'out', type: 'text' }],
    operations: [
      {
        if: { left: 'cms', comparator: '==', right: 'true' },
        then: [{ set: 'out', expression: "sites + ' with'" }],
        otherwise: [{ set: 'out', expression: "sites + ' without'" }],
      },
    ],
    returnValue: 'out',
  }

  it('fills an empty input, and that satisfies required', () => {
    expect(evaluateHostFunction(definition, {})).toMatchObject({
      ok: true,
      value: '25 with',
    })
    expect(evaluateHostFunction(definition, { sites: '' })).toMatchObject({
      ok: true,
      value: '25 with',
    })
  })

  it('never overrides what was given', () => {
    expect(
      evaluateHostFunction(definition, { sites: '7', cms: 'false' }),
    ).toMatchObject({ ok: true, value: '7 without' })
  })
})

describe('a choice list as one line of text (AGL-3202)', () => {
  it('reads pairs, bare entries and numbers, and round-trips', () => {
    expect(parseFunctionParameterOptions('cms: A CMS, entry: Entry only, 10, 25')).toEqual([
      { value: 'cms', label: 'A CMS' },
      { value: 'entry', label: 'Entry only' },
      { value: '10' },
      { value: '25' },
    ])
    expect(formatFunctionParameterOptions(parseFunctionParameterOptions('a: One, b'))).toBe('a: One, b')
    expect(parseFunctionParameterOptions(undefined)).toEqual([])
  })
})

describe('dictionary members (AGL-3202)', () => {
  const pro = JSON.stringify({ name: 'Pro', annual: 39, sites: 3, api: false, limits: { pages: 100 } })
  const scope = { plan_pro: pro, sites: 5, extra_site: 20, label: 'not json', count: 3 }

  it('reads a member of a dictionary variable, of any of the three kinds', () => {
    expect(evaluateExpression('plan_pro.annual + max(0, sites - plan_pro.sites) * extra_site', scope)).toBe(79)
    expect(evaluateExpression("plan_pro.name + ' plan'", scope)).toBe('Pro plan')
    expect(evaluateExpression('plan_pro.api', scope)).toBe(false)
    expect(evaluateExpression('plan_pro.limits.pages', scope)).toBe(100)
  })

  it('says which name it could not read, and never returns a dictionary', () => {
    expect(() => evaluateExpression('plan_pro.monthly', scope)).toThrow('Unknown name "plan_pro.monthly"')
    expect(() => evaluateExpression('plan_free.annual', scope)).toThrow('Unknown name "plan_free"')
    expect(() => evaluateExpression('label.annual', scope)).toThrow('is not a dictionary')
    expect(() => evaluateExpression('count.annual', scope)).toThrow('is not a dictionary')
    expect(() => evaluateExpression('plan_pro.limits', scope)).toThrow('is not a number')
    expect(() => evaluateExpression('plan_pro.constructor', scope)).toThrow('Unknown name')
    expect(() => evaluateExpression('plan_pro.', scope)).toThrow()
  })

  it('leaves a decimal number alone', () => {
    expect(evaluateExpression('1.5 + 0.25 * 2', {})).toBe(2)
  })

  it('names the VARIABLE a path reads, which is what compose ships to a page', () => {
    expect(expressionIdentifiers('plan_pro.annual + chosen.seat_rate * seats')).toEqual([
      'plan_pro',
      'chosen',
      'seats',
    ])
  })

  it('lets a function pick one dictionary and then read it', () => {
    const definition: HostFunction = {
      name: 'cheapest',
      parameters: [{ name: 'sites', type: 'number', required: true }],
      variables: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
        { name: 'chosen', type: 'text' },
        { name: 'out', type: 'text' },
      ],
      operations: [
        {
          if: { left: '1', comparator: '==', right: '1' },
          then: [
            { set: 'a', expression: 'plan_a.price + max(0, sites - plan_a.sites) * 20' },
            { set: 'b', expression: 'plan_b.price + max(0, sites - plan_b.sites) * 20' },
            { set: 'chosen', expression: 'plan_b' },
          ],
          otherwise: [],
        },
        { if: { left: 'a', comparator: '<=', right: 'b' }, then: [{ set: 'chosen', expression: 'plan_a' }], otherwise: [] },
        {
          if: { left: '1', comparator: '==', right: '1' },
          then: [{ set: 'out', expression: "chosen.name + ' at $' + format(min(a, b))" }],
          otherwise: [],
        },
      ],
      returnValue: 'out',
    }
    const globals = {
      plan_a: JSON.stringify({ name: 'Business', price: 99, sites: 10 }),
      plan_b: JSON.stringify({ name: 'Scale', price: 179, sites: 15 }),
    }
    expect(evaluateHostFunction(definition, { sites: 12 }, { globals })).toMatchObject({ ok: true, value: 'Business at $139' })
    expect(evaluateHostFunction(definition, { sites: 15 }, { globals })).toMatchObject({ ok: true, value: 'Scale at $179' })
    expect(functionReferencedNames(definition).sort()).toEqual(['plan_a', 'plan_b'])
  })
})

describe('the operation bound (AGL-3202)', () => {
  const chain = (count: number): HostFunction => ({
    name: 'chain',
    parameters: [],
    variables: [{ name: 'n', type: 'number' }],
    operations: [
      {
        if: { left: '1', comparator: '==', right: '1' },
        then: Array.from({ length: count }, () => ({ set: 'n', expression: 'n + 1' })),
        otherwise: [],
      },
    ],
    returnValue: 'n',
  })

  it('runs a pricing-calculator-sized function', () => {
    expect(evaluateHostFunction(chain(150), {})).toMatchObject({ ok: true, value: 150 })
  })

  it('is still a bound', () => {
    expect(evaluateHostFunction(chain(FUNCTION_MAX_OPERATIONS), {})).toMatchObject({ ok: true })
    const over = evaluateHostFunction(chain(FUNCTION_MAX_OPERATIONS + 1), {})
    expect(over).toMatchObject({ ok: false })
    expect((over as any).error).toContain('Operation limit')
  })
})

