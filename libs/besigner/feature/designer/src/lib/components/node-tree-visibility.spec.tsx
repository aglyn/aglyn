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
import {
  createResponsiveCssVarTheme,
  createResponsiveTheme,
  ThemeProvider,
} from '@aglyn/shared-ui-theme'
import { act, fireEvent, render, screen } from '@testing-library/react'

import * as flagHook from '../hooks/use-aglyn-besigner-flag'
import NodeTreeView from './node-tree-view'

/**
 * The besigner flags, backed by a store the test can read back. The real
 * hook subscribes to the app controller, which no unit test mounts; the
 * contract that matters here is which flag the toggle writes, and that it
 * writes nothing else.
 *
 * The store lives INSIDE the factory and is re-exported from it — a module
 * factory may not close over anything declared in the test file.
 */
jest.mock('../hooks/use-aglyn-besigner-flag', () => {
  const react = jest.requireActual('react')
  const flags: Record<string, unknown> = {}
  const listeners = new Set<() => void>()
  return {
    __esModule: true,
    __flags: flags,
    default: (flag: string) => {
      const [, force] = react.useReducer((count: number) => count + 1, 0)
      react.useEffect(() => {
        listeners.add(force)
        return () => {
          listeners.delete(force)
        }
      }, [force])
      return [
        flags[flag],
        (next: unknown) => {
          flags[flag] =
            typeof next === 'function' ? (next as any)(flags[flag]) : next
          listeners.forEach((listener) => listener())
        },
      ]
    },
    useAglynBesignerSetFlag: () => () => undefined,
  }
})

const mockFlags = (flagHook as unknown as { __flags: Record<string, unknown> })
  .__flags

const HIDDEN = Aglyn.ELEMENT_HIDDEN_CLASS
const PANEL = 'Mega menu panel'
const DRAWER = 'Mobile drawer'

const theme = createResponsiveCssVarTheme(
  createResponsiveTheme({ themeOptions: { palette: { mode: 'light' } } }),
  createResponsiveTheme({ themeOptions: { palette: { mode: 'dark' } } }),
)

/** root > wrapper > [trigger, panel], plus a second hidden element. */
function seedCanvas() {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['wrapper', 'drawer'],
    },
    wrapper: {
      $id: 'wrapper',
      componentId: 'div',
      parentId: Aglyn.NODE_ROOT_ID,
      name: 'Site nav',
      nodes: ['trigger', 'panel'],
    },
    trigger: {
      $id: 'trigger',
      componentId: 'div',
      parentId: 'wrapper',
      name: 'Trigger',
      nodes: [],
    },
    panel: {
      $id: 'panel',
      componentId: 'div',
      parentId: 'wrapper',
      name: PANEL,
      props: { className: HIDDEN },
      nodes: [],
    },
    drawer: {
      $id: 'drawer',
      componentId: 'div',
      parentId: Aglyn.NODE_ROOT_ID,
      name: DRAWER,
      props: { className: HIDDEN },
      nodes: [],
    },
  } as never)
}

const renderTree = () => {
  const result = render(
    <ThemeProvider theme={theme}>
      <NodeTreeView />
    </ThemeProvider>,
  )
  // Every row is on screen. The tree only auto-expands the branch holding
  // the selection, and the reveal control has to be reachable without
  // selecting anything.
  act(() => {
    Besigner.focus.expandNode(Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)!)
    Besigner.focus.expandNode(Aglyn.canvas.getNode('wrapper')!)
  })
  return result
}

const revealButton = (label: string) =>
  screen.queryByRole('button', { name: `Show ${label} on the canvas` })

const stopButton = (label: string) =>
  screen.queryByRole('button', { name: `Stop showing ${label} on the canvas` })

describe('hierarchy visibility toggle (AGL-592)', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFlags)) delete mockFlags[key]
    seedCanvas()
    Besigner.focus.clearFocusStatus()
  })
  afterEach(() => act(() => Besigner.focus.clearFocusStatus()))

  it('offers the control only on an element the site hides', () => {
    renderTree()
    expect(revealButton(PANEL)).toBeTruthy()
    expect(revealButton(DRAWER)).toBeTruthy()
    expect(revealButton('Trigger')).toBeNull()
  })

  it('turns canvas visibility on and back off', () => {
    renderTree()
    fireEvent.click(revealButton(PANEL)!)
    expect(mockFlags['revealedNodeIds']).toEqual(['panel'])
    expect(stopButton(PANEL)).toBeTruthy()

    fireEvent.click(stopButton(PANEL)!)
    expect(mockFlags['revealedNodeIds']).toEqual([])
    expect(revealButton(PANEL)).toBeTruthy()
  })

  it('leaves the other hidden elements alone', () => {
    renderTree()
    fireEvent.click(revealButton(PANEL)!)
    expect(mockFlags['revealedNodeIds']).not.toContain('drawer')
    expect(revealButton(DRAWER)).toBeTruthy()
  })

  // Showing a panel to design it is not the same act as publishing the site
  // with it open, so the class the live page reads is never touched.
  it('never writes the hidden class off the node', () => {
    renderTree()
    fireEvent.click(revealButton(PANEL)!)
    expect(Aglyn.canvas.getNode('panel')?.props?.['className']).toBe(HIDDEN)
    expect(Aglyn.canvas.getNode('drawer')?.props?.['className']).toBe(HIDDEN)
  })

  it('does not select the row it is toggling', () => {
    renderTree()
    fireEvent.click(revealButton(PANEL)!)
    expect(Besigner.focus.getSelected().length).toBe(0)
  })
})
