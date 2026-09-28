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
 * What the marketplace shelf READS, and what a miss on it costs (AGL-2501).
 *
 * The listings query has had an ordering since AGL-2501; the five queries
 * BESIDE it had not, and they are the ones this file is about. Each answers
 * "does this workspace already run that listing", each is folded into a map
 * and never rendered, and each was a bare `limit()` — which Firestore answers
 * in DOCUMENT-ID order, so each was an arbitrary slice.
 *
 * That is not a mis-drawn list, because there is no list. It is a WRONG
 * ANSWER: a lookup miss and a genuine not-installed are the same absence from
 * the same map, so a workspace whose installs fell past the window saw "Add to
 * this site" beside something it already runs — and the detail page, which
 * reads its own pins by id, then disagreed with the grid it was reached from.
 *
 * No assertion on rendered output can see any of this: the grid draws
 * identically whether the window covered the collection or a fifth of it. So
 * the meter sits at the Firestore boundary and records each listen as its path
 * plus the `limit()` the query carries, together with the constraints — the
 * limit is the billable ceiling, and the ordering is the half that decides
 * whether the answer means anything.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { lastListQueryPlan } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { listingQueryFields } from '../model/listing-query'
import type { ReactNode } from 'react'

jest.setTimeout(30_000)

/** The shared ceiling for the five install-state lookups. */
const CEILING = 100

const mockListens: Array<{
  path: string
  limit: number
  constraints: Array<Record<string, any>>
}> = []

/** Collections the fixture should answer at ceiling + 1, tripping the probe. */
const mockOverflowing = new Set<string>()

const FIRESTORE = {}

/** Stored as the publish routes store a listing, query fields included (AGL-3321). */
const stored = (listing: Record<string, any>) => ({
  ...listing,
  ...listingQueryFields(listing),
})
const LISTING = stored({
  $id: 'lst-1',
  displayName: 'Promo Countdown',
  profileId: 'pub-1',
  category: 'marketing',
  artifactType: 'component',
  latestVersion: '1.0.0',
  createdAt: { seconds: 10 },
  priceUsd: 0,
  reviewStatus: 'approved',
  deletedAt: null,
})
let mockShelf: Array<Record<string, any>> = [LISTING]

/*
 * The shelf is a LIST QUERY (AGL-3321): the contract's double runs the real
 * plan and answers it over the fixture the way Firestore would.
 */
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    useListQuery: (options: unknown) => useListQueryDouble(() => mockShelf, options),
  }
})

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
  Timestamp: { fromDate: (date: Date) => date },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostOrgId: () => 'o1',
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestoreDoc: () => ({ data: null, status: 'success' }),
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
    // The fixture answers a lookup at its CAP when the collection is meant to
    // overflow, which is exactly the reading that makes `truncated` true.
    const name = path.split('/').pop() ?? ''
    const held = mockOverflowing.has(name) ? CEILING + 1 : 2
    return {
      data: Array.from({ length: Math.min(held, cap ?? held) }, (_, index) => ({
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
  MdiIcon: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-pagination.component', () => ({
  ListPagination: () => null,
}))
jest.mock('./listing-image.component', () => ({
  ListingImage: () => null,
}))

import { MarketplaceBrowse } from './marketplace-browse.component'

beforeEach(() => {
  mockListens.length = 0
  mockOverflowing.clear()
  mockShelf = [LISTING]
})

const meter = () => [
  ...new Set(mockListens.map((listen) => `${listen.path}#${listen.limit}`)),
]

const mount = async () => {
  render(<MarketplaceBrowse hostId="h1" orgScoped orgSlug="acme" />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The listen for one collection, whatever else the shelf opened. */
const listenOn = (path: string) =>
  mockListens.find((listen) => listen.path === path)

describe('the marketplace shelf’s install-state lookups (AGL-2501)', () => {
  it('opens six windows and no more, each at a stated ceiling', async () => {
    await mount()
    // The whole set, path and ceiling together. Five of these are siblings
    // answering the same question, so an assertion naming one of them would
    // go green again with the other four back on an unordered `limit(200)`.
    // The shelf itself is not among them: it is a paged list query now
    // (AGL-3321), asserted below.
    expect(meter().sort()).toEqual([
      'hosts/h1/components#101',
      'hosts/h1/emailTemplates#101',
      'hosts/h1/installs#101',
      'orgs/o1/datasets#101',
      'orgs/o1/installs#101',
    ])
  })

  it('names an order on every lookup, and it is the document name', async () => {
    await mount()
    for (const path of [
      'hosts/h1/components',
      'hosts/h1/emailTemplates',
      'hosts/h1/installs',
      'orgs/o1/datasets',
      'orgs/o1/installs',
    ]) {
      const order = listenOn(path)?.constraints.find(
        (item) => 'orderBy' in item,
      )
      expect(order).toBeTruthy()
      // `documentId()` and not a field. `orderBy` matches only documents that
      // HAVE the field, so ordering an install lookup on `createdAt` would
      // DROP every install written without one — and a dropped install reads
      // exactly like an absent one, which is the bug being fixed.
      expect(order?.['orderBy']).toBe('__name__')
    }
  })

  it('leaves the shelf’s OWN ordering alone', async () => {
    await mount()
    // The listings query answers a reader-visible sort and has ordered on
    // `createdAt` since it was fixed; a sweep that replaced it with the
    // document name would silently turn "Newest" into "arbitrary".
    expect(lastListQueryPlan()?.orderBy).toEqual({
      path: 'createdAt',
      direction: 'desc',
    })
  })

  it('says nothing when no ceiling bit', async () => {
    await mount()
    expect(screen.queryByText(/Installed state is resolved/)).toBeNull()
  })

  it('discloses the cut when ONE of the five overflows', async () => {
    // One collection, not all five: the notice speaks for the shelf, so a
    // check that only fired when everything overflowed would miss the case
    // that actually happens.
    mockOverflowing.add('installs')
    await mount()
    expect(
      screen.getByText(/Installed state is resolved from the first 100/),
    ).toBeTruthy()
  })

  it('discloses it for the dataset window too', async () => {
    // The one carrying a `where` as well as the ordering — it reached the
    // shared ceiling from a window of two hundred, and the probe has to
    // survive that.
    mockOverflowing.add('datasets')
    await mount()
    expect(
      screen.getByText(/Installed state is resolved from the first 100/),
    ).toBeTruthy()
  })
})

/*
 * THE SHELF'S SEARCH, CATEGORY AND SORT ARE ITS QUERY (AGL-3321). They were
 * matched over the newest ninety listings, so a listing past them could not
 * be found by any control on the page.
 */
describe('the marketplace shelf serves its controls by the query (AGL-3321)', () => {
  const many = () =>
    Array.from({ length: 30 }, (_, index) =>
      stored({
        $id: `lst-${String(index).padStart(2, '0')}`,
        displayName: index === 27 ? 'Zebra Stripes' : `Widget ${index}`,
        profileId: 'pub-1',
        category: index === 27 ? 'design' : 'content',
        artifactType: 'component',
        latestVersion: '1.0.0',
        // Oldest last: the match is the third-oldest, on page three.
        createdAt: { seconds: 100 - index },
        installCount: index,
        ratingAverage: null,
        priceUsd: 0,
        deletedAt: null,
      }),
    )

  it('finds by search a listing past the first page', async () => {
    mockShelf = many()
    await mount()
    expect(screen.queryByText('Zebra Stripes')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search components…'), {
      target: { value: 'zeb' },
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })
    expect(screen.getByText('Zebra Stripes')).toBeTruthy()
    // The fixture's `hostIndex` names no org, so the viewer's scope is the
    // public one alone.
    expect(lastListQueryPlan()?.filters).toEqual([
      {
        path: 'browseTokens',
        op: 'array-contains-any',
        value: ['*~zeb'],
      },
    ])
  })

  it('narrows by a category chip on the query', async () => {
    mockShelf = many()
    await mount()
    fireEvent.click(screen.getByText('design'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByText('Zebra Stripes')).toBeTruthy()
    expect(lastListQueryPlan()?.filters).toContainEqual({
      path: 'category',
      op: '==',
      value: 'design',
    })
  })

  it('never shows a listing browse’s audience excludes', async () => {
    mockShelf = [
      LISTING,
      stored({ ...LISTING, $id: 'gone', displayName: 'Unpublished Thing', deletedAt: { seconds: 1 } }),
      stored({
        ...LISTING,
        $id: 'pending',
        displayName: 'Someone Elses Pending',
        artifactType: 'plugin',
        reviewStatus: 'submitted',
      }),
    ]
    await mount()
    expect(screen.getByText('Promo Countdown')).toBeTruthy()
    expect(screen.queryByText('Unpublished Thing')).toBeNull()
    expect(screen.queryByText('Someone Elses Pending')).toBeNull()
  })
})
