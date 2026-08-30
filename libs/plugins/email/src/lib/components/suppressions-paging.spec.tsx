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
 * The suppression list WALKS the collection, and its breakdown is not a tally
 * of the page (AGL-2501).
 *
 * Two defects on one card, and each hid the other.
 *
 * ## The window was chosen by hash
 *
 * The listener was `limit(500)` with no `orderBy`, sorted by date in the
 * browser. Firestore answers an unordered limit in DOCUMENT-ID order and an
 * entry here is keyed by `sha256(email)` — so the window was five hundred
 * addresses picked by the hash of the address, arranged newest-first
 * afterwards so that it looked like a feed. Past the ceiling, whoever bounced
 * this morning was simply absent, with no gap on screen to notice.
 *
 * A spec that only asserted "the table renders" would have passed on all of
 * that, so the fixture makes the two behaviours disagree outright: the hash
 * ids run OPPOSITE to `createdAt`, and the oldest entry has the lowest hash.
 * An id-ordered window sorted by date therefore puts a different row on top
 * than the walk does.
 *
 * ## The breakdown counted what was fetched
 *
 * "Bounced: N" came from a `reduce` over the rows in hand. On a list past the
 * ceiling that was N-of-five-hundred, and under a ten-row page it would have
 * been N-of-ten — a bounce rate computed from a sample, presented as a bounce
 * rate. The chips read server aggregates now, and the fixture is built so the
 * page total and the collection total cannot be confused for one another.
 *
 * ## The other half: the fix must not DROP rows
 *
 * `orderBy(field)` matches only documents that HAVE the field. `suppressedAt`
 * is the field the column used to display and the obvious thing to order on,
 * and it is absent on every entry written before AGL-1918 — so ordering on it
 * would not mis-sort the list, it would hide the oldest suppressions from it.
 * That direction is asserted too.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { SuppressionsCard } from './suppressions-card'

jest.setTimeout(30_000)

/** Big enough that one page is a small fraction of the list. */
const TOTAL = 60

/**
 * The rows, and the disagreement this file turns on.
 *
 * `$id` is a hex hash, as the real key is, and it runs OPPOSITE to `createdAt`:
 * the OLDEST entry has the lowest hash and the newest has the highest. So the
 * first page of an id-ordered window is the oldest rows, and re-sorting that
 * window by date — the old behaviour — puts the newest of the OLDEST ten on
 * top. A walk puts the newest of the whole list there. One assertion tells
 * them apart.
 *
 * Two field-presence facts are modelled rather than assumed:
 *
 *  * every row carries `createdAt`, because both writers stamp it when the
 *    document is created and the pre-AGL-2408 handler wrote `{ email,
 *    createdAt }`;
 *  * the OLDEST third carries no `suppressedAt`, because that field arrived
 *    with AGL-1918 and nothing back-filled it;
 *  * the same oldest third carries no `reason`, which is what makes
 *    "unsubscribed" a REMAINDER rather than a `where` clause.
 */
const rows = Array.from({ length: TOTAL }, (_, index) => {
  const legacy = index < 20
  const day = TOTAL - index
  return {
    $id: `${String(TOTAL - 1 - index).padStart(2, '0')}a1b2c3`,
    email: `person${String(index).padStart(2, '0')}@example.test`,
    createdAt: { seconds: day * 86_400 },
    ...(legacy ? {} : { suppressedAt: { seconds: (day + 1) * 86_400 } }),
    ...(legacy
      ? {}
      : index % 5 === 0
        ? { reason: 'bounce' }
        : index % 7 === 0
          ? { reason: 'complaint' }
          : { reason: 'unsubscribe' }),
  }
})

const ROWS_WITH_SUPPRESSED_AT = rows.filter(
  (row) => 'suppressedAt' in row,
).length
const BOUNCES = rows.filter((row) => (row as any).reason === 'bounce').length
const COMPLAINTS = rows.filter(
  (row) => (row as any).reason === 'complaint',
).length
/** Explicit unsubscribes PLUS every legacy row that carries no reason at all. */
const UNSUBSCRIBES = TOTAL - BOUNCES - COMPLAINTS

/**
 * Firestore's answer in the two respects this file is about: an `orderBy`
 * SORTS, and it also FILTERS — a document without the field is not in the
 * result at all. Modelling the filter is what makes the drop test a test
 * rather than an assertion about a comment.
 */
const firestoreAnswer = (
  all: Array<Record<string, any>>,
  constraints: Array<Record<string, any>>,
) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const equality = constraints.find((item) => 'field' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  let matching = equality
    ? all.filter((doc) => doc[equality.field] === equality.value)
    : all
  if (order) {
    matching = matching.filter((doc) => doc[order.orderBy] !== undefined)
  }
  const field = order?.orderBy
  const sorted = [...matching].sort((a, b) => {
    // No `orderBy` is not "no order": Firestore answers in document-id order,
    // which is exactly what made the old window a hash-ordered sample.
    const left = field ? a[field]?.seconds ?? a[field] : a.$id
    const right = field ? b[field]?.seconds ?? b[field] : b.$id
    const step = left < right ? -1 : left > right ? 1 : 0
    return order?.direction === 'desc' ? -step : step
  })
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** Every page limit the card asked its query builder for, in order. */
let mockLimitsAsked: number[] = []

/**
 * ONE Firestore handle for the whole file.
 *
 * A factory returning `{}` hands the component a new object on every render,
 * and the aggregate effect keys on it — which is an infinite render loop, not
 * a slow test.
 */
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  // The card holds a signed-in user for the Add drawer's route call. Nothing
  // in this file uses it; a double is still required, because `useUser()`
  // returning undefined throws on destructure and would take every paging
  // case with it — a harness failure wearing a product failure's clothes.
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: async () => 'tok' } }),
  /*
   * The real hook's arithmetic over a query that is actually EVALUATED.
   * `usePagedCollection` widens the query to cover page 0..n plus a probe row
   * and slices the page out of the answer; feeding that widened query through
   * `firestoreAnswer` is what makes the ordering the card chose observable in
   * the rendered rows rather than only in its source.
   */
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSizeState] = useState(10)
    const windowSize = pageSize * (page + 1)
    mockLimitsAsked.push(windowSize + 1)
    const built = build(windowSize + 1)
    const answered = firestoreAnswer(rows, built?.constraints ?? [])
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
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  count: () => 'count',
  // The aggregate the chips read, answered from the SAME fixture the table is
  // answered from — so a chip that has gone back to counting the page shows a
  // different number here rather than the same one by coincidence.
  getAggregateFromServer: async (built: any) => {
    const answered = firestoreAnswer(rows, built?.constraints ?? [])
    return { data: () => ({ total: answered.length }) }
  },
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/aglyn', () => ({
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  /*
   * The Remove flow asks the server whether the address is ALSO suppressed
   * platform-wide. `{ platform: [] }` is the ordinary answer — not blocked —
   * so every case below reads the dialog it was written for. Without a
   * double, jsdom attempts a real request to a relative URL and the run never
   * settles, which is a harness failure that looks like a hang.
   */
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ platform: [] }),
  }) as unknown as typeof fetch
  mockLimitsAsked = []
})

const mountCard = async () => {
  render(<SuppressionsCard hostId="host-1" />)
  // The three aggregates resolve off the mount; their setState has to land
  // inside `act` or it lands in the next case.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The address cell of every rendered row, top to bottom. */
const renderedAddresses = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('td')?.textContent?.trim() ?? '',
  )

describe('the suppression list walks the collection (AGL-2501)', () => {
  it('THE CONTROL: the fixture makes the two behaviours disagree', () => {
    // The comparison has to be made at the WINDOW, not over the whole
    // fixture: an unordered `limit()` and an ordered one agree completely on a
    // collection smaller than the cap, which is the one shape that cannot tell
    // a walk from a re-sorted sample. So this is the old behaviour and the new
    // one, both at the page size the card actually asks for.
    const page = TABLE_PAGE_SIZE_DEFAULT + 1
    const oldWindow = firestoreAnswer(rows, [{ limit: page }]).sort(
      (a, b) => b.createdAt.seconds - a.createdAt.seconds,
    )
    const walked = firestoreAnswer(rows, [
      { orderBy: 'createdAt', direction: 'desc' },
      { limit: page },
    ])
    expect(oldWindow[0].email).not.toBe(walked[0].email)
    // The old window is the OLDEST rows, which is the shape of the bug: the
    // most recent bounce is not in it at all.
    expect(oldWindow.map((row: any) => row.email)).not.toContain(
      'person00@example.test',
    )
    // And the fixture really does hold rows a `suppressedAt` walk could not see.
    expect(ROWS_WITH_SUPPRESSED_AT).toBeLessThan(TOTAL)
  })

  it('shows the NEWEST page, not a hash-ordered sample sorted by date', async () => {
    await mountCard()
    const addresses = renderedAddresses()
    expect(addresses).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    // `person00` is the newest entry and the HIGHEST hash — the last row an
    // id-ordered window would ever have reached. Its presence on the first
    // page is the whole difference between a walk and a re-sorted sample.
    expect(addresses[0]).toBe('person00@example.test')
    expect(addresses.at(-1)).toBe('person09@example.test')
  })

  it('reaches the oldest rows by paging, including ones with no `suppressedAt`', async () => {
    await mountCard()
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() =>
      expect(renderedAddresses()[0]).toBe('person10@example.test'),
    )
    // Page three is entirely legacy rows — no `suppressedAt`, no `reason`.
    // They are on screen, which they could not be if the walk were ordered on
    // either field.
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() =>
      expect(renderedAddresses()[0]).toBe('person20@example.test'),
    )
    expect(renderedAddresses()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('the window GROWS with the page instead of being a fixed ceiling', async () => {
    await mountCard()
    // One page plus the probe row that makes `hasMore` a fact rather than a
    // guess from `length === pageSize`.
    expect(mockLimitsAsked.at(-1)).toBe(TABLE_PAGE_SIZE_DEFAULT + 1)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() =>
      expect(mockLimitsAsked.at(-1)).toBe(TABLE_PAGE_SIZE_DEFAULT * 2 + 1),
    )
    // The property the old query lacked: nothing caps the walk at a number a
    // long suppression list can exceed.
    expect(mockLimitsAsked).not.toContain(501)
  })

  it('THE TRAP: ordering on `suppressedAt` would hide rows, not reorder them', () => {
    // Driven through the evaluator the table itself is fed, so this is a claim
    // about the query rather than about a comment.
    const onSuppressedAt = firestoreAnswer(rows, [
      { orderBy: 'suppressedAt', direction: 'desc' },
    ])
    expect(onSuppressedAt).toHaveLength(ROWS_WITH_SUPPRESSED_AT)
    expect(onSuppressedAt.length).toBeLessThan(TOTAL)

    const onCreatedAt = firestoreAnswer(rows, [
      { orderBy: 'createdAt', direction: 'desc' },
    ])
    expect(onCreatedAt).toHaveLength(TOTAL)
  })
})

describe('the breakdown counts the COLLECTION, not the page (AGL-2501)', () => {
  it('THE CONTROL: the page and the collection hold different numbers', () => {
    // Otherwise a chip reading the page length and a chip reading the
    // aggregate would print the same value and the test could not tell them
    // apart.
    expect(BOUNCES).toBeGreaterThan(0)
    expect(BOUNCES).not.toBe(TABLE_PAGE_SIZE_DEFAULT)
    expect(UNSUBSCRIBES).toBeGreaterThan(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('each chip reports the whole list while one page is on screen', async () => {
    await mountCard()
    expect(renderedAddresses()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(screen.getByText(`Bounced: ${BOUNCES}`)).toBeTruthy()
    expect(screen.getByText(`Marked as spam: ${COMPLAINTS}`)).toBeTruthy()
    expect(screen.getByText(`Unsubscribed: ${UNSUBSCRIBES}`)).toBeTruthy()
  })

  it('unsubscribes are a REMAINDER, so reason-less rows are counted', async () => {
    // The compatibility rule the row renderer applies one row at a time, held
    // at the level of the total. `where('reason','==','unsubscribe')` would
    // have excluded every pre-AGL-2408 entry — the same field-presence trap as
    // the ordering — and under-reported the number by exactly those rows.
    const explicit = rows.filter(
      (row) => (row as any).reason === 'unsubscribe',
    ).length
    expect(UNSUBSCRIBES).toBeGreaterThan(explicit)
    await mountCard()
    expect(screen.getByText(`Unsubscribed: ${UNSUBSCRIBES}`)).toBeTruthy()
    expect(screen.queryByText(`Unsubscribed: ${explicit}`)).toBeNull()
  })

  it('the chips stay silent rather than reassuring when the read fails', async () => {
    const firestore = require('firebase/firestore')
    const original = firestore.getAggregateFromServer
    firestore.getAggregateFromServer = async () => {
      throw new Error('permission-denied')
    }
    try {
      await mountCard()
      // Not "Bounced: 0". A confident zero in the reassuring direction is the
      // failure this card exists to prevent.
      expect(screen.queryByText(/^Bounced: /)).toBeNull()
      expect(
        screen.getByText(/This is not the same as nobody having bounced/),
      ).toBeTruthy()
    } finally {
      firestore.getAggregateFromServer = original
    }
  })
})
