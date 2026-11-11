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
 * THE WORKSPACE'S PLUGIN PAGES TELL THE TRUTH WHILE THEY LOAD (AGL-4047).
 *
 * A marketplace plugin's page said "This plugin is not installed in this
 * organization" for about 9 s about a plugin installed org-wide: the verdict
 * rests on there being no pin anywhere, and it was given before the org pin's
 * listen had heard from the server and before every site's pin was read.
 * While loading it says nothing of the kind; once the reads answer it says
 * what they answered; a failed read is said as a failure.
 *
 * And the Plugins list said a plugin runs on "every site" after one site had
 * switched it off. The page hands its widgets each site's own switch, so the
 * row can say which site turned it off.
 */

import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'

/** How the org pin's listen stands. */
let mockOrgPin: {
  data?: unknown
  status: 'loading' | 'success' | 'error'
  fromCache: boolean
} = { status: 'loading', fromCache: true }
let mockHosts: { hosts: Array<Record<string, unknown>>; ready: boolean } = {
  hosts: [],
  ready: false,
}
/** Site pins by host id; a host absent here has none. */
let mockSitePins: Record<string, unknown> = {}
let mockSitePinsReject = false
/** What each widget slot was handed, by slot. */
const slotProps: Record<string, Record<string, unknown>> = {}

jest.mock('../hooks/use-org-permissions', () => {
  const answer = () => ({ loaded: true, errored: false, can: () => true })
  return { __esModule: true, default: answer, useOrgPermissions: answer }
})
jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginRef: 'lst-1' }),
}))
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  })),
  getDoc: jest.fn(async (ref: { path: string }) => {
    if (mockSitePinsReject) throw new Error('client is offline')
    const hostId = ref.path.split('/')[1]
    const pin = mockSitePins[hostId]
    return { exists: () => Boolean(pin), data: () => pin }
  }),
  setDoc: jest.fn(async () => undefined),
  deleteField: jest.fn(() => ({})),
  collection: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
}))
/** One Firestore, as the app has: a new one per render re-runs every read. */
const mockDb = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockDb,
  useFirestoreDoc: (build: () => { path: string } | null) =>
    build()?.path === 'orgs/org-1/installs/lst-1'
      ? mockOrgPin
      : { data: undefined, status: 'success', fromCache: false },
  useFirestoreCollection: () => ({ data: [] }),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
  useHost: () => ({ doc: { data: null }, setDoc: jest.fn() }),
  writeGuardedBySeed: jest.fn(),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => <span aria-hidden="true" />,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  default: (props: { slot: string }) => {
    slotProps[props.slot] = props as never
    return null
  },
}))
jest.mock('../components/plugin-config-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/plugin-dependencies-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { enabledPlugins: ['mui'] }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  default: () => ({ branding: { productName: 'Aglyn' } }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    currentOrg: { $id: 'org-1', role: 'owner' },
    loading: false,
  }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-org-hosts', () => ({
  __esModule: true,
  useOrgHosts: () => mockHosts,
  default: () => mockHosts,
}))

import OrgPluginInstallation from '../app/(app)/[orgSlug]/plugins/[pluginRef]/page'
import OrgPlugins from '../app/(app)/[orgSlug]/plugins/page'

const NOT_INSTALLED = 'This plugin is not installed in this organization'
const FAILED = 'Could not load where this plugin is installed'
const HOSTS = [
  { $id: 'h1', displayName: 'Bakery' },
  { $id: 'h2', displayName: 'Tax Check', disabledPlugins: ['lst-1'] },
]

const show = async (page: ReactNode) => {
  const view = render(<>{page}</>)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return view.container.textContent ?? ''
}

beforeEach(() => {
  mockOrgPin = { status: 'loading', fromCache: true }
  mockHosts = { hosts: HOSTS, ready: true }
  mockSitePins = {}
  mockSitePinsReject = false
  for (const key of Object.keys(slotProps)) delete slotProps[key]
})

describe("a marketplace plugin's page while it loads", () => {
  it('does not say "not installed" while the org pin is unanswered', async () => {
    expect(await show(<OrgPluginInstallation />)).not.toContain(NOT_INSTALLED)
  })

  it('does not say it on a cached "missing" the server has not confirmed', async () => {
    mockOrgPin = { status: 'success', fromCache: true }
    expect(await show(<OrgPluginInstallation />)).not.toContain(NOT_INSTALLED)
  })

  it('does not say it while the site list itself is loading', async () => {
    mockOrgPin = { status: 'success', fromCache: false }
    mockHosts = { hosts: [], ready: false }
    expect(await show(<OrgPluginInstallation />)).not.toContain(NOT_INSTALLED)
  })

  it('says it once the server confirms no org pin and every site pin is read', async () => {
    mockOrgPin = { status: 'success', fromCache: false }
    expect(await show(<OrgPluginInstallation />)).toContain(NOT_INSTALLED)
  })

  it('never says it when the plugin is installed org-wide', async () => {
    mockOrgPin = { data: { version: '1.1.0', displayName: 'Reviews' }, status: 'success', fromCache: false }
    expect(await show(<OrgPluginInstallation />)).not.toContain(NOT_INSTALLED)
  })

  it('says a failed read failed, not "not installed"', async () => {
    mockOrgPin = { status: 'success', fromCache: false }
    mockSitePinsReject = true
    const text = await show(<OrgPluginInstallation />)
    expect(text).toContain(FAILED)
    expect(text).not.toContain(NOT_INSTALLED)
  })

  it('hands "Where it runs" the org it knows and whether the site list is whole', async () => {
    await show(<OrgPluginInstallation />)
    expect(slotProps['pluginSiteSet']).toEqual(
      expect.objectContaining({ orgId: 'org-1', hostsReady: true }),
    )
  })
})

describe('the Plugins list', () => {
  it("hands its installs widget each site's own switch, and whether the list is whole", async () => {
    await show(<OrgPlugins />)
    expect(slotProps['orgPluginInstalls']).toEqual(
      expect.objectContaining({
        hostsReady: true,
        hosts: [
          { id: 'h1', label: 'Bakery', disabledPlugins: null },
          { id: 'h2', label: 'Tax Check', disabledPlugins: ['lst-1'] },
        ],
      }),
    )
  })
})
