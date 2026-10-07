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

/**
 * AN OUTSIDE TAX ENGINE, answering for a merchant who connected one
 * (AGL-3631).
 *
 * The tax profile above is the merchant's own flat arithmetic. Some merchants
 * calculate tax in a service of their own — an Avalara AvaTax or TaxJar
 * account, under their own registrations — and want the plugin that charges
 * to ask that service instead of a rate table. This contract is that
 * question, asked the same way whichever service answers it:
 *
 * - {@link PluginTaxEngine.status} — whether a site has an engine connected
 *   and which one;
 * - {@link PluginTaxEngine.quote} — the tax on a basket, by line, for a
 *   destination (or the site's own address for an in-person sale);
 * - {@link PluginTaxEngine.validateAddress} — the engine's own reading of an
 *   address, for a plugin that wants it checked before it ships or taxes.
 *
 * Recording a paid sale with the engine, and reversing it on a refund or a
 * cancellation, is NOT asked here. The seller's plugin already announces
 * those facts as domain events (`order.paid`, `order.refunded`,
 * `order.cancelled`), with retries, so the engine's plugin subscribes to them
 * and the seller never has to know an engine records anything.
 *
 * ## A slot, and an empty one is an answer
 *
 * One plugin owns outside engines; it dispatches to whichever service a site
 * connected. Unlike the tax profile, an empty slot is a normal state — most
 * deployments carry no engine — so {@link pluginTaxEngine} answers `null`,
 * and a caller that wanted one prices the sale its usual way and says so.
 *
 * ## The engine is slow and outside, so the caller holds a deadline
 *
 * {@link quotePluginTaxEngine} never throws and never waits past its
 * deadline: a checkout that hung on a vendor would lose the sale, and one
 * that failed outright would lose it too. It answers what happened —
 * `unavailable`, `timeout` or `error` — so the caller can fall back to the
 * tax path it had before, flag the order, and log why.
 */

/** A postal address as a tax engine reads it. `country` is ISO-3166 alpha-2. */
export interface PluginTaxAddress {
  line1?: string
  line2?: string
  city?: string
  /** State, province or region code, e.g. `TX`. */
  region?: string
  postalCode?: string
  country: string
}

/** One taxable line of a basket. Money is integer cents in the request's currency. */
export interface PluginTaxEngineLine {
  /** The caller's own id for the line, echoed back on the answer. */
  id: string
  /** The product the line sells, so the engine's plugin can find its tax code. */
  productId?: string
  variantId?: string
  sku?: string
  description?: string
  quantity: number
  /** The line's total after any discount on it, EXCLUSIVE of tax. */
  amountCents: number
  /** A tax code the caller already holds; otherwise the engine's plugin supplies one. */
  taxCode?: string
  /** A line the seller marked tax-exempt: quoted at zero whatever the engine says. */
  exempt?: boolean
}

/** What a caller asks an engine. */
export interface PluginTaxEngineQuoteRequest {
  hostId: string
  /** ISO 4217, lower or upper case. */
  currency: string
  /** Where the sale happens: `pos` is in person, taxed at the site's own address. */
  channel: 'online' | 'pos' | 'invoice'
  lines: readonly PluginTaxEngineLine[]
  /**
   * A discount on the whole basket, spread by the engine's plugin across the
   * lines that are not exempt. Line-level discounts are already inside each
   * line's `amountCents`.
   */
  discountCents?: number
  /** Shipping charged, when the caller wants it quoted. */
  shippingCents?: number
  /** The destination. Absent or `null`, the engine taxes at the site's own address. */
  shipTo?: PluginTaxAddress | null
  /** The buyer, so an exemption the merchant recorded for them applies. */
  customer?: { email?: string | null; id?: string | null }
}

/** One line of an answer. */
export interface PluginTaxEngineQuoteLine {
  id: string
  taxCents: number
}

/** What an engine answered. Every figure is integer cents. */
export interface PluginTaxEngineQuote {
  /** The engine's id, e.g. `avalara`. */
  provider: string
  /** Its name in the merchant's words, e.g. `Avalara AvaTax`. */
  providerLabel: string
  taxCents: number
  lines: readonly PluginTaxEngineQuoteLine[]
  shippingTaxCents: number
  /** Whether the answer came from the engine's test environment. */
  sandbox: boolean
}

/** Whether a site has an engine connected. */
export interface PluginTaxEngineStatus {
  connected: boolean
  provider?: string
  providerLabel?: string
  sandbox?: boolean
}

/** An engine's reading of an address. */
export interface PluginTaxAddressValidation {
  valid: boolean
  /** The address as the engine normalized it, when it could. */
  normalized: PluginTaxAddress | null
  /** What the engine said about it, in its own words. */
  messages: readonly string[]
}

export interface PluginTaxEngine {
  status(hostId: string): Promise<PluginTaxEngineStatus>
  /** THROWS on any failure: no connection, a refusal, a network error. */
  quote(request: PluginTaxEngineQuoteRequest): Promise<PluginTaxEngineQuote>
  /** THROWS when no engine is connected for the site or the engine fails. */
  validateAddress(
    hostId: string,
    address: PluginTaxAddress,
  ): Promise<PluginTaxAddressValidation>
}

export const PLUGIN_TAX_ENGINE = definePluginServiceContract<PluginTaxEngine>(
  'core.tax-engine',
  { multiple: false },
)

/** Registers the plugin that answers for outside tax engines. */
export function registerPluginTaxEngine(
  engine: PluginTaxEngine,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_TAX_ENGINE, engine, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The engine's plugin, or `null` when no plugin registered one. */
export function pluginTaxEngine(): PluginTaxEngine | null {
  return resolvePluginServices(PLUGIN_TAX_ENGINE)[0]?.impl ?? null
}

/** How long a quote may take before the caller prices the sale without it. */
export const PLUGIN_TAX_ENGINE_QUOTE_TIMEOUT_MS = 5_000

/** What {@link quotePluginTaxEngine} came to. */
export type PluginTaxEngineQuoteOutcome =
  | { ok: true; quote: PluginTaxEngineQuote }
  | {
      ok: false
      /** No engine plugin, or none connected for the site. */
      reason: 'unavailable' | 'timeout' | 'error'
      message: string
    }

/**
 * Asks the engine for a quote within a deadline. Never throws: see the
 * module note on why the caller, not the engine, holds the clock.
 */
export async function quotePluginTaxEngine(
  request: PluginTaxEngineQuoteRequest,
  options: { timeoutMs?: number } = {},
): Promise<PluginTaxEngineQuoteOutcome> {
  const engine = pluginTaxEngine()
  if (!engine) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'no tax engine plugin is registered',
    }
  }
  const timeoutMs = Math.max(1, options.timeoutMs ?? PLUGIN_TAX_ENGINE_QUOTE_TIMEOUT_MS)
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<PluginTaxEngineQuoteOutcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          reason: 'timeout',
          message: `the tax engine did not answer within ${timeoutMs} ms`,
        }),
      timeoutMs,
    )
  })
  const asked = Promise.resolve()
    .then(() => engine.quote(request))
    .then(
      (quote): PluginTaxEngineQuoteOutcome => ({ ok: true, quote }),
      (error: unknown): PluginTaxEngineQuoteOutcome => ({
        ok: false,
        reason: 'error',
        message: String((error as Error)?.message ?? error).slice(0, 300),
      }),
    )
  try {
    return await Promise.race([asked, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
