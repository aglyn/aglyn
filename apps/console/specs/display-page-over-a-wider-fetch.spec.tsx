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
 * A PAGE THE READER CHOOSES, OVER A FETCH THEY DO NOT (AGL-693).
 *
 * The staff Users list walks Firebase Auth two hundred accounts at a time,
 * because `listUsersAcrossPools` appends tenant-pool users only once the
 * project-level walk runs out of pages — a narrow walk hides every enterprise
 * SSO account behind several round trips (AGL-1122). That width was handed
 * straight to the footer as its page size, so the size menu held 200 against
 * options of 10/25/50: MUI had a value with no matching item and drew the
 * control EMPTY, and the only way to stop it lying was to switch it off.
 *
 * The two numbers are separated now. This is the seam under test.
 *
 * WHAT THIS FILE HAS TO CATCH, and the false greens it is written against:
 *
 *  - **A fixture that fits on one page.** Every case below runs on a
 *    collection LARGER than one display page, sized off
 *    `TABLE_PAGE_SIZE_DEFAULT` rather than a literal. A twelve-row fixture at
 *    width 200 can never reach the bug — which is exactly the fixture the bug
 *    shipped under.
 *  - **A label that agrees with the data instead of the screen.** The count
 *    line is asserted against the RENDERED row count, not against the array.
 *    That mismatch — ten rows under "1–12 of 12" — is the reported symptom.
 *  - **A size control that re-slices and calls it paged.** `needsFetch` is
 *    asserted in both directions, and the walk-advancing case demands a
 *    SECOND request. A control that stopped at whatever was already loaded
 *    would satisfy every rendering check here and fail those.
 *  - **A blank select.** The chosen size is asserted as the control's
 *    displayed value, which is the half that was visibly broken.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_PAGE_SIZE_OPTIONS,
} from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useCallback, useMemo, useState } from 'react'
import { displayWindow } from '../utils/display-window'

/** The walk's width — a transport detail, deliberately unlike any page size. */
const FETCH_WIDTH = 200

/** Comfortably more than two display pages, whatever the default becomes. */
const FETCHED = TABLE_PAGE_SIZE_DEFAULT * 2 + 4

const account = (index: number) => ({
  uid: `uid-${String(index).padStart(3, '0')}`,
})

/**
 * The Users list's arrangement, reduced to the part under test: a wide walk,
 * a narrow page over it, and the shared footer describing the page.
 *
 * `onAdvance` stands in for `loadPage` — the round trip the reader's Next
 * must trigger when the page they are moving to is not fully buffered.
 */
function Harness({
  rows,
  walkHasMore = false,
  onAdvance,
}: {
  rows: { uid: string }[]
  walkHasMore?: boolean
  onAdvance?: () => void
}) {
  const [size, setSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [page, setPage] = useState(0)
  const window = useMemo(
    () => displayWindow(rows, page, size),
    [rows, page, size],
  )
  const changePage = useCallback(
    (next: number) => {
      if (next > page && window.needsFetch && walkHasMore) onAdvance?.()
      setPage(Math.max(next, 0))
    },
    [page, walkHasMore, window.needsFetch, onAdvance],
  )
  return (
    <div>
      <ul>
        {window.shown.map((row) => (
          <li key={row.uid}>{row.uid}</li>
        ))}
      </ul>
      <ListPagination
        page={page}
        pageSize={size}
        rowCount={window.shown.length}
        hasMore={window.hasMore || walkHasMore}
        onPageChange={changePage}
        onPageSizeChange={(next) => {
          setSize(next)
          setPage(0)
        }}
      />
    </div>
  )
}

/** The uids actually drawn, in order. */
const drawn = () =>
  screen.queryAllByRole('listitem').map((node) => node.textContent ?? '')

/** The footer's count line, e.g. `1–10 of more than 10`. */
const countLine = () =>
  screen.getByText(/\d+–\d+ of/).textContent ?? ''

const sizeMenu = () => screen.getByRole('combobox')

describe('a display page over a wider fetch (AGL-693)', () => {
  const rows = Array.from({ length: FETCHED }, (_, index) => account(index))

  it('THE CONTROL: the fixture spans more than one display page', () => {
    // Without this every assertion below is satisfied by a collection that
    // never had a second page, which is the shape the bug shipped under.
    expect(rows.length).toBeGreaterThan(TABLE_PAGE_SIZE_DEFAULT)
    // And the fetch width is genuinely not a page size, which is what made
    // the menu render blank in the first place.
    expect(TABLE_PAGE_SIZE_OPTIONS).not.toContain(FETCH_WIDTH)
  })

  it('draws one page and says so, with the size SELECTED', () => {
    render(<Harness rows={rows} />)

    expect(drawn()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    // The label read against the SCREEN. Ten rows under "1–12 of 12" is the
    // reported symptom, and it is what this comparison exists to refuse.
    expect(countLine()).toBe(`1–${TABLE_PAGE_SIZE_DEFAULT} of more than ${TABLE_PAGE_SIZE_DEFAULT}`)
    expect(sizeMenu().textContent).toBe(String(TABLE_PAGE_SIZE_DEFAULT))
  })

  it('advances through the fetched rows without repeating any', () => {
    render(<Harness rows={rows} />)
    const first = drawn()

    fireEvent.click(screen.getByLabelText('Go to next page'))
    const second = drawn()

    expect(second).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    for (const uid of first) expect(second).not.toContain(uid)
    expect(countLine()).toBe(
      `${TABLE_PAGE_SIZE_DEFAULT + 1}–${TABLE_PAGE_SIZE_DEFAULT * 2} of more than ${TABLE_PAGE_SIZE_DEFAULT * 2}`,
    )
  })

  it('stops claiming more at the end of the walk', () => {
    render(<Harness rows={rows} />)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    fireEvent.click(screen.getByLabelText('Go to next page'))

    // The last four. The count line stops saying "more than" at exactly the
    // point that would become a lie, and Next goes dead.
    expect(drawn()).toHaveLength(4)
    expect(countLine()).toBe(
      `${TABLE_PAGE_SIZE_DEFAULT * 2 + 1}–${FETCHED} of ${FETCHED}`,
    )
    expect(
      (screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('changing the size changes the ROWS DRAWN, and the label follows', () => {
    render(<Harness rows={rows} />)
    const bigger = TABLE_PAGE_SIZE_OPTIONS[1]

    fireEvent.mouseDown(sizeMenu())
    fireEvent.click(screen.getByRole('option', { name: String(bigger) }))

    // All three agree afterwards — the rendered count, the label, and the
    // control's own displayed value. The bug was all three disagreeing.
    const expected = Math.min(bigger, FETCHED)
    expect(drawn()).toHaveLength(expected)
    expect(sizeMenu().textContent).toBe(String(bigger))
    expect(countLine()).toBe(
      expected === FETCHED
        ? `1–${FETCHED} of ${FETCHED}`
        : `1–${expected} of more than ${expected}`,
    )
  })

  it('returns to the first page when the size changes', () => {
    render(<Harness rows={rows} />)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    expect(drawn()[0]).toBe(rows[TABLE_PAGE_SIZE_DEFAULT].uid)

    fireEvent.mouseDown(sizeMenu())
    fireEvent.click(
      screen.getByRole('option', { name: String(TABLE_PAGE_SIZE_OPTIONS[1]) }),
    )
    // Page two of a ten-row view does not exist at twenty-five, and MUI draws
    // an out-of-range page as an empty list with no explanation.
    expect(drawn()[0]).toBe(rows[0].uid)
  })
})

/**
 * The half a re-slice would fake: advancing past what was fetched has to
 * FETCH.
 */
describe('paging past the buffer asks for more (AGL-693)', () => {
  it('fetches when the next page is not fully buffered', () => {
    // Exactly one display page in hand, and a walk that has more behind it.
    const rows = Array.from({ length: TABLE_PAGE_SIZE_DEFAULT }, (_, index) =>
      account(index),
    )
    const onAdvance = jest.fn()
    render(<Harness rows={rows} walkHasMore onAdvance={onAdvance} />)

    // Next is live off the WALK, not off the buffer — the buffer is spent.
    expect(
      (screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled,
    ).toBe(false)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })

  it('does NOT fetch while the next page is already in hand', () => {
    // The other direction, and it is what stops a page turn costing a read
    // every time. Two full pages buffered, so the first Next is free.
    const rows = Array.from({ length: TABLE_PAGE_SIZE_DEFAULT * 3 }, (_, index) =>
      account(index),
    )
    const onAdvance = jest.fn()
    render(<Harness rows={rows} walkHasMore onAdvance={onAdvance} />)

    fireEvent.click(screen.getByLabelText('Go to next page'))
    expect(onAdvance).not.toHaveBeenCalled()
  })

  it('never asks when the walk is finished', () => {
    const rows = Array.from({ length: TABLE_PAGE_SIZE_DEFAULT }, (_, index) =>
      account(index),
    )
    const onAdvance = jest.fn()
    render(<Harness rows={rows} onAdvance={onAdvance} />)
    expect(
      (screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(onAdvance).not.toHaveBeenCalled()
  })
})

/**
 * The seam is wired into the real screen, not only into this harness.
 */
describe('the Users list actually uses the seam', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(
      __dirname,
      '..',
      'app/(app)/admin/users/page.tsx',
    ),
    'utf8',
  ) as string

  it('pages the DISPLAY, not the Auth walk', () => {
    expect(source).toContain('displayWindow')
    // The walk keeps its width — the whole point is that the menu does not
    // touch it, because a cursor names a position in a walk of a given width.
    expect(source).toContain('AUTH_LIST_PAGE_SIZE')
    expect(source).toContain('TABLE_PAGE_SIZE_DEFAULT')
  })

  it('offers the size menu rather than switching it off', () => {
    // `sizeMenu={false}` was the workaround for a menu that could only lie.
    expect(source).not.toContain('sizeMenu={false}')
    expect(source).toContain('onPageSizeChange')
  })
})
