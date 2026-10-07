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
  pluginTaxProfile,
  pluginTaxEngine,
  pluginTaxProfileOwner,
  quotePluginTaxEngine,
  registerPluginTaxEngine,
  registerPluginTaxProfile,
  type PluginTaxEngine,
  type PluginTaxProfile,
} from './plugin-tax-profile'

/**
 * The seam with no storefront or calendar in it: a `ledger` plugin owns the
 * tax rule, and a `tickets` plugin prices a charge knowing only that some
 * plugin does.
 */
/** The rates the ledger keeps, by site and kind of charge. */
const LEDGER_RATES: Record<string, Record<string, unknown>> = {
  'host-1': { service: { pct: 8.5 } },
}

const LEDGER: PluginTaxProfile = {
  flatRate: async (hostId, charge) => LEDGER_RATES[hostId]?.[charge],
  flatTax: (rate, chargeCents, fallbackLabel) => {
    const pct = Number((rate as { pct?: unknown } | null)?.pct)
    if (!(pct > 0)) return { taxCents: 0, label: '', pct: 0 }
    return {
      taxCents: Math.round((chargeCents * pct) / 100),
      label: String((rate as { label?: unknown }).label ?? fallbackLabel),
      pct,
    }
  },
  taxModeOf: (_payment, manualTaxCents = 0) => (manualTaxCents > 0 ? 'manual' : 'none'),
}

beforeEach(() => {
  resetPluginServicesForTests()
})

describe('the tenant’s tax rule, asked of its owner', () => {
  it('prices a charge for a caller that knows only that an owner exists', () => {
    registerPluginTaxProfile(LEDGER, { pluginId: 'ledger' })
    expect(pluginTaxProfile().flatTax({ pct: 8.5 }, 10_000, 'Service tax')).toEqual({
      taxCents: 850,
      label: 'Service tax',
      pct: 8.5,
    })
    expect(pluginTaxProfile().taxModeOf({}, 850)).toBe('manual')
    expect(pluginTaxProfileOwner()).toBe('ledger')
  })

  it('answers the site’s rate for a kind of charge, read by the owner', async () => {
    registerPluginTaxProfile(LEDGER, { pluginId: 'ledger' })
    const profile = pluginTaxProfile()
    const rate = await profile.flatRate('host-1', 'service')
    expect(profile.flatTax(rate, 10_000, 'Service tax').taxCents).toBe(850)
    // A rate nobody set prices at zero rather than failing the charge.
    const unset = await profile.flatRate('host-2', 'service')
    expect(profile.flatTax(unset, 10_000, 'Service tax').taxCents).toBe(0)
  })

  it('REFUSES, rather than answering zero, when no plugin owns the rule', () => {
    // The one seam that must not say "nobody home" quietly: a caller that read
    // that as "no tax" would charge and record an untaxed total.
    expect(() => pluginTaxProfile()).toThrow(/refusing rather than charging it untaxed/)
    expect(pluginTaxProfileOwner()).toBeNull()
  })

  it('THE CONTROL: the same call answers once an owner registers', () => {
    // Otherwise the refusal above passes on a function that always throws.
    registerPluginTaxProfile(LEDGER, { pluginId: 'ledger' })
    expect(() => pluginTaxProfile()).not.toThrow()
  })

  it('keeps one owner: a second plugin is refused, and the incumbent keeps serving', () => {
    registerPluginTaxProfile(LEDGER, { pluginId: 'ledger' })
    expect(() =>
      registerPluginTaxProfile(
        {
          flatRate: async () => undefined,
          flatTax: () => ({ taxCents: 1, label: 'x', pct: 1 }),
          taxModeOf: () => 'x',
        },
        { pluginId: 'tickets' },
      ),
    ).toThrow()
    expect(pluginTaxProfileOwner()).toBe('ledger')
    expect(pluginTaxProfile().flatTax({ pct: 10 }, 1_000, 'Tax').taxCents).toBe(100)
  })
})

describe('an outside tax engine, asked within a deadline (AGL-3631)', () => {
  const QUOTE = {
    provider: 'ledger-engine',
    providerLabel: 'Ledger Engine',
    taxCents: 825,
    lines: [{ id: 'a', taxCents: 825 }],
    shippingTaxCents: 0,
    sandbox: true,
  }
  const REQUEST = {
    hostId: 'host-1',
    currency: 'usd',
    channel: 'online' as const,
    lines: [{ id: 'a', quantity: 1, amountCents: 10_000 }],
  }

  it('answers `null`, not a refusal, when no plugin offers an engine', async () => {
    expect(pluginTaxEngine()).toBeNull()
    await expect(quotePluginTaxEngine(REQUEST)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      message: expect.any(String),
    })
  })

  it('hands back the engine’s quote', async () => {
    const engine: PluginTaxEngine = {
      status: async () => ({ connected: true, provider: 'ledger-engine' }),
      quote: async () => QUOTE,
      validateAddress: async () => ({ valid: true, normalized: null, messages: [] }),
    }
    registerPluginTaxEngine(engine, { pluginId: 'ledger' })
    expect(pluginTaxEngine()).toBe(engine)
    await expect(quotePluginTaxEngine(REQUEST)).resolves.toEqual({ ok: true, quote: QUOTE })
  })

  it('names an engine that threw, without throwing itself', async () => {
    registerPluginTaxEngine(
      {
        status: async () => ({ connected: true }),
        quote: async () => {
          throw new Error('401 from the vendor')
        },
        validateAddress: async () => ({ valid: false, normalized: null, messages: [] }),
      },
      { pluginId: 'ledger' },
    )
    await expect(quotePluginTaxEngine(REQUEST)).resolves.toEqual({
      ok: false,
      reason: 'error',
      message: '401 from the vendor',
    })
  })

  it('stops waiting at the deadline, so a slow vendor cannot hang a checkout', async () => {
    registerPluginTaxEngine(
      {
        status: async () => ({ connected: true }),
        quote: () => new Promise(() => undefined),
        validateAddress: async () => ({ valid: false, normalized: null, messages: [] }),
      },
      { pluginId: 'ledger' },
    )
    await expect(quotePluginTaxEngine(REQUEST, { timeoutMs: 20 })).resolves.toEqual({
      ok: false,
      reason: 'timeout',
      message: expect.stringContaining('20 ms'),
    })
  })
})
