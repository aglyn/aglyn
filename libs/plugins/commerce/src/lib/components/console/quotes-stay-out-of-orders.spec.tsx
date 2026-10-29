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
 * AN UNPAID QUOTE IS NOT AN ORDER (AGL-4093).
 *
 * A quote lives in `hosts/{hostId}/orders` on the `quote` channel, numbered
 * from the order counter, and carries no `createdAtMs` or list fields. The
 * Orders list's default order and every filter order by `createdAtMs`, which
 * drops it; the card also drops one any other query reaches (an unfiltered
 * Order, Channel or Status header sort).
 *
 * `useListQuery` is the contract's double, answering the plan over the
 * fixtures the way Firestore would — a document missing the field it orders
 * by is not answered.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { lastListQueryPlan } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { orderListFields } from '../../model/order-list-fields'

const search = ''
let orderRows: Array<Record<string, unknown>> = []
const stored: Record<string, unknown> | null = null

jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    useListQuery: (options: unknown) => useListQueryDouble(() => orderRows, options),
  }
})

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
  query: (base: { __path: string }) => base,
  limit: () => undefined,
  orderBy: () => undefined,
  where: () => undefined,
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn(async () => ({
    id: 'order-old',
    exists: () => stored !== null,
    data: () => stored ?? undefined,
  })),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useMerchantPayments: () => ({ state: 'ready', settled: true, ready: true, blocked: false, reason: null, href: null }),
  useFirestore: () => ({}),
  useOrgPlan: () => ({ org: { plan: 'starter' }, ready: true }),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: (read ?? []).length > ceiling,
  }),
  // The product picker; the orders come through the list query's double.
  useFirestoreCollection: () => ({ data: [] }),
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

/** An order as the writers leave it, stamped with what the list queries. */
const order = (id: string, extra: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = {
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
  }
  return { ...row, ...orderListFields(row, id) }
}

/** A quote as `POST /api/commerce/quote` writes it: no `createdAtMs`, no list fields. */
const quote = (id: string, extra: Record<string, unknown> = {}) => ({
  $id: id,
  number: 1042,
  status: 'pending',
  channel: 'quote',
  lineItems: [{ productId: '', custom: true, name: 'Installation', quantity: 1, unitAmountCents: 30_000 }],
  totals: { itemsCents: 30_000, shippingCents: 0, taxCents: 0, discountCents: 0, feeCents: 0, totalCents: 30_000 },
  timeline: [],
  quote: { stage: 'draft', revision: 1, customer: { email: 'pat@example.test' }, createdAtMs: 1, updatedAtMs: 1 },
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  orderRows = []
})

describe('quotes stay out of the Orders list', () => {
  it('the newest-first list never answers an unpaid quote', () => {
    orderRows = [order('o-1', { number: 1000, customerEmail: 'ada@example.test' }), quote('q-1')]
    render(<HostOrdersCard hostId="host-1" />)
    expect(lastListQueryPlan()?.orderBy.path).toBe('createdAtMs')
    expect(screen.getByText('#1000')).toBeTruthy()
    expect(screen.queryByText('#1042')).toBeNull()
    expect(screen.queryByText('Installation')).toBeNull()
  })

  it('drops an unpaid quote any query does reach, and keeps a paid one as the order it became', () => {
    orderRows = [
      order('o-1', { number: 1000 }),
      // As an unfiltered Status sort would answer it.
      { ...quote('q-1'), createdAtMs: Date.now() - 1_000 },
      order('q-2', { number: 1043, channel: 'quote', status: 'paid', customerEmail: 'pat@example.test' }),
    ]
    render(<HostOrdersCard hostId="host-1" />)
    expect(screen.getByText('#1000')).toBeTruthy()
    expect(screen.queryByText('#1042')).toBeNull()
    expect(screen.getByText('#1043')).toBeTruthy()
  })

  it('keeps Quote out of the Channel filter, which would never find one', async () => {
    const { ORDER_CHANNEL_OPTIONS } = await import('../../constants/orders-list-query')
    expect(ORDER_CHANNEL_OPTIONS.map((option) => option.value)).not.toContain('quote')
  })
})
