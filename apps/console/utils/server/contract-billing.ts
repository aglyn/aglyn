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
  CONTRACT_ADDON_KIND_METADATA,
  contractAddonLookupKey,
  type AddonKind,
  type BillingInterval,
} from '@aglyn/tenant-data-admin/server/billing-addons'
import type { StripeCall } from './immediate-charge'

/**
 * Stripe objects for a Custom contract's self-serve additions (AGL-4233).
 *
 * A contract's add-ons sell at the deal's own rates, which no catalog price
 * carries, so each one bills on a per-workspace price under the deal's
 * "Enterprise — {org}" product: minted the first time it is bought, found
 * again by its lookup key every time after, and tagged with the add-on kind
 * (`CONTRACT_ADDON_KIND_METADATA`) so every reader of the subscription —
 * the webhook's `seatAddons` mirror included — knows what it sells.
 */

/**
 * The deal's product: the "Enterprise — {org}" product the provisioning door
 * made, found by its metadata. Created with the same metadata when a deal
 * somehow has none, so provisioning and additions always share one.
 */
export async function contractProductId(
  stripe: StripeCall,
  orgId: string,
  orgName: string,
): Promise<string> {
  const query = `active:'true' AND metadata['orgId']:'${orgId}' AND metadata['custom']:'true'`
  const found = await stripe(
    'GET',
    `products/search?query=${encodeURIComponent(query)}`,
  )
  const existing = (found?.data ?? [])[0]
  if (existing?.id) return String(existing.id)
  const created = await stripe(
    'POST',
    'products',
    new URLSearchParams({
      name: `Enterprise — ${orgName}`.slice(0, 250),
      'metadata[orgId]': orgId,
      'metadata[custom]': 'true',
    }),
  )
  return String(created.id)
}

/**
 * The price a contract sells `kind` at, on `interval`, at `unitUsd` a month
 * (a yearly price bills twelve months). Found by lookup key, minted when
 * missing. A renegotiated rate is a NEW price under a new key — Stripe prices
 * are immutable — and the next quantity change moves the item onto it.
 */
export async function ensureContractAddonPrice(
  stripe: StripeCall,
  options: {
    orgId: string
    orgName: string
    kind: AddonKind
    interval: BillingInterval
    unitUsd: number
  },
): Promise<string> {
  const { orgId, orgName, kind, interval, unitUsd } = options
  const unitAmountCents = Math.round(unitUsd * (interval === 'year' ? 12 : 1) * 100)
  const lookupKey = contractAddonLookupKey(orgId, kind, interval, unitAmountCents)
  const listed = await stripe(
    'GET',
    `prices?active=true&limit=1&lookup_keys[]=${encodeURIComponent(lookupKey)}`,
  )
  const existing = (listed?.data ?? [])[0]
  if (existing?.id) return String(existing.id)
  const productId = await contractProductId(stripe, orgId, orgName)
  const created = await stripe(
    'POST',
    'prices',
    new URLSearchParams({
      product: productId,
      currency: 'usd',
      unit_amount: String(unitAmountCents),
      'recurring[interval]': interval,
      lookup_key: lookupKey,
      nickname: `Contract addition: ${kind}`,
      [`metadata[${CONTRACT_ADDON_KIND_METADATA}]`]: kind,
      'metadata[orgId]': orgId,
      'metadata[contractAddon]': 'true',
    }),
  )
  return String(created.id)
}

/**
 * How a contract's addition reaches its bill (AGL-4233). A card deal is
 * charged now and granted once paid, exactly as a Pro add-on is
 * (`immediateChargeParams`). An invoice deal (`send_invoice`, net terms) is
 * prorated onto its NEXT invoice and granted now: nothing is invoiced on the
 * spot, which is what net terms already promise.
 */
export function contractBillsOnNextInvoice(subscription: {
  collection_method?: string | null
} | null | undefined): boolean {
  return subscription?.collection_method === 'send_invoice'
}
