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
 * The till's product grid and its scan are the products QUERY (AGL-3321).
 *
 * The grid read five hundred products, and deletion was dropped over the rows
 * it held; the scan lookup refused a hit that turned out to be deleted even
 * when a live product carried the same code. Every narrowing is now on the
 * query — `deletedAt == null`, `status == active`, the typed word on
 * `nameTokens`, the scanned code on `barcodes` / `skus` — through the products
 * hub's own declaration, so each shape rides the hub's composites.
 *
 * The Firestore double below answers each query the way Firestore would
 * (`rowAnswers` from the contract's double), over a catalog longer than the
 * grid's window, so a product past the window is found only if the search
 * really is on the query.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  PRODUCT_LIST_INDEX_BASE,
  PRODUCT_LIST_QUERY,
} from '../../constants/product-list-query'

type Row = Record<string, unknown> & { $id: string }
interface Asked {
  path: string
  constraints: Array<Record<string, unknown>>
}

/** Past the grid's five hundred, in name order, whatever the window holds. */
const mockCatalog: Row[] = [
  ...Array.from({ length: 520 }, (_, index) => {
    const name = `Item ${String(index).padStart(4, '0')}`
    return {
      $id: `prod-${index}`,
      name,
      nameLower: name.toLowerCase(),
      nameTokens: ['item', String(index).padStart(4, '0')],
      status: 'active',
      deletedAt: null,
      skus: [],
      barcodes: [],
      variants: [{ id: 'v1', priceUsd: 2, inventory: 5, options: {} }],
    }
  }),
  {
    $id: 'prod-zebra',
    name: 'Zebra Latte',
    nameLower: 'zebra latte',
    nameTokens: ['z', 'ze', 'zeb', 'zebr', 'zebra', 'l', 'la', 'lat', 'latt', 'latte'],
    status: 'active',
    deletedAt: null,
    skus: ['zl-1'],
    barcodes: ['0123456789012'],
    variants: [{ id: 'v1', priceUsd: 5, inventory: 5, options: {} }],
  },
  // A deleted product carrying the same barcode, which sorts FIRST: the scan
  // used to take it, refuse it, and report no match.
  {
    $id: 'prod-deleted',
    name: 'Aardvark (deleted)',
    nameLower: 'aardvark (deleted)',
    nameTokens: ['zebra'],
    status: 'active',
    deletedAt: { seconds: 1 },
    skus: [],
    barcodes: ['0123456789012'],
    variants: [{ id: 'v1', priceUsd: 1, inventory: 5, options: {} }],
  },
  {
    $id: 'prod-archived',
    name: 'Zebra Mocha',
    nameLower: 'zebra mocha',
    nameTokens: ['zebra', 'mocha'],
    status: 'archived',
    deletedAt: null,
    skus: [],
    barcodes: [],
    variants: [{ id: 'v1', priceUsd: 1, inventory: 5, options: {} }],
  },
]

function mockAnswer(asked: Asked): Row[] {
  const { rowAnswers } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  if (!asked.path.endsWith('/products')) return []
  let rows = mockCatalog.filter((row) =>
    asked.constraints.every((entry) => entry.kind !== 'where' || rowAnswers(row, entry)),
  )
  const order = asked.constraints.find((entry) => entry.kind === 'orderBy')
  if (order) {
    const path = String(order.path)
    rows = [...rows].sort((a, b) => String(a[path]).localeCompare(String(b[path])))
  }
  const cap = asked.constraints.find((entry) => entry.kind === 'limit')
  return cap ? rows.slice(0, Number(cap.value)) : rows
}

// The register's operations (AGL-3609) have specs of their own; this one
// reads the page around them.
jest.mock('./pos-ops/register-ops', () => ({
  PosOperationsBar: () => null,
  PosCustomerLookup: () => null,
  PosLastReceipt: () => null,
  usePosOpsSettings: () => ({
    requireOpenShift: false,
    refundLimitCents: 0,
    autoLockMinutes: 0,
    receiptAddress: '',
    returnPolicy: '',
  }),
  usePosCashier: () => ({
    cashier: null,
    assertion: undefined,
    locked: false,
    switchTo: () => undefined,
    signOutCashier: () => undefined,
    lock: () => undefined,
    unlock: () => undefined,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/'), constraints: [] }),
  query: (base: Asked, ...constraints: Array<Record<string, unknown>>) => ({
    path: base.path,
    constraints: [...base.constraints, ...constraints],
  }),
  where: (path: string, op: string, value: unknown) => ({ kind: 'where', path, op, value }),
  orderBy: (path: string, direction = 'asc') => ({ kind: 'orderBy', path, direction }),
  limit: (value: number) => ({ kind: 'limit', value }),
  documentId: () => '__name__',
  Timestamp: { fromDate: (date: Date) => date },
  getDocs: async (asked: Asked) => ({
    docs: mockAnswer(asked).map((row) => ({ id: row.$id, data: () => row })),
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useOrgPlan: () => ({ org: { plan: 'business' }, ready: true }),
  useFirestoreCollection: (build: () => Asked) => ({ data: mockAnswer(build()) }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-next/contexts/next-page-title-provider', () => ({
  NextPageTitle: () => null,
}))
jest.mock('@aglyn/aglyn', () => ({
  checkHostRegisterQuota: () => ({ limit: 5 }),
  checkQuota: () => ({ limit: 5 }),
}))

import { PosConsolePage, posProductPlan } from './pos-page.component'

const search = () => screen.getByPlaceholderText('Search or scan barcode…')

describe('the till asks the products query (AGL-3321)', () => {
  it('THE CONTROL: the product searched for is past the grid’s window', () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    expect(screen.getByText('Item 0000')).toBeTruthy()
    expect(screen.queryByText('Zebra Latte')).toBeNull()
  })

  it('finds a product by name past the window, and never an archived or deleted one', () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    fireEvent.change(search(), { target: { value: 'zebra' } })
    expect(screen.getByText('Zebra Latte')).toBeTruthy()
    expect(screen.queryByText('Zebra Mocha')).toBeNull()
    expect(screen.queryByText('Aardvark (deleted)')).toBeNull()
  })

  it('scans a code to the LIVE product, even where a deleted one shares it', async () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    fireEvent.change(search(), { target: { value: '0123456789012' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    // Added to the cart: the search box clears on a hit.
    await waitFor(() => expect((search() as HTMLInputElement).value).toBe(''))
  })

  it('takes a keyboard-mode scanner’s code with focus off the search box (AGL-3619)', async () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    expect(screen.queryByText(/Zebra Latte/)).toBeNull()
    const button = screen.getAllByRole('button')[0]
    // A scanner's pace, whatever the test machine's: 5 ms a key.
    let clock = Date.now()
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 5))
    for (const key of [...'0123456789012', 'Enter']) fireEvent.keyDown(button, { key })
    now.mockRestore()
    // Past the grid's window, so on screen only once it is in the basket.
    expect(await screen.findByText(/1× Zebra Latte/)).toBeTruthy()
  })

  it('offers the camera beside the search box (AGL-3619)', () => {
    render(<PosConsolePage hostId="host-1" {...({} as any)} />)
    expect(screen.getByRole('button', { name: 'Scan a barcode with the camera' })).toBeTruthy()
  })

  it('asks the hub’s scope, status and search in one plan', () => {
    expect(posProductPlan({ search: 'zebra' }).filters).toEqual([
      { path: 'deletedAt', op: '==', value: null },
      { path: 'nameTokens', op: 'array-contains', value: 'zebra' },
      { path: 'status', op: '==', value: 'active' },
    ])
    expect(
      posProductPlan({ code: { field: 'barcodes', value: '0123456789012' } }).filters,
    ).toEqual([
      { path: 'deletedAt', op: '==', value: null },
      { path: 'status', op: '==', value: 'active' },
      { path: 'barcodes', op: 'array-contains', value: '0123456789012' },
    ])
  })
})

describe('every shape the till asks has its index (AGL-3321)', () => {
  it('rides the products hub’s composites', () => {
    const indexFile = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../../cloud/firebase-firestore.indexes.json'),
        'utf8',
      ),
    )
    const hub = listQueryIndexes(PRODUCT_LIST_QUERY, PRODUCT_LIST_INDEX_BASE)
    const used = new Set(['deletedAt', 'status', 'nameTokens', 'barcodes', 'skus'])
    const needed = hub.filter((index) => used.has(index.fields[0].fieldPath))
    expect(needed).toHaveLength(used.size)
    expect(missingListQueryIndexes(indexFile, 'products', needed)).toEqual([])
  })
})
