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
 * Notifications is one area with a section rail (AGL-3230).
 *
 * Settings was briefly a third tab in the app bar's Manage strip, which lists
 * the console's personal AREAS — so an area and that area's own settings
 * appeared side by side at the same rank. The rail is what the console uses
 * for this everywhere else, and the load-bearing assertion here is the one
 * about the strip: a rail that exists while the tab ALSO does would look
 * right on screen and still say the wrong thing about the hierarchy.
 */

import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

let mockPathname = '/manage/notifications'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

/**
 * The console chrome, stubbed to expose what the layout HANDS it.
 *
 * The real `DashboardLayout` reaches for branding, host tabs and a
 * presence subscription, none of which is on the path from "which section"
 * to "which header, trail and help". Rendering the props as text is what
 * lets a breadcrumb assertion fail on the trail rather than on a chrome
 * detail that has nothing to do with it.
 */
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({
    children,
    breadcrumbItems,
    help,
  }: {
    children?: ReactNode
    breadcrumbItems?: Array<{ children: string }>
    help?: { anchor?: string }
  }) => (
    <div>
      <div data-testid="trail">
        {(breadcrumbItems ?? []).map((item) => item.children).join(' / ')}
      </div>
      <div data-testid="help">{help?.anchor ?? ''}</div>
      {children}
    </div>
  ),
}))

import Layout from '../app/(app)/manage/notifications/(sections)/layout'
import { NOTIFICATION_SECTIONS } from '../constants/notification-sections'
import manageNavTabItems from '../constants/manage-nav-tabs'

const trail = () => screen.getByTestId('trail').textContent
const helpAnchor = () => screen.getByTestId('help').textContent

describe('the Notifications section rail (AGL-3230)', () => {
  beforeEach(() => {
    mockPathname = '/manage/notifications'
  })

  it('is NOT a tab in the app bar', () => {
    // The whole point. Both at once is the failure this replaces: a rail
    // beside a strip that still lists the same page reads as two different
    // answers to where settings lives.
    const labels = manageNavTabItems().map((tab) => tab.label)
    expect(labels).toEqual(['Notifications', 'Manage Account'])
    expect(
      manageNavTabItems().some((tab) =>
        tab.href.startsWith('/manage/notifications/settings'),
      ),
    ).toBe(false)
  })

  it('lists both sections, linked to their own routes', () => {
    render(<Layout>{'panel'}</Layout>)
    const feed = screen.getByRole('tab', { name: 'All notifications' })
    const settings = screen.getByRole('tab', { name: 'Settings' })
    expect(feed.getAttribute('href')).toBe('/manage/notifications')
    expect(settings.getAttribute('href')).toBe(
      '/manage/notifications/settings',
    )
  })

  it('selects the section the URL is on', () => {
    const { unmount } = render(<Layout>{'panel'}</Layout>)
    expect(
      screen.getByRole('tab', { name: 'All notifications' }).getAttribute('aria-selected'),
    ).toBe('true')
    unmount()

    // By PREFIX and longest match first, so `/settings` beats the feed's
    // `/manage/notifications` rather than being swallowed by it.
    mockPathname = '/manage/notifications/settings'
    render(<Layout>{'panel'}</Layout>)
    expect(
      screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('names the section in the trail, without repeating the area', () => {
    const { unmount } = render(<Layout>{'panel'}</Layout>)
    // The feed IS the area's own route, so a second crumb would say
    // "Notifications / All notifications" about one page.
    expect(trail()).toBe('Notifications')
    unmount()

    mockPathname = '/manage/notifications/settings'
    render(<Layout>{'panel'}</Layout>)
    expect(trail()).toBe('Notifications / Settings')
  })

  it('points the help icon at the heading the reader is standing in front of', () => {
    const { unmount } = render(<Layout>{'panel'}</Layout>)
    expect(helpAnchor()).toBe('#the-notifications-feed')
    unmount()

    mockPathname = '/manage/notifications/settings'
    render(<Layout>{'panel'}</Layout>)
    expect(helpAnchor()).toBe('#notification-settings')
  })

  it('falls back to the first section on a route no entry claims', () => {
    // A layout that read `active.anchor` off `null` would throw here, which
    // on a Next layout is a blank area rather than a missing help icon.
    mockPathname = '/manage/notifications-elsewhere'
    render(<Layout>{'panel'}</Layout>)
    expect(helpAnchor()).toBe(NOTIFICATION_SECTIONS[0].anchor)
    expect(trail()).toBe('Notifications')
  })

  it('renders the section it was handed, beside the rail', () => {
    render(<Layout>{'the section'}</Layout>)
    expect(screen.getByText('the section')).toBeTruthy()
  })

  it('CONTROL — every section the constant lists is drawn', () => {
    // A rail built from a stale copy of the list would pass every assertion
    // above while quietly dropping a third section somebody added.
    render(<Layout>{'panel'}</Layout>)
    const rail = screen.getAllByRole('tab')
    expect(rail).toHaveLength(NOTIFICATION_SECTIONS.length)
    for (const section of NOTIFICATION_SECTIONS) {
      expect(
        rail.some((tab) => within(tab).queryByText(section.label)),
      ).toBe(true)
    }
  })
})
