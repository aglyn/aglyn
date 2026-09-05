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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    actions,
    children,
  }: {
    header: ReactNode
    actions: ReactNode
    children: ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {actions}
      {children}
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

describe('RecordActivityCard (AGL-2600)', () => {
  it('files a new activity against the company alone, with the full scope stamp', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Log activity' }))
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

  it('offers "Show more" only while the probe says more exists, and widens the window', () => {
    mockPaged.mockReturnValue({
      ...mockPaged(),
      hasMore: true,
    })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(setPage).toHaveBeenCalledWith(1)
  })

  it('has no foot when the window already holds everything', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })
})
