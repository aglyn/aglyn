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

import * as Aglyn from '@aglyn/aglyn'
import { renderHook } from '@testing-library/react'
import { useLayoutChromeCanvas } from './layout-chrome-context'

/**
 * A layout whose nav has been promoted to a reusable component: the chrome
 * carries an INSTANCE node, not the nav's own subtree.
 */
const layoutNodes = () =>
  ({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['nav-instance'],
    },
    'nav-instance': {
      $id: 'nav-instance',
      parentId: Aglyn.NODE_ROOT_ID,
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      pluginId: 'mui',
      props: { refId: 'cmp1', name: 'Site nav' },
      nodes: [],
    },
  }) as any

const definitions = () =>
  ({
    cmp1: {
      rootId: 'def-root',
      nodes: {
        'def-root': {
          $id: 'def-root',
          parentId: null,
          componentId: 'muiAppBar',
          nodes: ['def-brand'],
        },
        'def-brand': {
          $id: 'def-brand',
          parentId: 'def-root',
          componentId: 'muiTypography',
          props: { children: 'Aglyn' },
        },
      },
    },
  }) as any

describe('useLayoutChromeCanvas — chrome renders real components (AGL-1217)', () => {
  it('leaves the instance unexpanded without definitions', () => {
    const { result } = renderHook(() => useLayoutChromeCanvas(layoutNodes()))
    const nodes = result.current?.toJSON().nodes as Record<string, any>
    expect(nodes['nav-instance']).toBeTruthy()
    expect(nodes['nav-instance'].nodes ?? []).toHaveLength(0)
  })

  it('grafts the definition under the instance when definitions are given', () => {
    const { result } = renderHook(() =>
      useLayoutChromeCanvas(layoutNodes(), definitions()),
    )
    const nodes = result.current?.toJSON().nodes as Record<string, any>
    const [childId] = nodes['nav-instance'].nodes as string[]
    // Namespaced per instance, so one definition can appear many times.
    expect(childId).toBe(`${Aglyn.COMPONENT_NODE_ID_PREFIX}nav-instance__def-root`)
    expect(nodes[childId].componentId).toBe('muiAppBar')
    // The whole subtree comes along — the placeholder stood for all of it.
    expect(
      nodes[`${Aglyn.COMPONENT_NODE_ID_PREFIX}nav-instance__def-brand`]
        ?.componentId,
    ).toBe('muiTypography')
  })

  it('returns no canvas without layout nodes, definitions or not', () => {
    const { result } = renderHook(() =>
      useLayoutChromeCanvas(undefined, definitions()),
    )
    expect(result.current).toBeUndefined()
  })
})
