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
 * The staff Platform suppressions list is filtered and searched by its ROUTE
 * (AGL-3321): the search box and the Filters panel are the grid's, and what
 * they ask travels to `/api/admin/emails/suppressions` rather than narrowing
 * the page on screen. A released entry stays listed, marked, with nothing to
 * release; an ask the route refuses is shown as the route's reason.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockAuthorizedFetch = jest.fn()
// One object, as the real hook returns: a new user per render is a new
// `fetchPage`, and a new walk, on every render.
const mockUser = { data: { uid: 'staff-1' } }

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

import StaffEmailSuppressionsCard from '../components/staff-email-suppressions-card.component'

const answer = (status: number, body: Record<string, unknown>) => ({
  ok: status < 300,
  status,
  json: async () => body,
})

const ENTRIES = [
  {
    $id: 'k1',
    email: 'jane@example.com',
    reason: 'bounce',
    context: 'invite',
    hostId: null,
    releasedAt: null,
    suppressedAt: { seconds: 1_790_000_000 },
    createdAt: { seconds: 1_790_000_000 },
  },
  {
    $id: 'k2',
    email: 'lifted@example.com',
    reason: 'complaint',
    context: 'campaign',
    hostId: 'host-1',
    releasedAt: { seconds: 1_790_500_000 },
    suppressedAt: { seconds: 1_789_000_000 },
    createdAt: { seconds: 1_789_000_000 },
  },
]

const urls = () => mockAuthorizedFetch.mock.calls.map((call) => String(call[1]))

beforeEach(() => {
  mockAuthorizedFetch.mockReset()
  mockAuthorizedFetch.mockResolvedValue(answer(200, { entries: ENTRIES, hasMore: false }))
})

describe('StaffEmailSuppressionsCard (AGL-3321)', () => {
  it('lists every entry in a grid with Filters and a search box, released ones marked', async () => {
    render(<StaffEmailSuppressionsCard />)
    await screen.findByText('jane@example.com')
    expect(screen.getByRole('grid', { name: 'Platform suppressions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Filters/ })).toBeTruthy()
    expect(screen.getByRole('searchbox')).toBeTruthy()
    expect(screen.getByText('lifted@example.com')).toBeTruthy()
    expect(screen.getByText(/^Released \d{4}-\d{2}-\d{2}$/)).toBeTruthy()
    // One live entry, so one Release: a released entry suppresses nothing.
    expect(screen.getAllByRole('button', { name: 'Release' })).toHaveLength(1)
    // The first read asks for no filter and no search.
    expect(urls()[0]).not.toMatch(/filters=|search=/)
  })

  it('sends the search to the route, which answers it, rather than narrowing the page', async () => {
    render(<StaffEmailSuppressionsCard />)
    await screen.findByText('jane@example.com')
    mockAuthorizedFetch.mockResolvedValue(answer(200, { entries: [], hasMore: false }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'jane' } })
    await waitFor(() => expect(urls().some((url) => /[?&]search=jane(&|$)/.test(url))).toBe(true))
    await screen.findByText('No suppressions match these filters')
  })

  it('keeps the inline Why box on a release', async () => {
    render(<StaffEmailSuppressionsCard />)
    await screen.findByText('jane@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(screen.getByLabelText('Why')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it("shows the route's refusal instead of an empty list", async () => {
    mockAuthorizedFetch.mockResolvedValue(
      answer(400, { error: 'Filter by one of Reason, Learned from or Site ID at a time' }),
    )
    render(<StaffEmailSuppressionsCard />)
    await screen.findByText('Filter by one of Reason, Learned from or Site ID at a time')
    expect(screen.queryByText('Nothing is suppressed platform-wide.')).toBeNull()
  })
})
