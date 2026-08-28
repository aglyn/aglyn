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

/**
 * The vertical tab rail follows `?tab=`, and not only on mount (AGL-2486).
 *
 * `HubTabs` draws the rail behind the marketplace hub, the content browser,
 * the publish panel and every relocated feature plugin's console page. It read
 * the incoming id straight into `useState`:
 *
 * ```ts
 * const requestedTab = searchParams?.get('tab')
 * const [tab, setTab] = useState(initialTab)
 * ```
 *
 * `useState` reads its initializer once. Back and forward are navigations
 * between two states of ONE mounted page, and a link into another section of a
 * page already open changes the parameter without remounting anything — so
 * either one left the rail sitting on the old tab while the URL named a
 * different one. Nothing throws and nothing looks broken; the reader simply
 * does not arrive where the link said.
 *
 * A source check cannot see this. `useSearchParams` was called on every
 * render, so the rail *looked* reactive — what was frozen was the state it
 * fed. So this drives the component and moves the parameter under it.
 */

import { render, screen } from '@testing-library/react'

/**
 * The URL the mocked router reports. Reassigned between renders to stand for
 * a navigation — back/forward, or a link into an open page.
 */
// `mock`-prefixed, which is the one naming jest's out-of-scope-variable guard
// lets a module factory close over.
let mockSearch = ''
const mockReplace = jest.fn(
  (url: string, _options?: { scroll?: boolean }) => {
    mockSearch = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  },
)

jest.mock('next/navigation', () => ({
  usePathname: () => '/org/hub',
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

import { HubTabs } from '@aglyn/shared-ui-next/components/hub-tabs'

const TABS = [
  { id: 'browse', label: 'Browse All', content: <div>{'BROWSE PANEL'}</div> },
  { id: 'installed', label: 'Installed', content: <div>{'INSTALLED PANEL'}</div> },
  { id: 'publish', label: 'Publish', content: <div>{'PUBLISH PANEL'}</div> },
]

/** The panel a reader can actually see. `keepMounted` leaves the rest in the DOM. */
const shownPanel = (): string | null => {
  const panels = Array.from(
    document.querySelectorAll('[role="tabpanel"]'),
  ) as HTMLElement[]
  const visible = panels.find((panel) => !panel.hasAttribute('hidden'))
  return visible?.textContent?.trim() ?? null
}

beforeEach(() => {
  mockSearch = ''
  mockReplace.mockClear()
})

describe('HubTabs follows ?tab= (AGL-2486)', () => {
  it('THE CONTROL: the harness can tell one panel from another', () => {
    // Otherwise every assertion below could pass against a rail that renders
    // nothing at all, or against a `shownPanel` that always answers null.
    render(<HubTabs tabs={TABS} />)
    expect(shownPanel()).toBe('BROWSE PANEL')
    expect(screen.getByText('Installed')).toBeTruthy()
  })

  it('opens the tab the URL names on first paint', () => {
    mockSearch = 'tab=publish'
    render(<HubTabs tabs={TABS} />)
    expect(shownPanel()).toBe('PUBLISH PANEL')
  })

  it('THE REGRESSION: it follows the parameter CHANGING under it', () => {
    // The half `useState` could not do. Same mounted rail, new URL — which is
    // what back, forward and an in-app link into another section all are.
    mockSearch = 'tab=installed'
    const { rerender } = render(<HubTabs tabs={TABS} />)
    expect(shownPanel()).toBe('INSTALLED PANEL')

    mockSearch = 'tab=publish'
    rerender(<HubTabs tabs={TABS} />)
    expect(shownPanel()).toBe('PUBLISH PANEL')

    mockSearch = 'tab=browse'
    rerender(<HubTabs tabs={TABS} />)
    expect(shownPanel()).toBe('BROWSE PANEL')
  })

  it('falls back to the first tab for an id this hub does not render', () => {
    // Not a typo case only: several hubs build their tab list from
    // entitlements, so an id that is valid on one org names no panel on
    // another. Selecting it would render a rail over an empty pane.
    mockSearch = 'tab=nonesuch'
    render(<HubTabs tabs={TABS} />)
    expect(shownPanel()).toBe('BROWSE PANEL')
  })

  it('a lazy hub mounts the panel a URL sent it to', () => {
    // `lazy` defers un-visited panels, and the only thing that used to mark a
    // panel visited was a CLICK. A deep link is not a click.
    mockSearch = 'tab=publish'
    render(<HubTabs tabs={TABS} lazy />)
    expect(shownPanel()).toBe('PUBLISH PANEL')
    // And the panels nobody asked for stayed unmounted, which is the whole
    // point of the flag.
    expect(screen.queryByText('INSTALLED PANEL')).toBeNull()
  })

  it('writes the tab back into the URL when one is clicked', () => {
    render(<HubTabs tabs={TABS} />)
    screen.getByText('Installed').click()
    expect(mockReplace).toHaveBeenCalled()
    expect(mockReplace.mock.calls[0][0]).toContain('tab=installed')
    // Shallow: the hub view deep-links and survives back/forward without the
    // page jumping to the top on every tab click.
    expect(mockReplace.mock.calls[0][1]).toEqual({ scroll: false })
  })
})
