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
      <StaffUserEmailHistoryCard rows={[ROW]} lookupFailed={false} address={ROW.to} />,
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
      <StaffUserEmailHistoryCard rows={[ROW]} lookupFailed={false} address={ROW.to} />,
    )
    for (const name of ['Message', 'Sender', 'Sent', 'Status', 'Opens', 'Clicks']) {
      expect(screen.getByRole('columnheader', { name })).toBeTruthy()
    }
  })

  it('keeps rows to a single line', () => {
    render(
      <StaffUserEmailHistoryCard rows={[ROW]} lookupFailed={false} address={ROW.to} />,
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

  it('paginates rather than drawing every row at once', () => {
    render(
      <StaffUserEmailHistoryCard
        rows={rowsOf(14)}
        lookupFailed={false}
        address={ROW.to}
      />,
    )
    // The shared console footer, not a wall of rows: this is what `ListTable`
    // is for, and the hand-rolled MUI table it replaced had neither.
    expect(screen.getByText('Rows per page:')).toBeTruthy()
    expect(document.querySelectorAll('[role="row"][data-id]')).toHaveLength(10)
  })

  it('sorts Sent on the timestamp, not on its formatted text', () => {
    render(
      <StaffUserEmailHistoryCard
        rows={rowsOf(3)}
        lookupFailed={false}
        address={ROW.to}
      />,
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
        <StaffUserEmailHistoryCard rows={[]} lookupFailed address={ROW.to} />,
      )
      // The distinction the card exists to preserve: one of these means "we
      // never emailed them" and the other means "we cannot tell".
      expect(screen.getByRole('alert').textContent).toContain('could not be read')

      rerender(
        <StaffUserEmailHistoryCard rows={[]} lookupFailed={false} address={ROW.to} />,
      )
      expect(screen.queryByRole('alert')).toBeNull()
      expect(
        screen.getByText(/No delivery events recorded for/),
      ).toBeTruthy()
    })

    it('says an empty table is not proof nothing was sent', () => {
      render(
        <StaffUserEmailHistoryCard rows={[]} lookupFailed={false} address={ROW.to} />,
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
