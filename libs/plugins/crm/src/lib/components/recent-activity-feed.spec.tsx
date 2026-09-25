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
 * The recent-activity feed is a glance, not a log (AGL-2600).
 *
 * Three things it must do that the record cards do not:
 *
 *  1. Link every row to the record it is about, through `crmRoutes`, with
 *     the contact winning over the deal winning over the company — a call
 *     filed against all three is a conversation with a person.
 *  2. Offer no controls on any row, the reader's own included, and pay for
 *     none: the feed is drawn on every visit to the contacts list, and a
 *     member read to decide who may edit what it will not offer is a read
 *     for nothing.
 *  3. Draw nothing at all when nothing has been logged — an empty heading on
 *     the landing is a promise about a feature the reader has not used.
 *
 * And, since AGL-3334, be a card of its own whose rows are collapsed to one
 * line each, opened one at a time or all at once from the card header.
 */

import { useScopeTokens } from '@aglyn/tenant-feature-instance'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { RecentActivityFeed } from './recent-activity-feed'

const activityRows = [
  {
    $id: 'act-1',
    kind: 'call',
    body: 'Called about the renewal',
    atMs: 4_000,
    byUid: 'u-1',
    byName: 'Ada Admin',
    hostId: 'host-1',
    visibleTo: ['host:host-1'],
    contactId: 'con-1',
    dealId: 'deal-1',
    companyId: 'co-1',
  },
  {
    $id: 'act-2',
    kind: 'meeting',
    body: 'Pipeline review',
    atMs: 3_000,
    byUid: 'u-2',
    byName: 'Grace Hopper',
    hostId: 'host-1',
    visibleTo: ['host:host-1'],
    dealId: 'deal-1',
    companyId: 'co-1',
  },
  {
    $id: 'act-3',
    kind: 'note',
    subject: 'Moved offices',
    body: 'The new address is on the company record.',
    atMs: 2_000,
    byUid: 'u-2',
    byName: 'Grace Hopper',
    hostId: 'host-1',
    visibleTo: ['host:host-1'],
    companyId: 'co-1',
  },
]

let mockRows: typeof activityRows = activityRows

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  usePagedCollection: () => ({
    data: mockRows,
    rows: mockRows,
    hasMore: false,
    page: 0,
    pageSize: 10,
    setPage: jest.fn(),
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  }),
  // Would admit the signed-in user to edit anything if the feed consulted it
  // with an org — which is exactly what the feed must not do.
  useScopeTokens: jest.fn(() => ({ tokens: ['org'], orgWide: true, loaded: true })),
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
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({
    header,
    HeaderProps,
    children,
  }: {
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
    children: ReactNode
  }) => (
    <section aria-label={String(header)}>
      <h2>{header}</h2>
      <div data-testid="card-header">{HeaderProps?.action}</div>
      {children}
    </section>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockRows = activityRows
})

const renderFeed = () =>
  render(<RecentActivityFeed hostId="host-1" org={{}} basePath="/o/hosts/h/crm" />)

describe('RecentActivityFeed (AGL-2600)', () => {
  it('links each row to its record — the contact over the deal over the company', () => {
    renderFeed()
    expect(screen.getByText('Recent activity')).toBeTruthy()
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/o/hosts/h/crm/contacts/con-1',
      '/o/hosts/h/crm/deals/deal-1',
      '/o/hosts/h/crm/companies/co-1',
    ])
    expect(links.map((link) => link.textContent)).toEqual(['Contact', 'Deal', 'Company'])
  })

  it("offers no controls, the reader's own row included, and reads no membership to say so", () => {
    renderFeed()
    expect(screen.getByText('Called about the renewal')).toBeTruthy()
    expect(screen.queryAllByLabelText('Edit activity')).toHaveLength(0)
    expect(screen.queryAllByLabelText('Delete activity')).toHaveLength(0)
    // Every consultation of the membership hook was for NO org — the shape
    // that opens no read.
    const asked = (useScopeTokens as jest.Mock).mock.calls.map(([orgId]) => orgId)
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((orgId) => orgId === undefined)).toBe(true)
  })

  it('is a card of its own, its rows collapsed and opened from the header (AGL-3334)', () => {
    renderFeed()
    expect(screen.getByRole('region', { name: 'Recent activity' })).toBeTruthy()
    // Collapsed: the subject and who logged it, not the note under it.
    expect(screen.getByText('Moved offices')).toBeTruthy()
    expect(screen.getAllByText(/Grace Hopper/)).toHaveLength(2)
    expect(screen.queryByText('The new address is on the company record.')).toBeNull()
    fireEvent.click(
      within(screen.getByTestId('card-header')).getByRole('button', { name: 'Expand all' }),
    )
    expect(screen.getByText('The new address is on the company record.')).toBeTruthy()
    // One page, and the footer says so.
    expect(screen.getByText('1–3 of 3')).toBeTruthy()
  })

  it('draws nothing when nothing has been logged yet', () => {
    mockRows = []
    const { container } = renderFeed()
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('Recent activity')).toBeNull()
  })
})
