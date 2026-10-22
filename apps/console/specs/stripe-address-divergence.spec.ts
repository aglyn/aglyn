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

import { stripeAddressDivergence } from '../utils/stripe-address-divergence'

describe('stripeAddressDivergence', () => {
  it('is quiet after a successful push', () => {
    expect(stripeAddressDivergence({ pushed: true, pushOk: true })).toEqual({
      addressDivergedFromStripe: false,
      addressDivergedReason: null,
    })
  })

  it('flags a failed push — the save said success and the invoice did not change', () => {
    expect(stripeAddressDivergence({ pushed: true, pushOk: false })).toEqual({
      addressDivergedFromStripe: true,
      addressDivergedReason: 'sync-failed',
    })
  })

  it('flags a cleared address when Stripe still holds one', () => {
    expect(
      stripeAddressDivergence({ pushed: false, stripeHasAddress: true }),
    ).toEqual({
      addressDivergedFromStripe: true,
      addressDivergedReason: 'cleared-here',
    })
  })

  it('stays quiet when neither side has an address', () => {
    // The reason the Stripe customer is READ rather than assumed. Inferring
    // divergence from "we skipped the write" would warn every org that has
    // simply never filled the field in — and a warning that fires on a
    // perfectly consistent pair trains people to ignore the one that matters.
    expect(
      stripeAddressDivergence({ pushed: false, stripeHasAddress: false }),
    ).toEqual({
      addressDivergedFromStripe: false,
      addressDivergedReason: null,
    })
  })

  it('does not treat an unknown Stripe state as a divergence', () => {
    // `stripeHasAddress` is absent when the customer read itself failed.
    // Failing quiet is right: a warning nobody can act on, raised because we
    // could not reach Stripe, is noise on a page about something else.
    expect(stripeAddressDivergence({ pushed: false })).toEqual({
      addressDivergedFromStripe: false,
      addressDivergedReason: null,
    })
  })

  it('never reports a reason without the flag, or the reverse', () => {
    // The UI branches on the flag and then on the reason; a record with one
    // and not the other renders an empty warning or a silent divergence.
    const cases = [
      { pushed: true, pushOk: true },
      { pushed: true, pushOk: false },
      { pushed: false, stripeHasAddress: true },
      { pushed: false, stripeHasAddress: false },
      { pushed: false },
    ]
    for (const input of cases) {
      const result = stripeAddressDivergence(input)
      expect(result.addressDivergedFromStripe).toBe(
        result.addressDivergedReason !== null,
      )
    }
  })
})
