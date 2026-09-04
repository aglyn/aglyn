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
 * The membership table walks the collection, and says what it is showing.
 *
 * A list's members are the audience a campaign mails. A table that showed an
 * arbitrary window of them — which is what `limit()` with no `orderBy` answers,
 * in document-id order — would be the AGL-2501 failure again on the collection
 * where it matters most: an operator checking whether somebody is on a list
 * would be told no about a person who is.
 *
 * The fixture is built so the two candidate orderings cannot agree: ids run
 * OPPOSITE to the addresses, so an id-ordered window re-sorted by address
 * starts in the wrong place.
 *
 * ## The trap this file exists to hold
 *
 * `addedAt` is the column a reader would order on, and it is the wrong one.
 * `orderBy` FILTERS as well as sorts — a document without the field is not in
 * the result at all — and `list-members.ts` stamps `addedAt` only when a row is
 * CREATED, adopting rows written under two legacy ids that predate it. Ordering
 * on it would drop the oldest members from their own list, silently. The
 * document id is the one key every row has.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { soloConsentGroup } from '@aglyn/aglyn'
import { ListMembersPanel } from './list-members-panel'

jest.setTimeout(30_000)

const TOTAL = 45

/** The site this console is being read as, and the one holding every grant. */
const HOST = 'host-1'

/**
 * The address ascends with the index; the document id DESCENDS with it. An
 * id-ordered window therefore holds the END of the alphabet, and re-sorting
 * that window by address puts `p35@` on top where the walk puts `p00@`.
 *
 * Every row carries `addedAt` EXCEPT the two legacy-keyed ones, which is the
 * production shape: adopted rows predate the field.
 */
const memberDocs = Array.from({ length: TOTAL }, (_, index) => ({
  $id: `key-${String(TOTAL - 1 - index).padStart(2, '0')}`,
  email: `p${String(index).padStart(2, '0')}@lumen.co`,
  name: `Person ${index}`,
  via: index % 2 === 0 ? 'manual' : 'rule',
  source: 'newsletter',
  ...(index < 2
    ? {}
    : { addedAt: { toDate: () => new Date(Date.UTC(2026, 0, 1)) } }),
  /*
   * The basis NESTED UNDER THE HOST, which is where `enrollListMember` puts
   * it. It sat at the top of this fixture while the writer had already moved
   * it into `marketingConsentByHost`, so the panel's top-level reads found it
   * here and found nothing in production — a test double in a shape the
   * product never writes, which is how a column that reported every member of
   * every list as having no basis went on passing.
   */
  ...(index % 3 === 0
    ? {
        marketingConsentByHost: {
          [HOST]: {
            marketingConsent: true,
            marketingConsentBasis: 'operator-attested',
            marketingConsentByUid: 'uid-editor',
            marketingConsentAtMs: Date.UTC(2026, 1, 2),
          },
        },
      }
    : index % 3 === 1
      ? {
          marketingConsentByHost: {
            [HOST]: {
              marketingConsent: true,
              marketingConsentBasis: 'contact-opt-in',
              marketingConsentAtMs: Date.UTC(2025, 5, 6),
            },
          },
        }
      : {}),
}))

/**
 * The evaluator the panel's query is fed through. `orderBy` both sorts AND
 * drops documents missing the field, exactly as Firestore does — which is the
 * behaviour the trap below turns on.
 */
const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const field = order?.orderBy
  const matching = order
    ? all.filter((doc) => (field === '__name__' ? true : doc[field] !== undefined))
    : all
  const sorted = [...matching].sort((a, b) => {
    const left = field === '__name__' || !field ? a.$id : a[field]
    const right = field === '__name__' || !field ? b.$id : b[field]
    return left < right ? -1 : left > right ? 1 : 0
  })
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSizeState] = useState(TABLE_PAGE_SIZE_DEFAULT)
    const windowSize = pageSize * (page + 1)
    const built = build(windowSize + 1)
    const answered = firestoreAnswer(memberDocs, built?.constraints ?? [])
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
  orderBy: (field: string) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

const confirm = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
/*
 * The barrel, stubbed for what the PANEL takes from it. `RowActionsMenu` is
 * imported from its own module path and is therefore the real shared
 * component, which is the point — a stubbed menu would leave the assertions
 * about where the removal lives testing the stub.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm }),
}))

const mountPanel = async () => {
  render(
    <ListMembersPanel
      hostId={HOST}
      consentGroup={soloConsentGroup(HOST)}
      scope={['orgs', 'org-1']}
      listId="list-1"
      listName="Newsletter"
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const bodyRows = () => Array.from(document.querySelectorAll('tbody tr'))
const cellsAt = (row: Element) =>
  Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim())
const columnIndex = (header: string) =>
  Array.from(document.querySelectorAll('thead th'))
    .map((cell) => cell.textContent)
    .indexOf(header)
const addressesShown = () =>
  bodyRows().map((row) => row.querySelector('td')?.textContent?.trim() ?? '')

/**
 * Take the first listed subscriber off the list, through the affordance the
 * row actually has.
 *
 * Removing lives in the row's overflow menu rather than as a red `Remove`
 * button in the row — it is a destructive act that sat one mis-click from the
 * cells beside it — so reaching it is the menu, then the item.
 */
const pressRemove = () => {
  fireEvent.click(
    screen.getByRole('button', {
      name: `More actions for ${addressesShown()[0]}`,
    }),
  )
  fireEvent.click(
    screen.getByRole('menuitem', { name: 'Remove from this list' }),
  )
}

describe('the membership table walks the collection', () => {
  it('THE CONTROL: the two orderings disagree at the page size', () => {
    // Compared at the WINDOW, because an unordered `limit()` and an ordered
    // one agree completely on a collection smaller than the cap — the one
    // shape that cannot tell a walk from a re-sorted sample.
    const page = TABLE_PAGE_SIZE_DEFAULT + 1
    const resorted = firestoreAnswer(memberDocs, [{ limit: page }]).sort(
      (a, b) => String(a.email).localeCompare(String(b.email)),
    )
    const walked = firestoreAnswer(memberDocs, [
      { orderBy: '__name__' },
      { limit: page },
    ])
    expect(resorted[0].email).not.toBe(walked[0].email)
  })

  it('shows the FIRST page of the id walk, not a re-sorted sample', async () => {
    await mountPanel()
    const shown = addressesShown()
    expect(shown).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    // `key-00` is the highest-indexed address, because the ids run backwards.
    expect(shown[0]).toBe(`p${String(TOTAL - 1).padStart(2, '0')}@lumen.co`)
  })

  it('reaches every member by paging', async () => {
    await mountPanel()
    const first = addressesShown()
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() =>
      expect(addressesShown()[0]).not.toBe(first[0]),
    )
    expect(addressesShown()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    // No overlap: a second page that repeated the first would be a window
    // that never advanced its cursor.
    expect(addressesShown().filter((row) => first.includes(row))).toEqual([])
  })

  /*
   * THE TRAP. `addedAt` is the field a reader would order on and it is the one
   * that loses rows — the two adopted legacy members carry no `addedAt`, and
   * `orderBy` does not merely mis-sort them, it removes them from their own
   * list. Driven through the same evaluator the table is fed.
   */
  it('ordering on `addedAt` would DROP the members that predate it', () => {
    const byAddedAt = firestoreAnswer(memberDocs, [{ orderBy: 'addedAt' }])
    const byId = firestoreAnswer(memberDocs, [{ orderBy: '__name__' }])
    expect(byId).toHaveLength(TOTAL)
    expect(byAddedAt).toHaveLength(TOTAL - 2)
    expect(byAddedAt.map((row) => row.email)).not.toContain('p00@lumen.co')
  })

  it('a member with no `addedAt` is still shown, with the date left blank', async () => {
    await mountPanel()
    // The two undated rows are `p00`/`p01`, which the id walk puts LAST.
    fireEvent.click(screen.getByLabelText('Go to next page'))
    fireEvent.click(screen.getByLabelText('Go to next page'))
    fireEvent.click(screen.getByLabelText('Go to next page'))
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(addressesShown()).toContain('p00@lumen.co'))
    const row = bodyRows().find((entry) =>
      cellsAt(entry).includes('p00@lumen.co'),
    ) as Element
    expect(cellsAt(row)[columnIndex('Joined')]).toBe('—')
  })
})

describe('the membership table says HOW each person got there', () => {
  it('tells a rule match apart from somebody who was added', async () => {
    await mountPanel()
    const how = columnIndex('How')
    expect(how).toBeGreaterThan(-1)
    const labels = bodyRows().map((row) => cellsAt(row)[how])
    expect(labels.some((label) => label?.startsWith('Rule'))).toBe(true)
    expect(labels.some((label) => label?.startsWith('Added'))).toBe(true)
  })

  /*
   * An attestation and an opt-in are NOT the same fact. A column that rendered
   * both as a tick would be exactly the conflation `list-members.ts` stores
   * the basis to prevent: one is the person's own decision, the other is a
   * claim an account made on their behalf, and a compliance question cannot
   * recover the difference from a tick.
   */
  it('never renders an attestation as though it were an opt-in', async () => {
    await mountPanel()
    const consent = columnIndex('Consent')
    expect(consent).toBeGreaterThan(-1)
    const labels = bodyRows().map((row) => cellsAt(row)[consent] ?? '')
    expect(labels.some((label) => label.startsWith('Attested'))).toBe(true)
    expect(labels.some((label) => label.startsWith('Opted in'))).toBe(true)
    // Absence is not refusal: a row with no basis says so plainly rather than
    // reading as somebody who said no.
    expect(labels.some((label) => label === 'No basis on record')).toBe(true)
    expect(labels.join(' ')).not.toContain('declined')
  })
})

describe('removing somebody is not suppressing them', () => {
  /*
   * The two acts have different records and different consequences, and a
   * console that let them blur is a console where "remove" gets relied on as
   * an unsubscribe — so the person keeps being mailed by every other list, and
   * the operator believes they stopped.
   */
  it('says so in the confirmation, before anything is deleted', async () => {
    confirm.mockReset().mockRejectedValue(undefined)
    await mountPanel()
    pressRemove()
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    const description = String(confirm.mock.calls[0][0].description)
    expect(description).toContain('NOT an unsubscribe')
    expect(description).toContain('suppression list')
    // And it does not happen on a cancel: `confirm` REJECTS on cancel, so a
    // handler that gated on the resolved value alone would delete anyway.
    const { deleteDoc } = require('firebase/firestore')
    expect(deleteDoc).not.toHaveBeenCalled()
  })

  it('deletes only after the operator accepts', async () => {
    const { deleteDoc } = require('firebase/firestore')
    deleteDoc.mockClear()
    confirm.mockReset().mockResolvedValue(undefined)
    await mountPanel()
    pressRemove()
    await waitFor(() => expect(deleteDoc).toHaveBeenCalled())
  })
})
