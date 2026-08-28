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
 * The records table walks the collection instead of sampling it (AGL-693).
 *
 * The listener was `limit(500)` with no `orderBy`, every row rendered at once
 * and no footer anywhere. Firestore answers an unordered limit in DOCUMENT-ID
 * order, so on a dataset larger than the window a reader got an arbitrary five
 * hundred — and `sortDatasetRecords` then sorted that sample by `order`, which
 * made the result look ordered while being a sample. The rows past the window
 * were not merely unrendered; nothing showed them and no control asked for
 * more, so they were unreachable. The export leg fixed exactly this shape for
 * the file (AGL-2335) and left the table.
 *
 * A spec that only asserted "the table renders" would have passed on all of
 * that. So the fixture is built to make the two behaviours disagree: `order`
 * runs OPPOSITE to document-id order, so a client re-sort of an id-ordered
 * window puts a different row first than the walk does.
 *
 * ## The other half: the fix must not DROP rows
 *
 * `orderBy(field)` matches only documents that HAVE the field. Ordering the
 * walk on `order` — the obvious choice, since that is what the rows were
 * sorted by — would therefore not mis-order the table, it would hide from it
 * every record written by a path that omits the field. Those paths exist and
 * are named below. This asserts both directions: that ordering on a field
 * loses documents, and that ordering on the document NAME cannot.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { HostDatasetsCard } from './host-datasets-card.component'

jest.setTimeout(30_000)

const ORG = { $id: 'org-1', plan: 'scale' } as any

/**
 * Big enough that one page is a small fraction of it, and small enough to
 * render repeatedly in jsdom.
 */
const TOTAL_RECORDS = 60

const DATASET = {
  $id: 'ds-1',
  displayName: 'Leads',
  model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } },
  visibleTo: ['org'],
}
const datasetDocs = [DATASET]

/**
 * The rows, and the disagreement the whole file turns on.
 *
 * Ids ascend (`rec-00` … `rec-59`) and `order` DESCENDS, so document-id order
 * and `order` are exact opposites. A window taken in id order and then sorted
 * by `order` — the old behaviour — puts the highest id it happened to load
 * first; the walk puts `rec-00` first. One assertion tells them apart.
 *
 * Every third row carries NO `order` at all. That is not a contrivance: the
 * tenant form-submit leg and the workflow `appendDataset`/`updateDataset`
 * actions write `values` and `createdAt` and nothing else, so a lead dataset
 * is mostly made of rows shaped like these.
 */
const recordDocs = Array.from({ length: TOTAL_RECORDS }, (_, index) => ({
  $id: `rec-${String(index).padStart(2, '0')}`,
  values: { name: `Row ${String(index).padStart(2, '0')}` },
  ...(index % 3 === 0 ? {} : { order: TOTAL_RECORDS - index }),
}))

/** How many of them a field-ordered walk would be allowed to see. */
const RECORDS_WITH_ORDER = recordDocs.filter(
  (record) => 'order' in record,
).length

/**
 * Firestore's answer, in the two respects this file is about: an `orderBy`
 * SORTS, and it also FILTERS — a document without the field is not part of the
 * result at all. Modelling the filter is what lets the drop test below be a
 * test rather than an assertion about a comment.
 */
const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const ordered = constraints.find((item) => 'orderBy' in item)?.orderBy
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const field = ordered === '__name__' ? '$id' : ordered
  const matching = ordered
    ? all.filter((doc) => doc[field] !== undefined)
    : // No `orderBy` is not "no order": Firestore answers in document-id
      // order, which is exactly what made the old window an arbitrary sample
      // that looked deliberate.
      all
  const sorted = [...matching].sort((a, b) => {
    const left = ordered ? a[field] : a.$id
    const right = ordered ? b[field] : b.$id
    return left < right ? -1 : left > right ? 1 : 0
  })
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/**
 * Every page limit the card asked its query builder for, in order.
 * `mock`-prefixed, which is the naming jest's out-of-scope guard lets a module
 * factory close over.
 */
let mockLimitsAsked: number[] = []

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
      data: path.endsWith('/datasets') ? datasetDocs : [],
      status: 'success',
      fromCache: false,
    }
  },
  /*
   * The real hook's arithmetic, over a query that is actually EVALUATED.
   * `usePagedCollection` widens the query to cover page 0..n plus one probe
   * row and slices the page out of the answer; feeding that widened query
   * through `firestoreAnswer` is what makes the ordering the card chose
   * observable in the rendered rows rather than only in its source.
   */
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSizeState] = useState(10)
    const windowSize = pageSize * (page + 1)
    mockLimitsAsked.push(windowSize + 1)
    const built = build(windowSize + 1)
    const answered = String(built?.path ?? '').endsWith('/records')
      ? firestoreAnswer(recordDocs, built?.constraints ?? [])
      : []
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
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => Symbol('deleteField'),
  getCountFromServer: async () => ({
    data: () => ({ count: TOTAL_RECORDS }),
  }),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn().mockResolvedValue(undefined),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockLimitsAsked = []
})

const mountCard = async () => {
  render(<HostDatasetsCard orgId="org-1" org={ORG} />)
  // The two server aggregates resolve off the mount; their setState has to
  // land inside `act` or it lands in the next case.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The `Name` cell of every rendered row, top to bottom. */
const renderedRows = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('td')?.textContent?.trim() ?? '',
  )

describe('the records table walks the collection (AGL-693)', () => {
  it('THE CONTROL: the fixture makes the two behaviours disagree', () => {
    // Without this, every assertion below could pass on a fixture where
    // document-id order and `order` happen to coincide — which is the one
    // shape that cannot tell a walk from a re-sorted sample.
    const byId = [...recordDocs].sort((a, b) => (a.$id < b.$id ? -1 : 1))
    const byOrder = [...recordDocs]
      .filter((record) => 'order' in record)
      .sort((a, b) => (a as any).order - (b as any).order)
    expect(byId[0].$id).not.toBe(byOrder[0].$id)
    // And the fixture really does contain rows a field-ordered walk would
    // never see.
    expect(RECORDS_WITH_ORDER).toBeLessThan(TOTAL_RECORDS)
  })

  it('shows the FIRST page of the walk, not a re-sorted sample', async () => {
    await mountCard()
    const rows = renderedRows()
    expect(rows).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    // The walk's first row. The old code loaded an id-ordered window and
    // sorted it by `order`, which put the highest id it had loaded on top —
    // so this assertion is the one that separates the two.
    expect(rows[0]).toBe('Row 00')
    expect(rows.at(-1)).toBe(
      `Row ${String(TABLE_PAGE_SIZE_DEFAULT - 1).padStart(2, '0')}`,
    )
  })

  it('reaches every row by paging, including ones with no `order`', async () => {
    await mountCard()
    // `rec-00`, `rec-03`, … carry no `order`. They are on screen, which they
    // could not be if the walk were ordered on that field.
    expect(renderedRows()).toContain('Row 00')

    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() =>
      expect(renderedRows()[0]).toBe(
        `Row ${String(TABLE_PAGE_SIZE_DEFAULT).padStart(2, '0')}`,
      ),
    )
    expect(renderedRows()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('the window GROWS with the page instead of being a fixed ceiling', async () => {
    await mountCard()
    const first = mockLimitsAsked.at(-1)
    // One page plus the probe row that makes `hasMore` a fact rather than a
    // guess from `length === pageSize`.
    expect(first).toBe(TABLE_PAGE_SIZE_DEFAULT + 1)

    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() =>
      expect(mockLimitsAsked.at(-1)).toBe(TABLE_PAGE_SIZE_DEFAULT * 2 + 1),
    )
    // Which is the property the old query lacked: nothing in the component
    // caps the walk at a number a large dataset can exceed.
    expect(mockLimitsAsked).not.toContain(500)
  })

  it('THE TRAP: ordering on `order` would hide rows, not reorder them', () => {
    // Driven through the same evaluator the table is fed, so this is a claim
    // about the query and not about a comment. `orderBy` matches only
    // documents that HAVE the field.
    const onOrder = firestoreAnswer(recordDocs, [{ orderBy: 'order' }])
    expect(onOrder).toHaveLength(RECORDS_WITH_ORDER)
    expect(onOrder.length).toBeLessThan(TOTAL_RECORDS)

    const onName = firestoreAnswer(recordDocs, [{ orderBy: '__name__' }])
    expect(onName).toHaveLength(TOTAL_RECORDS)
  })
})

/**
 * Why the walk cannot be ordered on any FIELD, read off the writers.
 *
 * The behavioural test above shows what happens to a collection with rows
 * missing `order`. This is why such rows exist, checked against the code that
 * writes them — so a later change that adds `orderBy('createdAt')` because
 * "everything has a createdAt" fails here instead of quietly emptying the
 * table for whoever restored a site from a bundle.
 */
const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const readRepo = (path: string) => readFileSync(join(REPO, path), 'utf8')

/** The block of a record-creating call, from its `.add(`/`.create(` to `})`. */
const writeBlock = (source: string, marker: string): string => {
  const at = source.indexOf(marker)
  expect(at).toBeGreaterThan(-1)
  return source.slice(at, at + 900)
}

describe('no field on a dataset record is written by every writer', () => {
  it('THE CONTROL: the repo root resolves and the writers are readable', () => {
    // A path walk that landed somewhere else would make every assertion below
    // throw rather than pass, but a `catch` added later would not — so the
    // root is asserted outright.
    expect(readRepo('package.json')).toContain('"name"')
    expect(
      readRepo('apps/tenant/app/api/forms/submit/route.ts').length,
    ).toBeGreaterThan(1000)
  })

  it('the form-submit leg writes `createdAt` and no `order`', () => {
    // A public form wired to a dataset. `order` is a count of the rows the
    // console route has created and this leg does not compute one.
    const block = writeBlock(
      readRepo('apps/tenant/app/api/forms/submit/route.ts'),
      `.collection('records')\n              .add({`,
    )
    expect(block).toContain('createdAt')
    expect(block).not.toMatch(/\border:/)
  })

  it('the workflow append actions write `createdAt` and no `order`', () => {
    const source = readRepo('libs/tenant/runtime/src/lib/run-event-actions.ts')
    const appends = [
      ...source.matchAll(/\.collection\('records'\)\.add\(\{[\s\S]{0,800}?\}\)/g),
    ].map((match) => match[0])
    // Two: `appendDataset`, and `updateDataset`'s append-when-nothing-matches
    // branch. A floor rather than an exact count, since the point is that at
    // least one such writer exists and none of them stamp `order`.
    expect(appends.length).toBeGreaterThanOrEqual(2)
    for (const append of appends) {
      expect(append).toContain('createdAt')
      expect(append).not.toMatch(/\border:/)
    }
  })

  it('a restored record carries `order` and NO `createdAt`', () => {
    // The mirror image, and why `createdAt` is not the answer either: the
    // import allow-list decides what a restored record keeps, and it does not
    // include a timestamp.
    const permitted = readRepo('apps/console/app/api/_lib/site-export.ts')
    expect(permitted).toContain(`records: ['values', 'order']`)
  })

  it('the card orders BOTH its record reads on the document NAME', () => {
    // Not a field, so it cannot be absent, so each walk is total. Asserted on
    // the component because this is the conclusion the three facts above
    // force, and the place a future change would undo it.
    //
    // Both reads, counted: the table's page and the import's key index run
    // over the same collection and face the same question, and asserting that
    // the string appears SOMEWHERE would let either one be changed to a field
    // while the other kept the file passing.
    const card = readRepo(
      'libs/plugins/data/src/lib/components/host-datasets-card.component.tsx',
    )
    expect(card.split('orderBy(documentId())').length - 1).toBe(2)
    // And named outright, because these are the three that look right and
    // silently shrink the collection.
    for (const field of ['order', 'createdAt', 'updatedAt']) {
      expect(card).not.toContain(`orderBy('${field}'`)
    }
  })
})
