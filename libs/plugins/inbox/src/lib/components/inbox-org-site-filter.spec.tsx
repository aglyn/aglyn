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
 * The organization Inbox's site filter (AGL-3303).
 *
 * One control above the rail that every section follows: with every site,
 * the org-level cards; with one site picked, that site's own cards and its
 * ceiling notices — which only exist per site. The pick survives the page
 * mounting again, because each section is its own route and a filter that
 * reset on every tab would read as the rail throwing the choice away.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import { InboxConsolePage } from './inbox-console-page'
import { INBOX_ORG_CONSOLE_SECTIONS } from './inbox-console-sections'
import { inboxSitePickKey } from './use-inbox-site-pick'

/** Every counter document the notices asked for, by path. */
let mockNoticeReads: string[] = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: (ref: () => string | null) => {
    const path = ref()
    if (path) mockNoticeReads.push(path)
    return { data: undefined, status: 'success', fromCache: false }
  },
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
}))
jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

/**
 * Each section's card, reduced to the subject it was handed. A function
 * declaration, so the hoisted mock factories below can reach it.
 */
function mockSubject(name: string) {
  return function Probe(props: {
    hostId: string | null
    orgMount?: ConsolePluginOrgMount
  }) {
    return (
      <output aria-label="section">
        {`${name}:${props.hostId ?? 'every site'}${props.orgMount ? `:${props.orgMount.orgId}` : ''}`}
      </output>
    )
  }
}
jest.mock('./submissions-card.component', () => ({
  __esModule: true,
  default: mockSubject('submissions'),
}))
jest.mock('./contacts-card.component', () => ({
  __esModule: true,
  default: mockSubject('contacts'),
}))
jest.mock('./inbox-attribution-zone', () => ({
  InboxCampaignsZone: mockSubject('campaigns'),
}))

const BASE_PATH = '/acme/inbox'
const MOUNT: ConsolePluginOrgMount = {
  orgId: 'org-1',
  orgSlug: 'acme',
  hosts: [
    { id: 'site-a', name: 'Shop', subdomain: 'shop' },
    { id: 'site-b', name: 'Blog', subdomain: 'blog' },
  ],
  hostsReady: true,
  hostsPath: '/acme/hosts',
}

const renderPage = (section: string, mount: ConsolePluginOrgMount = MOUNT) =>
  render(
    <InboxConsolePage
      hostId={null}
      orgMount={mount}
      entitled
      basePath={BASE_PATH}
      sections={INBOX_ORG_CONSOLE_SECTIONS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        href: `${BASE_PATH}/${entry.id}`,
        visible: true,
      }))}
      section={section}
      segments={[section]}
      org={{} as never}
      permissions={{} as never}
    />,
  )

const shown = () => screen.getByLabelText('section').textContent

const pickSite = (name: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Site' }))
  fireEvent.click(
    within(screen.getByRole('listbox')).getByRole('option', { name }),
  )
}

beforeEach(() => {
  mockNoticeReads = []
  window.sessionStorage.clear()
})

describe('the organization Inbox’s site filter', () => {
  it('opens on every site, with the org-level card and no site’s notices', () => {
    renderPage('submissions')
    expect(shown()).toBe('submissions:every site:org-1')
    expect(screen.getByRole('combobox', { name: 'Site' }).textContent).toBe(
      'All sites',
    )
    // The notices belong to one site each; every site listed reads none.
    expect(mockNoticeReads).toEqual([])
  })

  it('narrows the page to one site: its card, and its notices', () => {
    renderPage('submissions')
    pickSite('Blog')
    expect(shown()).toBe('submissions:site-b')
    expect(window.sessionStorage.getItem(inboxSitePickKey('org-1'))).toBe(
      'site-b',
    )
    expect(new Set(mockNoticeReads)).toEqual(
      new Set([
        'hosts/site-b/counters/formSubmissionsRefused',
        'hosts/site-b/counters/formSubmissionsSpam',
        'hosts/site-b/counters/siteMembersRefused',
        'hosts/site-b/counters/leadsRefused',
      ]),
    )
  })

  it('keeps the pick when the next section mounts the page again', () => {
    const { unmount } = renderPage('submissions')
    pickSite('Shop')
    unmount()
    renderPage('contacts')
    expect(shown()).toBe('contacts:site-a')
  })

  it('goes back to every site, and forgets the pick', () => {
    renderPage('campaigns')
    pickSite('Blog')
    expect(shown()).toBe('campaigns:site-b')
    pickSite('All sites')
    expect(shown()).toBe('campaigns:every site:org-1')
    expect(window.sessionStorage.getItem(inboxSitePickKey('org-1'))).toBeNull()
  })

  it('offers no filter to an org with one site, and shows that site', () => {
    renderPage('contacts', { ...MOUNT, hosts: [MOUNT.hosts[0]] })
    expect(screen.queryByRole('combobox', { name: 'Site' })).toBeNull()
    expect(shown()).toBe('contacts:site-a')
  })

  it('draws no section until the org’s sites have settled', () => {
    renderPage('submissions', { ...MOUNT, hostsReady: false })
    expect(screen.queryByLabelText('section')).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('THE CONTROL: under a site there is no filter and the page is the site’s', async () => {
    await act(async () => {
      render(
        <InboxConsolePage
          hostId="site-a"
          entitled
          basePath="/acme/hosts/shop/inbox"
          sections={INBOX_ORG_CONSOLE_SECTIONS.map((entry) => ({
            id: entry.id,
            label: entry.label,
            href: `/acme/hosts/shop/inbox/${entry.id}`,
            visible: true,
          }))}
          section="submissions"
          segments={['submissions']}
          org={{} as never}
          permissions={{} as never}
        />,
      )
    })
    expect(screen.queryByRole('combobox', { name: 'Site' })).toBeNull()
    expect(shown()).toBe('submissions:site-a')
    expect(mockNoticeReads).toHaveLength(4)
  })
})
