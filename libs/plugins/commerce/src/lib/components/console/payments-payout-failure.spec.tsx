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
 * A merchant is TOLD when a payout did not reach their bank (AGL-2513).
 *
 * Nothing handled `payout.failed`, so a storefront looked healthy from every
 * angle available to its owner — orders settling, this card reporting
 * "Payments are enabled" — while the funds sat in a Connect account that could
 * not release them. Aglyn now records the failure and mirrors it onto the
 * profile this card already reads.
 *
 * Asserted on the FIGURE and the reason the notice carries — the amount that
 * did not arrive and Stripe's own words for why — rather than on styling or
 * placement. The CONTROL is a profile with no failure: without it a card that
 * warned unconditionally would satisfy the first assertion perfectly.
 */

import { render, screen } from '@testing-library/react'

const profile: { data: unknown; status: string } = { data: {}, status: 'success' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => ({
    org: { plan: 'business', ownerUid: 'uid-owner' },
    ready: true,
  }),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: () => profile,
  useFirestoreCollection: () => ({ data: [] }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: () => ({}),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

import PaymentsSettingsCard from './payments-settings-card.component'

const CONNECTED = {
  stripeAccountId: 'acct_1',
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeAccountLivemode: false,
}

beforeEach(() => {
  profile.data = { ...CONNECTED }
  profile.status = 'success'
})

describe('payout failure on the payments card (AGL-2513)', () => {
  it('names the amount that did not arrive, and why', () => {
    profile.data = {
      ...CONNECTED,
      lastPayoutFailureAtMs: Date.parse('2026-08-20T12:00:00Z'),
      lastPayoutFailureCents: 42_000,
      lastPayoutFailureReason: 'The bank account has been closed.',
    }

    const { getByText } = render(<PaymentsSettingsCard hostId="host-1" />)

    const notice = getByText(/did not reach your bank/)
    expect(notice.textContent).toContain('$420.00')
    expect(notice.textContent).toContain('The bank account has been closed.')
    // The money is not lost, and saying so is what stops this reading as a
    // failed SALE.
    expect(notice.textContent).toContain('still in your Stripe account')
  })

  it('CONTROL: a healthy connected merchant is not warned', () => {
    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.queryByText(/did not reach your bank/)).toBeNull()
  })

  it('CONTROL: says nothing while the profile is still loading', () => {
    // The AGL-1380 rule this card already lives by: a claim about someone's
    // payouts made before the document arrives is a claim made without having
    // heard back.
    profile.data = undefined
    profile.status = 'loading'

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.queryByText(/did not reach your bank/)).toBeNull()
  })
})
