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
 * The notifications feed is a record list in the shared grid (AGL-3045).
 *
 * The grid scrolls its own columns inside the card, which the bare table it
 * replaced could not. What the grid has to keep: the row opens the
 * notification, an unread one says so, and the pager under the grid turns the
 * cursor feed — the grid holds one page, so it offers no search or filter
 * that would narrow that page and call it the whole feed.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => '/manage/notifications',
}))

import { NotificationsTable } from '../components/notifications-table.component'

const at = (iso: string) => ({ toDate: () => new Date(iso) })

const unread = {
  $id: 'n-1',
  type: 'billing.paymentFailed',
  title: 'Your payment failed',
  body: 'Update the card on file to keep the workspace running.',
  createdAt: at('2026-09-16T12:00:00Z'),
  readAt: null,
}
const read = {
  $id: 'n-2',
  type: 'billing.invoice',
  title: 'Your invoice is ready',
  body: null,
  createdAt: at('2026-09-15T12:00:00Z'),
  readAt: at('2026-09-15T13:00:00Z'),
}

const renderTable = (props: Partial<Parameters<typeof NotificationsTable>[0]> = {}) => {
  const handlers = {
    onOpen: jest.fn(),
    onPageChange: jest.fn(),
    onPageSizeChange: jest.fn(),
  }
  const view = render(
    <NotificationsTable
      rows={[unread, read]}
      page={0}
      pageSize={10}
      hasMore
      {...handlers}
      {...props}
    />,
  )
  return { ...view, ...handlers }
}

const rowOf = (text: string) =>
  screen.getByText(text).closest('[role="row"]') as HTMLElement

describe('NotificationsTable (AGL-3045)', () => {
  it('lists the feed in the shared grid, not a bare table', () => {
    const { container } = renderTable()
    const grid = screen.getByRole('grid', { name: 'Notifications' })
    expect(container.querySelectorAll('table')).toHaveLength(0)
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    expect(headers).toEqual(expect.arrayContaining(['Notification', 'Type', 'When', 'Status']))
    // The type reads as its label, and only the unread row is marked new.
    expect(within(rowOf('Your payment failed')).getByText('Payment failed')).toBeTruthy()
    expect(within(rowOf('Your payment failed')).getByText('New')).toBeTruthy()
    expect(within(rowOf('Your invoice is ready')).queryByText('New')).toBeNull()
  })

  it('opens a notification from its row', () => {
    const { onOpen } = renderTable()
    fireEvent.click(within(rowOf('Your invoice is ready')).getByText('Invoice available'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ $id: 'n-2' }))
  })

  it('turns the feed with the pager under the grid, and offers no search over one page', () => {
    const { onPageChange } = renderTable()
    // Positive control: the grid's toolbar is there, with what it keeps.
    expect(screen.getByRole('button', { name: 'Columns' })).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull()
    fireEvent.click(screen.getByLabelText('Go to next page'))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('says the feed is empty rather than drawing an empty grid', () => {
    renderTable({ rows: [], hasMore: false })
    expect(screen.getByText("You're all caught up.")).toBeTruthy()
    expect(screen.queryByRole('grid')).toBeNull()
  })
})
