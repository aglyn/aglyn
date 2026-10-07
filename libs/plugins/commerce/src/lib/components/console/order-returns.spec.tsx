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
 * The order dialog's returns (AGL-3611): one `orderId ==` query, each return
 * opening its dialog, and "Start return" only where the route would take one.
 */

import { fireEvent, render, screen } from '@testing-library/react'

let mockBuilt: any[] = []
let mockReturns: any[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: any, ...constraints: unknown[]) => ({ path: base.path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  limit: (value: number) => ({ limit: value }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: jest.fn(async () => 'tok') } }),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (built) mockBuilt.push(built)
    return { data: built?.path?.endsWith('/returns') ? mockReturns : [] }
  },
  useFirestoreDoc: (build: () => any) => ({
    data: build()?.path === 'hosts/host-1/returns/ret-1' ? mockReturns[0] : undefined,
  }),
}))

jest.mock('@aglyn/aglyn/app-utils/console-widget-slot-context', () => ({
  useConsoleWidgetSlot: () => null,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

import OrderReturns from './order-returns.component'

const order = (status: string) =>
  ({
    status,
    lineItems: [{ productId: 'p1', name: 'Ceramic mug', quantity: 2, unitAmountCents: 1500 }],
    fulfillments: [{ id: 'f1', lines: [{ lineItemId: 0, quantity: 2 }], atMs: 1, status: 'active' }],
  }) as never

beforeEach(() => {
  mockBuilt = []
  mockReturns = []
})

describe('the order dialog lists the order’s returns (AGL-3611)', () => {
  it('reads them with one orderId == query', () => {
    render(<OrderReturns hostId="host-1" orderId="order-1" order={order('fulfilled')} />)
    expect(mockBuilt[0]).toEqual({
      path: 'hosts/host-1/returns',
      constraints: [{ where: ['orderId', '==', 'order-1'] }],
    })
  })

  it.each(['paid', 'partially_fulfilled', 'fulfilled', 'delivered'])(
    'offers Start return on a %s order',
    (status) => {
      render(<OrderReturns hostId="host-1" orderId="order-1" order={order(status)} />)
      expect(screen.getByRole('button', { name: 'Start return' })).toBeTruthy()
    },
  )

  it.each(['pending', 'cancelled', 'refunded'])('offers none on a %s order', (status) => {
    render(<OrderReturns hostId="host-1" orderId="order-1" order={order(status)} />)
    expect(screen.queryByRole('button', { name: 'Start return' })).toBeNull()
  })

  it('lists a return and opens its dialog', () => {
    mockReturns = [
      {
        $id: 'ret-1',
        orderId: 'order-1',
        orderNumber: '#1042',
        lines: [{ lineItemId: 0, quantity: 1, reason: 'damaged' }],
        status: 'requested',
        requestedBy: 'buyer',
        timeline: [],
        createdAtMs: Date.UTC(2026, 9, 2),
      },
    ]
    render(<OrderReturns hostId="host-1" orderId="order-1" order={order('refunded')} />)
    fireEvent.click(screen.getByRole('button', { name: '1× Ceramic mug' }))
    expect(screen.getByText('Return for order #1042')).toBeTruthy()
  })
})
