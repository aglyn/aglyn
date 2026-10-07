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
  CatalogPage,
  CatalogShippingPrice,
  CatalogStore,
  PluginProductCatalog,
} from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { liveCustomDomain } from '@aglyn/aglyn/app-utils/host-naming'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import * as CommerceModel from '../model'

/**
 * THE STORE'S CATALOG, AS OTHER PLUGINS READ IT (AGL-3637): core's
 * `core.product-catalog` contract, answered from this plugin's products.
 *
 * A shopping-channel feed, an ad catalog and a marketplace sync read every
 * offer the store sells through here and never through `hosts/{id}/products`.
 * What counts as listed, how a variant becomes an offer, what the store's
 * currency is and what shipping costs are this plugin's decisions, made once:
 *
 *  - Listed is `status: 'active'` and not soft-deleted. Drafts, archived and
 *    deleted products are never offered.
 *  - A product with one configuration is one offer under the product's own
 *    id — the id the site's analytics events already send — and a product
 *    with several is one offer per variant, `{productId}_{variantId}`.
 *  - A variant on sale (`compareAtPriceUsd` above `priceUsd`) offers the
 *    compare-at price as its price and its own as the sale price.
 *  - Shipping is priced per country the store's zones name, for one unit of
 *    the offer, through the same resolver checkout charges with; local pickup
 *    is not shipping and a `*` zone names no country.
 *
 * Walked in document-id order, so a page boundary is stable while products
 * are added and edited, and a product is never split across two pages.
 */

type Firestore = FirebaseFirestore.Firestore
type DocumentData = FirebaseFirestore.DocumentData

const MAX_PRODUCTS_PER_READ = 200
/** Google's ceiling; the longest any channel accepts for every channel's id. */
const MAX_OFFER_ID = 50

const firestore = (): Firestore => firebaseAdmin.app().firestore()

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Plain text from a description that may hold markup. */
export function plainDescription(value: unknown): string {
  return str(value)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

const toMinor = (amount: unknown): number => {
  const number = Number(amount)
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : 0
}

/** The origin the store's pages answer on: its live custom domain, else its subdomain. */
export function storeOrigin(host: DocumentData | undefined): string | null {
  const domain = liveCustomDomain(host as Parameters<typeof liveCustomDomain>[0])
  if (domain) return `https://${domain}`
  const subdomain = str(host?.['subdomain']).trim()
  return subdomain ? `https://${subdomain}.${TENANT_APEX}` : null
}

/** An absolute URL for a stored media reference, or undefined. */
function absoluteImage(url: unknown, origin: string | null): string | undefined {
  const value = str(url).trim()
  if (!value) return undefined
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('/') && origin) return `${origin}${value}`
  return undefined
}

/** A stable offer id within the longest any channel accepts. */
export function offerId(productId: string, variantId: string, hasVariants: boolean): string {
  if (!hasVariants) return productId.slice(0, MAX_OFFER_ID)
  const full = `${productId}_${variantId}`
  if (full.length <= MAX_OFFER_ID) return full
  // Deterministic, so the id is the same on every read.
  let hash = 0
  for (const char of full) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0
  const suffix = (hash >>> 0).toString(36)
  return `${productId.slice(0, MAX_OFFER_ID - suffix.length - 1)}_${suffix}`
}

const COLOR_OPTION = /^(colou?r|shade|finish)$/i
const SIZE_OPTION = /^(size|fit)$/i

function optionValue(options: Record<string, string>, pattern: RegExp): string | undefined {
  for (const [name, value] of Object.entries(options)) {
    if (pattern.test(name.trim()) && value) return value
  }
  return undefined
}

/** The category path `Parent > Child` for a product's first category. */
function categoryPath(
  categoryIds: readonly string[] | undefined,
  categories: ReadonlyMap<string, CommerceModel.ProductCategory>,
): string | undefined {
  const first = (categoryIds ?? []).find((id) => categories.has(id))
  if (!first) return undefined
  const names: string[] = []
  const seen = new Set<string>()
  let at: string | null | undefined = first
  while (at && !seen.has(at) && categories.has(at) && names.length < 5) {
    seen.add(at)
    const category: CommerceModel.ProductCategory = categories.get(at)!
    if (category.name) names.unshift(category.name)
    at = category.parentId
  }
  return names.length ? names.join(' > ') : undefined
}

/** The specific countries the store's shipping zones name, in order, upper case. */
function shippingCountries(settings: CommerceModel.ShippingSettings | undefined): string[] {
  const countries = new Set<string>()
  for (const zone of settings?.zones ?? []) {
    for (const code of zone.countries ?? []) {
      const country = String(code ?? '').trim().toUpperCase()
      if (/^[A-Z]{2}$/.test(country)) countries.add(country)
    }
  }
  return [...countries].slice(0, 100)
}

/** The countries the store's zones price by a live carrier quote, upper case. */
export function carrierPricedCountries(
  settings: CommerceModel.ShippingSettings | undefined,
  countries: readonly string[],
): string[] {
  if (!CommerceModel.hasCarrierRates(settings)) return []
  return countries.filter((country) => CommerceModel.carrierRatesFor(settings, country).length > 0)
}

/** The packed size of one unit, when every side is known. */
function dimensionsOf(product: CommerceModel.HostProduct): CatalogOffer['dimensionsCm'] {
  const facts = CommerceModel.normalizeProductShippingFacts(product.shipping)
  if (!facts?.lengthCm || !facts.widthCm || !facts.heightCm) return undefined
  return { length: facts.lengthCm, width: facts.widthCm, height: facts.heightCm }
}

/** What one unit of an offer costs to ship to each country, the cheapest rate each. */
export function offerShipping(
  settings: CommerceModel.ShippingSettings | undefined,
  countries: readonly string[],
  unit: { priceMinor: number; weightGrams?: number },
): CatalogShippingPrice[] {
  const prices: CatalogShippingPrice[] = []
  for (const country of countries) {
    const [cheapest] = CommerceModel.resolveShippingRates(settings, country, {
      subtotalCents: unit.priceMinor,
      totalGrams: unit.weightGrams ?? 0,
    }).filter((rate) => rate.rateId !== CommerceModel.LOCAL_PICKUP_RATE_ID)
    if (cheapest) prices.push({ country, service: cheapest.name, priceMinor: cheapest.amountCents })
  }
  return prices
}

interface PageContext {
  origin: string | null
  categories: ReadonlyMap<string, CommerceModel.ProductCategory>
  shipping: CommerceModel.ShippingSettings | undefined
  countries: readonly string[]
}

/** The offers of one stored product; empty for a product that is not listed. */
export function productOffers(productId: string, raw: DocumentData, context: PageContext): CatalogOffer[] {
  if (!raw || raw['deletedAt']) return []
  const product = CommerceModel.liftLegacyProduct(raw as CommerceModel.HostProduct)
  if (product.status !== 'active' || !str(product.name).trim() || !str(product.slug)) return []
  const variants = (product.variants ?? []).filter((variant) => variant && str(variant.id))
  if (!variants.length) return []
  const hasVariants = variants.length > 1
  const facts = CommerceModel.normalizeProductChannelFacts(product.channel)
  const media = [...(product.mediaUrls ?? []), ...(product.imageUrl ? [product.imageUrl] : [])]
    .map((url) => absoluteImage(url, context.origin))
    .filter((url): url is string => Boolean(url))
  const description = plainDescription(product.description)
  const productType = categoryPath(product.categoryIds, context.categories)
  const subscriptionOnly = Boolean(product.subscription) && product.subscriptionOptional !== true
  const updatedAtMs = Number(product.updatedAtMs ?? product.createdAtMs) || undefined
  const dimensionsCm = (product.type ?? 'physical') === 'physical' ? dimensionsOf(product) : undefined
  return variants.map((variant) => {
    const options = Object.fromEntries(
      Object.entries(variant.options ?? {}).filter(([, value]) => typeof value === 'string' && value),
    ) as Record<string, string>
    const choices = (product.options ?? [])
      .map((option) => options[option.name])
      .filter((value): value is string => Boolean(value))
    const ownPrice = toMinor(variant.priceUsd)
    const compareAt = toMinor(variant.compareAtPriceUsd)
    const onSale = compareAt > ownPrice && ownPrice > 0
    const priceMinor = onSale ? compareAt : ownPrice
    const tracked = CommerceModel.stockTrackingApplies(product) && variant.inventory != null
    const quantity = tracked ? Math.max(0, Math.trunc(Number(variant.inventory) || 0)) : null
    const availability: CatalogOffer['availability'] =
      quantity === null || quantity > 0
        ? 'in_stock'
        : product.oversellPolicy === 'backorder'
          ? 'backorder'
          : 'out_of_stock'
    const variantImage = absoluteImage(variant.imageUrl, context.origin)
    const imageUrl = variantImage ?? media[0]
    const weightGrams = Number(variant.weightGrams) > 0 ? Math.round(Number(variant.weightGrams)) : undefined
    const gtin = CommerceModel.normalizeGtin(variant.barcode) || (hasVariants ? '' : facts?.gtin ?? '')
    const offer: CatalogOffer = {
      id: offerId(productId, variant.id, hasVariants),
      groupId: productId,
      hasVariants,
      productId,
      variantId: variant.id,
      productName: product.name.trim(),
      title: choices.length ? `${product.name.trim()} - ${choices.join(' / ')}` : product.name.trim(),
      description,
      path: `/products/${product.slug}`,
      ...(imageUrl ? { imageUrl } : {}),
      additionalImageUrls: media.filter((url) => url !== imageUrl).slice(0, 10),
      priceMinor,
      ...(onSale ? { salePriceMinor: ownPrice } : {}),
      availability,
      quantity,
      kind: product.type ?? 'physical',
      subscriptionOnly,
      ...(facts?.condition ? { condition: facts.condition } : {}),
      ...(facts?.brand ? { brand: facts.brand } : {}),
      ...(gtin.length >= 8 ? { gtin } : {}),
      ...(facts?.mpn ? { mpn: facts.mpn } : {}),
      ...(facts?.googleProductCategory ? { googleProductCategory: facts.googleProductCategory } : {}),
      ...(productType ? { productType } : {}),
      options,
      ...(optionValue(options, COLOR_OPTION) ? { color: optionValue(options, COLOR_OPTION) } : {}),
      ...(optionValue(options, SIZE_OPTION) ? { size: optionValue(options, SIZE_OPTION) } : {}),
      ...(weightGrams ? { weightGrams } : {}),
      ...(dimensionsCm ? { dimensionsCm } : {}),
      shipping:
        (product.type ?? 'physical') === 'physical'
          ? offerShipping(context.shipping, context.countries, {
              priceMinor: onSale ? ownPrice : priceMinor,
              ...(weightGrams ? { weightGrams } : {}),
            })
          : [],
      ...(updatedAtMs ? { updatedAtMs } : {}),
    }
    return offer
  })
}

async function readStore(hostId: string) {
  const hostRef = firestore().collection('hosts').doc(hostId)
  const [host, store] = await Promise.all([hostRef.get(), hostRef.collection('settings').doc('store').get()])
  return { host, store }
}

async function readCategories(hostId: string): Promise<Map<string, CommerceModel.ProductCategory>> {
  const snapshot = await firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('productCategories')
    .limit(500)
    .get()
  return new Map(
    snapshot.docs.map((doc) => [doc.id, doc.data() as CommerceModel.ProductCategory] as const),
  )
}

const isDocumentId = (value: string) =>
  Boolean(value) && value.length <= 200 && !value.includes('/') && !/^__.*__$/.test(value)

export const productCatalog: PluginProductCatalog = {
  async store(hostId: string): Promise<CatalogStore | null> {
    if (!isDocumentId(hostId)) return null
    const { host, store } = await readStore(hostId)
    if (!host.exists) return null
    const data = host.data() ?? {}
    const settings = store.data() ?? {}
    const origin = storeOrigin(data)
    const shipping = settings['shipping'] as CommerceModel.ShippingSettings | undefined
    const name =
      str(data['displayName']).trim() ||
      (origin ? origin.replace(/^https?:\/\//, '') : '') ||
      'Store'
    return {
      hostId,
      name,
      origin,
      currency: str(settings['currency']).trim().toUpperCase() || 'USD',
      productPagesServed: Boolean(str(settings['pdpScreenId'])),
      carrierPricedCountries: carrierPricedCountries(shipping, shippingCountries(shipping)),
    }
  },

  async page({ hostId, cursor, limit }): Promise<CatalogPage> {
    if (!isDocumentId(hostId)) return { offers: [], nextCursor: null }
    const want = Math.max(1, Math.min(Math.trunc(limit) || 1, 1000))
    const [{ host, store }, categories] = await Promise.all([readStore(hostId), readCategories(hostId)])
    if (!host.exists) return { offers: [], nextCursor: null }
    const shipping = store.get('shipping') as CommerceModel.ShippingSettings | undefined
    const context: PageContext = {
      origin: storeOrigin(host.data()),
      categories,
      shipping,
      countries: shippingCountries(shipping),
    }
    const products = firestore().collection('hosts').doc(hostId).collection('products')
    const idPath = firebaseAdmin.firestore.FieldPath.documentId()
    const offers: CatalogOffer[] = []
    let after = cursor && isDocumentId(cursor) ? cursor : null
    // Reads products until the page holds `want` offers or the catalog ends.
    // Drafts and archived products are read and skipped, so a store of many
    // drafts may take more than one read for a page.
    for (;;) {
      let query = products.orderBy(idPath).limit(MAX_PRODUCTS_PER_READ)
      if (after) query = query.startAfter(after)
      const snapshot = await query.get()
      for (const doc of snapshot.docs) {
        offers.push(...productOffers(doc.id, doc.data(), context))
        after = doc.id
        if (offers.length >= want) {
          const last = snapshot.docs[snapshot.docs.length - 1]
          // The page is full: continue after this product, unless it was the
          // last of a short read, which is the end of the catalog.
          const ended = doc.id === last.id && snapshot.size < MAX_PRODUCTS_PER_READ
          return { offers, nextCursor: ended ? null : doc.id }
        }
      }
      if (snapshot.size < MAX_PRODUCTS_PER_READ) return { offers, nextCursor: null }
    }
  },
}
