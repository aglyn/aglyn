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

import type { CatalogOffer, CatalogStore } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { SALES_CHANNELS, type SalesChannelId } from './channels'
import { resolveOffer, type FeedIssue } from './feed-columns'
import type { SalesChannelSettings } from './settings'

/**
 * WHAT EACH CHANNEL'S FEED LEAVES OUT, AND WHY (AGL-3637).
 *
 * Built from `resolveOffer`, the same function the feed route writes rows
 * with, so a product listed here as left out is exactly a product missing
 * from that channel's file. Issues are grouped by product, since a merchant
 * fixes a product, not an offer.
 */

/** At most this many products are named per channel; the counts stay exact. */
export const DIAGNOSTICS_MAX_PRODUCTS = 200

export interface ProductDiagnostic {
  productId: string
  productName: string
  /** How many of the product's offers the feed leaves out. */
  excludedOffers: number
  offers: number
  issues: FeedIssue[]
}

export interface ChannelDiagnostics {
  channel: SalesChannelId
  /** Offers the feed holds. */
  listed: number
  /** Offers the feed leaves out. */
  excluded: number
  /** Offers sent with at least one warning. */
  warned: number
  products: ProductDiagnostic[]
  /** More products had issues than are named. */
  truncated: boolean
}

export interface CatalogDiagnostics {
  /** Offers read. */
  offers: number
  /** The catalog had more offers than were read. */
  partial: boolean
  /** Problems with the store itself, which every product shares. */
  store: string[]
  channels: ChannelDiagnostics[]
}

/** A store's problems, worded once rather than on every product. */
export function storeProblems(store: CatalogStore): string[] {
  const problems: string[] = []
  if (!store.origin) problems.push('The site has no web address yet: publish it to a subdomain or a custom domain.')
  if (!store.productPagesServed) {
    problems.push(
      'Product pages are not served: choose a product page template in the store’s settings, or every link in the feed answers “not found”.',
    )
  }
  const carrier = store.carrierPricedCountries ?? []
  if (carrier.length) {
    problems.push(
      `Checkout prices shipping to ${carrier.slice(0, 5).join(', ')}${carrier.length > 5 ? ' and more' : ''} by carrier quote, so the feeds send no shipping price there. In Google Merchant Center, set up carrier-calculated shipping for those countries; it uses each product's weight and packed size.`,
    )
  }
  return problems
}

/** Builds every channel's diagnostics from one read of the offers. */
export function diagnoseCatalog(input: {
  store: CatalogStore
  settings: SalesChannelSettings
  offers: readonly CatalogOffer[]
  partial: boolean
}): CatalogDiagnostics {
  const { store, settings, offers, partial } = input
  const storeLevel = storeProblems(store)
  const linkProblem = !store.origin || !store.productPagesServed
  const channels = SALES_CHANNELS.map((channel): ChannelDiagnostics => {
    const byProduct = new Map<string, ProductDiagnostic>()
    let listed = 0
    let excluded = 0
    let warned = 0
    for (const offer of offers) {
      const resolved = resolveOffer(offer, { channel, store, settings })
      // A store-wide problem is reported once, above, not on every product.
      const issues = linkProblem
        ? resolved.issues.filter((issue) => issue.field !== 'link')
        : resolved.issues
      if (resolved.included) listed += 1
      else excluded += 1
      if (resolved.included && issues.length) warned += 1
      if (!issues.length && resolved.included) continue
      const entry = byProduct.get(offer.productId) ?? {
        productId: offer.productId,
        productName: offer.productName,
        excludedOffers: 0,
        offers: 0,
        issues: [],
      }
      entry.offers += 1
      if (!resolved.included) entry.excludedOffers += 1
      for (const issue of issues) {
        if (!entry.issues.some((held) => held.field === issue.field && held.message === issue.message)) {
          entry.issues.push(issue)
        }
      }
      byProduct.set(offer.productId, entry)
    }
    const all = [...byProduct.values()].filter((entry) => entry.issues.length)
    // Left-out products first: they cost the merchant listings.
    all.sort(
      (a, b) =>
        Number(b.excludedOffers > 0) - Number(a.excludedOffers > 0) ||
        a.productName.localeCompare(b.productName),
    )
    return {
      channel: channel.id,
      listed,
      excluded,
      warned,
      products: all.slice(0, DIAGNOSTICS_MAX_PRODUCTS),
      truncated: all.length > DIAGNOSTICS_MAX_PRODUCTS,
    }
  })
  return { offers: offers.length, partial, store: storeLevel, channels }
}
