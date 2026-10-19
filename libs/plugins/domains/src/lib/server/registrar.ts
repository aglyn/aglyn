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
  resolvePluginServices,
} from '@aglyn/aglyn/plugin-manager/plugin-services'

/*
 * THE REGISTRAR SEAM (AGL-3962).
 *
 * Everything the plugin asks of whoever sells the names, behind one
 * contract, so a reseller registrar can stand where Vercel stands today
 * without a line of the purchase lifecycle changing. Vercel's driver is the
 * first; a deployment chooses with `DOMAINS_REGISTRAR`, and a marketplace
 * plugin can offer another through the `domains.registrar` service.
 *
 * The contract, the domain provider's in `@aglyn/tenant-data-admin`:
 *
 * 1. **Never throw.** The sweep walks every registration and must not stop
 *    at the first bad one.
 * 2. **`code` is a CODE, never provider prose.** It is matched on, logged and
 *    stored; prose would leak a vendor's wording into the customer's page.
 * 3. **`retryable` decides what the sweep does next.** A timeout or a 5xx is
 *    tried again on the next pass; a refusal ends the attempt.
 */

export type RegistrarResult<T> =
  | { ok: 'yes'; value: T }
  | { ok: 'no'; code: string; retryable: boolean }

export interface RegistrarQuote {
  domain: string
  available: boolean
  /** A premium name, priced by its owner rather than the ending: never sold. */
  premium: boolean
  /** Years the purchase price buys (some endings sell two at minimum). */
  years: number
  purchaseUsd: number
  renewalUsd: number
}

/** ICANN's registrant contact, as every registrar takes it. */
export interface RegistrantContact {
  firstName: string
  lastName: string
  email: string
  /** E.164, `+1.5125550123` or `+15125550123`. */
  phone: string
  address1: string
  address2?: string
  city: string
  state: string
  zip: string
  /** ISO 3166-1 alpha-2. */
  country: string
  companyName?: string
}

export type RegistrarOrderStatus = 'pending' | 'completed' | 'failed'

export interface RegistrarOrder {
  orderId: string
  status: RegistrarOrderStatus
  /** The registrar's own reason when the order failed. A code. */
  failure?: string
}

export interface RegistrarDomainInfo {
  /** Whether the name is registered to OUR account at this registrar. */
  owned: boolean
  registeredAtMs: number | null
  expiresAtMs: number | null
  autoRenew: boolean | null
}

export interface RegistrarContactVerification {
  verified: boolean
  verifyByMs: number | null
  email: string | null
}

export interface RegistrarDriver {
  /** Stable id, stored on every registration. Never a display name. */
  readonly id: string
  /** Whether this deployment can sell names through this driver. */
  configured(): boolean
  /** Availability and price for exact names, in input order. */
  search(domains: readonly string[]): Promise<RegistrarResult<RegistrarQuote[]>>
  /**
   * Whether the ending takes the standard contact alone. Endings that want
   * more (a nexus, a local presence, a trademark) are not offered.
   */
  standardContact(domain: string): Promise<RegistrarResult<boolean>>
  buy(request: {
    domain: string
    years: number
    expectedPriceUsd: number
    autoRenew: boolean
    contact: RegistrantContact
  }): Promise<RegistrarResult<{ orderId: string }>>
  order(orderId: string): Promise<RegistrarResult<RegistrarOrder>>
  renew(request: {
    domain: string
    years: number
    expectedPriceUsd: number
  }): Promise<RegistrarResult<{ orderId: string }>>
  /** The registrar's current renewal price for one year. */
  renewalPrice(domain: string): Promise<RegistrarResult<number>>
  setAutoRenew(domain: string, autoRenew: boolean): Promise<RegistrarResult<true>>
  info(domain: string): Promise<RegistrarResult<RegistrarDomainInfo>>
  contactVerification(
    domain: string,
  ): Promise<RegistrarResult<RegistrarContactVerification>>
  /** The code another registrar asks for to move the name away. */
  authCode(domain: string): Promise<RegistrarResult<string>>
  /** Every name this account registered, for the orphan reconcile. */
  listOwned(): Promise<
    RegistrarResult<{ domain: string; boughtAtMs: number | null; autoRenew: boolean | null }[]>
  >
}

/** A deployment that sells no names. Every call is a refusal, never a throw. */
export const NO_REGISTRAR: RegistrarDriver = {
  id: 'none',
  configured: () => false,
  search: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  standardContact: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  buy: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  order: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  renew: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  renewalPrice: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  setAutoRenew: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  info: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  contactVerification: async () => ({
    ok: 'no',
    code: 'not-configured',
    retryable: false,
  }),
  authCode: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  listOwned: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
}

/**
 * Registrar drivers offered by plugins (a reseller, a self-host's own). The
 * deployment picks one by id with `DOMAINS_REGISTRAR`.
 */
export const REGISTRAR_DRIVERS = definePluginServiceContract<RegistrarDriver>(
  'domains.registrar',
  { multiple: true },
)

/**
 * The driver this deployment sells through, or {@link NO_REGISTRAR}.
 *
 * Read on every call rather than cached: a deployment switches registrar by
 * changing one variable, and a cached choice would keep selling through the
 * old one until the process recycled.
 */
export function registrar(builtIn: readonly RegistrarDriver[]): RegistrarDriver {
  const wanted = String(process.env['DOMAINS_REGISTRAR'] ?? '').trim().toLowerCase()
  if (!wanted || wanted === 'none') return NO_REGISTRAR
  const offered = [
    ...builtIn,
    ...resolvePluginServices(REGISTRAR_DRIVERS).map((entry) => entry.impl),
  ]
  const driver = offered.find((candidate) => candidate.id === wanted)
  if (!driver) {
    console.warn(`[domains] unknown DOMAINS_REGISTRAR "${wanted}"`)
    return NO_REGISTRAR
  }
  return driver.configured() ? driver : NO_REGISTRAR
}
