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
 * AGL-1796: the orders list, where an OPEN dispute has to be found before its
 * deadline runs out.
 *
 * A filter is only half an answer — it helps a merchant who already suspects
 * there is something to filter for, and Stripe's evidence window is days. So
 * the banner is asserted as the primary affordance and the filter as the way
 * to act on it, and the banner is asserted to survive an unrelated filter:
 * counting only the VISIBLE orders would hide a running deadline behind a
 * status the merchant happened to select.
 *
 * `Date.now` is stubbed rather than the timers faked — MUI's Tooltip schedules
 * a real `setTimeout` and fake timers would deadlock the hover assertion.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import HostOrdersCard from './host-orders-card.component'

/** Swapped per case, keyed by collection name. */
let orderDocs: Array<Record<string, unknown>> = []

/** Settled, unentitled — the tiles stay off and the table still renders. */
const ORG_PLAN = { org: { plan: 'starter' }, ready: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  /**
   * AGL-2136 added the `commerceAnalytics`-gated money tiles to this card,
   * so the module's closed-world mock has to carry `useOrgPlan` or the
   * component throws before it renders a row. A STABLE object, not a fresh
   * one per call: the real hook memoises, and handing back a new identity
   * every render is how a mock turns a failing assertion into a hang.
   */
  useOrgPlan: () => ORG_PLAN,
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: jest.fn() } }),
  useFirestoreCollection: (build: () => { __collection?: string }) => ({
    data: build()?.__collection === 'orders' ? orderDocs : [],
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ..._path: string[]) => ({
    __collection: _path[_path.length - 1],
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

const NOW = Date.UTC(2026, 9, 11, 12, 0)
const DAY = 86_400_000

const openDispute = (dueInDays: number, id = 'dp_open') => ({
  id,
  status: 'needs_response',
  reason: 'product_not_received',
  amountCents: 6200,
  openedAtMs: NOW - 4 * DAY,
  evidenceDueByMs: NOW + dueInDays * DAY,
})

const lostDispute = {
  ...openDispute(0, 'dp_lost'),
  status: 'lost',
  outcome: 'lost',
  closedAtMs: NOW - DAY,
  reversedCents: 6200,
}

const wonDispute = {
  ...openDispute(0, 'dp_won'),
  status: 'won',
  outcome: 'won',
  closedAtMs: NOW - DAY,
  reversedCents: 0,
}

const order = (
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  $id: id,
  status: 'paid',
  customerEmail: `${id}@example.com`,
  lineItems: [{ productId: 'p1', name, quantity: 1, unitAmountCents: 6200 }],
  totals: {
    itemsCents: 6200,
    shippingCents: 0,
    taxCents: 0,
    discountCents: 0,
    feeCents: 0,
    totalCents: 6200,
  },
  timeline: [],
  ...extra,
})

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
})
afterEach(() => {
  jest.restoreAllMocks()
})

/**
 * Product names on the rows, in list order.
 *
 * AGL-2136 turned the row from one `Typography` reading `#1042 · Mug ·
 * $62.00` into the six advertised table cells, so the name is now its own
 * text node rather than a fragment between two middots.
 */
const rowNames = () =>
  ['Mug', 'Kettle', 'Teapot', 'Saucer'].filter((name) =>
    screen.queryByText(name),
  )

describe('the orders list surfaces an open dispute (AGL-1796)', () => {
  it('raises no alarm when nothing is disputed', () => {
    // The control: an ordinary refunded order is not a chargeback.
    orderDocs = [
      order('a', 'Mug'),
      order('b', 'Kettle', { status: 'refunded', refundedCents: 6200 }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/disputed/)).toBeNull()
  })

  it('names the tightest deadline when one dispute is open', () => {
    orderDocs = [order('a', 'Mug', { dispute: openDispute(5) })]
    render(<HostOrdersCard hostId="host-1" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(
      'A shopper has disputed a charge with their bank',
    )
    expect(alert.textContent).toContain('due to Stripe in 5 days')
  })

  it('counts and pluralises several, reporting the SOONEST deadline', () => {
    orderDocs = [
      order('a', 'Mug', { dispute: openDispute(9, 'dp_a') }),
      order('b', 'Kettle', { dispute: openDispute(2, 'dp_b') }),
      order('c', 'Teapot', { dispute: lostDispute }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('2 charges are disputed')
    expect(alert.textContent).toContain('in 2 days')
    expect(alert.textContent).not.toContain('in 9 days')
  })

  it('says so, in error, once a deadline has passed', () => {
    orderDocs = [order('a', 'Mug', { dispute: openDispute(-2) })]
    render(<HostOrdersCard hostId="host-1" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('deadline has passed')
    expect(alert.className).toContain('colorError')
  })

  it('warns about an order the current filter is hiding', () => {
    // Computed over every LOADED order. A merchant reviewing delivered orders
    // still has a deadline running on a paid one, and a summary built from the
    // visible rows would have gone quiet exactly when it mattered.
    orderDocs = [
      order('a', 'Mug', { dispute: openDispute(3) }),
      order('b', 'Kettle', { status: 'delivered' }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    fireEvent.mouseDown(screen.getByLabelText('Status'))
    // The status select now carries display labels, not raw enum values.
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Delivered'))
    expect(rowNames()).toEqual(['Kettle'])
    expect(screen.getByRole('alert').textContent).toContain('in 3 days')
  })

  it('filters to the open disputes from the banner itself', () => {
    orderDocs = [
      order('a', 'Mug', { dispute: openDispute(3) }),
      order('b', 'Kettle'),
      order('c', 'Teapot', {
        status: 'refunded',
        refundedCents: 6200,
        dispute: lostDispute,
      }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    expect(rowNames()).toEqual(['Mug', 'Kettle', 'Teapot'])
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
    expect(rowNames()).toEqual(['Mug'])
    // The button is the whole action, so it retires once it has acted.
    expect(screen.queryByRole('button', { name: 'Show them' })).toBeNull()
  })

  it('lists charged-back orders without listing the ones that were won', () => {
    // A won dispute also closes with `outcome` set. Selecting on "has a
    // dispute" would tell the merchant they lost a case they won, and an
    // ordinary refund is not a chargeback at all.
    orderDocs = [
      order('a', 'Mug', {
        status: 'refunded',
        refundedCents: 6200,
        dispute: lostDispute,
      }),
      order('b', 'Kettle', { dispute: wonDispute }),
      order('c', 'Teapot', { status: 'refunded', refundedCents: 6200 }),
      order('d', 'Saucer', { dispute: openDispute(3) }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    fireEvent.mouseDown(screen.getByLabelText('Disputes'))
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText('Charged back'),
    )
    expect(rowNames()).toEqual(['Mug'])
  })

  it('badges the row and counts the days down on it', () => {
    orderDocs = [
      order('a', 'Mug', { dispute: openDispute(3) }),
      order('b', 'Kettle', {
        status: 'refunded',
        refundedCents: 6200,
        dispute: lostDispute,
      }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    expect(screen.getByText('Chargeback open')).toBeTruthy()
    expect(screen.getByText('Evidence due in 3 days')).toBeTruthy()
    // The settled one carries no deadline, even though Stripe sent one on the
    // `closed` event and it is still in the record.
    expect(lostDispute.evidenceDueByMs).toBeGreaterThan(0)
    expect(screen.getByText('Charged back')).toBeTruthy()
    expect(screen.queryAllByText(/Evidence due/)).toHaveLength(1)
  })

  it('leaves the status chip alone', () => {
    // AGL-1787's decision, and five entitlement gates rest on it. The badge is
    // additive; it does not rewrite what the status says.
    orderDocs = [
      order('a', 'Mug', {
        status: 'refunded',
        refundedCents: 6200,
        dispute: lostDispute,
      }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    // The status pill now reads its display label (AGL-2136), and — the
    // point of this test — still says REFUNDED beside the chargeback badge
    // rather than being rewritten by it.
    expect(screen.getByText('Refunded')).toBeTruthy()
    expect(screen.getByText('Charged back')).toBeTruthy()
  })
})
