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
  CatalogOffer,
  CatalogShippingPrice,
  CatalogStore,
} from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import type { SalesChannelDefinition, SalesChannelId } from './channels'
import { isValidGtin } from './gtin'
import type { SalesChannelSettings } from './settings'

/**
 * ONE OFFER, AS ONE CHANNEL'S FEED STATES IT (AGL-3637).
 *
 * `resolveOffer` is the single place an offer becomes a feed row: the feed
 * route writes what it answers, and diagnostics report the issues it
 * raised, so what the console says is missing is exactly what the file
 * leaves out. Pure and client-safe.
 *
 * An offer is LEFT OUT of a channel's feed — an `error` — when the channel
 * would refuse it anyway: no photo, no price, a service or a
 * subscription-only product (shopping channels list goods sold once), or a
 * store whose product pages are not served. Everything else is a `warning`:
 * the row is sent with what the store has, and the channel may limit how it
 * shows.
 */

export type FeedIssueSeverity = 'error' | 'warning'

export interface FeedIssue {
  /** The attribute, in the channel's own name. */
  field: string
  severity: FeedIssueSeverity
  message: string
}

/** A row: attribute name to its value, or several values for a repeated one. */
export type FeedRow = Record<string, string | string[] | CatalogShippingPrice[]>

export interface ResolvedOffer {
  /** Whether the offer is in the feed. */
  included: boolean
  row: FeedRow
  issues: FeedIssue[]
}

export interface FeedContext {
  channel: SalesChannelDefinition
  store: CatalogStore
  settings: SalesChannelSettings
}

/** Each channel's attributes, in the order its file states them. */
export const FEED_COLUMNS: Readonly<Record<SalesChannelId, readonly string[]>> = {
  google: [
    'id', 'title', 'description', 'link', 'image_link', 'additional_image_link', 'availability',
    'price', 'sale_price', 'condition', 'brand', 'gtin', 'mpn', 'identifier_exists',
    'google_product_category', 'product_type', 'item_group_id', 'color', 'size', 'shipping_weight',
    'shipping_length', 'shipping_width', 'shipping_height', 'shipping',
  ],
  meta: [
    'id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link',
    'image_link', 'additional_image_link', 'brand', 'gtin', 'mpn', 'google_product_category',
    'product_type', 'item_group_id', 'color', 'size', 'quantity_to_sell_on_facebook',
    'shipping_weight', 'shipping',
  ],
  tiktok: [
    'sku_id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link',
    'image_link', 'additional_image_link', 'brand', 'gtin', 'mpn', 'google_product_category',
    'product_type', 'item_group_id', 'color', 'size', 'shipping_weight', 'shipping',
  ],
  pinterest: [
    'id', 'title', 'description', 'link', 'image_link', 'additional_image_link', 'price',
    'sale_price', 'availability', 'condition', 'brand', 'gtin', 'mpn', 'google_product_category',
    'product_type', 'item_group_id', 'color', 'size', 'shipping_weight', 'shipping',
  ],
  snapchat: [
    'id', 'title', 'description', 'link', 'image_link', 'additional_image_link', 'availability',
    'price', 'sale_price', 'condition', 'brand', 'gtin', 'mpn', 'google_product_category',
    'product_type', 'item_group_id', 'color', 'size',
  ],
  microsoft: [
    'id', 'title', 'link', 'price', 'description', 'image_link', 'additional_image_link',
    'availability', 'sale_price', 'condition', 'brand', 'gtin', 'mpn', 'identifier_exists',
    'product_category', 'product_type', 'item_group_id', 'color', 'size', 'shipping_weight',
    'shipping',
  ],
}

/** Per-channel limits, from each specification. */
const LIMITS: Readonly<Record<SalesChannelId, { title: number; description: number; images: number }>> = {
  google: { title: 150, description: 5000, images: 10 },
  meta: { title: 200, description: 9999, images: 20 },
  tiktok: { title: 150, description: 5000, images: 10 },
  pinterest: { title: 500, description: 10000, images: 10 },
  snapchat: { title: 150, description: 5000, images: 10 },
  microsoft: { title: 150, description: 5000, images: 10 },
}

/** A channel's word for each availability. */
function availabilityValue(channel: SalesChannelId, availability: CatalogOffer['availability']): string {
  if (channel === 'google') return availability
  if (availability === 'out_of_stock') return 'out of stock'
  if (availability === 'backorder') {
    if (channel === 'microsoft') return 'backorder'
    if (channel === 'tiktok') return 'available for order'
    // Meta, Pinterest and Snapchat have no backorder: the store takes the order.
    return 'in stock'
  }
  return 'in stock'
}

/** The digits after the point an amount in `currency` is written with. */
export function currencyExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/** `12.34 USD`: every channel's price format. */
export function formatFeedPrice(minor: number, currency: string): string {
  const exponent = currencyExponent(currency)
  const amount = Math.max(0, Math.round(minor)) / 10 ** exponent
  return `${amount.toFixed(exponent)} ${currency}`
}

/** Text cut at a word boundary to `max` characters. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The offer's absolute page URL, or undefined for a store with no address. */
export function offerLink(offer: CatalogOffer, store: CatalogStore): string | undefined {
  return store.origin ? `${store.origin}${encodeURI(offer.path)}` : undefined
}

/** A `A > B > C > D` path cut to its first `levels` levels; TikTok reads only three. */
export function firstLevels(path: string, levels: number): string {
  if (!path.includes('>')) return path
  return path
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, levels)
    .join(' > ')
}

const APPAREL = /^(166|1604|187|167|178|5322)$|^apparel/i

/** Resolves one offer for one channel's feed. */
export function resolveOffer(offer: CatalogOffer, context: FeedContext): ResolvedOffer {
  const { channel, store, settings } = context
  const id = channel.id
  const limits = LIMITS[id]
  const issues: FeedIssue[] = []
  const error = (field: string, message: string) => issues.push({ field, severity: 'error', message })
  const warn = (field: string, message: string) => issues.push({ field, severity: 'warning', message })

  const link = offerLink(offer, store)
  if (!link) error('link', 'The site has no web address yet, so the product has no page to link.')
  else if (!store.productPagesServed) {
    error('link', 'Product pages are not served: choose a product page template in the store’s settings.')
  }
  if (offer.kind === 'service') {
    error('product_type', 'Services are not listed on shopping channels.')
  }
  if (offer.subscriptionOnly) {
    error('price', 'Subscription-only products are not listed: shopping channels show a one-time price.')
  }
  if (!offer.imageUrl) error('image_link', 'Add a photo: every channel requires one.')
  if (!(offer.priceMinor > 0)) error('price', 'Set a price above zero.')

  const title = clip(offer.title, limits.title)
  if (offer.title.length > limits.title) {
    warn('title', `The name is longer than ${limits.title} characters and is shortened.`)
  }
  let description = offer.description
  if (!description) {
    warn('description', 'No description: the product’s name is sent instead.')
    description = offer.productName
  }
  description = clip(description, limits.description)

  const brand = offer.brand || settings.defaultBrand || store.name
  if (!brand) warn('brand', 'Add a brand, or a default brand for the store.')
  const condition = offer.condition ?? settings.defaultCondition
  const category = offer.googleProductCategory || settings.defaultGoogleCategory || ''

  let gtin = offer.gtin ?? ''
  if (gtin && !isValidGtin(gtin)) {
    warn('gtin', `GTIN ${gtin} has a wrong check digit and is not sent. Check the barcode.`)
    gtin = ''
  }
  const mpn = offer.mpn ?? ''
  const identified = Boolean(gtin) || Boolean(brand && mpn)
  if (!gtin && (id === 'google' || id === 'microsoft' || id === 'meta')) {
    warn(
      'gtin',
      mpn
        ? 'No GTIN: listed by brand and MPN. Add the barcode if the product has one.'
        : 'No GTIN or MPN: listed as a product without manufacturer identifiers. Add them if it has them.',
    )
  }
  if (APPAREL.test(category) && (!offer.color || !offer.size) && offer.hasVariants) {
    warn('size', 'Clothing needs a Color and a Size option for most channels to list it.')
  }
  // A country the checkout prices by a live carrier quote has no one price
  // to state: the channel's own carrier-calculated rates price it from the
  // weight and size below, so the feed leaves it to the channel.
  const carrierPriced = new Set(store.carrierPricedCountries ?? [])
  const shipping = offer.shipping.filter((entry) => !carrierPriced.has(entry.country))
  if (
    offer.kind === 'physical' &&
    !shipping.length &&
    !carrierPriced.size &&
    (id === 'google' || id === 'microsoft')
  ) {
    warn(
      'shipping',
      'No shipping rate reaches a named country, so no shipping is sent. Set shipping in the channel, or add a zone that names countries.',
    )
  }
  if (offer.kind === 'physical' && carrierPriced.size && id === 'google') {
    if (!offer.weightGrams) {
      warn('shipping_weight', 'Add a weight: carrier-calculated shipping is priced from it.')
    } else if (!offer.dimensionsCm) {
      warn('shipping_length', 'Add the packed size: carrier-calculated shipping is priced from it.')
    }
  }

  const price = formatFeedPrice(offer.priceMinor, store.currency)
  const onSale = offer.salePriceMinor !== undefined && offer.salePriceMinor < offer.priceMinor
  // Microsoft's sale price is a bare number in the store's currency.
  const salePrice = !onSale
    ? ''
    : id === 'microsoft'
      ? formatFeedPrice(offer.salePriceMinor as number, store.currency).split(' ')[0]
      : formatFeedPrice(offer.salePriceMinor as number, store.currency)
  const images = offer.additionalImageUrls.slice(0, limits.images)
  const row: FeedRow = {
    [id === 'tiktok' ? 'sku_id' : 'id']: offer.id,
    title,
    description,
    link: link ?? '',
    image_link: offer.imageUrl ?? '',
    additional_image_link: images,
    availability: availabilityValue(id, offer.availability),
    price,
    sale_price: salePrice,
    condition,
    brand,
    gtin,
    mpn,
    [id === 'microsoft' ? 'product_category' : 'google_product_category']:
      id === 'tiktok' ? firstLevels(category, 3) : category,
    product_type: id === 'tiktok' ? firstLevels(offer.productType ?? '', 3) : offer.productType ?? '',
    item_group_id: offer.hasVariants ? offer.groupId : '',
    color: offer.color ?? '',
    size: offer.size ?? '',
    shipping,
    shipping_weight: offer.weightGrams ? `${offer.weightGrams} g` : '',
  }
  if (id === 'google' && offer.dimensionsCm) {
    row['shipping_length'] = `${offer.dimensionsCm.length} cm`
    row['shipping_width'] = `${offer.dimensionsCm.width} cm`
    row['shipping_height'] = `${offer.dimensionsCm.height} cm`
  }
  if (id === 'google') row['identifier_exists'] = identified ? '' : 'no'
  if (id === 'microsoft') row['identifier_exists'] = identified ? '' : 'FALSE'
  if (id === 'meta' && offer.quantity !== null) {
    row['quantity_to_sell_on_facebook'] = String(offer.quantity)
  }
  return { included: !issues.some((issue) => issue.severity === 'error'), row, issues }
}
