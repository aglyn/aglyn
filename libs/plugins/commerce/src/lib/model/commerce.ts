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
 * Commerce catalog v1 (AGL-276): products with options/variants,
 * hierarchical categories, tags, and manual/smart collections. Pure
 * model + helpers — no I/O; the products hub and storefront APIs operate
 * over these shapes. Documents live under `hosts/{hostId}/products`,
 * `.../productCategories`, and `.../collections`; the legacy Commerce
 * Starter product doc (AGL-90: name/priceUsd/inventory) lifts into this
 * shape via `liftLegacyProduct`, so existing docs keep working.
 */

/**
 * Platform fee on tenant-site product sales (Commerce Starter, AGL-90) —
 * the tenant sells to their own visitors through their connected account,
 * so the platform takes a processing/management share only. (Relocated
 * from app-utils/community.ts, where it was misfiled — AGL-411.)
 */
export const COMMERCE_PLATFORM_FEE_PERCENT = 2
/** Product price ceiling (whole USD). */
export const COMMERCE_MAX_PRICE_USD = 10000

export type ProductType = 'physical' | 'digital' | 'service'
export type ProductStatus = 'draft' | 'active' | 'archived'

/** One axis of variation, e.g. { name: 'Size', values: ['S','M','L'] }. */
export interface ProductOption {
  name: string
  values: string[]
}

/** A sellable configuration of a product (every product has ≥ 1). */
export interface ProductVariant {
  /** Stable id unique within the product (never reused after delete). */
  id: string
  /** Option selections keyed by option name; {} for the default variant. */
  options?: Record<string, string>
  sku?: string
  barcode?: string
  priceUsd: number
  /** Strike-through price; a sale badge shows when > priceUsd. */
  compareAtPriceUsd?: number
  weightGrams?: number
  /** null/undefined = untracked; 0 = sold out (matches AGL-96). */
  inventory?: number | null
  /**
   * Per-location stock (AGL-286); `inventory` stays the summed
   * denormalization. Absent = single default location.
   */
  inventoryByLocation?: Record<string, number>
  /** Media-library image URL shown when this variant is selected. */
  imageUrl?: string
}

/** `hosts/{hostId}/locations/{id}` doc (AGL-286). */
export interface InventoryLocation {
  name: string
  isDefault?: boolean
  address?: string
}

/**
 * `hosts/{hostId}/registers/{id}` doc (AGL-472): a named point-of-sale
 * register. Creation is capped by the plan's `posRegisters` quota (Pro 1,
 * Business 2, Advanced 5; raised by a per-org entitlement override for the
 * $89/mo add-on), enforced server-side by the resources route. Each POS
 * sale stamps its `registerId` so takings are attributable per register.
 */
export interface PosRegister {
  name: string
  /** Optional default inventory location this register sells from. */
  locationId?: string
}

/**
 * The register ids within the plan's `posRegisters` cap (AGL-482), ranked
 * by creation order — the same ordering `pos-order.ts` enforces at sale
 * time. Registers beyond the cap (e.g. after a Business→Pro downgrade) are
 * excluded so the console/POS can dim or hide them instead of surfacing a
 * checkout 403. `cap` of `Infinity` returns all.
 */
export function registersWithinCap(
  registers: Array<{ $id: string; createdAt?: any }>,
  cap: number,
): Set<string> {
  const createdMs = (r: { createdAt?: any }) =>
    r.createdAt?.toMillis?.() ?? r.createdAt?.seconds ?? 0
  const ranked = [...registers].sort(
    (a, b) => createdMs(a) - createdMs(b) || a.$id.localeCompare(b.$id),
  )
  return new Set(ranked.slice(0, Math.max(0, cap)).map((r) => r.$id))
}

/**
 * `hosts/{hostId}/suppliers/{id}` doc (AGL-289): where dropshipped
 * order lines route on payment. Email and webhook are both optional but
 * one must be set for routing to do anything; webhook payloads are
 * HMAC-SHA256-signed with `webhookSecret`.
 */
export interface HostSupplier {
  name: string
  email?: string
  webhookUrl?: string
  webhookSecret?: string
}

/** `hosts/{hostId}/products/{id}` doc. */
export interface HostProduct {
  name: string
  /** Host-unique URL segment for /products/{slug}. */
  slug: string
  description?: string
  type: ProductType
  status: ProductStatus
  /** Ordered media-library image URLs (first = primary). */
  mediaUrls?: string[]
  categoryIds?: string[]
  tags?: string[]
  options?: ProductOption[]
  variants: ProductVariant[]
  /** Per-product overrides for PDP meta tags (AGL-299 consumes). */
  seo?: { title?: string; description?: string; imageUrl?: string }
  /** Supplier for dropship routing (AGL-289). */
  supplierId?: string
  /** Out-of-stock behavior (AGL-281): deny (default) or allow backorder. */
  oversellPolicy?: 'deny' | 'backorder'
  /** Never taxed regardless of tax settings (AGL-285). */
  taxExempt?: boolean
  /**
   * Digital delivery (AGL-302): downloadable files for `digital`
   * products. Buyers always download the CURRENT list, so uploading a
   * new version re-delivers to everyone.
   */
  digitalFiles?: Array<{ url: string; fileName: string; version?: string }>
  /** Max download attempts per order line; absent = unlimited. */
  downloadLimit?: number
  /**
   * Recurring billing (AGL-303): buyers subscribe instead of buying
   * once; an active subscription is the entitlement content gating
   * checks (AGL-309).
   */
  subscription?: { interval: 'month' | 'year'; trialDays?: number }
  /** Members-only videos (AGL-315), streamed via short-TTL links. */
  gatedVideos?: Array<{ url: string; title?: string }>
  /** Manual related products for the upsell block (AGL-325). */
  relatedProductIds?: string[]
  /** Buying this issues a gift-card code for its price (AGL-322). */
  giftCard?: boolean
  /** Tracked-total at/below this alerts host managers (AGL-281). */
  lowStockThreshold?: number
  createdAtMs?: number
  updatedAtMs?: number
  deletedAt?: number | null
  /** Legacy Commerce Starter fields kept so old docs read back (AGL-90). */
  priceUsd?: number
  inventory?: number | null
  imageUrl?: string
}

/** `hosts/{hostId}/productCategories/{id}` doc (tree via parentId). */
export interface ProductCategory {
  name: string
  slug: string
  parentId?: string | null
  order?: number
}

export type CollectionRuleField =
  | 'tag'
  | 'categoryId'
  | 'priceUsd'
  | 'name'
  | 'type'
export type CollectionRuleOp = 'eq' | 'neq' | 'lt' | 'gt' | 'contains'

export interface CollectionRule {
  field: CollectionRuleField
  op: CollectionRuleOp
  value: string | number
}

/** `hosts/{hostId}/collections/{id}` doc. */
export interface HostCollection {
  name: string
  slug: string
  description?: string
  mode: 'manual' | 'smart'
  /** Manual mode: explicit ordered membership. */
  productIds?: string[]
  /** Smart mode: rules evaluated over active products. */
  rules?: CollectionRule[]
  /** Smart mode: true = every rule must match (default), false = any. */
  matchAll?: boolean
  /** Media-library image URL for the collection card/landing hero. */
  imageUrl?: string
  order?: number
}

/**
 * Payment-provider seam (AGL-284): checkout/session creation goes
 * through a provider id so PayPal (etc.) can slot in without reworking
 * callers. Stripe is the only implementation today; store settings
 * (AGL-295) will carry the selection when a second provider exists.
 */
export type PaymentProviderId = 'stripe'

export interface PaymentCheckoutRequest {
  provider: PaymentProviderId
  hostId: string
  amountCents: number
  feeCents: number
  productName: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
}

/** Variant ceiling per product (Shopify parity). */
export const COMMERCE_MAX_VARIANTS = 100
export const COMMERCE_MAX_OPTIONS = 3
export const COMMERCE_MAX_OPTION_VALUES = 25
export const COMMERCE_SLUG_MAX_LENGTH = 80

/** Lowercase-kebab slug from a product/category/collection name. */
export function commerceSlug(name: string): string {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, COMMERCE_SLUG_MAX_LENGTH)
}

/**
 * Cartesian product of option values → the variant option combinations
 * the products hub materializes into a variants matrix. Empty/absent
 * options yield a single default combination ({}).
 */
export function expandVariantMatrix(
  options: ProductOption[] | undefined,
): Array<Record<string, string>> {
  const usable = (options ?? []).filter(
    (option) => option.name && (option.values?.length ?? 0) > 0,
  )
  if (usable.length === 0) return [{}]
  let combos: Array<Record<string, string>> = [{}]
  for (const option of usable) {
    const next: Array<Record<string, string>> = []
    for (const combo of combos) {
      for (const value of option.values) {
        next.push({ ...combo, [option.name]: value })
      }
    }
    combos = next
    if (combos.length > COMMERCE_MAX_VARIANTS) {
      return combos.slice(0, COMMERCE_MAX_VARIANTS)
    }
  }
  return combos
}

/** Variant whose option selections match exactly; undefined if none. */
export function findVariant(
  product: Pick<HostProduct, 'variants'>,
  selections: Record<string, string>,
): ProductVariant | undefined {
  return product.variants?.find((variant) => {
    const options = variant.options ?? {}
    const keys = new Set([...Object.keys(options), ...Object.keys(selections)])
    for (const key of keys) {
      if (options[key] !== selections[key]) return false
    }
    return true
  })
}

/** [min, max] price across variants; [0, 0] when there are none. */
export function productPriceRange(
  product: Pick<HostProduct, 'variants'>,
): [number, number] {
  const prices = (product.variants ?? [])
    .map((variant) => Number(variant.priceUsd))
    .filter((price) => Number.isFinite(price) && price >= 0)
  if (prices.length === 0) return [0, 0]
  return [Math.min(...prices), Math.max(...prices)]
}

/** Sum of tracked inventory; null when every variant is untracked. */
export function productInventory(
  product: Pick<HostProduct, 'variants'>,
): number | null {
  let total: number | null = null
  for (const variant of product.variants ?? []) {
    if (variant.inventory == null) continue
    total = (total ?? 0) + Number(variant.inventory)
  }
  return total
}

/** Reasons an inventory adjustment doc may carry (AGL-281). */
export type InventoryAdjustmentReason =
  | 'sale'
  | 'refund'
  | 'restock'
  | 'correction'
  | 'damage'

/** `hosts/{hostId}/inventoryAdjustments/{id}` doc. */
export interface InventoryAdjustment {
  productId: string
  variantId: string
  /** Positive = stock added, negative = removed. */
  delta: number
  reason: InventoryAdjustmentReason
  /** Order id for sale/refund adjustments. */
  orderId?: string
  /** Location for multi-location stock (AGL-286); absent = default. */
  locationId?: string
  atMs: number
}

/**
 * Whether `quantity` of a variant is purchasable (AGL-281): untracked
 * stock always is; tracked stock honors the product's oversell policy.
 */
export function canPurchase(
  product: Pick<HostProduct, 'variants' | 'oversellPolicy'>,
  variantId: string | undefined,
  quantity = 1,
): boolean {
  const variant = variantId
    ? product.variants?.find((item) => item.id === variantId)
    : product.variants?.[0]
  if (!variant) return false
  if (variant.inventory == null) return true
  if (product.oversellPolicy === 'backorder') return true
  return Number(variant.inventory) >= quantity
}

/**
 * Applies a stock delta to one variant, flooring at zero (race-window
 * sales can't drive the display negative), and returns the new variants
 * array — callers persist it plus the `productInventory` denormalization.
 * With `locationId`, the delta lands in that location's bucket and the
 * flat `inventory` re-sums across locations (AGL-286).
 */
export function adjustVariantInventory(
  product: Pick<HostProduct, 'variants'>,
  variantId: string,
  delta: number,
  locationId?: string,
): ProductVariant[] {
  return (product.variants ?? []).map((variant) => {
    if (variant.id !== variantId || variant.inventory == null) return variant
    if (locationId && variant.inventoryByLocation) {
      const buckets = {
        ...variant.inventoryByLocation,
        [locationId]: Math.max(
          0,
          Number(variant.inventoryByLocation[locationId] ?? 0) + delta,
        ),
      }
      return {
        ...variant,
        inventoryByLocation: buckets,
        inventory: Object.values(buckets).reduce(
          (sum, count) => sum + Number(count),
          0,
        ),
      }
    }
    return {
      ...variant,
      inventory: Math.max(0, Number(variant.inventory) + delta),
    }
  })
}

/**
 * Moves stock between two locations of a tracked variant (AGL-286).
 * Quantity clamps to what the source location holds; the flat total is
 * unchanged by construction.
 */
export function transferVariantInventory(
  product: Pick<HostProduct, 'variants'>,
  variantId: string,
  fromLocationId: string,
  toLocationId: string,
  quantity: number,
): ProductVariant[] {
  return (product.variants ?? []).map((variant) => {
    if (variant.id !== variantId || variant.inventory == null) return variant
    const buckets = { ...(variant.inventoryByLocation ?? {}) }
    const available = Math.max(0, Number(buckets[fromLocationId] ?? 0))
    const moved = Math.min(available, Math.max(0, Math.round(quantity)))
    if (moved === 0) return variant
    buckets[fromLocationId] = available - moved
    buckets[toLocationId] = Math.max(0, Number(buckets[toLocationId] ?? 0)) + moved
    return { ...variant, inventoryByLocation: buckets }
  })
}

/** True when tracked stock is at/below the product's alert threshold. */
export function isLowStock(
  product: Pick<HostProduct, 'variants' | 'lowStockThreshold'>,
): boolean {
  const threshold = product.lowStockThreshold
  if (threshold == null || !(threshold >= 0)) return false
  const total = productInventory(product)
  return total != null && total <= threshold
}

function ruleMatches(product: HostProduct, rule: CollectionRule): boolean {
  const value = rule.value
  switch (rule.field) {
    case 'tag': {
      const tags = product.tags ?? []
      const has = tags.includes(String(value))
      return rule.op === 'neq' ? !has : has
    }
    case 'categoryId': {
      const ids = product.categoryIds ?? []
      const has = ids.includes(String(value))
      return rule.op === 'neq' ? !has : has
    }
    case 'priceUsd': {
      const [min, max] = productPriceRange(product)
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) return false
      if (rule.op === 'lt') return min < numeric
      if (rule.op === 'gt') return max > numeric
      if (rule.op === 'neq') return min !== numeric || max !== numeric
      return min <= numeric && numeric <= max
    }
    case 'name': {
      const name = (product.name ?? '').toLowerCase()
      const needle = String(value).toLowerCase()
      if (rule.op === 'contains') return name.includes(needle)
      if (rule.op === 'neq') return name !== needle
      return name === needle
    }
    case 'type': {
      const matches = product.type === value
      return rule.op === 'neq' ? !matches : matches
    }
    default:
      return false
  }
}

/**
 * Smart-collection membership: draft/archived/deleted products never
 * match; manual collections answer from productIds.
 */
export function matchesCollection(
  product: HostProduct,
  collection: HostCollection,
  productId?: string,
): boolean {
  if (product.deletedAt || product.status !== 'active') return false
  if (collection.mode === 'manual') {
    return productId != null &&
      (collection.productIds ?? []).includes(productId)
  }
  const rules = collection.rules ?? []
  if (rules.length === 0) return false
  const matcher = (rule: CollectionRule) => ruleMatches(product, rule)
  return collection.matchAll === false
    ? rules.some(matcher)
    : rules.every(matcher)
}

/**
 * Lifts a legacy Commerce Starter doc (AGL-90: flat name/priceUsd/
 * inventory/imageUrl) into the catalog shape with a single default
 * variant. Already-lifted docs pass through unchanged.
 */
export function liftLegacyProduct(
  raw: Partial<HostProduct> & { name?: string },
): HostProduct {
  if (Array.isArray(raw.variants) && raw.variants.length > 0) {
    return raw as HostProduct
  }
  const priceUsd = Number(raw.priceUsd ?? 0)
  return {
    ...raw,
    name: raw.name ?? 'Product',
    slug: raw.slug || commerceSlug(raw.name ?? 'product'),
    type: raw.type ?? 'physical',
    status: raw.status ?? 'active',
    variants: [
      {
        id: 'default',
        priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0,
        inventory: raw.inventory ?? null,
      },
    ],
  }
}

/** Actionable error, or null when the product is storable. */
export function validateProduct(product: HostProduct): string | null {
  if (!product.name?.trim()) return 'Product name is required'
  if (!product.slug || product.slug !== commerceSlug(product.slug)) {
    return 'Slug must be lowercase letters, numbers, and dashes'
  }
  if (!['physical', 'digital', 'service'].includes(product.type)) {
    return 'Unknown product type'
  }
  if (!['draft', 'active', 'archived'].includes(product.status)) {
    return 'Unknown product status'
  }
  const options = product.options ?? []
  if (options.length > COMMERCE_MAX_OPTIONS) {
    return `At most ${COMMERCE_MAX_OPTIONS} options per product`
  }
  for (const option of options) {
    if (!option.name?.trim()) return 'Option names are required'
    if ((option.values?.length ?? 0) === 0) {
      return `Option "${option.name}" needs at least one value`
    }
    if (option.values.length > COMMERCE_MAX_OPTION_VALUES) {
      return `Option "${option.name}" has too many values`
    }
    if (new Set(option.values).size !== option.values.length) {
      return `Option "${option.name}" has duplicate values`
    }
  }
  const variants = product.variants ?? []
  if (variants.length === 0) return 'Products need at least one variant'
  if (variants.length > COMMERCE_MAX_VARIANTS) {
    return `At most ${COMMERCE_MAX_VARIANTS} variants per product`
  }
  const ids = new Set<string>()
  const skus = new Set<string>()
  for (const variant of variants) {
    if (!variant.id) return 'Variants need stable ids'
    if (ids.has(variant.id)) return 'Variant ids must be unique'
    ids.add(variant.id)
    const price = Number(variant.priceUsd)
    if (!Number.isFinite(price) || price < 0) {
      return 'Variant prices must be zero or more'
    }
    if (price > COMMERCE_MAX_PRICE_USD) {
      return `Prices are capped at $${COMMERCE_MAX_PRICE_USD}`
    }
    if (variant.sku) {
      if (skus.has(variant.sku)) return 'Variant SKUs must be unique'
      skus.add(variant.sku)
    }
    if (
      variant.compareAtPriceUsd != null &&
      Number(variant.compareAtPriceUsd) <= price
    ) {
      return 'Compare-at price must exceed the price'
    }
  }
  return null
}

/** Actionable error, or null when the collection is storable. */
export function validateCollection(collection: HostCollection): string | null {
  if (!collection.name?.trim()) return 'Collection name is required'
  if (
    !collection.slug ||
    collection.slug !== commerceSlug(collection.slug)
  ) {
    return 'Slug must be lowercase letters, numbers, and dashes'
  }
  if (collection.mode !== 'manual' && collection.mode !== 'smart') {
    return 'Unknown collection mode'
  }
  if (collection.mode === 'smart') {
    const rules = collection.rules ?? []
    if (rules.length === 0) return 'Smart collections need at least one rule'
    for (const rule of rules) {
      if (
        !['tag', 'categoryId', 'priceUsd', 'name', 'type'].includes(rule.field)
      ) {
        return 'Unknown rule field'
      }
      if (!['eq', 'neq', 'lt', 'gt', 'contains'].includes(rule.op)) {
        return 'Unknown rule operator'
      }
      if (rule.value === '' || rule.value == null) {
        return 'Rule values are required'
      }
    }
  }
  return null
}
