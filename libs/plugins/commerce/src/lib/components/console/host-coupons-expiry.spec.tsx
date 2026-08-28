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
 * A COUPON CAN BE GIVEN AN EXPIRY (AGL-2511).
 *
 * Both checkout doors already refuse a coupon whose `expiresAtMs` has passed —
 * `checkout.ts` and `cart-checkout.ts` — and nothing ever wrote the field. So
 * the gate read as enforcement while every coupon ever created was immortal: a
 * launch code stayed redeemable forever, and the merchant believed they had
 * withdrawn a discount they had not.
 *
 * A gate on a field nothing populates is worse than no gate, because it reads
 * as protection. Either the console writes it or the gate goes; the console
 * writes it.
 *
 * ASSERTED ON THE WRITE — the document handed to `setDoc`, which is the thing
 * the checkout will later read — never on rendered output.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const setDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: () => ({}),
  query: () => ({}),
  limit: () => ({}),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: (...args: unknown[]) => setDoc(...args),
  updateDoc: jest.fn(),
  Timestamp: { now: () => 'SERVER_TIME' },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => ({ org: { plan: 'pro' }, ready: true }),
  useFirestoreCollection: () => ({ data: [] }),
  usePagedCollection: () => ({
    rows: [],
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 25,
    setPageSize: jest.fn(),
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

import { HostCouponsCard } from './host-coupons-card.component'

/** Fills the New-coupon dialog and presses Create. */
async function createCoupon(fields: { expiresOn?: string }) {
  render(<HostCouponsCard hostId="host-1" />)
  fireEvent.click(screen.getByText('Add coupon'))
  fireEvent.change(screen.getByLabelText('Code'), {
    target: { value: 'LAUNCH20' },
  })
  fireEvent.change(screen.getByLabelText('Percent off'), {
    target: { value: '20' },
  })
  if (fields.expiresOn != null) {
    fireEvent.change(screen.getByLabelText('Expires'), {
      target: { value: fields.expiresOn },
    })
  }
  fireEvent.click(screen.getByText('Create'))
  await waitFor(() => expect(setDoc).toHaveBeenCalled())
  return setDoc.mock.calls[0][1] as Record<string, unknown>
}

beforeEach(() => {
  setDoc.mockClear()
})

describe('coupon expiry (AGL-2511)', () => {
  it('writes the epoch the checkouts gate on', async () => {
    const written = await createCoupon({ expiresOn: '2026-09-05' })

    // The END of that day in the merchant's own timezone: "expires September
    // 5th" has to mean the 5th still works, and the server comparison is
    // absolute epoch, so local end-of-day is what carries that across.
    expect(written.expiresAtMs).toBe(Date.parse('2026-09-05T23:59:59.999'))
  })

  it('CONTROL: a coupon with no expiry still writes none', async () => {
    // Without this the change could satisfy the assertion above while
    // stamping every coupon with an expiry nobody asked for — which would
    // silently kill working codes rather than merely failing to limit them.
    const written = await createCoupon({})

    expect(written).not.toHaveProperty('expiresAtMs')
    // CONTROL that the form still works at all.
    expect(written.percentOff).toBe(20)
    expect(written.enabled).toBe(true)
  })
})
