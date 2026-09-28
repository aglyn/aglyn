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
 * The inbox pages every list by its query (AGL-2501 → AGL-3321).
 *
 * All three of this page's reads were `limit(200)` with no `orderBy`, each
 * followed by a client sort on `createdAt`. Firestore answers an unordered
 * limit in DOCUMENT-ID order, so every one of them was an arbitrary two
 * hundred documents arranged newest-first — believable, and missing the rows a
 * site owner opens the inbox to find.
 *
 * ## Submissions: a walk
 *
 * One collection, one order. It pages by query, so the read is one page deep
 * and the whole history is reachable — and every filter and search word is a
 * predicate on that walk, so a match past the first page is found.
 *
 * ## Members and leads: two walks
 *
 * The contacts table used to assemble one list from two ceilinged windows and
 * hide a lead whose address matched a member. That dedupe is only correct
 * while both windows are whole, so it went with the windows: each collection
 * is its own list now, chosen by a toggle, and each pages its own query.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { messageSearchFields } from '@aglyn/aglyn/app-utils/message-search'
import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { InboxConsolePage } from './inbox-console-page'
import { INBOX_CONSOLE_SECTIONS } from './inbox-console-sections'

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
  // The search keys the submit route stamps (AGL-3321).
  ...messageSearchFields({ email: `sender${String(index).padStart(2, '0')}@example.test` }),
  // Every FIFTH is unread; the rest have been opened.
  read: index % 5 !== 0,
  createdAt: { seconds: (SUBMISSIONS - index) * 86_400 },
}))

/** The one adopted form, for the Submissions section's filter. */
const formDocs = [{ $id: 'form-adopted', displayName: 'Contact' }]

const memberDocs = Array.from({ length: MEMBERS }, (_, index) => ({
  $id: `mem-${String(MEMBERS - 1 - index).padStart(2, '0')}`,
  email: `member${String(index).padStart(2, '0')}@example.test`,
  displayName: `Member M${String(index).padStart(2, '0')}`,
  // The name's words; the writer adds the address's (`memberSearchTokens`).
  searchTokens: nameSearchTokens(`Member M${String(index).padStart(2, '0')}`),
  createdAt: { seconds: (MEMBERS - index) * 86_400 },
}))

/**
 * The first five leads share an address with the FIRST five members: the
 * same person, a member in one collection and a lead in the other.
 */
const leadDocs = Array.from({ length: LEADS }, (_, index) => ({
  $id: `lead-${String(LEADS - 1 - index).padStart(2, '0')}`,
  email:
    index < OVERLAP
      ? `member${String(index).padStart(2, '0')}@example.test`
      : `lead${String(index).padStart(2, '0')}@example.test`,
  sources: ['signup'],
  // Scoped to the site (AGL-3275): the collection is org-wide, and a lead
  // naming no scope is visible to nobody.
  visibleTo: ['host:host-1'],
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
    equalities.every((clause) => {
      if (clause.where === '__name__') return true
      /*
       * `array-contains-any` is how a scoped read narrows the org lead
       * collection (AGL-3275). Applied, not ignored: a double that treated
       * it as an equality drops every row and reports the list empty, and
       * one that skipped it would pass a query serving one agency client
       * another client's people.
       */
      if (clause.op === 'array-contains-any') {
        const held = doc[clause.where]
        return (
          Array.isArray(held) &&
          (clause.value as unknown[]).some((token) => held.includes(token))
        )
      }
      return doc[clause.where] === clause.value
    }),
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
/** The plan each list query asked, by collection, in order. */
let mockPlans: Array<{ name: string; plan: any }> = []
const FIRESTORE = {}

const mockRecountFormStats = jest.fn(async (_path: string, _body: unknown) => true)
jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The form counters' recount (AGL-3330); `form-stats.spec.ts` owns what it writes.
  usePluginApiPost: () => mockRecountFormStats,
  // The lead silo is the org's (AGL-3275), so these cards resolve it.
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useFirestore: () => FIRESTORE,
  // The signed-in account a member removal is authorized as (AGL-3308).
  useUser: () => ({ data: null }),
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
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
}))

/*
 * Every list's query (AGL-3321), answered by the shared double over the
 * collection the card opened: the real plan, each predicate applied as
 * Firestore would, the plan's one order, pages of the requested size. The
 * plan is recorded so a filter can be asserted on the QUERY the page issued,
 * not only on what came back — a filter that never reached Firestore and one
 * that reached it wrongly are different bugs, and the rows alone cannot tell
 * them apart.
 */
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const actual = jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query')
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...actual,
    useListQuery: (options: { collection: { path: string } | null }) => {
      const name = String(options.collection?.path ?? '').split('/').pop() ?? ''
      const result = useListQueryDouble(() => byCollection[name] ?? [], options)
      if (name) mockPlans.push({ name, plan: result.plan })
      return result
    },
  }
})

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
  formSubmissionsPausedNotice: () => null,
  pluginDocsHelp: () => undefined,
  submissionMonthKey: () => '2026-08',
  visitorRecordRefusedCounterId: (kind: string) => `${kind}Refused`,
  visitorRecordsPausedNotice: () => null,
}))
jest.mock('@aglyn/shared-ui-next', () => ({
  // The rail's chrome, passed through (AGL-2501). The two tables under test
  // are two SECTIONS now, so each describe mounts the one it is about — a
  // stub cannot draw a section the URL does not name, because the page never
  // builds it.
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

const BASE_PATH = '/acme/hosts/shop/inbox'

/**
 * The page as the shell mounts it, at the section the URL names (AGL-2501).
 *
 * The section is a REQUIRED argument rather than a defaulted one: each table
 * below lives on a section of its own, and a mount that opened the wrong one
 * would leave the assertions reading an empty document instead of failing.
 */
const mountPage = async (section: 'submissions' | 'contacts') => {
  render(
    <InboxConsolePage
      hostId="host-1"
      entitled
      basePath={BASE_PATH}
      sections={INBOX_CONSOLE_SECTIONS.map((item) => ({
        id: item.id,
        label: item.label,
        href: `${BASE_PATH}/${item.id}`,
        visible: true,
      }))}
      section={section}
      segments={[section]}
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The lists on screen. One section is open, so there is exactly one. */
const tables = () => Array.from(document.querySelectorAll('[role="grid"]'))
const rowsOf = (grid: Element) =>
  Array.from(grid.querySelectorAll('[role="row"][data-id]')).map((row) =>
    Array.from(row.querySelectorAll('[role="gridcell"]')).map(
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
    await mountPage('submissions')
    const first = rowsOf(tables()[0])
    expect(first).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(first[0][0]).toContain('sender00@example.test')

    fireEvent.click(nextPageButtons()[0])
    await waitFor(() =>
      expect(rowsOf(tables()[0])[0][0]).toContain('sender10@example.test'),
    )
  })
})

describe('each contacts list walks its own query (AGL-3321)', () => {
  /** Every address a list shows, walking its pages to the end. */
  const walk = async () => {
    const seen: string[] = []
    for (let guard = 0; guard < 20; guard += 1) {
      for (const row of rowsOf(tables()[0])) seen.push(row[0].replace(/\s+/g, ''))
      const next = nextPageButtons()[0] as HTMLButtonElement
      if (!next || next.disabled) break
      fireEvent.click(next)
      await waitFor(() => expect(rowsOf(tables()[0]).length).toBeGreaterThan(0))
    }
    return seen
  }

  it('shows the newest page of members and reaches every one of them by paging', async () => {
    await mountPage('contacts')
    const first = rowsOf(tables()[0])
    expect(first).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(first[0][0]).toContain('member00@example.test')
    const seen = await walk()
    expect(new Set(seen).size).toBe(MEMBERS)
  })

  it('lists every lead on the Leads toggle, the ones who are also members included', async () => {
    await mountPage('contacts')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leads' }))
    })
    const seen = await walk()
    // No dedupe across the two collections: a person who left their address
    // and later signed up is a lead here and a member in Members.
    expect(seen).toHaveLength(LEADS)
    expect(seen.filter((address) => address.startsWith('member'))).toHaveLength(OVERLAP)
  })

  it('finds a member by name past the first page, on the query', async () => {
    await mountPage('contacts')
    expect(rowsOf(tables()[0]).map((row) => row[0])).not.toContain('member21@example.test')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'm21' } })
    await waitFor(() => {
      const rows = rowsOf(tables()[0])
      expect(rows).toHaveLength(1)
      expect(rows[0][0]).toContain('member21@example.test')
    })
    const members = [...mockPlans].reverse().find((entry) => entry.name === 'siteMembers')
    expect(members?.plan.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'm21' },
    ])
  })
})

/**
 * Choose `option` in the grid Filters panel's select named `label`. The
 * panel opens from the toolbar's Filters button; a MUI select opens on
 * mousedown, not click.
 */
const openFormFilter = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  const column = await screen.findByRole('combobox', { name: 'Column' })
  fireEvent.mouseDown(column)
  const formColumn = await screen.findByRole('option', { name: 'Form' })
  await act(async () => {
    fireEvent.click(formColumn)
  })
  const value = await screen.findByRole('combobox', { name: 'Value' })
  fireEvent.mouseDown(value)
  await waitFor(() =>
    expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0),
  )
}

/**
 * The Form filter's choices, read from the open value select, without the
 * grid's own empty choice (its first option, which carries no value).
 */
const formFilterOptions = () =>
  Array.from(document.querySelectorAll('[role="option"]'))
    .filter((node) => node.getAttribute('data-value'))
    .map((node) => node.textContent?.trim() ?? '')

/**
 * The Inbox stays the site-wide list and gains one control.
 *
 * `?form=` filtered on `formName` — the caption — so a rename split the
 * history and two pages sharing a label were one list. This filter is an
 * equality on `formId`. Every fixture submission carries a DIFFERENT
 * `formName`, so a filter that still read the caption could never return the
 * form's whole history and cannot pass these by accident.
 */
describe('the submissions section can narrow to one form', () => {
  /** The predicates of the submissions query the page asked most recently. */
  const submissionsQuery = () =>
    [...mockPlans].reverse().find((entry) => entry.name === 'formSubmissions')?.plan
      .filters ?? []

  beforeEach(() => {
    mockPlans = []
  })

  it('issues NO form clause until one is chosen', async () => {
    await mountPage('submissions')
    // The site-wide question — "who is waiting for a reply" — does not
    // decompose by form, so the default must stay the whole inbox.
    expect(submissionsQuery()).toEqual([])
  })

  it('offers the site\'s forms and narrows the QUERY when one is picked', async () => {
    // The wiring proof, end to end: open the picker, choose the form, and
    // read the clause the page then issued. A filter that renders but never
    // reaches the query would pass a rows-only assertion on page one, where
    // the unfiltered and filtered lists can happen to agree.
    // The picker is the grid's own Filters panel (AGL-3317), whose Form
    // clause the query serves.
    await mountPage('submissions')
    await openFormFilter()
    const option = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((node) => node.textContent?.trim() === 'Contact')
    expect(option).toBeTruthy()

    await act(async () => {
      fireEvent.click(option as Element)
    })
    expect(submissionsQuery()).toEqual([
      { path: 'formId', op: '==', value: 'form-adopted' },
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
    await openFormFilter()
    return formFilterOptions()
  }

  it('says so when the catalog is larger than the window', async () => {
    byCollection.forms = formsFixture(WINDOW + 12)
    await mountPage('submissions')
    expect(await optionLabels()).toHaveLength(WINDOW)
    // The disclosure, in the reader's own words rather than a class name.
    expect(document.body.textContent).toContain(
      `The Form filter offers the first ${WINDOW}`,
    )
  })

  it('THE CONTROL: says nothing when the whole catalog fits', async () => {
    // Without this row the assertion above is satisfied by a page that cries
    // truncation permanently, which is its own way of being wrong.
    byCollection.forms = formsFixture(WINDOW)
    await mountPage('submissions')
    expect(await optionLabels()).toHaveLength(WINDOW)
    expect(document.body.textContent).not.toContain('The Form filter offers the first')
  })

  it('reads one PAST the window, which is how truncation is knowable', async () => {
    // A query bounded at exactly the window cannot distinguish "the catalog
    // is 50" from "the catalog is 5,000". The probe is the mechanism the
    // disclosure above depends on, so it is pinned on the QUERY.
    byCollection.forms = formsFixture(WINDOW + 12)
    await mountPage('submissions')
    expect(mockCeilingsAsked).toContain(WINDOW + 1)
  })
})

describe('the submissions list searches and filters on its query (AGL-3321)', () => {
  const submissionsPlan = () =>
    [...mockPlans].reverse().find((entry) => entry.name === 'formSubmissions')?.plan

  it('finds a sender past the first page', async () => {
    await mountPage('submissions')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sender14' } })
    await waitFor(() => {
      const rows = rowsOf(tables()[0])
      expect(rows).toHaveLength(1)
      expect(rows[0].join(' ')).toContain('sender14@example.test')
    })
    expect(submissionsPlan()?.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'sender14' },
    ])
  })

  it('narrows to the unread on the query, past the first page', async () => {
    await mountPage('submissions')
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Column' }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Read' }))
    })
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Value' }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Unread' }))
    })
    await waitFor(() =>
      expect(submissionsPlan()?.filters).toEqual([{ path: 'read', op: '==', value: false }]),
    )
    // Every fifth of forty: eight unread, the oldest of them far past the
    // page the list opened on.
    await waitFor(() => expect(rowsOf(tables()[0])).toHaveLength(8))
    expect(rowsOf(tables()[0]).some((row) => row[0].includes('sender35@example.test'))).toBe(true)
  })
})
