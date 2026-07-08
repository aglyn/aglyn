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
  displayBindingTokens,
  formatFunctionIdToken,
  formatVariableIdToken,
  keyByIdAndName,
  MISSING_BINDING_LABEL,
  nodesReferenceBinding,
  normalizeBindingTokens,
  textReferencesBinding,
} from './binding-tokens'
import { resolveBindings, type HostVariable } from './variables'

const docs: Array<HostVariable & { id: string }> = [
  { id: 'aB3xK9m2Qw', name: 'greeting', type: 'text', value: 'Hello' },
  { id: '7Zt-pL_4Yc', name: 'count', type: 'number', value: '42' },
]
const variables = keyByIdAndName(docs)

describe('binding token grammar (AGL-185)', () => {
  it('formats picker tokens', () => {
    expect(formatVariableIdToken('aB3xK9m2Qw')).toBe('{{var:aB3xK9m2Qw}}')
    expect(formatFunctionIdToken('fnId01', ['P1', 'P2'])).toBe(
      '{{fn:fnId01(P1, P2)}}',
    )
  })

  it('keyByIdAndName double-keys docs with id winning collisions', () => {
    expect(variables['greeting']).toEqual(
      expect.objectContaining({ name: 'greeting' }),
    )
    expect(variables['aB3xK9m2Qw']).toEqual(
      expect.objectContaining({ name: 'greeting' }),
    )
    // A doc whose id equals another doc's name: the id entry wins.
    const collided = keyByIdAndName([
      { id: 'winner', name: 'other', type: 'text', value: 'by-name' },
      { id: 'x1', name: 'winner', type: 'text', value: 'by-id' },
    ] as Array<HostVariable & { id: string }>)
    expect(collided['winner'].value).toBe('by-name')
  })
})

describe('resolveBindings id tokens (AGL-185)', () => {
  it('resolves {{var:id}} tokens, including ids with - and _', () => {
    expect(resolveBindings('{{var:aB3xK9m2Qw}}!', variables)).toBe('Hello!')
    expect(resolveBindings('n={{var:7Zt-pL_4Yc}}', variables)).toBe('n=42')
  })

  it('keeps resolving id tokens after a rename (the point of AGL-185)', () => {
    const renamed = keyByIdAndName(
      docs.map((doc) =>
        doc.id === 'aB3xK9m2Qw' ? { ...doc, name: 'salutation' } : doc,
      ),
    )
    // Id token unaffected by the rename; the old name token goes literal.
    expect(resolveBindings('{{var:aB3xK9m2Qw}}', renamed)).toBe('Hello')
    expect(resolveBindings('{{greeting}}', renamed)).toBe('{{greeting}}')
    expect(resolveBindings('{{salutation}}', renamed)).toBe('Hello')
  })

  it('renders unknown id tokens as empty (AGL-186 — ids never leak)', () => {
    expect(resolveBindings('a{{var:missing00}}b', variables)).toBe('ab')
  })

  it('resolves {{fn:id(args)}} through the id-keyed lookup', () => {
    const definition = {
      name: 'Double',
      parameters: [{ name: 'P1', type: 'number', required: true }],
      variables: [{ name: 'P2', type: 'number' }],
      operations: [
        {
          if: { left: 'P1', comparator: '>=', right: 'P1' },
          then: [{ set: 'P2', expression: 'P1 * 2' }],
          otherwise: [],
        },
      ],
      returnValue: 'P2',
    }
    const functions = keyByIdAndName([{ id: '9fnAbC12Xy', ...definition }])
    expect(
      resolveBindings('{{fn:9fnAbC12Xy(21)}}', variables, functions as any),
    ).toBe('42')
    // Legacy name form still resolves through the same map.
    expect(
      resolveBindings('{{fn:Double(5)}}', variables, functions as any),
    ).toBe('10')
  })

  it('mixes legacy and id tokens in one string', () => {
    expect(
      resolveBindings('{{greeting}} / {{var:7Zt-pL_4Yc}}', variables),
    ).toBe('Hello / 42')
  })
})

describe('normalizeBindingTokens (AGL-186)', () => {
  const editorVariables = {
    greeting: { name: 'greeting', $id: 'aB3xK9m2Qw' },
    aB3xK9m2Qw: { name: 'greeting', $id: 'aB3xK9m2Qw' },
  }
  const editorFunctions = {
    Sum: { name: 'Sum', $id: '9fnAbC12Xy' },
    '9fnAbC12Xy': { name: 'Sum', $id: '9fnAbC12Xy' },
  }

  it('rewrites typed names to id tokens', () => {
    expect(
      normalizeBindingTokens('Hi {{greeting}}!', editorVariables),
    ).toBe('Hi {{var:aB3xK9m2Qw}}!')
    expect(
      normalizeBindingTokens('{{fn:Sum(1, 2)}}', {}, editorFunctions),
    ).toBe('{{fn:9fnAbC12Xy(1, 2)}}')
  })

  it('leaves unknown names and existing id tokens untouched', () => {
    expect(normalizeBindingTokens('{{later}}', editorVariables)).toBe(
      '{{later}}',
    )
    expect(
      normalizeBindingTokens('{{var:aB3xK9m2Qw}}', editorVariables),
    ).toBe('{{var:aB3xK9m2Qw}}')
    expect(
      normalizeBindingTokens('{{fn:9fnAbC12Xy(1)}}', {}, editorFunctions),
    ).toBe('{{fn:9fnAbC12Xy(1)}}')
  })
})

describe('displayBindingTokens (AGL-186)', () => {
  const editorVariables = {
    aB3xK9m2Qw: { name: 'salutation', $id: 'aB3xK9m2Qw' },
  }
  const editorFunctions = {
    '9fnAbC12Xy': { name: 'Sum', $id: '9fnAbC12Xy' },
    Sum: { name: 'Sum', $id: '9fnAbC12Xy' },
  }

  it('maps id tokens to current names for display', () => {
    expect(
      displayBindingTokens('Hi {{var:aB3xK9m2Qw}}', editorVariables),
    ).toBe('Hi {{salutation}}')
    expect(
      displayBindingTokens('{{fn:9fnAbC12Xy(1, 2)}}', {}, editorFunctions),
    ).toBe('{{fn:Sum(1, 2)}}')
  })

  it('marks deleted referents instead of leaking ids', () => {
    expect(displayBindingTokens('{{var:gone123456}}', editorVariables)).toBe(
      `{{${MISSING_BINDING_LABEL}}}`,
    )
  })

  it('leaves legacy name tokens as-is', () => {
    expect(displayBindingTokens('{{typedName}}', editorVariables)).toBe(
      '{{typedName}}',
    )
    expect(
      displayBindingTokens('{{fn:Sum(3)}}', {}, editorFunctions),
    ).toBe('{{fn:Sum(3)}}')
  })
})

describe('where-used matchers (AGL-187)', () => {
  it('distinguishes id and name references', () => {
    const ref = { kind: 'variable' as const, id: 'aB3xK9m2Qw', name: 'greeting' }
    expect(textReferencesBinding('Hi {{var:aB3xK9m2Qw}}', ref)).toEqual(['id'])
    expect(textReferencesBinding('Hi {{greeting}}', ref)).toEqual(['name'])
    expect(
      textReferencesBinding('{{var:aB3xK9m2Qw}} {{greeting}}', ref),
    ).toEqual(['id', 'name'])
    expect(textReferencesBinding('Hi {{other}}', ref)).toEqual([])
  })

  it('matches function refs by call form only', () => {
    const ref = { kind: 'function' as const, id: '9fnAbC12Xy', name: 'Sum' }
    expect(textReferencesBinding('{{fn:9fnAbC12Xy(1)}}', ref)).toEqual(['id'])
    expect(textReferencesBinding('{{fn:Sum(1, 2)}}', ref)).toEqual(['name'])
    // A variable named Sum is not a function reference.
    expect(textReferencesBinding('{{Sum}}', ref)).toEqual([])
  })

  it('scans node prop maps', () => {
    const ref = { kind: 'variable' as const, id: 'aB3xK9m2Qw', name: 'greeting' }
    const nodes = {
      a: { props: { children: 'plain' } },
      b: { props: { children: 'Hi {{greeting}}', title: 'x' } },
      c: undefined,
    }
    expect(nodesReferenceBinding(nodes, ref)).toEqual(['name'])
    expect(
      nodesReferenceBinding({ a: { props: { children: 'nope' } } }, ref),
    ).toEqual([])
  })
})
