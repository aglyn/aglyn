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
  // A server aggregate is a NETWORK round-trip: its answer cannot land in the
  // same microtask drain as the mount that asked for it. Resolving it there
  // was the fixture's own fiction, and it is what let a settle helper that
  // flushed a fixed number of microtasks look correct (AGL-1756). One
  // macrotask is the cheapest schedule a real `getCountFromServer` can beat,
  // so the fixture uses it and any tick-counting settle fails deterministically
  // instead of only under a loaded worker.
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (aggregate.count == null) {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' })
  }
  return { data: () => ({ count: aggregate.count }), name } as any
})

/**
 * The card's real `checkQuota`, observed. Wrapping rather than replacing is
 * the point: `checkQuota` and `resolveOrgEntitlements` are the contract these
 * cases exist to exercise, and only the counts are staged.
 *
 * It is here because this card renders NO consequence of the count reaching
 * state — the header counts the loaded rows, so a site of 500 and a site of
 * 3,000 render the same string, and there is no caption to wait on the way
 * `locations-head-count.spec.tsx` has one. The number the gate is computed
 * from is the only thing that distinguishes them, so the spec waits on that.
 */
const mockCheckQuota = jest.fn()
jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return {
    ...actual,
    checkQuota: (...args: unknown[]) => {
      mockCheckQuota(...args)
      return (actual as any).checkQuota(...args)
    },
  }
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
 * Wait until the card is GATING ON `count` — the aggregate's answer has not
 * merely resolved, it has reached a render and is the number the next click
 * will be refused (or allowed) against.
 *
 * This replaces a helper that waited for `countSpy` to have been CALLED and
 * then flushed a fixed two microtasks, assuming the answer had arrived
 * (AGL-1756). It had not arrived on any schedule longer than those two ticks:
 * the click then read the `limit(500)` fallback, which sits UNDER the 2,500
 * band, so nothing was enqueued and the trailing `waitFor` spent RTL's 1,000ms
 * default — not this file's `jest.setTimeout(30_000)` — before reporting
 * `Expected: true, Received: false`. It read as a timeout; it was a missed
 * state update, and only a loaded worker made it visible.
 *
 * A tick budget cannot be made large enough, only large enough for today's
 * promise chain, so the condition replaces it rather than widening it.
 */
const gatingOn = async (count: number) => {
  await waitFor(() =>
    expect(mockCheckQuota).toHaveBeenCalledWith(
      expect.anything(),
      'productsPerHost',
      count,
    ),
  )
}

/**
 * The DENIED case has no `gatingOn` signal to wait for: its fallback is also
 * the value the FIRST render used, so `gatingOn(PRODUCT_ROWS)` would be
 * satisfied before the read had failed — passing while proving nothing.
 * Await the very promise the card awaited instead. Settled is settled; no
 * tick count is involved either way.
 */
const readRejected = async () => {
  await waitFor(() => expect(countSpy).toHaveBeenCalled())
  await act(async () => {
    await countSpy.mock.results[0].value.catch(() => undefined)
  })
}

describe('the products hub head-count is a server aggregate (AGL-1716)', () => {
  it('refuses Add over the band the loaded window hid', async () => {
    mount()
    await gatingOn(SERVER_PRODUCTS)

    // 3,000 products against `pro`'s included 2,500. Before the fix the
    // input was 500 — under every band from Pro up — so this opened the
    // editor and `api/hosts/resources`, which counts the collection for
    // real, refused the save afterwards.
    fireEvent.click(screen.getByText('Add product'))

    // Asserted directly, not inside a `waitFor`: the handler enqueues before
    // it awaits anything, so there is nothing here to wait FOR. A budget
    // around a synchronous assertion only decides how long a real failure
    // takes to report.
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Your plan includes 2500 products'),
      ),
    ).toBe(true)
  })

  it('refuses a duplicate over the same band', async () => {
    mount()
    await gatingOn(SERVER_PRODUCTS)

    // Duplicate is a create and consumes the same slot, so it reads the
    // same number — before the fix, the same saturated one.
    fireEvent.click(screen.getAllByText('Duplicate')[0])

    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Your plan includes 2500 products'),
      ),
    ).toBe(true)
    expect(mockCreateResource).not.toHaveBeenCalled()
  })

  it('keeps the list capped — the cap was never the defect', async () => {
    mount()
    await gatingOn(SERVER_PRODUCTS)

    // Fixing the head-count must not turn this table into a 3,000-row
    // stream. That the two questions now have two answers is the point.
    expect(limitSpy).toHaveBeenCalledWith(500)
  })

  it('reads the count once per mount, from the products collection', async () => {
    mount()
    await gatingOn(SERVER_PRODUCTS)

    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('products')
  })

  it('re-reads the count after the editor closes on a create', async () => {
    aggregate.count = 100
    mount()
    // 100, not the 500 the first render gated on — so this cannot be
    // satisfied before the aggregate has landed.
    await gatingOn(100)
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
    await readRejected()

    // 500 known live rows stand in — a lower bound, and this card's prior
    // behaviour. A defaulted 0 would report "no products used" on a site
    // that is over its band, which is the flattering direction again.
    expect(mockCheckQuota).toHaveBeenCalledWith(
      expect.anything(),
      'productsPerHost',
      PRODUCT_ROWS,
    )
    fireEvent.click(screen.getByText('Add product'))

    expect(screen.queryByText('Cancel')).not.toBeNull()
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Your plan includes'),
      ),
    ).toBe(false)
  })
})
