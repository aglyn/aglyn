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
 * "All sites except…" when installing from the workspace's marketplace
 * (AGL-4047).
 *
 * A plugin pins once for the workspace and leaves the chosen sites out, so a
 * site added later gets it. A per-site copy has no link that outlives the
 * install, so the same choice only picks today's sites, and says new sites
 * won't get it. An org-only artifact has no per-site form, so it isn't offered.
 * Radios and a visible list, never a dropdown.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.setTimeout(30_000)

const mockState = {
  listing: {} as Record<string, unknown>,
  /** Stable, as a real subscription's value is between snapshots. */
  profile: { handle: 'pub' },
  /** Stable, as the real hook's is: the org-scope pin read depends on it. */
  db: {},
}
const mockInstallPlan = jest.fn()

const HOSTS = [
  { id: 'h1', label: 'Bakery' },
  { id: 'h2', label: 'Cafe' },
  { id: 'h3', label: 'Catering' },
]

const listingOf = (artifactType: string) => ({
  $id: 'lst-1',
  displayName: 'Promo Countdown',
  profileId: 'pub-org',
  artifactType,
  latestVersion: '1.0.0',
  latestApprovedVersion: '1.0.0',
  latestVersionReviewState: 'approved',
  priceUsd: 0,
  reviewStatus: 'listed',
  deletedAt: null,
  versions: [{ version: '1.0.0', publishedAtMs: 1 }],
})

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
  // The routing mirror names the viewer's workspace; no site holds a pin yet.
  getDoc: async (ref: { path: string }) =>
    ref.path.startsWith('hostIndex/')
      ? { exists: () => true, get: () => 'client-org', data: () => ({ orgId: 'client-org' }) }
      : { exists: () => false, get: () => undefined, data: () => undefined },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockState.db,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostOrgId: () => 'client-org',
  useHostOrgIdState: () => ({ orgId: 'client-org', loaded: true }),
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestoreDoc: (build: () => any) => {
    const path = String(build()?.path ?? '')
    if (path.startsWith('marketplaceListings/')) return { data: mockState.listing, status: 'success' }
    if (path.startsWith('publisherProfiles/')) return { data: mockState.profile, status: 'success' }
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
    installPlan: (...args: unknown[]) => mockInstallPlan(...args),
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

beforeEach(() => {
  mockInstallPlan.mockReset()
  ;(globalThis as any).fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ versions: [] }) })
})

const mount = async (
  artifactType: string,
  hosts: ReadonlyArray<{ id: string; label: string }> = HOSTS,
) => {
  mockState.listing = listingOf(artifactType)
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

const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement
const installButton = () =>
  screen.getAllByRole('button', { name: 'Install' })[0] as HTMLButtonElement

/** Picks "All sites except…" and ticks the named sites to leave out. */
const leaveOut = (...labels: string[]) => {
  fireEvent.click(radio(/All sites except/))
  for (const label of labels) fireEvent.click(screen.getByRole('checkbox', { name: label }))
}

/** Presses Install, then the dialog's Install, and returns the dialog's sentence. */
const confirmInstall = async () => {
  fireEvent.click(installButton())
  const dialog = await screen.findByRole('dialog')
  const sentence = within(dialog).getByText(/This will be installed to/).textContent
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
  })
  return sentence
}

describe('a plugin installed for every site but some', () => {
  it('offers the three choices as radios, never a dropdown', async () => {
    await mount('plugin')
    expect(radio(/^All sites(?! except)/).checked).toBe(true)
    expect(radio(/Selected sites/)).toBeTruthy()
    expect(radio(/All sites except/).disabled).toBe(false)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('Every site, including sites you add later.')).toBeTruthy()
  })

  it('pins once for the workspace and names the sites left out', async () => {
    await mount('plugin')
    leaveOut('Cafe')
    expect(screen.getByText(/Each site you leave out has the plugin switched off/)).toBeTruthy()
    expect(screen.getByText(/“Manage site settings”/)).toBeTruthy()
    const sentence = await confirmInstall()
    expect(sentence).toBe(
      'This will be installed to every site except Cafe, including sites added later.',
    )
    expect(mockInstallPlan).toHaveBeenCalledTimes(1)
    expect(mockInstallPlan.mock.calls[0][1]).toEqual([{ scope: 'org', exceptHostIds: ['h2'] }])
  })

  it('refuses leaving nothing out, with the reason, and installs nothing', async () => {
    await mount('plugin')
    fireEvent.click(radio(/All sites except/))
    expect(screen.getByText('Choose at least one site to leave out, or choose All sites.')).toBeTruthy()
    expect(installButton().disabled).toBe(true)
  })

  it('keeps the last site in', async () => {
    await mount('plugin')
    leaveOut('Bakery', 'Cafe')
    const last = screen.getByRole('checkbox', { name: /Catering/ }) as HTMLInputElement
    expect(last.disabled).toBe(true)
    expect(screen.getByText('At least one site has to stay in.')).toBeTruthy()
  })

  it('All sites is still the one org pin it always was (the control)', async () => {
    await mount('plugin')
    await confirmInstall()
    expect(mockInstallPlan.mock.calls[0][1]).toEqual([{ scope: 'org' }])
  })

  it('switches the choice off, with the reason, on a one-site workspace', async () => {
    await mount('plugin', [HOSTS[0]])
    expect(radio(/All sites except/).disabled).toBe(true)
    expect(screen.getByText('This workspace has one site, so there is nothing to leave out.')).toBeTruthy()
  })
})

describe('a per-site copy installed to every site but some', () => {
  it("says new sites won't get it, and installs to today's other sites", async () => {
    await mount('component')
    expect(
      screen.getByText(
        "Installs to the sites you have today, but the ones you leave out. New sites won't get it automatically.",
      ),
    ).toBeTruthy()
    leaveOut('Cafe')
    expect(screen.queryByText(/Each site you leave out has the plugin switched off/)).toBeNull()
    const sentence = await confirmInstall()
    expect(sentence).toBe('This will be installed to 2 sites: Bakery, Catering.')
    expect(mockInstallPlan.mock.calls[0][1]).toEqual([
      { scope: 'host', hostId: 'h1' },
      { scope: 'host', hostId: 'h3' },
    ])
  })
})

describe('an artifact with no per-site form', () => {
  it('offers All sites alone', async () => {
    await mount('datasetSchema')
    expect(radio(/^All sites(?! except)/).checked).toBe(true)
    expect(screen.queryByRole('radio', { name: /All sites except/ })).toBeNull()
    expect(screen.queryByRole('radio', { name: /Selected sites/ })).toBeNull()
  })
})
