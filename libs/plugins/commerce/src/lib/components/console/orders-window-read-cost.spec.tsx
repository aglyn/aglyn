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
 * What the orders card READS, and what each read is for (AGL-3321).
 *
 * The card used to read one window — the newest two hundred orders — and run
 * five filters, the search, the dispute banner, the money tiles and the CSV
 * export over it, which made the window the scope of every one of them. Now
 * each has the read its job needs, and these assertions sit on the reads
 * themselves so a regression to a shared window cannot pass:
 *
 *  * THE LIST is one paged query — every clause and the search word on it,
 *    newest first by `createdAtMs` — with no window cap of its own.
 *  * THE BANNER is its own query, `disputeKey == 'open'`, so a deadline is
 *    raised whatever the list is filtered to or paged at.
 *  * THE MONEY TILES are analytics, not a filter: a bounded sixty-day read,
 *    made only for an org entitled to see them.
 *  * THE PRODUCT PICKER is a bounded read by document name.
 */

import { cleanup, render } from '@testing-library/react'
import type { ListQueryRequest } from '@aglyn/shared-ui-jsx/const/list-query-plan'

interface Constraint {
  __constraint: string
  args: unknown[]
}
interface CapturedQuery {
  __path: string
  constraints: Constraint[]
}

const mockQueries: CapturedQuery[] = []
/** Every request a `useListQuery` on this card made, in call order. */
const mockListRequests: Array<{ request: ListQueryRequest; pageSize?: number }> = []
let mockOrgPlan = { org: { plan: 'starter' }, ready: true }

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
    where: marker('where'),
    documentId: () => '__name__',
  }
})

jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    useListQuery: (options: { request: ListQueryRequest; pageSize?: number }) => {
      mockListRequests.push({ request: options.request, pageSize: options.pageSize })
      return useListQueryDouble(() => [], options)
    },
  }
})

jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = require('firebase/firestore')
  return {
    useFirestore: () => ({}),
    useOrgPlan: () => mockOrgPlan,
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
    useFirestoreCollection: (build: () => CapturedQuery | null) => {
      const ref = build()
      if (ref) mockQueries.push(ref)
      return { data: [] }
    },
  }
})

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

import { HostOrdersCard } from './host-orders-card.component'

const queriesFor = (suffix: string) =>
  mockQueries.filter((entry) => entry.__path.endsWith(suffix))

const constraints = (subject: CapturedQuery, kind: string) =>
  subject.constraints
    .filter((entry) => entry?.__constraint === kind)
    .map((entry) => entry.args)

beforeEach(() => {
  mockQueries.length = 0
  mockListRequests.length = 0
  mockOrgPlan = { org: { plan: 'starter' }, ready: true }
})

afterEach(cleanup)

describe('each thing the orders card shows has the read its job needs', () => {
  it('pages the list on its own query, and caps no window of orders', () => {
    render(<HostOrdersCard hostId="host-1" />)
    const list = mockListRequests[mockListRequests.length - 1]
    // Newest first: the default header order (AGL-3680).
    expect(list.request).toEqual({
      clauses: [],
      search: [],
      sort: expect.objectContaining({ path: 'createdAtMs', direction: 'desc' }),
    })
    // The pager's page, not a window: the double pages by the default size.
    expect(list.pageSize).toBeUndefined()
    // An unentitled org's card makes no plain read of `orders` at all.
    expect(queriesFor('/orders')).toEqual([])
  })

  it('asks for the open disputes on a query of their own', () => {
    render(<HostOrdersCard hostId="host-1" />)
    const banner = mockListRequests.find(
      (entry) => entry.request.clauses[0]?.field === 'disputeKey',
    )
    expect(banner?.request.clauses).toEqual([
      { field: 'disputeKey', op: 'equals', value: 'open' },
    ])
    expect(banner?.pageSize).toBe(50)
  })

  it('reads the money tiles on a bounded sixty-day range, only when they show', () => {
    mockOrgPlan = { org: { plan: 'pro' }, ready: true }
    render(<HostOrdersCard hostId="host-1" />)
    const [stats] = queriesFor('/orders')
    const [range] = constraints(stats, 'where')
    expect(range.slice(0, 2)).toEqual(['createdAtMs', '>='])
    expect(Date.now() - Number(range[2])).toBeGreaterThanOrEqual(60 * 86_400_000)
    expect(constraints(stats, 'orderBy')).toEqual([['createdAtMs', 'desc']])
    expect(constraints(stats, 'limit')).toEqual([[501]])
  })

  it('walks the product picker by document name', () => {
    render(<HostOrdersCard hostId="host-1" />)
    const [products] = queriesFor('/products')
    expect(constraints(products, 'orderBy')).toEqual([['__name__']])
    expect(constraints(products, 'limit')).toEqual([[101]])
  })
})
