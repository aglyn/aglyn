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

import type {
  PluginShippingAddress,
  PluginShippingAddressCheck,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import { isCompleteAddress, normalizeShippingAddress } from '../model/shipping-settings'
import { openShippingAccount } from './account-store'
import { readShippingConfig } from './config'
import { isDocumentId, orgRef } from './db'
import { resolveShippingSite } from './site-context'

/**
 * THE ADDRESS CHECK TAKEN AT CHECKOUT (AGL-3612).
 *
 * A storefront checkout collects the street address on the payment page, so
 * the first moment the whole address exists on the server is the paid order.
 * The seller raises `order.paid` (a plugin event, subscribed by name — this
 * plugin never imports the seller), and this module asks the carrier platform
 * whether the address is deliverable, then keeps the answer beside the order:
 * the order dialog shows an undeliverable or corrected address before anyone
 * buys a label for it, and a re-check from the dialog replaces it.
 *
 * Stored at `orgs/{orgId}/shippingAddressChecks/{hostId}__{recordId}`,
 * server-only like every shipping record. One per order: a redelivered event
 * finds the check already there and asks nothing.
 */

/** A kept check, as the console reads it. */
export interface StoredAddressCheck {
  hostId: string
  recordId: string
  address: PluginShippingAddress
  check: PluginShippingAddressCheck
  /** `checkout` when taken as the order was paid; `console` from the dialog. */
  source: 'checkout' | 'console'
  checkedAtMs: number
}

/** After this many failed deliveries a check is given up: the dialog can still check by hand. */
export const ADDRESS_CHECK_MAX_ATTEMPTS = 3

/** The id a record's check is kept under: one per site and record. */
export function addressCheckDocId(hostId: string, recordId: string): string {
  return `${hostId}__${recordId}`
}

export function addressCheckRef(orgId: string, hostId: string, recordId: string) {
  return orgRef(orgId).collection(SHIPPING_COLLECTIONS.addressChecks).doc(addressCheckDocId(hostId, recordId))
}

/** The kept check for one record, or `null`. */
export async function readAddressCheck(
  orgId: string,
  hostId: string,
  recordId: string,
): Promise<StoredAddressCheck | null> {
  if (!isDocumentId(hostId) || !isDocumentId(recordId)) return null
  const snapshot = await addressCheckRef(orgId, hostId, recordId).get()
  return snapshot.exists ? (snapshot.data() as StoredAddressCheck) : null
}

/** Keeps a check, replacing any earlier one for the record. */
export async function writeAddressCheck(
  orgId: string,
  entry: Omit<StoredAddressCheck, 'checkedAtMs'> & { checkedAtMs?: number },
): Promise<StoredAddressCheck> {
  const stored: StoredAddressCheck = {
    hostId: entry.hostId,
    recordId: entry.recordId,
    address: entry.address,
    check: {
      verdict: entry.check.verdict,
      messages: (entry.check.messages ?? []).map((message) => String(message).slice(0, 300)).slice(0, 5),
      ...(entry.check.suggested ? { suggested: entry.check.suggested } : {}),
    },
    source: entry.source,
    checkedAtMs: entry.checkedAtMs ?? Date.now(),
  }
  await addressCheckRef(orgId, entry.hostId, entry.recordId).set({ ...stored, orgId })
  return stored
}

/** The slice of an `order.paid` envelope this module reads. */
export interface PaidOrderEnvelope {
  hostId: string
  attempt: number
  payload: { order?: { id?: unknown; shippingAddress?: unknown } | null } | null | undefined
}

/** The seller's address shape (`line1`/`postalCode`, or Stripe's `address.*`) as ours. */
export function addressFromOrder(value: unknown): PluginShippingAddress | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const nested = (raw['address'] && typeof raw['address'] === 'object' ? raw['address'] : {}) as Record<string, unknown>
  return normalizeShippingAddress({
    name: raw['name'],
    phone: raw['phone'],
    country: raw['country'] ?? nested['country'],
    line1: raw['line1'] ?? nested['line1'],
    line2: raw['line2'] ?? nested['line2'],
    city: raw['city'] ?? nested['city'],
    state: raw['state'] ?? nested['state'],
    postalCode: raw['postalCode'] ?? raw['postal_code'] ?? nested['postal_code'] ?? nested['postalCode'],
  })
}

export type PaidOrderCheckOutcome =
  | 'checked'
  | 'already'
  | 'not-shipped'
  | 'not-available'
  | 'gave-up'

/**
 * The `order.paid` subscriber. Never opens a provider account (a shopper's
 * purchase must not create one): a workspace without an account is simply
 * not checked. A provider failure throws so the outbox retries it, until
 * {@link ADDRESS_CHECK_MAX_ATTEMPTS}.
 */
export async function checkPaidOrderAddress(envelope: PaidOrderEnvelope): Promise<PaidOrderCheckOutcome> {
  const order = envelope.payload?.order
  const recordId = typeof order?.id === 'string' ? order.id : ''
  const address = addressFromOrder(order?.shippingAddress)
  if (!isDocumentId(recordId) || !isDocumentId(envelope.hostId) || !address || !isCompleteAddress(address)) {
    return 'not-shipped'
  }
  const configured = readShippingConfig()
  if (!configured.configured) return 'not-available'
  const site = await resolveShippingSite(envelope.hostId)
  if (!site) return 'not-available'
  if (await readAddressCheck(site.orgId, envelope.hostId, recordId)) return 'already'
  const account = await openShippingAccount(site.orgId, configured.config).catch(() => null)
  if (!account) return 'not-available'
  try {
    const check = await configured.config.provider.validateAddress(account, address)
    await writeAddressCheck(site.orgId, { hostId: envelope.hostId, recordId, address, check, source: 'checkout' })
    return 'checked'
  } catch (error) {
    if (envelope.attempt >= ADDRESS_CHECK_MAX_ATTEMPTS) {
      console.warn('[shipping] address check given up', envelope.hostId, recordId, error)
      return 'gave-up'
    }
    throw error
  }
}
