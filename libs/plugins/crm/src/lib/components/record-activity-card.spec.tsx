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
 * The activity card of a company or a deal (AGL-2600).
 *
 *  1. A new activity is filed against the ONE record the page fixed — a
 *     company's card stamps `companyId` and neither of the other two ids —
 *     with the whole scope stamp a contact captured on this site would carry.
 *  2. Who may edit is decided once for the list, not once per row: the
 *     verdict reads the member document, and a list of a hundred calls must
 *     not read it a hundred times. The verdict itself still holds — the
 *     author's row has controls, a colleague's does not.
 *  3. The foot appears only while the probe row says more exists, and asking
 *     for more widens the window by one page.
 */

import { useScopeTokens } from '@aglyn/tenant-feature-instance'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { addDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { RecordActivityCard } from './record-activity-card'

const row = (id: string, byUid: string, atMs: number) => ({
  $id: id,
  kind: 'call',
  body: `Call ${id}`,
  atMs,
  byUid,
  byName: byUid === 'u-1' ? 'Ada Admin' : 'Grace Hopper',
  hostId: 'host-1',
  visibleTo: ['host:host-1'],
  companyId: 'co-1',
})

const activityRows = [row('act-1', 'u-1', 3_000), row('act-2', 'u-2', 2_000), row('act-3', 'u-2', 1_000)]

/** A message the platform sent (AGL-2615), by the signed-in user. */
const sentEmailRow = (deliveryState: string) => ({
  ...row('act-mail', 'u-1', 4_000),
  kind: 'email',
  subject: 'Quick question',
  body: 'Still keen?',
  to: 'ada@example.com',
  direction: 'outbound',
  deliveryState,
  deliveryAtMs: 4_500,
})

const mockPaged = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  usePagedCollection: (...args: unknown[]) => mockPaged(...args),
  // A SCOPED member, settled: only the author's own row may carry controls.
  useScopeTokens: jest.fn(() => ({ tokens: ['host:host-1'], orgWide: false, loaded: true })),
  useUser: () => ({ data: { uid: 'u-1' } }),
  useUserName: () => 'Ada Admin',
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (name: string) => name,
  where: () => undefined,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  // The per-record ceiling's one aggregate before a log (AGL-2611).
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  addDoc: jest.fn().mockResolvedValue({ id: 'act-4' }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    header,
    HeaderProps,
    actions,
    children,
  }: {
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
    actions?: ReactNode
    children: ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      <div data-testid="card-header">{HeaderProps?.action}</div>
      {children}
      {actions ? <div data-testid="card-foot">{actions}</div> : null}
    </section>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

const setPage = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  mockPaged.mockReturnValue({
    data: activityRows,
    rows: activityRows,
    hasMore: false,
    page: 0,
    pageSize: 100,
    setPage,
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  })
})

const renderCard = () =>
  render(<RecordActivityCard hostId="host-1" org={{}} companyId="co-1" />)

const header = () => within(screen.getByTestId('card-header'))
const nextPage = () => screen.getByRole('button', { name: 'Go to next page' }) as HTMLButtonElement

/** A full first page: ten calls, newest first. */
const tenRows = Array.from({ length: 10 }, (_, index) =>
  row(`act-${index + 1}`, 'u-2', 10_000 - index),
)

describe('RecordActivityCard (AGL-2600)', () => {
  it('carries Log activity and Expand all in its header, and no foot of buttons', () => {
    renderCard()
    expect(header().getByRole('button', { name: 'Log activity' })).toBeTruthy()
    expect(header().getByRole('button', { name: 'Expand all' })).toBeTruthy()
    expect(screen.queryByTestId('card-foot')).toBeNull()
  })

  it('files a new activity against the company alone, with the full scope stamp', async () => {
    renderCard()
    fireEvent.click(header().getByRole('button', { name: 'Log activity' }))
    fireEvent.change(screen.getByLabelText('What happened'), {
      target: { value: 'Toured the roastery' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))

    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1))
    const [path, payload] = (addDoc as jest.Mock).mock.calls[0]
    expect(path).toBe('orgs/org-1/crmActivities')
    expect(payload).toEqual(
      expect.objectContaining({
        kind: 'call',
        body: 'Toured the roastery',
        companyId: 'co-1',
        visibleTo: ['host:host-1'],
        hostId: 'host-1',
        byUid: 'u-1',
        byName: 'Ada Admin',
      }),
    )
    expect(payload).not.toHaveProperty('contactId')
    expect(payload).not.toHaveProperty('dealId')
  })

  it('decides who may edit once for the list, and the verdict still picks out the author', () => {
    renderCard()
    expect(screen.getByText('Call act-1')).toBeTruthy()
    expect(screen.getByText('Call act-3')).toBeTruthy()
    // Three rows drawn; the membership was consulted fewer times than that.
    // A row deciding for itself would ask once per row.
    expect((useScopeTokens as jest.Mock).mock.calls.length).toBeLessThan(activityRows.length)
    expect(screen.getAllByLabelText('Edit activity')).toHaveLength(1)
    expect(screen.getAllByLabelText('Delete activity')).toHaveLength(1)
  })

  it('pages ten at a time, and widens the window only when a page is turned past it', () => {
    mockPaged.mockReturnValue({
      ...mockPaged(),
      data: [...tenRows, row('act-probe', 'u-2', 1)],
      rows: tenRows,
      pageSize: 10,
      hasMore: true,
    })
    renderCard()
    expect(screen.getByText('Call act-1')).toBeTruthy()
    expect(screen.getByText('Call act-10')).toBeTruthy()
    expect(screen.queryByText('Call act-probe')).toBeNull()
    // A full first page asks nothing more of the listener.
    expect(setPage).not.toHaveBeenCalled()
    expect(nextPage().disabled).toBe(false)
    fireEvent.click(nextPage())
    expect(setPage).toHaveBeenCalledWith(1)
  })

  it('offers no next page when the window already holds everything', () => {
    renderCard()
    expect(nextPage().disabled).toBe(true)
    expect(setPage).not.toHaveBeenCalled()
  })
})

describe('a sent email on the log (AGL-2615)', () => {
  const renderWith = (rows: unknown[]) => {
    mockPaged.mockReturnValue({
      data: rows,
      rows,
      hasMore: false,
      page: 0,
      pageSize: 100,
      setPage,
      setPageSize: jest.fn(),
      status: 'success',
      fromCache: false,
    })
    return renderCard()
  }

  it('collapses to its subject, its recipient and its delivery state, and opens to the body', () => {
    renderWith([sentEmailRow('opened')])
    expect(screen.getByText('Quick question')).toBeTruthy()
    expect(screen.getByTestId('activity-delivery-state').textContent).toBe('Opened')
    expect(screen.getByText(/to ada@example\.com/)).toBeTruthy()
    // Collapsed: the body is one click away, not on the row.
    expect(screen.queryByText('Still keen?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Quick question' }))
    expect(screen.getByText('Still keen?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Quick question' }))
    expect(screen.getByText('Quick question')).toBeTruthy()
  })

  it('opens every entry from the header, and closes them again', () => {
    renderWith([sentEmailRow('opened'), { ...sentEmailRow('sent'), $id: 'act-mail-2', subject: 'Following up', body: 'Any news?' }])
    expect(screen.queryByText('Still keen?')).toBeNull()
    expect(screen.queryByText('Any news?')).toBeNull()
    fireEvent.click(header().getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('Still keen?')).toBeTruthy()
    expect(screen.getByText('Any news?')).toBeTruthy()
    fireEvent.click(header().getByRole('button', { name: 'Collapse all' }))
    expect(header().getByRole('button', { name: 'Expand all' })).toBeTruthy()
  })

  it('reads a bounce as a failure', () => {
    renderWith([sentEmailRow('bounced')])
    const chip = screen.getByTestId('activity-delivery-state')
    expect(chip.textContent).toBe('Bounced')
    expect(chip.className).toMatch(/colorError/)
  })

  it('offers no edit for what was sent, and keeps the delete', () => {
    // The signed-in user is the author, so a hand-logged row would carry
    // both controls; a sent message is a record of a fact.
    renderWith([sentEmailRow('sent')])
    expect(screen.queryByLabelText('Edit activity')).toBeNull()
    expect(screen.getByLabelText('Delete activity')).toBeTruthy()
  })

  it('draws no state chip on a hand-logged email', () => {
    renderWith([{ ...row('act-9', 'u-1', 5_000), kind: 'email', body: 'Sent the deck' }])
    expect(screen.queryByTestId('activity-delivery-state')).toBeNull()
    expect(screen.getByLabelText('Edit activity')).toBeTruthy()
  })
})
