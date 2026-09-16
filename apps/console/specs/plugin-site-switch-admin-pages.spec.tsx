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
 * A plugin on for every workspace and switchable per site, on the two Plugins
 * pages (AGL-3028).
 *
 * The site's Admin › Plugins page offers the switch — the plugin is no longer
 * "Always on" there — and says, beside it, what switching it off stops on
 * this site and what it leaves running. The workspace page keeps the switch
 * on and inert, and says where the real one is: a workspace switch would stop
 * the half of the plugin that carries no site.
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FIRST_PARTY_PLUGINS } from '@aglyn/aglyn'

const ORG_ID = 'org-1'
const HOST_ID = 'host-1'

let mockPluginRef = 'ai'
// A switchboard saved before AI was a plugin: it never named the id.
let mockOrg: Record<string, unknown> = { enabledPlugins: ['mui', 'commerce'] }
let mockHostDoc: Record<string, unknown> = {}

const mockSetDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginRef: mockPluginRef }),
}))
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(async () => ({ exists: () => false, data: () => null })),
  setDoc: jest.fn(async () => undefined),
  deleteField: jest.fn(() => ({})),
  collection: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: null, status: 'success', fromCache: false }),
  useFirestoreCollection: () => ({ data: [] }),
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
  useHost: () => ({
    doc: { data: mockHostDoc, status: 'success', fromCache: false },
    setDoc: mockSetDoc,
  }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
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
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => <span>{'Acme site'}</span>,
}))
jest.mock('../components/auth-screens-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => HOST_ID,
  useHostSubdomain: () => 'acme',
  useIsHostAdmin: () => true,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: ORG_ID, ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    currentOrg: { $id: ORG_ID, role: 'owner' },
    loading: false,
  }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))

import OrgPluginInstallation from '../app/(app)/[orgSlug]/plugins/[pluginRef]/page'
import SitePluginInstallation from '../app/(app)/[orgSlug]/hosts/[host]/admin/plugins/[pluginRef]/page'

const switchLabelled = (label: string): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)

const AI = FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === 'ai')

beforeEach(() => {
  jest.clearAllMocks()
  mockPluginRef = 'ai'
  mockOrg = { enabledPlugins: ['mui', 'commerce'] }
  mockHostDoc = { $id: HOST_ID }
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ placements: 0, affectedScreens: 0, truncated: false }),
  }) as unknown as typeof fetch
})

describe('AI on the SITE’s Admin › Plugins page', () => {
  it('offers the switch, on by default, and never reads "Always on"', () => {
    render(<SitePluginInstallation />)
    const toggle = switchLabelled('Toggle AI on this site')
    expect(toggle).toBeTruthy()
    expect(toggle?.checked).toBe(true)
    expect(toggle?.disabled).toBe(false)
    expect(document.body.textContent).toContain('Runs on this site')
    expect(document.body.textContent).not.toContain('Always on')
  })

  it('says what switching it off stops, and what it keeps running', () => {
    render(<SitePluginInstallation />)
    expect(AI?.siteOff?.stops).toBeTruthy()
    expect(document.body.textContent).toContain(AI?.siteOff?.stops)
    expect(document.body.textContent).toContain(AI?.siteOff?.keeps)
    // The two halves the copy exists to separate.
    expect(AI?.siteOff?.stops).toMatch(/queued AI jobs/)
    expect(AI?.siteOff?.keeps).toMatch(/add-on, credits, allotments or overage billing/)
  })

  it('writes the site’s deny-list, and nothing about the workspace', async () => {
    render(<SitePluginInstallation />)
    fireEvent.click(switchLabelled('Toggle AI on this site') as HTMLInputElement)
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    expect(mockSetDoc.mock.calls[0][0].disabledPlugins).toEqual(['ai'])
    const orgWrites = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]) => url === '/api/orgs/settings',
    )
    expect(orgWrites).toEqual([])
  })

  it('reads off on a site that switched it off', () => {
    mockHostDoc = { $id: HOST_ID, disabledPlugins: ['ai'] }
    render(<SitePluginInstallation />)
    expect(switchLabelled('Toggle AI on this site')?.checked).toBe(false)
    expect(document.body.textContent).toContain('Off for this site')
    // Still on for the workspace: the chip says so, and no site can change it.
    expect(document.body.textContent).toContain('Enabled for the workspace')
  })

  it('keeps the base component library always on, with no switch', () => {
    mockPluginRef = 'mui'
    render(<SitePluginInstallation />)
    expect(switchLabelled('Toggle Components on this site')).toBeNull()
    expect(document.body.textContent).toContain('Always on')
  })
})

describe('AI on the WORKSPACE’s Plugins page', () => {
  it('holds the workspace switch on and inert, and points at the site switch', () => {
    render(<OrgPluginInstallation />)
    const toggle = switchLabelled('Toggle AI for this workspace')
    expect(toggle?.checked).toBe(true)
    expect(toggle?.disabled).toBe(true)
    expect(document.body.textContent).toContain(
      'a site switches it off for itself, on that site’s Admin › Plugins page',
    )
  })
})
