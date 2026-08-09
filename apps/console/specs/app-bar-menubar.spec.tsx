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
 *
 * @jest-environment jsdom
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import AppBarMenubarComponent from '../components/layouts/app-bar-menubar.component'

jest.mock('next/navigation', () => ({ usePathname: () => '/' }))

// Floating UI's autoUpdate observes the anchor and popup; jsdom ships neither
// ResizeObserver nor scrollIntoView, and Base UI highlights by scrolling the
// active item into view.
beforeAll(() => {
  ;(global as any).ResizeObserver =
    (global as any).ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  Element.prototype.scrollIntoView =
    Element.prototype.scrollIntoView ?? (() => undefined)
})

/**
 * The besigner FILE / EDIT / INSERT menubar (AGL-1222).
 *
 * These specs exercise the behaviour the adoption was for — a real menubar,
 * not three independent menus: open a menu and invoke a command, arrow from an
 * open menu to the SIBLING menu, Escape closing back onto its trigger — plus
 * the row anatomy AGL-1216 settled (one left edge per menu, `inset` standing
 * down when the spacer gutter is doing the job).
 *
 * What jsdom cannot exercise: hover-to-switch between triggers (Base UI keys
 * that off real pointer geometry) and anything visual. Those need a browser.
 */
describe('AppBarMenubarComponent (AGL-1222)', () => {
  const ICON = 'M12 2 L22 22 L2 22 Z'

  const buildEntries = (spies: {
    onSave: jest.Mock
    onNewVersion: jest.Mock
    onUndo: jest.Mock
    onRedo: jest.Mock
    onInsert: jest.Mock
  }) => [
    {
      id: 'center-nav-file',
      children: 'File',
      items: [
        {
          id: 'center-nav-file-save',
          icon: { path: ICON },
          children: 'Save',
          onClick: spies.onSave,
        },
        {
          id: 'center-nav-file-close',
          children: 'Close',
          href: '/screens/detail',
          ListItemTextProps: { inset: true },
        },
        { type: 'divider' as const },
        {
          id: 'center-nav-file-new-version',
          children: 'New version',
          onClick: spies.onNewVersion,
          ListItemTextProps: { inset: true },
        },
      ],
    },
    {
      id: 'center-nav-edit',
      children: 'Edit',
      items: [
        {
          id: 'center-nav-edit-undo',
          children: 'Undo',
          onClick: spies.onUndo,
          disabled: true,
        },
        {
          id: 'center-nav-edit-redo',
          children: 'Redo',
          onClick: spies.onRedo,
        },
      ],
    },
    {
      id: 'center-nav-insert',
      children: 'Insert',
      items: [
        {
          id: 'center-nav-insert-element',
          icon: { path: ICON },
          children: 'New Element',
          onClick: spies.onInsert,
        },
      ],
    },
  ]

  const setup = () => {
    const spies = {
      onSave: jest.fn(),
      onNewVersion: jest.fn(),
      onUndo: jest.fn(),
      onRedo: jest.fn(),
      onInsert: jest.fn(),
    }
    const utils = render(<AppBarMenubarComponent entries={buildEntries(spies)} />)
    const menubar = screen.getByRole('menubar')
    const trigger = (label: string) =>
      within(menubar).getByText(label).closest('button') as HTMLButtonElement
    return { ...utils, spies, menubar, trigger }
  }

  const openViaKeyboard = (trigger: HTMLButtonElement) => {
    // MUI's ButtonBase tracks focus-visible state on focus, so a bare
    // `.focus()` is a React state update jest must see inside act().
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    return screen.findByRole('menu')
  }

  it('renders one menubar holding the three triggers', () => {
    const { menubar } = setup()
    for (const label of ['File', 'Edit', 'Insert']) {
      expect(within(menubar).getByText(label)).toBeTruthy()
    }
    // No menu is open at rest.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the File menu on click and invokes a command', async () => {
    const { spies, trigger } = setup()
    const file = trigger('File')
    fireEvent.mouseDown(file)
    fireEvent.click(file)

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Save')).toBeTruthy()
    expect(within(menu).getByText('Close')).toBeTruthy()
    expect(within(menu).getByText('New version')).toBeTruthy()

    fireEvent.click(within(menu).getByText('Save'))
    expect(spies.onSave).toHaveBeenCalledTimes(1)
    // Invoking a command closes the menu (transition: none on the popup —
    // Paper's default box-shadow transition never ends in Base UI's book,
    // which left a closed menu on screen holding focus).
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('opens with ArrowDown and invokes the highlighted item with Enter', async () => {
    const { spies, trigger } = setup()
    const menu = await openViaKeyboard(trigger('File'))

    const save = within(menu).getByText('Save').closest('[role="menuitem"]') as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(save))
    fireEvent.keyDown(save, { key: 'Enter' })
    fireEvent.keyUp(save, { key: 'Enter' })
    // A native <button> row: the browser turns Enter into exactly one click.
    fireEvent.click(save)
    expect(spies.onSave).toHaveBeenCalledTimes(1)
  })

  it('ArrowRight moves from an open File menu to the Edit menu (the menubar behaviour)', async () => {
    const { trigger } = setup()
    const fileMenu = await openViaKeyboard(trigger('File'))

    fireEvent.keyDown(
      (document.activeElement as HTMLElement) ?? fileMenu,
      { key: 'ArrowRight' },
    )

    await waitFor(() => {
      const menu = screen.getByRole('menu')
      expect(within(menu).queryByText('Undo')).toBeTruthy()
    })
    // The File menu is gone — one open menu at a time.
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })

  it('Escape closes the menu and returns focus to its trigger', async () => {
    const { trigger } = setup()
    const file = trigger('File')
    await openViaKeyboard(file)

    fireEvent.keyDown(
      (document.activeElement as HTMLElement) ?? document.body,
      { key: 'Escape' },
    )

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(file))
  })

  it('a disabled row reads disabled and does not invoke its command', async () => {
    const { spies, trigger } = setup()
    const edit = trigger('Edit')
    fireEvent.mouseDown(edit)
    fireEvent.click(edit)

    const menu = await screen.findByRole('menu')
    const undo = within(menu).getByText('Undo').closest('[role="menuitem"]') as HTMLElement
    // Base UI enforces `disabled` via aria — a natively disabled button would
    // drop out of the arrow-key walk entirely.
    expect(undo.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(undo)
    expect(spies.onUndo).not.toHaveBeenCalled()
    // The menu shrugs the click off rather than closing on a dead row.
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('keeps one left edge per menu (AGL-1216): iconless rows get the spacer gutter, inset stands down', async () => {
    const { trigger } = setup()
    const file = trigger('File')
    fireEvent.mouseDown(file)
    fireEvent.click(file)
    const menu = await screen.findByRole('menu')

    const rows = within(menu).getAllByRole('menuitem')
    expect(rows.length).toBeGreaterThanOrEqual(3)
    for (const row of rows) {
      // Every row — Save with its icon, Close and New version without —
      // renders exactly one icon gutter.
      expect(row.querySelectorAll('.MuiListItemIcon-root')).toHaveLength(1)
    }
    // MUI's 56px `inset` never matched the dense 36px gutter; with the spacer
    // in place it must stand down or the row double-indents.
    expect(menu.querySelector('.MuiListItemText-inset')).toBeNull()
  })

  it('renders the Close row as a real link', async () => {
    const { trigger } = setup()
    const file = trigger('File')
    fireEvent.mouseDown(file)
    fireEvent.click(file)
    const menu = await screen.findByRole('menu')

    const close = within(menu).getByText('Close').closest('a') as HTMLAnchorElement
    expect(close).toBeTruthy()
    expect(close.getAttribute('href')).toBe('/screens/detail')
  })

  it('a menu-less entry stays a plain button', () => {
    render(
      <AppBarMenubarComponent
        entries={[{ id: 'plain', children: 'Docs', href: '/docs' }]}
      />,
    )
    const docs = screen.getByText('Docs').closest('a,button') as HTMLElement
    expect(docs).toBeTruthy()
    expect(docs.getAttribute('aria-haspopup')).toBeNull()
  })
})
