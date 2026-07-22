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
  composeReusableComponentNodes,
  nodesReferenceComponent,
  REUSABLE_INSTANCE_COMPONENT_ID,
} from './compose-reusable-components'

const instance = (id: string, refId: string) => ({
  $id: id,
  componentId: REUSABLE_INSTANCE_COMPONENT_ID,
  props: { refId },
  nodes: [] as string[],
})

describe('composeReusableComponentNodes', () => {
  const definition = {
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: 'muiStack', nodes: ['label'] },
      label: {
        $id: 'label',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: 'Hello' },
      },
    },
  } as any

  it('grafts the definition under the instance with namespaced ids', () => {
    const nodes = {
      _root_: { $id: '_root_', componentId: 'div', nodes: ['a'] },
      a: instance('a', 'card'),
    } as any
    const composed = composeReusableComponentNodes(nodes, { card: definition })

    expect(composed['a'].nodes).toEqual(['cmp__a__root'])
    expect(composed['cmp__a__root']).toMatchObject({
      componentId: 'muiStack',
      parentId: 'a',
      nodes: ['cmp__a__label'],
    })
    expect(composed['cmp__a__label']).toMatchObject({
      componentId: 'muiTypography',
      parentId: 'cmp__a__root',
    })
    // input untouched
    expect(nodes['a'].nodes).toEqual([])
  })

  it('expands multiple instances of the same definition without collisions', () => {
    const nodes = {
      a: instance('a', 'card'),
      b: instance('b', 'card'),
    } as any
    const composed = composeReusableComponentNodes(nodes, { card: definition })
    expect(composed['cmp__a__label']).toBeDefined()
    expect(composed['cmp__b__label']).toBeDefined()
  })

  it('leaves unresolvable instances untouched', () => {
    const nodes = { a: instance('a', 'missing') } as any
    const composed = composeReusableComponentNodes(nodes, {})
    expect(composed['a'].nodes).toEqual([])
  })

  it('expands instances nested inside definitions, bounded on self-reference', () => {
    const nesting = {
      rootId: 'r',
      nodes: {
        r: { $id: 'r', componentId: 'muiStack', nodes: ['inner'] },
        inner: instance('inner', 'card'),
      },
    } as any
    const composed = composeReusableComponentNodes(
      { a: instance('a', 'nesting') } as any,
      { nesting, card: definition },
    )
    expect(composed['cmp__a__inner'].nodes).toEqual([
      'cmp__cmp__a__inner__root',
    ])

    const selfRef = {
      rootId: 'r',
      nodes: { r: instance('r', 'selfRef') },
    } as any
    // Must terminate.
    const bounded = composeReusableComponentNodes(
      { a: instance('a', 'selfRef') } as any,
      { selfRef },
    )
    expect(Object.keys(bounded).length).toBeGreaterThan(1)
  })
})

describe('nodesReferenceComponent', () => {
  it('finds a direct instance and ignores other definitions', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['a', 'b'] },
      a: instance('a', 'card'),
      b: instance('b', 'banner'),
    } as any
    expect(nodesReferenceComponent(nodes, 'card')).toBe(true)
    expect(nodesReferenceComponent(nodes, 'banner')).toBe(true)
    expect(nodesReferenceComponent(nodes, 'hero')).toBe(false)
  })

  it('does not mistake a same-named prop on an ordinary node', () => {
    // A plain component carrying `refId` is not an instance — only the
    // reusableInstance componentId makes the renderer graft.
    const nodes = {
      a: { $id: 'a', componentId: 'muiButton', props: { refId: 'card' } },
    } as any
    expect(nodesReferenceComponent(nodes, 'card')).toBe(false)
  })

  it('agrees with the graft about what counts as a reference', () => {
    const definition = {
      rootId: 'root',
      nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
    } as any
    const nodes = { a: instance('a', 'card') } as any
    // If the scan says referenced, the composer must actually expand it.
    expect(nodesReferenceComponent(nodes, 'card')).toBe(true)
    const composed = composeReusableComponentNodes(nodes, { card: definition })
    expect(composed['a'].nodes).toEqual(['cmp__a__root'])
  })

  it('is safe on empty, missing and id-less input', () => {
    expect(nodesReferenceComponent(undefined, 'card')).toBe(false)
    expect(nodesReferenceComponent(null, 'card')).toBe(false)
    expect(nodesReferenceComponent({}, 'card')).toBe(false)
    // An empty needle must never match everything.
    expect(nodesReferenceComponent({ a: instance('a', 'card') } as any, '')).toBe(
      false,
    )
  })
})
