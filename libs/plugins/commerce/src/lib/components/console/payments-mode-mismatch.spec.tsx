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
 * A TEST ACCOUNT ON A LIVE DEPLOYMENT IS NOT "CHARGES ENABLED" (AGL-2471).
 *
 * The card counted ANY recorded mode as verified, so a profile recording a
 * test account (`stripeAccountLivemode: false`) on a live deployment read
 * "Charges enabled" and offered only "Refresh status", while checkout refused
 * every sale as a mode mismatch. The card now asks the same verdict the
 * server does (`merchantPaymentsStateFromProfile`, the console's copy of
 * `merchantAccountReadiness`) against the deployment's publishable key.
 *
 * The controls are the live account on the live deployment (still "Charges
 * enabled") and the test account on a test deployment (test mode is not
 * broken).
 */

import { render, screen } from '@testing-library/react'

const profile: { data: unknown; status: string } = {
  data: null,
  status: 'success',
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useFirestore: () => ({}),
  useOrgPlan: () => ({
    org: { plan: 'business', ownerUid: 'uid-owner' },
    ready: true,
  }),
  useUser: () => ({
    data: { uid: 'uid-owner', getIdToken: jest.fn().mockResolvedValue('t') },
  }),
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

/** The production record: a direct-charge TEST account, charges on. */
const testAccount = {
  stripeAccountId: 'acct_test_1',
  stripeChargeModel: 'direct',
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeAccountLivemode: false,
}

const realKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

afterEach(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = realKey
})

describe('PaymentsSettingsCard on a mode mismatch (AGL-2471)', () => {
  it('shows a test account on a live deployment as the mismatch, with Set up payments', () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_spec'
    profile.data = testAccount

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.queryByText('Charges enabled')).toBeNull()
    expect(screen.getByText('Test account')).toBeTruthy()
    expect(
      screen.getByText(/connected Stripe account is a test account/),
    ).toBeTruthy()
    expect(screen.getByText(/Live payments need a live Stripe account/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set up payments' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Refresh status' })).toBeNull()
  })

  it('CONTROL: a live account on a live deployment is still charges enabled', () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_spec'
    profile.data = { ...testAccount, stripeAccountLivemode: true }

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.getByText('Charges enabled')).toBeTruthy()
    expect(screen.queryByText(/is a test account/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeTruthy()
  })

  it('CONTROL: a test account on a test deployment is charges enabled', () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_spec'
    profile.data = testAccount

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.getByText('Charges enabled')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeTruthy()
  })

  it('keeps the unverified alert for a live deployment with no recorded mode', () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_spec'
    profile.data = { ...testAccount, stripeAccountLivemode: undefined }

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.getByText('Not verified')).toBeTruthy()
    expect(screen.queryByText('Charges enabled')).toBeNull()
    expect(screen.getByRole('button', { name: 'Set up payments' })).toBeTruthy()
  })
})
