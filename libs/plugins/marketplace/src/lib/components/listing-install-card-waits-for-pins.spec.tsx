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
 * A listing's Install card waits for the pins (AGL-4047).
 *
 * At workspace scope the card offers Install, with "Install to" All sites,
 * Selected sites or All sites except…, only when the plugin is installed
 * nowhere. That is a verdict resting on ABSENT pins, and the page gave it
 * while the pins were still loading. Worse, the org pin was read under an org
 * looked up through the acting site: a one-shot read that settles to "no org"
 * when it fails, after which the org pin was never read and an org-wide
 * install offered Install for good. The hub knows the workspace, so it hands
 * it over.
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
  /** How the org pin's listen stands: answered, still loading, or a cached guess. */
  orgPinRead: 'success' as 'success' | 'loading' | 'fromCache',
  /** The org looked up through the acting site (`hostIndex`). */
  hostOrg: { orgId: 'client-org' as string | null, loaded: true },
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
  useHostOrgIdState: (hostId: string | undefined) =>
    hostId ? mockState.hostOrg : { orgId: null, loaded: true },
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestoreDoc: (build: () => any) => {
    const path = String(build()?.path ?? '')
    if (path.startsWith('marketplaceListings/')) return { data: mockState.listing, status: 'success' }
    if (path.startsWith('publisherProfiles/')) return { data: mockState.profile, status: 'success' }
    if (path === 'orgs/client-org/installs/lst-1') {
      if (mockState.orgPinRead === 'loading') return { data: undefined, status: 'loading', fromCache: true }
      if (mockState.orgPinRead === 'fromCache') return { data: undefined, status: 'success', fromCache: true }
      return { data: mockState.orgPin ?? undefined, status: 'success', fromCache: false }
    }
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

const HOSTS = [
  { id: 'h1', label: 'Bakery' },
  { id: 'h2', label: 'Cafe' },
]

beforeEach(() => {
  mockState.listing = LISTING
  mockState.orgPin = null
  mockState.sitePins = {}
  mockState.orgPinRead = 'success'
  mockState.hostOrg = { orgId: 'client-org', loaded: true }
  ;(globalThis as any).fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ versions: [] }) })
})

const mount = async (props: { orgId?: string } = {}) => {
  render(
    <MarketplaceListingContent
      hostId="h1"
      listingId="lst-1"
      orgScoped
      orgSlug="acme"
      hosts={HOSTS}
      permissions={{ installPlugins: true }}
      {...props}
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const LOADING = 'Loading where it is installed…'
const ORG_WIDE =
  'Installed for the whole organization (v1.0.0) — every site, including ones you add later.'
/** The Install card's verdict: the targeting picker and its button. */
const installOffered = () =>
  screen.queryByText('Install to') !== null ||
  screen.queryByRole('button', { name: 'Install' }) !== null

describe("a listing's Install card", () => {
  it('says loading, not Install, while the org pin is unanswered', async () => {
    mockState.orgPinRead = 'loading'
    await mount({ orgId: 'client-org' })
    expect(screen.getByText(LOADING)).toBeTruthy()
    expect(installOffered()).toBe(false)
  })

  it('treats a cached "missing" the server has not confirmed as loading', async () => {
    mockState.orgPinRead = 'fromCache'
    await mount({ orgId: 'client-org' })
    expect(screen.getByText(LOADING)).toBeTruthy()
    expect(installOffered()).toBe(false)
  })

  it("finds an org-wide install under the hub's org when the lookup through the site came back empty", async () => {
    mockState.orgPin = { version: '1.0.0' }
    mockState.hostOrg = { orgId: null, loaded: true }
    await mount({ orgId: 'client-org' })
    expect(screen.getByText(ORG_WIDE)).toBeTruthy()
    expect(installOffered()).toBe(false)
  })

  it('without the org handed over, that empty lookup leaves the org pin unread (the production fail)', async () => {
    mockState.orgPin = { version: '1.0.0' }
    mockState.hostOrg = { orgId: null, loaded: true }
    await mount()
    expect(screen.queryByText(ORG_WIDE)).toBeNull()
    expect(installOffered()).toBe(true)
  })

  it('offers Install once the server confirms no pin anywhere (control)', async () => {
    await mount({ orgId: 'client-org' })
    expect(screen.queryByText(LOADING)).toBeNull()
    expect(installOffered()).toBe(true)
  })
})
