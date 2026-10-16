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
import {
  merchantPaymentsBlockedReason,
  merchantPaymentsPlatformMode,
  merchantPaymentsStateFromProfile,
} from './use-merchant-payments'

const connected = { stripeAccountId: 'acct_1', stripeChargesEnabled: true }

describe('merchantPaymentsStateFromProfile', () => {
  it('reads no profile, or no account on it, as not connected', () => {
    expect(merchantPaymentsStateFromProfile(undefined, 'live')).toBe('not-connected')
    expect(merchantPaymentsStateFromProfile({ stripeAccountId: '  ' }, 'live')).toBe('not-connected')
  })

  it('needs a literal true for charges', () => {
    expect(merchantPaymentsStateFromProfile({ stripeAccountId: 'acct_1' }, 'live')).toBe('charges-disabled')
    expect(
      merchantPaymentsStateFromProfile({ stripeAccountId: 'acct_1', stripeChargesEnabled: 'true' }, 'live'),
    ).toBe('charges-disabled')
  })

  it('answers the mode exactly as the server does', () => {
    expect(merchantPaymentsStateFromProfile({ ...connected, stripeAccountLivemode: true }, 'live')).toBe('ready')
    expect(merchantPaymentsStateFromProfile({ ...connected, stripeAccountLivemode: false }, 'live')).toBe(
      'mode-mismatch',
    )
    expect(merchantPaymentsStateFromProfile({ ...connected, stripeAccountLivemode: true }, 'test')).toBe(
      'mode-mismatch',
    )
    expect(merchantPaymentsStateFromProfile({ ...connected, stripeAccountLivemode: true }, undefined)).toBe('ready')
    // An unrecorded mode is refused only where real money moves.
    expect(merchantPaymentsStateFromProfile(connected, 'live')).toBe('mode-unverified')
    expect(merchantPaymentsStateFromProfile(connected, 'test')).toBe('ready')
    expect(merchantPaymentsStateFromProfile({ ...connected, stripeAccountLivemode: 'true' }, 'live')).toBe(
      'mode-unverified',
    )
  })
})

describe('merchantPaymentsPlatformMode', () => {
  it('reads the mode off the publishable key prefix', () => {
    expect(merchantPaymentsPlatformMode('pk_live_abc')).toBe('live')
    expect(merchantPaymentsPlatformMode('pk_test_abc')).toBe('test')
    expect(merchantPaymentsPlatformMode('')).toBeUndefined()
  })
})

describe('merchantPaymentsBlockedReason', () => {
  it('names a step for every state that blocks, and nothing otherwise', () => {
    for (const state of ['not-connected', 'charges-disabled', 'mode-mismatch', 'mode-unverified'] as const) {
      expect(merchantPaymentsBlockedReason(state)).toMatch(/Stripe/)
    }
    for (const state of ['ready', 'pending', 'error'] as const) {
      expect(merchantPaymentsBlockedReason(state)).toBeNull()
    }
  })
})
