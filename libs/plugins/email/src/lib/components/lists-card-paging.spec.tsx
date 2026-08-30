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
 * The email-list table walks the org's lists alphabetically (AGL-2501).
 *
 * The listener was `limit(50)` with no `orderBy` and a `localeCompare` in the
 * browser. Firestore answers an unordered limit in DOCUMENT-ID order over ids
 * from `createResourceUid()`, so an agency past fifty lists was shown an
 * arbitrary fifty arranged into a convincing A-to-Z page — a page missing most
 * of the alphabet, with nothing on screen to say so and no control asking for
 * the rest.
 *
 * The fixture is built so the two behaviours cannot agree: the ids run
 * OPPOSITE to the names, so an id-ordered window re-sorted by name starts at
 * the wrong letter.
 *
 * The subscriber counts are the other half. They were already server
 * aggregates per list — one `getCountFromServer` on each list's `members`
 * subcollection — and paging must not turn them into anything else. A count
 * beside a paged list is exactly where a page length gets mistaken for a
 * total, so the fixture gives every list a subscriber count larger than the
 * page.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { OrgListsCard } from './lists-card'

jest.setTimeout(30_000)

const TOTAL = 45

/**
 * `name` ascends with the index; the document id DESCENDS with it. An
 * id-ordered window therefore holds the END of the alphabet, and sorting that
 * window by name puts `List 35` on top where the walk puts `List 00`.
 */
const listDocs = Array.from({ length: TOTAL }, (_, index) => ({
  $id: `uid-${String(TOTAL - 1 - index).padStart(2, '0')}`,
  name: `List ${String(index).padStart(2, '0')}`,
}))

/** Every list's subscriber count, deliberately larger than a page. */
const MEMBERS_PER_LIST = 137

const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  // `orderBy` FILTERS as well as sorts: a document without the field is not
  // in the result at all.
  const matching = order
    ? all.filter((doc) => doc[order.orderBy] !== undefined)
    : all
  const sorted = [...matching].sort((a, b) => {
    const left = order ? a[order.orderBy] : a.$id
    const right = order ? b[order.orderBy] : b.$id
    return left < right ? -1 : left > right ? 1 : 0
  })
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

const FIRESTORE = {}
const SCOPE = { scope: ['orgs', 'org-1'] }
const mockConfirm = jest.fn(() => Promise.resolve())

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => SCOPE,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSizeState] = useState(10)
    const windowSize = pageSize * (page + 1)
    const built = build(windowSize + 1)
    const answered = firestoreAnswer(listDocs, built?.constraints ?? [])
    return {
      rows: answered.slice(page * pageSize, windowSize),
      hasMore: answered.length > windowSize,
      page,
      setPage,
      pageSize,
      setPageSize: (next: number) => {
        setPageSizeState(next)
        setPage(0)
      },
      status: 'success',
      fromCache: false,
    }
  },
}))

/**
 * Every QUERY the card and its panels build, by path.
 *
 * Queries, not collection references — the two are different purchases and the
 * distinction is the whole point. The card already takes one server AGGREGATE
 * per visible list for the `Subscribers` column, which builds a members
 * collection ref and bills a read per thousand index entries. A members QUERY
 * is a listener that returns documents, one per subscriber, and one of those
 * per row is what this file holds the line against.
 */
const mockBuiltQueries: string[] = []
/** Collection references built for anything — aggregates included. */
const mockBuiltRefs: string[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => {
    mockBuiltRefs.push(segments.join('/'))
    return { path: segments.join('/'), constraints: [] }
  },
  query: (base: any, ...constraints: unknown[]) => {
    mockBuiltQueries.push(base?.path ?? String(base))
    return {
      path: base?.path ?? base,
      constraints: [...(base?.constraints ?? []), ...constraints],
    }
  },
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  getCountFromServer: async () => ({
    data: () => ({ count: MEMBERS_PER_LIST }),
  }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/aglyn', () => {
  // Spread over the REAL module: the rule helpers the card asks about are
  // policy, and a stub of them would make the create button's refusal a
  // property of this file rather than of the code.
  const actual = jest.requireActual('@aglyn/aglyn')
  return {
    ...actual,
    createResourceUid: () => 'uid-new',
    pluginDocsHelp: () => undefined,
  }
})
jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 0 }) },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  /*
   * Stubbed for the CARD's own use. The overflow menu is deliberately NOT
   * stubbed — it is imported from its own module path, so it renders the real
   * shared component with the real `AppLink` inside it, which is the whole
   * point of the link assertions below.
   */
  AppLink: ({ href, children, onClick }: any) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
  MdiIcon: () => null,
}))

/**
 * The router the row click drives.
 *
 * `usePathname` is here because the REAL `AppLink` inside the real overflow
 * menu reads it to decide whether it is pointing at the current page.
 */
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: () => undefined }),
  usePathname: () => '/acme/hosts/site/emails/audiences',
}))

const BASE_PATH = '/acme/hosts/site/emails'

const mountCard = async () => {
  mockBuiltQueries.length = 0
  mockBuiltRefs.length = 0
  render(<OrgListsCard hostId="host-1" basePath={BASE_PATH} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const memberQueries = () =>
  mockBuiltQueries.filter((path) => path.endsWith('/members'))

const renderedNames = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('td')?.textContent?.trim() ?? '',
  )

describe('the email-list table walks the collection (AGL-2501)', () => {
  it('THE CONTROL: the two behaviours disagree at the page size', () => {
    // Compared at the WINDOW, because an unordered `limit()` and an ordered
    // one agree completely on a collection smaller than the cap — the one
    // shape that cannot tell a walk from a re-sorted sample.
    const page = TABLE_PAGE_SIZE_DEFAULT + 1
    const oldWindow = firestoreAnswer(listDocs, [{ limit: page }]).sort(
      (a, b) => String(a.name).localeCompare(String(b.name)),
    )
    const walked = firestoreAnswer(listDocs, [
      { orderBy: 'name' },
      { limit: page },
    ])
    expect(oldWindow[0].name).not.toBe(walked[0].name)
    expect(oldWindow.map((row: any) => row.name)).not.toContain('List 00')
  })

  it('shows the alphabetical FIRST page, not a re-sorted sample', async () => {
    await mountCard()
    const names = renderedNames()
    expect(names).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(names[0]).toBe('List 00')
    expect(names.at(-1)).toBe(
      `List ${String(TABLE_PAGE_SIZE_DEFAULT - 1).padStart(2, '0')}`,
    )
  })

  it('reaches every list by paging', async () => {
    await mountCard()
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedNames()[0]).toBe('List 10'))
    expect(renderedNames()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('the subscriber count is the LIST’s, not the page it sits on', async () => {
    // The shape this sweep keeps finding: a number beside a paged list that is
    // really the length of the page. Every count here is a server aggregate
    // over that list's own `members` subcollection, so it is larger than the
    // page and stays the same when the page changes.
    await mountCard()
    // Located by its HEADER rather than by a fixed cell index: the column is
    // what this asserts about, and a positional read turns any new column
    // into a failure of the count instead of a failure of the layout.
    const headers = Array.from(document.querySelectorAll('thead th')).map(
      (cell) => cell.textContent,
    )
    const column = headers.indexOf('Subscribers')
    expect(column).toBeGreaterThan(-1)
    const first = Array.from(document.querySelectorAll('tbody tr'))[0]
    expect(first.querySelectorAll('td')[column].textContent).toBe(
      String(MEMBERS_PER_LIST),
    )
    expect(MEMBERS_PER_LIST).toBeGreaterThan(TABLE_PAGE_SIZE_DEFAULT)
  })

  /*
   * A LISTENER PER ROW is the shape this page is one careless render away
   * from. Each list's `members` is a collection of PII with one document per
   * subscriber; opening one per row would charge an agency for the membership
   * of every list they own to render a page whose subject is the list of
   * lists. The membership is a ROUTE of its own now, so this table reads none
   * of it at any time — counted in queries BUILT rather than rows displayed,
   * because the two are indistinguishable on a fixture with one list.
   */
  it('reads no list’s MEMBERS at all', async () => {
    await mountCard()
    expect(renderedNames()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(memberQueries()).toEqual([])
    // THE CONTROL for the assertion above, and the distinction it turns on:
    // the aggregate refs ARE built, one per visible row, so "no member query"
    // is not "the card never touched the collection".
    expect(
      mockBuiltRefs.filter((path) => path.endsWith('/members')),
    ).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('THE TRAP: ordering on a field a writer can omit would hide lists', () => {
    // `name` is safe here only because `handleCreate` is the sole creator and
    // refuses an empty one. `createdAt` looks equally safe and is not: a
    // future writer that omits it does not mis-sort the table, it disappears
    // from it. Driven through the same evaluator the table is fed.
    const missingField = listDocs.map(({ $id, name }) => ({ $id, name }))
    expect(firestoreAnswer(missingField, [{ orderBy: 'createdAt' }])).toEqual([])
    expect(firestoreAnswer(missingField, [{ orderBy: 'name' }])).toHaveLength(
      TOTAL,
    )
  })
})
