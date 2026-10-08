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
  commerceSlug,
  type HostProduct,
  type InventoryAdjustment,
  type InventoryAdjustmentReason,
  productSearchFields,
  productStockFields,
  type SmartCollectionRules,
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
    ...currentFields
  } = current
  const primaryVariant = current.variants[0]
  return {
    ...currentFields,
    ...productSearchFields({
      name: current.name.trim().slice(0, 120),
      variants: current.variants,
    }),
    slug: current.slug || commerceSlug(current.name),
    priceUsd: primaryVariant?.priceUsd ?? 0,
    ...productStockFields({
      variants: current.variants,
      oversellPolicy: current.oversellPolicy,
    }),
    imageUrl: current.mediaUrls?.[0] ?? current.imageUrl ?? null,
    updatedAtMs: nowMs,
  }
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
