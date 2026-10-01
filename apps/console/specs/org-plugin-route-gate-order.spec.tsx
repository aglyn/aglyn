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
 * THE ORGANIZATION ROUTE ASKS REACH FIRST, AND SAYS WHEN IT COULD NOT ASK
 * (AGL-3080).
 *
 * The generic org plugin route serves every surface mounted with no site,
 * the CRM's organization hub among them, whose listeners carry no scope
 * clause. So the order of its gates is the security property:
 *
 *  - a site collaborator is refused on reach, before the member read is
 *    consulted, because no permission grants reach;
 *  - a member read that FAILED is said to have failed, rather than held as
 *    pending forever or reported as a refusal to a legitimate admin;
 *  - a member without the permission the surface declares is refused, and
 *    the page never mounts to open its listeners.
 *
 * And the help a surface names is deep-linked to the heading it names, when
 * the docs page carries it.
 */

import { render, screen, waitFor } from '@testing-library/react'
import {
  registerConsoleExtension,
  unregisterConsoleExtension,
  type ConsolePluginPageProps,
} from '@aglyn/aglyn'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'

let mounts: ConsolePluginPageProps[]
let mockReach: { orgWide: boolean; ready: boolean }
let mockPermissions: {
  can: () => boolean
  loaded: boolean
  errored: boolean
}
/** The `help` the page handed its layout, last render. */
let mockHelp: unknown
let mockDocsAnchor: string | undefined

function mockRecordingPluginPage(props: ConsolePluginPageProps) {
  mounts.push(props)
  return <div>surface mounted</div>
}

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginSlug: ['ledger', 'people'] }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/acme/ledger/people',
  useRouter: () => ({ replace: jest.fn(), push: () => undefined }),
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
  default: () => ({ permissions: {}, ...mockPermissions }),
}))
jest.mock('../hooks/use-org-reach', () => ({
  useOrgReach: () => mockReach,
}))
jest.mock('../hooks/use-org-hosts', () => ({
  __esModule: true,
  default: () => ({ hosts: [], ready: true, error: undefined }),
  useOrgHosts: () => ({ hosts: [], ready: true, error: undefined }),
}))
jest.mock('../hooks/use-console-plugins', () => ({
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
  useEnabledPluginIds: () => ['ledger'],
  usePluginLoadScope: () => ({ orgId: null, user: undefined }),
}))
jest.mock('../components/feature-gate.component', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children, help }: { children?: ReactNode; help?: unknown }) => {
    mockHelp = help
    return <div>{children}</div>
  },
}))
jest.mock(
  '../components/console-media-picker-provider.component',
  () => passthrough,
)
jest.mock('../components/plugin-hub-rail.component', () => passthrough)

import OrgPluginPage from '../app/(app)/[orgSlug]/[...pluginSlug]/page'

const FAILED_READ = /couldn't confirm your access/i
const SCOPED = /covers the whole organization/i

beforeEach(() => {
  mounts = []
  mockHelp = undefined
  mockDocsAnchor = '#at-the-organization-level'
  mockReach = { orgWide: true, ready: true }
  mockPermissions = { can: () => true, loaded: true, errored: false }
})

function registerLedger() {
  registerConsoleExtension({
    pluginId: 'ledger',
    displayName: 'Ledger',
    permission: 'data.manage',
    orgNavItems: [
      {
        label: 'Ledger',
        href: '/ledger',
        header: { title: 'Ledger', docsTopic: 'crm', docsAnchor: mockDocsAnchor },
        Component: mockRecordingPluginPage,
        sections: [{ id: 'people', label: 'People' }],
      },
    ],
  })
}

afterEach(() => {
  unregisterConsoleExtension('ledger')
})

describe('the org route gates a surface reach first (AGL-3080)', () => {
  it('CONTROL: an org-wide member holding the permission gets the surface', async () => {
    registerLedger()
    render(<OrgPluginPage />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    expect(screen.queryByText(FAILED_READ)).toBeNull()
  })

  it('refuses a site collaborator before the member read has answered', async () => {
    mockReach = { orgWide: false, ready: true }
    mockPermissions = { can: () => true, loaded: false, errored: false }
    registerLedger()
    render(<OrgPluginPage />)
    expect(await screen.findByText(SCOPED)).toBeTruthy()
    expect(mounts).toHaveLength(0)
  })

  it('says a failed member read failed, and mounts nothing', async () => {
    mockPermissions = { can: () => false, loaded: false, errored: true }
    registerLedger()
    render(<OrgPluginPage />)
    expect(await screen.findByText(FAILED_READ)).toBeTruthy()
    expect(mounts).toHaveLength(0)
  })

  it('still refuses a collaborator whose member read failed, on reach', async () => {
    mockReach = { orgWide: false, ready: true }
    mockPermissions = { can: () => false, loaded: false, errored: true }
    registerLedger()
    render(<OrgPluginPage />)
    expect(await screen.findByText(SCOPED)).toBeTruthy()
    expect(screen.queryByText(FAILED_READ)).toBeNull()
    expect(mounts).toHaveLength(0)
  })

  it('refuses an org-wide member without the declared permission', async () => {
    mockPermissions = { can: () => false, loaded: true, errored: false }
    registerLedger()
    render(<OrgPluginPage />)
    await waitFor(() => expect(screen.queryByText(/permission/i)).toBeTruthy())
    expect(mounts).toHaveLength(0)
  })
})

describe('the help a surface names, deep-linked', () => {
  it('opens the heading the surface names, when its page carries it', async () => {
    registerLedger()
    render(<OrgPluginPage />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    expect(mockHelp).toEqual({
      topic: 'crm',
      anchor: '#at-the-organization-level',
    })
  })

  it('opens the top of the page for a heading it does not carry', async () => {
    mockDocsAnchor = '#no-such-heading'
    registerLedger()
    render(<OrgPluginPage />)
    await waitFor(() => expect(mounts.length).toBeGreaterThan(0))
    expect(mockHelp).toBe('crm')
  })
})
