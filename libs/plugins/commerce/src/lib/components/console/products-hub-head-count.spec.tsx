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
 * The products hub's catalog HEAD-COUNT is a server aggregate, not the
 * length of its capped listener (AGL-1716, the AGL-1706 shape).
 *
 * The listener is `limit(500)` — correctly; a 25,000-product catalog does
 * not belong in a table. What it must not do is answer "how many products
 * does this site have", and it did: the length saturated at 500 and fed
 * `checkQuota(org, 'productsPerHost', …)` for Add, Duplicate and the CSV
 * importer's batch check. The bands run 2,500 / 10,000 / 25,000 above that
 * window, so from Pro up the check compared 500 against thousands and could
 * never refuse — while `api/hosts/resources` counted the collection for real
 * and did. The card offered headroom that did not exist and then failed the
 * action.
 *
 * The aggregate is UNFILTERED, which also closes a second, quieter
 * disagreement: the enforcing route runs a plain
 * `collection('products').count()` for this quota (its `softDeletes` branch
 * governs only the flat per-host webhook cap), so the server has always
 * counted soft-deleted products toward `productsPerHost` while this card
 * excluded them. The card now asks the enforcing route's question in the
 * enforcing route's terms.
 *
 * Contracts:
 *
 *  1. ADD IS REFUSED over the band the window hid. Red before the fix.
 *  2. THE IMPORTER'S BATCH CHECK reads the same number. Red before.
 *  3. THE LIST KEEPS ITS CAP, and the filtered view still drives the table.
 *  4. A CREATE RE-READS THE COUNT — a one-shot goes stale exactly where the
 *     listener refreshed for free.
 *  5. AN UNANSWERED AGGREGATE DOES NOT ANSWER THE QUESTION: pending or
 *     denied it falls back to the live-row count, a lower bound and this
 *     card's prior behaviour, never to 0.
 *
 * No counting RULE moves: `checkQuota` is untouched and `report-usage`
 * meters contacts, storage and API requests, never the catalog.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ReactNode } from 'react'

/**
 * Stock `pro`: `productsPerHost: 2500`, `features.commerce` on. Real
 * `checkQuota`, real `resolveOrgEntitlements` — only the counts are staged.
 */
const ORG_PLAN = { org: { $id: 'org-1', plan: 'pro' }, ready: true }

/** What the server says the site actually has. */
const SERVER_PRODUCTS = 3_000
/** What the `limit(500)` listener can ever hand back. */
const PRODUCT_ROWS = 500

const productDocs = Array.from({ length: PRODUCT_ROWS }, (_, index) => ({
  $id: `prod-${index}`,
  name: `Product ${String(index).padStart(4, '0')}`,
  slug: `product-${index}`,
  status: 'active',
  type: 'physical',
  variants: [{ id: 'v1', priceUsd: 10, inventory: 1 }],
}))
const collections: Record<string, Array<Record<string, unknown>>> = {
  products: productDocs,
  locations: [],
  licenseKeys: [],
}

/** Mutable so a spec can choose how the aggregate resolves. */
const aggregate: { count: number | null } = { count: SERVER_PRODUCTS }

/**
 * STABLE instances, like the real hooks. `firestore` is a dependency of the
 * count effect; a `() => ({})` stub hands back a new object every render and
 * re-fires it forever.
 */
const FIRESTORE = {}
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'prod-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgPlan: () => ORG_PLAN,
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

const limitSpy = jest.fn((value: number) => value)
const countSpy = jest.fn(async (name: string) => {
  if (aggregate.count == null) {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' })
  }
  return { data: () => ({ count: aggregate.count }), name } as any
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  query: (name: string) => name,
  limit: (value: number) => limitSpy(value),
  doc: () => ({}),
  getCountFromServer: (name: string) => countSpy(name),
  addDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
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
jest.mock(
  '@aglyn/shared-ui-next/contexts/next-page-title-provider',
  () => ({ NextPageTitle: () => null }),
  { virtual: true },
)

import ProductsHubCard from './products-hub-card.component'

/**
 * These fixtures are large ON PURPOSE — the contract is about what a
 * SATURATED listener does, so the listener has to actually be saturated,
 * and 500 MUI table rows take real time to render in jsdom. Comfortably
 * under the default 5s alone; over it when the suite runs alongside the
 * rest of the project's workers. The fixture size is the contract, so the
 * budget moves rather than the fixture.
 */
jest.setTimeout(30_000)


beforeEach(() => {
  jest.clearAllMocks()
  aggregate.count = SERVER_PRODUCTS
})

const mount = () => render(<ProductsHubCard hostId="host-1" />)

/**
 * The aggregate has answered AND its answer has reached state. The call
 * count alone is not enough: it lands on mount while the resolution is
 * still a microtask, so a click issued on that signal would read the very
 * fallback these cases exist to leave behind.
 */
const settled = async () => {
  await waitFor(() => expect(countSpy).toHaveBeenCalled())
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('the products hub head-count is a server aggregate (AGL-1716)', () => {
  it('refuses Add over the band the loaded window hid', async () => {
    mount()
    await settled()

    // 3,000 products against `pro`'s included 2,500. Before the fix the
    // input was 500 — under every band from Pro up — so this opened the
    // editor and `api/hosts/resources`, which counts the collection for
    // real, refused the save afterwards.
    fireEvent.click(screen.getByText('Add product'))

    await waitFor(() =>
      expect(
        enqueueSnackbar.mock.calls.some((call) =>
          String(call[0]).includes('Your plan includes 2500 products'),
        ),
      ).toBe(true),
    )
  })

  it('refuses a duplicate over the same band', async () => {
    mount()
    await settled()

    // Duplicate is a create and consumes the same slot, so it reads the
    // same number — before the fix, the same saturated one.
    fireEvent.click(screen.getAllByText('Duplicate')[0])

    await waitFor(() =>
      expect(
        enqueueSnackbar.mock.calls.some((call) =>
          String(call[0]).includes('Your plan includes 2500 products'),
        ),
      ).toBe(true),
    )
    expect(mockCreateResource).not.toHaveBeenCalled()
  })

  it('keeps the list capped — the cap was never the defect', async () => {
    mount()
    await settled()

    // Fixing the head-count must not turn this table into a 3,000-row
    // stream. That the two questions now have two answers is the point.
    expect(limitSpy).toHaveBeenCalledWith(500)
  })

  it('reads the count once per mount, from the products collection', async () => {
    mount()
    await settled()

    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('products')
  })

  it('re-reads the count after the editor closes on a create', async () => {
    aggregate.count = 100
    mount()
    await settled()
    countSpy.mockClear()

    // Under the band now, so the editor opens; closing it is the only
    // signal the dialog gives, and without a re-read the cap would sit on
    // a pre-create number for the rest of the session.
    fireEvent.click(screen.getByText('Add product'))
    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => expect(countSpy).toHaveBeenCalledWith('products'))
  })

  it('falls back to the live rows, never to zero, when the read fails', async () => {
    aggregate.count = null
    mount()
    await settled()

    // 500 known live rows stand in — a lower bound, and this card's prior
    // behaviour. A defaulted 0 would report "no products used" on a site
    // that is over its band, which is the flattering direction again.
    fireEvent.click(screen.getByText('Add product'))

    await waitFor(() => expect(screen.queryByText('Cancel')).not.toBeNull())
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Your plan includes'),
      ),
    ).toBe(false)
  })
})
