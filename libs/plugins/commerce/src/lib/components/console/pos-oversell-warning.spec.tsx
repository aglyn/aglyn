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
 * The register says the shelf is short, and sells anyway (AGL-2357).
 *
 * The register ignored `oversellPolicy` entirely — `pos-order.ts` carried no
 * `canPurchase` call — so a merchant who chose "deny" in the product editor
 * silently got "backorder" at the counter. the decision: warn, never block.
 *
 * ## What these tests are built to catch
 *
 * A test asserting only that the warning appears passes just as happily
 * against a register that REFUSES the sale. So every case that expects a
 * warning also asserts that the settle buttons are live and that pressing one
 * still puts the sale through the order API — the two halves of "warn, never
 * block" are separate assertions, not one.
 *
 * Harness copied from `pos-card-qr-local.spec.tsx`: `fetch` is mocked at
 * `/api/commerce/pos-order`, which is the only boundary this crosses.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Tracked, `deny`, one on the shelf — the product editor's default policy. */
const SHORT_PRODUCT = {
  $id: 'prod-1',
  name: 'Flat White',
  status: 'active',
  oversellPolicy: 'deny',
  variants: [{ id: 'v1', priceUsd: 4.5, inventory: 1, options: {} }],
}
/** The same product, stocked. The control every warning case needs. */
const STOCKED_PRODUCT = {
  ...SHORT_PRODUCT,
  $id: 'prod-2',
  name: 'Croissant',
  variants: [{ id: 'v2', priceUsd: 3, inventory: 40, options: {} }],
}
/** A merchant who CHOSE to sell past zero. */
const BACKORDER_PRODUCT = {
  ...SHORT_PRODUCT,
  $id: 'prod-3',
  name: 'Cold Brew',
  oversellPolicy: 'backorder',
  variants: [{ id: 'v3', priceUsd: 5, inventory: 0, options: {} }],
}
/** Stock tracking switched off — no number to be short against. */
const UNTRACKED_PRODUCT = {
  ...SHORT_PRODUCT,
  $id: 'prod-4',
  name: 'Filter Coffee',
  variants: [{ id: 'v4', priceUsd: 2.5, inventory: null, options: {} }],
}

const REGISTER = { $id: 'reg-1', name: 'Front counter' }

let requests: string[] = []
let payloads: any[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  /*
   * `query` returns the collection path unchanged so the harness can key its
   * fixtures off it. The constraint builders below therefore have to be inert
   * — they are also what the REAL `listFilterConstraints` calls, so leaving
   * one out fails as "not a function" from inside the translator rather than
   * from the component, which reads as the translator being broken.
   */
  query: (ref: string) => ref,
  limit: () => undefined,
  where: () => undefined,
  orderBy: () => undefined,
  startAt: () => undefined,
  endAt: () => undefined,
  documentId: () => '__name__',
  Timestamp: { fromDate: (date: Date) => date },
  // The scan path. Empty is the honest answer for a catalog these specs
  // never populate; a scan that found something here would be fiction.
  getDocs: async () => ({ docs: [] }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  /*
   * The real translator, not a stub. It is a pure function of the shared
   * declaration, and a mock that omits a barrel export does not fail as
   * "missing" — it fails as the component being broken.
   */
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance')
    .listFilterConstraints,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useOrgPlan: () => ({ org: { plan: 'business' }, ready: true }),
  useFirestoreCollection: (build: () => string) => {
    const path = build()
    if (path.endsWith('/products')) {
      return {
        data: [
          SHORT_PRODUCT,
          STOCKED_PRODUCT,
          BACKORDER_PRODUCT,
          UNTRACKED_PRODUCT,
        ],
      }
    }
    if (path.endsWith('/registers')) return { data: [REGISTER] }
    return { data: [] }
  },
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

import { PosConsolePage } from './pos-page.component'

beforeEach(() => {
  requests = []
  payloads = []
  global.fetch = jest.fn(async (input: any, init?: any) => {
    requests.push(String(input))
    payloads.push(init?.body ? JSON.parse(String(init.body)) : null)
    return {
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
    }
  }) as unknown as typeof fetch
})

/** The settle control the cashier reaches for, as the DOM button element. */
function settleButton(label: string): HTMLButtonElement {
  return screen.getByText(label).closest('button') as HTMLButtonElement
}

describe('the register warns about a shortfall (AGL-2357)', () => {
  /**
   * THE DEFECT. One on the shelf, two in the basket, `deny` set — and until
   * this shipped the counter said nothing at all.
   */
  it('names the count and the quantity once the basket passes the shelf', () => {
    render(<PosConsolePage hostId="host-1" entitled />)

    // One unit: covered, and the register must stay quiet.
    fireEvent.click(screen.getByText('Flat White'))
    expect(screen.queryByText(/in stock/)).toBeNull()

    // Two: short by one, and now it says so.
    fireEvent.click(screen.getByText('Flat White'))
    expect(screen.getByText('Only 1 in stock — selling 2')).toBeTruthy()
  })

  /**
   * THE OTHER HALF, and the one that tells this apart from a refusal. A test
   * that stopped at the warning above would pass against a register that had
   * disabled the till.
   */
  it('leaves every settle control live while it warns', () => {
    render(<PosConsolePage hostId="host-1" entitled />)
    fireEvent.click(screen.getByText('Flat White'))
    fireEvent.click(screen.getByText('Flat White'))

    expect(screen.getByText('Only 1 in stock — selling 2')).toBeTruthy()
    expect(settleButton('Cash').disabled).toBe(false)
    expect(settleButton('Card (QR)').disabled).toBe(false)
  })

  /** And pressing one really does put the sale through. */
  it('still completes the sale the shelf cannot cover', async () => {
    render(<PosConsolePage hostId="host-1" entitled />)
    fireEvent.click(screen.getByText('Flat White'))
    fireEvent.click(screen.getByText('Flat White'))
    fireEvent.click(screen.getByText('Card (QR)'))

    await waitFor(() =>
      expect(screen.getByText('Customer pays by card')).toBeTruthy(),
    )
    expect(requests).toEqual(['/api/commerce/pos-order'])
    expect(payloads[0].lines).toEqual([
      expect.objectContaining({
        productId: 'prod-1',
        variantId: 'v1',
        quantity: 2,
      }),
    ])
  })

  it('says nothing about a product the shelf covers', () => {
    render(<PosConsolePage hostId="host-1" entitled />)
    fireEvent.click(screen.getByText('Croissant'))
    fireEvent.click(screen.getByText('Croissant'))

    expect(screen.queryByText(/in stock/)).toBeNull()
  })

  /**
   * A `backorder` merchant chose to sell past zero. Warning them would be
   * noise about a setting they set on purpose — and it is the deny promise,
   * not the count, that the register was breaking.
   */
  it('says nothing on a backorder product at zero', () => {
    render(<PosConsolePage hostId="host-1" entitled />)
    fireEvent.click(screen.getByText('Cold Brew'))
    fireEvent.click(screen.getByText('Cold Brew'))

    expect(screen.queryByText(/in stock/)).toBeNull()
  })

  it('says nothing about an untracked variant', () => {
    render(<PosConsolePage hostId="host-1" entitled />)
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(screen.getByText('Filter Coffee'))
    }

    expect(screen.queryByText(/in stock/)).toBeNull()
  })

  /** Warns about the short line and leaves the covered one alone. */
  it('warns per line, not per basket', () => {
    render(<PosConsolePage hostId="host-1" entitled />)
    fireEvent.click(screen.getByText('Flat White'))
    fireEvent.click(screen.getByText('Flat White'))
    fireEvent.click(screen.getByText('Croissant'))

    expect(screen.getAllByText(/in stock/)).toHaveLength(1)
    expect(screen.getByText('Only 1 in stock — selling 2')).toBeTruthy()
  })

  /** Removing the surplus retires the warning — it tracks the basket. */
  it('stops warning once the line is back within the count', () => {
    render(<PosConsolePage hostId="host-1" entitled />)
    fireEvent.click(screen.getByText('Flat White'))
    fireEvent.click(screen.getByText('Flat White'))
    expect(screen.getByText('Only 1 in stock — selling 2')).toBeTruthy()

    fireEvent.click(screen.getByText('✕'))
    expect(screen.queryByText(/in stock/)).toBeNull()
  })
})
