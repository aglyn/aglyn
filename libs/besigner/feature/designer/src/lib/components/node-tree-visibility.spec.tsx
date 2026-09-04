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

const eye = (label: string, hidden: boolean) =>
  screen.queryByRole('button', {
    name: hidden ? `Show ${label}` : `Hide ${label}`,
  })

const hiddenOf = (id: string) => Aglyn.canvas.getNode(id)?.hidden
const classNameOf = (id: string) =>
  Aglyn.canvas.getNode(id)?.props?.['className']

/** The opacity a layer's own TreeItem applies, read from the cascade. */
const dimOf = (container: HTMLElement) => (id: string) => {
  const element = container.querySelector(`[data-aglyn-node="${id}"]`)
  return element ? getComputedStyle(element).opacity : undefined
}

describe('hierarchy visibility toggle', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFlags)) delete mockFlags[key]
    seedCanvas()
    Besigner.focus.clearFocusStatus()
  })
  afterEach(() => act(() => Besigner.focus.clearFocusStatus()))

  it('offers the control on every element', () => {
    renderTree()
    expect(eye('Trigger', false)).toBeTruthy()
    expect(eye('Site nav', false)).toBeTruthy()
  })

  it('hides an element and shows it again', () => {
    renderTree()
    fireEvent.click(eye('Trigger', false)!)
    expect(hiddenOf('trigger')).toBe(true)
    fireEvent.click(eye('Trigger', true)!)
    expect(hiddenOf('trigger')).toBe(false)
  })

  /**
   * The reason this is a node FIELD and not a style. An author who hides a
   * Stack laid out with `display: flex` has to get that flex back — writing
   * `display: none` into `node.sx` destroys the value it overwrote, and
   * there is nothing left to restore.
   */
  it('never touches the element own styles', () => {
    act(() => {
      Aglyn.canvas.getNode('trigger')!.sx = { display: 'flex', gap: 2 } as never
    })
    renderTree()
    fireEvent.click(eye('Trigger', false)!)
    expect(Aglyn.canvas.getNode('trigger')?.sx).toEqual({
      display: 'flex',
      gap: 2,
    })
    fireEvent.click(eye('Trigger', true)!)
    expect(Aglyn.canvas.getNode('trigger')?.sx).toEqual({
      display: 'flex',
      gap: 2,
    })
  })

  /**
   * `aglyn-hidden` means something else that looks the same from outside —
   * "starts hidden, and an interaction shows it". A visibility toggle that
   * wrote it would enrol every hidden element in a choreography it is not
   * part of.
   */
  it('never writes the bespoke hidden class', () => {
    renderTree()
    fireEvent.click(eye('Trigger', false)!)
    expect(classNameOf('trigger')).toBeUndefined()
  })

  it('leaves the class alone on an element that already carries it', () => {
    renderTree()
    fireEvent.click(eye(PANEL, false)!)
    expect(hiddenOf('panel')).toBe(true)
    expect(classNameOf('panel')).toBe(HIDDEN)
  })

  it('leaves every other element alone', () => {
    renderTree()
    fireEvent.click(eye('Trigger', false)!)
    expect(hiddenOf('panel')).toBeFalsy()
    expect(hiddenOf('wrapper')).toBeFalsy()
  })

  it('never offers it on the document root', () => {
    renderTree()
    expect(eye('Document', false)).toBeNull()
    expect(eye('Document', true)).toBeNull()
  })

  it('does not select the row it is toggling', () => {
    renderTree()
    fireEvent.click(eye('Trigger', false)!)
    expect(Besigner.focus.getSelected().length).toBe(0)
  })

  /**
   * The row is the only place a hidden element is always on screen — on the
   * canvas it is, by definition, the thing you cannot see.
   */
  it('dims a hidden layer and leaves a visible one at full strength', () => {
    const { container } = renderTree()
    const dim = dimOf(container)
    expect(dim('trigger')).not.toBe('0.45')

    fireEvent.click(eye('Trigger', false)!)
    expect(dim('trigger')).toBe('0.45')

    fireEvent.click(eye('Trigger', true)!)
    expect(dim('trigger')).not.toBe('0.45')
  })

  it('dims an element that starts hidden for an interaction too', () => {
    // Both mean the element is not on the page, and a reader scanning the
    // tree is asking that question, not which mechanism answered it.
    const { container } = renderTree()
    expect(dimOf(container)('panel')).toBe('0.45')
  })

  /**
   * A container that does not ship takes its contents with it, and only the
   * outermost hidden layer draws the dim — CSS opacity multiplies through
   * nesting, so a hidden panel inside a hidden wrapper would fade to 0.2.
   */
  it('carries the dim to every layer underneath', () => {
    const { container } = renderTree()
    const dim = dimOf(container)

    fireEvent.click(eye('Site nav', false)!)
    expect(dim('wrapper')).toBe('0.45')
    expect(dim('trigger')).not.toBe('0.45')
    expect(dim('panel')).not.toBe('0.45')

    fireEvent.click(eye('Site nav', true)!)
    expect(dim('wrapper')).not.toBe('0.45')
    expect(dim('panel')).toBe('0.45')
  })
})
