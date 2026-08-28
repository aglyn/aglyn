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
 * Three commerce lists, two different answers, and the reason each got the one
 * it did (AGL-2501).
 *
 * All three were the same defect — a bare `limit()` over a collection keyed by
 * `createResourceUid()`, so the window was a pseudo-random sample and every row
 * past it was UNREACHABLE, not merely unrendered. They do not get the same fix,
 * and that is the point of this file:
 *
 *  * suppliers and discounts are SERVER-PAGED. Nothing on either card is
 *    computed from a row that is off the page, so the window can be the query
 *    and page two costs one page of reads.
 *  * categories and collections are CEILINGED with a probe and paged as a
 *    client slice. The category walk is a TREE and the collection list carries
 *    a slug uniqueness check, and both need every row to be correct.
 *
 * The product catalog behind the match counts is ceilinged too, for a third
 * reason again: those counts cannot be right without the whole catalog, so the
 * probe makes them say "at least" rather than state a total they cannot know.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

jest.setTimeout(30_000)

/** More suppliers than the card ever used to be able to show. */
const SUPPLIERS = 63
const supplierDocs = Array.from({ length: SUPPLIERS }, (_, index) => ({
  $id: `sup-${String(index).padStart(3, '0')}`,
  name: `Supplier ${String(index).padStart(3, '0')}`,
  email: `ops${index}@example.test`,
}))

/**
 * Discounts, a third of them AUTOMATIC — stored with `code: null`.
 *
 * The trap this fixture exists for: `orderBy('code')` is the obvious ordering
 * and would not mis-sort the list, it would DROP every automatic promotion the
 * shop has.
 */
const DISCOUNTS = 34
const discountDocs = Array.from({ length: DISCOUNTS }, (_, index) => ({
  $id: `disc-${String(index).padStart(3, '0')}`,
  ...(index % 3 === 0
    ? { code: null }
    : { code: `CODE${String(index).padStart(3, '0')}` }),
  kind: 'percent',
  valuePct: 10,
  enabled: true,
}))

const CATEGORY_CEILING = 250
const COLLECTION_CEILING = 250
const PRODUCT_CEILING = 500

/** One past the ceiling, so the probe has something to find. */
const categoryDocs = Array.from({ length: CATEGORY_CEILING + 1 }, (_, i) => ({
  $id: `cat-${String(i).padStart(4, '0')}`,
  name: `Category ${String(i).padStart(4, '0')}`,
  slug: `category-${i}`,
  parentId: null,
  order: i,
}))

const collectionDocs = Array.from(
  { length: COLLECTION_CEILING + 1 },
  (_, i) => ({
    $id: `col-${String(i).padStart(4, '0')}`,
    name: `Collection ${String(i).padStart(4, '0')}`,
    slug: `collection-${i}`,
    kind: 'catalog',
    mode: 'manual',
    productIds: [],
  }),
)

/** A catalog LARGER than the window the card reads, which is the whole point. */
const productDocs = Array.from({ length: PRODUCT_CEILING + 40 }, (_, i) => ({
  $id: `prod-${String(i).padStart(4, '0')}`,
  name: `Product ${String(i).padStart(4, '0')}`,
  slug: `product-${i}`,
  status: 'active',
  type: 'physical',
  variants: [{ id: 'v1', priceUsd: 10, inventory: 1 }],
}))

const byCollection: Record<string, Array<Record<string, any>>> = {
  suppliers: supplierDocs,
  discounts: discountDocs,
  productCategories: categoryDocs,
  collections: collectionDocs,
  products: productDocs,
  locations: [],
  licenseKeys: [],
}

/**
 * Firestore's own semantics, not a slice.
 *
 * The ordering branch is load-bearing twice over: with no `orderBy` the engine
 * returns documents in `__name__` order, and `orderBy` on a FIELD matches only
 * the documents that have it. A double that ignored either would be one in
 * which the shipped bug passes.
 */
const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const field = order
    ? order.orderBy === '__name__'
      ? '$id'
      : order.orderBy
    : null
  const matching = field
    ? all.filter((doc) => doc[field] !== undefined && doc[field] !== null)
    : all
  const sorted = [...matching].sort((a, b) =>
    String(a[field ?? '$id']) < String(b[field ?? '$id']) ? -1 : 1,
  )
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** Every cap asked for, KEYED BY COLLECTION — see the assertions. */
let mockCapsAsked: Record<string, number[]> = {}
const FIRESTORE = {}

const answerFor = (built: any) => {
  const name = String(built?.path ?? '').split('/').pop() ?? ''
  const cap = (built?.constraints ?? []).find(
    (item: any) => 'limit' in item,
  )?.limit
  if (typeof cap === 'number') {
    mockCapsAsked[name] = [...(mockCapsAsked[name] ?? []), cap]
  }
  return firestoreAnswer(byCollection[name] ?? [], built?.constraints ?? [])
}

jest.mock('@aglyn/tenant-feature-instance', () => {
  const actual = jest.requireActual('@aglyn/tenant-feature-instance')
  const react = jest.requireActual('react')
  return {
    useFirestore: () => FIRESTORE,
    useUser: () => ({ data: { uid: 'uid-test', getIdToken: jest.fn() } }),
    useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new' }),
    useOrgPlan: () => ({ org: { plan: 'business' }, ready: true }),
    useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
    useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
    writeGuardedBySeed: actual.writeGuardedBySeed,
    // Real: the ordering and the ceiling belong to the cards under test.
    collectionCeiling: actual.collectionCeiling,
    collectionPage: actual.collectionPage,
    ceilingedWindow: actual.ceilingedWindow,
    useFirestoreCollection: (build: () => any) => ({
      data: answerFor(build()),
      status: 'success',
      fromCache: false,
    }),
    /*
     * MODELLED, not stubbed: the real hook widens its window to cover pages
     * 0..n plus a probe row, and hands back the page WITHOUT the probe. A stub
     * returning everything would render rows the card cannot be given, and
     * would hide the off-by-one instead of catching it.
     */
    usePagedCollection: (
      build: (pageLimit: number) => any,
      _deps: unknown,
      options: { pageSize?: number } = {},
    ) => {
      const [page, setPage] = react.useState(0)
      const [pageSize, setPageSize] = react.useState(
        options.pageSize ?? TABLE_PAGE_SIZE_DEFAULT,
      )
      const windowSize = pageSize * (page + 1)
      const data = answerFor(build(windowSize + 1))
      return {
        rows: data.slice(page * pageSize, windowSize),
        hasMore: data.length > windowSize,
        page,
        setPage,
        pageSize,
        setPageSize,
        data,
        status: 'success',
        fromCache: false,
      }
    },
  }
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  /*
   * Plain descriptors, not the SDK's opaque `QueryConstraint`. The double
   * above reads the cap and the ordering back out of them, and the real
   * objects expose neither — so leaving these actual made every read look
   * uncapped and unordered, which is a double in which the shipped bug passes.
   */
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  documentId: () => '__name__',
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  addDoc: jest.fn().mockResolvedValue(undefined),
  getDoc: jest.fn().mockResolvedValue({ get: () => undefined }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

import CatalogOrganizationCard from './catalog-organization-card.component'
import DiscountsCard from './discounts-card.component'
import SuppliersCard from './suppliers-card.component'

beforeEach(() => {
  mockCapsAsked = {}
})

const textsMatching = (pattern: RegExp) =>
  Array.from(document.querySelectorAll('p, span'))
    .map((node) => (node.textContent ?? '').trim())
    .filter((text) => pattern.test(text))

describe('the suppliers list is server-paged and ordered (AGL-2501)', () => {
  it('asks the SUPPLIERS query for a page and a probe, and nothing wider', () => {
    render(<SuppliersCard hostId="host-1" />)
    // The set, keyed by collection. `toContain(11)` would be satisfied by any
    // sibling read that happened to ask for eleven, and would keep passing if
    // this list stopped capping at all.
    expect(mockCapsAsked).toEqual({
      suppliers: [TABLE_PAGE_SIZE_DEFAULT + 1],
    })
  })

  it('reaches a supplier the old window could never have shown', async () => {
    render(<SuppliersCard hostId="host-1" />)
    const last = `Supplier ${String(SUPPLIERS - 1).padStart(3, '0')}`
    expect(textsMatching(/^Supplier \d{3}$/)).toHaveLength(
      TABLE_PAGE_SIZE_DEFAULT,
    )
    // Six pages in, past where a `limit(50)` window ended.
    for (let step = 0; step < 6; step += 1) {
      fireEvent.click(screen.getByLabelText('Go to next page'))
    }
    await waitFor(() => expect(textsMatching(/^Supplier \d{3}$/)).toContain(last))
    expect(SUPPLIERS).toBeGreaterThan(50)
  })
})

describe('the discounts list is server-paged and ordered (AGL-2501)', () => {
  it('THE TRAP: ordering on `code` would hide every automatic promotion', () => {
    const onCode = firestoreAnswer(discountDocs, [{ orderBy: 'code' }])
    const automatic = discountDocs.filter((row) => row.code === null)
    expect(automatic.length).toBeGreaterThan(0)
    expect(onCode).toHaveLength(DISCOUNTS - automatic.length)
    // The ordering actually used drops nothing, which is the claim.
    expect(firestoreAnswer(discountDocs, [{ orderBy: '__name__' }])).toHaveLength(
      DISCOUNTS,
    )
  })

  it('asks the DISCOUNTS query for a page and a probe', () => {
    render(<DiscountsCard hostId="host-1" />)
    expect(mockCapsAsked).toEqual({
      discounts: [TABLE_PAGE_SIZE_DEFAULT + 1],
    })
  })

  it('still lists the automatic promotions, which have no code', () => {
    render(<DiscountsCard hostId="host-1" />)
    // `disc-000` is automatic and first by document id, so page one holds it.
    expect(screen.getAllByText('Automatic').length).toBeGreaterThan(0)
  })
})

describe('the catalog lists are ceilinged, not server-paged (AGL-2501)', () => {
  const mountCatalog = () => render(<CatalogOrganizationCard hostId="host-1" />)

  it('reads each collection ONCE, at its ceiling plus a probe', () => {
    mountCatalog()
    // Three ceilings, three probes, and no fourth read that quietly widened.
    expect(mockCapsAsked).toEqual({
      productCategories: [CATEGORY_CEILING + 1],
      collections: [COLLECTION_CEILING + 1],
      products: [PRODUCT_CEILING + 1],
    })
  })

  it('renders one PAGE of categories, not the whole ceiling', () => {
    mountCatalog()
    expect(textsMatching(/^Category \d{4}/)).toHaveLength(
      TABLE_PAGE_SIZE_DEFAULT,
    )
  })

  it('says when each ceiling bit', () => {
    mountCatalog()
    expect(screen.getByText(/drawn at the top level here/)).toBeTruthy()
    expect(screen.getByText(/an address may already be taken/)).toBeTruthy()
  })

  it('THE POINT: a match count over a short catalog says "at least"', () => {
    mountCatalog()
    // The catalog is 540 products against a 500-row window, so every count on
    // this card is a lower bound — and saying "12 products" would be the
    // count-that-is-a-window-length defect wearing the fix's clothes.
    const counts = textsMatching(/products$/)
    expect(counts.length).toBeGreaterThan(0)
    for (const text of counts) expect(text).toContain('at least')
  })

  it('drops the "at least" once the catalog fits inside the window', () => {
    // The one collection size where a `length >= ceiling` comparison is wrong:
    // exactly the ceiling, where nothing is missing and the probe finds none.
    const full = byCollection['products']
    byCollection['products'] = productDocs.slice(0, PRODUCT_CEILING)
    try {
      mountCatalog()
      for (const text of textsMatching(/products$/)) {
        expect(text).not.toContain('at least')
      }
    } finally {
      byCollection['products'] = full
    }
  })
})
