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

import { resetPluginServicesForTests } from './plugin-services'
import {
  hasPluginPaymentProviders,
  listPluginPaymentOptions,
  normalizePluginPaymentOption,
  pluginPaymentCheckoutOwner,
  pluginPaymentCheckoutProblem,
  pluginPaymentCheckoutTotals,
  pluginPaymentProvider,
  registerPluginPaymentCheckoutOwner,
  registerPluginPaymentProvider,
  type PluginPaymentCheckoutOwner,
  type PluginPaymentCheckoutRequest,
  type PluginPaymentProvider,
} from './plugin-payment-providers'

/** A wallet plugin and a rentals plugin: nothing in the seam names a store. */
function wallet(overrides: Partial<PluginPaymentProvider> = {}): PluginPaymentProvider {
  return {
    available: async () => ({
      providerId: 'wallet',
      label: 'Wallet',
      methods: [{ id: 'wallet', label: 'Wallet' }],
      livemode: false,
    }),
    createCheckout: async () => ({
      providerId: 'wallet',
      providerCheckoutId: 'W-1',
      redirectUrl: 'https://wallet.example/approve/W-1',
      livemode: false,
    }),
    refund: async () => ({ ok: true, refundId: 'R-1', status: 'completed' }),
    ...overrides,
  }
}

function owner(): PluginPaymentCheckoutOwner {
  return {
    approve: async () => ({ ok: true }),
    settle: async () => undefined,
    expire: async () => undefined,
  }
}

const REQUEST: PluginPaymentCheckoutRequest = {
  ownerKind: 'rentals-booking',
  checkoutId: 'pay_wallet_0123456789',
  orgId: 'org-1',
  hostId: 'host-1',
  currency: 'usd',
  channel: 'online',
  lines: [
    { name: 'Kayak, one day', quantity: 2, unitCents: 4_500, ships: false },
    { name: 'Dry bag', quantity: 1, unitCents: 1_200, ships: true },
  ],
  discountCents: 1_000,
  taxCents: 735,
  shipping: {
    options: [
      { id: 'ground', label: 'Ground', amountCents: 800 },
      { id: 'air', label: 'Air', amountCents: 2_400 },
    ],
    countries: ['US', 'CA'],
  },
  platformFeeCents: 300,
  returnUrl: 'https://shop.example/?order=success',
  cancelUrl: 'https://shop.example/?order=canceled',
  metadata: { hostId: 'host-1' },
  expiresAtMs: 1_900_000_000_000,
}

beforeEach(() => resetPluginServicesForTests())

describe('payment providers (AGL-3630)', () => {
  it('answers no provider until a plugin registers one', async () => {
    expect(hasPluginPaymentProviders()).toBe(false)
    expect(pluginPaymentProvider('wallet')).toBeNull()
    await expect(
      listPluginPaymentOptions(
        { orgId: 'org-1', hostId: 'host-1', currency: 'usd', channel: 'online' },
        { timeoutMs: 50 },
      ),
    ).resolves.toEqual([])
  })

  it('lists a provider by the id it registered under', async () => {
    const impl = wallet()
    registerPluginPaymentProvider('wallet', impl, { pluginId: 'wallet-plugin' })
    expect(pluginPaymentProvider('wallet')).toBe(impl)
    await expect(
      listPluginPaymentOptions(
        { orgId: 'org-1', hostId: 'host-1', currency: 'usd', channel: 'online' },
        { timeoutMs: 50 },
      ),
    ).resolves.toEqual([
      { providerId: 'wallet', label: 'Wallet', methods: [{ id: 'wallet', label: 'Wallet' }], livemode: false },
    ])
  })

  it('refuses a second plugin claiming the same provider id, keeping the first', () => {
    const first = wallet()
    registerPluginPaymentProvider('wallet', first, { pluginId: 'wallet-plugin' })
    expect(() => registerPluginPaymentProvider('wallet', wallet(), { pluginId: 'impostor' })).toThrow(
      /already registered by "wallet-plugin"/,
    )
    expect(pluginPaymentProvider('wallet')).toBe(first)
  })

  it('drops a provider that failed, answered late or answered malformed', async () => {
    registerPluginPaymentProvider('broken', wallet({ available: async () => Promise.reject(new Error('down')) }), {
      pluginId: 'broken',
    })
    registerPluginPaymentProvider(
      'slow',
      wallet({ available: () => new Promise((resolve) => setTimeout(() => resolve(null), 500)) }),
      { pluginId: 'slow' },
    )
    registerPluginPaymentProvider(
      'liar',
      wallet({
        available: async () => ({ providerId: 'wallet', label: 'Wallet', methods: [{ id: 'w', label: 'W' }], livemode: true }),
      }),
      { pluginId: 'liar' },
    )
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      listPluginPaymentOptions(
        { orgId: 'org-1', hostId: 'host-1', currency: 'usd', channel: 'online' },
        { timeoutMs: 20 },
      ),
    ).resolves.toEqual([])
    error.mockRestore()
  })

  it('keeps a label printable and a method list short', () => {
    expect(
      normalizePluginPaymentOption('wallet', {
        providerId: 'wallet',
        label: '  Wal\u0007let  ',
        methods: [
          { id: 'wallet', label: 'Wallet' },
          { id: 'Bad Id', label: 'x' },
          { id: 'second', label: '' },
        ],
        livemode: 'yes' as never,
      }),
    ).toEqual({ providerId: 'wallet', label: 'Wal let', methods: [{ id: 'wallet', label: 'Wallet' }], livemode: false })
  })

  it('registers one owner per checkout kind', () => {
    const rentals = owner()
    registerPluginPaymentCheckoutOwner('rentals-booking', rentals, { pluginId: 'rentals' })
    expect(pluginPaymentCheckoutOwner('rentals-booking')).toBe(rentals)
    expect(pluginPaymentCheckoutOwner('unknown')).toBeNull()
    expect(() => registerPluginPaymentCheckoutOwner('rentals-booking', owner(), { pluginId: 'other' })).toThrow(
      /already registered by "rentals"/,
    )
  })
})

describe('checkout arithmetic (AGL-3630)', () => {
  it('adds the parts with the first delivery option until another is chosen', () => {
    expect(pluginPaymentCheckoutTotals(REQUEST)).toEqual({
      itemsCents: 10_200,
      discountCents: 1_000,
      taxCents: 735,
      shippingCents: 800,
      totalCents: 10_735,
    })
    expect(pluginPaymentCheckoutTotals(REQUEST, 'air').totalCents).toBe(12_335)
    expect(pluginPaymentCheckoutTotals(REQUEST, 'nope').shippingCents).toBe(800)
  })

  it('accepts a whole, consistent request', () => {
    expect(pluginPaymentCheckoutProblem(REQUEST)).toBeNull()
    expect(pluginPaymentCheckoutProblem({ ...REQUEST, shipping: undefined })).toBeNull()
  })

  it.each<[string, Partial<PluginPaymentCheckoutRequest>, RegExp]>([
    ['fractional cents', { taxCents: 1.5 }, /taxCents/],
    ['negative discount', { discountCents: -1 }, /discountCents/],
    ['a discount above the lines', { discountCents: 10_201 }, /more than the lines/],
    ['nothing to charge', { lines: [{ name: 'Free', quantity: 1, unitCents: 0, ships: false }], discountCents: 0, taxCents: 0, shipping: undefined, platformFeeCents: 0 }, /nothing to charge/],
    ['a fee above the charge', { platformFeeCents: 20_000 }, /platform fee/],
    ['an upper-case currency', { currency: 'USD' }, /currency/],
    ['no lines', { lines: [] }, /needs a line/],
    ['a zero quantity', { lines: [{ name: 'X', quantity: 0, unitCents: 100, ships: false }] }, /quantity/],
    ['a duplicated option id', { shipping: { options: [{ id: 'a', label: 'A', amountCents: 1 }, { id: 'a', label: 'B', amountCents: 2 }], countries: ['US'] } }, /own id/],
    ['no countries', { shipping: { options: [{ id: 'a', label: 'A', amountCents: 1 }], countries: [] } }, /countries/],
    ['a relative return', { returnUrl: '/thanks' }, /returnUrl/],
    ['a long metadata value', { metadata: { note: 'x'.repeat(501) } }, /metadata value/],
    ['a short checkout id', { checkoutId: 'abc' }, /checkoutId/],
  ])('refuses %s', (_label, patch, problem) => {
    expect(pluginPaymentCheckoutProblem({ ...REQUEST, ...patch })).toMatch(problem)
  })
})
