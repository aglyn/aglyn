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
 * The Install card's Buy for a member of the publisher (AGL-4047).
 *
 * The sale refuses anyone in the publishing workspace, for any workspace, so
 * the card says so before they press it: Buy on screen, switched off, with the
 * reason. A stranger's Buy is untouched, and on the publisher's own site there
 * is no Buy at all, because the listing is free there.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.setTimeout(30_000)

const REASON = "Someone in this workspace who isn't in Pub Studio needs to buy it."

const mockState = {
  viewerOrgId: 'client-org',
  /** Member documents that exist, by path. */
  members: new Set<string>(),
  /** Every document path the page asked for. */
  docReads: [] as string[],
  profile: { handle: 'pub', displayName: 'Pub Studio' } as Record<string, unknown> | null,
}
const mockBuy = jest.fn()
const MEMBER_DOC = 'orgs/pub-org/members/uid-test'

const LISTING = {
  $id: 'lst-1',
  displayName: 'Promo Countdown',
  profileId: 'pub-org',
  artifactType: 'component',
  latestVersion: '1.0.0',
  priceUsd: 25,
  reviewStatus: 'listed',
  deletedAt: null,
  versions: [{ version: '1.0.0', publishedAtMs: 1 }],
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
  getDoc: async () => ({
    exists: () => true,
    get: (field: string) => (field === 'orgId' ? mockState.viewerOrgId : undefined),
    data: () => ({ orgId: mockState.viewerOrgId }),
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostOrgId: () => mockState.viewerOrgId,
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestoreDoc: (build: () => any) => {
    const path = String(build()?.path ?? '')
    if (path) mockState.docReads.push(path)
    if (path.startsWith('marketplaceListings/')) return { data: LISTING, status: 'success' }
    if (path.startsWith('publisherProfiles/')) return { data: mockState.profile, status: 'success' }
    if (mockState.members.has(path)) return { data: { role: 'viewer' }, status: 'success' }
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
jest.mock('./plugin-site-set.component', () => ({ __esModule: true, default: () => null }))
jest.mock('./uninstall-impact-dialog.component', () => ({ __esModule: true, default: () => null }))
jest.mock('./artifact-update-dialog.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../hooks/use-marketplace-actions', () => ({
  useMarketplaceActions: () => ({
    install: jest.fn(),
    installPlan: jest.fn(),
    uninstall: jest.fn(),
    buy: (...args: unknown[]) => mockBuy(...args),
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

beforeEach(() => {
  mockState.viewerOrgId = 'client-org'
  mockState.members.clear()
  mockState.docReads.length = 0
  mockState.profile = { handle: 'pub', displayName: 'Pub Studio' }
  mockBuy.mockReset()
  ;(globalThis as any).fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ versions: [] }) })
})

const mount = async () => {
  render(
    <MarketplaceListingContent hostId="h1" listingId="lst-1" permissions={{ installPlugins: true }} />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const buyButton = () => screen.getByRole('button', { name: 'Buy for $25' }) as HTMLButtonElement

describe('Buy on a publisher’s paid listing (AGL-4047)', () => {
  it('a member of the publisher, in another workspace, sees it switched off with the reason', async () => {
    mockState.members.add(MEMBER_DOC)
    await mount()
    expect(buyButton().disabled).toBe(true)
    expect(screen.getByText(REASON)).toBeTruthy()
    expect(screen.getByLabelText(REASON)).toBeTruthy()
    fireEvent.click(buyButton())
    expect(mockBuy).not.toHaveBeenCalled()
  })

  it('names the publisher by its handle, and says so plainly when it has no name to give', async () => {
    mockState.members.add(MEMBER_DOC)
    mockState.profile = { handle: 'pub', displayName: ' ' }
    const { unmount } = render(
      <MarketplaceListingContent hostId="h1" listingId="lst-1" permissions={{ installPlugins: true }} />,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByText("Someone in this workspace who isn't in pub needs to buy it.")).toBeTruthy()
    unmount()
    mockState.profile = null
    await mount()
    expect(
      screen.getByText("Someone in this workspace who isn't in the publishing workspace needs to buy it."),
    ).toBeTruthy()
  })

  it('a stranger sees it enabled, with no reason, and it buys', async () => {
    await mount()
    expect(buyButton().disabled).toBe(false)
    expect(screen.queryByText(REASON)).toBeNull()
    fireEvent.click(buyButton())
    expect(mockBuy).toHaveBeenCalledTimes(1)
  })

  it('reads only the person’s own member document, never the roster', async () => {
    await mount()
    const memberReads = mockState.docReads.filter((path) => path.includes('/members'))
    expect([...new Set(memberReads)]).toEqual([MEMBER_DOC])
  })

  it('on the publisher’s own site the free path stands: no Buy, no reason, no membership read', async () => {
    mockState.viewerOrgId = 'pub-org'
    mockState.members.add(MEMBER_DOC)
    await mount()
    expect(screen.queryByRole('button', { name: /^Buy/ })).toBeNull()
    expect((screen.getByRole('button', { name: 'Add to this site' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(REASON)).toBeNull()
    expect(mockState.docReads.filter((path) => path.includes('/members'))).toEqual([])
  })
})
