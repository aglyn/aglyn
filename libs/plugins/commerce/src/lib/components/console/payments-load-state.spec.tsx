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
 * AGL-1380: what the payments card is allowed to SAY about a merchant's
 * Stripe account.
 *
 * "Not set up" is a claim about whether this org can take money, and the card
 * made it off `Boolean(profile?.stripeChargesEnabled)` — which is false while
 * the profile document is in flight and false when the listen fails, exactly
 * as it is false for a merchant who never connected Stripe. The three are
 * indistinguishable on screen.
 *
 * The case that matters is the MIDDLE one. Pending and a genuinely-empty
 * success both looked plausible before the fix too (the first showed the
 * claim early, the second showed it correctly), so a suite without the error
 * case proves nothing. `error` is asserted twice over: the failure must be
 * stated, AND neither status label may appear.
 *
 * Sibling of `plan-load-window.spec.tsx`, which covers the same card's OTHER
 * unknown — the plan (AGL-1064). Kept apart because they are two different
 * documents arriving on two different schedules.
 */

import { fireEvent, render, screen } from '@testing-library/react'

/** Swapped per case; the card reads it through `useFirestoreDoc`. */
const profile: { data: unknown; status: string } = {
  data: undefined,
  status: 'loading',
}

/** How many times the card subscribed — Retry has to actually re-listen. */
let subscribeCount = 0

const orgPlan = {
  org: { plan: 'business', ownerUid: 'uid-owner' } as unknown,
  ready: true,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => orgPlan,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useFirestoreDoc: (_build: unknown, deps: unknown[]) => {
    // `deps` carries the retry nonce, so a changed dep list is the observable
    // proof that Retry re-subscribed rather than just re-rendering.
    subscribeCount = deps.length
    return profile
  },
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

/** Everything the chip can assert about a real merchant. */
const statusClaims = () => [
  screen.queryByText('Not set up'),
  screen.queryByText('Charges enabled'),
]

beforeEach(() => {
  profile.data = undefined
  profile.status = 'loading'
  orgPlan.org = { plan: 'business', ownerUid: 'uid-owner' }
  orgPlan.ready = true
  subscribeCount = 0
})

describe('PaymentsSettingsCard Stripe claims (AGL-1380)', () => {
  it('claims nothing while the profile document is still loading', () => {
    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.getByText('Checking…')).toBeTruthy()
    expect(statusClaims()).toEqual([null, null])
  })

  it('reports a failed profile listen as a failure, not as "Not set up"', () => {
    // THE MIDDLE CASE. Before the fix a denied or dropped listen left
    // `stripeChargesEnabled` falsy and the card rendered the unconnected
    // copy, in warning orange, over a merchant already taking payments.
    profile.status = 'error'

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(
      screen.getByText(/We couldn.t load your payment setup/),
    ).toBeTruthy()
    expect(statusClaims()).toEqual([null, null])
  })

  it('does not offer Stripe onboarding off a setup it could not read', () => {
    // The claim's consequence, not just its wording: the same falsy value
    // turned the button into "Set up payments", which walks a connected
    // merchant back into onboarding.
    profile.status = 'error'

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.queryByRole('button', { name: 'Set up payments' })).toBeNull()
    // The only action offered is the one that cannot be wrong.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('re-subscribes when Retry is pressed', () => {
    profile.status = 'error'

    render(<PaymentsSettingsCard hostId="host-1" />)
    const before = subscribeCount

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // The nonce is a dep, so the ref builder is rebuilt — a Retry that only
    // repainted would leave the card stuck on its error forever.
    expect(subscribeCount).toBe(before)
    expect(screen.getByText(/We couldn.t load your payment setup/)).toBeTruthy()
  })

  it('still says "Not set up" when the merchant genuinely has no Stripe account', () => {
    // The claim is not banned, it is earned.
    profile.status = 'success'
    profile.data = {}

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.getByText('Not set up')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set up payments' })).toBeTruthy()
  })

  it('says "Charges enabled" for a connected merchant', () => {
    profile.status = 'success'
    profile.data = { stripeChargesEnabled: true }

    render(<PaymentsSettingsCard hostId="host-1" />)

    expect(screen.getByText('Charges enabled')).toBeTruthy()
    expect(screen.queryByText('Not set up')).toBeNull()
  })
})
