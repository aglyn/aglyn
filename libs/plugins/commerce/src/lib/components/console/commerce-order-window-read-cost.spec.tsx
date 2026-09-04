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
 *
 * @jest-environment jsdom
 */

/**
 * What the two commerce money surfaces ASK FOR, and what they admit.
 *
 * Both cards quote a figure over a stated period — thirty days on the glance
 * widget, thirty days of totals behind a fourteen-day trend on the analytics
 * tab. A spec that renders them and reads the number back cannot tell a right
 * figure from a lucky one, because the defect these assertions exist to hold
 * shut is in the QUERY rather than in the arithmetic:
 *
 *  * `limit(N)` with no `orderBy` is answered in DOCUMENT-ID order, and orders
 *    are keyed by generated ids. So a capped read with no ordering is a
 *    pseudo-random sample of the collection, not its most recent rows — and a
 *    sum over a random sample is not a smaller total, it is a WRONG one. The
 *    client sort that used to follow is what hid it: the rows ran newest-first
 *    on screen, they were simply the wrong rows.
 *  * A window bounded by COUNT reads the same slab for a store that sold three
 *    times last month and one that sold three thousand times. A window bounded
 *    by TIME reads what the card actually reports.
 *
 * So the assertions sit on the constraints themselves: the field ordered on,
 * the direction, the range predicate, and the ceiling as a number. Rendering
 * is asserted only where it carries the disclosure, because a figure that is
 * short and says nothing is indistinguishable from a figure that is right.
 *
 * `createdAtMs` rather than `createdAt` is load-bearing and pinned as such:
 * the orders collection group is indexed on `createdAtMs` alone, and a range
 * on a field a document lacks DROPS that document rather than mis-placing it.
 * A change to the other field would keep every rendering assertion green and
 * fail in production.
 */

import { cleanup, render } from '@testing-library/react'

interface Constraint {
  __constraint: string
  args: unknown[]
}
interface CapturedQuery {
  __path: string
  constraints: Constraint[]
}

/** Every query the cards built this render, in the order they built them. */
const mockQueries: CapturedQuery[] = []
let orderRows: unknown[] = []
let productRows: unknown[] = []

jest.mock('firebase/firestore', () => {
  const marker =
    (kind: string) =>
    (...args: unknown[]) => ({ __constraint: kind, args })
  return {
    __esModule: true,
    collection: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
      constraints: [] as unknown[],
    }),
    query: (base: { __path: string }, ...constraints: unknown[]) => ({
      __path: base.__path,
      constraints,
    }),
    limit: marker('limit'),
    orderBy: marker('orderBy'),
    where: marker('where'),
    documentId: () => '__name__',
  }
})

jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = require('firebase/firestore')
  return {
    useFirestore: () => ({}),
    useOrgPlan: () => ({ org: { plan: 'pro' }, ready: true }),
    useConsoleHostRoute: () => ({ base: '/o/h', orgSlug: 'o' }),
    useFirestoreCollection: (build: () => CapturedQuery) => {
      const ref = build()
      mockQueries.push(ref)
      return {
        data: ref.__path.endsWith('/orders') ? orderRows : productRows,
      }
    },
    /*
     * The real builders, expressed through the mocked constraint markers, so
     * the ordering a ceilinged read carries is visible to the assertions
     * instead of being stubbed away.
     */
    collectionCeiling: (ref: { __path: string }, ceiling: number) =>
      firestore.query(
        ref,
        firestore.orderBy(firestore.documentId()),
        firestore.limit(ceiling + 1),
      ),
    ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
      rows: (read ?? []).slice(0, ceiling),
      truncated: (read ?? []).length > ceiling,
    }),
  }
})

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import CommerceAnalyticsCard from './commerce-analytics-card.component'
import CommerceGlanceCard from './commerce-glance-card.component'

const DAY_MS = 24 * 60 * 60 * 1000

/** A paid order a day old, so it sits inside every window under test. */
const order = (id: number, totalCents: number) => ({
  $id: `order-${id}`,
  status: 'paid',
  createdAtMs: Date.now() - DAY_MS,
  refundedCents: 0,
  totals: { totalCents },
  channel: 'online',
  lineItems: [],
})

const orders = (count: number, totalCents: number) =>
  Array.from({ length: count }, (_row, index) => order(index, totalCents))

const queryFor = (suffix: string) => {
  const found = mockQueries.find((entry) => entry.__path.endsWith(suffix))
  if (!found) throw new Error(`no query was built for ${suffix}`)
  return found
}

const constraints = (subject: CapturedQuery, kind: string) =>
  subject.constraints.filter(
    (entry) => (entry as Constraint)?.__constraint === kind,
  ) as Constraint[]

const onlyConstraint = (subject: CapturedQuery, kind: string) => {
  const found = constraints(subject, kind)
  expect(found).toHaveLength(1)
  return found[0]
}

beforeEach(() => {
  mockQueries.length = 0
  orderRows = []
  productRows = []
})

afterEach(cleanup)

describe('the glance widget asks for the thirty days it reports', () => {
  it('orders the orders read by creation time, newest first', () => {
    orderRows = orders(3, 1000)
    render(<CommerceGlanceCard hostId="host-1" />)

    // The field is the assertion. `createdAt` would satisfy "is ordered" and
    // drop every order the collection-group index cannot see.
    expect(onlyConstraint(queryFor('/orders'), 'orderBy').args).toEqual([
      'createdAtMs',
      'desc',
    ])
  })

  it('bounds that read by TIME, at thirty days', () => {
    orderRows = orders(3, 1000)
    const before = Date.now()
    render(<CommerceGlanceCard hostId="host-1" />)

    const range = onlyConstraint(queryFor('/orders'), 'where')
    expect(range.args[0]).toBe('createdAtMs')
    expect(range.args[1]).toBe('>=')
    // Thirty days back from mount, give or take the time the render took.
    const expected = before - 30 * DAY_MS
    expect(Math.abs(Number(range.args[2]) - expected)).toBeLessThan(5000)
  })

  it('caps that window at 250, and probes one past it', () => {
    orderRows = orders(3, 1000)
    render(<CommerceGlanceCard hostId="host-1" />)

    // 251, not 250: the probe row is what turns "there may be more" into a
    // fact, and it is never rendered.
    expect(onlyConstraint(queryFor('/orders'), 'limit').args).toEqual([251])
  })

  it('walks products by document name, which no writer can omit', () => {
    productRows = [{ $id: 'p1', stock: 5, lowStockThreshold: 0 }]
    render(<CommerceGlanceCard hostId="host-1" />)

    const products = queryFor('/products')
    expect(onlyConstraint(products, 'orderBy').args).toEqual(['__name__'])
    expect(onlyConstraint(products, 'limit').args).toEqual([251])
  })

  it('says so when the ceiling bit, and leaves the probe row out of the sum', () => {
    // 251 rows: 250 at $1.00 plus one $500.00 probe. A card that summed the
    // probe would read $750.00 rather than $250.00.
    orderRows = [...orders(250, 100), order(9999, 50000)]

    const { getByText, queryByText } = render(
      <CommerceGlanceCard hostId="host-1" />,
    )

    expect(getByText('$250.00')).toBeTruthy()
    expect(queryByText('$750.00')).toBeNull()
    expect(
      getByText(/Counted from the 250 most recent orders of the last 30 days/),
    ).toBeTruthy()
  })

  it('stays quiet at exactly the ceiling, where nothing was cut', () => {
    // THE CONTROL. A card that always disclosed would pass the case above
    // without the probe telling it anything. 250 rows is the count at which a
    // `length === limit` test would wrongly claim more.
    orderRows = orders(250, 100)
    productRows = [{ $id: 'p1', stock: 5, lowStockThreshold: 0 }]

    const { queryByText } = render(<CommerceGlanceCard hostId="host-1" />)

    // BOTH notices, not just the orders one: the two share a slot, and a
    // disclosure hard-wired open renders the products half here — which an
    // assertion naming only the orders half reads as silence.
    expect(queryByText(/Counted from the 250 most recent orders/)).toBeNull()
    expect(queryByText(/Low stock counted across 250 products/)).toBeNull()
  })
})

describe('the analytics tab asks for the thirty days it reports', () => {
  it('orders by creation time and bounds by thirty days', () => {
    orderRows = orders(3, 1000)
    const before = Date.now()
    render(<CommerceAnalyticsCard hostId="host-1" />)

    const subject = queryFor('/orders')
    expect(onlyConstraint(subject, 'orderBy').args).toEqual([
      'createdAtMs',
      'desc',
    ])
    const range = onlyConstraint(subject, 'where')
    expect(range.args[0]).toBe('createdAtMs')
    expect(range.args[1]).toBe('>=')
    expect(Math.abs(Number(range.args[2]) - (before - 30 * DAY_MS))).toBeLessThan(
      5000,
    )
  })

  it('caps that window at 500, and probes one past it', () => {
    orderRows = orders(3, 1000)
    render(<CommerceAnalyticsCard hostId="host-1" />)

    expect(onlyConstraint(queryFor('/orders'), 'limit').args).toEqual([501])
  })

  it('warns that every figure reads low once the ceiling bit', () => {
    orderRows = [...orders(500, 100), order(9999, 50000)]

    const { getByText, queryByText } = render(
      <CommerceAnalyticsCard hostId="host-1" />,
    )

    expect(getByText(/more than 500 orders in the last 30 days/)).toBeTruthy()
    // The probe is excluded from the total as well as from the warning.
    expect(queryByText('$1,000.00')).toBeNull()
  })

  it('stays quiet at exactly the ceiling', () => {
    // THE CONTROL, for the same reason as the widget's.
    orderRows = orders(500, 100)

    const { queryByText } = render(<CommerceAnalyticsCard hostId="host-1" />)

    expect(queryByText(/more than 500 orders/)).toBeNull()
  })
})
