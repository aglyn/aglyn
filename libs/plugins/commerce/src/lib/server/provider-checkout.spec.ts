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
  registerPluginPaymentProvider,
  type PluginPaymentProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  checkoutMetadataOf,
  isProviderCheckoutId,
  providerCartCheckoutRequest,
  providerCheckoutId,
  providerLinesOf,
  providerTaxCents,
  readProviderChoice,
  storefrontPaymentOptions,
} from './provider-checkout'

/**
 * The pure half of a cart paid through another plugin's provider
 * (AGL-3630): which provider was asked for, the id the attempt is known by,
 * the session metadata carried across, tax computed as the card processor
 * computes the store's own rate, and which stores may offer a provider.
 */

const wallet: PluginPaymentProvider = {
  available: async () => ({ providerId: 'wallet', label: 'Wallet', methods: [{ id: 'wallet', label: 'Wallet' }], livemode: false }),
  createCheckout: async () => {
    throw new Error('unused')
  },
  refund: async () => ({ ok: true, refundId: 'r', status: 'completed' }),
}

beforeEach(() => resetPluginServicesForTests())

describe('the provider a buyer asked for', () => {
  it('is null for a card checkout and a clean id otherwise', () => {
    expect(readProviderChoice({})).toBeNull()
    expect(readProviderChoice({ paymentProvider: '' })).toBeNull()
    expect(readProviderChoice({ paymentProvider: 'PayPal' })).toEqual({ providerId: 'paypal' })
    // Something that is not an id names no provider, and is then refused as one.
    expect(readProviderChoice({ paymentProvider: '../x' })).toEqual({ providerId: '' })
  })
})

describe('the attempt’s id', () => {
  it('is the same for a retry of one attempt and new for another', () => {
    const one = providerCheckoutId('pay-later', 'digest-1')
    expect(one).toBe(providerCheckoutId('pay-later', 'digest-1'))
    expect(one).not.toBe(providerCheckoutId('pay-later', 'digest-2'))
    expect(one).toMatch(/^pay_paylater_[0-9a-f]{32}$/)
    expect(isProviderCheckoutId(one)).toBe(true)
    expect(isProviderCheckoutId('cs_live_abc')).toBe(false)
    expect(isProviderCheckoutId(providerCheckoutId('wallet', null))).toBe(true)
  })
})

describe('what is carried across', () => {
  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '2',
    'line_items[0][price_data][unit_amount]': '4000',
    'line_items[0][price_data][product_data][name]': 'Walnut desk (Large)',
    'line_items[1][quantity]': '1',
    'line_items[1][price_data][unit_amount]': '198',
    'line_items[1][price_data][product_data][name]': 'Package protection',
    'metadata[type]': 'commerce-cart',
    'metadata[hostId]': 'host-1',
    'metadata[stockHoldKey]': 'hold-1',
    'payment_intent_data[application_fee_amount]': '400',
  })

  it('reads the session’s metadata keys and nothing else', () => {
    expect(checkoutMetadataOf(params)).toEqual({ type: 'commerce-cart', hostId: 'host-1', stockHoldKey: 'hold-1' })
  })

  it('reads the priced lines back, so both paths name the same goods', () => {
    expect(providerLinesOf(params, (index) => index === 0)).toEqual([
      { name: 'Walnut desk (Large)', quantity: 2, unitCents: 4_000, ships: true },
      { name: 'Package protection', quantity: 1, unitCents: 198, ships: false },
    ])
  })

  it('builds the request, with a free delivery option where the store priced none', () => {
    const request = providerCartCheckoutRequest({
      providerId: 'wallet',
      checkoutId: 'pay_wallet_0123456789abcdef0123456789abcdef',
      orgId: 'org-1',
      hostId: 'host-1',
      params,
      physical: (index) => index === 0,
      discountCents: 800,
      taxCents: 594,
      shipping: { options: [], countries: ['US'] },
      platformFeeCents: 200,
      merchantName: 'Acme',
      buyerEmail: '',
      returnUrl: 'https://acme.example/?order=success&session_id=pay_wallet_0123456789abcdef0123456789abcdef',
      cancelUrl: 'https://acme.example/?order=canceled',
      expiresAtMs: 1,
    })
    expect(request).toMatchObject({
      ownerKind: 'commerce-cart',
      currency: 'usd',
      channel: 'online',
      shipping: { options: [{ id: 'standard', label: 'Shipping', amountCents: 0 }], countries: ['US'] },
      metadata: { type: 'commerce-cart', paymentProvider: 'wallet' },
      merchantName: 'Acme',
    })
    expect(request).not.toHaveProperty('buyerEmail')
  })
})

describe('tax handed to a provider', () => {
  it('is a tax service’s quote as quoted', () => {
    expect(providerTaxCents({ engineTaxCents: 613, manualRatePct: 8.25, lines: [] })).toBe(613)
  })

  it('is the store’s rate per taxable line, rounded per line', () => {
    expect(
      providerTaxCents({
        engineTaxCents: null,
        manualRatePct: 8.25,
        lines: [
          { netCents: 3_333, taxable: true },
          { netCents: 3_333, taxable: true },
          { netCents: 9_999, taxable: false },
        ],
      }),
    ).toBe(550)
    expect(providerTaxCents({ engineTaxCents: null, manualRatePct: 0, lines: [{ netCents: 100, taxable: true }] })).toBe(0)
  })
})

describe('which stores may offer a provider', () => {
  it('asks nothing — not even the tax settings — when no provider is registered', async () => {
    const taxSettings = jest.fn()
    expect(await storefrontPaymentOptions({ orgId: '', hostId: 'host-1', taxSettings })).toEqual([])
    expect(taxSettings).not.toHaveBeenCalled()
  })

  it('offers a provider where the store sets its own tax, or none', async () => {
    registerPluginPaymentProvider('wallet', wallet, { pluginId: 'wallet-plugin' })
    for (const mode of ['manual', 'none'] as const) {
      expect((await storefrontPaymentOptions({ orgId: '', hostId: 'host-1', taxSettings: { mode } })).map((one) => one.providerId)).toEqual(['wallet'])
    }
  })

  it('offers none where the card processor calculates tax, or nobody has decided', async () => {
    registerPluginPaymentProvider('wallet', wallet, { pluginId: 'wallet-plugin' })
    expect(await storefrontPaymentOptions({ orgId: '', hostId: 'host-1', taxSettings: { mode: 'stripe' } })).toEqual([])
    expect(await storefrontPaymentOptions({ orgId: '', hostId: 'host-1', taxSettings: async () => undefined })).toEqual([])
  })
})
