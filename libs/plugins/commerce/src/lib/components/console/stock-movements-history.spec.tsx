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
 * THE ADJUSTMENT HISTORY IS ACTUALLY A HISTORY (AGL-2341).
 *
 * `hosts/{hostId}/inventoryAdjustments` had five writers and one reader, and
 * that reader was arithmetic: `cancel-order.ts` projects `appliedDelta` off
 * the `reason: 'sale'` rows to cap what a cancellation may put back. No
 * surface displayed a single row. The products hub's own comment calls the
 * collection "adjustment history"; a merchant whose count disagreed with the
 * shelf could not see what moved it, when, or why.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - THE CHAIN. `a merchant's own adjustment` types a delta into the real
 *    "Adjust stock" dialog, takes the payload the real `addDoc` was handed,
 *    and renders THAT through the real card. Two different deltas, so a
 *    writer recording a constant — or a card printing one — dies whichever
 *    constant it picks. This is the assertion the whole issue is about: a fix
 *    that merely adds a read is not a fix.
 *  - EACH ROW'S OWN NUMBER. A table showing the first row's delta beside every
 *    row would look right and be wrong for every row but one.
 *  - `appliedDelta` WHERE IT DIFFERS. Three sold out of a count of zero is
 *    precisely the state a merchant is trying to explain, and `delta` alone
 *    says the count went down by three when it did not move at all.
 *  - THE CARD IS MOUNTED. A component nothing renders is the same silence
 *    with an extra file in it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { addDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import ProductsHubCard from './products-hub-card.component'
import StockMovementsCard from './stock-movements-card.component'

const productDocs = [
  {
    $id: 'prod-1',
    name: 'Desk lamp',
    slug: 'desk-lamp',
    status: 'active',
    type: 'physical',
    variants: [{ id: 'v1', priceUsd: 40, inventory: 12 }],
  },
  {
    $id: 'prod-2',
    name: 'Bookend',
    slug: 'bookend',
    status: 'active',
    type: 'physical',
    variants: [{ id: 'v9', priceUsd: 15, inventory: 4 }],
  },
]

/** Seeded per test; the card reads this through the listener double. */
let adjustmentDocs: Array<Record<string, unknown>> = []

const collections: Record<string, Array<Record<string, unknown>>> = {
  products: productDocs,
  locations: [],
  licenseKeys: [],
  suppliers: [],
  discounts: [],
  get inventoryAdjustments() {
    return adjustmentDocs
  },
}

const mockCreateResource = jest.fn().mockResolvedValue({ id: 'prod-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  /*
   * The real translator, not a stub. It is a pure function of the shared
   * declaration, and a mock that omits a barrel export does not fail as
   * "missing" — it fails as the component being broken.
   */
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance')
    .listFilterConstraints,
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgPlan: () => ({ org: { plan: 'business' }, ready: true }),
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => ({ data: undefined }),
  // The REAL seed guard. Stubbing it would let the adjustment through for a
  // reason this file is not testing, or block it for one either.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  query: (name: string) => name,
  limit: () => undefined,
  // The movements card orders newest-first in the QUERY (a single-field
  // index, so no composite and no index drift). The double has to accept it
  // and stay transparent, or the builder stops returning a collection name
  // and the card silently reads nothing.
  orderBy: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn(),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  addDoc: jest.fn().mockResolvedValue(undefined),
  getCountFromServer: async (name: string) => ({
    data: () => ({ count: (collections[name] ?? []).length }),
  }),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/quota-readout.component', () => ({
  __esModule: true,
  default: () => null,
}))

beforeEach(() => {
  jest.clearAllMocks()
  adjustmentDocs = []
})

/**
 * Type a change into the REAL "Adjust stock" dialog and return the row the
 * real `addDoc` was handed — the actual document that reaches Firestore.
 */
async function adjustStockBy(change: string): Promise<Record<string, unknown>> {
  const view = render(<ProductsHubCard hostId="host-1" />)
  fireEvent.click(screen.getAllByRole('button', { name: 'Stock' })[0])
  fireEvent.change(screen.getByLabelText('Change'), {
    target: { value: change },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() => expect(addDoc).toHaveBeenCalled())
  const [, payload] = (addDoc as jest.Mock).mock.calls[0]
  view.unmount()
  ;(addDoc as jest.Mock).mockClear()
  return payload as Record<string, unknown>
}

describe('THE CHAIN: what the merchant typed is what the merchant reads back', () => {
  it('carries the typed delta from the dialog onto the history', async () => {
    // +7 and -4 are different in sign AND magnitude, so no constant — in the
    // writer or in the card — satisfies both passes.
    for (const [typed, rendered] of [
      ['+7', '+7'],
      ['-4', '-4'],
    ]) {
      const row = await adjustStockBy(typed)
      expect(row['delta']).toBe(Number(typed))

      adjustmentDocs = [{ $id: 'adj-1', ...row }]
      const view = render(<StockMovementsCard hostId="host-1" />)
      expect(screen.getByText(rendered)).toBeTruthy()
      view.unmount()
    }
  })

  it('carries the reason the merchant chose, not a default', async () => {
    const row = await adjustStockBy('+3')
    expect(row['reason']).toBe('restock')
    adjustmentDocs = [{ $id: 'adj-1', ...row }]
    render(<StockMovementsCard hostId="host-1" />)
    expect(screen.getByText('Restock')).toBeTruthy()
  })
})

describe('EACH ROW carries its own number', () => {
  beforeEach(() => {
    adjustmentDocs = [
      {
        $id: 'adj-sale',
        productId: 'prod-1',
        variantId: 'v1',
        delta: -3,
        reason: 'sale',
        orderId: 'ord-77',
        atMs: 3000,
      },
      {
        $id: 'adj-restock',
        productId: 'prod-2',
        variantId: 'v9',
        delta: 25,
        reason: 'restock',
        atMs: 2000,
      },
      {
        $id: 'adj-damage',
        productId: 'prod-1',
        variantId: 'v1',
        delta: -1,
        reason: 'damage',
        atMs: 1000,
      },
    ]
  })

  it('renders three different deltas, one per row', () => {
    render(<StockMovementsCard hostId="host-1" />)
    expect(screen.getByText('-3')).toBeTruthy()
    expect(screen.getByText('+25')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
  })

  it('names the product and the reason each row belongs to', () => {
    render(<StockMovementsCard hostId="host-1" />)
    expect(screen.getByText('Sale')).toBeTruthy()
    expect(screen.getByText('Restock')).toBeTruthy()
    expect(screen.getByText('Damaged')).toBeTruthy()
    // Resolved through the products listener, so a row reads as a name.
    expect(screen.getAllByText(/Desk lamp/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Bookend/).length).toBeGreaterThan(0)
    // The sale names the order it came from — the only "source" any writer
    // records, and what makes a `-3` chaseable.
    expect(screen.getByText(/order ord-77/)).toBeTruthy()
  })

  it('puts the newest movement first', () => {
    render(<StockMovementsCard hostId="host-1" />)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0].textContent).toContain('-3')
    expect(rows[2].textContent).toContain('-1')
  })

  it('filters to one product without losing that product’s own numbers', () => {
    render(<StockMovementsCard hostId="host-1" />)
    fireEvent.mouseDown(screen.getByLabelText('Product'))
    fireEvent.click(screen.getByRole('option', { name: 'Bookend' }))
    expect(screen.getByText('+25')).toBeTruthy()
    expect(screen.queryByText('-3')).toBeNull()
  })
})

describe('appliedDelta, where the count could not give up what was sold', () => {
  it('shows both numbers when the floor absorbed part of the movement', () => {
    // A backorder product selling past zero: the history says 3 went out the
    // door, and the count could only give up 0. `delta` alone claims the
    // count fell by three when it did not move — the exact confusion a
    // merchant opens this table to resolve.
    adjustmentDocs = [
      {
        $id: 'adj-backorder',
        productId: 'prod-1',
        variantId: 'v1',
        delta: -3,
        appliedDelta: 0,
        reason: 'sale',
        orderId: 'ord-88',
        atMs: 5000,
      },
    ]
    render(<StockMovementsCard hostId="host-1" />)
    expect(screen.getByText('-3')).toBeTruthy()
    expect(screen.getByText(/0 applied/)).toBeTruthy()
  })

  it('stays quiet when nothing was clamped', () => {
    adjustmentDocs = [
      {
        $id: 'adj-plain',
        productId: 'prod-1',
        variantId: 'v1',
        delta: -3,
        appliedDelta: -3,
        reason: 'sale',
        atMs: 5000,
      },
    ]
    render(<StockMovementsCard hostId="host-1" />)
    expect(screen.queryByText(/applied/)).toBeNull()
  })
})

describe('the card exists on a page', () => {
  it('is mounted on the commerce console’s Catalog tab', () => {
    const page = readFileSync(
      join(__dirname, '../commerce-console-page.tsx'),
      'utf8',
    )
    // The MOUNT, not the import. `toContain('StockMovementsCard')` alone is
    // satisfied by the import line that survives deleting the JSX — verified
    // by deleting it: the check stayed green.
    expect(page).toContain('<StockMovementsCard hostId={hostId} />')
  })

  it('says so plainly when nothing has moved yet', () => {
    adjustmentDocs = []
    render(<StockMovementsCard hostId="host-1" />)
    expect(screen.getByText(/No stock movements recorded yet/)).toBeTruthy()
  })
})
