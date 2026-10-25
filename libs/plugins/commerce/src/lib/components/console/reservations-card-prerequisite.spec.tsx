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
 * The Reservations card's Stripe notice (AGL-3853, spec AGL-3982): every
 * reservation is paid when it is booked, so a store that cannot charge turns
 * each guest away. The card says so up front, with the way to Payments, and
 * says nothing while the answer is pending or once Stripe is ready.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import ReservationsCard from './reservations-card.component'

/** Swapped per case: what the store's Stripe account can do. */
const PAYMENTS_READY = { state: 'ready', settled: true, ready: true, blocked: false, reason: null, href: null }
let mockPayments: Record<string, unknown> = PAYMENTS_READY

/** ONE store object: a fresh one per render re-keys every memo built on it. */
const mockFirestore = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useMerchantPayments: () => mockPayments,
  useUser: () => ({ data: null }),
  useFirestore: () => mockFirestore,
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  usePagedCollection: () => ({
    rows: [],
    hasMore: false,
    loadMore: () => undefined,
    windowSize: 25,
    page: 0,
    setPage: () => undefined,
    pageSize: 25,
    setPageSize: () => undefined,
    data: [],
    status: 'success',
    fromCache: false,
  }),
  writeGuardedBySeed: async (_guard: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
}))
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  orderBy: () => undefined,
  where: () => undefined,
  doc: () => ({}),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

beforeEach(() => {
  mockPayments = PAYMENTS_READY
})

describe('ReservationsCard says when guests cannot pay (AGL-3853)', () => {
  it('names the Stripe step and links to Payments while the store cannot charge', () => {
    mockPayments = {
      state: 'not-connected',
      settled: true,
      ready: false,
      blocked: true,
      reason: 'Connect Stripe to take card payments.',
      href: '/acme/hosts/shop/products/payments',
    }
    render(<ReservationsCard hostId="host-1" />)
    expect(
      screen.getByText(
        "Connect Stripe to take card payments. Guests pay when they reserve, so they can't reserve until it is set up.",
      ),
    ).toBeTruthy()
    expect(screen.getByText('Open Payments').closest('a')?.getAttribute('href')).toBe(
      '/acme/hosts/shop/products/payments',
    )
  })

  it('carries Stripe’s own reason for an account that is connected but not finished', () => {
    mockPayments = {
      state: 'charges-disabled',
      settled: true,
      ready: false,
      blocked: true,
      reason: 'Finish setting up Stripe to take card payments: Stripe has not turned on charges for this account yet.',
      href: '/acme/hosts/shop/products/payments',
    }
    render(<ReservationsCard hostId="host-1" />)
    expect(screen.getByText(/^Finish setting up Stripe to take card payments/)).toBeTruthy()
  })

  it('says nothing while the answer is pending', () => {
    mockPayments = { state: 'pending', settled: false, ready: false, blocked: false, reason: null, href: null }
    render(<ReservationsCard hostId="host-1" />)
    expect(screen.queryByText('Open Payments')).toBeNull()
  })

  it('THE CONTROL: says nothing once Stripe takes payments', () => {
    render(<ReservationsCard hostId="host-1" />)
    expect(screen.getByText('Resources')).toBeTruthy()
    expect(screen.queryByText('Open Payments')).toBeNull()
  })
})
