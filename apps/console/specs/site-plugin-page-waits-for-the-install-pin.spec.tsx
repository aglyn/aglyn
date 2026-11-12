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
 * A marketplace plugin's page on one site says nothing about where it runs
 * until the server has answered whether it is installed (AGL-4192).
 *
 * Seen in production: the page for an installed, running plugin settled on
 * "Off for this site / Off for the workspace", with a button to switch it on
 * for the workspace, until a reload. The install pins had not answered yet,
 * and "no pin" read as "not installed". The cache answers "missing" first for
 * a pin it has never held, and with another console tab open that answer can
 * stand for half a minute, so only a SERVER answer counts.
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'
const HOST_ID = 'host-1'
const LISTING = 'listing1'

type PinRead = {
  data: Record<string, unknown> | null | undefined
  status: 'loading' | 'success' | 'error'
  fromCache: boolean
}
let mockPinRead: PinRead = { data: undefined, status: 'loading', fromCache: true }

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginRef: LISTING }),
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
  useFirestoreDoc: () => mockPinRead,
  firestoreDocPhase: jest.requireActual('@aglyn/tenant-feature-instance')
    .firestoreDocPhase,
  useFirestoreCollection: () => ({ data: [] }),
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
  useHost: () => ({
    doc: { data: { $id: HOST_ID }, status: 'success', fromCache: false },
    setDoc: jest.fn(),
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
jest.mock('../components/plugin-config-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => HOST_ID,
  useHostSubdomain: () => 'acme',
  useCanManageSite: () => true,
  useCanManageSiteKnown: () => true,
}))
// A workspace that never configured `enabledPlugins`: every pinned listing
// runs, which is the case the page misread.
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: ORG_ID }, orgId: ORG_ID, ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => {
  const value = { loaded: true, can: () => true, permissions: {}, granted: {} }
  return { __esModule: true, default: () => value, useOrgPermissions: () => value }
})
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { $id: ORG_ID, role: 'owner' }, loading: false }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))

import SitePluginInstallation from '../app/(app)/[orgSlug]/hosts/[host]/admin/plugins/[pluginRef]/page'

const text = () => document.body.textContent ?? ''
const switchOnLink = () =>
  Array.from(document.querySelectorAll('a')).find((a) =>
    a.textContent?.includes('Switch it on for the workspace'),
  )

function expectNoVerdict() {
  expect(text()).not.toContain('Off for the workspace')
  expect(text()).not.toContain('Off for this site')
  expect(text()).not.toContain('Runs on this site')
  expect(switchOnLink()).toBeUndefined()
  expect(document.querySelector('input[aria-label^="Toggle"]')).toBeNull()
}

describe('a marketplace plugin’s site page before its install pin answers', () => {
  it('says it is checking while the pins load', () => {
    mockPinRead = { data: undefined, status: 'loading', fromCache: true }
    render(<SitePluginInstallation />)
    expect(text()).toContain('Checking where this plugin runs')
    expectNoVerdict()
  })

  it('treats the cache’s "missing" as not yet known', () => {
    mockPinRead = { data: null, status: 'success', fromCache: true }
    render(<SitePluginInstallation />)
    expect(text()).toContain('Checking where this plugin runs')
    expectNoVerdict()
  })

  it('says the read failed rather than calling the plugin off', () => {
    mockPinRead = { data: undefined, status: 'error', fromCache: true }
    render(<SitePluginInstallation />)
    expect(text()).toContain('Could not read where this plugin is installed')
    expectNoVerdict()
  })
})

describe('once the server has answered', () => {
  it('reads an installed plugin as running, by its own name', () => {
    mockPinRead = {
      data: { pluginId: 'acme.reviews', displayName: 'Reviews', manifest: { id: 'acme.reviews' } },
      status: 'success',
      fromCache: false,
    }
    render(<SitePluginInstallation />)
    expect(text()).toContain('Runs on this site')
    expect(text()).toContain('Enabled for the workspace')
    expect(text()).not.toContain('Checking where this plugin runs')
    expect(switchOnLink()).toBeUndefined()
  })

  it('reads a listing with no pin anywhere as off for the workspace', () => {
    mockPinRead = { data: null, status: 'success', fromCache: false }
    render(<SitePluginInstallation />)
    expect(text()).toContain('Off for the workspace')
    expect(switchOnLink()).toBeDefined()
  })
})
