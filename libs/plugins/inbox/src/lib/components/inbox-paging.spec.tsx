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
 * The inbox pages what it can page, and refuses to page what it cannot
 * (AGL-2501).
 *
 * All three of this page's reads were `limit(200)` with no `orderBy`, each
 * followed by a client sort on `createdAt`. Firestore answers an unordered
 * limit in DOCUMENT-ID order, so every one of them was an arbitrary two
 * hundred documents arranged newest-first — believable, and missing the rows a
 * site owner opens the inbox to find.
 *
 * The two halves get different treatment, and the difference is the point of
 * this file.
 *
 * ## Submissions: a walk
 *
 * One collection, one order, nothing else reads the window. It pages by query,
 * so the read is one page deep and the whole history is reachable.
 *
 * ## Members and leads: ordered, ceilinged, and paged in the BROWSER
 *
 * The contacts table is one list assembled from two collections, and a lead is
 * hidden when a member already exists on the same address. That dedupe is only
 * correct while both windows are whole. Paging the queries would compare a
 * page of leads against a page of members, so somebody who left their address
 * and later signed up would render as a Member on one page and again as a Lead
 * on another — one person, counted twice, in the list a site owner uses to
 * count people.
 *
 * The fixture is built to catch exactly that: five addresses appear in BOTH
 * collections, and they are placed so that the member and the lead land on
 * different pages.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { InboxConsolePage } from './inbox-console-page'

jest.setTimeout(30_000)

const SUBMISSIONS = 40
const MEMBERS = 24
const LEADS = 24
/** How many leads are the same person as a member. */
const OVERLAP = 5

/**
 * Ids run OPPOSITE to `createdAt` in every collection, so an id-ordered window
 * holds the OLDEST rows and re-sorting it by date — the old behaviour — starts
 * the list in the wrong place.
 */
const submissionDocs = Array.from({ length: SUBMISSIONS }, (_, index) => ({
  $id: `sub-${String(SUBMISSIONS - 1 - index).padStart(2, '0')}`,
  formName: `Form ${String(index).padStart(2, '0')}`,
  fields: { email: `sender${String(index).padStart(2, '0')}@example.test` },
  read: false,
  createdAt: { seconds: (SUBMISSIONS - index) * 86_400 },
}))

const memberDocs = Array.from({ length: MEMBERS }, (_, index) => ({
  $id: `mem-${String(MEMBERS - 1 - index).padStart(2, '0')}`,
  email: `member${String(index).padStart(2, '0')}@example.test`,
  createdAt: { seconds: (MEMBERS - index) * 86_400 },
}))

/**
 * The first five leads share an address with the FIRST five members.
 *
 * That placement is the whole point. The members sit on page one of the
 * assembled list and those leads would sit on page three, so a dedupe applied
 * one page at a time would not see the member when it reached the lead — and
 * would render both. A dedupe over the whole window drops the lead wherever it
 * falls.
 */
const leadDocs = Array.from({ length: LEADS }, (_, index) => ({
  $id: `lead-${String(LEADS - 1 - index).padStart(2, '0')}`,
  email:
    index < OVERLAP
      ? `member${String(index).padStart(2, '0')}@example.test`
      : `lead${String(index).padStart(2, '0')}@example.test`,
  source: 'signup',
  createdAt: { seconds: (LEADS - index) * 86_400 },
}))

const byCollection: Record<string, Array<Record<string, any>>> = {
  formSubmissions: submissionDocs,
  siteMembers: memberDocs,
  leads: leadDocs,
}

const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  // `orderBy` FILTERS as well as sorts.
  const matching = order
    ? all.filter((doc) => doc[order.orderBy] !== undefined)
    : all
  const sorted = [...matching].sort((a, b) => {
    const left = order ? a[order.orderBy]?.seconds ?? a[order.orderBy] : a.$id
    const right = order ? b[order.orderBy]?.seconds ?? b[order.orderBy] : b.$id
    const step = left < right ? -1 : left > right ? 1 : 0
    return order?.direction === 'desc' ? -step : step
  })
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** Every ceilinged read's cap, so a ceiling that stops probing is visible. */
let mockCeilingsAsked: number[] = []
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreDoc: () => ({
    data: undefined,
    status: 'success',
    fromCache: false,
  }),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (typeof cap === 'number') mockCeilingsAsked.push(cap)
    return {
      data: firestoreAnswer(byCollection[name] ?? [], built?.constraints ?? []),
      status: 'success',
      fromCache: false,
    }
  },
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSizeState] = useState(10)
    const windowSize = pageSize * (page + 1)
    const built = build(windowSize + 1)
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const answered = firestoreAnswer(
      byCollection[name] ?? [],
      built?.constraints ?? [],
    )
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

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/aglyn', () => ({
  formSpamCaughtNotice: () => null,
  // The REAL derivation, not a stub. The contacts dedupe below is asserted
  // against it, and a stub that returned the address unchanged would let a
  // casing-only duplicate render twice while the test stayed green.
  normalizeContactEmail: (input: unknown) => {
    const email = String(input ?? '').trim().toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320
      ? email
      : null
  },
  formSubmissionsPausedNotice: () => null,
  pluginDocsHelp: () => undefined,
  submissionMonthKey: () => '2026-08',
  visitorRecordRefusedCounterId: (kind: string) => `${kind}Refused`,
  visitorRecordsPausedNotice: () => null,
}))
jest.mock('@aglyn/plugins-email/components/campaigns-card', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock(
  '@aglyn/plugins-commerce/components/console/host-orders-card.component',
  () => ({ __esModule: true, default: () => null }),
)
jest.mock('@aglyn/shared-ui-next', () => ({
  // Every tab's content at once: the two tables under test live on different
  // tabs and a real tab strip would hide one of them from the DOM.
  HubTabs: ({ tabs }: { tabs: Array<{ id: string; content: ReactNode }> }) => (
    <div>
      {tabs.map((tab) => (
        <div key={tab.id} data-tab={tab.id}>
          {tab.content}
        </div>
      ))}
    </div>
  ),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))
jest.mock('../model/submission-presenter', () => ({
  relativeTime: () => 'just now',
  routingChips: () => [],
  senderHue: () => 200,
  // The From cell renders `sender.label`, which is the address the fixture
  // keys its assertions on.
  submissionSender: (fields: any) => ({
    label: fields?.email ?? '',
    initial: 'S',
  }),
  submissionSummary: (submission: any) => submission.formName ?? '',
}))

beforeEach(() => {
  mockCeilingsAsked = []
})

const mountPage = async () => {
  render(<InboxConsolePage hostId="host-1" entitled />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The tables, in DOM order: submissions first, then contacts. */
const tables = () => Array.from(document.querySelectorAll('table'))
const rowsOf = (table: Element) =>
  Array.from(table.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map(
      (cell) => cell.textContent?.trim() ?? '',
    ),
  )
const nextPageButtons = () =>
  Array.from(document.querySelectorAll('button[aria-label="Go to next page"]'))

describe('the submissions table walks the inbox (AGL-2501)', () => {
  it('THE CONTROL: the two behaviours disagree at the page size', () => {
    const page = TABLE_PAGE_SIZE_DEFAULT + 1
    const oldWindow = firestoreAnswer(submissionDocs, [{ limit: page }]).sort(
      (a, b) => b.createdAt.seconds - a.createdAt.seconds,
    )
    const walked = firestoreAnswer(submissionDocs, [
      { orderBy: 'createdAt', direction: 'desc' },
      { limit: page },
    ])
    expect(oldWindow[0].$id).not.toBe(walked[0].$id)
    // The old window held the OLDEST rows: the newest submission was not in it
    // at all, which is what "no form submissions yet" was said about.
    expect(oldWindow.map((row: any) => row.$id)).not.toContain('sub-39')
  })

  it('shows the newest page and reaches the rest by paging', async () => {
    await mountPage()
    const first = rowsOf(tables()[0])
    expect(first).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(first[0][0]).toContain('sender00@example.test')

    fireEvent.click(nextPageButtons()[0])
    await waitFor(() =>
      expect(rowsOf(tables()[0])[0][0]).toContain('sender10@example.test'),
    )
  })
})

describe('the contacts table cannot be paged by the query (AGL-2501)', () => {
  it('THE CONTROL: the fixture puts a duplicated person on two pages', () => {
    // Without this the dedupe assertion below would hold trivially — a fixture
    // whose overlapping rows all land on page one cannot tell a whole-window
    // dedupe from a per-page one.
    const shared = leadDocs.slice(0, OVERLAP).map((lead) => lead.email)
    expect(shared).toHaveLength(OVERLAP)
    const memberIndex = memberDocs.findIndex(
      (member) => member.email === shared[0],
    )
    const leadIndex = leadDocs.findIndex((lead) => lead.email === shared[0])
    expect(Math.floor(memberIndex / TABLE_PAGE_SIZE_DEFAULT)).not.toBe(
      Math.floor((MEMBERS + leadIndex) / TABLE_PAGE_SIZE_DEFAULT),
    )

    // And the regression this guards against, computed rather than described:
    // a dedupe applied to one server page at a time lets every overlapping
    // address through, because the member it should have matched is on a page
    // this one never sees.
    const perPage: string[] = []
    const assembled = [
      ...memberDocs.map((member) => ({ ...member, kind: 'member' })),
      ...leadDocs.map((lead) => ({ ...lead, kind: 'lead' })),
    ]
    for (let page = 0; page * TABLE_PAGE_SIZE_DEFAULT < assembled.length; page += 1) {
      const start = page * TABLE_PAGE_SIZE_DEFAULT
      const window = assembled.slice(start, start + TABLE_PAGE_SIZE_DEFAULT)
      const membersHere = window.filter((row) => row.kind === 'member')
      for (const row of window) {
        if (
          row.kind === 'lead' &&
          !membersHere.some((member) => member.email === row.email)
        ) {
          perPage.push(row.email)
        }
      }
    }
    for (const email of shared) expect(perPage).toContain(email)
  })

  it('shows each person ONCE across every page', async () => {
    await mountPage()
    const seen: string[] = []
    // The contacts table is the second one on the page.
    for (let guard = 0; guard < 20; guard += 1) {
      for (const row of rowsOf(tables()[1])) seen.push(row[0])
      const next = nextPageButtons()[1] as HTMLButtonElement
      if (!next || next.disabled) break
      fireEvent.click(next)
      await waitFor(() => expect(rowsOf(tables()[1]).length).toBeGreaterThan(0))
    }
    const addresses = seen.map((cell) => cell.replace(/\s+/g, ''))
    expect(new Set(addresses).size).toBe(addresses.length)
    // And the list is the union minus the overlap, not the sum of the two
    // collections.
    expect(addresses).toHaveLength(MEMBERS + LEADS - OVERLAP)
  })

  it('a duplicated address renders as the MEMBER, on one page only', async () => {
    await mountPage()
    const shared = leadDocs[0].email
    const found: string[] = []
    for (let guard = 0; guard < 20; guard += 1) {
      for (const row of rowsOf(tables()[1])) {
        if (row[0].replace(/\s+/g, '').startsWith(shared)) found.push(row[1])
      }
      const next = nextPageButtons()[1] as HTMLButtonElement
      if (!next || next.disabled) break
      fireEvent.click(next)
      await waitFor(() => expect(rowsOf(tables()[1]).length).toBeGreaterThan(0))
    }
    expect(found).toEqual(['Member'])
  })

  it('both contact reads PROBE past their ceiling', async () => {
    await mountPage()
    // A ceiling with no probe cannot tell a full list from a truncated one:
    // `length === ceiling` is wrong at exactly the count that equals it. Two
    // reads, both asking for one document more than they will render.
    const contactCeilings = mockCeilingsAsked.filter((cap) => cap > 100)
    expect(contactCeilings).toEqual([201, 201])
  })
})
