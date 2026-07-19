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
  it('ships closed and opens on click', () => {
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

  it('opens on hover (with a leave grace period) when configured', () => {
    jest.useFakeTimers()
    try {
      const { container } = renderLive(
        <NavMenu label="Company" trigger="hover">
          <a href="/about">{'About'}</a>
        </NavMenu>,
      )
      const wrapper = container.firstElementChild as HTMLElement
      fireEvent.mouseOver(wrapper)
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

  it('renders children expanded inline on editing surfaces', () => {
    renderEditor(
      <NavMenu label="Company">
        <a href="/about">{'About'}</a>
      </NavMenu>,
    )
    // No click needed — the dropdown contents are editable in place.
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.getByText(/Dropdown items/)).toBeTruthy()
  })
})

describe('MegaMenu (AGL-562)', () => {
  it('defaults to hover and shows the panel contents', () => {
    const { container } = renderLive(
      <MegaMenu label="Products" panelWidth="wide">
        <div>{'Columns'}</div>
      </MegaMenu>,
    )
    expect(screen.queryByText('Columns')).toBeNull()
    fireEvent.mouseOver(container.firstElementChild as HTMLElement)
    expect(screen.getByText('Columns')).toBeTruthy()
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

  it('declares the trigger and panel width attributes', () => {
    const navByName = Object.fromEntries(
      (navMenuSchema.attributes ?? []).map((attr) => [attr.name, attr]),
    )
    expect(navByName['label']).toBeTruthy()
    expect((navByName['trigger']?.options ?? []).map((o: any) => o.value))
      .toEqual(['', 'click', 'hover'])
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
      ]).toContain(id)
    }
  })
})
