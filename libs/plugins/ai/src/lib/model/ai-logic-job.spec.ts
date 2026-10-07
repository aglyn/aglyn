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
  AI_LOGIC_PICK_FUNCTION_COPY,
  checkAiLogicFunction,
  checkAiLogicVariable,
  parseAiLogicJobInputs,
  readAiLogicProposal,
  type AiLogicContext,
} from './ai-logic-job'

/**
 * A logic proposal (AGL-3603) is held to what the evaluator runs: its
 * grammar, the names a function may read and set, and one run on starting
 * values. What fails is named for the re-ask; nothing failing is kept.
 */

const SITE: AiLogicContext = {
  variables: [
    { name: 'free_shipping_over', type: 'number', value: '75' },
    { name: 'flat_rate', type: 'number', value: '6' },
    { name: 'plan_prices', type: 'dictionary', value: '{"pro":49}' },
  ],
  functions: ['priceWithTax'],
}

const QUOTE = {
  name: 'shippingQuote',
  parameters: [{ name: 'order_total', type: 'number', required: true, label: 'Order total', defaultValue: '' }],
  locals: [{ name: 'quote', type: 'number' }],
  operations: [
    {
      if: { left: 'order_total', comparator: '>=', right: 'free_shipping_over' },
      then: [{ set: 'quote', expression: '0' }],
      otherwise: [{ set: 'quote', expression: 'flat_rate + order_total * 0.05' }],
    },
  ],
  returnValue: 'quote',
}

const codes = (result: { violations: Array<{ code: string }> }) => result.violations.map((one) => one.code)

describe('a logic job’s inputs', () => {
  it('reads a function, a changed function, a variable and an explanation, and refuses the rest', () => {
    expect(parseAiLogicJobInputs({})).toEqual({ mode: 'function', functionId: null })
    expect(parseAiLogicJobInputs({ mode: 'function', functionId: 'fn-1' })).toEqual({ mode: 'function', functionId: 'fn-1' })
    expect(parseAiLogicJobInputs({ mode: 'variable' })).toEqual({ mode: 'variable' })
    expect(parseAiLogicJobInputs({ mode: 'explain', functionId: 'fn-1' })).toEqual({ mode: 'explain', functionId: 'fn-1' })
    expect(parseAiLogicJobInputs({ mode: 'explain' })).toBe(AI_LOGIC_PICK_FUNCTION_COPY)
    expect(parseAiLogicJobInputs({ mode: 'function', functionId: '../x' })).toBe(AI_LOGIC_PICK_FUNCTION_COPY)
    expect(parseAiLogicJobInputs({ mode: 'publish' })).toBe('inputs.mode must be function, variable or explain')
  })
})

describe('a proposed function', () => {
  it('keeps a function the evaluator parses and runs, in the editor’s stored shape', () => {
    const result = checkAiLogicFunction(QUOTE, SITE)
    expect(result.violations).toEqual([])
    expect(result.value).toEqual({
      name: 'shippingQuote',
      parameters: [{ name: 'order_total', type: 'number', required: true, label: 'Order total' }],
      variables: [{ name: 'quote', type: 'number' }],
      operations: QUOTE.operations,
      returnValue: 'quote',
    })
  })

  it('reads a dictionary variable’s member by name.member', () => {
    const member = {
      ...QUOTE,
      operations: [{ ...QUOTE.operations[0], otherwise: [{ set: 'quote', expression: 'plan_prices.pro + 1' }] }],
    }
    expect(checkAiLogicFunction(member, SITE).violations).toEqual([])
  })

  it('refuses an expression the grammar cannot read, a name the site does not have, and a set on a site variable', () => {
    const broken = {
      ...QUOTE,
      operations: [
        {
          if: { left: 'order_total', comparator: '>=', right: 'shipping_threshold' },
          then: [{ set: 'flat_rate', expression: '0' }],
          otherwise: [{ set: 'quote', expression: 'flat_rate + (order_total' }],
        },
      ],
    }
    const result = checkAiLogicFunction(broken, SITE)
    expect(result.value).toBeNull()
    expect(codes(result)).toEqual(expect.arrayContaining(['logic-syntax', 'logic-set-target']))
    // An unknown name is only judged once the text parses.
    const unknown = checkAiLogicFunction(
      { ...QUOTE, operations: [{ ...QUOTE.operations[0], if: { ...QUOTE.operations[0].if, right: 'shipping_threshold' } }] },
      SITE,
    )
    expect(codes(unknown)).toEqual(['logic-unknown-name'])
    expect(unknown.violations[0].message).toContain('shipping_threshold')
  })

  it('refuses a call to a function that is not a built-in, a taken name, and a return that is not its own', () => {
    expect(
      codes(
        checkAiLogicFunction(
          { ...QUOTE, operations: [{ ...QUOTE.operations[0], then: [{ set: 'quote', expression: 'fetch(1)' }] }] },
          SITE,
        ),
      ),
    ).toEqual(expect.arrayContaining(['logic-syntax']))
    expect(codes(checkAiLogicFunction({ ...QUOTE, name: 'priceWithTax' }, SITE))).toEqual(['logic-name-taken'])
    // A change keeps the saved function's own name.
    expect(codes(checkAiLogicFunction({ ...QUOTE, name: 'priceWithTax' }, { ...SITE, editing: 'priceWithTax' }))).toEqual([])
    expect(codes(checkAiLogicFunction({ ...QUOTE, returnValue: 'flat_rate' }, SITE))).toEqual(['logic-return'])
  })

  it('refuses a function that fails its first run, naming the evaluator’s error', () => {
    const failing = {
      ...QUOTE,
      operations: [{ ...QUOTE.operations[0], otherwise: [{ set: 'quote', expression: 'plan_prices.basic + 1' }] }],
      parameters: [{ name: 'order_total', type: 'number', required: true, label: '', defaultValue: '1' }],
    }
    const result = checkAiLogicFunction(failing, SITE)
    expect(result.value).toBeNull()
    expect(codes(result)).toEqual(['logic-run'])
    expect(result.violations[0].message).toMatch(/^The function fails when it runs: /)
  })
})

describe('a proposed variable', () => {
  it('keeps a value in its type’s stored form, and refuses one that is not, or a taken name', () => {
    expect(checkAiLogicVariable({ name: 'tiers', type: 'dictionary', value: '{"a":1}' }, SITE).value).toEqual({
      name: 'tiers',
      type: 'dictionary',
      value: '{"a":1}',
    })
    expect(codes(checkAiLogicVariable({ name: 'tiers', type: 'dictionary', value: 'a: 1' }, SITE))).toEqual(['logic-value'])
    expect(codes(checkAiLogicVariable({ name: 'tiers', type: 'collection', value: '{"a":1}' }, SITE))).toEqual(['logic-value'])
    expect(codes(checkAiLogicVariable({ name: 'rate', type: 'number', value: 'six' }, SITE))).toEqual(['logic-value'])
    expect(codes(checkAiLogicVariable({ name: 'flat_rate', type: 'number', value: '5' }, SITE))).toEqual(['logic-name-taken'])
    expect(codes(checkAiLogicVariable({ name: '1st', type: 'text', value: 'x' }, SITE))).toEqual(['logic-name'])
  })
})

describe('a proposal read back in the browser', () => {
  it('reads a function or a variable, and nothing that is neither', () => {
    const definition = checkAiLogicFunction(QUOTE, SITE).value
    expect(readAiLogicProposal({ kind: 'function', functionId: null, definition })).toEqual({
      kind: 'function',
      functionId: null,
      definition,
    })
    expect(readAiLogicProposal({ kind: 'variable', variable: { name: 'a', type: 'text', value: 'b' } })).toEqual({
      kind: 'variable',
      variable: { name: 'a', type: 'text', value: 'b' },
    })
    expect(readAiLogicProposal({ kind: 'function', definition: { name: 'x' } })).toBeNull()
    expect(readAiLogicProposal(null)).toBeNull()
  })
})
