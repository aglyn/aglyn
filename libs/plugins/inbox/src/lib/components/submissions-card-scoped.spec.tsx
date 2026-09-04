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
 * ONE CARD, TWO SUBJECTS — the site's inbox, and one form's.
 *
 * The forms plugin's detail surface needs a table of the submissions to THAT
 * form. It renders this card scoped rather than a table of its own, and the
 * reason is not tidiness: a second reader over `formSubmissions` would be a
 * second place for the unordered-`limit()` defect this card's own comment
 * warns about to come back, written by whoever needed a table that afternoon
 * and tested by nobody for it.
 *
 * So what is asserted here is that scoping is a NARROWING and not a fork: the
 * same query with one more predicate, the same paging, and the controls that
 * only make sense site-wide withheld rather than rendered inert.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import SubmissionsCard from './submissions-card.component'

/** Every query the card built, as the collection name and its predicates. */
let queries: Array<{ collection: string; predicates: string[] }>
/** Rows the paged reader hands back. */
let rows: Array<Record<string, unknown>>

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (factory: () => unknown) => ({
    // `null` is how a scoped card declines the catalog read entirely. Modeled
    // rather than smoothed over: the whole saving is that the query is never
    // built, and a mock that answered rows for a null factory would hide it.
    data: factory() === null ? undefined : [],
    status: 'success',
    fromCache: false,
  }),
  usePagedCollection: (factory: (pageLimit: number) => unknown) => {
    factory(11)
    return {
      rows,
      hasMore: false,
      page: 0,
      setPage: jest.fn(),
      pageSize: 10,
      setPageSize: jest.fn(),
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    __name: segments[segments.length - 1],
  }),
  query: (source: { __name: string }, ...constraints: unknown[]) => {
    const predicates = constraints
      .filter(
        (constraint): constraint is { __predicate: string } =>
          Boolean(constraint) &&
          typeof (constraint as { __predicate?: string }).__predicate ===
            'string',
      )
      .map((constraint) => constraint.__predicate)
    queries.push({ collection: source.__name, predicates })
    return source
  },
  limit: () => undefined,
  orderBy: (field: string) => ({ __predicate: `orderBy:${field}` }),
  where: (field: string, _op: string, value: string) => ({
    __predicate: `where:${field}=${value}`,
  }),
  doc: () => ({}),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <div>
      <h2>{header}</h2>
      {children}
    </div>
  ),
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('@aglyn/plugins-marketing/components/conversion-attribution.component', () => ({
  __esModule: true,
  default: () => null,
}))

beforeEach(() => {
  queries = []
  rows = []
})

const submissionsQuery = () =>
  queries.find((entry) => entry.collection === 'formSubmissions')

describe('scoped to one form', () => {
  it('narrows the SAME query rather than opening a different one', () => {
    render(<SubmissionsCard hostId="host-1" formId="form-1" />)
    expect(submissionsQuery()?.predicates).toEqual([
      'where:formId=form-1',
      // The order is not optional and not a nicety: an unordered `limit()` is
      // answered in document-id order, which is an arbitrary sample of a
      // site's messages that a client sort then arranges to look like a feed.
      'orderBy:createdAt',
    ])
  })

  it('does not read the site’s form catalog at all', () => {
    // The picker was that read's only consumer, and a scoped card has no
    // picker. Reading up to fifty form documents to draw a control that is
    // not on screen is the cost this scope removes.
    render(<SubmissionsCard hostId="host-1" formId="form-1" />)
    expect(queries.some((entry) => entry.collection === 'forms')).toBe(false)
  })

  it('renders no form picker', () => {
    // Withheld, not disabled: a control offering to widen the subject would
    // navigate the reader away from the page it is sitting on.
    render(<SubmissionsCard hostId="host-1" formId="form-1" />)
    expect(screen.queryByLabelText('Form')).toBeNull()
  })

  it('names the form in its heading', () => {
    render(<SubmissionsCard hostId="host-1" formId="form-1" />)
    expect(screen.getByText('Submissions to this form')).toBeTruthy()
  })

  it('tells an empty list apart from a form with no history under this id', () => {
    // A form adopted from a page has submissions filed under the NAME it was
    // sent with and none under its id. "No submissions yet" would read as a
    // form nobody has ever used, which is the opposite of what happened.
    render(<SubmissionsCard hostId="host-1" formId="form-1" />)
    expect(
      screen.getByText(/before it became a form entity/),
    ).toBeTruthy()
  })

  it('still renders the rows it is given', () => {
    rows = [
      {
        $id: 's1',
        formName: 'Contact',
        read: true,
        fields: { email: 'visitor@example.com' },
      },
    ]
    render(<SubmissionsCard hostId="host-1" formId="form-1" />)
    // The sender column and the message summary both carry the address, which
    // is the same row rendered whole rather than a duplicate row.
    expect(screen.getAllByText(/visitor@example.com/)).toHaveLength(2)
    expect(screen.getByText('email: visitor@example.com')).toBeTruthy()
  })
})

describe('THE CONTROL: unscoped, it is still the site-wide inbox', () => {
  it('takes no form predicate and DOES read the catalog', () => {
    // Otherwise every assertion above is satisfied by a card that never
    // reads the catalog and never offers a picker under any circumstances.
    render(<SubmissionsCard hostId="host-1" />)
    expect(submissionsQuery()?.predicates).toEqual(['orderBy:createdAt'])
    expect(queries.some((entry) => entry.collection === 'forms')).toBe(true)
  })
})
