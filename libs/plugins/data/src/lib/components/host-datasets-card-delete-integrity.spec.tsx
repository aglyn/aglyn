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
 * Deleting a record asks the QUERY whether anything still points at it.
 *
 * The check that decides whether a destructive operation is allowed used to
 * read a page of the referencing collection — `limit(500)` with no `orderBy`,
 * which Firestore answers in document-id order over auto-ids, so an arbitrary
 * five hundred — and filter it in the browser. A record referenced only from
 * outside that window read as unreferenced: the delete went through and
 * `onDelete: 'restrict'` silently failed to restrict, leaving the referencing
 * document pointing at something that no longer exists.
 *
 * The reference cannot be queried where it is stored. `records.values` carries
 * a deliberate index exemption in `cloud/firebase-firestore.indexes.json` —
 * dataset fields are user-defined, and auto-indexing an unbounded map blows
 * Firestore's per-document index-entry limit — so
 * `where('values.<fieldId>', '==', id)` is FAILED_PRECONDITION. Paging the
 * whole collection is out for the reason the export documents: the agency
 * plan's `recordsPerDataset` is unlimited. Hence `referencedIds`, the same
 * reference denormalized into an array Firestore will index.
 *
 * Contracts:
 *
 *  1. IT ASKS BY QUERY. One `array-contains` per referencing collection,
 *     reaching every record rather than a page of them.
 *  2. IT FAILS CLOSED. A rejected query refuses the delete. A check that
 *     fails open is worse than no check at all, because the UI then reports
 *     the record as safe to remove.
 *  3. `restrict` STILL BLOCKS, and quotes the number the query really found.
 *  4. `setNull` STRIPS THE FKEY AND THE INDEX. A holder whose reference is
 *     cleared has to stop matching the `array-contains`, or it goes on
 *     refusing a delete nothing is holding.
 *
 * NO PRODUCTION DATA IS READ; every Firestore call is a local stub.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ReactNode } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'

/** `Attendees` sorts first, so the picker selects the REFERENCED collection. */
const ATTENDEES = {
  $id: 'ds-attendees',
  displayName: 'Attendees',
  model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } },
  visibleTo: ['org'],
}
/** The referencing side; its `onDelete` is swapped per case. */
const bookings = {
  $id: 'ds-bookings',
  displayName: 'Bookings',
  model: {
    order: ['attendee'],
    fields: {
      attendee: {
        name: 'Attendee',
        type: 'reference',
        reference: { datasetId: 'ds-attendees', onDelete: 'setNull' },
      },
    },
  },
  visibleTo: ['org'],
}

/**
 * STABLE arrays, like the real listener. `datasets` is a dependency of the
 * reference-picker effect, so a fresh array per render re-runs it, and its
 * setState schedules the next render — an unbounded loop belonging entirely
 * to the stub.
 */
const datasetDocs = [ATTENDEES, bookings]
const recordDocs = [
  { $id: 'rec-1', values: { name: 'Ada' } },
  { $id: 'rec-2', values: { name: 'Grace' } },
]

/** The delete-field sentinel, so the spec can assert the index is CLEARED. */
const DELETE_FIELD = Symbol('deleteField')

/**
 * What the integrity query finds. Each entry becomes a document snapshot the
 * card reads `values` off and writes back through.
 */
let hits: Array<{ id: string; values: Record<string, unknown> }> = []
/** Set to reject the integrity query — a missing index, or a rules refusal. */
let queryRejects = false

const getDocsSpy = jest.fn(async (built: unknown) => {
  if (queryRejects) throw new Error('FAILED_PRECONDITION')
  return {
    docs: hits.map((hit) => ({
      id: hit.id,
      ref: { id: hit.id },
      get: (field: string) =>
        field === 'values' ? hit.values : (hit as any)[field],
    })),
    __built: built,
  }
})
const deleteDocSpy = jest.fn(async (_ref: unknown) => undefined)
const batchUpdate = jest.fn()
const batchCommit = jest.fn(async () => undefined)

/** Stable, like the real hooks — a fresh object per render churns the effects. */
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostActivityLogger: () => jest.fn(),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const path = String(built?.path ?? '')
    return {
      data: path.endsWith('/records')
        ? recordDocs
        : path.endsWith('/datasets')
          ? datasetDocs
          : [],
      status: 'success',
      fromCache: false,
    }
  },
  /*
   * The records table pages (AGL-2501). Modelled the way the real hook works —
   * a window over page 0..n plus a probe row — because a page is precisely
   * what the delete check must NOT be answered from: the whole contract below
   * is that the reference question is a query over the collection and not a
   * scan of the rows that happen to be on screen.
   */
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSizeState] = useState(10)
    const windowSize = pageSize * (page + 1)
    const built = build(windowSize + 1)
    const all = String(built?.path ?? '').endsWith('/records') ? recordDocs : []
    return {
      rows: all.slice(page * pageSize, windowSize),
      hasMore: all.length > windowSize,
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
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  // The built query is kept whole, so a case can assert WHICH collection was
  // asked and with what constraint — the difference between a query and a
  // page scan is the entire contract.
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }),
  // The records walk orders on the document NAME, which is the one ordering
  // that cannot drop a row for lacking a field — see the listener's comment.
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => DELETE_FIELD,
  getCountFromServer: async () => ({ data: () => ({ count: 2 }) }),
  getDocs: (built: unknown) => getDocsSpy(built),
  deleteDoc: (ref: unknown) => deleteDocSpy(ref),
  setDoc: jest.fn(async () => undefined),
  writeBatch: () => ({
    set: jest.fn(),
    update: batchUpdate,
    commit: batchCommit,
  }),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  hits = []
  queryRejects = false
  bookings.model.fields.attendee.reference.onDelete = 'setNull'
})

/**
 * Mounted and settled. The two server aggregates resolve off the mount, so
 * their setState has to land inside `act` or it lands in the next case.
 */
const mountCard = async () => {
  render(<HostDatasetsCard orgId="org-1" org={{ $id: 'org-1' } as any} />)
  await act(async () => {
    await Promise.resolve()
  })
}

/** The row Delete for `rec-1`; the toolbar's collection Delete comes first. */
const deleteFirstRecord = () => fireEvent.click(screen.getAllByText('Delete')[1])

describe('the record delete asks by query, not by page (AGL-180)', () => {
  it('sends one array-contains per referencing collection', async () => {
    await mountCard()
    deleteFirstRecord()

    await waitFor(() => expect(getDocsSpy).toHaveBeenCalled())
    const built = getDocsSpy.mock.calls[0][0] as any
    // The REFERENCING collection is the one asked — `Attendees` is the side
    // being deleted from.
    expect(built.path).toBe('orgs/org-1/datasets/ds-bookings/records')
    expect(built.constraints).toEqual([
      { field: 'referencedIds', op: 'array-contains', value: 'rec-1' },
    ])
    // No page cap. A `limit` here is the defect: it answers for the rows it
    // happened to fetch and calls that an integrity check.
    expect(
      built.constraints.some((constraint: any) => 'limit' in constraint),
    ).toBe(false)
  })

  it('THE CONTROL: with nothing pointing at it, the delete proceeds', async () => {
    // Without this, a check that refused everything would satisfy the two
    // refusal cases below while shipping a card that can delete nothing.
    await mountCard()
    deleteFirstRecord()

    await waitFor(() => expect(deleteDocSpy).toHaveBeenCalled())
    expect(deleteDocSpy.mock.calls[0][0]).toEqual({
      path: 'orgs/org-1/datasets/ds-attendees/records/rec-1',
    })
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Record deleted'),
      ),
    ).toBe(true)
  })
})

describe('the check FAILS CLOSED', () => {
  it('refuses the delete when the query is rejected', async () => {
    /*
     * A missing index or a rules refusal is silence, not an answer. Treating
     * it as "nothing references this" is worse than having no check: the
     * record goes, and the UI reported it as safe to remove.
     */
    queryRejects = true
    await mountCard()
    deleteFirstRecord()

    await waitFor(() => expect(getDocsSpy).toHaveBeenCalled())
    await act(async () => {
      await Promise.resolve()
    })
    expect(deleteDocSpy).not.toHaveBeenCalled()
    expect(batchCommit).not.toHaveBeenCalled()
    const message = String(enqueueSnackbar.mock.calls.at(-1)?.[0] ?? '')
    // Names the collection it could not check and says nothing was deleted,
    // so the refusal is actionable rather than a bare failure.
    expect(message).toContain('Bookings')
    expect(message).toContain('Nothing was deleted')
  })
})

describe('the policies still apply, over the whole collection', () => {
  it('`restrict` blocks and quotes what the query found', async () => {
    bookings.model.fields.attendee.reference.onDelete = 'restrict'
    hits = [
      { id: 'bk-1', values: { attendee: 'rec-1' } },
      { id: 'bk-2', values: { attendee: 'rec-1' } },
    ]
    await mountCard()
    deleteFirstRecord()

    await waitFor(() =>
      expect(
        enqueueSnackbar.mock.calls.some((call) =>
          String(call[0]).includes('referenced by 2 documents in "Bookings"'),
        ),
      ).toBe(true),
    )
    expect(deleteDocSpy).not.toHaveBeenCalled()
  })

  it('`setNull` strips the FKey AND the index that found it', async () => {
    hits = [
      { id: 'bk-1', values: { attendee: 'rec-1' } },
      { id: 'bk-2', values: { attendee: ['rec-1', 'rec-9'] } },
    ]
    await mountCard()
    deleteFirstRecord()

    await waitFor(() => expect(batchCommit).toHaveBeenCalled())
    // A scalar reference is removed outright and the record then points at
    // nothing, so its index has to be DELETED — an omitted field would leave
    // the stale array standing, and the holder would go on matching.
    expect(batchUpdate.mock.calls[0][1]).toEqual({
      values: {},
      referencedIds: DELETE_FIELD,
    })
    // An array reference keeps its other ids, and the index keeps pace.
    expect(batchUpdate.mock.calls[1][1]).toEqual({
      values: { attendee: ['rec-9'] },
      referencedIds: ['rec-9'],
    })
    expect(deleteDocSpy).toHaveBeenCalled()
  })
})
