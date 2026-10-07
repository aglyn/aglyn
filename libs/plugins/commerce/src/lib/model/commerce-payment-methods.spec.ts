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
  appendStorefrontPaymentMethodParams,
  isStorefrontPaymentMethodOn,
  normalizeStorefrontPaymentMethodSettings,
  readStorefrontCheckoutWallets,
  resolveStorefrontPaymentMethodControls,
  STOREFRONT_PAYMENT_METHODS,
} from './commerce-payment-methods'

/**
 * The storefront payment method catalog and what a merchant's choices send
 * Stripe (AGL-3629).
 */

describe('the catalog', () => {
  it('lists each method once, every non-wallet with the capability Stripe asks platforms to request', () => {
    const ids = STOREFRONT_PAYMENT_METHODS.map((method) => method.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const method of STOREFRONT_PAYMENT_METHODS) {
      if (method.control === 'exclude') expect(method.capability).toMatch(/_payments$/)
      if (method.minCents !== undefined && method.maxCents !== undefined) {
        expect(method.minCents).toBeLessThan(method.maxCents)
      }
    }
  })

  it('defaults every method on except crypto, which is opt-in', () => {
    const defaults = STOREFRONT_PAYMENT_METHODS.filter((method) => !method.defaultOn)
    expect(defaults.map((method) => method.id)).toEqual(['crypto'])
  })
})

describe('settings', () => {
  it('keeps only booleans under known ids', () => {
    expect(
      normalizeStorefrontPaymentMethodSettings({ klarna: false, affirm: 'no', paypal: true }),
    ).toEqual({ klarna: false })
    expect(normalizeStorefrontPaymentMethodSettings(null)).toEqual({})
    expect(normalizeStorefrontPaymentMethodSettings('klarna')).toEqual({})
  })

  it('reads a choice, else the default', () => {
    expect(isStorefrontPaymentMethodOn({}, 'klarna')).toBe(true)
    expect(isStorefrontPaymentMethodOn({ klarna: false }, 'klarna')).toBe(false)
    expect(isStorefrontPaymentMethodOn(undefined, 'crypto')).toBe(false)
    expect(isStorefrontPaymentMethodOn({ crypto: true }, 'crypto')).toBe(true)
  })
})

describe('what a session sends', () => {
  it('on the defaults: excludes crypto alone and hides no wallet', () => {
    const controls = resolveStorefrontPaymentMethodControls({})
    expect(controls.excluded).toEqual(['crypto'])
    const params = new URLSearchParams()
    appendStorefrontPaymentMethodParams(params, controls)
    expect([...params.entries()]).toEqual([['excluded_payment_method_types[0]', 'crypto']])
  })

  it('excludes each method turned off, and never a wallet Stripe will not exclude', () => {
    const controls = resolveStorefrontPaymentMethodControls({
      klarna: false,
      affirm: false,
      apple_pay: false,
      crypto: true,
    })
    expect(controls.excluded).toEqual(['klarna', 'affirm'])
    expect(controls.wallets).toEqual({ applePay: 'never', googlePay: 'auto', link: 'auto' })
  })

  it('hides Link on the session too, which reaches the hosted page', () => {
    const params = new URLSearchParams()
    appendStorefrontPaymentMethodParams(params, resolveStorefrontPaymentMethodControls({ link: false }))
    expect(params.get('wallet_options[link][display]')).toBe('never')
  })
})

describe('the wallets a browser reads', () => {
  it('is undefined when nothing is hidden, so the Payment Element gets no option', () => {
    expect(readStorefrontCheckoutWallets({ applePay: 'auto', googlePay: 'auto', link: 'auto' })).toBeUndefined()
    expect(readStorefrontCheckoutWallets(undefined)).toBeUndefined()
  })

  it('reads anything but an exact never as auto', () => {
    expect(readStorefrontCheckoutWallets({ applePay: 'never', googlePay: 'NEVER', link: 1 })).toEqual({
      applePay: 'never',
      googlePay: 'auto',
      link: 'auto',
    })
  })
})
