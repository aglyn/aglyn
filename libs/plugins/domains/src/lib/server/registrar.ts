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
import type { RegistrarDnsRecord } from '../model/dns-records'
import type { RegistrantContact } from '../model/registration'

export type { RegistrantContact }

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
  | {
      ok: 'no'
      code: string
      retryable: boolean
      /**
       * A date the refusal names, when it names one: the registry's
       * transfer lock on an auth-code request ends then (AGL-4040).
       */
      untilMs?: number | null
    }

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

/**
 * Where a transfer in stands (AGL-4040): `pending` while the losing
 * registrar and the registry act, which takes up to about a week; `state` is
 * the registrar's own code (`pending_transfer`, `pending_unlock`…).
 */
export interface RegistrarTransferStatus {
  status: 'pending' | 'completed' | 'failed'
  state: string
}

/** Whose nameservers a name uses (AGL-4040). */
export interface RegistrarNameservers {
  /** True when the name answers from the registrar's DNS, which we edit. */
  ours: boolean
  nameservers: string[]
  /** The registrar's own nameservers, which `ours` compares against. */
  intended: string[]
}

/** A DNS record as the registrar lists it. */
export interface RegistrarListedRecord {
  id: string
  type: string
  name: string
  value: string
  ttl: number | null
  priority: number | null
  /** `system` for a record the registrar made itself. */
  creator: string | null
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
    /**
     * A registrant contact the owner changed since the last renewal. The
     * renewal is the only call the registrar takes one on (AGL-4040).
     */
    contact?: RegistrantContact
  }): Promise<RegistrarResult<{ orderId: string }>>
  /** The registrar's current renewal price for one year. */
  renewalPrice(domain: string): Promise<RegistrarResult<number>>
  setAutoRenew(domain: string, autoRenew: boolean): Promise<RegistrarResult<true>>
  info(domain: string): Promise<RegistrarResult<RegistrarDomainInfo>>
  contactVerification(
    domain: string,
  ): Promise<RegistrarResult<RegistrarContactVerification>>
  /**
   * The code another registrar asks for to move the name away. A name
   * inside the registry's transfer lock is refused with
   * `domain_cannot_be_transfered_out_until` and the date in `untilMs`.
   */
  authCode(domain: string): Promise<RegistrarResult<string>>
  /** The registrar's price, in dollars, to move a name here for one year. */
  transferPrice(domain: string): Promise<RegistrarResult<number>>
  /** Starts moving a name here from another registrar (AGL-4040). */
  transferIn(request: {
    domain: string
    authCode: string
    years: number
    expectedPriceUsd: number
    autoRenew: boolean
    contact: RegistrantContact
  }): Promise<RegistrarResult<{ orderId: string }>>
  transferStatus(domain: string): Promise<RegistrarResult<RegistrarTransferStatus>>
  nameservers(domain: string): Promise<RegistrarResult<RegistrarNameservers>>
  listDnsRecords(domain: string): Promise<RegistrarResult<RegistrarListedRecord[]>>
  createDnsRecord(
    domain: string,
    record: RegistrarDnsRecord,
  ): Promise<RegistrarResult<{ id: string }>>
  updateDnsRecord(recordId: string, record: RegistrarDnsRecord): Promise<RegistrarResult<true>>
  deleteDnsRecord(domain: string, recordId: string): Promise<RegistrarResult<true>>
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
  transferPrice: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  transferIn: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  transferStatus: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  nameservers: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  listDnsRecords: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  createDnsRecord: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  updateDnsRecord: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
  deleteDnsRecord: async () => ({ ok: 'no', code: 'not-configured', retryable: false }),
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
