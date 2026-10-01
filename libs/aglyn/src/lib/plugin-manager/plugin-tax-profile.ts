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
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * The tenant's tax rule, answered by the one plugin that owns it (AGL-3080).
 *
 * More than one plugin takes money — a storefront sells goods, a calendar
 * sells appointments — and a merchant has ONE tax profile. The plugin that
 * keeps it works out what a flat rate adds to a charge and which regime a
 * settled payment was taxed under; any other plugin that charges asks here.
 * Importing the owner's model instead is how two money paths end up with two
 * rounding rules, and the second is found by an accountant.
 *
 * ## Where the rate is kept, and the arithmetic over it
 *
 * The merchant's rates are the owner's settings, stored where the owner keeps
 * them, so a caller asks for one — {@link PluginTaxProfile.flatRate}, the
 * contract's one read, by site and by the kind of charge — and never reads
 * the owner's documents itself. A plugin that knew where another plugin kept
 * a merchant's tax settings would charge untaxed, and record it as untaxed,
 * the day those settings moved.
 *
 * The other two questions are pure and synchronous arithmetic over values the
 * caller already holds: the rate it was handed, a charge in cents, a settled
 * payment object. Nobody is asked who they are.
 *
 * ## No profile is a refusal, never a zero
 *
 * {@link pluginTaxProfile} THROWS when no plugin registered one. Every other
 * seam here answers `null` for "nobody home", and this one must not: a caller
 * that read `null` as "no tax" would charge a customer an untaxed total and
 * record it as untaxed, silently, and the merchant would owe the difference.
 * A refused sale is seen the same day.
 *
 * It cannot happen in a working build. Both apps load every plugin's server
 * entry before a plugin handler, a cron or the billing webhook runs
 * (`ensureAll`), so the owner's registration is in place wherever a charge is
 * priced; `tax-profile-is-registered.spec.ts` in each app holds that.
 *
 * ## One owner
 *
 * A workspace has one tax profile, so the contract is a slot: a second
 * plugin's profile is refused naming both and the incumbent keeps serving.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-tax-profile`); it is not in the barrel.
 */

/** What a flat rate adds to one charge. All zero and empty when it adds nothing. */
export interface PluginResolvedFlatTax {
  taxCents: number
  /** What the line is called on the receipt. */
  label: string
  pct: number
}

export interface PluginTaxProfile {
  /**
   * The merchant's flat rate for one kind of charge on a site, as the owner
   * stores it — to be handed to {@link PluginTaxProfile.flatTax} as read. `charge` names what
   * is being sold in the owner's words for its rates (`service` for an
   * appointment). A site that set none, or a kind the owner keeps no rate
   * for, answers `undefined`, which `flatTax` prices at zero. Server-side:
   * the owner reads its own settings document.
   */
  flatRate(hostId: string, charge: string): Promise<unknown>
  /**
   * Tax, EXCLUSIVE, for a flat merchant rate on one charged amount. `rate` is
   * the merchant's stored setting, passed as read: the owner decides what a
   * usable rate is, and an absent, zero, negative or out-of-range one answers
   * zero rather than throwing.
   */
  flatTax(
    rate: unknown,
    chargeCents: number,
    fallbackLabel: string,
  ): PluginResolvedFlatTax
  /**
   * Which regime a settled payment was taxed under, as the owner records it.
   * `manualTaxCents` is the tax this caller added as a line of its own, which
   * the payment processor reports as no tax at all.
   */
  taxModeOf(settledPayment: unknown, manualTaxCents?: number): string
}

export const PLUGIN_TAX_PROFILE = definePluginServiceContract<PluginTaxProfile>(
  'core.tax-profile',
  { multiple: false },
)

/** Registers the plugin that owns the tenant's tax rule. */
export function registerPluginTaxProfile(
  profile: PluginTaxProfile,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_TAX_PROFILE, profile, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The owner, or `null` — for a caller that only wants to know who it is. */
export function pluginTaxProfileOwner(): string | null {
  return resolvePluginServices(PLUGIN_TAX_PROFILE)[0]?.pluginId ?? null
}

/** The tax rule. THROWS when no plugin registered one; see the module note. */
export function pluginTaxProfile(): PluginTaxProfile {
  const entry = resolvePluginServices(PLUGIN_TAX_PROFILE)[0]
  if (!entry) {
    throw new Error(
      'no plugin registered a tax profile, so this charge cannot be priced: ' +
        'refusing rather than charging it untaxed',
    )
  }
  return entry.impl
}
