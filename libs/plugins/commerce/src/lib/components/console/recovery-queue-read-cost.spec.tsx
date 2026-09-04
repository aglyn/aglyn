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
 * Whether the queue depths this card reports can be believed.
 *
 * Every figure here is a COUNT over a whole collection, and the card's purpose
 * is to be the place a merchant notices a background job has stopped — a queue
 * that is always empty and a queue that is never drained look identical from
 * outside, and these chips are the only thing that tells them apart.
 *
 * That makes the ordering of the read load-bearing rather than cosmetic. An
 * unordered cap is answered in document-id order, so it returns a pseudo-random
 * slice of the collection; a count over a random slice is an UNDERCOUNT, and an
 * undercount is exactly the failure this card exists to catch. The chips would
 * report a shorter queue than the job will actually find, which reads as the
 * job keeping up.
 *
 * Neither read can be paged — a tally over page one is not a tally — so the
 * assertions pin the walk instead: ordered on the document name, capped, and
 * probed one past the cap so a ceiling that bites can say so.
 */

import { cleanup, render } from '@testing-library/react'

interface CapturedQuery {
  __path: string
  __limit: number
  __order: string
}

const mockListens: string[] = []
let checkoutRows: any[] = []
let alertRows: any[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
  query: (base: { __path: string }, ...constraints: any[]) => ({
    __path: base.__path,
    __limit:
      constraints.find((entry) => entry?.__constraint === 'limit')?.args?.[0] ??
      0,
    __order: String(
      constraints.find((entry) => entry?.__constraint === 'orderBy')?.args?.[0] ??
        '',
    ),
  }),
  limit: (...args: unknown[]) => ({ __constraint: 'limit', args }),
  orderBy: (...args: unknown[]) => ({ __constraint: 'orderBy', args }),
  documentId: () => '__name__',
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = require('firebase/firestore')
  return {
    useFirestore: () => ({}),
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
      // Ordering rides in the key beside the ceiling: an unordered cap of the
      // same size bills the same and answers a different question.
      mockListens.push(`${ref.__path}#${ref.__limit}#${ref.__order}`)
      if (ref.__path.endsWith('/checkouts')) return { data: checkoutRows }
      if (ref.__path.endsWith('/restockAlerts')) return { data: alertRows }
      return { data: [] }
    },
  }
})

jest.mock('@aglyn/aglyn', () => ({
  pluginDocsHelp: () => ({ href: '#', title: 'x' }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

jest.mock('./entitlement-gate.component', () => ({
  EntitlementUpsell: () => null,
  useCommerceEntitlement: () => ({
    ready: true,
    entitled: true,
    upgradeHref: '/x',
    planLabel: 'Pro',
  }),
}))

import { RecoveryQueueCard } from './recovery-queue-card.component'

/** An open checkout with an email, which is what the job acts on. */
const checkout = (id: number) => ({
  $id: `checkout-${id}`,
  status: 'open',
  email: `buyer${id}@example.com`,
  createdAtMs: Date.now() - 2 * 60 * 60 * 1000,
})

const alert = (id: number) => ({
  $id: `alert-${id}`,
  notifiedAtMs: null,
})

beforeEach(() => {
  mockListens.length = 0
  checkoutRows = []
  alertRows = []
})

afterEach(cleanup)

describe('the queue depths are counted over an ordered walk', () => {
  it('walks both collections by document name, capped and probed', () => {
    render(<RecoveryQueueCard hostId="host-1" />)

    expect([...mockListens].sort()).toEqual([
      'hosts/host-1/checkouts#201#__name__',
      'hosts/host-1/restockAlerts#201#__name__',
    ])
  })

  it('counts the window, never the probe row', () => {
    // 201 due a reminder. A card counting the probe would render 201.
    checkoutRows = Array.from({ length: 201 }, (_row, index) =>
      checkout(index),
    )

    const { getByText, queryByText } = render(
      <RecoveryQueueCard hostId="host-1" />,
    )

    expect(getByText('200 due a reminder')).toBeTruthy()
    expect(queryByText('201 due a reminder')).toBeNull()
  })

  it('says the count stopped short rather than reporting a shorter queue', () => {
    checkoutRows = Array.from({ length: 201 }, (_row, index) =>
      checkout(index),
    )
    alertRows = Array.from({ length: 201 }, (_row, index) => alert(index))

    const { getByText } = render(<RecoveryQueueCard hostId="host-1" />)

    expect(
      getByText(/Counted across 200 checkouts\. The reminder job reads the rest/),
    ).toBeTruthy()
    expect(
      getByText(/Counted across 200 alerts\. The notify job reads the rest/),
    ).toBeTruthy()
  })

  it('stays quiet at exactly the ceiling, where nothing was cut', () => {
    // THE CONTROL. A card that always disclosed would satisfy the case above
    // while telling every merchant their queue was truncated.
    checkoutRows = Array.from({ length: 200 }, (_row, index) =>
      checkout(index),
    )
    alertRows = Array.from({ length: 200 }, (_row, index) => alert(index))

    const { queryByText } = render(<RecoveryQueueCard hostId="host-1" />)

    expect(queryByText(/Counted across 200 checkouts/)).toBeNull()
    expect(queryByText(/Counted across 200 alerts/)).toBeNull()
  })
})
