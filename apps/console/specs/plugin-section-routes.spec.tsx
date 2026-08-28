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
 * A plugin console page is a hub of real URLs, and each one is gated exactly
 * as the nav is (AGL-693).
 *
 * The shell's plugin route is a catch-all now, so `/products/orders` is a page
 * somebody can type, link, or bookmark. Two things then have to hold that a
 * tab strip gave away for free:
 *
 *  - A section nobody declared is a 404. As panels, a bad `?tab=` fell back to
 *    the first tab and nobody minded. As routes, falling back means the URL
 *    names Orders and the dashboard opens, which is reported as "it opened the
 *    wrong page" rather than as a typo.
 *  - A section behind a release flag is refused on a deep link. A hidden tab
 *    used to BE the gate; a URL is reachable whether or not a tab was drawn.
 *
 * The gating half is walked as a matrix — parent off/on × section off/on — and
 * only the last row may render. The row that matters is parent OFF, section
 * ON: it is the one an `||` would pass, and swapping the nested gates for an
 * OR is exactly the mistake that makes a flagged-off surface reachable by
 * typing its URL.
 *
 * Everything under test is the shipped path: the REAL registry (a
 * `ConsoleExtension` is registered here and `resolveConsolePluginPage` does
 * the matching), the REAL `ReleaseFlagsProvider` and the REAL `FeatureGate`.
 * Only Remote Config, the org listener and the router are faked. Assertions
 * are on which COMPONENT mounted — a recording page that reports the props it
 * was handed — never on chrome copy, which renders the same either way.
 */

import { render, screen, waitFor } from '@testing-library/react'
import {
  registerConsoleExtension,
  unregisterConsoleExtension,
  type ConsolePluginPageProps,
} from '@aglyn/aglyn'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'

/** Published Remote Config values, by flag key. */
let mockFlags: Record<string, { enabled: boolean }>
/** Every props object the plugin page was rendered with. */
let received: ConsolePluginPageProps[]
/** The URL's segments beneath the site. */
let mockSegments: string[]

/**
 * Stands in for the plugin's page. It asserts nothing — it records that it
 * mounted and what it was handed, which is what "the section rendered" means
 * here. A rendered STRING would be the same string whichever section opened.
 */
function mockRecordingPluginPage(props: ConsolePluginPageProps) {
  received.push(props)
  return <div>{`section:${props.section ?? 'none'}`}</div>
}

/**
 * `notFound()` throws in Next, and the throw is the behavior under test — a
 * spy that merely records would let the component go on rendering the page it
 * was supposed to refuse.
 */
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

/** Where the shell sent a bare hub URL. */
const mockReplace = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginSlug: mockSegments }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => `/acme/hosts/acme-site/${mockSegments.join('/')}`,
  useRouter: () => ({ replace: mockReplace, push: () => undefined }),
  notFound: () => mockNotFound(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useRemoteConfig: () => ({ defaultConfig: {} }),
  useUser: () => ({
    data: {
      uid: 'u1',
      getIdToken: async () => 'tok',
      // Never staff. The bypass would make every row of the matrix render,
      // which is the one thing that would make this file vacuous.
      getIdTokenResult: async () => ({ claims: {} }),
    },
  }),
}))

jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => true,
  getValue: (_config: unknown, key: string) => ({
    asString: () => (mockFlags[key] ? JSON.stringify(mockFlags[key]) : ''),
  }),
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-url-names-org', () => ({ useUrlNamesOrg: () => true }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { $id: ORG_ID, plan: 'pro' },
    orgId: ORG_ID,
    ready: true,
  }),
  useCurrentOrg: () => ({
    org: { $id: ORG_ID, plan: 'pro' },
    orgId: ORG_ID,
    ready: true,
  }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: {}, can: () => true, loaded: true }),
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

/** Chrome only — none of it decides whether a section renders. */
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/console-media-picker-provider.component', () => passthrough)
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => null,
}))

import HostPluginPage from '../app/(app)/[orgSlug]/hosts/[host]/[...pluginSlug]/page'
import { ReleaseFlagsProvider } from '../hooks/use-release-flags'

/**
 * Two REAL flags, so the `navTabId` → flag lookup under test is the shipped
 * one rather than a fixture: `nav-tab-contacts` is `release_contacts` and
 * `nav-tab-bookings` is `release_bookings` in `RELEASE_FLAGS`.
 */
const PARENT_FLAG = 'release_contacts'
const SECTION_FLAG = 'release_bookings'

beforeEach(() => {
  received = []
  mockSegments = ['contacts']
  mockFlags = {}
  mockNotFound.mockClear()
  mockReplace.mockClear()
  registerConsoleExtension({
    pluginId: 'contacts',
    displayName: 'Contacts',
    navItems: [
      {
        label: 'Contacts',
        href: '/contacts',
        navTabId: 'nav-tab-contacts',
        header: { title: 'Contacts' },
        Component: mockRecordingPluginPage,
        sections: [
          // Inherits the surface's gate — the common case.
          { id: 'people', label: 'People' },
          // Ships on its own schedule, behind its own flag.
          { id: 'reports', label: 'Reports', navTabId: 'nav-tab-bookings' },
        ],
      },
    ],
  })
})

afterEach(() => {
  unregisterConsoleExtension('contacts')
})

function mount() {
  render(
    <ReleaseFlagsProvider>
      <HostPluginPage />
    </ReleaseFlagsProvider>,
  )
}

/** Whether the plugin page component ever mounted for this URL. */
const rendered = () => received.length > 0

describe('a plugin section is a route (AGL-693)', () => {
  /**
   * The CONTROL for every refusal below.
   *
   * The rest of this file asserts that a URL renders NOTHING, and a route that
   * rendered nothing ever would satisfy all of it. This is the reading that
   * proves the resolution works: the section URL mounts the plugin's page,
   * and mounts it knowing which section it is on.
   */
  it('CONTROL: a section URL resolves and renders that section', async () => {
    mockFlags = { [PARENT_FLAG]: { enabled: true } }
    mockSegments = ['contacts', 'people']
    mount()

    await waitFor(() => expect(rendered()).toBe(true))
    const props = received[received.length - 1]
    expect(props.section).toBe('people')
    expect(props.segments).toEqual(['people'])
    expect(props.basePath).toBe('/acme/hosts/acme-site/contacts')
    // The rail's hrefs, resolved by the shell rather than guessed by the page.
    expect(props.sections?.map((section) => section.href)).toEqual([
      '/acme/hosts/acme-site/contacts/people',
      '/acme/hosts/acme-site/contacts/reports',
    ])
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  /**
   * A bare hub URL is redirected by the SHELL, not by the plugin page
   * (AGL-693).
   *
   * Where it lives is the whole point. Plugin pages are `lazy()`, so a
   * redirect inside one cannot fire until its chunk has downloaded and
   * mounted — the reader watches an empty main area for a bundle that is
   * about to be thrown away. Asserting the page did NOT mount is what proves
   * the redirect happens above that boundary; asserting only the destination
   * would pass either way.
   */
  it('redirects a sectionless hub URL to the first section, without mounting the page', async () => {
    mockFlags = { [PARENT_FLAG]: { enabled: true } }
    mockSegments = ['contacts']
    mount()

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        '/acme/hosts/acme-site/contacts/people',
      ),
    )
    expect(rendered()).toBe(false)
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  /*
   * Past a gated first section, not into it. `visible` is the same verdict the
   * gate applies, so redirecting to a refused section would answer the nav tab
   * with the shell's own "coming soon" notice.
   */
  it('skips a flagged-off first section when choosing where to land', async () => {
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
          Component: mockRecordingPluginPage,
          sections: [
            // First in the rail, and gated off for this viewer.
            { id: 'reports', label: 'Reports', navTabId: 'nav-tab-bookings' },
            { id: 'people', label: 'People' },
          ],
        },
      ],
    })
    mockFlags = {
      [PARENT_FLAG]: { enabled: true },
      [SECTION_FLAG]: { enabled: false },
    }
    mockSegments = ['contacts']
    mount()

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        '/acme/hosts/acme-site/contacts/people',
      ),
    )
  })

  it('a sectionless plugin is not redirected', async () => {
    unregisterConsoleExtension('contacts')
    registerConsoleExtension({
      pluginId: 'contacts',
      displayName: 'Contacts',
      navItems: [
        {
          label: 'Contacts',
          href: '/contacts',
          header: { title: 'Contacts' },
          Component: mockRecordingPluginPage,
        },
      ],
    })
    mockSegments = ['contacts']
    mount()

    await waitFor(() => expect(rendered()).toBe(true))
    expect(mockReplace).not.toHaveBeenCalled()
  })

  /*
   * A section nobody declared is a 404, not the surface's default section
   * under a URL naming something else.
   */
  it('an unknown section is a 404', async () => {
    mockFlags = { [PARENT_FLAG]: { enabled: true } }
    mockSegments = ['contacts', 'invoices']
    expect(() => mount()).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
    expect(rendered()).toBe(false)
  })

  /*
   * …but a SURFACE no plugin owns is NOT a 404. One segment names a surface,
   * and the notice that the feature may not be installed is the true and
   * useful answer for a bookmark into a plugin the workspace disabled.
   */
  it('an unowned surface keeps the not-installed notice', async () => {
    mockSegments = ['nothing-here']
    mount()

    await waitFor(() =>
      expect(screen.getByText(/It may have moved/)).toBeTruthy(),
    )
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  /*
   * A path under a NAMED route, which the catch-all now swallows.
   *
   * `/setup/bogus` used to be a plain Next 404 — `[pluginSlug]` was one
   * segment and could not match it. Widening the route to `[...pluginSlug]`
   * routes it here instead, and answering it with "the feature that provided
   * it is not installed" would be a lie: Setup is a core console page that no
   * plugin provides or could. Found on the running server, not by reading.
   */
  it('a path under a named route is a 404, not a plugin notice', async () => {
    mockSegments = ['setup', 'bogus']
    expect(() => mount()).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  /**
   * Parent × section, all four ways (AGL-693).
   *
   * The gates nest, so visibility is parent AND section. Only the last row may
   * render; the second row — parent off, section ON — is the one an `||` would
   * let through, and it is the whole reason this is a matrix rather than a
   * single case.
   */
  describe('a deep link to a gated section is refused unless BOTH flags allow it', () => {
    it.each([
      ['parent off, section off', false, false],
      ['parent off, section ON', false, true],
      ['parent on, section off', true, false],
    ])('refuses: %s', async (_label, parent, section) => {
      mockFlags = {
        [PARENT_FLAG]: { enabled: parent },
        [SECTION_FLAG]: { enabled: section },
      }
      mockSegments = ['contacts', 'reports']
      mount()

      // The refusal is `FeatureGate`'s coming-soon notice; waiting for it is
      // what proves the flags actually SETTLED, so this is not just an
      // assertion about a component that had not rendered yet.
      await waitFor(() =>
        expect(screen.getByText(/is coming soon/)).toBeTruthy(),
      )
      expect(rendered()).toBe(false)
    })

    it('renders: parent on, section on', async () => {
      mockFlags = {
        [PARENT_FLAG]: { enabled: true },
        [SECTION_FLAG]: { enabled: true },
      }
      mockSegments = ['contacts', 'reports']
      mount()

      await waitFor(() => expect(rendered()).toBe(true))
      expect(received[received.length - 1].section).toBe('reports')
    })
  })

  /*
   * The rail is filtered from the same verdict the gate applies, so a section
   * this viewer would be refused is not offered as a link. One answer, drawn
   * and enforced — a rail that guessed would link into the coming-soon notice.
   */
  it('hides a flagged-off section from the rail it hands the page', async () => {
    mockFlags = {
      [PARENT_FLAG]: { enabled: true },
      [SECTION_FLAG]: { enabled: false },
    }
    mockSegments = ['contacts', 'people']
    mount()

    await waitFor(() => expect(rendered()).toBe(true))
    const sections = received[received.length - 1].sections ?? []
    expect(
      sections.map((section) => [section.id, section.visible]),
    ).toEqual([
      ['people', true],
      ['reports', false],
    ])
  })
})

/**
 * The other half of the additive promise: a plugin that declares no sections
 * behaves exactly as it did before AGL-693 — its own href renders, and a path
 * beneath it is a 404 rather than the same page a second time.
 */
describe('a sectionless plugin is unchanged', () => {
  beforeEach(() => {
    unregisterConsoleExtension('contacts')
    registerConsoleExtension({
      pluginId: 'contacts',
      displayName: 'Contacts',
      navItems: [
        {
          label: 'Contacts',
          href: '/contacts',
          header: { title: 'Contacts' },
          Component: mockRecordingPluginPage,
        },
      ],
    })
  })

  it('renders on its own href and is handed no sections', async () => {
    mockSegments = ['contacts']
    mount()

    await waitFor(() => expect(rendered()).toBe(true))
    const props = received[received.length - 1]
    expect(props.section).toBeUndefined()
    expect(props.sections).toBeUndefined()
    expect(props.segments).toEqual([])
  })

  it('does not claim a path beneath itself', async () => {
    mockSegments = ['contacts', 'people']
    expect(() => mount()).toThrow('NEXT_NOT_FOUND')
    expect(rendered()).toBe(false)
  })
})
