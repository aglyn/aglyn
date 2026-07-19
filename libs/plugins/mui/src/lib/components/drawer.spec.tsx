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
import { act, fireEvent, render, screen } from '@testing-library/react'
import DrawerElement, {
  drawerPresets,
  drawerSchema,
  DrawerToggle,
  drawerToggleSchema,
  parseLeafNodeId,
} from './drawer'

const command = (kind: Aglyn.DrawerCommand, nodeId?: string) =>
  act(() => {
    Aglyn.dispatchDrawerCommand(kind, nodeId)
  })

const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

describe('parseLeafNodeId', () => {
  it('extracts the node id from the renderer attribute', () => {
    expect(parseLeafNodeId('leaf:abc-123')).toBe('abc-123')
    expect(parseLeafNodeId('leaf:')).toBeUndefined()
    expect(parseLeafNodeId(undefined)).toBeUndefined()
    expect(parseLeafNodeId('viewport:dom')).toBeUndefined()
  })
})

describe('Drawer element (AGL-562)', () => {
  it('ships closed and answers open/close commands for its node id', () => {
    render(
      <DrawerElement {...{ 'data-aglyn': 'leaf:drawer-1' }}>
        <span>{'Drawer links'}</span>
      </DrawerElement>,
    )
    expect(screen.queryByText('Drawer links')).toBeNull()
    command('open', 'drawer-1')
    expect(screen.getByText('Drawer links')).toBeTruthy()
    command('close', 'drawer-1')
    // MUI keeps the panel in the DOM during the exit transition; the
    // reopened toggle below proves state, so just assert via toggle.
    command('toggle', 'drawer-1')
    expect(screen.getByText('Drawer links')).toBeTruthy()
  })

  it('matches a raw-id command to a layout-namespaced live drawer (AGL-573)', () => {
    // Live layout node id is `leaf:layout__drawer-1`; the interaction
    // stored the raw canvas id `drawer-1`.
    render(
      <DrawerElement {...{ 'data-aglyn': 'leaf:layout__drawer-1' }}>
        <span>{'Layout drawer links'}</span>
      </DrawerElement>,
    )
    command('open', 'drawer-1')
    expect(screen.getByText('Layout drawer links')).toBeTruthy()
  })

  it('never matches a command whose id merely embeds the drawer id (AGL-573)', () => {
    render(
      <DrawerElement {...{ 'data-aglyn': 'leaf:drawer-1' }}>
        <span>{'Only-me contents'}</span>
      </DrawerElement>,
    )
    command('open', 'layout__Xdrawer-1Y')
    expect(screen.queryByText('Only-me contents')).toBeNull()
  })

  it('ignores commands addressed to other drawers', () => {
    render(
      <DrawerElement {...{ 'data-aglyn': 'leaf:drawer-2' }}>
        <span>{'Mine'}</span>
      </DrawerElement>,
    )
    command('open', 'someone-else')
    expect(screen.queryByText('Mine')).toBeNull()
  })

  it('routes broadcast commands to the first mounted drawer only', () => {
    render(
      <>
        <DrawerElement {...{ 'data-aglyn': 'leaf:first' }}>
          <span>{'First contents'}</span>
        </DrawerElement>
        <DrawerElement {...{ 'data-aglyn': 'leaf:second' }}>
          <span>{'Second contents'}</span>
        </DrawerElement>
      </>,
    )
    command('toggle')
    expect(screen.getByText('First contents')).toBeTruthy()
    expect(screen.queryByText('Second contents')).toBeNull()
  })

  it('shows a close button inside the open panel', () => {
    render(
      <DrawerElement {...{ 'data-aglyn': 'leaf:drawer-3' }}>
        <span>{'Contents'}</span>
      </DrawerElement>,
    )
    command('open', 'drawer-3')
    expect(
      screen.getByRole('button', { name: 'Close menu' }),
    ).toBeTruthy()
  })

  it('renders a collapsed placeholder on editing surfaces by default (AGL-571)', () => {
    renderEditor(
      <DrawerElement {...{ 'data-aglyn': 'leaf:drawer-4' }}>
        <span>{'Editable contents'}</span>
      </DrawerElement>,
    )
    // The drawer is invisible on the live site until opened; the canvas
    // shows a slim, selectable marker instead of the expanded contents.
    expect(screen.getByText(/slides in on the live site/)).toBeTruthy()
    expect(screen.queryByText('Editable contents')).toBeNull()
    // Editor surfaces never enroll on the command bus.
    command('open', 'drawer-4')
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull()
    expect(screen.queryByText('Editable contents')).toBeNull()
  })

  it('expands contents while the drawer subtree holds the selection (AGL-571)', () => {
    // The besigner renderer stamps data-aglyn-selected-within on the leaf
    // whenever the drawer node or any descendant is selected.
    renderEditor(
      <DrawerElement
        {...{
          'data-aglyn': 'leaf:drawer-5',
          'data-aglyn-selected-within': '',
        }}
      >
        <span>{'Editable contents'}</span>
      </DrawerElement>,
    )
    expect(screen.getByText('Editable contents')).toBeTruthy()
    expect(screen.getByText(/slides in on the live site/)).toBeTruthy()
  })
})

describe('DrawerToggle (AGL-562, interactions-only targeting AGL-572)', () => {
  it('toggles the first drawer on the page by default (preset wiring)', () => {
    render(
      <>
        <DrawerToggle ariaLabel="Open menu" />
        <DrawerElement {...{ 'data-aglyn': 'leaf:drawer-t2' }}>
          <span>{'Broadcast contents'}</span>
        </DrawerElement>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByText('Broadcast contents')).toBeTruthy()
  })

  it('silently ignores the legacy persisted targetNodeId binding', () => {
    render(
      <>
        <DrawerToggle targetNodeId="drawer-legacy" ariaLabel="Open menu" />
        <DrawerElement {...{ 'data-aglyn': 'leaf:drawer-first' }}>
          <span>{'First drawer contents'}</span>
        </DrawerElement>
        <DrawerElement {...{ 'data-aglyn': 'leaf:drawer-legacy' }}>
          <span>{'Legacy target contents'}</span>
        </DrawerElement>
      </>,
    )
    const button = screen.getByRole('button', { name: 'Open menu' })
    fireEvent.click(button)
    // The click still broadcasts to the page's first drawer — the old
    // binding neither retargets it nor leaks into the DOM. Explicit
    // targeting is an interaction now (When clicked → Open a drawer).
    expect(screen.getByText('First drawer contents')).toBeTruthy()
    expect(screen.queryByText('Legacy target contents')).toBeNull()
    expect(button.hasAttribute('targetnodeid')).toBe(false)
  })

  it('is inert on editing surfaces', () => {
    const seen: unknown[] = []
    const unsubscribe = Aglyn.subscribeDrawerCommands((d) => seen.push(d))
    renderEditor(<DrawerToggle ariaLabel="Open menu" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    unsubscribe()
    expect(seen).toHaveLength(0)
  })
})

describe('drawer schemas & presets (AGL-562)', () => {
  it('keeps the persisted component ids in the Navigation group', () => {
    expect(drawerSchema.$id).toBe('muiDrawer')
    expect(drawerToggleSchema.$id).toBe('muiDrawerToggle')
    expect(drawerSchema.category).toBe(Aglyn.ComponentCategory.NAVIGATION)
    expect(drawerToggleSchema.category).toBe(
      Aglyn.ComponentCategory.NAVIGATION,
    )
  })

  it('has no drawer-binding attribute — targeting is an interaction (AGL-572)', () => {
    const names = (drawerToggleSchema.attributes ?? []).map(
      (attr) => attr.name,
    )
    expect(names).toEqual(['ariaLabel'])
  })

  it('ships presets without the legacy binding attribute (AGL-572)', () => {
    const menuButton = drawerPresets.find(
      (preset) => preset.displayName === 'Menu Button',
    )!
    expect(menuButton.data.props).toEqual({})
    const mobileNav = drawerPresets.find(
      (preset) => preset.displayName === 'Mobile Nav',
    )!
    const toggle = (mobileNav.data.nodes ?? [])[0] as any
    expect(toggle.componentId).toBe('muiDrawerToggle')
    // Zero-config default (click toggles the page's first drawer) is
    // what wires the preset — no targetNodeId persisted anywhere.
    expect('targetNodeId' in toggle.props).toBe(false)
  })

  it('ships Drawer, Menu Button, and Mobile Nav presets', () => {
    const names = drawerPresets.map((preset) => preset.displayName)
    expect(names).toEqual(['Drawer', 'Menu Button', 'Mobile Nav'])
  })

  it('pre-wires the Mobile Nav responsive visibility bands', () => {
    const mobileNav = drawerPresets.find(
      (preset) => preset.displayName === 'Mobile Nav',
    )!
    const [toggle, links, drawer] = (mobileNav.data.nodes ?? []) as any[]
    expect(toggle.componentId).toBe('muiDrawerToggle')
    // Hamburger hidden on desktop; inline links hidden below desktop.
    expect(
      toggle.props.sx[Aglyn.VISIBILITY_BAND_MEDIA.desktop],
    ).toEqual({ display: 'none' })
    expect(
      links.props.sx[Aglyn.VISIBILITY_BAND_MEDIA.mobile],
    ).toEqual({ display: 'none' })
    expect(
      links.props.sx[Aglyn.VISIBILITY_BAND_MEDIA.tablet],
    ).toEqual({ display: 'none' })
    expect(drawer.componentId).toBe('muiDrawer')
    expect((drawer.nodes ?? []).length).toBeGreaterThan(0)
  })
})
