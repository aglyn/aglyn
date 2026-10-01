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
 * The installed half of the workspace's plugin inventory, and an
 * installation's version line (AGL-3080).
 *
 * Both were drawn by console pages that read this plugin's listings and kill
 * switches around it. They are this plugin's widgets now, on zones those
 * pages host, so what the pages used to hold is held here:
 *
 *  - one row per INSTALLATION, org pin and site pins merged, with the scope in
 *    the caption (AGL-1011/1012);
 *  - the update chip offers the newest INSTALLABLE version, which a thrown
 *    kill switch takes off the table (AGL-1016/2368);
 *  - a listing that could not be read reads as "Unknown", never as current.
 *
 * The comparison is the real one (`model/update-state`), so a chip here is
 * the answer the install route would give.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  buildRoute: (
    _route: string,
    params: { orgSlug: string; pluginRef?: string; listingId?: string },
  ) =>
    `/${params.orgSlug}/${params.pluginRef ? `plugins/${params.pluginRef}` : `marketplace/${params.listingId}`}`,
  pluginDocsHelp: () => undefined,
  Route: {
    ORG_PLUGIN_INSTALLATION: 'ORG_PLUGIN_INSTALLATION',
    ORG_MARKETPLACE_LISTING: 'ORG_MARKETPLACE_LISTING',
  },
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({
    children,
    header,
  }: {
    children: ReactNode
    header: string
  }) => <section aria-label={header}>{children}</section>,
  MdiIcon: () => null,
}))

/** Documents by collection path; a path absent here reads as empty. */
let mockDocs: Record<string, Array<Record<string, unknown>>> = {}
/** Collections whose read fails, to prove a failure is not a false "current". */
let mockFailing = new Set<string>()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_firestore: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (_firestore: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  documentId: () => '__name__',
  limit: () => ({}),
  where: () => ({}),
  query: (ref: { path: string }) => ref,
  getDocs: async (ref: { path: string }) => {
    if (mockFailing.has(ref.path)) throw new Error('permission-denied')
    return {
      docs: (mockDocs[ref.path] ?? []).map(({ $id, ...data }) => ({
        id: String($id),
        data: () => data,
      })),
    }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useFirestoreCollection: (factory: () => { path: string } | null) => {
    const ref = factory()
    return { data: ref ? (mockDocs[ref.path] ?? []) : undefined }
  },
  useFirestoreDoc: (factory: () => { path: string } | null) => {
    const ref = factory()
    if (!ref) return { data: undefined }
    const [collectionPath, id] = [
      ref.path.split('/').slice(0, -1).join('/'),
      ref.path.split('/').at(-1),
    ]
    const found = (mockDocs[collectionPath] ?? []).find(
      (entry) => entry.$id === id,
    )
    return { data: found }
  },
}))

import { OrgPluginInstallsCard } from './org-plugin-installs-card.component'
import { PluginInstallStatus } from './plugin-install-status.component'

const HOSTS = [
  { id: 'host-a', label: 'Main site' },
  { id: 'host-b', label: 'Shop' },
]

/** The row for one installation, by its name. */
const rowOf = (name: string) =>
  screen.getByText(name).closest('a') as HTMLElement

beforeEach(() => {
  mockFailing = new Set()
  mockDocs = {
    'orgs/org-1/installs': [
      {
        $id: 'atlas',
        listingId: 'atlas',
        pluginId: 'atlas',
        sha256: 'a1',
        displayName: 'Atlas Maps',
        version: '1.0.0',
      },
    ],
    'hosts/host-a/installs': [
      {
        $id: 'ledger',
        listingId: 'ledger',
        pluginId: 'ledger',
        sha256: 'b2',
        displayName: 'Ledger Sync',
        version: '2.0.0',
      },
      // The org pin covers every site; a site pin of the same listing adds a
      // site to it rather than a second row.
      {
        $id: 'atlas',
        listingId: 'atlas',
        pluginId: 'atlas',
        sha256: 'a1',
        displayName: 'Atlas Maps',
        version: '1.0.0',
      },
    ],
    'hosts/host-b/installs': [
      {
        $id: 'ledger',
        listingId: 'ledger',
        pluginId: 'ledger',
        sha256: 'b2',
        displayName: 'Ledger Sync',
        version: '2.0.0',
      },
    ],
    marketplaceListings: [
      { $id: 'atlas', artifactType: 'plugin', latestApprovedVersion: '1.2.0' },
      { $id: 'ledger', artifactType: 'plugin', latestApprovedVersion: '2.0.0' },
    ],
    revocations: [],
  }
})

describe('the installed half of the Plugins page', () => {
  it('draws one row per installation, linked to its page, with its scope', async () => {
    render(<OrgPluginInstallsCard orgId="org-1" orgSlug="acme" hosts={HOSTS} />)
    await waitFor(() => expect(screen.getByText('Ledger Sync')).toBeTruthy())
    expect(screen.getAllByText('Atlas Maps')).toHaveLength(1)
    expect(rowOf('Atlas Maps').getAttribute('href')).toBe('/acme/plugins/atlas')
    expect(
      within(rowOf('Atlas Maps')).getByText(/every site in this organization/),
    ).toBeTruthy()
    expect(
      within(rowOf('Ledger Sync')).getByText('v2.0.0 · 2 sites'),
    ).toBeTruthy()
  })

  it('offers the newest installable version, and nothing for one that is current', async () => {
    render(<OrgPluginInstallsCard orgId="org-1" orgSlug="acme" hosts={HOSTS} />)
    await waitFor(() =>
      expect(
        within(rowOf('Atlas Maps')).getByText('v1.2.0 available'),
      ).toBeTruthy(),
    )
    expect(
      within(rowOf('Ledger Sync')).queryByText(/available|Unknown/),
    ).toBeNull()
  })

  it('offers nothing a thrown kill switch stops the install route giving', async () => {
    mockDocs.revocations = [{ $id: 'atlas', versions: ['1.2.0'] }]
    render(<OrgPluginInstallsCard orgId="org-1" orgSlug="acme" hosts={HOSTS} />)
    await waitFor(() =>
      expect(within(rowOf('Atlas Maps')).getByText('Unknown')).toBeTruthy(),
    )
    expect(within(rowOf('Atlas Maps')).queryByText(/available/)).toBeNull()
  })

  it('reads a listing it could not fetch as unknown, never as up to date', async () => {
    mockFailing.add('marketplaceListings')
    render(<OrgPluginInstallsCard orgId="org-1" orgSlug="acme" hosts={HOSTS} />)
    await waitFor(() =>
      expect(within(rowOf('Ledger Sync')).getByText('Unknown')).toBeTruthy(),
    )
  })

  it('says so when nothing is installed', () => {
    mockDocs = {}
    render(<OrgPluginInstallsCard orgId="org-1" orgSlug="acme" hosts={[]} />)
    expect(
      screen.getByText(/Nothing installed from the marketplace yet/),
    ).toBeTruthy()
  })
})

describe('an installation’s version line', () => {
  it('says an update is available and links to the listing that offers it', () => {
    render(
      <PluginInstallStatus
        orgSlug="acme"
        pluginRef="atlas"
        pin={{
          listingId: 'atlas',
          pluginId: 'atlas',
          sha256: 'a1',
          version: '1.0.0',
        }}
      />,
    )
    expect(screen.getByText('You have v1.0.0 · v1.2.0 available')).toBeTruthy()
    expect(
      screen.getByText('View listing').closest('a')?.getAttribute('href'),
    ).toBe('/acme/marketplace/atlas')
  })

  it('says it is up to date, with nothing to click', () => {
    render(
      <PluginInstallStatus
        orgSlug="acme"
        pluginRef="ledger"
        pin={{
          listingId: 'ledger',
          pluginId: 'ledger',
          sha256: 'b2',
          version: '2.0.0',
        }}
      />,
    )
    expect(screen.getByText('Up to date · v2.0.0')).toBeTruthy()
    expect(screen.queryByText('View listing')).toBeNull()
  })
})
