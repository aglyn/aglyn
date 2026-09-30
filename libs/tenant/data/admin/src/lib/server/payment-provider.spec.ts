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
 * THE MERCHANT ACCOUNT, ASKED THROUGH ITS CONTRACT.
 *
 * Every plugin that takes money asks `merchantAccountIsReady` before it
 * charges, and the answer has to refuse in every case the provider has not
 * vouched for. The truth table below is the AGL-2471 one: production held
 * three connected accounts, all in TEST mode, one carrying
 * `stripeChargesEnabled: true`, and every door read it as ready.
 *
 * The contract resolves its provider with no registry, so there is no
 * "nobody registered" case to refuse: the cases that matter are the ones
 * where the door passes no platform mode and the provider's must be used.
 */

import { STRIPE_CONNECT_PAYMENT_PROVIDER } from './payment-provider-stripe-connect'
import {
  merchantAccountIsReady,
  merchantAccountReadiness,
  paymentProvider,
} from './payment-provider'

describe('paymentProvider', () => {
  it('is the Stripe Connect adapter, compiled in — never empty', () => {
    // A registry a plugin filled could be absent in a route bundle, and an
    // absent provider at a money door either refuses every sale or lets one
    // through unchecked. This one cannot be absent.
    expect(paymentProvider()).toBe(STRIPE_CONNECT_PAYMENT_PROVIDER)
    expect(paymentProvider().id).toBe('stripe-connect')
  })
})

describe('merchantAccountReadiness', () => {
  const live = { platformMode: 'live' as const }

  it('is ready only when the recorded mode matches the platform', () => {
    expect(
      merchantAccountReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: true,
        ...live,
      }),
    ).toBe('ready')
    expect(
      merchantAccountReadiness({
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
      merchantAccountReadiness({
        accountId: 'acct_1TulDeRbL3B9Ioqz',
        chargesEnabled: true,
        accountLivemode: undefined,
        ...live,
      }),
    ).toBe('mode-unverified')
  })

  it('refuses a test-mode account under a live key', () => {
    expect(
      merchantAccountReadiness({
        accountId: 'acct_1TulDeRbL3B9Ioqz',
        chargesEnabled: true,
        accountLivemode: false,
        ...live,
      }),
    ).toBe('mode-mismatch')
    // …and the mirror image, which is how a live account leaks into a test
    // deployment sharing the database.
    expect(
      merchantAccountReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: true,
        platformMode: 'test',
      }),
    ).toBe('mode-mismatch')
  })

  it('keeps the two refusals it already made, ahead of the mode question', () => {
    expect(
      merchantAccountReadiness({ accountId: '', chargesEnabled: true, ...live }),
    ).toBe('not-connected')
    expect(
      merchantAccountReadiness({
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
        merchantAccountReadiness({
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
      merchantAccountReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: undefined,
        platformMode: 'test',
      }),
    ).toBe('ready')
    expect(
      merchantAccountReadiness({
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
      merchantAccountReadiness({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: false,
        platformMode: undefined,
      }),
    ).toBe('ready')
  })
})

describe('the platform mode a door does not pass', () => {
  const original = process.env.STRIPE_SECRET_KEY
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = original
  })

  // Every money door calls without `platformMode`, so this is the path that
  // actually runs in production: the provider's own reading of the key.
  const unrecorded = {
    accountId: 'acct_1TulDeRbL3B9Ioqz',
    chargesEnabled: true,
    accountLivemode: undefined,
  }

  it('is the provider’s, read when asked: a live key refuses an unrecorded mode', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_51abc'
    expect(merchantAccountReadiness(unrecorded)).toBe('mode-unverified')
    expect(merchantAccountReadiness({ ...unrecorded, accountLivemode: false })).toBe(
      'mode-mismatch',
    )
  })

  it('THE CONTROL: a test key lets the same account through', () => {
    // Otherwise the case above passes on a function that refuses everything.
    process.env.STRIPE_SECRET_KEY = 'sk_test_51abc'
    expect(merchantAccountReadiness(unrecorded)).toBe('ready')
  })
})

describe('merchantAccountIsReady', () => {
  let error: jest.SpyInstance
  beforeEach(() => {
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => error.mockRestore())

  it('refuses a mode it cannot vouch for, and says why in the server log', () => {
    expect(
      merchantAccountIsReady(
        {
          accountId: 'acct_1TulDeRbL3B9Ioqz',
          chargesEnabled: true,
          accountLivemode: false,
          platformMode: 'live',
        },
        { subject: 'checkout host h1' },
      ),
    ).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toMatch(
      /acct_1TulDeRbL3B9Ioqz \(checkout host h1\): mode-mismatch/,
    )
  })

  it('refuses an unconnected or restricted account quietly — those are ordinary', () => {
    expect(merchantAccountIsReady({ accountId: '', platformMode: 'live' })).toBe(false)
    expect(
      merchantAccountIsReady({
        accountId: 'acct_1',
        chargesEnabled: 'true',
        accountLivemode: true,
        platformMode: 'live',
      }),
    ).toBe(false)
    expect(error).not.toHaveBeenCalled()
  })

  it('lets a verified account through', () => {
    expect(
      merchantAccountIsReady({
        accountId: 'acct_1',
        chargesEnabled: true,
        accountLivemode: true,
        platformMode: 'live',
      }),
    ).toBe(true)
    expect(error).not.toHaveBeenCalled()
  })
})
