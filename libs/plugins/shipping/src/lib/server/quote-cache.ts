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
  PluginShippingQuote,
  PluginShippingQuoteRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { createHash } from 'node:crypto'
import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import { shippingDb } from './db'

/**
 * CHECKOUT QUOTES, KEPT TEN MINUTES (AGL-3612): `shippingQuoteCache/{key}`.
 *
 * A shopper who opens checkout, changes nothing and presses Pay again must
 * not cost a second carrier round trip — nor see a different price for the
 * same parcel to the same door. The key is the request's identity: the site,
 * the address a carrier prices on, the parcels, the services and the
 * currency. Anything that changes the price changes the key.
 *
 * Two layers: this process's map, and a Firestore document so a retry that
 * lands on another instance hits too. The document carries `expiresAt` as a
 * Date for a TTL policy, and is also refused by age on read, so a missing
 * policy only costs storage.
 */

export const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000

const memory = new Map<string, { quotes: PluginShippingQuote[]; expiresAtMs: number }>()

/** The cache key for a request. */
export function quoteCacheKey(
  request: Omit<PluginShippingQuoteRequest, 'signal'>,
  /** Who answered: the platform's id, or `shipperhq` — a workspace that changes it is quoted afresh. */
  source?: string,
): string {
  const to = request.to
  const identity = JSON.stringify({
    ...(source ? { source } : {}),
    host: request.hostId,
    to: [to.country, to.postalCode, to.state, to.city, to.line1, to.line2, to.residential]
      .map((part) => String(part ?? '').trim().toUpperCase()),
    parcels: request.parcels.map((parcel) => [
      Math.round(parcel.weightGrams),
      parcel.lengthCm ?? null,
      parcel.widthCm ?? null,
      parcel.heightCm ?? null,
    ]),
    services: [...(request.services ?? [])].map((one) => one.toLowerCase()).sort(),
    currency: request.currency.toLowerCase(),
    value: Math.round(request.valueCents),
  })
  return createHash('sha256').update(identity).digest('hex')
}

export async function readCachedQuotes(key: string): Promise<PluginShippingQuote[] | null> {
  const now = Date.now()
  const hit = memory.get(key)
  if (hit && hit.expiresAtMs > now) return hit.quotes
  try {
    const snapshot = await shippingDb().collection(SHIPPING_COLLECTIONS.quoteCache).doc(key).get()
    const expiresAtMs = Number(snapshot.get('expiresAtMs') ?? 0)
    if (!snapshot.exists || expiresAtMs <= now) return null
    const quotes = (snapshot.get('quotes') ?? []) as PluginShippingQuote[]
    memory.set(key, { quotes, expiresAtMs })
    return quotes
  } catch {
    return null
  }
}

export async function writeCachedQuotes(
  key: string,
  owner: { orgId: string; hostId: string },
  quotes: PluginShippingQuote[],
): Promise<void> {
  const expiresAtMs = Date.now() + QUOTE_CACHE_TTL_MS
  memory.set(key, { quotes, expiresAtMs })
  if (memory.size > 500) {
    const oldest = memory.keys().next().value
    if (oldest) memory.delete(oldest)
  }
  await shippingDb()
    .collection(SHIPPING_COLLECTIONS.quoteCache)
    .doc(key)
    .set({
      orgId: owner.orgId,
      hostId: owner.hostId,
      quotes,
      expiresAtMs,
      expiresAt: new Date(expiresAtMs),
    })
    .catch(() => undefined)
}

/** Test seam. */
export function clearQuoteMemoryForTests(): void {
  memory.clear()
}
