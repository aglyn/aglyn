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
 * THE ORDERS LIST ANSWERS THE CRM'S TWO QUESTIONS (AGL-2622).
 *
 * A contact's header links here with `?email=` to show that customer's
 * orders, and a contact's timeline with `?order=` to open the order that
 * made them a customer. The first is a filter over the loaded window; the
 * second reads the one document by id when the window does not hold it,
 * because the window is the newest two hundred and the order may be older.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { getDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'

let search = ''
let orderRows: Array<Record<string, unknown>> = []
let stored: Record<string, unknown> | null = null

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
  query: (base: { __path: string }) => base,
  limit: () => undefined,
  orderBy: () => undefined,
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn(async () => ({
    id: 'order-old',
    exists: () => stored !== null,
    data: () => stored ?? undefined,
  })),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => ({ org: { plan: 'starter' }, ready: true }),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: (read ?? []).length > ceiling,
  }),
  useFirestoreCollection: (build: () => { __path: string }) => {
    const ref = build()
    if (ref.__path.endsWith('/orders')) return { data: orderRows }
    return { data: [] }
  },
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

import { HostOrdersCard } from './host-orders-card.component'

const order = (id: string, extra: Record<string, unknown> = {}) => ({
  $id: id,
  number: 1000,
  status: 'paid',
  createdAtMs: Date.now() - 60_000,
  refundedCents: 0,
  totals: { totalCents: 100 },
  channel: 'online',
  lineItems: [],
  timeline: [],
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  search = ''
  stored = null
  orderRows = []
})

describe('?email= narrows the list to one buyer', () => {
  it('seeds the Customer filter from the URL and shows that buyer alone', () => {
    search = 'email=ada%40example.test'
    orderRows = [
      order('o-1', { number: 1, customerEmail: 'ada@example.test' }),
      order('o-2', { number: 2, customerEmail: 'bob@example.test' }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    expect((screen.getByLabelText('Customer') as HTMLInputElement).value).toBe(
      'ada@example.test',
    )
    expect(screen.getByText('ada@example.test')).toBeTruthy()
    expect(screen.queryByText('bob@example.test')).toBeNull()
  })
})

describe('?order= opens one order', () => {
  it('opens the dialog from the window without a read when the order is in it', async () => {
    search = 'order=o-1'
    orderRows = [order('o-1', { number: 1042, customerEmail: 'ada@example.test' })]
    render(<HostOrdersCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('reads an order the window does not hold, once, and opens it', async () => {
    search = 'order=order-old'
    orderRows = [order('o-1', { number: 1 })]
    stored = order('order-old', { number: 7, customerEmail: 'old@example.test' })
    render(<HostOrdersCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(getDoc).toHaveBeenCalledTimes(1)
    expect((getDoc as jest.Mock).mock.calls[0][0]).toBe('hosts/host-1/orders/order-old')
    expect(screen.getByText(/old@example.test/)).toBeTruthy()
  })

  it('opens nothing when the URL names no order', () => {
    orderRows = [order('o-1')]
    render(<HostOrdersCard hostId="host-1" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getDoc).not.toHaveBeenCalled()
  })
})
