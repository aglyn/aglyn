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
 * The two lookups behind the listing page's BUY button (AGL-2501).
 *
 * Every other unordered window in this sweep decides a chip. These two decide
 * whether a person is offered a purchase:
 *
 *  * `hosts/{h}/components` says whether a component listing is already
 *    installed here, and
 *  * `marketplacePurchases` says whether this workspace already holds a
 *    licence.
 *
 * Both were a bare `limit()`, which Firestore answers in DOCUMENT-ID order, so
 * both were an arbitrary slice — and in both, a MISS is indistinguishable from
 * a genuine absence. A buyer whose purchase document fell outside the window
 * was shown a Buy button for a licence they had already paid for, and the
 * install routes would then have answered `402` if they had not paid twice.
 *
 * The ordering makes the window a defined prefix rather than a sample, and the
 * probe row makes "there is more than this" a fact the panel can state. Both
 * halves are invisible in rendered output — the page draws the same button
 * either way — so this measures the queries and then reads the notice.
 *
 * NO STRIPE PATH IS EXERCISED and no purchase is created.
 */

import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.setTimeout(30_000)

const COMPONENT_CEILING = 100
const PURCHASE_CEILING = 200

const mockListens: Array<{
  path: string
  limit: number
  constraints: Array<Record<string, any>>
}> = []

/** Collections the fixture fills to the cap, so the probe row comes back. */
const mockOverflowing = new Set<string>()

const FIRESTORE = {}

const LISTING = {
  $id: 'lst-1',
  displayName: 'Promo Countdown',
  profileId: 'pub-1',
  artifactType: 'component',
  latestVersion: '1.0.0',
  priceUsd: 25,
  reviewStatus: 'approved',
  deletedAt: null,
  versions: [{ version: '1.0.0', publishedAtMs: 1 }],
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  where: (field: string) => ({ where: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    __doc: true,
  }),
  getDoc: async () => ({
    exists: () => false,
    get: () => undefined,
    data: () => undefined,
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostOrgId: () => 'o1',
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestoreDoc: (build: () => any) => {
    const built = build()
    const path = String(built?.path ?? '')
    if (path.startsWith('marketplaceListings/')) {
      return { data: LISTING, status: 'success', fromCache: false }
    }
    return { data: null, status: 'success', fromCache: false }
  },
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (!built) return { data: [], status: 'success', fromCache: false }
    const constraints: Array<Record<string, any>> = built.constraints ?? []
    const cap = constraints.find((item) => 'limit' in item)?.limit
    const path = String(built.path ?? '')
    mockListens.push({
      path,
      limit: typeof cap === 'number' ? cap : 0,
      constraints,
    })
    const name = path.split('/').pop() ?? ''
    // Filled to the cap when the collection is meant to overflow: that is the
    // reading — and the only reading — that makes `truncated` true.
    const held = mockOverflowing.has(name) ? (cap ?? 0) : 0
    return {
      data: Array.from({ length: held }, (_, index) => ({
        $id: `${name}-${index}`,
      })),
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  // The real one lays its items out in a grid; here it only has to RENDER
  // them, because the notice under test lives inside one of them.
  GridItems: ({ items }: { items?: Array<{ children?: ReactNode }> }) => (
    <div>
      {(items ?? []).map((item, index) => (
        <div key={index}>{item?.children}</div>
      ))}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('@aglyn/shared-ui-next/contexts/next-page-title-provider', () => ({
  NextPageTitle: () => null,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('./listing-image.component', () => ({ ListingImage: () => null }))
jest.mock('./listing-reviews.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./report-target.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./plugin-site-set.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./uninstall-impact-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./artifact-update-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../hooks/use-marketplace-actions', () => ({
  useMarketplaceActions: () => ({
    install: jest.fn(),
    uninstall: jest.fn(),
    buy: jest.fn(),
    busy: false,
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

beforeEach(() => {
  mockListens.length = 0
  mockOverflowing.clear()
  // The page fetches its version history over HTTP. jsdom has no `fetch`, and
  // the versions list is not what is being measured — this keeps the effect
  // from throwing over the reads that are.
  ;(globalThis as any).fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ versions: [] }) })
})

const listenOn = (path: string) =>
  mockListens.find((listen) => listen.path === path)

const mount = async () => {
  render(
    <MarketplaceListingContent
      hostId="h1"
      listingId="lst-1"
      permissions={{ installPlugins: true }}
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('the listing page’s buy-gate lookups (AGL-2501)', () => {
  it('caps each at its ceiling plus a probe row', async () => {
    await mount()
    // Named with their ceilings. The two numbers differ deliberately — a
    // purchase miss costs money and a component miss costs a chip — so an
    // assertion that accepted "some cap" would let the wide one narrow.
    expect(listenOn('hosts/h1/components')?.limit).toBe(COMPONENT_CEILING + 1)
    expect(listenOn('marketplacePurchases')?.limit).toBe(PURCHASE_CEILING + 1)
  })

  it('orders every capped read on the page, on the document name', async () => {
    await mount()
    // Every one, not the two the ceilings above name. The per-listing install
    // lookups are narrow enough to look harmless — and they are the ones that
    // decide whether an already-installed dataset or email template reads as
    // absent, because the page takes the FIRST live row out of whatever comes
    // back.
    expect(mockListens.length).toBeGreaterThan(2)
    for (const path of mockListens.map((listen) => listen.path)) {
      const order = listenOn(path)?.constraints.find(
        (item) => 'orderBy' in item,
      )
      expect(order).toBeTruthy()
      // Not `purchasedAt`: `orderBy` matches only documents that HAVE the
      // field, so ordering there would DROP a purchase written without one —
      // and a dropped purchase reads exactly like an unbought listing, which
      // is the failure this ordering exists to make impossible.
      expect(order?.['orderBy']).toBe('__name__')
    }
  })

  it('keeps the buyer filter, so the query stays readable under the rules', async () => {
    await mount()
    // `marketplacePurchases` is buyer/seller-gated and a LIST is evaluated
    // against the QUERY. Dropping the `where` to "simplify" the ordering
    // would turn every mount into a refusal, which renders as an unbought
    // listing rather than as an error.
    expect(
      listenOn('marketplacePurchases')?.constraints.some(
        (item) => item['where'] === 'buyerUid',
      ),
    ).toBe(true)
  })

  it('says nothing while both windows covered their collections', async () => {
    await mount()
    expect(screen.queryByText(/Checked against the first/)).toBeNull()
  })

  it('warns before the money moves when the purchase window ran short', async () => {
    mockOverflowing.add('marketplacePurchases')
    await mount()
    expect(
      screen.getByText(/Checked against the first 200 of your purchases/),
    ).toBeTruthy()
    // The instruction, not just the fact. "There may be more" beside a Buy
    // button is a caveat; "check your receipts" is an action.
    expect(
      screen.getByText(/check your receipts before buying again/),
    ).toBeTruthy()
  })

  it('warns when the component window ran short too', async () => {
    mockOverflowing.add('components')
    await mount()
    expect(
      screen.getByText(/Checked against the first 100 components on this site/),
    ).toBeTruthy()
  })
})
