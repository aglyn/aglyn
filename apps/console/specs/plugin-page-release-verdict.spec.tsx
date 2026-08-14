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
 * The shell hands a plugin page the flag verdict WITHOUT the staff bypass
 * (AGL-1662).
 *
 * `libs/plugins/contacts/.../contacts-console-page.tsx` quotes a dollar
 * figure for audience overage, and AGL-1604 stopped the usage cron billing
 * that figure while `release_contacts` is off for the org. The page cannot
 * ask the flag for itself — the release-flag hooks are `scope:app` and a
 * `scope:lib` plugin may not import them — so the answer arrives as a prop
 * from this route, and this file is the hop where it could go wrong.
 *
 * The trap is specific and it is one word. `FeatureGate`, which wraps the
 * page body here, gates on `visible` (`released || isStaff`). Resolving the
 * PROP the same way would be invisible in every manual check — the page
 * renders, the number appears, staff see what they expected — and it would
 * mean a staff member opening a page decides what a customer's invoice says.
 *
 * So this mounts the real route with the REAL `ReleaseFlagsProvider` and the
 * REAL `FeatureGate`, as staff, with the flag off. Only Remote Config and the
 * org listener are faked, so the resolution under test is the shipped one.
 * The staff-preview banner asserted alongside the prop is what proves the
 * case is live: the page IS being viewed under the bypass, and the verdict
 * handed down is `false` anyway.
 *
 * The reverse case is asserted too — an org whose flag resolves ON gets
 * `released: true` — so a stand-in that hardcoded `false` fails here.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReleaseFlagValue } from '@aglyn/aglyn'
import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'

/** The published Remote Config value for `release_contacts`. */
let mockFlagValue: ReleaseFlagValue
/** Whether the signed-in user carries the staff claim. */
let mockIsStaff: boolean
/** When false, Remote Config activation never settles — the loading window. */
let mockActivationSettles: boolean
/** Every `releaseFlag` prop the plugin page was rendered with. */
let received: Array<ConsolePluginPageProps['releaseFlag']>

/**
 * Stands in for the Contacts page. It asserts nothing itself — it records
 * what the shell handed it, which is the whole subject of this file.
 */
function mockRecordingPluginPage(props: ConsolePluginPageProps) {
  received.push(props.releaseFlag)
  return <div>{'plugin-page-body'}</div>
}

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  // The registry lookup is real below it: `navTabId: 'nav-tab-contacts'` is
  // what `RELEASE_FLAGS` maps to `release_contacts`, so the flag this route
  // resolves is chosen the shipped way.
  resolveConsolePluginPage: () => ({
    extension: {},
    navItem: {
      label: 'Contacts',
      href: '/contacts',
      navTabId: 'nav-tab-contacts',
      header: { title: 'Contacts' },
      Component: mockRecordingPluginPage,
    },
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useRemoteConfig: () => ({ defaultConfig: {} }),
  useUser: () => ({
    data: {
      uid: 'u1',
      getIdToken: async () => 'tok',
      getIdTokenResult: async () => ({
        claims: mockIsStaff ? { staff: true } : {},
      }),
    },
  }),
}))

jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => {
    if (!mockActivationSettles) return new Promise(() => undefined)
    return true
  },
  getValue: (_config: unknown, key: string) => ({
    asString: () =>
      key === 'release_contacts' ? JSON.stringify(mockFlagValue) : '',
  }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginSlug: 'contacts' }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: ORG_ID, plan: 'pro' }, orgId: ORG_ID, ready: true }),
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

/** Chrome only — none of it is on the path from the flag to the prop. */
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

import HostPluginPage from '../app/(app)/[orgSlug]/hosts/[host]/[pluginSlug]/page'
import { ReleaseFlagsProvider } from '../hooks/use-release-flags'

beforeEach(() => {
  mockFlagValue = { enabled: false }
  mockIsStaff = false
  mockActivationSettles = true
  received = []
})

function mount() {
  render(
    <ReleaseFlagsProvider>
      <HostPluginPage />
    </ReleaseFlagsProvider>,
  )
}

/** The last verdict the plugin page saw. */
const verdict = () => received[received.length - 1]

describe('the plugin route hands down `released`, not `visible` (AGL-1662)', () => {
  it('says NOT released to a staff previewer of a flagged-off org', async () => {
    mockIsStaff = true
    mount()

    // The bypass is genuinely in play: the page body renders behind the
    // staff-preview banner, which only appears when `visible` is true and
    // `released` is false. Without this, the case would be vacuous.
    await waitFor(() =>
      expect(screen.getByText('plugin-page-body')).toBeTruthy(),
    )
    expect(screen.getByText(/hidden from customers by release flag/)).toBeTruthy()

    await waitFor(() => expect(verdict()?.ready).toBe(true))
    // …and the verdict the page will price from is still the org's.
    expect(verdict()?.released).toBe(false)
  })

  it('says released once the flag is on for the org', async () => {
    mockFlagValue = { enabled: true }
    mount()

    await waitFor(() =>
      expect(screen.getByText('plugin-page-body')).toBeTruthy(),
    )
    await waitFor(() => expect(verdict()?.released).toBe(true))
    expect(verdict()?.ready).toBe(true)
    // No bypass involved — this org can see the page on its own.
    expect(screen.queryByText(/hidden from customers by release flag/)).toBeNull()
  })

  it('reports the verdict as unsettled until activation lands', async () => {
    mockActivationSettles = true
    mockFlagValue = { enabled: true }
    mockIsStaff = true
    mount()
    await waitFor(() => expect(verdict()?.ready).toBe(true))

    // Now the window itself: activation never resolves, so every flag reads
    // its registry default and no page may make a claim from it.
    received = []
    mockActivationSettles = false
    mount()
    await waitFor(() =>
      expect(screen.getAllByText('plugin-page-body').length).toBeGreaterThan(0),
    )
    expect(verdict()?.ready).toBe(false)
  })
})
