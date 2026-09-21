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
import {
  createResponsiveCssVarTheme,
  createResponsiveTheme,
  ThemeProvider,
} from '@aglyn/shared-ui-theme'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import ElementDrawerContext from '../contexts/element-drawer-context'
import NodeContextMenu from './node-context-menu'
import {
  closeSubtreeJson,
  SubtreeJsonDialogHost,
} from './subtree-json-dialog.component'

const CONTAINER = 'outlivesMenuContainer'
const DIALOG_TITLE = 'Edit element JSON'

const noopFactory = (() => null) as any

const theme = createResponsiveCssVarTheme(
  createResponsiveTheme({ themeOptions: { palette: { mode: 'light' } } }),
  createResponsiveTheme({ themeOptions: { palette: { mode: 'dark' } } }),
)

// The menu's Add-element item reaches for the drawer on mount; nothing here
// opens it.
const drawer = { elementDrawer: () => Promise.resolve(undefined) }

function seedCanvas() {
  Aglyn.components.registerComponent(noopFactory, {
    $id: CONTAINER,
    displayName: 'Stack',
  })
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
      nodes: [],
    },
  } as any)
}

/**
 * A besigner surface: the menu, which its host is free to unmount at any
 * moment, and the dialog host, which the provider mounts for the page.
 */
function Surface(props: { host: boolean }) {
  const [menuOpen, setMenuOpen] = useState(true)
  return (
    <ThemeProvider theme={theme}>
      <ElementDrawerContext.Provider value={drawer}>
        <button onClick={() => setMenuOpen(false)}>{'dismiss the menu'}</button>
        {menuOpen && (
          <NodeContextMenu node={Aglyn.canvas.getNode('section')!} />
        )}
        {props.host && <SubtreeJsonDialogHost />}
      </ElementDrawerContext.Provider>
    </ThemeProvider>
  )
}

/**
 * AGL-3208 — Edit JSON must survive the menu that opened it.
 *
 * The dialog used to be a child of `NodeContextMenu`, and both hosts of that
 * menu end it the moment anything else is touched: the Hierarchy panel wraps
 * it in a `ClickAwayListener` and the canvas overlay hands it to a `Tooltip`.
 * The dialog is portalled, so a click inside it is "away" and a pointer
 * entering it has left the anchor — reaching for the editor unmounted it.
 *
 * Both tests turn on the SAME gesture (dismiss the menu) so that the second
 * one cannot pass by the dialog never having opened.
 */
describe('the subtree JSON dialog outlives its menu (AGL-3208)', () => {
  beforeEach(seedCanvas)
  afterEach(() => closeSubtreeJson())

  it('stays open when the menu that opened it is unmounted', () => {
    render(<Surface host />)

    fireEvent.click(screen.getByText('Edit JSON'))
    expect(screen.getByText(DIALOG_TITLE)).toBeTruthy()

    // What a ClickAwayListener or a closing Tooltip does to the menu.
    fireEvent.click(screen.getByText('dismiss the menu'))

    expect(screen.queryByText('Edit JSON')).toBeNull()
    expect(screen.getByText(DIALOG_TITLE)).toBeTruthy()
  })

  it('is the host that renders it, never the menu', () => {
    // The regression restated as structure: with no host mounted, the menu
    // has nothing to show. A dialog appearing here would mean it had been
    // put back inside the menu, where the test above cannot see it die.
    render(<Surface host={false} />)

    fireEvent.click(screen.getByText('Edit JSON'))
    expect(screen.queryByText(DIALOG_TITLE)).toBeNull()
  })
})
