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
 * What one commerce console load actually READS (AGL-693).
 *
 * The console page is a six-tab hub, and the reader looks at one tab. The
 * question this answers is what the other five cost, and it has to be answered
 * in listens and documents rather than in rendered output: a spec that asserts
 * on what is on screen passes identically whether the hidden panels are
 * mounted or not, which is the entire cost being removed.
 *
 * So the meter sits at the Firestore boundary. Every query the page builds is
 * recorded with the `limit()` it carries, because that limit IS the billable
 * ceiling — Firestore charges per document returned, and a card that listens
 * with `limit(500)` to render twenty rows is buying five hundred.
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * Every query built during a render, as `path` + the `limit()` on it.
 *
 * Module-scoped and `mock`-prefixed so the `jest.mock` factories below may
 * close over it — jest's out-of-scope-variable guard admits that one prefix.
 */
const mockListens: Array<{ path: string; limit: number }> = []

/**
 * A query with no `limit()` still reads the whole collection. Counting it as
 * zero would let an unbounded listen look CHEAPER than a bounded one, which
 * inverts the measurement. This stands for "unbounded" at a figure no console
 * collection is expected to exceed, and is reported separately below so the
 * headline number can be read with and without the estimate.
 */
const UNBOUNDED_ESTIMATE = 100

jest.mock('firebase/firestore', () => {
  const marker = (kind: string) => (...args: unknown[]) => ({
    __constraint: kind,
    args,
  })
  return {
    __esModule: true,
    collection: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
    }),
    doc: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
      __doc: true,
    }),
    query: (base: { __path?: string }, ...constraints: unknown[]) => {
      const limits = constraints
        .filter(
          (c): c is { __constraint: string; args: number[] } =>
            !!c && (c as { __constraint?: string }).__constraint === 'limit',
        )
        .map((c) => c.args[0])
        .filter((n) => typeof n === 'number')
      return {
        __path: base?.__path ?? '(unknown)',
        __limit: limits.length ? Math.max(...limits) : 0,
      }
    },
    limit: marker('limit'),
    where: marker('where'),
    orderBy: marker('orderBy'),
    documentId: () => '__name__',
    count: marker('count'),
    sum: marker('sum'),
    onSnapshot: (
      ref: { __path?: string; __limit?: number; __doc?: boolean },
      ..._rest: unknown[]
    ) => {
      mockListens.push({
        path: ref?.__path ?? '(unknown)',
        // A single-document listen reads exactly one document.
        limit: ref?.__doc ? 1 : (ref?.__limit ?? 0),
      })
      return () => undefined
    },
    getDocs: async () => ({ docs: [], empty: true, size: 0 }),
    getDocsFromServer: async () => ({ docs: [], empty: true, size: 0 }),
    getDoc: async () => ({ exists: () => false, data: () => undefined }),
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    getAggregateFromServer: async () => ({ data: () => ({}) }),
    addDoc: async () => ({ id: 'x' }),
    setDoc: async () => undefined,
    updateDoc: async () => undefined,
    deleteDoc: async () => undefined,
    runTransaction: async () => undefined,
    Timestamp: { now: () => ({ toMillis: () => 0, toDate: () => new Date(0) }) },
    serverTimestamp: () => ({ __serverTimestamp: true }),
  }
})

/*
 * Every mocked hook answers the SAME object on every call.
 *
 * A fresh object per render is not a harmless detail here: the cards put
 * `firestore` and the plan doc in their query dependency lists, so a new
 * identity each render re-subscribes, which re-renders, which re-subscribes.
 * The spec hangs rather than failing, and the meter counts a loop instead of
 * a load.
 */
const mockFirestore = { __firestore: true }
const mockUser = { data: { uid: 'u1' }, status: 'success' }
const mockOrgId = { orgId: 'org1', ready: true }
const mockHostRoute = { orgSlug: 'acme', href: '/acme' }
const mockPlan = { org: { plan: 'business', features: {} }, ready: true }
const mockResourceApi = { data: undefined, loading: false }

// The console-app hooks a plugin page reaches through. Only the ones that
// decide whether a card RENDERS matter here; the rest answer empty so the
// cards get past their loading states and build their queries.
jest.mock('@aglyn/tenant-feature-instance', () => {
  const actual = jest.requireActual('@aglyn/tenant-feature-instance')
  return {
    ...actual,
    useFirestore: () => mockFirestore,
    useUser: () => mockUser,
    useHostOrgId: () => mockOrgId,
    useConsoleHostRoute: () => mockHostRoute,
    // Entitled and settled: an unentitled org renders upsells instead of
    // cards, which would measure the refusal rather than the page.
    useOrgPlan: () => mockPlan,
    useHostResourceApi: () => mockResourceApi,
  }
})

jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return {
    ...actual,
    // Every commerce feature granted, for the same reason `useOrgPlan` is.
    checkEntitlement: () => true,
    useMediaPicker: () => ({ pickMedia: async () => null }),
  }
})

// The shell providers a plugin page renders inside. They contribute no reads
// of their own; without them the cards throw before building their queries.
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({
    enqueueSnackbar: () => undefined,
    closeSnackbar: () => undefined,
  }),
}))

/** The section the URL names, moved between renders to stand for a link. */
let mockTab = ''

jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/hosts/site/products',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(mockTab ? `tab=${mockTab}` : ''),
  useParams: () => ({}),
}))

/** Documents the recorded listens would return at their limits. */
function documentCeiling(listens: Array<{ path: string; limit: number }>) {
  return listens.reduce(
    (total, listen) => total + (listen.limit || UNBOUNDED_ESTIMATE),
    0,
  )
}

function summarize(label: string, listens: Array<{ path: string; limit: number }>) {
  const bounded = listens.filter((l) => l.limit > 0)
  const unbounded = listens.length - bounded.length
  console.log(
    `\n[${label}] listens=${listens.length} ` +
      `(bounded=${bounded.length}, unbounded=${unbounded}) ` +
      `documents<=${documentCeiling(listens)}\n` +
      listens
        .map((l) => `    ${String(l.limit || `~${UNBOUNDED_ESTIMATE}`).padStart(4)}  ${l.path}`)
        .join('\n'),
  )
}

/** Collections only ONE section's cards read, keyed by that section. */
const SECTION_COLLECTIONS = {
  catalog: ['productCategories', 'inventoryAdjustments', 'memberPosts'],
  orders: ['orders', 'checkouts', 'restockAlerts'],
  promotions: ['discounts', 'coupons', 'giftCards', 'reviews'],
  reservations: ['reservations'],
} as const

function listenedCollections(): Set<string> {
  // `hosts/{id}/{collection}` — the leaf names the collection.
  return new Set(mockListens.map((listen) => listen.path.split('/').pop() ?? ''))
}

async function renderConsole(tab: string) {
  mockTab = tab
  mockListens.length = 0
  const { CommerceConsolePage } = await import('./commerce-console-page')
  const view = render(
    <CommerceConsolePage
      hostId="site1"
      entitled
      org={{ plan: 'business' } as never}
      permissions={{ managePos: true } as never}
    /> as ReactNode as never,
  )
  return view
}

describe('commerce console read cost (AGL-693)', () => {
  afterEach(() => {
    mockTab = ''
    mockListens.length = 0
  })

  /*
   * The CONTROL for every assertion below.
   *
   * The three cost assertions are all of the form "collection X was NOT
   * listened to", and a meter that records nothing satisfies every one of
   * them. This is the reading that proves the meter is live: the section the
   * URL names does listen, and it listens for its OWN collections. Without
   * this test passing, a green suite below means nothing.
   */
  it('CONTROL: the open section does listen, and for its own collections', async () => {
    await renderConsole('orders')
    summarize('orders section', mockListens)
    const seen = listenedCollections()
    expect(mockListens.length).toBeGreaterThan(0)
    for (const collection of SECTION_COLLECTIONS.orders) {
      expect(seen).toContain(collection)
    }
  })

  it('an unopened section issues no query', async () => {
    await renderConsole('catalog')
    summarize('catalog section', mockListens)
    const seen = listenedCollections()

    // The section being read is present — the same control, restated at the
    // section this test actually opens.
    for (const collection of SECTION_COLLECTIONS.catalog) {
      expect(seen).toContain(collection)
    }

    // Every OTHER section is silent. These are the reads the reader is not
    // looking at and would otherwise be billed for.
    for (const section of ['orders', 'promotions', 'reservations'] as const) {
      for (const collection of SECTION_COLLECTIONS[section]) {
        expect(seen).not.toContain(collection)
      }
    }
  })

  it('a section is reachable by URL, and mounts only itself', async () => {
    await renderConsole('promotions')
    const seen = listenedCollections()
    for (const collection of SECTION_COLLECTIONS.promotions) {
      expect(seen).toContain(collection)
    }
    // Arriving at Promotions by link must not drag Catalog's reads along.
    expect(seen).not.toContain('inventoryAdjustments')
    expect(seen).not.toContain('memberPosts')
  })

  /*
   * The ceiling one load may reach, as a number rather than a description.
   *
   * A budget, not a snapshot: it is here so that a card added to a section
   * nobody opened shows up as a failure rather than as a slightly larger
   * Firestore bill. Raise it deliberately when a section genuinely grows, and
   * treat a jump of hundreds as the thing to explain first.
   */
  it('holds one load under its document budget', async () => {
    await renderConsole('catalog')
    expect(documentCeiling(mockListens)).toBeLessThanOrEqual(3200)
  })
})
