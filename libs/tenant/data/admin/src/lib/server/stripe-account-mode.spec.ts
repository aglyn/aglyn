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

import {
  connectReadiness,
  platformStripeMode,
  resolvePlatformStripeMode,
} from './stripe-account-mode'

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

describe('connectReadiness', () => {
  const live = { platformMode: 'live' as const }

  it('is ready only when the recorded mode matches the platform', () => {
    expect(
      connectReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: true,
        ...live,
      }),
    ).toBe('ready')
    expect(
      connectReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: false,
        platformMode: 'test',
      }),
    ).toBe('ready')
  })

  it('refuses the exact production shape: charges on, mode never recorded', () => {
    // profiles/7AVEMtDa6OR1EuEspeLTx2xj7gg1, verbatim. This is the record
    // that passed every gate.
    expect(
      connectReadiness({
        accountId: 'acct_1TulDeRbL3B9Ioqz',
        chargesEnabled: true,
        accountLivemode: undefined,
        ...live,
      }),
    ).toBe('mode-unverified')
  })

  it('refuses a test-mode account under a live key', () => {
    expect(
      connectReadiness({
        accountId: 'acct_1TulDeRbL3B9Ioqz',
        chargesEnabled: true,
        accountLivemode: false,
        ...live,
      }),
    ).toBe('mode-mismatch')
    // …and the mirror image, which is how a live account leaks into a test
    // deployment sharing the database.
    expect(
      connectReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: true,
        platformMode: 'test',
      }),
    ).toBe('mode-mismatch')
  })

  it('keeps the two refusals it already made, ahead of the mode question', () => {
    expect(
      connectReadiness({ accountId: '', chargesEnabled: true, ...live }),
    ).toBe('not-connected')
    expect(
      connectReadiness({
        accountId: 'acct_1',
        chargesEnabled: false,
        accountLivemode: true,
        ...live,
      }),
    ).toBe('charges-disabled')
  })

  it('treats a non-boolean recorded mode as unverified ON LIVE, never as a value', () => {
    for (const value of ['true', 1, null, {}]) {
      expect(
        connectReadiness({
          accountId: 'acct_1',
          chargesEnabled: true,
          accountLivemode: value,
          ...live,
        }),
      ).toBe('mode-unverified')
    }
  })

  it('leaves a non-live deployment exactly as it was', () => {
    // The asymmetry, asserted. A test-key deployment cannot move real money
    // and Stripe polices the mode boundary itself, so an unrecorded mode is
    // not a reason to break every developer machine and staging install.
    expect(
      connectReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: undefined,
        platformMode: 'test',
      }),
    ).toBe('ready')
    expect(
      connectReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: undefined,
        platformMode: undefined,
      }),
    ).toBe('ready')
  })

  it('cannot judge a recorded mode with no platform key to compare against', () => {
    // Honest about the limit. With no platform mode there is nothing to
    // compare against, so the answer falls back to what it was before
    // AGL-2471 rather than inventing a verdict.
    expect(
      connectReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: false,
        platformMode: undefined,
      }),
    ).toBe('ready')
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
