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

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import StaffUserEmailHistoryCard, {
  type StaffEmailDeliveryRow,
} from '../components/staff-user-email-history-card.component'

/*
 * The card reads its page from `/api/admin/users/email-history` through the
 * shared staff list hook (AGL-3321); this suite is about how a page LOOKS, so
 * the hook hands back the page each case names.
 */
const mockPage: {
  rows: Array<StaffEmailDeliveryRow & { $id: string }>
  failed: boolean
  hasMore: boolean
} = { rows: [], failed: false, hasMore: false }

jest.mock('../hooks/use-staff-list-query', () => ({
  __esModule: true,
  useStaffListQuery: () => ({
    rows: mockPage.rows,
    failed: mockPage.failed,
    hasMore: mockPage.hasMore,
    loading: false,
    filtering: false,
    refused: [],
    notices: [],
    pageIndex: 0,
    pageSize: 10,
    setPageSize: () => undefined,
    loadPage: async () => undefined,
    refresh: () => undefined,
    showRows: () => undefined,
  }),
}))

/** The card over one page of rows, as the route would answer it. */
function card(rows: StaffEmailDeliveryRow[], options: { failed?: boolean; hasMore?: boolean } = {}) {
  mockPage.rows = rows.map((row) => ({ ...row, $id: `key/${row.messageId}` }))
  mockPage.failed = options.failed ?? false
  mockPage.hasMore = options.hasMore ?? false
  return <StaffUserEmailHistoryCard uid="uid-1" address={ROW.to} />
}

/**
 * THE DELIVERY TABLE'S LAYOUT.
 *
 * The first version put the subject and its sender label in one stacked cell
 * and lived inside `CardColumns`. Both were visible defects rather than taste:
 * the stack forced the grid's row height up so the table read as padded
 * against every other list in the console, and `CardColumns` is CSS multicol,
 * which cannot span — so a six-column table was squeezed into half the page
 * with `Clicks` cut off at the card's edge.
 *
 * Neither is catchable by a typecheck, and I shipped both. These assertions
 * are the parts a screenshot would have caught.
 */

const ROW: StaffEmailDeliveryRow = {
  messageId: 'msg_1',
  provider: 'resend',
  to: 'william.hymes@hitechproductions.com',
  subject: 'Confirm your email address',
  context: 'email-verification',
  status: 'delivered',
  timestamps: { sent: 1_756_182_526_000 },
  firstSeenAtMs: 1_756_182_526_000,
  openCount: 0,
  clickCount: 0,
  clickedLinks: [],
  bounceType: null,
  detail: null,
  hostId: null,
  campaignId: null,
}

const rowsOf = (count: number): StaffEmailDeliveryRow[] =>
  Array.from({ length: count }, (_unused, index) => ({
    ...ROW,
    messageId: `msg_${index}`,
    subject: `Message ${index}`,
    firstSeenAtMs: ROW.firstSeenAtMs - index * 1000,
    timestamps: { sent: ROW.firstSeenAtMs - index * 1000 },
  }))

describe('the delivery table', () => {
  it('gives the sender its own column instead of stacking it under the subject', () => {
    render(
      card([ROW]),
    )

    // A column, not a second line: stacking was what forced the row height up,
    // and a value in a column of its own also sorts and filters, which one
    // buried in a render function cannot.
    expect(screen.getByRole('columnheader', { name: 'Sender' })).toBeTruthy()

    const subjectCell = document.querySelector('[data-field="subject"][role="gridcell"]')
    expect(subjectCell?.textContent).toBe('Confirm your email address')
    expect(subjectCell?.textContent).not.toContain('email-verification')
  })

  it('draws every column the card promises', () => {
    render(
      card([ROW]),
    )
    for (const name of ['Message', 'Sender', 'Sent', 'Status', 'Opens', 'Clicks']) {
      expect(screen.getByRole('columnheader', { name })).toBeTruthy()
    }
  })

  it('keeps rows to a single line', () => {
    render(
      card([ROW]),
    )
    // The grid pins each row to the configured height. Asserted because the
    // default (52px) is sized for stacked cells, and every cell here is one
    // line — the padding was the whole complaint.
    const row = document.querySelector('[role="row"][data-id]') as HTMLElement
    expect(row.style.minHeight).toBe('44px')
    expect(row.style.maxHeight).toBe('44px')

    // The header matches, so the two do not read as different densities.
    const grid = document.querySelector('.MuiDataGrid-root') as HTMLElement
    expect(grid.style.getPropertyValue('--DataGrid-headerHeight')).toBe('44px')
  })

  it('pages rather than drawing every message at once', () => {
    render(card(rowsOf(10), { hasMore: true }))
    // The shared console footer over one page the route read, not a wall of
    // rows: the next page is a read, offered only when there is one.
    expect(screen.getByText('Rows per page:')).toBeTruthy()
    expect(document.querySelectorAll('[role="row"][data-id]')).toHaveLength(10)
    expect((screen.getByLabelText('Go to next page') as HTMLButtonElement).disabled).toBe(false)
  })

  /*
   * The grid centres a plain value it renders itself and does NOT centre a
   * node returned from `renderCell`. A row mixing the two sat its text and
   * its chips on lines a few pixels apart — misalignment that reads as broken
   * without being nameable, and the second layout defect reported on this
   * card.
   */
  it('centres every cell so text and chips sit on one line', () => {
    render(
      card([ROW]),
    )
    const cell = document.querySelector(
      '[data-field="status"][role="gridcell"]',
    ) as HTMLElement
    const style = getComputedStyle(cell)
    expect(style.display).toBe('flex')
    expect(style.alignItems).toBe('center')
  })

  it('renders Sent through a formatter, so the grid owns its layout', () => {
    render(
      card([ROW]),
    )
    // A formatter leaves the grid to draw the text, which is what puts it on
    // the same line as every other plain cell; a custom node opts out of that
    // and has to reproduce the centering itself.
    const cell = document.querySelector('[data-field="sentAtMs"][role="gridcell"]')
    expect(cell?.querySelector('p')).toBeNull()
    expect(cell?.textContent).toMatch(/\d{4}/)
  })

  it('sorts Sent on the timestamp, not on its formatted text', () => {
    render(
      card(rowsOf(3)),
    )
    // A formatted date sorts alphabetically — "Aug" before "Dec" before
    // "Jan" — so the column has to carry the number and format only at render.
    const cell = document.querySelector('[data-field="sentAtMs"][role="gridcell"]')
    expect(cell).toBeTruthy()
    expect(cell?.textContent).toMatch(/\d{4}/)
  })

  describe('the states that are not a table', () => {
    it('separates a failed read from an empty one', () => {
      const { rerender } = render(
        card([], { failed: true }),
      )
      // The distinction the card exists to preserve: one of these means "we
      // never emailed them" and the other means "we cannot tell".
      expect(screen.getByRole('alert').textContent).toContain('could not be read')

      rerender(
        card([]),
      )
      expect(screen.queryByRole('alert')).toBeNull()
      expect(
        screen.getByText(/No delivery events recorded for/),
      ).toBeTruthy()
    })

    it('says an empty table is not proof nothing was sent', () => {
      render(
        card([]),
      )
      expect(
        screen.getByText(/not proof that nothing was sent/),
      ).toBeTruthy()
    })
  })
})

describe('where the card is mounted', () => {
  /*
   * `CardColumns` is CSS multicol and its own docblock says multicol cannot
   * span. A six-column paginated grid inside it renders at half the page with
   * the last column clipped — which is exactly what shipped. The wide cards on
   * this page (the audit table, the sign-in history) already sit outside it,
   * and this belongs with them.
   *
   * Asserted against the SOURCE because the defect is a mounting decision, not
   * a rendered property: the page renders the same markup either way and only
   * the available width differs, which jsdom has no opinion about.
   */
  it('sits outside CardColumns, with the other full-width cards', () => {
    const source = readFileSync(
      join(__dirname, '..', 'app', '(app)', 'admin', 'users', '[uid]', 'page.tsx'),
      'utf8',
    )
    const columnsStart = source.indexOf('<CardColumns')
    const columnsEnd = source.indexOf(']}\n                  />', columnsStart)
    const mount = source.indexOf('<StaffUserEmailHistoryCard')

    expect(columnsStart).toBeGreaterThan(-1)
    expect(mount).toBeGreaterThan(-1)
    expect(mount).toBeGreaterThan(columnsEnd)
  })
})
