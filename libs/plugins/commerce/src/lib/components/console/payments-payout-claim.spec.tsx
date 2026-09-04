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
 * AGL-1997 on the COMMERCE card: "Payments are enabled" is a claim about two
 * Stripe flags, and the card was making it off one.
 *
 * `/api/commerce/connect` answers `chargesEnabled` and `payoutsEnabled`
 * separately, and the split is not academic — charges-yes/payouts-no is an
 * ordinary Stripe state (verification pending or lapsed, no payout method).
 * In it a merchant sells, the money lands in a Connect account, and nothing
 * can release it. Announcing success there is false in the one direction that
 * costs the merchant money, and it is invisible: the sale succeeds, the
 * dashboard looks healthy, and the funds simply never arrive.
 *
 * The assertion surface is the `enqueueSnackbar` CALL — its message and its
 * variant — not the rendered toast. The toast is a portal owned by the
 * snackbar library; what this card is responsible for is which claim it asks
 * for, and the variant carries half the meaning (a green success and an amber
 * warning say different things about the same sentence).
 *
 * The CONTROL is the payouts-enabled case. A suite that only pinned the
 * blocked wording would pass just as well against a card that had been broken
 * the other way — one that cried "not released yet" at every healthy merchant
 * — so both arms are asserted, plus the three-valued middle: an ABSENT
 * `payoutsEnabled` means the question was never answered, not that payouts
 * are off, and must not downgrade the claim either.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const enqueueSnackbar = jest.fn()

const profile: { data: unknown; status: string } = {
  data: { stripeChargesEnabled: false },
  status: 'success',
}

const orgPlan = {
  org: { plan: 'business', ownerUid: 'uid-owner' } as unknown,
  ready: true,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => orgPlan,
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
  useSnackbar: () => ({ enqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

import PaymentsSettingsCard from './payments-settings-card.component'

/**
 * Drives the card's own Connect button and returns the snackbar arguments it
 * asked for. The route's answer is the only input that varies.
 */
async function claimAfterConnect(answer: Record<string, unknown>) {
  ;(globalThis as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => answer,
  })
  render(<PaymentsSettingsCard hostId="host-1" />)
  fireEvent.click(screen.getByText('Set up payments'))
  await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
  const [message, options] = enqueueSnackbar.mock.calls[0]
  return { message, variant: (options ?? {}).variant }
}

beforeEach(() => {
  enqueueSnackbar.mockClear()
  profile.data = { stripeChargesEnabled: false }
  profile.status = 'success'
  orgPlan.org = { plan: 'business', ownerUid: 'uid-owner' }
  orgPlan.ready = true
})

describe('PaymentsSettingsCard payout claim (AGL-1997)', () => {
  it('refuses to call a payouts-blocked account "enabled"', async () => {
    // THE CASE THE FIX EXISTS FOR. Stripe has explicitly said payouts are not
    // enabled; the merchant may take money and may not receive it. The old
    // card read only `chargesEnabled` and answered the green success line.
    const claim = await claimAfterConnect({
      accountId: 'acct_test_1',
      chargesEnabled: true,
      payoutsEnabled: false,
    })

    expect(claim.message).toBe('Connected — payouts are not released yet')
    expect(claim.variant).toBe('warning')
  })

  it('still reports a fully enabled account as enabled', async () => {
    // CONTROL. Without this a card broken the other way — warning at every
    // healthy merchant — would satisfy the assertion above.
    const claim = await claimAfterConnect({
      accountId: 'acct_test_1',
      chargesEnabled: true,
      payoutsEnabled: true,
    })

    expect(claim.message).toBe('Payments are enabled')
    expect(claim.variant).toBe('success')
  })

  it('treats an unanswered payout flag as unasked, not as off', async () => {
    // The three-valued middle. Only a literal `false` is Stripe saying no; an
    // absent flag is a route that did not report one, and accusing a working
    // merchant off a missing field is the same class of error in reverse.
    const claim = await claimAfterConnect({
      accountId: 'acct_test_1',
      chargesEnabled: true,
    })

    expect(claim.message).toBe('Payments are enabled')
    expect(claim.variant).toBe('success')
  })
})
