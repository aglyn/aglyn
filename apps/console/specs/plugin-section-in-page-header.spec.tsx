/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * THE HEADING SAYS WHICH SECTION OF THE SURFACE IS OPEN.
 *
 * A surface with a vertical section rail is several pages behind one nav
 * item, and its heading named only the surface — so `/marketing/campaigns`
 * and `/marketing/overlays` put the same word at the top of two different
 * pages, and the breadcrumb was the only thing that moved.
 *
 * The surface name STAYS. It is what tells a reader which of a dozen surfaces
 * they are on, and a heading that swapped it for the section would answer a
 * question nobody asked at the cost of the one they did. The section is added
 * after it.
 *
 * Asserted at both ends: the header component renders the pair, and the
 * shell's plugin route supplies the section it resolved from the URL. Neither
 * alone is the behavior — a component that renders whatever it is handed and
 * a route that hands it nothing would both pass their own half.
 */

import { render, screen, waitFor } from '@testing-library/react'
import {
  registerConsoleExtension,
  unregisterConsoleExtension,
  type ConsolePluginPageProps,
} from '@aglyn/aglyn'
import type { ReactNode } from 'react'

/** The URL's segments beneath the site. */
let mockSegments: string[]
/** The `header` prop the route handed the layout, per render. */
let mockHeaders: Array<Record<string, unknown> | undefined>

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginSlug: mockSegments }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => `/acme/hosts/acme-site/${mockSegments.join('/')}`,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useRemoteConfig: () => ({ defaultConfig: {} }),
  useUser: () => ({
    data: {
      uid: 'u1',
      getIdToken: async () => 'tok',
      getIdTokenResult: async () => ({ claims: {} }),
    },
  }),
}))

jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => true,
  getValue: () => ({ asString: () => '' }),
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-url-names-org', () => ({ useUrlNamesOrg: () => true }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'pro' }, ready: true }),
  useCurrentOrg: () => ({ org: { $id: 'org-1', plan: 'pro' }, ready: true }),
}))
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
  useHostRole: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: {}, can: () => true, loaded: true }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  useReleaseFlags: () => ({
    flags: new Proxy({}, { get: () => ({ released: true }) }),
    ready: true,
    isStaff: false,
  }),
}))
jest.mock('../components/feature-gate.component', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['contacts'],
}))
jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'acme-site',
}))
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => null,
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/console-media-picker-provider.component', () => passthrough)

/*
 * The layout stands in only to RECORD what the route asked for. The header
 * component's own rendering is asserted separately below, against the real
 * one — mounting the whole chrome here would test the wrong half twice.
 */
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ header, children }: any) => {
    mockHeaders.push(header)
    return <div>{children}</div>
  },
}))

import HostPluginPage from '../app/(app)/[orgSlug]/hosts/[host]/[...pluginSlug]/page'
import DashboardHeaderComponent from '../components/dashboard-header.component'

function MockPluginPage(_props: ConsolePluginPageProps) {
  return <div>{'plugin body'}</div>
}

beforeEach(() => {
  mockHeaders = []
  mockSegments = ['contacts', 'people']
  registerConsoleExtension({
    pluginId: 'contacts',
    displayName: 'Contacts',
    navItems: [
      {
        label: 'Contacts',
        href: '/contacts',
        navTabId: 'nav-tab-contacts',
        header: { title: 'Contacts' },
        Component: MockPluginPage,
        sections: [
          { id: 'people', label: 'People' },
          { id: 'reports', label: 'Reports' },
        ],
      },
    ],
  })
})

afterEach(() => {
  unregisterConsoleExtension('contacts')
})

/** The `header` the route asked for on the most recent render. */
const askedFor = () => mockHeaders[mockHeaders.length - 1] ?? {}

async function mountAt(segments: string[]) {
  mockSegments = segments
  mockHeaders = []
  render(<HostPluginPage />)
  await waitFor(() => expect(mockHeaders.length).toBeGreaterThan(0))
}

describe('the shell names the open section in the page header', () => {
  it('keeps the surface name and adds the section', async () => {
    await mountAt(['contacts', 'people'])
    expect(askedFor()['children']).toBe('Contacts')
    expect(askedFor()['secondary']).toBe('People')
  })

  it('gives two sections of one surface two different headings', async () => {
    await mountAt(['contacts', 'people'])
    const people = [askedFor()['children'], askedFor()['secondary']]
    await mountAt(['contacts', 'reports'])
    const reports = [askedFor()['children'], askedFor()['secondary']]
    // The failure this catches is the one that shipped: both sections of one
    // surface reading identically. Asserting either heading's exact text
    // would pass a header that never changed.
    expect(people).not.toEqual(reports)
    expect(reports).toEqual(['Contacts', 'Reports'])
  })

  it('asks for no section on a surface that has none open', async () => {
    // A sectionless surface, and the same route: the heading is the surface
    // name and nothing is appended to it.
    unregisterConsoleExtension('contacts')
    registerConsoleExtension({
      pluginId: 'contacts',
      displayName: 'Contacts',
      navItems: [
        {
          label: 'Contacts',
          href: '/contacts',
          navTabId: 'nav-tab-contacts',
          header: { title: 'Contacts' },
          Component: MockPluginPage,
        },
      ],
    })
    await mountAt(['contacts'])
    expect(askedFor()['children']).toBe('Contacts')
    expect(askedFor()['secondary']).toBeUndefined()
  })
})

describe('the header renders the pair as one heading', () => {
  it('CONTROL: prints the surface, then the section, in one h1', () => {
    render(
      <DashboardHeaderComponent
        header={{ children: 'Marketing', secondary: 'A/B testing' }}
        breadcrumbItems={[]}
      />,
    )
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toContain('Marketing')
    expect(heading.textContent).toContain('A/B testing')
    expect(heading.textContent?.indexOf('Marketing')).toBeLessThan(
      heading.textContent?.indexOf('A/B testing') ?? -1,
    )
    // One heading, not two. A second `h1` would tell a screen reader walking
    // the outline that this is two pages.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('prints the surface alone when there is no section', () => {
    render(
      <DashboardHeaderComponent
        header={{ children: 'Marketing' }}
        breadcrumbItems={[]}
      />,
    )
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Marketing')
  })
})
