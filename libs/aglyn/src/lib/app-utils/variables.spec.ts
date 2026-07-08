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
  formatVariableValue,
  resolveBindings,
  resolveNodesBindings,
} from './variables'

// Id-keyed lookups (AGL-194): map keys are doc ids; names live on the
// values and only matter for expression scopes.
const variables = {
  idMessage01: { name: 'Message', type: 'text', value: 'Hello world' },
  idCount0002: { name: 'count', type: 'number', value: '42' },
  idLive00003: { name: 'live', type: 'boolean', value: 'true' },
  idTags00004: { name: 'tags', type: 'collection', value: '["a","b"]' },
  idMeta00005: { name: 'meta', type: 'dictionary', value: '{"k":"v"}' },
  idLaunch006: { name: 'launch', type: 'date', value: '2026-07-04' },
} as const

describe('resolveBindings', () => {
  it('replaces known tokens and formats per type', () => {
    expect(
      resolveBindings(
        '{{var:idMessage01}} x{{var:idCount0002}} live={{var:idLive00003}}',
        variables as any,
      ),
    ).toBe('Hello world x42 live=true')
    expect(resolveBindings('{{var:idTags00004}}', variables as any)).toBe(
      'a, b',
    )
    expect(resolveBindings('{{var:idMeta00005}}', variables as any)).toBe(
      'k: v',
    )
    expect(
      resolveBindings('{{var:idLaunch006}}', variables as any),
    ).toContain('2026')
  })

  it('keeps unknown tokens literal', () => {
    expect(resolveBindings('hey {{nope}}', variables as any)).toBe(
      'hey {{nope}}',
    )
  })

  it('resolves {{fn:name(args)}} through the evaluator (AGL-93)', () => {
    const functions = {
      Sum: {
        name: 'Sum',
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
      },
    } as const
    expect(
      resolveBindings('Total: {{fn:Sum(3, 7)}}', variables as any, functions as any),
    ).toBe('Total: 10')
    // Variable names work as arguments (42 > 8 → otherwise branch).
    expect(
      resolveBindings('{{fn:Sum(count, 8)}}', variables as any, functions as any),
    ).toBe('34')
    // Unknown function or failing run keeps the token literal.
    expect(
      resolveBindings('{{fn:Nope(1)}}', variables as any, functions as any),
    ).toBe('{{fn:Nope(1)}}')
    expect(
      resolveBindings('{{fn:Sum()}}', variables as any, functions as any),
    ).toBe('{{fn:Sum()}}')
  })

  it('formats invalid numbers/dates defensively', () => {
    expect(
      formatVariableValue({ name: 'n', type: 'number', value: 'zzz' }),
    ).toBe('')
    expect(
      formatVariableValue({ name: 'd', type: 'date', value: 'not a date' }),
    ).toBe('not a date')
  })
})

describe('attachFunctionDefinitions', () => {
  it('injects definitions into function widgets only', () => {
    const { attachFunctionDefinitions } = require('./variables')
    const definition = { name: 'Sum', parameters: [], variables: [], operations: [] }
    const nodes = {
      widget: {
        $id: 'widget',
        componentId: 'functionWidget',
        props: { functionName: 'Sum' },
      },
      other: { $id: 'other', componentId: 'muiTypography', props: {} },
      unknown: {
        $id: 'unknown',
        componentId: 'functionWidget',
        props: { functionName: 'Nope' },
      },
    }
    const result = attachFunctionDefinitions(nodes, { Sum: definition })
    expect(result.widget.props.definition).toEqual(definition)
    expect(result.other).toBe(nodes.other)
    expect(result.unknown.props.definition).toBeUndefined()
  })
})

describe('resolveNodesBindings', () => {
  it('rewrites string props only and preserves untouched nodes', () => {
    const nodes = {
      a: {
        $id: 'a',
        props: { children: 'Hi {{var:idMessage01}}', sx: { m: 1 } },
      },
      b: { $id: 'b', props: { children: 'static' } },
      c: { $id: 'c' },
    }
    const result = resolveNodesBindings(nodes as any, variables as any)
    expect(result['a'].props.children).toBe('Hi Hello world')
    expect(result['a'].props.sx).toEqual({ m: 1 })
    expect(result['b']).toBe(nodes.b)
    expect(result['c']).toBe(nodes.c)
  })

  it('returns the input map when no variables exist', () => {
    const nodes = { a: { $id: 'a', props: { children: '{{Message}}' } } }
    expect(resolveNodesBindings(nodes as any, {})).toBe(nodes)
  })
})
