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

import { nameSearchFields } from '@aglyn/aglyn/app-utils/name-search'

/**
 * Commerce catalog v1 (AGL-276): products with options/variants,
 * hierarchical categories, tags, and manual/smart collections. Pure
 * model + helpers — no I/O; the products hub and storefront APIs operate
 * over these shapes. Documents live under `hosts/{hostId}/products`,
 * `.../productCategories`, and `.../collections`; the legacy Commerce
 * Starter product doc (AGL-90: name/priceUsd/inventory) lifts into this
 * shape via `liftLegacyProduct`, so existing docs keep working.
 */

/*
 * THERE IS NO STOREFRONT FEE CONSTANT, and that absence is load-bearing
 * (AGL-2295).
 *
 * `COMMERCE_PLATFORM_FEE_PERCENT = 2` lived here with ZERO call sites. It
 * asserted a flat 2% that agrees with the plan table for exactly one cell
 * (Starter, physical) and disagrees with the other fifteen — Starter digital
 * is 5%, Pro digital 3%, Business 2%, Scale 1%, and every physical rate above
 * Starter is 0%. Nothing was wrong while nothing read it; the cost was that
 * the next reader wiring it up would silently re-price every plan, and a
 * constant sitting in the model beside the types reads like the answer.
 *
 * The single source is `resolveTransactionFeePct(org, productType)` in
 * `plan-entitlements.ts`, resolved PER REQUEST from the org — because it
 * depends on the plan, on per-org staff overrides, and on whether the
 * subscription is still alive. A constant cannot express any of that.
 * `commerce-fee-single-source.spec.ts` fails the build if one comes back.
 */
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
  /**
   * Buyer-chosen billing (AGL-545): with `subscription` set, true lets
   * the buyer pick one-time OR subscribe on the PDP (default one-time);
   * absent/false keeps the product subscription-only.
   */
  subscriptionOptional?: boolean
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
 * The search keys a product write carries, so the catalog can be searched by
 * the QUERY rather than by the rows a listener happened to fetch (AGL-693).
 *
 * The hub lists `limit(500)`, and the search compared what that returned — so
 * a product past the window answered "no products match", which reads as the
 * product not existing rather than as the search not reaching it. Filtering
 * server-side needs fields Firestore can index, and neither of the two things
 * a merchant searches by is one:
 *
 *   - A NAME needs case-insensitive contains, which Firestore has no operator
 *     for. `nameSearchFields` denormalizes it into the three shapes that are
 *     indexable — an exact key, word-prefix tokens for `array-contains`, and
 *     the key reversed so "ends with" becomes a prefix range.
 *   - A SKU lives inside `variants`, an array of OBJECTS, and Firestore cannot
 *     query a field inside one. Flattened here into a top-level array so a SKU
 *     is one `array-contains`.
 *
 * ⛔ A SKU therefore matches WHOLE, not as a substring: "abc-123" finds it and
 * "123" does not. That is the right way round for a SKU, which is a value
 * somebody copies rather than half-remembers — unlike a name, where the tokens
 * above buy word-prefix matching precisely because names are half-remembered.
 *
 * `barcodes` is the same flattening for the same reason, and it is the one the
 * register depends on: a keyboard-wedge scanner types the code and presses
 * Enter, so the lookup has to be exact and has to reach the whole catalog. A
 * scan is never a half-remembered value.
 *
 * Lower-cased because the translator lower-cases the typed query before it
 * builds the `array-contains`; stored and typed have to be normalized the same
 * way or the two silently disagree.
 *
 * ⚠️ Each array is OMITTED when a product has none, rather than written as
 * `[]`. `isNotEmpty` is served as `!= null`, and an empty array is not null —
 * so a product with no SKUs at all would answer "has a SKU" for every row.
 *
 * ⚠️ Spread this at EVERY write that sets a product's name or variants. A
 * write that sets the name without it leaves the keys describing the previous
 * name, and the product becomes findable only by what it used to be called.
 */
export function productSearchFields(product: {
  name: string
  variants?: ProductVariant[]
}): {
  name: string
  nameLower: string
  nameTokens: string[]
  nameReversed: string
  skus?: string[]
  barcodes?: string[]
} {
  const flatten = (read: (variant: ProductVariant) => string | undefined) => [
    ...new Set(
      (product.variants ?? [])
        .map((variant) => (read(variant) ?? '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  const skus = flatten((variant) => variant.sku)
  const barcodes = flatten((variant) => variant.barcode)
  return {
    ...nameSearchFields(product.name),
    ...(skus.length ? { skus } : {}),
    ...(barcodes.length ? { barcodes } : {}),
  }
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

/**
 * Reasons an inventory adjustment doc may carry (AGL-281).
 *
 * `cancellation` is the only one written automatically in the PLUS direction
 * (AGL-1808): cancelling an order the transition rules prove was never
 * fulfilled puts back exactly what the sale took. It is deliberately not
 * `refund` — no money moved — and not `correction`, which is what a merchant
 * picks when the count disagreed with the shelf for a reason nobody recorded.
 * Kept out of the "Adjust stock" dialog's menu on purpose: a merchant reaching
 * for it by hand means something else happened.
 */
export type InventoryAdjustmentReason =
  'sale' | 'refund' | 'restock' | 'correction' | 'damage' | 'cancellation'

/** `hosts/{hostId}/inventoryAdjustments/{id}` doc. */
export interface InventoryAdjustment {
  productId: string
  variantId: string
  /** Positive = stock added, negative = removed. */
  delta: number
  /**
   * What the count ACTUALLY moved by, when the floor in
   * `adjustVariantInventory` absorbed part of `delta` (AGL-2149). Written only
   * when the two differ, which for a sale means a backorder product that sold
   * past zero: `delta` stays the units sold — that is the merchant's stock
   * history and it must keep saying "3 went out the door" — while this says how
   * many of them the count could give up.
   *
   * A REVERSAL MUST READ THIS, NOT `delta`. Restoring `delta` on a backorder
   * sale that the floor swallowed invents inventory that never existed: 0 sells
   * 3, the count stays 0, and a `+3` on cancellation leaves 3 units nobody has.
   * Absent on every row written before AGL-2149 and on every row where nothing
   * was clamped, so `appliedDelta ?? delta` is the reader.
   */
  appliedDelta?: number
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
 * What the register has to SAY about a line it is about to sell (AGL-2357).
 *
 * ## The defect
 *
 * `pos-order.ts` contains no `canPurchase` call. Every storefront door gates on
 * it; the register does not, so a merchant who set `oversellPolicy: 'deny'` in
 * the product editor silently got `backorder` at the counter — the count floors
 * at zero underneath and nothing anywhere says so.
 *
 * ## The decision, and why it is a shortfall and not a refusal
 *
 * Warn, never block. A till is the wrong place for a stale number to stop a
 * real sale: the cashier is holding the goods, the physical shelf is the truth,
 * and refusing loses a sale over data that is behind. But "deny" must at least
 * SAY something. So this reports the shortfall and the caller sells anyway.
 * Honouring the policy with a manager-level override is the post-launch shape
 * (AGL-2372) and wants an audit trail this deliberately does not build.
 *
 * ## Why the test is `canPurchase`
 *
 * Exactly the gate the register was missing, and no wider. An untracked variant
 * has no number to be short against, and a `backorder` product's merchant chose
 * to sell past zero — warning them would be noise about a setting they set on
 * purpose. So a shortfall is reported only where a purchase would have been
 * refused anywhere else in the product.
 */
export interface StockShortfall {
  productId: string
  variantId?: string
  /** Product name at the time of sale, for a message the cashier can read. */
  name: string
  variantLabel?: string
  /** Units the cashier is ringing up. */
  requested: number
  /** Units the count says are on the shelf; never negative. */
  available: number
}

export function stockShortfall(
  product: Pick<HostProduct, 'variants' | 'oversellPolicy'>,
  variantId: string | undefined,
  quantity = 1,
): { available: number } | null {
  if (canPurchase(product, variantId, quantity)) return null
  const variant = variantId
    ? product.variants?.find((item) => item.id === variantId)
    : product.variants?.[0]
  // `canPurchase` answers false for a variant that does not exist at all. That
  // is not a stock shortfall and must not be reported as "0 in stock" — the
  // register's own line builder falls back to `variants[0]`, so the case is
  // unreachable from the counter, and inventing a count for it would be the
  // one failure mode this feature must not have.
  if (!variant || variant.inventory == null) return null
  return { available: Math.max(0, Math.round(Number(variant.inventory) || 0)) }
}

/**
 * Whether stock tracking MEANS anything on a product (AGL-1744).
 *
 * `canPurchase` above gates every checkout on stock, subscription sessions
 * included, but nothing ever decrements for a subscription — not on the
 * initial charge (the `commerce-subscription` webhook branch deliberately
 * writes no order and touches no inventory, AGL-1732) and not on renewal
 * (`invoice.payment_succeeded` is unhandled repo-wide, AGL-1743). So on a
 * subscription-only product that gate is permanently satisfied: one unit of
 * stock sells an unlimited number of subscriptions, and the count never
 * moves however many boxes ship. The merchant set a number, the system
 * checks it on every sale, and the number is never true.
 *
 * AGL-1750 resolved the half AGL-1744 had to leave open: every paid invoice
 * of a PHYSICAL subscription now mints an order and decrements its variant's
 * stock (the `invoice.paid` branch of the commerce webhook), opening cycle
 * included. So the honest split is now three-way:
 *
 *   - `subscriptionOptional` ("Both") products have a real one-time path —
 *     the cart only ever builds `mode: 'payment'` sessions, and buy-now with
 *     `billing: 'once'` records a plain order — and that path decrements
 *     honestly. Withdrawing stock tracking there would delete a working
 *     control and re-open the AGL-1711 oversell on the half that works.
 *   - a PHYSICAL subscription box consumes a unit every cycle, and since
 *     AGL-1750 the cycle's own order decrements it — the count moves as the
 *     boxes ship, so the number the merchant sets is kept true again.
 *   - a DIGITAL or SERVICE subscription-only product still has no
 *     decrementing path anywhere, so the field stays withdrawn there: one
 *     unit would still sell unlimited subscriptions.
 *
 * This says nothing about what `canPurchase` returns — that is the gate for
 * every other purchase path and is deliberately untouched. This is a console
 * predicate: it stops the editor inviting a merchant to set a number the
 * system will never keep true.
 */
export function stockTrackingApplies(
  product: Pick<HostProduct, 'subscription' | 'subscriptionOptional' | 'type'>,
): boolean {
  return (
    !product.subscription ||
    product.subscriptionOptional === true ||
    product.type === 'physical'
  )
}

/** Buyer's requested billing mode on a checkout POST (AGL-545). */
export type CheckoutBillingChoice = 'once' | 'subscribe'

/**
 * Resolves the Stripe Checkout mode for a product + the buyer's
 * requested billing choice (AGL-545). The product doc is authoritative:
 * - no `subscription` → always one-time (the request field is ignored)
 * - `subscription` without `subscriptionOptional` → always subscription
 *   (a forged `billing: 'once'` cannot buy a subscription product once)
 * - `subscriptionOptional` → the buyer chooses; absent/invalid choices
 *   default to one-time, matching the PDP default.
 */
export function resolveCheckoutBillingMode(
  product: Pick<HostProduct, 'subscription' | 'subscriptionOptional'>,
  requested?: string | null,
): 'payment' | 'subscription' {
  if (!product.subscription) return 'payment'
  if (!product.subscriptionOptional) return 'subscription'
  return requested === 'subscribe' ? 'subscription' : 'payment'
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
 * What `adjustVariantInventory` will ACTUALLY move the count by (AGL-2149).
 *
 * The floor in that helper is not a rounding detail, it is a silent absorber. A
 * backorder product (`oversellPolicy: 'backorder'`, which `canPurchase` admits
 * at any stock level) sitting at 0 sells 3: `Math.max(0, 0 + -3)` is 0, so the
 * count does not move — correctly, since inventory is a shelf count and shelves
 * do not go negative — but the ledger row said `-3` and every reversal read it
 * as three units to put back. Cancelling that order handed the merchant 3 units
 * that never existed and a stock badge that offers them for sale.
 *
 * Removing the floor is not the alternative: every reader of `inventory` — the
 * badges, `canPurchase`, `productInventory`, `isLowStock` — assumes it cannot
 * go negative, and a negative count would be a far wider change than the bug.
 * So the clamp stays and the amount it absorbed is recorded instead.
 *
 * Deliberately mirrors `adjustVariantInventory`'s own arithmetic, including
 * which field the clamp applies to in the location-tracked case, so the two
 * cannot disagree about what happened.
 */
export function appliedVariantInventoryDelta(
  product: Pick<HostProduct, 'variants'>,
  variantId: string,
  delta: number,
  locationId?: string,
): number {
  const variant = (product.variants ?? []).find(
    (item) => item.id === variantId,
  )
  if (!variant || variant.inventory == null) return 0
  if (locationId && variant.inventoryByLocation) {
    const before = Number(variant.inventoryByLocation[locationId] ?? 0)
    return Math.max(0, before + delta) - before
  }
  const before = Number(variant.inventory)
  return Math.max(0, before + delta) - before
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
