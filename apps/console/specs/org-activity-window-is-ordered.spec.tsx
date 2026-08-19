/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 *
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

import { render } from '@testing-library/react'

/**
 * The customer's audit feed must fetch an ORDERED window (AGL-2292).
 *
 * `OrgActivityCard` queried `orgs/{orgId}/activity` with `limit(200)` and no
 * `orderBy`. Firestore then returns documents in DOCUMENT-ID order, and
 * `logOrgActivity` writes entries with `.add()` — auto-ids, effectively
 * random. So the 200 rows fetched were a pseudo-random SAMPLE, and the
 * client-side sort below them ordered that sample and sliced 20 off the top.
 * The result looked correct and was wrong: past 200 entries a change made a
 * minute ago could never appear, and the member-detail page's `actorId` filter
 * — "what has this person done" — ran over the same sample.
 *
 * ## Why this asserts the QUERY and not the rendered list
 *
 * The client sort is the trap. It makes the rendered output newest-first
 * whatever the fetch returned, so ANY test that only reads the DOM passes just
 * as happily against the broken version — the sample it sorted was still
 * sorted. The defect lives entirely in which 200 documents were asked for, so
 * that is what is asserted: `orderBy('createdAt', 'desc')` is built and handed
 * to `query`.
 *
 * The DOM assertion is kept anyway, as the negative control that proves the
 * point: it is green in both directions, and it is labelled as such so nobody
 * later mistakes it for the guard.
 */

/** Every `orderBy(...)` the component built, in call order. */
const orderByCalls: Array<[string, string]> = []
/** Every argument list handed to `query(...)`. */
const queryCalls: unknown[][] = []

jest.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => ({ __kind: 'collection', args }),
  limit: (n: number) => ({ __kind: 'limit', n }),
  orderBy: (field: string, direction: string) => ({
    __kind: 'orderBy',
    field,
    direction,
  }),
  query: (...args: unknown[]) => {
    queryCalls.push(args)
    for (const one of args) {
      const clause = one as { __kind?: string; field?: string; direction?: string }
      if (clause?.__kind === 'orderBy') {
        orderByCalls.push([String(clause.field), String(clause.direction)])
      }
    }
    return { __kind: 'query', args }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({ __kind: 'firestore' }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme' }),
}))

/**
 * Entries handed back DELIBERATELY OUT OF ORDER — the shape a `limit()` with
 * no `orderBy` produces. The component must still render them newest-first
 * (its client sort), which is exactly why that rendering proves nothing about
 * the bug.
 */
const ENTRIES = [
  { $id: 'b', action: 'Middle action', actorId: 'u1', createdAt: { seconds: 200 } },
  { $id: 'c', action: 'Newest action', actorId: 'u1', createdAt: { seconds: 300 } },
  { $id: 'a', action: 'Oldest action', actorId: 'u1', createdAt: { seconds: 100 } },
]

jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: (factory: () => unknown) => {
    // Invoking the factory is what makes the query actually get BUILT — the
    // real hook calls it too, so skipping it would leave `queryCalls` empty
    // and every assertion below vacuous.
    factory()
    return { data: ENTRIES, status: 'success' }
  },
}))

import OrgActivityCard from '../components/org-activity-card.component'

describe('the org activity window (AGL-2292)', () => {
  beforeEach(() => {
    orderByCalls.length = 0
    queryCalls.length = 0
  })

  it('builds a query at all', () => {
    // The instrument. Every assertion below reads `orderByCalls`, and an empty
    // one would make `not.toHaveLength(0)`-style checks the only thing
    // standing between a broken mock and a green run.
    render(<OrgActivityCard orgId="org-1" />)
    expect(queryCalls).toHaveLength(1)
    expect(queryCalls[0].length).toBeGreaterThanOrEqual(3)
  })

  it('orders the window by createdAt descending', () => {
    render(<OrgActivityCard orgId="org-1" />)
    expect(orderByCalls).toContainEqual(['createdAt', 'desc'])
  })

  it('passes the ordering into query(), not merely constructs it', () => {
    // `orderBy(...)` on its own line that nothing consumes would satisfy a
    // laxer check and change nothing about what Firestore returns.
    render(<OrgActivityCard orgId="org-1" />)
    const clauses = queryCalls[0] as Array<{ __kind?: string }>
    expect(clauses.some((one) => one?.__kind === 'orderBy')).toBe(true)
    expect(clauses.some((one) => one?.__kind === 'limit')).toBe(true)
  })

  it('still caps the window', () => {
    render(<OrgActivityCard orgId="org-1" />)
    const clauses = queryCalls[0] as Array<{ __kind?: string; n?: number }>
    expect(clauses.find((one) => one?.__kind === 'limit')?.n).toBe(200)
  })

  it('NEGATIVE CONTROL — the rendered order proves nothing', () => {
    // Green with and without the fix, because the client sort runs either
    // way. Present so the difference between this and the real guard above is
    // written down rather than rediscovered.
    const view = render(<OrgActivityCard orgId="org-1" />)
    const text = view.container.textContent ?? ''
    expect(text.indexOf('Newest action')).toBeLessThan(text.indexOf('Oldest action'))
  })
})
