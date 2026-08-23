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
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { fireEvent, render } from '@testing-library/react'

import NodeTreeView from './node-tree-view'

const noopFactory = (() => null) as any

// The theme the editor actually runs, so `palette.surface` and the CSS
// variable channels the tree and the picker read are the real ones.
const theme = consoleThemeCssVar

function registerSchemas() {
  Aglyn.components.registerComponent(noopFactory, {
    $id: 'div',
    displayName: 'Div',
  })
  Aglyn.components.registerComponent(noopFactory, {
    $id: 'stack',
    displayName: 'Stack',
  })
  // Same shape as the real mui `icon` schema.
  Aglyn.components.registerComponent(noopFactory, {
    $id: 'icon',
    displayName: 'Icon',
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'iconId',
        component: Aglyn.FieldComponentType.ICON_PICKER,
        label: 'Icon',
      },
    ],
  } as any)
}

function seedCanvas() {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['stack1'],
    },
    stack1: {
      $id: 'stack1',
      componentId: 'stack',
      parentId: Aglyn.NODE_ROOT_ID,
      nodes: ['icon1', 'stack2'],
    },
    icon1: {
      $id: 'icon1',
      componentId: 'icon',
      parentId: 'stack1',
      nodes: [],
    },
    stack2: {
      $id: 'stack2',
      componentId: 'stack',
      parentId: 'stack1',
      nodes: [],
    },
  } as any)
}

const rowFor = ($id: string) =>
  document.querySelector(`[data-aglyn-node="${$id}"]`) as HTMLElement

describe('hierarchy selection (AGL-2486)', () => {
  beforeEach(() => {
    registerSchemas()
    seedCanvas()
    Besigner.focus.clearFocusStatus()
    // Collapse unmounts its children, so the rows under test only exist
    // once their ancestors are expanded.
    Besigner.focus.expandNode(Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)!)
    Besigner.focus.expandNode(Aglyn.canvas.getNode('stack1')!)
  })

  it('selects a plain element row', () => {
    render(
      <ThemeProvider theme={theme}>
        <NodeTreeView />
      </ThemeProvider>,
    )
    const button = rowFor('stack2').querySelector(
      '.MuiListItemButton-root',
    ) as HTMLElement
    expect(button).toBeTruthy()
    fireEvent.click(button)
    expect(
      Besigner.focus.isNodeSelected(Aglyn.canvas.getNode('stack2')!),
    ).toBe(true)
  })

  it('selects an Icon row', () => {
    render(
      <ThemeProvider theme={theme}>
        <NodeTreeView />
      </ThemeProvider>,
    )
    const row = rowFor('icon1')
    expect(row).toBeTruthy()
    const button = row.querySelector('.MuiListItemButton-root') as HTMLElement
    expect(button).toBeTruthy()
    fireEvent.click(button)
    expect(
      Besigner.focus.isNodeSelected(Aglyn.canvas.getNode('icon1')!),
    ).toBe(true)
  })
})

/**
 * The A4 report — "clicking the `Icon` node in the hierarchy does not select
 * it" — is not about the Icon element at all. Every entry point that puts an
 * Icon on the canvas (Add Element, or clicking it on the canvas) leaves it
 * ALREADY selected, and a plain row click toggled, so the click deselected
 * it. The rows were only open because the selection held them open, so the
 * tree then collapsed back to the document root and the row disappeared
 * under the pointer.
 */
describe('a plain hierarchy click selects rather than toggles (AGL-2486)', () => {
  beforeEach(() => {
    registerSchemas()
    seedCanvas()
    Besigner.focus.clearFocusStatus()
  })

  const renderTree = () =>
    render(
      <ThemeProvider theme={theme}>
        <NodeTreeView />
      </ThemeProvider>,
    )

  const clickRow = ($id: string, init?: Record<string, unknown>) =>
    fireEvent.click(
      rowFor($id).querySelector('.MuiListItemButton-root') as HTMLElement,
      init,
    )

  it('keeps an already-selected element selected', () => {
    const icon = Aglyn.canvas.getNode('icon1')!
    // The state every insertion path leaves behind: selected, and visible
    // only because the selection auto-expanded its ancestors.
    Besigner.focus.setSelectedNode(icon)
    renderTree()
    expect(rowFor('icon1')).toBeTruthy()

    clickRow('icon1')

    expect(Besigner.focus.isNodeSelected(icon)).toBe(true)
    // ...and the row is still there to click again.
    expect(rowFor('icon1')).toBeTruthy()
  })

  it('still toggles a selected element off on a modifier click', () => {
    const icon = Aglyn.canvas.getNode('icon1')!
    Besigner.focus.setSelectedNode(icon)
    renderTree()

    clickRow('icon1', { metaKey: true })

    expect(Besigner.focus.isNodeSelected(icon)).toBe(false)
  })

  it('collapses a multi-selection down to the row that was clicked', () => {
    const icon = Aglyn.canvas.getNode('icon1')!
    const stack2 = Aglyn.canvas.getNode('stack2')!
    Besigner.focus.setSelectedNode(icon)
    Besigner.focus.setSelectedNode(stack2, true)
    renderTree()

    clickRow('icon1')

    expect(Besigner.focus.isNodeSelected(icon)).toBe(true)
    expect(Besigner.focus.isNodeSelected(stack2)).toBe(false)
  })
})

