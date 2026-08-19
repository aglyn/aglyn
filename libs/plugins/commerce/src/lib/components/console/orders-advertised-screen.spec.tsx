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
 * AGL-2136 — the `Commerce › Orders` screen `/product/commerce` advertises.
 *
 * The mockup shows six named columns, an `Online`/`POS` mix, three coloured
 * status pills and three money tiles carrying a delta. The card had a
 * `Stack` of concatenated text, no channel anywhere on a row, one
 * undifferentiated chip, and no tiles at all.
 *
 * The tiles are asserted BOTH ways round. They are the `commerceAnalytics`
 * surface, and AGL-1938 and AGL-2056 each closed one leak of those figures
 * to unentitled orgs; this is the third surface that renders them, so a
 * test that only proved they appear would let the fourth leak through.
 */

import { render, screen, within } from '@testing-library/react'
import HostOrdersCard from './host-orders-card.component'

let orderDocs: Array<Record<string, unknown>> = []
/** Mutated per case; a STABLE object, like the real memoised hook. */
const orgPlan: { org: unknown; ready: boolean } = { org: {}, ready: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: jest.fn() } }),
  useOrgPlan: () => orgPlan,
  useFirestoreCollection: (build: () => { __collection?: string }) => ({
    data: build()?.__collection === 'orders' ? orderDocs : [],
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({
    __collection: path[path.length - 1],
  }),
  limit: () => ({}),
  query: (ref: unknown) => ref,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

const NOW = Date.UTC(2026, 7, 18, 12, 0)
const DAY = 86_400_000

const order = (
  id: string,
  overrides: Record<string, unknown> = {},
  agoDays = 1,
  cents = 8800,
) => ({
  $id: id,
  status: 'paid',
  channel: 'online',
  customerEmail: `${id}@example.com`,
  createdAtMs: NOW - agoDays * DAY,
  createdAt: {
    seconds: (NOW - agoDays * DAY) / 1000,
    toDate: () => new Date(NOW - agoDays * DAY),
  },
  lineItems: [
    { productId: 'p1', name: 'Enamel Camp Mug', quantity: 1, unitAmountCents: cents },
  ],
  totals: {
    itemsCents: cents,
    shippingCents: 0,
    taxCents: 0,
    discountCents: 0,
    feeCents: 0,
    totalCents: cents,
  },
  timeline: [],
  ...overrides,
})

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  orgPlan.org = { plan: 'pro' }
  orgPlan.ready = true
  orderDocs = []
})
afterEach(() => jest.restoreAllMocks())

/** The row whose Order cell names this order number. */
const rowFor = (orderNumber: string) => {
  const cell = screen.getByText(orderNumber)
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${orderNumber}`)
  return row
}

describe('the advertised Orders table', () => {
  it('renders the six columns the mockup names, in that order', () => {
    orderDocs = [order('a', { number: 1042 })]
    render(<HostOrdersCard hostId="host-1" />)
    const headers = screen
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    expect(headers).toEqual([
      'Order',
      'Customer',
      'Channel',
      'Total',
      'Status',
      'Date',
    ])
  })

  it('shows the CHANNEL on every row, so Online and POS are told apart', () => {
    // The whole claim of this screen — "Online and POS orders together" —
    // was unverifiable, because channel existed only in the filter select.
    orderDocs = [
      order('a', { number: 1042, channel: 'online' }),
      order('b', { number: 1043, channel: 'pos' }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    expect(within(rowFor('#1042')).getByText('Online')).toBeTruthy()
    expect(within(rowFor('#1043')).getByText('POS')).toBeTruthy()
  })

  it('names a channel even on a legacy row that never stored one', () => {
    orderDocs = [order('a', { number: 1044, channel: undefined })]
    render(<HostOrdersCard hostId="host-1" />)
    expect(within(rowFor('#1044')).getByText('Online')).toBeTruthy()
  })

  it('gives Paid, Fulfilled and Refunded three DIFFERENT pill colours', () => {
    orderDocs = [
      order('a', { number: 1, status: 'paid' }),
      order('b', { number: 2, status: 'fulfilled' }),
      order('c', { number: 3, status: 'refunded', refundedCents: 8800 }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    const chipClass = (label: string) =>
      screen.getByText(label).closest('.MuiChip-root')?.className ?? ''
    const paid = chipClass('Paid')
    const fulfilled = chipClass('Fulfilled')
    const refunded = chipClass('Refunded')
    expect(paid).toContain('colorSuccess')
    expect(fulfilled).toContain('colorInfo')
    expect(refunded).toContain('colorError')
    // The defect was sameness, not absence: one outlined default chip for
    // all seven statuses. Assert the thing that regressing would undo.
    expect(new Set([paid, fulfilled, refunded]).size).toBe(3)
  })

  it('shows the total NET of refunds, and says so', () => {
    orderDocs = [
      order('a', { number: 9, status: 'refunded', refundedCents: 3000 }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    const row = rowFor('#9')
    expect(within(row).getByText('$58.00')).toBeTruthy()
    expect(within(row).getByText(/\$88\.00 less refunds/)).toBeTruthy()
  })
})

describe('the advertised money tiles', () => {
  it('renders Revenue, Orders and Avg order value with a delta', () => {
    orderDocs = [
      order('a', { number: 1 }, 1, 10_000),
      order('b', { number: 2 }, 5, 10_000),
      // Prior 30-day window: one $100 order, so revenue doubled.
      order('c', { number: 3 }, 40, 10_000),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    expect(screen.getByText('Revenue · 30d')).toBeTruthy()
    expect(screen.getByText('$200.00')).toBeTruthy()
    expect(screen.getByText('Orders · 30d')).toBeTruthy()
    expect(screen.getByText('Avg order value')).toBeTruthy()
    expect(screen.getAllByText('+100%').length).toBeGreaterThan(0)
  })

  it('prints NO delta when the prior window held nothing', () => {
    // `+100%` against zero is a first sale, not growth. The tile must be
    // silent rather than encouraging.
    orderDocs = [order('a', { number: 1 }, 1, 10_000)]
    render(<HostOrdersCard hostId="host-1" />)
    // Revenue and AOV are both $100.00 on a one-order window.
    expect(screen.getAllByText('$100.00').length).toBe(3)
    expect(screen.queryByText(/^\+/)).toBeNull()
    expect(screen.queryByText(/%$/)).toBeNull()
  })

  it('withholds the tiles from an org without `commerceAnalytics`', () => {
    // AGL-1938 and AGL-2056 each closed one leak of these figures. This is
    // the third surface that renders them.
    orgPlan.org = { plan: 'starter' }
    orderDocs = [order('a', { number: 1 })]
    render(<HostOrdersCard hostId="host-1" />)
    expect(screen.queryByText('Revenue · 30d')).toBeNull()
    // …and the table, which is not a paid feature, still renders.
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getAllByRole('columnheader')).toHaveLength(6)
  })

  it('withholds them while the plan doc is still in flight', () => {
    // `checkEntitlement(undefined)` resolves the FREE tier, so an unguarded
    // read would flicker the paid figures off for a Pro org — or, in the
    // other direction, show them to someone who has not bought them.
    orgPlan.ready = false
    orgPlan.org = undefined
    orderDocs = [order('a', { number: 1 })]
    render(<HostOrdersCard hostId="host-1" />)
    expect(screen.queryByText('Revenue · 30d')).toBeNull()
  })
})
