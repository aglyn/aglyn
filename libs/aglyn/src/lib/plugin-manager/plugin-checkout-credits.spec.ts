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
  boundedCreditCents,
  checkoutCreditProvider,
  checkoutCreditProviderForCode,
  checkoutCreditSold,
  decodeCheckoutCreditMetadata,
  encodeCheckoutCreditMetadata,
  hasPluginCheckoutCredits,
  normalizeCheckoutCreditAccount,
  normalizeCheckoutCreditCode,
  offeredCheckoutCredits,
  registerPluginCheckoutCredit,
  type PluginCheckoutCreditProvider,
} from './plugin-checkout-credits'
import { resetPluginServicesForTests } from './plugin-services'

function provider(overrides: Partial<PluginCheckoutCreditProvider> = {}): PluginCheckoutCreditProvider {
  return {
    key: 'rewards',
    label: 'Rewards',
    recognizes: (code) => code.startsWith('RW-'),
    offered: async () => true,
    resolve: async () => ({ ok: true, reference: 'm:abc', label: 'Rewards', last4: 'WXYZ', availableCents: 500 }),
    hold: async ({ maxCents }) => ({ ok: true, cents: Math.min(500, maxCents) }),
    release: async () => undefined,
    stage: async () => null,
    restore: async () => 0,
    ...overrides,
  }
}

afterEach(() => {
  resetPluginServicesForTests()
})

describe('checkout credit providers (AGL-3640)', () => {
  it('answers nothing, and offers nothing, when no plugin registered one', async () => {
    expect(hasPluginCheckoutCredits()).toBe(false)
    expect(checkoutCreditProviderForCode('RW-1234')).toBeNull()
    await expect(offeredCheckoutCredits({ hostId: 'h', channel: 'online' })).resolves.toEqual([])
  })

  it('names a provider by plugin and key, and finds it by the codes it recognizes', () => {
    registerPluginCheckoutCredit(provider(), { pluginId: 'loyalty' })
    expect(hasPluginCheckoutCredits()).toBe(true)
    expect(checkoutCreditProviderForCode(' rw-abcd ')?.providerId).toBe('loyalty.rewards')
    expect(checkoutCreditProviderForCode('GC-ABCD')).toBeNull()
    expect(checkoutCreditProvider('loyalty.rewards')?.pluginId).toBe('loyalty')
    expect(checkoutCreditProvider('loyalty.other')).toBeNull()
  })

  it('refuses a key that is not lower-case words', () => {
    expect(() => registerPluginCheckoutCredit(provider({ key: 'Rewards' }), { pluginId: 'loyalty' })).toThrow(
      /lower-case/,
    )
  })

  it('re-registering the same key replaces it rather than adding a second', () => {
    registerPluginCheckoutCredit(provider({ label: 'Old' }), { pluginId: 'loyalty' })
    registerPluginCheckoutCredit(provider({ label: 'New' }), { pluginId: 'loyalty' })
    expect(checkoutCreditProvider('loyalty.rewards')?.provider.label).toBe('New')
  })

  it('a provider whose recognizer throws is skipped, not fatal', () => {
    registerPluginCheckoutCredit(
      provider({
        key: 'broken',
        recognizes: () => {
          throw new Error('boom')
        },
      }),
      { pluginId: 'a' },
    )
    registerPluginCheckoutCredit(provider(), { pluginId: 'loyalty' })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(checkoutCreditProviderForCode('RW-1')?.providerId).toBe('loyalty.rewards')
    spy.mockRestore()
  })

  it('offers only what a site offers, and drops a provider that fails to say', async () => {
    registerPluginCheckoutCredit(provider(), { pluginId: 'loyalty' })
    registerPluginCheckoutCredit(provider({ key: 'off', offered: async () => false }), { pluginId: 'loyalty' })
    registerPluginCheckoutCredit(
      provider({
        key: 'failing',
        offered: async () => {
          throw new Error('down')
        },
      }),
      { pluginId: 'loyalty' },
    )
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(offeredCheckoutCredits({ hostId: 'h', channel: 'pos' })).resolves.toEqual([
      { providerId: 'loyalty.rewards', label: 'Rewards', lookup: false },
    ])
    spy.mockRestore()
  })
})

describe('codes and accounts are held to the contract', () => {
  it('normalizes a typed code to upper-case letters, digits and single dashes', () => {
    expect(normalizeCheckoutCreditCode(' rw- 7k3p--q9xz ')).toBe('RW-7K3P-Q9XZ')
    expect(normalizeCheckoutCreditCode('---')).toBe('')
    expect(normalizeCheckoutCreditCode(null)).toBe('')
    expect(normalizeCheckoutCreditCode('a'.repeat(80))).toHaveLength(40)
  })

  it('keeps a well-formed account and drops what a page should not draw', () => {
    expect(
      normalizeCheckoutCreditAccount({
        ok: true,
        reference: 'm:abc',
        label: 'Rewards\u0000',
        last4: 'wxyz9',
        availableCents: 1.5 as number,
      }),
    ).toEqual({ ok: true, reference: 'm:abc', label: 'Rewards', last4: 'WXYZ', availableCents: 0 })
  })

  it('turns a reference unsafe in a document path into a refusal', () => {
    expect(
      normalizeCheckoutCreditAccount({ ok: true, reference: 'a/b', label: 'x', last4: '1', availableCents: 1 }),
    ).toEqual({ ok: false, status: 404, error: 'That code is not valid.' })
    expect(normalizeCheckoutCreditAccount(null)).toMatchObject({ ok: false, status: 404 })
  })

  it('passes a provider refusal through, with a client status', () => {
    expect(normalizeCheckoutCreditAccount({ ok: false, status: 409, error: 'Empty.' })).toEqual({
      ok: false,
      status: 409,
      error: 'Empty.',
    })
    expect(normalizeCheckoutCreditAccount({ ok: false, status: 500, error: '' })).toEqual({
      ok: false,
      status: 409,
      error: 'That code cannot be used.',
    })
  })

  it('bounds what a provider says it took to whole cents under the ceiling', () => {
    expect(boundedCreditCents(700, 500)).toBe(500)
    expect(boundedCreditCents(12.5, 500)).toBe(0)
    expect(boundedCreditCents(-3, 500)).toBe(0)
    expect(boundedCreditCents(300, 0)).toBe(0)
  })
})

describe('the hold rides the payment processor’s metadata without the code', () => {
  const HELD = {
    providerId: 'loyalty.rewards',
    reference: 'm:abc',
    holdKey: 'attempt-1',
    amountCents: 450,
    label: 'Rewards',
    last4: 'WXYZ',
  }

  it('round-trips', () => {
    const packed = encodeCheckoutCreditMetadata(HELD)
    expect(Object.keys(packed)).toEqual(['credit0'])
    expect(packed['credit0'].length).toBeLessThan(500)
    expect(packed['credit0']).not.toContain('RW-')
    expect(decodeCheckoutCreditMetadata(packed)).toEqual(HELD)
  })

  it('reads nothing it cannot trust', () => {
    expect(decodeCheckoutCreditMetadata(undefined)).toBeNull()
    expect(decodeCheckoutCreditMetadata({ credit0: 'not json' })).toBeNull()
    expect(decodeCheckoutCreditMetadata({ credit0: JSON.stringify(['bad id', 'm:a', 'k', 1, 'x', '']) })).toBeNull()
    expect(decodeCheckoutCreditMetadata({ credit0: JSON.stringify(['a.b', 'm/a', 'k', 1, 'x', '']) })).toBeNull()
    expect(decodeCheckoutCreditMetadata({ credit0: JSON.stringify(['a.bc', 'm:a', 'k', 0, 'x', '']) })).toBeNull()
    expect(decodeCheckoutCreditMetadata({ credit0: JSON.stringify(['a.bc', 'm:a', '', 5, 'x', '']) })).toBeNull()
  })

  it('records a sale’s redemption with its owner split out', () => {
    expect(
      checkoutCreditSold({
        providerId: 'loyalty.rewards',
        reference: 'm:abc',
        label: 'Rewards',
        last4: 'WXYZ',
        amountCents: 450,
        appliedAs: 'tender',
      }),
    ).toEqual({
      providerId: 'loyalty.rewards',
      pluginId: 'loyalty',
      key: 'rewards',
      reference: 'm:abc',
      label: 'Rewards',
      last4: 'WXYZ',
      amountCents: 450,
      appliedAs: 'tender',
    })
    expect(
      checkoutCreditSold({
        providerId: 'loyalty.rewards',
        reference: 'm:abc',
        label: 'x',
        last4: '',
        amountCents: 0,
        appliedAs: 'discount',
      }),
    ).toBeNull()
  })
})
