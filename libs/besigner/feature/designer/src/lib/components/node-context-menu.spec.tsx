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
// The menu's header reads `theme.vars.palette` — plain `createTheme()` has
// no `vars`, so this needs the CSS-variable theme the editor actually runs.
import {
  createResponsiveCssVarTheme,
  createResponsiveTheme,
  ThemeProvider,
} from '@aglyn/shared-ui-theme'
import { fireEvent, render, screen } from '@testing-library/react'

import ElementDrawerContext from '../contexts/element-drawer-context'
import NodeContextMenu from './node-context-menu'

const CONTAINER = 'testMenuContainer'
const MARKDOWN = 'testMenuMarkdown'
const IMAGE = 'testMenuImage'

const noopFactory = (() => null) as any

function registerSchemas() {
  Aglyn.components.registerComponent(noopFactory, {
    $id: CONTAINER,
    displayName: 'Stack',
  })
  Aglyn.components.registerComponent(noopFactory, {
    $id: MARKDOWN,
    displayName: 'Markdown',
    flags: { dropping: Aglyn.FEATURE_FLAG.DISABLED },
  })
  Aglyn.components.registerComponent(noopFactory, {
    $id: IMAGE,
    displayName: 'Image',
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  })
}

/** The /press shape: root > section > [markdown > stack > [img1, img2], tail]. */
function seedCanvas() {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['section'],
    },
    section: {
      $id: 'section',
      componentId: CONTAINER,
      parentId: Aglyn.NODE_ROOT_ID,
      nodes: ['markdown', 'tail'],
    },
    markdown: {
      $id: 'markdown',
      componentId: MARKDOWN,
      parentId: 'section',
      nodes: ['stack'],
    },
    stack: {
      $id: 'stack',
      componentId: CONTAINER,
      parentId: 'markdown',
      nodes: ['img1', 'img2'],
    },
    img1: { $id: 'img1', componentId: IMAGE, parentId: 'stack', nodes: [] },
    img2: { $id: 'img2', componentId: IMAGE, parentId: 'stack', nodes: [] },
    tail: {
      $id: 'tail',
      componentId: CONTAINER,
      parentId: 'section',
      nodes: [],
    },
  } as any)
}

// The menu's Add-element item reaches for the drawer on mount; nothing in
// these tests opens it.
const drawer = { elementDrawer: () => Promise.resolve(undefined) }

const theme = createResponsiveCssVarTheme(
  createResponsiveTheme({ themeOptions: { palette: { mode: 'light' } } }),
  createResponsiveTheme({ themeOptions: { palette: { mode: 'dark' } } }),
)

const renderMenu = ($id: string) =>
  render(
    <ThemeProvider theme={theme}>
      <ElementDrawerContext.Provider value={drawer}>
        <NodeContextMenu node={Aglyn.canvas.getNode($id)!} />
      </ElementDrawerContext.Provider>
    </ThemeProvider>,
  )

/** The clickable menu row carrying `label`. */
const itemFor = (label: string) =>
  screen.getByText(label).closest('li') as HTMLElement

const isDisabled = (label: string) =>
  itemFor(label).classList.contains('Mui-disabled')

/**
 * The actions are only worth anything if they are actually WIRED to the
 * menu — AGL-1405 exists because a gesture that looked connected (the
 * hierarchy drag) reached nothing. These assert at the control, not the
 * operation: `node-move.spec.ts` covers the move itself.
 */
describe('NodeContextMenu move actions (AGL-1405)', () => {
  beforeEach(() => {
    registerSchemas()
    seedCanvas()
    Aglyn.canvas.clearHistory()
  })

  it('offers Move out of container, and performs it', () => {
    renderMenu('stack')
    expect(isDisabled('Move out of container')).toBe(false)

    fireEvent.click(itemFor('Move out of container'))

    expect(Aglyn.canvas.getNode('section')!.nodes).toEqual([
      'markdown',
      'stack',
      'tail',
    ])
    expect(Aglyn.canvas.getNode('markdown')!.nodes).toEqual([])
  })

  /**
   * The guard, at the control: lifting an image one level would land it in
   * the markdown block that swallowed it in the first place, so the action
   * is not offered at all.
   */
  it('disables Move out of container when the level above rejects children', () => {
    renderMenu('img1')
    expect(isDisabled('Move out of container')).toBe(true)
  })

  it('disables Move out of container for a top-level element', () => {
    renderMenu('section')
    expect(isDisabled('Move out of container')).toBe(true)
  })

  it('offers Move into element above, and performs it', () => {
    Aglyn.canvas.reparentNode(
      Aglyn.canvas.getNode('stack')!,
      Aglyn.canvas.getNode('section')!,
      1,
    )
    renderMenu('tail')
    expect(isDisabled('Move into element above')).toBe(false)

    fireEvent.click(itemFor('Move into element above'))

    expect(Aglyn.canvas.getNode('stack')!.nodes).toEqual([
      'img1',
      'img2',
      'tail',
    ])
  })

  it('disables Move into element above when the element above rejects children', () => {
    // `tail` sits directly after the markdown block.
    renderMenu('tail')
    expect(isDisabled('Move into element above')).toBe(true)
  })

  it('disables Move into element above for a first child', () => {
    renderMenu('img1')
    expect(isDisabled('Move into element above')).toBe(true)
  })
})
