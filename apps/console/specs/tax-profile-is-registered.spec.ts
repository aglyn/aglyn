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
 *
 * @jest-environment node
 */

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  pluginTaxProfile,
  pluginTaxProfileOwner,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { CONSOLE_PLUGIN_SERVER_MANIFEST } from '../constants/plugins.server.generated'

/**
 * THE TENANT'S TAX RULE IS REGISTERED WHEREVER THIS APP PRICES A CHARGE.
 *
 * A plugin that charges asks the tax-profile contract what a rate adds, and
 * that contract REFUSES rather than answer zero when no plugin owns the rule:
 * an untaxed charge recorded as untaxed is the failure nobody sees until the
 * merchant owes the difference. So a refusal in production would mean this
 * app's loader did not register the owner — and this is the spec that finds
 * that out first.
 *
 * It runs the owner's REAL registrar, reached the way the app reaches it:
 * through the generated manifest's `load()` and the registrar the manifest
 * names for the `consoleApi` surface. The plugins that ask are specced against a
 * stand-in, because one plugin may not import another; this is where the real
 * rule is held, since an app's spec can reach both.
 */

async function registerEverySurface(): Promise<string[]> {
  const ran: string[] = []
  for (const entry of CONSOLE_PLUGIN_SERVER_MANIFEST) {
    const registrar = (entry.register as Record<string, string | undefined>)['consoleApi']
    if (!registrar) continue
    const mod = (await entry.load()) as Record<string, unknown>
    const fn = mod[registrar]
    if (typeof fn !== 'function') {
      throw new Error(`"${entry.id}" names ${registrar}, which its server entry does not export`)
    }
    await (fn as () => void | Promise<void>)()
    ran.push(entry.id)
  }
  return ran
}

describe('the tax rule, after this app’s loader has run', () => {
  let ran: string[] = []

  beforeAll(async () => {
    resetPluginServicesForTests()
    ran = await registerEverySurface()
  })

  it('THE CONTROL: the loader ran the plugins that charge', () => {
    // Otherwise everything below passes on a loop that registered nothing.
    expect(ran).toEqual(expect.arrayContaining(['commerce', 'bookings']))
  })

  it('has an owner, and it is the plugin that keeps the merchant’s tax settings', () => {
    expect(pluginTaxProfileOwner()).toBe('commerce')
    expect(() => pluginTaxProfile()).not.toThrow()
  })

  it('adds a flat rate exclusively, rounded to the cent', () => {
    expect(pluginTaxProfile().flatTax({ pct: 8.5 }, 10_000, 'Service tax')).toEqual({
      taxCents: 850,
      label: 'Service tax',
      pct: 8.5,
    })
    // 7.25% of $19.99 is 144.9275 cents: the cent it rounds to is the rule.
    expect(pluginTaxProfile().flatTax({ pct: 7.25, label: 'Lodging' }, 1_999, 'x')).toEqual({
      taxCents: 145,
      label: 'Lodging',
      pct: 7.25,
    })
  })

  it('adds nothing for a rate nobody set, and never throws on one', () => {
    for (const rate of [undefined, null, {}, { pct: 0 }, { pct: -3 }, { pct: 101 }, { pct: 'x' }]) {
      expect(pluginTaxProfile().flatTax(rate, 10_000, 'Service tax')).toEqual({
        taxCents: 0,
        label: '',
        pct: 0,
      })
    }
  })

  it('reads the regime off the settled payment', () => {
    const profile = pluginTaxProfile()
    expect(profile.taxModeOf({}, 0)).toBe('none')
    // A line the caller added itself, which the processor reports as no tax.
    expect(profile.taxModeOf({ total_details: { amount_tax: 0 } }, 850)).toBe('manual')
    expect(
      profile.taxModeOf({ automatic_tax: { enabled: true }, total_details: { amount_tax: 570 } }),
    ).toBe('stripe-automatic')
  })
})
