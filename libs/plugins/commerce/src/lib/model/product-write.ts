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
  adjustVariantInventory,
  COMMERCE_DEFAULT_PRICE_USD,
  commerceSlug,
  expandVariantMatrix,
  type HostProduct,
  type ProductOption,
  type ProductVariant,
  type InventoryAdjustment,
  type InventoryAdjustmentReason,
  productSearchFields,
  productStockFields,
  type SmartCollectionRules,
  variantHasPrice,
} from './commerce'

/*
 * WHAT A PRODUCT SAVE AND A STOCK ADJUSTMENT WRITE, worked out once.
 *
 * The console's product editor and its Adjust stock dialog compute these
 * fields in the browser before their Firestore writes; the native apps save
 * through `commerce/products/save` and `commerce/products/stock`, which run
 * this same code on the server. One computation, so a product saved from a
 * phone carries exactly the search keys, stock verdict, price, image and
 * smart-collection membership the console would have written.
 */

/** The longest product name a save keeps: {@link productSaveFields} cuts a longer one here. */
export const PRODUCT_NAME_MAX_LENGTH = 120

/** A product as the editor holds it: the stored fields plus keys the listener or a seed may carry. */
export type EditedProduct = HostProduct & {
  $id?: string
  skus?: string[]
  barcodes?: string[]
  stockHolds?: Record<string, unknown>
}

/**
 * The fields a product save writes, before its collection membership and its
 * timestamps: the product as edited, with
 *
 *  - `$id` dropped (AGL-1374): the listener's synthetic key, never a field;
 *  - the seed's `skus` / `barcodes` dropped (AGL-3321): `productSearchFields`
 *    omits each when no variant has one, so a seeded copy would outlive the
 *    last SKU;
 *  - the trimmed name with the search keys derived from it, together, so the
 *    two cannot drift (AGL-2501);
 *  - a slug, the primary variant's price, the stock fields, the first image
 *    and `updatedAtMs`.
 */
export function productSaveFields(current: EditedProduct, nowMs: number) {
  const {
    $id: _syntheticId,
    skus: _seededSkus,
    barcodes: _seededBarcodes,
    // A sample the merchant saves is theirs now (AGL-4065).
    sample: _sample,
    ...currentFields
  } = current
  const primaryVariant = current.variants[0]
  return {
    ...currentFields,
    ...productSearchFields({
      name: current.name.trim().slice(0, PRODUCT_NAME_MAX_LENGTH),
      variants: current.variants,
    }),
    slug: current.slug || commerceSlug(current.name),
    // The legacy flat price, only where there is one (AGL-3676): an owner
    // may save a product before pricing it, and an unpriced product is not
    // a free one. `null` rather than absent, so an edit's full replace and
    // the native save write the same field.
    priceUsd: variantHasPrice(primaryVariant) ? primaryVariant.priceUsd : null,
    ...productStockFields({
      variants: current.variants,
      oversellPolicy: current.oversellPolicy,
    }),
    imageUrl: current.mediaUrls?.[0] ?? current.imageUrl ?? null,
    updatedAtMs: nowMs,
  }
}

/**
 * A product nobody has saved yet, as the editor starts one: a draft, at the
 * default price (AGL-3676), for the owner to change or clear.
 */
export function blankProductDraft(): HostProduct {
  return {
    name: '',
    slug: '',
    type: 'physical',
    status: 'draft',
    variants: [{ id: 'default', priceUsd: COMMERCE_DEFAULT_PRICE_USD }],
  }
}

/** Stable key for matching variants across matrix regenerations. */
export function variantComboKey(options: Record<string, string> | undefined): string {
  return Object.entries(options ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}`)
    .join('|')
}

/**
 * The variants a change of option VALUES makes, as the editor rebuilds them:
 * one per combination of `options`, each an existing variant with the same
 * selections where there is one (so its id, price, SKU and stock survive the
 * change), and otherwise a new variant at the first variant's price (none
 * where it has none, the default on a product with no variant yet) and stock.
 *
 * Ask {@link variantMatrixProblem} first: past the ceiling the editor keeps
 * the variants as they are and refuses the save (AGL-4100). A rename is not
 * a change of values; it goes through `renameProductOptions` (AGL-3066).
 */
export function variantsForOptions(
  at: Pick<HostProduct, 'variants'>,
  options: ProductOption[],
  nowMs: number,
): ProductVariant[] {
  const previous = new Map(at.variants.map((variant) => [variantComboKey(variant.options), variant]))
  const fallback = at.variants[0]
  return expandVariantMatrix(options).map(
    (combo, comboIndex) =>
      previous.get(variantComboKey(combo)) ??
      // An unpriced variant is stored with no `priceUsd` (AGL-3676), as a
      // proposed product's are; the type names the priced shape.
      ({
        id: `v${nowMs.toString(36)}${comboIndex}`,
        options: combo,
        ...(fallback
          ? variantHasPrice(fallback)
            ? { priceUsd: fallback.priceUsd }
            : {}
          : { priceUsd: COMMERCE_DEFAULT_PRICE_USD }),
        inventory: fallback?.inventory ?? null,
      } as ProductVariant),
  )
}

/** What the smart-collection rules are matched against: the saved name with the product's own facts. */
export function productMembershipInput(
  fields: { name: string },
  current: Pick<HostProduct, 'type' | 'tags' | 'categoryIds' | 'variants'>,
) {
  return {
    name: fields.name,
    type: current.type,
    tags: current.tags,
    categoryIds: current.categoryIds,
    variants: current.variants,
  }
}

/**
 * An EDIT's replacing write, without its membership and server timestamp:
 * live stock holds are not the editor's to write (AGL-2356), so the seed's
 * are dropped and the stored ones carried; the product stays live
 * (`deletedAt: null`, AGL-3321).
 */
export function productEditWrite(
  fields: ReturnType<typeof productSaveFields>,
  liveHolds: Record<string, unknown> | null | undefined,
) {
  const { stockHolds: _seededHolds, ...withoutHolds } = fields as typeof fields & {
    stockHolds?: Record<string, unknown>
  }
  return {
    ...withoutHolds,
    ...(liveHolds ? { stockHolds: liveHolds } : {}),
    deletedAt: null,
  }
}

/** A duplicate's name: the source's, marked as a copy. */
export function productDuplicateName(name: string): string {
  return `${name} (copy)`
}

/** The slug a duplicate starts from, before the store is asked which are taken. */
export function productDuplicateSlugBase(slug: string | undefined, name: string): string {
  return commerceSlug(`${slug || commerceSlug(name)}-copy`)
}

/**
 * What Duplicate writes (the products list's Duplicate, AGL-3321): the source
 * as a draft under the copy's name, with the COPY's search keys (spreading the
 * source's would sort and find it by the source's name) and stock fields, and
 * not the source's SKU and barcode keys, which are derived again from its
 * variants. The caller adds the claimed `slug`'s smart-collection membership.
 */
export function productDuplicateFields(
  product: HostProduct & { $id?: string; skus?: string[]; barcodes?: string[] },
  slug: string,
  nowMs: number,
) {
  const { $id: _sourceId, skus: _skus, barcodes: _barcodes, ...copy } = product
  return {
    ...copy,
    ...productSearchFields({ name: productDuplicateName(product.name), variants: product.variants }),
    ...productStockFields(product),
    slug,
    status: 'draft' as const,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
}

/** A smart collection as `hosts/{hostId}/collections` stores it, as the membership rules read it. */
export function smartCollectionRulesOf(id: string, data: Record<string, unknown>): SmartCollectionRules {
  return {
    id,
    rules: (data['rules'] as SmartCollectionRules['rules']) ?? [],
    matchAll: data['matchAll'] as boolean | undefined,
  }
}

/** One stock adjustment, as the Adjust stock dialog asks for it. */
export interface StockAdjustment {
  variantId: string
  delta: number
  reason: InventoryAdjustmentReason
  locationId?: string
}

/**
 * The product update and the ledger row one stock adjustment writes: the
 * variants with the count moved, the stock fields that move with it
 * (AGL-3321), and the same `inventoryAdjustments` row the sale webhook writes
 * (AGL-281). A zero or non-numeric delta writes nothing.
 */
export function stockAdjustmentWrite(
  product: HostProduct,
  productId: string,
  adjustment: StockAdjustment,
  nowMs: number,
): { update: Record<string, unknown>; ledger: InventoryAdjustment } | null {
  const delta = Math.round(Number(adjustment.delta))
  if (!delta) return null
  const variants = adjustVariantInventory(product, adjustment.variantId, delta, adjustment.locationId || undefined)
  return {
    update: {
      variants,
      ...productStockFields({ ...product, variants }),
      updatedAtMs: nowMs,
    },
    ledger: {
      productId,
      variantId: adjustment.variantId,
      delta,
      reason: adjustment.reason,
      ...(adjustment.locationId ? { locationId: adjustment.locationId } : {}),
      atMs: nowMs,
    },
  }
}
