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

/**
 * The marketplaces a store can sell on (AGL-3638), in words the console and
 * the server share. Client-safe: no credential, no server module.
 *
 * A marketplace connection does three things, each in the store's own
 * currency and from the store's own counts:
 *
 * - **Listings**: the quantity (and, where the merchant asks, the price) of
 *   every listing whose seller SKU matches an Aglyn product is kept in step
 *   with the store. Where the marketplace allows it, a product with no
 *   listing yet can be published there too.
 * - **Orders**: each paid order the marketplace takes becomes an Aglyn order,
 *   taking its units off the same shelf every other channel sells from.
 * - **Shipments**: when the merchant ships that order in Aglyn, the carrier
 *   and tracking number go back to the marketplace.
 */

export const MARKETPLACE_IDS = ['amazon', 'ebay', 'etsy', 'tiktok', 'walmart', 'faire'] as const
export type MarketplaceId = (typeof MARKETPLACE_IDS)[number]

export function isMarketplaceId(value: unknown): value is MarketplaceId {
  return typeof value === 'string' && (MARKETPLACE_IDS as readonly string[]).includes(value)
}

export interface MarketplaceInfo {
  label: string
  /** Whether the connection can publish a product that has no listing yet. */
  canPublish: boolean
  /** Whether the connection can send prices (Faire's are wholesale, so it cannot). */
  canSyncPrices: boolean
  /** What the marketplace calls a store's account there. */
  accountNoun: string
}

export const MARKETPLACES: Readonly<Record<MarketplaceId, MarketplaceInfo>> = {
  amazon: {
    label: 'Amazon',
    canPublish: true,
    canSyncPrices: true,
    accountNoun: 'Seller Central account',
  },
  ebay: {
    label: 'eBay',
    canPublish: true,
    canSyncPrices: true,
    accountNoun: 'eBay seller account',
  },
  etsy: {
    label: 'Etsy',
    canPublish: false,
    canSyncPrices: true,
    accountNoun: 'Etsy shop',
  },
  tiktok: {
    label: 'TikTok Shop',
    canPublish: false,
    canSyncPrices: true,
    accountNoun: 'TikTok Shop seller account',
  },
  walmart: {
    label: 'Walmart',
    canPublish: false,
    canSyncPrices: true,
    accountNoun: 'Walmart Marketplace account',
  },
  faire: {
    label: 'Faire',
    canPublish: false,
    canSyncPrices: false,
    accountNoun: 'Faire brand account',
  },
}

/** `{hostId}_{marketplace}`: one site's connection to one marketplace. */
export const marketplaceConnectionId = (hostId: string, marketplace: MarketplaceId): string => `${hostId}_${marketplace}`

export type MarketplaceConnectionStatus =
  /** Connected and syncing. */
  | 'active'
  /** Connected, stopped by the merchant: nothing is sent or read. */
  | 'paused'
  /** The grant is gone or was refused; the merchant connects again. */
  | 'reconnect'

/** What the listings half of a connection does. */
export type ListingMode =
  /** Nothing is sent to listings. Orders still come in. */
  | 'off'
  /** Listings whose seller SKU matches a product are kept in step. */
  | 'link'
  /** As `link`, and a product with no listing there is published (where the marketplace allows). */
  | 'publish'

export const LISTING_MODES: readonly ListingMode[] = ['off', 'link', 'publish']

/** The merchant's choices for one connection. */
export interface MarketplaceSettings {
  listingMode: ListingMode
  /** Whether prices are sent as well as quantities. */
  syncPrices: boolean
  /**
   * Percent added to (or, negative, taken off) the store's price on this
   * marketplace, for a merchant who prices in its fees: −50 to 200.
   */
  priceAdjustPercent: number
  /** Units of each product kept back from this marketplace, so a late sync cannot oversell the last ones. */
  stockBuffer: number
  /** What is offered for a product that does not count stock. */
  untrackedQuantity: number
  /** Whether the marketplace's orders come in as Aglyn orders. */
  importOrders: boolean
  /** Whether a shipment recorded in Aglyn is confirmed to the marketplace with its tracking. */
  confirmShipments: boolean
  /** Amazon: the marketplace listings and orders are for; others leave it empty. */
  marketplaceId: string | null
}

export const DEFAULT_SETTINGS: MarketplaceSettings = {
  listingMode: 'link',
  syncPrices: false,
  priceAdjustPercent: 0,
  stockBuffer: 0,
  untrackedQuantity: 10,
  importOrders: true,
  confirmShipments: true,
  marketplaceId: null,
}

export const PRICE_ADJUST_MIN = -50
export const PRICE_ADJUST_MAX = 200
export const STOCK_BUFFER_MAX = 1000
export const UNTRACKED_QUANTITY_MAX = 1000

/** A settings change from the console, checked field by field; an absent field is left as it is. */
export function readMarketplaceSettings(
  body: Record<string, unknown>,
): { ok: true; settings: Partial<MarketplaceSettings> & { paused?: boolean } } | { ok: false; error: string } {
  const settings: Partial<MarketplaceSettings> & { paused?: boolean } = {}
  const whole = (value: unknown, min: number, max: number) => {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value
    return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max ? number : null
  }
  if (body['listingMode'] !== undefined) {
    if (!LISTING_MODES.includes(body['listingMode'] as ListingMode)) return { ok: false, error: 'Choose what happens to listings' }
    settings.listingMode = body['listingMode'] as ListingMode
  }
  for (const key of ['syncPrices', 'importOrders', 'confirmShipments', 'paused'] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') return { ok: false, error: `${key} must be on or off` }
    settings[key] = body[key] as boolean
  }
  if (body['priceAdjustPercent'] !== undefined) {
    const value = whole(body['priceAdjustPercent'], PRICE_ADJUST_MIN, PRICE_ADJUST_MAX)
    if (value === null) return { ok: false, error: `The price adjustment is a whole percent from ${PRICE_ADJUST_MIN} to ${PRICE_ADJUST_MAX}` }
    settings.priceAdjustPercent = value
  }
  if (body['stockBuffer'] !== undefined) {
    const value = whole(body['stockBuffer'], 0, STOCK_BUFFER_MAX)
    if (value === null) return { ok: false, error: `Units kept back is a whole number from 0 to ${STOCK_BUFFER_MAX}` }
    settings.stockBuffer = value
  }
  if (body['untrackedQuantity'] !== undefined) {
    const value = whole(body['untrackedQuantity'], 0, UNTRACKED_QUANTITY_MAX)
    if (value === null) {
      return { ok: false, error: `The quantity for products without a stock count is a whole number from 0 to ${UNTRACKED_QUANTITY_MAX}` }
    }
    settings.untrackedQuantity = value
  }
  if (body['marketplaceId'] !== undefined) {
    const value = String(body['marketplaceId'] ?? '').trim()
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(value)) return { ok: false, error: 'Choose a marketplace from the menu' }
    settings.marketplaceId = value
  }
  return { ok: true, settings }
}

/** One of the marketplace's own sites (Amazon: amazon.com, amazon.ca …) a seller account sells on. */
export interface MarketplaceSite {
  id: string
  name: string
  /** ISO 4217, upper case, when the marketplace said. */
  currency?: string | null
}

/** How the last listing sync went. */
export interface ListingSyncSummary {
  syncedAtMs: number | null
  /** Products the store offered this marketplace. */
  offers: number
  /** Listings whose quantity or price was sent. */
  updated: number
  /** Listings published by this connection. */
  created: number
  /** Listings already saying what the store says. */
  unchanged: number
  /** Products with no listing there (and none published). */
  notListed: number
  /** Listings the marketplace refused. */
  failed: number
}

export const EMPTY_LISTING_SUMMARY: ListingSyncSummary = {
  syncedAtMs: null,
  offers: 0,
  updated: 0,
  created: 0,
  unchanged: 0,
  notListed: 0,
  failed: 0,
}

/** The console's view of a connection: never a credential, a lease or a cursor. */
export interface MarketplaceConnectionView {
  id: string
  marketplace: MarketplaceId
  hostId: string
  status: MarketplaceConnectionStatus
  sandbox: boolean
  accountName: string | null
  settings: MarketplaceSettings
  /** Amazon: the marketplaces the seller account sells on. */
  sites: MarketplaceSite[]
  listings: ListingSyncSummary
  orders: { imported: number; skipped: number; lastImportedAtMs: number | null }
  shipments: { confirmed: number; failed: number }
  lastError: string | null
  connectedAtMs: number | null
}

/** One listing a merchant should look at: a refusal, or a product with no listing. */
export interface ListingProblemView {
  offerId: string
  sku: string
  title: string
  outcome: 'failed' | 'not_listed'
  message: string | null
  atMs: number
}

export type MarketplaceLogKind =
  | 'connected'
  | 'listings'
  | 'order_imported'
  | 'order_skipped'
  | 'order_canceled'
  | 'shipment_confirmed'
  | 'error'

export interface MarketplaceLogEntry {
  id: string
  atMs: number
  kind: MarketplaceLogKind
  message: string
}

/** Where one Aglyn order stands with the marketplace it came from. */
export interface MarketplaceOrderView {
  marketplace: MarketplaceId
  externalOrderId: string
  displayRef: string
  sandbox: boolean
  /** What the marketplace charged the merchant for the sale, in the order's currency; `null` until known. */
  fees: Array<{ label: string; amountMinor: number }> | null
  feesTotalMinor: number | null
  currency: string
  shipments: Array<{
    fulfillmentId: string
    trackingNumber: string | null
    carrier: string | null
    state: 'pending' | 'confirmed' | 'failed'
    message: string | null
    atMs: number
  }>
}
