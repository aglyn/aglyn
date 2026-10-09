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

import type { MarketplaceId, MarketplaceSite } from '../model/marketplaces'

/**
 * What every marketplace adapter does (AGL-3638), each marketplace's words
 * translated once, so the engine never branches on which one it talks to.
 *
 * Every adapter is built with a {@link ProviderHttp} (`providers/http.ts`)
 * and makes every call through `providerRequest`, which turns each failure
 * into a `ProviderError` whose kind decides what the engine does next. An
 * adapter never logs a token, a body or an address.
 *
 * MONEY IS INTEGER MINOR UNITS (cents for USD) in the currency named beside
 * it. An adapter converts a marketplace's decimal strings with
 * {@link toMinor} and back with {@link fromMinor}, never with float math.
 */

/** The deployment's registration with one marketplace, read from env on the console. */
export interface MarketplaceApp {
  clientId: string
  clientSecret: string
  /** Whether connections go to the marketplace's sandbox, where nothing real sells. */
  sandbox: boolean
  /**
   * What else the marketplace's registration needs, by name: Amazon's
   * `applicationId`, `region` (`na`/`eu`/`fe`) and `draft`; eBay's `ruName`;
   * TikTok Shop's `serviceId`.
   */
  extra: Readonly<Record<string, string>>
}

/** Where the grant's account lives: what each marketplace keys its calls by. */
export interface MarketplaceAccountRef {
  /** Amazon's selling partner id; Walmart's seller id; Faire's brand id. */
  sellerId?: string | null
  /** Etsy's shop id; TikTok Shop's shop id. */
  shopId?: string | null
  /** TikTok Shop's shop cipher, which every shop-scoped call carries. */
  shopCipher?: string | null
  /** Amazon: the marketplace listings and orders are for (e.g. `ATVPDKIKX0DER`). */
  marketplaceId?: string | null
  /** Etsy: the user id the token was issued for. */
  userId?: string | null
}

/** An opened grant, for one run. */
export interface MarketplaceCredential {
  accessToken: string
  account: MarketplaceAccountRef
}

/** What a code exchange or a refresh answers. */
export interface MarketplaceGrant {
  accessToken: string
  /** `null` when the marketplace issued none (the old one keeps working). */
  refreshToken: string | null
  expiresAtMs: number | null
  /** When the refresh token itself stops working, where the marketplace says (eBay, TikTok). */
  refreshExpiresAtMs?: number | null
  /** What the exchange itself revealed about the account (Amazon's `selling_partner_id`, Etsy's user id). */
  account?: MarketplaceAccountRef
}

/** What a connect reads about the account a fresh grant reaches. */
export interface MarketplaceAccount {
  /** What the merchant calls it: their shop's or seller account's name. */
  accountName: string | null
  account: MarketplaceAccountRef
  /** Amazon: the marketplaces the seller sells on. */
  sites?: MarketplaceSite[]
}

/** One product offer the store asks a marketplace to list, as it should read there. */
export interface ListingPush {
  /** The store's offer id (product, or product and variant). */
  offerId: string
  /** The seller SKU the listing is matched by. */
  sku: string
  /** The product's id: what variants of one product share (a listing group). */
  groupId: string
  title: string
  /** Plain text. */
  description: string
  /** The price to show there, after the merchant's adjustment. */
  priceMinor: number
  /** ISO 4217, upper case. */
  currency: string
  /** Units to offer there, after the merchant's buffer. Never negative. */
  quantity: number
  imageUrls: string[]
  /** Absolute URL of the product's page on the store. */
  productUrl: string | null
  gtin?: string
  brand?: string
  mpn?: string
  condition?: 'new' | 'refurbished' | 'used'
  weightGrams?: number
  dimensionsCm?: { length: number; width: number; height: number }
  /** The configuration's choices, by option name. */
  options: Readonly<Record<string, string>>
  /** What the marketplace answered for this listing last time, when it said (its listing id). */
  externalId?: string | null
}

export type ListingOutcome =
  /** The listing's quantity (and price, when asked) now say what the store says. */
  | 'updated'
  /** A listing was published for it. */
  | 'created'
  /** The marketplace has no listing under this SKU, and none was published. */
  | 'not_listed'
  /** The marketplace refused; `message` says why in its own words. */
  | 'failed'

export interface ListingResult {
  sku: string
  outcome: ListingOutcome
  /** The marketplace's id for the listing, to be handed back next time. */
  externalId?: string | null
  message?: string | null
}

export interface ListingSyncOptions {
  /** Publish a listing for a SKU the marketplace has none for (only asked of an adapter whose `canPublish`). */
  publish: boolean
  /** Send prices as well as quantities. */
  prices: boolean
}

/** The address a marketplace order ships to, as the marketplace gave it. */
export interface MarketplaceAddress {
  name: string | null
  line1: string | null
  line2?: string | null
  city: string | null
  state?: string | null
  postalCode: string | null
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null
  phone?: string | null
}

/** One line of a marketplace order. */
export interface MarketplaceOrderLine {
  /** The marketplace's id for the line, which a shipment confirmation names. */
  externalLineId: string
  /** The seller SKU; `null` when the marketplace gave none. */
  sku: string | null
  title: string
  quantity: number
  /** Per unit, before tax, in the order's currency. */
  unitPriceMinor: number
}

/** A marketplace's charge on a sale: its commission, a payment fee, a listing fee. */
export interface MarketplaceFee {
  label: string
  amountMinor: number
}

/** Where a marketplace order stands. */
export type MarketplaceOrderState =
  /** Not yet paid or not yet released to the seller (Amazon `Pending`): left until it is. */
  | 'pending'
  /** Paid, the merchant's to ship. */
  | 'unshipped'
  /** Shipped (some or all of it), by whoever shipped it. */
  | 'shipped'
  /** Canceled by the buyer or the marketplace. */
  | 'canceled'

export interface MarketplaceOrder {
  externalId: string
  /** What the merchant sees on the marketplace: `113-1234567-1234567`, `#2741`. */
  displayRef: string
  state: MarketplaceOrderState
  /**
   * The marketplace ships it from its own warehouse (Amazon FBA, Walmart
   * WFS): it never touches the store's shelf and is not imported.
   */
  fulfilledByMarketplace: boolean
  placedAtMs: number
  updatedAtMs: number
  /** ISO 4217, upper case. */
  currency: string
  lines: MarketplaceOrderLine[]
  shippingMinor: number
  /** Tax the marketplace collected (and remits, as the marketplace facilitator). */
  taxMinor: number
  discountMinor: number
  /** What the buyer paid in all. */
  totalMinor: number
  /** What the marketplace charged the merchant for the sale; `null` when the order does not say yet. */
  fees: MarketplaceFee[] | null
  buyerName: string | null
  shipTo: MarketplaceAddress | null
  /** Whether the order was placed in the marketplace's sandbox. */
  testMode?: boolean
}

export interface MarketplaceOrderPage {
  orders: MarketplaceOrder[]
  /** Hand back to continue the same query; `null` on the last page. */
  nextCursor: string | null
}

export interface MarketplaceOrderQuery {
  /** Orders changed at or after this instant (epoch ms). */
  sinceMs: number
  /** From a previous page of the same query. */
  cursor: string | null
}

/** A shipment the merchant recorded in Aglyn, to confirm to the marketplace. */
export interface ShipmentConfirmation {
  externalOrderId: string
  /** What is in the parcel, by the marketplace's line ids. */
  lines: Array<{ externalLineId: string; quantity: number }>
  /** The carrier as the merchant named it (`UPS`, `USPS`, `FedEx` …), mapped by the adapter. */
  carrier: string | null
  trackingNumber: string
  trackingUrl: string | null
  /**
   * What the seller paid to ship the parcel, in integer minor units of the
   * order's currency (AGL-3693); `null` when not known. Sent only where the
   * marketplace takes it (Faire's `maker_cost_cents`); Amazon, eBay, Etsy,
   * TikTok Shop and Walmart have no field for it on a shipment.
   */
  shippingCostMinor?: number | null
  shippedAtMs: number
  /** Ours, stable per shipment: what an adapter dedupes on where the marketplace takes one. */
  reference: string
}

export type ShipmentOutcome = 'confirmed' | 'already'

export interface MarketplaceProvider {
  id: MarketplaceId
  /** The consent page the merchant's browser is sent to. `codeChallenge` is PKCE S256, for those that use it. */
  authorizeUrl(app: MarketplaceApp, input: { redirectUri: string; state: string; codeChallenge: string }): string
  /**
   * Trades what the consent page sent back for a grant. `params` is every
   * parameter the redirect carried (Amazon's `selling_partner_id` among
   * them); `codeVerifier` is PKCE's.
   */
  exchangeCode(
    app: MarketplaceApp,
    input: { code: string; redirectUri: string; codeVerifier: string; params: URLSearchParams; nowMs: number },
  ): Promise<MarketplaceGrant>
  /** Trades a refresh token for a fresh access token. */
  refresh(app: MarketplaceApp, input: { refreshToken: string; nowMs: number }): Promise<MarketplaceGrant>
  /** Reads the account a fresh grant reaches, with the ids every later call is keyed by. */
  account(app: MarketplaceApp, credential: MarketplaceCredential): Promise<MarketplaceAccount>
  /**
   * Brings each listing in line with its push, batching as the marketplace
   * allows. One result per push, in order. A SKU the marketplace has no
   * listing for is `not_listed` unless `options.publish` asked for one and
   * the adapter can publish.
   */
  syncListings(
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    pushes: readonly ListingPush[],
    options: ListingSyncOptions,
  ): Promise<ListingResult[]>
  /** One page of orders changed since `sinceMs`, oldest change first where the marketplace sorts. */
  listOrders(app: MarketplaceApp, credential: MarketplaceCredential, query: MarketplaceOrderQuery): Promise<MarketplaceOrderPage>
  /**
   * Tells the marketplace the seller took the order, where it must hear
   * that before the order may ship (Walmart's acknowledge, Faire's accept).
   * Answered again for an order already taken, without error.
   */
  acknowledgeOrder?(app: MarketplaceApp, credential: MarketplaceCredential, order: MarketplaceOrder): Promise<void>
  /** Confirms a shipment with its tracking. `already` when the marketplace has it. */
  confirmShipment(
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    confirmation: ShipmentConfirmation,
  ): Promise<ShipmentOutcome>
  /**
   * What the marketplace charged for one order, where the order itself does
   * not say and another API does (Amazon's Finances API). `null` while it is
   * not known yet.
   */
  orderFees?(app: MarketplaceApp, credential: MarketplaceCredential, externalOrderId: string): Promise<MarketplaceFee[] | null>
}

/**
 * A marketplace's decimal amount (`"12.30"`, `12.3`) in integer minor units,
 * by string arithmetic so `0.1 + 0.2` never reaches a price. `null` for
 * anything that is not a finite amount. `decimals` is the
 * currency's minor-unit count: 2 for most, 0 for JPY.
 */
export function toMinor(value: unknown, decimals = 2): number | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(decimals) : '') : String(value ?? '').trim()
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return null
  const fraction = (match[3] ?? '').padEnd(decimals + 1, '0')
  const whole = Number(match[2]) * 10 ** decimals + Number(fraction.slice(0, decimals) || '0')
  // Round half up on the first dropped digit.
  const rounded = whole + (Number(fraction[decimals] ?? '0') >= 5 ? 1 : 0)
  return match[1] ? -rounded : rounded
}

/** Integer minor units as the decimal string a marketplace takes: `1230` → `"12.30"`. */
export function fromMinor(minor: number, decimals = 2): string {
  const value = Math.round(Number(minor) || 0)
  const sign = value < 0 ? '-' : ''
  const digits = String(Math.abs(value)).padStart(decimals + 1, '0')
  return decimals === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

/** The minor-unit count of an ISO 4217 currency, for the handful that are not 2. */
export function currencyDecimals(currency: string): number {
  const code = String(currency ?? '').toUpperCase()
  if (['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD'].includes(code)) return 0
  if (['BHD', 'KWD', 'OMR', 'JOD', 'TND'].includes(code)) return 3
  return 2
}

/** Epoch ms of an ISO date or epoch seconds, or `null`. */
export function timeMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/** A trimmed string, or `null` for anything empty. */
export const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null
