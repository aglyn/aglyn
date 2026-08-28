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
 * A MERCHANT CAN SEE RESERVED STOCK (AGL-2356).
 *
 * The hold deliberately does not move `inventory` — the shelf count means
 * units on the shelf, and the low-stock alert, the restock queue,
 * `reconcile-stock.ts` and this very table all read it that way. The price of
 * that decision is a gap the merchant meets directly: the storefront can refuse
 * a sale of the third unit while this column says `3`. The number is right and
 * the behaviour looks broken, and there is nowhere in the console to find out
 * why.
 *
 * So the capability is not the feature. This is the half that makes a hold
 * something a merchant can reason about instead of a discrepancy they have to
 * discover, and it is checked here rather than assumed from the model helper —
 * the helper being correct says nothing about whether the column calls it.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read. The storefront
 * side of this issue cannot be driven from a developer machine at all: the
 * local console runs against the LIVE secret key, so a real buy-now would open
 * a real Checkout Session on the real account. The reservation itself is proved
 * against an in-memory Firestore in `server/stock-hold-race.spec.ts`.
 */

import { render, screen, waitFor } from '@testing-library/react'

import type { ReactNode } from 'react'

const ORG_PLAN = { org: { $id: 'org-1', plan: 'pro' }, ready: true }

const LIVE = Date.now() + 20 * 60 * 1000
const LAPSED = Date.now() - 60 * 1000

/**
 * Four products, and every figure distinct so an assertion that lands on the
 * right number cannot have reached for the nearest one:
 *
 *  - `held` — 7 on the shelf, 2 reserved by one live checkout.
 *  - `two-carts` — 9 on the shelf, 1 + 3 reserved by two separate checkouts,
 *    which is the case a per-product total has to SUM rather than report the
 *    largest of.
 *  - `lapsed` — 5 on the shelf and a reservation that expired. Naming it would
 *    be worse than saying nothing: the merchant would be told stock is spoken
 *    for while the storefront happily sells it.
 *  - `plain` — 4 on the shelf and no reservations, which is every product in
 *    almost every catalog. The column must read exactly as it did before.
 */
const collections: Record<string, Array<Record<string, unknown>>> = {
  products: [
    {
      $id: 'p-held',
      name: 'Walnut desk',
      slug: 'walnut-desk',
      status: 'active',
      type: 'physical',
      oversellPolicy: 'deny',
      variants: [{ id: 'oak', priceUsd: 83, inventory: 7 }],
      stockHolds: {
        'checkout-1': { expiresAtMs: LIVE, units: { oak: 2 } },
      },
    },
    {
      $id: 'p-two-carts',
      name: 'Oak stool',
      slug: 'oak-stool',
      status: 'active',
      type: 'physical',
      oversellPolicy: 'deny',
      variants: [{ id: 'ash', priceUsd: 41, inventory: 9 }],
      stockHolds: {
        'checkout-2': { expiresAtMs: LIVE, units: { ash: 1 } },
        'checkout-3': { expiresAtMs: LIVE, units: { ash: 3 } },
      },
    },
    {
      $id: 'p-lapsed',
      name: 'Brass lamp',
      slug: 'brass-lamp',
      status: 'active',
      type: 'physical',
      oversellPolicy: 'deny',
      variants: [{ id: 'std', priceUsd: 26, inventory: 5 }],
      stockHolds: {
        'checkout-4': { expiresAtMs: LAPSED, units: { std: 4 } },
      },
    },
    {
      $id: 'p-plain',
      name: 'Cork mat',
      slug: 'cork-mat',
      status: 'active',
      type: 'physical',
      variants: [{ id: 'std', priceUsd: 12, inventory: 4 }],
    },
  ],
  locations: [],
  licenseKeys: [],
}

const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  /*
   * The real translator, not a stub. It is a pure function of the shared
   * declaration, and a mock that omits a barrel export does not fail as
   * "missing" — it fails as the component being broken.
   */
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance')
    .listFilterConstraints,
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgPlan: () => ORG_PLAN,
  useHostResourceApi: () => jest.fn(),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  query: (name: string) => name,
  limit: (value: number) => value,
  doc: () => ({}),
  getCountFromServer: async () => ({ data: () => ({ count: 4 }) }),
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
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

/** The Stock cell for one product row, as the merchant reads it. */
const stockCellFor = async (name: string): Promise<string> => {
  const row = (await screen.findByText(name)).closest('tr') as HTMLElement
  // The Stock column, counting from the row's own cells rather than a global
  // index, so an added column elsewhere does not silently move this assertion
  // onto a different number.
  const cells = [...row.querySelectorAll('td')]
  return cells[4]?.textContent ?? ''
}

describe('reserved stock is visible where inventory is managed (AGL-2356)', () => {
  it('names the units a live checkout is holding, beside the shelf count', async () => {
    render(<ProductsHubCard hostId="host-1" />)
    await waitFor(async () =>
      expect(await stockCellFor('Walnut desk')).toBe('7 (2 reserved)'),
    )
  })

  it('SUMS two checkouts holding the same product', async () => {
    render(<ProductsHubCard hostId="host-1" />)
    // 1 + 3, not 3: reporting the largest hold would understate what is
    // actually spoken for, which is the number the merchant needs.
    await waitFor(async () =>
      expect(await stockCellFor('Oak stool')).toBe('9 (4 reserved)'),
    )
  })

  it('says NOTHING about a reservation that has lapsed', async () => {
    render(<ProductsHubCard hostId="host-1" />)
    // A lapsed hold releases without anybody writing anything, so a caption
    // driven off the stored map alone would tell the merchant stock is held
    // while the storefront is selling it.
    await waitFor(async () =>
      expect(await stockCellFor('Brass lamp')).toBe('5'),
    )
  })

  it('leaves an ordinary product reading exactly as it did before', async () => {
    render(<ProductsHubCard hostId="host-1" />)
    await waitFor(async () => expect(await stockCellFor('Cork mat')).toBe('4'))
  })
})
