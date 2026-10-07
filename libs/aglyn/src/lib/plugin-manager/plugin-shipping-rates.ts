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
 * Live parcel rates, answered by the one plugin that talks to carriers
 * (AGL-3612).
 *
 * A plugin that sells goods prices delivery from its own table until the
 * merchant asks for live rates; then it needs a carrier's quote for an
 * address and a parcel, and it must not learn which carrier network, which
 * account or which vendor answers. A plugin that buys labels registers here;
 * a plugin that sells asks here, and neither imports the other.
 *
 * ## The shape is a parcel and an address, nothing more
 *
 * Every type below is postal: where it goes, what it weighs, how big it is,
 * and what it is worth for insurance and customs. Nothing names a catalog, an
 * order or a store, so a booking plugin shipping a rental kit asks the same
 * question in the same words.
 *
 * ## Nobody home is `null`, never a refusal
 *
 * Unlike the tax profile, an absent quoter is a perfectly good answer: the
 * seller falls back to its own rates, which is what it did before anyone
 * registered. {@link pluginShippingRateQuoter} answers `null`, and a quoter
 * whose deployment is not configured answers `available() === false`, which
 * a caller must read the same way.
 *
 * ## A quote is advisory until a label is bought
 *
 * `amountCents` is what the carrier quoted the platform for that parcel at
 * that moment, BEFORE any markup or handling the seller adds. The seller
 * decides what the shopper pays; the quoter never does.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-shipping-rates`); it is not in the
 * barrel.
 */

/** A postal address. `country` is ISO-3166 alpha-2; everything else is optional. */
export interface PluginShippingAddress {
  name?: string
  company?: string
  line1?: string
  line2?: string
  city?: string
  /** State, province or region code, as the destination writes it. */
  state?: string
  postalCode?: string
  country: string
  phone?: string
  email?: string
  /** Whether the address is a home, when the caller knows; carriers price it. */
  residential?: boolean
}

/** One parcel. Metric throughout; an adapter converts to its vendor's units. */
export interface PluginShippingParcel {
  weightGrams: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
}

/** What a seller asks: one shipment's rates to one address. */
export interface PluginShippingQuoteRequest {
  /** The site the shipment leaves from; the quoter resolves its ship-from address. */
  hostId: string
  to: PluginShippingAddress
  parcels: PluginShippingParcel[]
  /** ISO-4217, lower case, of the amounts the caller will charge in. */
  currency: string
  /** The goods' value, for insurance and customs; 0 when unknown. */
  valueCents: number
  /**
   * Service keys the seller offers (`'usps:priority'`), as
   * {@link PluginShippingRateQuoter.listServices} names them. Empty or
   * absent means every service the quoter can price.
   */
  services?: string[]
  /** Aborted when the caller stops waiting; a quoter passes it to its fetches. */
  signal?: AbortSignal
}

/** One carrier service's price for the shipment. */
export interface PluginShippingQuote {
  /** Stable across quotes: `carrier:service`, the key a seller stores. */
  serviceKey: string
  carrier: string
  service: string
  /** What a shopper reads: `'USPS Priority Mail'`. */
  label: string
  /** The carrier's price to the platform, before any markup or handling. */
  amountCents: number
  currency: string
  /** Transit estimate in business days, when the carrier gives one. */
  estimatedDays?: number
}

/** A service a seller may choose to offer. */
export interface PluginShippingService {
  serviceKey: string
  carrier: string
  label: string
}

/** What address validation answers. */
export interface PluginShippingAddressCheck {
  /** `valid` deliverable as written; `corrected` deliverable as `suggested`; `invalid` not deliverable. */
  verdict: 'valid' | 'corrected' | 'invalid' | 'unknown'
  /** The address the carrier would deliver to, when it differs. */
  suggested?: PluginShippingAddress
  /** Why it is not deliverable, in the carrier's words. */
  messages: string[]
}

export interface PluginShippingRateQuoter {
  /** Whether quotes can be asked for this site now: configured and switched on. */
  available(hostId: string): Promise<boolean>
  /**
   * The rates. Throws on a provider failure; a caller that cannot wait
   * aborts `signal` and falls back to its own rates.
   */
  quote(request: PluginShippingQuoteRequest): Promise<PluginShippingQuote[]>
  /** The services a seller can pick from for this site. */
  listServices(hostId: string): Promise<PluginShippingService[]>
  /** Whether an address is deliverable, and the carrier's correction. */
  validateAddress?(
    hostId: string,
    address: PluginShippingAddress,
  ): Promise<PluginShippingAddressCheck>
}

export const PLUGIN_SHIPPING_RATE_QUOTER =
  definePluginServiceContract<PluginShippingRateQuoter>('core.shipping-rate-quoter', {
    multiple: false,
  })

/** Registers the plugin that quotes carrier rates. A second plugin is refused. */
export function registerPluginShippingRateQuoter(
  quoter: PluginShippingRateQuoter,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_SHIPPING_RATE_QUOTER, quoter, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The quoter, or `null` when no plugin registered one. */
export function pluginShippingRateQuoter(): PluginShippingRateQuoter | null {
  return resolvePluginServices(PLUGIN_SHIPPING_RATE_QUOTER)[0]?.impl ?? null
}

/**
 * Asks the quoter and gives up after `timeoutMs`: `null` when nobody is
 * registered, the site is not available, the provider failed, or the wait
 * ran out. Never throws. The caller's fallback is its own rates, so every
 * failure reads the same.
 */
export async function quotePluginShippingRates(
  request: Omit<PluginShippingQuoteRequest, 'signal'>,
  options: { timeoutMs: number },
): Promise<PluginShippingQuote[] | null> {
  const quoter = pluginShippingRateQuoter()
  if (!quoter) return null
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, Math.max(0, options.timeoutMs))
  })
  try {
    return await Promise.race([
      (async (): Promise<PluginShippingQuote[] | null> => {
        if (!(await quoter.available(request.hostId))) return null
        return quoter.quote({ ...request, signal: controller.signal })
      })().catch((): null => null),
      deadline,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
