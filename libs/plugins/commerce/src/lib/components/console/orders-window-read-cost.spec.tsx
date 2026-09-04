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
 * What the orders table READS, and where it admits the reading stopped.
 *
 * This card cannot page the way a plain list can, and that is the reason its
 * window has to be both ordered and disclosed rather than merely small. Five
 * filters and the CSV export all run over what was read, so the window is the
 * scope of every one of them:
 *
 *  * Unordered, the window is the wrong scope. A capped query with no
 *    `orderBy` is answered in document-id order and orders carry generated
 *    ids, so it returns a pseudo-random slice — and a status filter run over a
 *    random slice reports "no refunded orders" for a store that has them.
 *  * Undisclosed, the scope is invisible. A filter that matches nothing inside
 *    the window and a filter that matches nothing in the collection render
 *    identically, so the reader cannot tell "you have none" from "this card
 *    did not look that far".
 *
 * The assertions therefore sit on the constraints themselves — field,
 * direction and ceiling as numbers — plus the disclosure and its control.
 * Rendering assertions alone would survive a regression to any window.
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

const mockQueries: CapturedQuery[] = []
let orderRows: any[] = []
let productRows: any[] = []

jest.mock('firebase/firestore', () => {
  const marker =
    (kind: string) =>
    (...args: unknown[]) => ({ __constraint: kind, args })
  return {
    collection: (_db: unknown, ...path: string[]) => ({
      __path: path.join('/'),
    }),
    query: (base: { __path: string }, ...constraints: unknown[]) => ({
      __path: base.__path,
      constraints,
    }),
    limit: marker('limit'),
    orderBy: marker('orderBy'),
    documentId: () => '__name__',
  }
})

/** Settled and unentitled: the money tiles stay off, the table still renders. */
const ORG_PLAN = { org: { plan: 'starter' }, ready: true }

jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = require('firebase/firestore')
  return {
    useFirestore: () => ({}),
    useOrgPlan: () => ORG_PLAN,
    useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
    // The real builder, through the mocked markers, so the ordering a
    // ceilinged read carries stays visible to the assertions.
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
    useFirestoreCollection: (build: () => CapturedQuery) => {
      const ref = build()
      mockQueries.push(ref)
      if (ref.__path.endsWith('/products')) return { data: productRows }
      if (ref.__path.endsWith('/orders')) return { data: orderRows }
      return { data: [] }
    },
  }
})

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

import { HostOrdersCard } from './host-orders-card.component'

const DAY_MS = 24 * 60 * 60 * 1000

const order = (id: number) => ({
  $id: `order-${id}`,
  status: 'paid',
  createdAtMs: Date.now() - DAY_MS,
  refundedCents: 0,
  totals: { totalCents: 100 },
  channel: 'online',
  lineItems: [],
})

const orders = (count: number) =>
  Array.from({ length: count }, (_row, index) => order(index))

const queryFor = (suffix: string) => {
  const found = mockQueries.find((entry) => entry.__path.endsWith(suffix))
  if (!found) throw new Error(`no query was built for ${suffix}`)
  return found
}

const onlyConstraint = (subject: CapturedQuery, kind: string) => {
  const found = subject.constraints.filter(
    (entry) => (entry as Constraint)?.__constraint === kind,
  ) as Constraint[]
  expect(found).toHaveLength(1)
  return found[0]
}

beforeEach(() => {
  mockQueries.length = 0
  orderRows = orders(1)
  productRows = []
})

afterEach(cleanup)

describe('the orders window is ordered, capped and probed', () => {
  it('orders on the field every order writer stamps, newest first', () => {
    render(<HostOrdersCard hostId="host-1" />)

    // `createdAt` would satisfy "is ordered" and drop every order written
    // without it — a silent narrowing of all five filters.
    expect(onlyConstraint(queryFor('/orders'), 'orderBy').args).toEqual([
      'createdAtMs',
      'desc',
    ])
  })

  it('caps the window at 200 and asks for one more', () => {
    render(<HostOrdersCard hostId="host-1" />)

    // 201: the probe is what makes "there are more" a fact rather than a
    // comparison that is wrong at exactly 200.
    expect(onlyConstraint(queryFor('/orders'), 'limit').args).toEqual([201])
  })

  it('walks the product name map by document name', () => {
    productRows = [{ $id: 'p1', name: 'Kettle', status: 'active' }]
    render(<HostOrdersCard hostId="host-1" />)

    const products = queryFor('/products')
    expect(onlyConstraint(products, 'orderBy').args).toEqual(['__name__'])
    expect(onlyConstraint(products, 'limit').args).toEqual([101])
  })

  it('renders 200 rows and says the filters stop there', () => {
    orderRows = orders(201)

    const { getAllByRole, getByText } = render(
      <HostOrdersCard hostId="host-1" />,
    )

    // The probe row is never drawn: one header row plus 200 order rows.
    expect(getAllByRole('row')).toHaveLength(201)
    expect(
      getByText(
        /Showing the 200 most recent orders\. Filters and Export CSV cover these\./,
      ),
    ).toBeTruthy()
  })

  it('stays quiet at exactly 200, where nothing was cut', () => {
    // THE CONTROL. A card that always disclosed would satisfy the case above
    // while telling every store its list was short.
    orderRows = orders(200)

    const { getAllByRole, queryByText } = render(
      <HostOrdersCard hostId="host-1" />,
    )

    expect(getAllByRole('row')).toHaveLength(201)
    expect(queryByText(/Showing the 200 most recent orders/)).toBeNull()
  })
})
