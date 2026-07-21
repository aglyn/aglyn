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
import NavMenu, {
  MegaMenu,
  megaMenuPanelSx,
  megaMenuSchema,
  navMenuPresets,
  navMenuSchema,
} from './nav-menu'

const command = (
  kind: Aglyn.MenuCommand,
  nodeId?: string,
  options?: { hover?: boolean },
) =>
  act(() => {
    Aglyn.dispatchMenuCommand(kind, nodeId, options)
  })

/** Renders on a "live site" surface (navigation not suppressed). */
const renderLive = (ui: React.ReactElement) => render(ui)

/** Renders on an editing surface (besigner canvas / preview). */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

describe('NavMenu dropdown (AGL-562)', () => {
  it('ships closed and click-toggles by default (zero config)', () => {
    renderLive(
      <NavMenu label="Company">
        <a href="/about">{'About'}</a>
      </NavMenu>,
    )
    expect(screen.queryByText('About')).toBeNull()
    const trigger = screen.getByRole('button', { name: /Company/ })
    expect(trigger.getAttribute('aria-haspopup')).toBe('true')
    fireEvent.click(trigger)
    expect(screen.getByText('About')).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(trigger)
    expect(screen.queryByText('About')).toBeNull()
  })

  it('closes on Escape', () => {
    renderLive(
      <NavMenu label="Company">
        <a href="/about">{'About'}</a>
      </NavMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Company/ }))
    fireEvent.keyDown(screen.getByText('About'), { key: 'Escape' })
    expect(screen.queryByText('About')).toBeNull()
  })

  it('silently ignores the removed "Open on" attribute from persisted docs (AGL-568)', () => {
    // Pre-568 screen documents may still carry props.trigger; it must
    // neither leak onto the DOM nor change behavior — no warnings.
    const { container } = renderLive(
      <NavMenu {...{ trigger: 'hover' }} label="Company">
        <a href="/about">{'About'}</a>
      </NavMenu>,
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.getAttribute('trigger')).toBeNull()
    // Hover alone no longer opens the menu…
    fireEvent.mouseOver(wrapper, { relatedTarget: document.body })
    expect(screen.queryByText('About')).toBeNull()
    // …the click default still does.
    fireEvent.click(screen.getByRole('button', { name: /Company/ }))
    expect(screen.getByText('About')).toBeTruthy()
  })

  it('renders only the collapsed trigger on the canvas by default (AGL-571)', () => {
    renderEditor(
      <NavMenu label="Company">
        <a href="/about">{'About'}</a>
      </NavMenu>,
    )
    // The canvas mirrors the live site's collapsed state until the menu
    // is being authored.
    expect(screen.getByRole('button', { name: /Company/ })).toBeTruthy()
    expect(screen.queryByText('About')).toBeNull()
    expect(screen.queryByText(/Dropdown items/)).toBeNull()
  })

  it('expands inline while the menu subtree holds the selection (AGL-571)', () => {
    // The besigner renderer stamps data-aglyn-selected-within on the leaf
    // whenever the menu node or any descendant is selected.
    renderEditor(
      <NavMenu label="Company" {...{ 'data-aglyn-selected-within': '' }}>
        <a href="/about">{'About'}</a>
      </NavMenu>,
    )
    // No click needed — the dropdown contents are editable in place.
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.getByText(/Dropdown items/)).toBeTruthy()
  })

  it('collapses again when selection leaves the subtree (AGL-571)', () => {
    const editor = (selectedWithin: boolean) => (
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <NavMenu
          label="Company"
          {...(selectedWithin ? { 'data-aglyn-selected-within': '' } : {})}
        >
          <a href="/about">{'About'}</a>
        </NavMenu>
      </Aglyn.ScreenLinkContext.Provider>
    )
    const { rerender } = render(editor(true))
    expect(screen.getByText('About')).toBeTruthy()
    rerender(editor(false))
    expect(screen.queryByText('About')).toBeNull()
  })
})

describe('menu command bus (AGL-568)', () => {
  it('answers open/close/toggle commands for its node id', () => {
    renderLive(
      <NavMenu label="Company" {...{ 'data-aglyn': 'leaf:menu-1' }}>
        <a href="/about">{'About'}</a>
      </NavMenu>,
    )
    command('open', 'menu-1')
    expect(screen.getByText('About')).toBeTruthy()
    command('close', 'menu-1')
    expect(screen.queryByText('About')).toBeNull()
    command('toggle', 'menu-1')
    expect(screen.getByText('About')).toBeTruthy()
    command('toggle', 'menu-1')
    expect(screen.queryByText('About')).toBeNull()
  })

  it('matches a raw-id command to a layout-namespaced live menu (AGL-573)', () => {
    // The live layout node is stamped `leaf:layout___5I3TBXywa`, but the
    // besigner-authored openMenu step carries the raw canvas id.
    renderLive(
      <NavMenu label="Shop" {...{ 'data-aglyn': 'leaf:layout___5I3TBXywa' }}>
        <a href="/shop">{'Shop contents'}</a>
      </NavMenu>,
    )
    command('open', '_5I3TBXywa')
    expect(screen.getByText('Shop contents')).toBeTruthy()
    command('close', '_5I3TBXywa')
    expect(screen.queryByText('Shop contents')).toBeNull()
  })

  it('matches a namespaced command to a raw-id live menu (reverse, AGL-573)', () => {
    renderLive(
      <NavMenu label="Shop" {...{ 'data-aglyn': 'leaf:_5I3TBXywa' }}>
        <a href="/shop">{'Shop contents'}</a>
      </NavMenu>,
    )
    command('open', 'layout___5I3TBXywa')
    expect(screen.getByText('Shop contents')).toBeTruthy()
  })

  it('never matches a command whose id merely embeds the menu id (AGL-573)', () => {
    renderLive(
      <NavMenu label="Shop" {...{ 'data-aglyn': 'leaf:_5I3TBXywa' }}>
        <a href="/shop">{'Shop contents'}</a>
      </NavMenu>,
    )
    command('open', 'layout__X_5I3TBXywaY')
    expect(screen.queryByText('Shop contents')).toBeNull()
  })

  it('ignores commands addressed to other menus', () => {
    renderLive(
      <NavMenu label="Mine" {...{ 'data-aglyn': 'leaf:menu-2' }}>
        <a href="/about">{'Mine only'}</a>
      </NavMenu>,
    )
    command('open', 'someone-else')
    expect(screen.queryByText('Mine only')).toBeNull()
  })

  it('routes broadcast commands to the first mounted menu only', () => {
    renderLive(
      <>
        <NavMenu label="First" {...{ 'data-aglyn': 'leaf:first' }}>
          <a href="/a">{'First contents'}</a>
        </NavMenu>
        <NavMenu label="Second" {...{ 'data-aglyn': 'leaf:second' }}>
          <a href="/b">{'Second contents'}</a>
        </NavMenu>
      </>,
    )
    command('toggle')
    expect(screen.getByText('First contents')).toBeTruthy()
    expect(screen.queryByText('Second contents')).toBeNull()
  })

  it('drives Mega Menus over the same bus', () => {
    renderLive(
      <MegaMenu label="Products" {...{ 'data-aglyn': 'leaf:mega-1' }}>
        <div>{'Columns'}</div>
      </MegaMenu>,
    )
    command('open', 'mega-1')
    expect(screen.getByText('Columns')).toBeTruthy()
  })

  it('never enrolls editing-surface menus (broadcasts go to live menus)', () => {
    // The editor menu mounts FIRST; a broadcast must still land on the
    // first LIVE menu because canvas menus render inline, not command-
    // driven.
    renderEditor(
      <NavMenu label="Canvas" {...{ 'data-aglyn': 'leaf:editor-1' }}>
        <a href="/e">{'Editor contents'}</a>
      </NavMenu>,
    )
    renderLive(
      <NavMenu label="Live" {...{ 'data-aglyn': 'leaf:live-1' }}>
        <a href="/l">{'Live contents'}</a>
      </NavMenu>,
    )
    command('open')
    expect(screen.getByText('Live contents')).toBeTruthy()
  })
})

describe('hover-opened menus (AGL-568)', () => {
  it('closes after the pointer leaves the trigger + panel surface', () => {
    jest.useFakeTimers()
    try {
      const { container } = renderLive(
        <NavMenu label="Company" {...{ 'data-aglyn': 'leaf:hover-1' }}>
          <a href="/about">{'About'}</a>
        </NavMenu>,
      )
      const wrapper = container.firstElementChild as HTMLElement
      // "On hover → Open menu" stamps the hover flag on the command.
      command('open', 'hover-1', { hover: true })
      expect(screen.getByText('About')).toBeTruthy()
      fireEvent.mouseOut(wrapper, { relatedTarget: document.body })
      // Still open inside the grace period …
      expect(screen.getByText('About')).toBeTruthy()
      act(() => jest.advanceTimersByTime(400))
      expect(screen.queryByText('About')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('cancels the pending close when the pointer re-enters', () => {
    jest.useFakeTimers()
    try {
      const { container } = renderLive(
        <NavMenu label="Company" {...{ 'data-aglyn': 'leaf:hover-2' }}>
          <a href="/about">{'About'}</a>
        </NavMenu>,
      )
      const wrapper = container.firstElementChild as HTMLElement
      command('open', 'hover-2', { hover: true })
      fireEvent.mouseOut(wrapper, { relatedTarget: document.body })
      // Pointer travels back onto the trigger/panel before the grace
      // period elapses — the menu stays open.
      fireEvent.mouseOver(wrapper, { relatedTarget: document.body })
      act(() => jest.advanceTimersByTime(400))
      expect(screen.getByText('About')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })

  it('leaves click- and command-opened menus alone on pointer leave', () => {
    jest.useFakeTimers()
    try {
      const { container } = renderLive(
        <NavMenu label="Company" {...{ 'data-aglyn': 'leaf:hover-3' }}>
          <a href="/about">{'About'}</a>
        </NavMenu>,
      )
      const wrapper = container.firstElementChild as HTMLElement
      fireEvent.click(screen.getByRole('button', { name: /Company/ }))
      fireEvent.mouseOut(wrapper, { relatedTarget: document.body })
      act(() => jest.advanceTimersByTime(400))
      // Click-opened menus only close via toggle, click-away, Escape,
      // or an explicit close command.
      expect(screen.getByText('About')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('MegaMenu (AGL-562)', () => {
  it('click-toggles by default like the dropdown (AGL-568)', () => {
    const { container } = renderLive(
      <MegaMenu label="Products" panelWidth="wide">
        <div>{'Columns'}</div>
      </MegaMenu>,
    )
    expect(screen.queryByText('Columns')).toBeNull()
    // Bare hover no longer opens it — hover opening is an interaction.
    fireEvent.mouseOver(container.firstElementChild as HTMLElement, {
      relatedTarget: document.body,
    })
    expect(screen.queryByText('Columns')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Products/ }))
    expect(screen.getByText('Columns')).toBeTruthy()
  })

  it('canvas-collapses to the trigger until its subtree is selected (AGL-571)', () => {
    renderEditor(
      <MegaMenu label="Products">
        <div>{'Columns'}</div>
      </MegaMenu>,
    )
    expect(screen.getByRole('button', { name: /Products/ })).toBeTruthy()
    expect(screen.queryByText('Columns')).toBeNull()
  })

  it('canvas-expands its panel while selected (AGL-571)', () => {
    renderEditor(
      <MegaMenu label="Products" {...{ 'data-aglyn-selected-within': '' }}>
        <div>{'Columns'}</div>
      </MegaMenu>,
    )
    expect(screen.getByText('Columns')).toBeTruthy()
    expect(screen.getByText(/Mega menu panel/)).toBeTruthy()
  })

  it('sizes the panel per width preset', () => {
    expect(megaMenuPanelSx('full')).toMatchObject({ width: '100vw' })
    expect(megaMenuPanelSx('wide')).toMatchObject({
      width: 'min(90vw, 720px)',
    })
    expect(megaMenuPanelSx('auto')).toMatchObject({ minWidth: 280 })
  })
})

describe('nav menu schemas & presets (AGL-562)', () => {
  it('keeps the persisted component ids', () => {
    expect(navMenuSchema.$id).toBe('muiNavMenu')
    expect(megaMenuSchema.$id).toBe('muiMegaMenu')
  })

  it('registers both in the Navigation picker group', () => {
    expect(navMenuSchema.category).toBe(Aglyn.ComponentCategory.NAVIGATION)
    expect(megaMenuSchema.category).toBe(Aglyn.ComponentCategory.NAVIGATION)
    for (const preset of navMenuPresets) {
      expect(preset.category).toBe(Aglyn.ComponentCategory.NAVIGATION)
    }
  })

  it('exposes only content attributes — no "Open on" (AGL-568)', () => {
    // Open/close behavior rides the interactions system; a bespoke
    // trigger attribute must never come back.
    expect((navMenuSchema.attributes ?? []).map((attr) => attr.name)).toEqual(
      ['label'],
    )
    expect((megaMenuSchema.attributes ?? []).map((attr) => attr.name)).toEqual(
      ['label', 'panelWidth'],
    )
    const megaByName = Object.fromEntries(
      (megaMenuSchema.attributes ?? []).map((attr) => [attr.name, attr]),
    )
    expect((megaByName['panelWidth']?.options ?? []).map((o: any) => o.value))
      .toEqual(['', 'wide', 'full'])
  })

  it('presets compose links from persisted component ids only', () => {
    const componentIds = new Set<string>()
    const walk = (node: any) => {
      componentIds.add(node.componentId)
      for (const child of node.nodes ?? []) walk(child)
    }
    for (const preset of navMenuPresets) walk(preset.data)
    for (const id of componentIds) {
      expect([
        'muiNavMenu',
        'muiMegaMenu',
        'muiStack',
        'muiTypography',
        'muiScreenLink',
        // The AGL-589 Dropdown Panel preset triggers off a button.
        'muiButton',
      ]).toContain(id)
    }
  })

  it('presets never persist an open-on trigger prop (AGL-568)', () => {
    const walk = (node: any) => {
      expect(node.props?.trigger).toBeUndefined()
      for (const child of node.nodes ?? []) walk(child)
    }
    for (const preset of navMenuPresets) walk(preset.data)
  })
})
