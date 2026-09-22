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
 * AN ENTITY UNDER A HUB IS NOT THE HUB'S OWN ADDRESS (AGL-3264).
 *
 * The generic org plugin route replaces a BARE hub URL with its landing
 * section, because a hub that names no section has nothing to draw. It asked
 * for that by one question — does the resolved page name a section? — and a
 * surface with `ownsSubtree: true` answers it exactly as the bare URL does:
 * an entity id beneath the surface resolves as `segments` with NO section.
 *
 * So every listing in the Marketplace bounced. Clicking "View details" put
 * `/{org}/marketplace/{listingId}` in the bar and the shell replaced it with
 * `/{org}/marketplace/browse` before the hub could read the id — as did
 * `/marketplace/publisher/{handle}` and `/marketplace/publish/plugin`.
 * Marketplace is the only surface that declares `ownsSubtree` AND `sections`
 * together, which is why it alone showed it: Forms owns its subtree with no
 * sections, so the redirect never fired there at all.
 *
 * The distinguishing fact is the segment COUNT, which the legacy redirect
 * directly above already reads. Both halves are asserted here, because
 * either alone is satisfied by a route that does the wrong thing: a page that
 * never redirects passes the listing cases, and one that always redirects
 * passes the bare one.
 */

import { render, waitFor } from '@testing-library/react'
import {
  registerConsoleExtension,
  unregisterConsoleExtension,
  type ConsolePluginPageProps,
} from '@aglyn/aglyn'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'

/** Every props object the plugin page was rendered with. */
let received: ConsolePluginPageProps[]
/** The URL's segments beneath the org. */
let mockSegments: string[]
/** Where the shell sent the reader, if anywhere. */
const mockReplace = jest.fn()
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

/**
 * Stands in for the hub. It records that it mounted and what it was handed —
 * "the listing opened" means the page got the id, not that a string rendered.
 */
function mockRecordingPluginPage(props: ConsolePluginPageProps) {
  received.push(props)
  return <div>{`section:${props.section ?? 'none'}`}</div>
}

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginSlug: mockSegments }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => `/acme/${mockSegments.join('/')}`,
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
      getIdTokenResult: async () => ({ claims: {} }),
    },
  }),
}))

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
  useOrgScope: () => ({
    currentOrg: { $id: ORG_ID, slug: 'acme', orgName: 'Acme' },
    orgs: [{ $id: ORG_ID, slug: 'acme', orgName: 'Acme' }],
  }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: ORG_ID, plan: 'pro' }, ready: true }),
  useCurrentOrg: () => ({ org: { $id: ORG_ID, plan: 'pro' }, ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: {}, can: () => true, loaded: true }),
}))
jest.mock('../hooks/use-org-reach', () => ({
  useOrgReach: () => ({ orgWide: true, ready: true }),
}))
jest.mock('../hooks/use-org-hosts', () => ({
  __esModule: true,
  default: () => ({ hosts: [], ready: true, error: undefined }),
  useOrgHosts: () => ({ hosts: [], ready: true, error: undefined }),
}))
jest.mock('../hooks/use-console-plugins', () => ({
  // The route's own plugins are already here: this file's registry is a
  // double, so there is no chunk to fetch (AGL-3142).
  useConsoleRoutePlugins: () => true,
}))
jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  useReleaseFlags: () => ({
    flags: new Proxy({}, { get: () => ({ released: true, visible: true }) }),
    ready: true,
    isStaff: false,
  }),
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['bazaar'],
  usePluginLoadScope: () => ({ orgId: null, user: undefined }),
}))
jest.mock('../components/feature-gate.component', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

/** Chrome only — none of it decides which URL renders what. */
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock(
  '../components/console-media-picker-provider.component',
  () => passthrough,
)
jest.mock('../components/plugin-hub-rail.component', () => passthrough)

import OrgPluginPage from '../app/(app)/[orgSlug]/[...pluginSlug]/page'

beforeEach(() => {
  received = []
  mockSegments = ['bazaar']
  mockReplace.mockClear()
  mockNotFound.mockClear()
  registerConsoleExtension({
    pluginId: 'bazaar',
    displayName: 'Bazaar',
    orgNavItems: [
      {
        label: 'Bazaar',
        href: '/bazaar',
        header: { title: 'Bazaar' },
        Component: mockRecordingPluginPage,
        // The Marketplace's shape, and the one nothing covered: a hub of
        // sections whose subtree also holds entities of its own.
        ownsSubtree: true,
        sections: [
          { id: 'browse', label: 'Browse All' },
          { id: 'installed', label: 'Installed' },
        ],
      },
    ],
  })
})

afterEach(() => {
  unregisterConsoleExtension('bazaar')
})

/** The props the page last mounted with, or undefined if it never did. */
const mounted = () => received[received.length - 1]

describe('a hub that owns its subtree (AGL-3264)', () => {
  /**
   * The CONTROL, and half the behavior: the bare hub URL still lands on a
   * section. Without this, a route that simply stopped redirecting would pass
   * every case below.
   */
  it('CONTROL: still redirects the bare hub URL to the landing section', async () => {
    mockSegments = ['bazaar']
    render(<OrgPluginPage />)

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/acme/bazaar/browse'),
    )
    // Above the `lazy()` boundary, as it has always been: the page must not
    // mount to open listens for a URL that is already being replaced.
    expect(received).toHaveLength(0)
  })

  it('opens an entity beneath the surface instead of the landing section', async () => {
    mockSegments = ['bazaar', 'listing-abc']
    render(<OrgPluginPage />)

    await waitFor(() => expect(mounted()).toBeTruthy())
    // The id reaches the hub, which is what "View details" opened.
    expect(mounted()?.segments).toEqual(['listing-abc'])
    expect(mounted()?.section).toBeUndefined()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('opens a deeper path beneath the surface too', async () => {
    // `/marketplace/publisher/{handle}` and `/marketplace/publish/plugin`:
    // the surface answers for its whole subtree, not only its first level.
    mockSegments = ['bazaar', 'publisher', 'acme-co']
    render(<OrgPluginPage />)

    await waitFor(() => expect(mounted()).toBeTruthy())
    expect(mounted()?.segments).toEqual(['publisher', 'acme-co'])
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('still renders a declared section on its own URL', async () => {
    mockSegments = ['bazaar', 'installed']
    render(<OrgPluginPage />)

    await waitFor(() => expect(mounted()).toBeTruthy())
    expect(mounted()?.section).toBe('installed')
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
