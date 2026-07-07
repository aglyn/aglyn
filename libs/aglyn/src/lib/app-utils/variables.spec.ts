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

const variables = {
  Message: { name: 'Message', type: 'text', value: 'Hello world' },
  count: { name: 'count', type: 'number', value: '42' },
  live: { name: 'live', type: 'boolean', value: 'true' },
  tags: { name: 'tags', type: 'collection', value: '["a","b"]' },
  meta: { name: 'meta', type: 'dictionary', value: '{"k":"v"}' },
  launch: { name: 'launch', type: 'date', value: '2026-07-04' },
} as const

describe('resolveBindings', () => {
  it('replaces known tokens and formats per type', () => {
    expect(
      resolveBindings('{{Message}} x{{count}} live={{live}}', variables as any),
    ).toBe('Hello world x42 live=true')
    expect(resolveBindings('{{ tags }}', variables as any)).toBe('a, b')
    expect(resolveBindings('{{meta}}', variables as any)).toBe('k: v')
    expect(resolveBindings('{{launch}}', variables as any)).toContain('2026')
  })

  it('keeps unknown tokens literal', () => {
    expect(resolveBindings('hey {{nope}}', variables as any)).toBe(
      'hey {{nope}}',
    )
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

describe('resolveNodesBindings', () => {
  it('rewrites string props only and preserves untouched nodes', () => {
    const nodes = {
      a: { $id: 'a', props: { children: 'Hi {{Message}}', sx: { m: 1 } } },
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
