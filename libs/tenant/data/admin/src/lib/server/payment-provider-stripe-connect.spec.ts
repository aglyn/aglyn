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
 *
 * @jest-environment node
 */

/**
 * CONNECT MODE (AGL-2471).
 *
 * Production Firestore held three Connect linkages and ALL THREE named
 * test-mode accounts. One of them carried `stripeChargesEnabled: true`, so
 * every money door read it as "payments ready" — and the live-mode Checkout
 * session it then minted, with a test-mode `transfer_data[destination]`,
 * could only ever be refused by Stripe. Three storefronts presented as fully
 * configured and could not take one payment.
 *
 * The account id is NOT the evidence. `acct_1TulDeRbL3B9Ioqz` is a real
 * production-database value naming a TEST account: Stripe's account ids carry
 * no mode marker, and the only thing that told the two apart was asking
 * Stripe, which answered `400 ... was a test account created with a testmode
 * key`. So mode is recorded from what Stripe states — `event.livemode` on
 * `account.updated`, or the platform mode confirmed against `/v1/balance` at
 * onboarding — and compared here.
 */

const syncConnectAccountStatus = jest.fn<Promise<number>, unknown[]>(async () => 1)
const recordConnectPayoutFailure = jest.fn<Promise<number>, unknown[]>(async () => 1)
const clearConnectPayoutFailure = jest.fn<Promise<number>, unknown[]>(async () => 1)

// The two modules an account event writes through. Their own specs hold what
// they write; this one holds which event reaches which, with which account.
jest.mock('./payment-provider-stripe-connect-status', () => ({
  syncConnectAccountStatus: (...args: unknown[]) =>
    syncConnectAccountStatus(...args),
}))
jest.mock('./payment-provider-stripe-connect-payouts', () => ({
  recordConnectPayoutFailure: (...args: unknown[]) =>
    recordConnectPayoutFailure(...args),
  clearConnectPayoutFailure: (...args: unknown[]) =>
    clearConnectPayoutFailure(...args),
}))

import {
  applyStripeConnectAccountEvent,
  platformStripeMode,
  resolvePlatformStripeMode,
  STRIPE_CONNECT_PAYMENT_PROVIDER,
} from './payment-provider-stripe-connect'

describe('platformStripeMode', () => {
  it('reads the mode a Stripe SECRET KEY does encode', () => {
    // The key is the one Stripe string that states its mode, and it states it
    // for restricted keys too.
    expect(platformStripeMode('sk_live_51abc')).toBe('live')
    expect(platformStripeMode('sk_test_51abc')).toBe('test')
    expect(platformStripeMode('rk_live_51abc')).toBe('live')
    expect(platformStripeMode('rk_test_51abc')).toBe('test')
  })

  it('answers undefined rather than guessing', () => {
    expect(platformStripeMode('')).toBeUndefined()
    expect(platformStripeMode(undefined)).toBeUndefined()
    // An ACCOUNT id is not a key and must never be read as one — this is the
    // string-sniff the bug invites, and the answer has to be "I don't know".
    expect(platformStripeMode('acct_1TulDeRbL3B9Ioqz')).toBeUndefined()
  })
})

describe('resolvePlatformStripeMode', () => {
  it('prefers what Stripe SAYS over what the key looks like', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ livemode: false }),
    })) as unknown as typeof fetch
    // A key whose prefix reads live while the API reports test mode is a
    // contradiction, and the API is the authority.
    await expect(
      resolvePlatformStripeMode('sk_live_51abc', fetchImpl),
    ).resolves.toBe('test')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/balance',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('falls back to the key when Stripe cannot be asked', async () => {
    // A restricted key without balance access must not strand onboarding.
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'nope' } }),
    })) as unknown as typeof fetch
    await expect(
      resolvePlatformStripeMode('sk_live_51abc', fetchImpl),
    ).resolves.toBe('live')
  })

  it('stays undefined when neither source answers', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    await expect(resolvePlatformStripeMode('', fetchImpl)).resolves.toBeUndefined()
  })
})

describe('applyStripeConnectAccountEvent', () => {
  beforeEach(() => {
    syncConnectAccountStatus.mockClear()
    recordConnectPayoutFailure.mockClear()
    clearConnectPayoutFailure.mockClear()
  })

  it('mirrors account.updated with the EVENT’s livemode, never the object’s', async () => {
    const account = { id: 'acct_1', charges_enabled: true, livemode: false }
    await expect(
      applyStripeConnectAccountEvent('profiles', {
        type: 'account.updated',
        object: account,
        event: { livemode: true, data: { object: account } },
      }),
    ).resolves.toBe(true)
    expect(syncConnectAccountStatus).toHaveBeenCalledWith('profiles', account, true)
  })

  it('records a failed payout against event.account — the Payout’s destination is the BANK', async () => {
    const payout = { id: 'po_1', amount: 5000, destination: 'ba_bank' }
    await expect(
      applyStripeConnectAccountEvent('publisherProfiles', {
        type: 'payout.failed',
        object: payout,
        event: { account: 'acct_seller', livemode: true },
      }),
    ).resolves.toBe(true)
    expect(recordConnectPayoutFailure).toHaveBeenCalledWith('publisherProfiles', {
      kind: 'payout',
      object: payout,
      accountId: 'acct_seller',
      livemode: true,
    })
  })

  it('records a failed transfer against its destination, expanded or not', async () => {
    for (const destination of ['acct_dest', { id: 'acct_dest' }]) {
      recordConnectPayoutFailure.mockClear()
      const transfer = { id: 'tr_1', amount: 900, destination }
      await applyStripeConnectAccountEvent('profiles', {
        type: 'transfer.failed',
        object: transfer,
        event: { livemode: false },
      })
      expect(recordConnectPayoutFailure).toHaveBeenCalledWith('profiles', {
        kind: 'transfer',
        object: transfer,
        accountId: 'acct_dest',
        livemode: false,
      })
    }
  })

  it('clears the warning when a later payout lands', async () => {
    await expect(
      applyStripeConnectAccountEvent('profiles', {
        type: 'payout.paid',
        object: { id: 'po_2' },
        event: { account: 'acct_1' },
      }),
    ).resolves.toBe(true)
    expect(clearConnectPayoutFailure).toHaveBeenCalledWith('profiles', 'acct_1')
  })

  it('answers false for every other event and writes nothing', async () => {
    for (const type of [
      'checkout.session.completed',
      'charge.dispute.created',
      'account.application.deauthorized',
      'payout.created',
      '',
    ]) {
      await expect(
        applyStripeConnectAccountEvent('profiles', { type, object: {}, event: {} }),
      ).resolves.toBe(false)
    }
    expect(syncConnectAccountStatus).not.toHaveBeenCalled()
    expect(recordConnectPayoutFailure).not.toHaveBeenCalled()
    expect(clearConnectPayoutFailure).not.toHaveBeenCalled()
  })

  it('lets a failed write reach the webhook, which is what earns the redelivery', async () => {
    syncConnectAccountStatus.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
    await expect(
      applyStripeConnectAccountEvent('profiles', {
        type: 'account.updated',
        object: { id: 'acct_1', charges_enabled: false },
        event: { livemode: true },
      }),
    ).rejects.toThrow('PERMISSION_DENIED')
  })

  it('is the adapter’s applyAccountEvent', () => {
    expect(STRIPE_CONNECT_PAYMENT_PROVIDER.applyAccountEvent).toBe(
      applyStripeConnectAccountEvent,
    )
  })
})
