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
import * as Besigner from '@aglyn/besigner'
import { renderHook } from '@testing-library/react'
import { ElementDrawerContext } from '../contexts/element-drawer-context'
import useAddElementDrawerCallback from './use-add-element-drawer-callback'

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

// Insert-target regression tests (AGL-537): the created node must attach
// under the requested (selected) target, constraints must validate against
// that same target, and no code path may leave a node in the map that no
// parent references.
describe('useAddElementDrawerCallback', () => {
  const APP_BAR = 'aglTestAppBar537'
  const TOOLBAR = 'aglTestToolbar537'

  beforeAll(() => {
    Aglyn.components.registerComponent((() => null) as any, {
      $id: APP_BAR,
      pluginId: 'test-plugin',
      displayName: 'App Bar',
    } as any)
    Aglyn.components.registerComponent((() => null) as any, {
      $id: TOOLBAR,
      pluginId: 'test-plugin',
      displayName: 'Toolbar Content',
      restrictParent: [
        Aglyn.LinealDirectiveFlag.LIMIT_TO,
        { components: [APP_BAR] },
      ],
    } as any)
  })

  afterAll(() => {
    Aglyn.components.unregisterComponent(APP_BAR)
    Aglyn.components.unregisterComponent(TOOLBAR)
    Aglyn.canvas.reset()
    Besigner.focus.clearFocusStatus()
  })

  beforeEach(() => {
    mockEnqueueSnackbar.mockClear()
    Besigner.focus.clearFocusStatus()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      [Aglyn.NODE_ROOT_ID]: {
        $id: Aglyn.NODE_ROOT_ID,
        type: 'node',
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: 'div',
        props: {},
        sx: {},
        nodes: ['appbar1'],
      },
      appbar1: {
        $id: 'appbar1',
        type: 'node',
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: APP_BAR,
        pluginId: 'test-plugin',
        props: {},
        sx: {},
        nodes: [],
      },
    } as any)
  })

  const makePreset = (componentId: string) =>
    ({
      $id: `preset-${componentId}`,
      type: 'preset',
      data: {
        $id: 'seed',
        type: 'node',
        componentId,
        pluginId: 'test-plugin',
        props: {},
        sx: {},
        nodes: [],
      },
    }) as any

  const renderCallback = (componentId: string) => {
    const elementDrawer = jest
      .fn()
      .mockResolvedValue({ option: makePreset(componentId) })
    const wrapper = ({ children }: { children?: React.ReactNode }) => (
      <ElementDrawerContext.Provider value={{ elementDrawer }}>
        {children}
      </ElementDrawerContext.Provider>
    )
    const { result } = renderHook(() => useAddElementDrawerCallback(), {
      wrapper,
    })
    return result.current
  }

  /** Node ids present in the map but referenced by no parent's `nodes`. */
  const collectOrphans = (): string[] => {
    const referenced = new Set<string>([Aglyn.NODE_ROOT_ID])
    for (const node of Aglyn.canvas.nodes.values()) {
      for (const id of node.nodes ?? []) referenced.add(id)
    }
    return [...Aglyn.canvas.nodes.keys()].filter((id) => !referenced.has(id))
  }

  it('inserts under the document root when no target is given', async () => {
    const addElement = renderCallback(APP_BAR)

    const node = (await addElement()) as Aglyn.NodeSchema<any>

    expect(node).toBeTruthy()
    expect(node.parentId).toBe(Aglyn.NODE_ROOT_ID)
    expect(Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)!.nodes).toContain(node.$id)
    expect(Besigner.focus.getLastSelected()?.$id).toBe(node.$id)
    expect(collectOrphans()).toEqual([])
  })

  it('inserts into the selected container and validates against it', async () => {
    const addElement = renderCallback(TOOLBAR)
    const selected = Aglyn.canvas.getNode('appbar1')!

    const node = (await addElement(selected)) as Aglyn.NodeSchema<any>

    // The toolbar is only valid inside an app bar — resolving the target
    // as anything else (the historical bug resolved it as the root) makes
    // this insert fail.
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled()
    expect(node.parentId).toBe('appbar1')
    expect(Aglyn.canvas.getNode('appbar1')!.nodes).toContain(node.$id)
    expect(collectOrphans()).toEqual([])
  })

  it('rejects constrained elements against the actual target', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const addElement = renderCallback(TOOLBAR)
    const before = Aglyn.canvas.nodes.size

    const node = await addElement()

    expect(node).toBeUndefined()
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('must be placed inside'),
      expect.anything(),
    )
    expect(Aglyn.canvas.nodes.size).toBe(before)
    expect(collectOrphans()).toEqual([])
  })

  it('falls back to the root for a non-node target without orphaning', async () => {
    const addElement = renderCallback(APP_BAR)
    // The shape of the historical bug: the INSERT menu passed its click
    // event straight through as the insert target.
    const clickEvent = { type: 'click', currentTarget: {} } as any

    const node = (await addElement(clickEvent)) as Aglyn.NodeSchema<any>

    expect(node).toBeTruthy()
    expect(node.parentId).toBe(Aglyn.NODE_ROOT_ID)
    expect(Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)!.nodes).toContain(node.$id)
    expect('nodes' in clickEvent).toBe(false)
    expect(collectOrphans()).toEqual([])
  })
})
