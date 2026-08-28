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
 * The products table gets a footer, and its header stops counting the rows in
 * hand (AGL-693).
 *
 * Two things, and the second is the one that keeps recurring across this
 * sweep: A COUNT BESIDE A LIST WAS THE LENGTH OF THE LIST. The card's header
 * read `Products (${products.length})` — the filtered, ceilinged view — so a
 * merchant with 3,000 products was told they had 500, and once the table paged
 * they would have been told 10. The quota readout beside it already asked the
 * server (AGL-1716); the header did not, one line away.
 *
 * ## Why the READ is not paged
 *
 * Three other things on this card consume the same window and every one of
 * them needs it whole: the CSV export writes these rows, the importer builds
 * `existingSlugs` from them to refuse a duplicate slug, and the reserved-stock
 * clock arms off them. A ten-row page would silently export ten products and
 * stop the importer seeing the clash it exists to prevent. So the footer pages
 * what the card holds, and the ceiling keeps bounding what it reads.
 */

import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

jest.setTimeout(30_000)

const ORG_PLAN = { org: { $id: 'org-1', plan: 'pro' }, ready: true }

/** What the server says the site has — unlike either number the card holds. */
const SERVER_PRODUCTS = 3_000
/** What the listener hands back. Smaller than the ceiling, so no truncation. */
const LOADED_PRODUCTS = 60

const productDocs = Array.from({ length: LOADED_PRODUCTS }, (_, index) => ({
  $id: `prod-${index}`,
  name: `Product ${String(index).padStart(4, '0')}`,
  slug: `product-${index}`,
  status: 'active',
  // Digital, so the license-key dialog is reachable from the first row.
  type: 'digital',
  variants: [{ id: 'v1', priceUsd: 10, inventory: 1 }],
}))

/**
 * License keys for TWO products.
 *
 * The old read was `limit(500)` over the whole collection with the product
 * filtered out in the browser, so the pool count was a count of whatever the
 * site-wide window held. Keys for `prod-1` outnumber those for `prod-0` here,
 * and the assertion is that the dialog for `prod-0` asks for `prod-0`.
 */
const keyDocs = [
  ...Array.from({ length: 3 }, (_, index) => ({
    $id: `key-a-${index}`,
    productId: 'prod-0',
    key: `AAAA-${index}`,
  })),
  ...Array.from({ length: 40 }, (_, index) => ({
    $id: `key-b-${index}`,
    productId: 'prod-1',
    key: `BBBB-${index}`,
  })),
]

const collections: Record<string, Array<Record<string, unknown>>> = {
  products: productDocs,
  locations: [],
  licenseKeys: keyDocs,
}

/** Every query the card built, so a read's SHAPE can be asserted. */
let mockQueries: Array<{ name: string; constraints: any[] }> = []

const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance')
    .listFilterConstraints,
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (!built) return { data: [], status: 'success', fromCache: false }
    mockQueries.push(built)
    const equality = built.constraints.find((item: any) => item?.field)
    const rows = collections[built.name] ?? []
    return {
      // The equality is EVALUATED rather than recorded, so a card that went
      // back to filtering in the browser is handed the whole collection and
      // its counts change.
      data: equality
        ? rows.filter((row: any) => row[equality.field] === equality.value)
        : rows,
      status: 'success',
      fromCache: false,
    }
  },
  useOrgPlan: () => ORG_PLAN,
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'prod-new' }),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => ({
    name,
    constraints: [],
  }),
  query: (base: any, ...constraints: any[]) => ({
    name: base?.name ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  doc: () => ({}),
  getCountFromServer: async () => {
    // A server aggregate is a network round-trip: it cannot land in the same
    // microtask drain as the mount that asked for it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { data: () => ({ count: SERVER_PRODUCTS }) }
  },
  addDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  getDoc: jest.fn().mockResolvedValue({ get: () => undefined }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <div>
      <h2>{header}</h2>
      {children}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock(
  '@aglyn/shared-ui-next/contexts/next-page-title-provider',
  () => ({ NextPageTitle: () => null }),
  { virtual: true },
)

import ProductsHubCard from './products-hub-card.component'

beforeEach(() => {
  mockQueries = []
})

const mount = async () => {
  render(<ProductsHubCard hostId="host-1" />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const countLine = () =>
  document.querySelector('.MuiTablePagination-displayedRows')?.textContent ?? ''

describe('the products table pages, and its header counts the catalog', () => {
  it('THE CONTROL: three different numbers are in play', async () => {
    // The whole point of the fixture. If the page size, the loaded window and
    // the server count coincided, a header reading any of them would look
    // correct and this file could not tell them apart.
    expect(TABLE_PAGE_SIZE_DEFAULT).not.toBe(LOADED_PRODUCTS)
    expect(LOADED_PRODUCTS).not.toBe(SERVER_PRODUCTS)
  })

  it('renders one page, not the whole window', async () => {
    await mount()
    expect(document.querySelectorAll('tbody tr')).toHaveLength(
      TABLE_PAGE_SIZE_DEFAULT,
    )
  })

  it('the header counts the SITE, not the page or the window', async () => {
    await mount()
    // The defect this sweep keeps turning up. `(60)` would be the window and
    // `(10)` the page; neither is how many products the site has.
    await waitFor(() =>
      expect(screen.getByText(`Products (${SERVER_PRODUCTS})`)).toBeTruthy(),
    )
    expect(screen.queryByText(`Products (${LOADED_PRODUCTS})`)).toBeNull()
    expect(
      screen.queryByText(`Products (${TABLE_PAGE_SIZE_DEFAULT})`),
    ).toBeNull()
  })

  it('the footer counts the ROWS THE CARD HOLDS, which the export writes', async () => {
    await mount()
    // Not the catalog: the export, the slug check and the clock all read this
    // window, and the count line is the one place the reader is told how big
    // it is. A footer that claimed 3,000 would be describing rows the card
    // does not have.
    expect(countLine()).toContain(`of ${LOADED_PRODUCTS}`)
  })

  it('paging reaches a product past the first page', async () => {
    await mount()
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() =>
      expect(screen.getByText('Product 0010')).toBeTruthy(),
    )
    expect(document.querySelectorAll('tbody tr')).toHaveLength(
      TABLE_PAGE_SIZE_DEFAULT,
    )
  })

  it('a FILTERED header carries no number at all', async () => {
    await mount()
    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'Product 0003' },
    })
    // Under a filter the aggregate counts the whole catalog and the view
    // counts matches, so neither describes what the reader is looking at.
    // The footer's own count line answers it instead.
    await waitFor(() => expect(screen.getByText('Products')).toBeTruthy())
    expect(screen.queryByText(`Products (${SERVER_PRODUCTS})`)).toBeNull()
  })
})

/**
 * The license-key pool is asked FOR THE PRODUCT, and ordered (AGL-693).
 *
 * The read was `limit(500)` over the site's whole `licenseKeys` collection
 * with no `orderBy`, filtered by `productId` in the browser — so on a store
 * past five hundred keys the "N available" line counted whatever the
 * site-wide, hash-ordered window happened to hold. A product whose keys all
 * hashed high showed a pool of zero while the storefront went on delivering
 * them.
 */
describe('the license-key pool is a per-product read (AGL-693)', () => {
  const openKeys = async () => {
    await mount()
    fireEvent.click(screen.getAllByRole('button', { name: 'Keys' })[0])
    await waitFor(() =>
      expect(screen.getByText(/available ·/)).toBeTruthy(),
    )
  }

  it('THE CONTROL: the fixture holds keys for a DIFFERENT product too', () => {
    // Otherwise a read that still asked for the whole collection would return
    // the same three keys and the count below would look correct.
    const others = keyDocs.filter((key) => key.productId !== 'prod-0')
    expect(others.length).toBeGreaterThan(0)
    expect(others.length).toBeGreaterThan(
      keyDocs.filter((key) => key.productId === 'prod-0').length,
    )
  })

  it('asks for this product’s keys, in document-name order', async () => {
    await openKeys()
    const keysRead = mockQueries.filter((built) => built.name === 'licenseKeys')
    expect(keysRead.length).toBeGreaterThan(0)
    const latest = keysRead.at(-1)!
    expect(latest.constraints).toContainEqual({
      field: 'productId',
      op: '==',
      value: 'prod-0',
    })
    // Ordered on the document NAME, which cannot be absent — every candidate
    // field here (`createdAtMs`, `assignedAtMs`, `revokedAtMs`) is optional,
    // and two of them are absent on exactly the keys the counts are about.
    expect(latest.constraints).toContainEqual({
      orderBy: '__name__',
      direction: undefined,
    })
    expect(latest.constraints).not.toContainEqual({ orderBy: 'createdAtMs' })
  })

  it('counts THIS product’s pool, not the store’s', async () => {
    await openKeys()
    // Three, not forty-three. A site-wide window would have counted `prod-1`'s
    // keys into `prod-0`'s pool the moment the browser-side filter was
    // removed — which is why the double evaluates the equality rather than
    // merely recording it.
    expect(screen.getByText(/^3 available · 0 assigned/)).toBeTruthy()
  })
})
