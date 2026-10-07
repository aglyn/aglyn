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
 * THE RETURNS LIST FILTERS ON ITS QUERY (AGL-3611).
 *
 * The status filter is a `where` on the one query the footer pages, ordered
 * newest first — never a match over a loaded window. Asserted on the query the
 * card BUILDS, which is what Firestore is asked, not on the rows it renders.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

let mockBuilt: any[] = []
let mockRows: any[] = []
let mockSearch = ''

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: any, ...constraints: unknown[]) => ({ path: base.path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
  limit: (value: number) => ({ limit: value }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: jest.fn(async () => 'tok') } }),
  usePagedCollection: (build: (pageLimit: number) => any) => {
    mockBuilt.push(build(11))
    return {
      rows: mockRows,
      hasMore: false,
      page: 0,
      setPage: jest.fn(),
      pageSize: 10,
      setPageSize: jest.fn(),
      status: 'success',
    }
  },
  // The dialog the seeded id opens.
  useFirestoreDoc: (build: () => any) => {
    const ref = build()
    return {
      data:
        ref?.path === 'hosts/host-1/returns/ret-7'
          ? {
              orderId: 'order-1',
              orderNumber: '#1042',
              customerName: 'Ada',
              customerEmail: 'ada@example.com',
              lines: [{ lineItemId: 0, quantity: 1, reason: 'damaged' }],
              status: 'requested',
              requestedBy: 'buyer',
              timeline: [],
              createdAtMs: 1,
              updatedAtMs: 1,
            }
          : undefined,
    }
  },
  useFirestoreCollection: () => ({ data: [] }),
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/aglyn/app-utils/console-widget-slot-context', () => ({
  useConsoleWidgetSlot: () => null,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: (props: { header: ReactNode; HeaderProps?: { action?: ReactNode }; children: ReactNode }) => (
    <div>
      <h2>{props.header}</h2>
      {props.HeaderProps?.action}
      {props.children}
    </div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-pagination.component', () => ({
  ListPagination: () => null,
}))

import ReturnsCard from './returns-card.component'

beforeEach(() => {
  mockBuilt = []
  mockRows = []
  mockSearch = ''
})

const lastQuery = () => mockBuilt[mockBuilt.length - 1]

const pickStatus = (label: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: label }))
}

describe('the returns list query (AGL-3611)', () => {
  it('lists every return newest first, paged, with no status predicate', () => {
    render(<ReturnsCard hostId="host-1" />)
    expect(lastQuery()).toEqual({
      path: 'hosts/host-1/returns',
      constraints: [{ orderBy: ['createdAtMs', 'desc'] }, { limit: 11 }],
    })
  })

  it.each([
    ['Requested', 'requested'],
    ['Approved', 'approved'],
    ['Received', 'received'],
    ['Refunded', 'refunded'],
  ])('filters %s on the query: status == %s, ordered by createdAtMs desc', (label, status) => {
    render(<ReturnsCard hostId="host-1" />)
    pickStatus(label)
    expect(lastQuery()).toEqual({
      path: 'hosts/host-1/returns',
      constraints: [
        { where: ['status', '==', status] },
        { orderBy: ['createdAtMs', 'desc'] },
        { limit: 11 },
      ],
    })
  })

  it('says so when a filter has no returns', () => {
    render(<ReturnsCard hostId="host-1" />)
    pickStatus('Declined')
    expect(screen.getByText('No declined returns.')).toBeTruthy()
  })

  it('draws a row with the order, the buyer, the units and the status', () => {
    mockRows = [
      {
        $id: 'ret-1',
        orderNumber: '#1042',
        customerName: 'Ada Lovelace',
        customerEmail: 'ada@example.com',
        lines: [
          { lineItemId: 0, quantity: 2, reason: 'damaged' },
          { lineItemId: 1, quantity: 1, reason: 'other' },
        ],
        status: 'requested',
        createdAtMs: Date.UTC(2026, 9, 1),
      },
    ]
    render(<ReturnsCard hostId="host-1" />)
    expect(screen.getByText('#1042 · Ada Lovelace')).toBeTruthy()
    expect(screen.getByText(/^3 items · Requested /)).toBeTruthy()
    expect(screen.getByText('Requested', { selector: '.MuiChip-label' })).toBeTruthy()
  })

  it('opens the return named by ?return= on arrival', () => {
    mockSearch = 'return=ret-7'
    render(<ReturnsCard hostId="host-1" />)
    expect(screen.getByText('Return for order #1042')).toBeTruthy()
  })
})
