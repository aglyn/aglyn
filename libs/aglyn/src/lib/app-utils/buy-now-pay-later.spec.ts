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

import { BUY_NOW_PAY_LATER_PAYMENT_METHOD_TYPES, excludeBuyNowPayLater } from './buy-now-pay-later'
import { BNPL_PROCESSING_PERCENT, SALE_PROCESSING_PERCENT } from './plan-entitlements'

/** No checkout on a site offers buy-now-pay-later (AGL-4198). */

const excludedOf = (params: URLSearchParams) =>
  [...params.keys()]
    .filter((key) => key.startsWith('excluded_payment_method_types['))
    .map((key) => [key, params.get(key)])

describe('excludeBuyNowPayLater', () => {
  it('names Klarna, Afterpay and Affirm on a session that excludes nothing yet', () => {
    const params = excludeBuyNowPayLater(new URLSearchParams({ mode: 'payment' }))
    expect(excludedOf(params)).toEqual([
      ['excluded_payment_method_types[0]', 'klarna'],
      ['excluded_payment_method_types[1]', 'afterpay_clearpay'],
      ['excluded_payment_method_types[2]', 'affirm'],
    ])
  })

  it('appends after what the session already excludes, never naming one twice', () => {
    const params = new URLSearchParams({
      'excluded_payment_method_types[0]': 'cashapp',
      'excluded_payment_method_types[1]': 'klarna',
    })
    excludeBuyNowPayLater(params)
    expect(excludedOf(params)).toEqual([
      ['excluded_payment_method_types[0]', 'cashapp'],
      ['excluded_payment_method_types[1]', 'klarna'],
      ['excluded_payment_method_types[2]', 'afterpay_clearpay'],
      ['excluded_payment_method_types[3]', 'affirm'],
    ])
  })

  it('works on a plain params object too', () => {
    const params: Record<string, unknown> = { mode: 'payment' }
    excludeBuyNowPayLater(params)
    expect(params['excluded_payment_method_types[2]']).toBe('affirm')
  })

  it('leaves a session that pins its payment method types alone', () => {
    const params = new URLSearchParams({ 'payment_method_types[0]': 'card' })
    excludeBuyNowPayLater(params)
    expect(excludedOf(params)).toEqual([])
  })

  it('is why the processing pass-through is priced off the card rate, not 6%', () => {
    expect(BUY_NOW_PAY_LATER_PAYMENT_METHOD_TYPES).toEqual(['klarna', 'afterpay_clearpay', 'affirm'])
    expect(SALE_PROCESSING_PERCENT).toBeLessThan(BNPL_PROCESSING_PERCENT)
  })
})
