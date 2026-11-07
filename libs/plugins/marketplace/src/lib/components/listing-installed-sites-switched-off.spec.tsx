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
 *
 * @jest-environment jsdom
 */

/**
 * A listing's installed-sites panel tells the truth about a site that switched
 * the plugin off (AGL-4047).
 *
 * A pin says a plugin is installed; a site's own `disabledPlugins` says
 * whether it runs there, and the realm join honors the switch over any pin.
 * The panel used to read pins only, so a site that turned the plugin off on
 * its Admin › Plugins page, or was left out at install, was listed as running
 * it. The site's list rides on the org mount's hosts, so this costs no read.
 */

import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.setTimeout(30_000)

const mockState = {
  listing: {} as Record<string, unknown>,
  profile: { handle: 'pub' },
  db: {},
  orgPin: null as Record<string, unknown> | null,
  sitePins: {} as Record<string, Record<string, unknown>>,
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/'), constraints: [] }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown, direction?: string) => ({ orderBy: field, direction }),
  where: (field: string) => ({ where: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/'), __doc: true }),
  getDoc: async (ref: { path: string }) => {
    if (ref.path.startsWith('hostIndex/')) {
      return { exists: () => true, get: () => 'client-org', data: () => ({ orgId: 'client-org' }) }
    }
    const match = /^hosts\/([^/]+)\/installs\//.exec(ref.path)
    const pin = match ? mockState.sitePins[match[1]] : undefined
    return { exists: () => Boolean(pin), get: () => undefined, data: () => pin }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockState.db,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostOrgId: () => 'client-org',
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestoreDoc: (build: () => any) => {
    const path = String(build()?.path ?? '')
    if (path.startsWith('marketplaceListings/')) return { data: mockState.listing, status: 'success' }
    if (path.startsWith('publisherProfiles/')) return { data: mockState.profile, status: 'success' }
    if (path === 'orgs/client-org/installs/lst-1') return { data: mockState.orgPin ?? undefined, status: 'success' }
    return { data: undefined, status: 'success' }
  },
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  GridItems: ({ items }: { items?: Array<{ children?: ReactNode }> }) => (
    <div>
      {(items ?? []).map((item, index) => (
        <div key={index}>{item?.children}</div>
      ))}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('@aglyn/shared-ui-next/contexts/next-page-title-provider', () => ({ NextPageTitle: () => null }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('./listing-image.component', () => ({ ListingImage: () => null }))
jest.mock('./listing-reviews.component', () => ({ __esModule: true, default: () => null }))
jest.mock('./report-target.component', () => ({ __esModule: true, default: () => null }))
jest.mock('./uninstall-impact-dialog.component', () => ({ __esModule: true, default: () => null }))
jest.mock('./artifact-update-dialog.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../hooks/use-marketplace-actions', () => ({
  useMarketplaceActions: () => ({
    install: jest.fn(),
    installPlan: jest.fn(),
    uninstall: jest.fn(),
    buy: jest.fn(),
    payPanel: null,
    buying: false,
  }),
}))
jest.mock('../hooks/use-artifact-update', () => ({
  useArtifactUpdate: () => ({
    preview: null,
    loading: false,
    loadPreview: jest.fn(),
    applyUpdate: jest.fn(),
    setPreview: jest.fn(),
  }),
}))

import { MarketplaceListingContent } from './listing-content.component'
import type { OrgInstallHost } from '../model/marketplace'
import { standInDatasetList } from '../testing/stand-in-dataset-list'

standInDatasetList()

const LISTING = {
  $id: 'lst-1',
  displayName: 'Promo Countdown',
  profileId: 'pub-org',
  artifactType: 'plugin',
  latestVersion: '1.0.0',
  latestApprovedVersion: '1.0.0',
  latestVersionReviewState: 'approved',
  priceUsd: 0,
  reviewStatus: 'listed',
  deletedAt: null,
  versions: [{ version: '1.0.0', publishedAtMs: 1 }],
}

beforeEach(() => {
  mockState.listing = LISTING
  mockState.orgPin = null
  mockState.sitePins = {}
  ;(globalThis as any).fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ versions: [] }) })
})

const mount = async (hosts: ReadonlyArray<OrgInstallHost>) => {
  render(
    <MarketplaceListingContent
      hostId="h1"
      listingId="lst-1"
      orgScoped
      orgSlug="acme"
      hosts={hosts}
      permissions={{ installPlugins: true }}
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const SWITCHED_OFF = 'Switched off on this site'

describe("a listing's installed-sites panel", () => {
  it('does not call a site that switched the plugin off a site running it', async () => {
    mockState.orgPin = { version: '1.0.0' }
    await mount([
      { id: 'h1', label: 'Bakery', disabledPlugins: [] },
      { id: 'h2', label: 'Cafe', disabledPlugins: ['commerce', 'lst-1'] },
      { id: 'h3', label: 'Catering' },
    ])
    expect(
      screen.getByText(
        'Installed for the whole organization (v1.0.0). It runs on every site ' +
          'except Cafe, which switched it off, and on sites you add later.',
      ),
    ).toBeTruthy()
    expect(screen.getAllByText(SWITCHED_OFF)).toHaveLength(1)
    expect(screen.getByText(/turns it back on from its own Admin › Plugins page/).textContent).toBe(
      'A site that switched it off turns it back on from its own Admin › Plugins ' +
        'page, which takes “Manage site settings” on that site.',
    )
  })

  it('counts what runs among per-site installs', async () => {
    mockState.sitePins = { h1: { version: '1.0.0' }, h2: { version: '1.0.0' } }
    await mount([
      { id: 'h1', label: 'Bakery' },
      { id: 'h2', label: 'Cafe', disabledPlugins: ['lst-1'] },
      { id: 'h3', label: 'Catering' },
    ])
    expect(
      screen.getByText('Installed on 2 of 3 sites. Cafe switched it off, so it runs on 1.'),
    ).toBeTruthy()
    expect(screen.getAllByText(SWITCHED_OFF)).toHaveLength(1)
  })

  it('reads as before when no site switched this listing off (control)', async () => {
    mockState.orgPin = { version: '1.0.0' }
    await mount([
      // Another listing and a built-in plugin in the same list: not this one.
      { id: 'h1', label: 'Bakery', disabledPlugins: ['lst-2', 'commerce'] },
      { id: 'h2', label: 'Cafe' },
    ])
    expect(
      screen.getByText(
        'Installed for the whole organization (v1.0.0) — every site, including ones you add later.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(SWITCHED_OFF)).toBeNull()
    expect(screen.queryByText(/turns it back on/)).toBeNull()
  })
})
