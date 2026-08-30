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
  // Every THIRD submission belongs to the adopted form; the rest predate it
  // and carry no `formId` at all — the state most of a real site's archive is
  // in on the day a form is adopted.
  ...(index % 3 === 0 ? { formId: 'form-adopted' } : {}),
  formName: `Form ${String(index).padStart(2, '0')}`,
  fields: { email: `sender${String(index).padStart(2, '0')}@example.test` },
  read: false,
  createdAt: { seconds: (SUBMISSIONS - index) * 86_400 },
}))

/** The one adopted form, for the Submissions tab's filter. */
const formDocs = [{ $id: 'form-adopted', displayName: 'Contact' }]

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
  forms: formDocs,
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
  // Equality predicates are APPLIED, not ignored. A double that dropped them
  // would answer the unfiltered list for every filter and go green on a form
  // filter that was never wired to the query at all.
  const equalities = constraints.filter((item) => item && 'where' in item)
  // `orderBy` FILTERS as well as sorts — EXCEPT on `__name__`, the document
  // id, which is the one path every document has. That is exactly why a list
  // that must not drop rows orders by it.
  const matching = (
    order && order.orderBy !== '__name__'
      ? all.filter((doc) => doc[order.orderBy] !== undefined)
      : all
  ).filter((doc) =>
    equalities.every((clause) =>
      clause.where === '__name__'
        ? true
        : doc[clause.where] === clause.value,
    ),
  )
  const sorted = [...matching].sort((a, b) => {
    const key = (doc: Record<string, any>) =>
      !order || order.orderBy === '__name__'
        ? doc.$id
        : doc[order.orderBy]?.seconds ?? doc[order.orderBy]
    const left = key(a)
    const right = key(b)
    const step = left < right ? -1 : left > right ? 1 : 0
    return order?.direction === 'desc' ? -step : step
  })
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** Every ceilinged read's cap, so a ceiling that stops probing is visible. */
let mockCeilingsAsked: number[] = []
/** Every paged query the page built, so a filter can be asserted on it. */
let mockPagedQueries: Array<{ name: string; constraints: any[] }> = []
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
    // Recorded so a filter can be asserted on the QUERY the page issued, not
    // only on what came back. A filter that never reached Firestore and one
    // that reached it wrongly are different bugs and the rows alone cannot
    // tell them apart.
    mockPagedQueries.push({ name, constraints: built?.constraints ?? [] })
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
  where: (field: string, op: string, value: unknown) => ({
    where: field,
    op,
    value,
  }),
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/aglyn', () => ({
  formSpamCaughtNotice: () => null,
  FORMS_MAX_PER_HOST: 50,
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

/**
 * The Inbox stays the site-wide list and gains one control.
 *
 * `?form=` filtered on `formName` — the caption — so a rename split the
 * history and two pages sharing a label were one list. This filter is an
 * equality on `formId`. Every fixture submission carries a DIFFERENT
 * `formName`, so a filter that still read the caption could never return the
 * form's whole history and cannot pass these by accident.
 */
describe('the submissions tab can narrow to one form', () => {
  /** The submissions query the page built most recently. */
  const submissionsQuery = () =>
    [...mockPagedQueries].reverse().find((q) => q.name === 'formSubmissions')
        ?.constraints ?? []

  beforeEach(() => {
    mockPagedQueries = []
  })

  it('issues NO form clause until one is chosen', async () => {
    await mountPage()
    // The site-wide question — "who is waiting for a reply" — does not
    // decompose by form, so the default must stay the whole inbox.
    expect(submissionsQuery().filter((c: any) => 'where' in c)).toEqual([])
  })

  it('offers the site\'s forms and narrows the QUERY when one is picked', async () => {
    // The wiring proof, end to end: open the picker, choose the form, and
    // read the clause the page then issued. A filter that renders but never
    // reaches the query would pass a rows-only assertion on page one, where
    // the unfiltered and filtered lists can happen to agree.
    await mountPage()
    const combobox = document.querySelector(
      '[role="combobox"]',
    ) as HTMLElement | null
    expect(combobox).toBeTruthy()
    // A MUI select opens on mousedown, not click.
    fireEvent.mouseDown(combobox as HTMLElement)
    await waitFor(() =>
      expect(document.body.textContent).toContain('All forms'),
    )
    const option = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((node) => node.textContent?.trim() === 'Contact')
    expect(option).toBeTruthy()

    await act(async () => {
      fireEvent.click(option as Element)
    })
    expect(submissionsQuery().filter((c: any) => 'where' in c)).toEqual([
      { where: 'formId', op: '==', value: 'form-adopted' },
    ])
  })

  it('narrows on formId, and the rows are the FORM\'s', async () => {
    // Asserted through the same double the page's own query runs through: an
    // equality on `formId` returns every row of that form regardless of the
    // caption each was filed under.
    const rows = firestoreAnswer(submissionDocs, [
      { where: 'formId', op: '==', value: 'form-adopted' },
      { orderBy: 'createdAt', direction: 'desc' },
    ])
    expect(rows.length).toBe(submissionDocs.filter((s) => s.formId).length)
    expect(rows.every((row) => row.formId === 'form-adopted')).toBe(true)
    // The captions genuinely differ, so a `formName` equality could have
    // returned at most one of these.
    expect(new Set(rows.map((row) => row.formName)).size).toBeGreaterThan(1)
  })

  it('leaves unstamped history reachable under all forms', async () => {
    // An unmatched submission is still in the Inbox — missing from ONE form's
    // list, which is visible and recoverable, rather than filed under a form
    // it was never sent to.
    expect(submissionDocs.some((row) => !row.formId)).toBe(true)
    const unfiltered = firestoreAnswer(submissionDocs, [
      { orderBy: 'createdAt', direction: 'desc' },
    ])
    expect(unfiltered.length).toBe(submissionDocs.length)
  })
})

describe('the form filter never presents a cut list as the whole list', () => {
  /*
   * `FORMS_MAX_PER_HOST` is a read window, not a cap on the collection: a
   * staff-set per-org `formsPerHost` override can put more forms on a site
   * than the window shows. The invariant is therefore not about the number —
   * any number can be exceeded — but about what a reader is told: a list cut
   * at the window must say it was cut, because "not in this filter" and "no
   * such form" are otherwise the same answer on screen.
   *
   * `FORMS_MAX_PER_HOST` is mocked to 50 above, so the fixture can straddle
   * it cheaply.
   */
  const WINDOW = 50
  const formsFixture = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      $id: `form-${String(index).padStart(3, '0')}`,
      displayName: `Form ${String(index).padStart(3, '0')}`,
    }))
  const original = byCollection.forms

  afterEach(() => {
    byCollection.forms = original
  })

  const optionLabels = async () => {
    const combobox = document.querySelector(
      '[role="combobox"]',
    ) as HTMLElement | null
    expect(combobox).toBeTruthy()
    fireEvent.mouseDown(combobox as HTMLElement)
    await waitFor(() =>
      expect(document.body.textContent).toContain('All forms'),
    )
    return Array.from(document.querySelectorAll('[role="option"]'))
      .map((node) => node.textContent?.trim() ?? '')
      .filter((label) => label !== 'All forms')
  }

  it('says so when the catalog is larger than the window', async () => {
    byCollection.forms = formsFixture(WINDOW + 12)
    await mountPage()
    expect(await optionLabels()).toHaveLength(WINDOW)
    // The disclosure, in the reader's own words rather than a class name.
    expect(document.body.textContent).toContain(`Showing the first ${WINDOW}`)
  })

  it('THE CONTROL: says nothing when the whole catalog fits', async () => {
    // Without this row the assertion above is satisfied by a page that cries
    // truncation permanently, which is its own way of being wrong.
    byCollection.forms = formsFixture(WINDOW)
    await mountPage()
    expect(await optionLabels()).toHaveLength(WINDOW)
    expect(document.body.textContent).not.toContain('Showing the first')
  })

  it('reads one PAST the window, which is how truncation is knowable', async () => {
    // A query bounded at exactly the window cannot distinguish "the catalog
    // is 50" from "the catalog is 5,000". The probe is the mechanism the
    // disclosure above depends on, so it is pinned on the QUERY.
    byCollection.forms = formsFixture(WINDOW + 12)
    await mountPage()
    expect(mockCeilingsAsked).toContain(WINDOW + 1)
  })
})
