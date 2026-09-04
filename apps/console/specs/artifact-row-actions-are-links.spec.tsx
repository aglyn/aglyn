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

/**
 * The artifact row's trailing cluster: what is a LINK, and what is in both
 * surfaces (AGL-2501).
 *
 * Two properties, and neither is visible in a screenshot:
 *
 * 1. A navigation action is an `<a href>`. A click handler that calls
 *    `router.push` looks identical and behaves identically to a left click,
 *    and offers nothing to a middle click, a ⌘-click, "Open link in new tab",
 *    or "Copy link address".
 * 2. The quick action is named in the overflow menu as well as drawn as an
 *    icon, and the two are refused together. The icon is a bare glyph; the
 *    menu is where a row's actions are spelled out, so an action missing from
 *    it reads as an action the row does not have.
 */

import { ListRowActions } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { mdiOpenInNew } from '@aglyn/shared-data-mdi'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({ usePathname: () => '/' }))

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
}

describe('artifact row actions are real links (AGL-2501)', () => {
  it('renders a menu item with an href as an anchor', () => {
    render(
      <ListRowActions
        label="Home"
        items={[
          { key: 'details', label: 'View details', href: '/acme/screens/1' },
          { key: 'besigner', label: 'Edit in besigner', href: '/acme/b/1' },
        ]}
      />,
    )
    openMenu()

    const details = screen.getByRole('menuitem', { name: 'View details' })
    expect(details.tagName).toBe('A')
    expect(details.getAttribute('href')).toBe('/acme/screens/1')

    const besigner = screen.getByRole('menuitem', { name: 'Edit in besigner' })
    expect(besigner.tagName).toBe('A')
    expect(besigner.getAttribute('href')).toBe('/acme/b/1')
  })

  it('leaves a handler-only item a button, and still closes the menu', () => {
    const onClick = jest.fn()
    render(
      <ListRowActions
        label="Home"
        items={[{ key: 'delete', label: 'Delete', onClick }]}
      />,
    )
    openMenu()

    const item = screen.getByRole('menuitem', { name: 'Delete' })
    expect(item.tagName).not.toBe('A')
    fireEvent.click(item)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('opens an external quick action in a new tab, from both surfaces', () => {
    render(
      <ListRowActions
        label="Home"
        quick={{
          icon: mdiOpenInNew.path,
          label: 'Open live page',
          href: 'https://acme.example/',
        }}
        items={[{ key: 'delete', label: 'Delete', onClick: jest.fn() }]}
      />,
    )

    // MUI's IconButton keeps `role="button"` when its root is an anchor, so
    // the element is asked for by its accessible name and checked for the
    // thing that matters: it is an `<a>` with a real destination.
    const icon = screen.getByRole('button', { name: 'Open live page — Home' })
    expect(icon.tagName).toBe('A')
    expect(icon.getAttribute('href')).toBe('https://acme.example/')
    expect(icon.getAttribute('target')).toBe('_blank')

    openMenu()
    const item = screen.getByRole('menuitem', { name: 'Open live page' })
    expect(item.tagName).toBe('A')
    expect(item.getAttribute('href')).toBe('https://acme.example/')
    expect(item.getAttribute('target')).toBe('_blank')
  })

  it('keeps an in-app quick action a same-tab link in both surfaces', () => {
    render(
      <ListRowActions
        label="Header"
        quick={{
          icon: mdiOpenInNew.path,
          label: 'Preview',
          to: '/acme/layouts/1/preview',
        }}
        items={[{ key: 'delete', label: 'Delete', onClick: jest.fn() }]}
      />,
    )

    const icon = screen.getByRole('button', { name: 'Preview — Header' })
    expect(icon.tagName).toBe('A')
    expect(icon.getAttribute('href')).toBe('/acme/layouts/1/preview')
    expect(icon.getAttribute('target')).toBeNull()

    openMenu()
    const item = screen.getByRole('menuitem', { name: 'Preview' })
    expect(item.tagName).toBe('A')
    expect(item.getAttribute('href')).toBe('/acme/layouts/1/preview')
    expect(item.getAttribute('target')).toBeNull()
  })

  it('refuses the quick action in BOTH surfaces at once', () => {
    render(
      <ListRowActions
        label="Blog — Entry Template"
        quick={{
          icon: mdiOpenInNew.path,
          label: 'Open live page',
          unavailableReason: 'Renders /blog/{entry} — no single live address.',
        }}
        items={[{ key: 'delete', label: 'Delete', onClick: jest.fn() }]}
      />,
    )

    // The icon: present, disabled, and never a link.
    const icon = screen.getByRole('button', {
      name: 'Open live page — Blog — Entry Template',
    })
    expect(icon.tagName).toBe('BUTTON')
    expect((icon as HTMLButtonElement).disabled).toBe(true)

    openMenu()
    const item = screen.getByRole('menuitem', { name: 'Open live page' })
    expect(item.tagName).not.toBe('A')
    expect(item.getAttribute('aria-disabled')).toBe('true')
    // The reason travels with the refusal: a disabled item takes no pointer
    // events, so the tooltip hangs off a wrapper that does.
    expect(item.parentElement?.tagName).toBe('SPAN')
  })
})
