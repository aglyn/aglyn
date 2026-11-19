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

import { serialize } from '@aglyn/tenant-data-admin/server/api-v1-kit'

/**
 * A product as the customer API publishes it (AGL-1928): the reads and, since
 * AGL-4235, the writes answer this one shape.
 */

/**
 * Price and stock live on VARIANTS, never on the product — a product-level
 * `inventory` exists only as a denormalized sum the console rewrites on every
 * decrement, and a product-level `priceUsd` is the legacy single-variant
 * shape. Publishing either as the product's price would be wrong the moment a
 * product has two variants, so the variant array is the contract and the
 * product carries only the roll-up, clearly named.
 *
 * `inventory: null` on a variant means UNTRACKED and `0` means SOLD OUT.
 * Collapsing them (the `?? 0` an integrator writes on the first day) turns
 * every untracked product into an out-of-stock one, so the distinction is
 * carried through verbatim rather than defaulted.
 */
export function variantView(variant: Record<string, unknown>) {
  const inventory = variant.inventory
  return {
    id: variant.id ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    options: variant.options ?? {},
    priceUsd: typeof variant.priceUsd === 'number' ? variant.priceUsd : null,
    compareAtPriceUsd:
      typeof variant.compareAtPriceUsd === 'number'
        ? variant.compareAtPriceUsd
        : null,
    weightGrams:
      typeof variant.weightGrams === 'number' ? variant.weightGrams : null,
    inventory: typeof inventory === 'number' ? inventory : null,
    inventoryTracked: typeof inventory === 'number',
  }
}

export function productView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  const variants = Array.isArray(data.variants)
    ? (data.variants as Array<Record<string, unknown>>)
    : []
  const tracked = variants.filter((v) => typeof v.inventory === 'number')
  return {
    id: doc.id,
    object: 'product',
    name: data.name ?? null,
    slug: data.slug ?? null,
    description: data.description ?? null,
    type: data.type ?? null,
    status: data.status ?? null,
    tags: data.tags ?? [],
    categoryIds: data.categoryIds ?? [],
    mediaUrls: data.mediaUrls ?? [],
    options: data.options ?? [],
    variants: variants.map(variantView),
    // The product's own search listing (AGL-4235): what its page's title and
    // description say to a search engine, `null` where the page falls back
    // to the product's name and description.
    seo: {
      title: typeof data.seo?.title === 'string' && data.seo.title ? data.seo.title : null,
      description:
        typeof data.seo?.description === 'string' && data.seo.description ? data.seo.description : null,
    },
    // The sum across TRACKED variants only, and `null` when none of them is
    // tracked — so an untracked catalogue reads as "we don't count this"
    // rather than as a store with nothing left to sell.
    inventory: tracked.length
      ? tracked.reduce((sum, v) => sum + Number(v.inventory ?? 0), 0)
      : null,
    subscription: serialize(data.subscription) ?? null,
    created: data.createdAtMs ? new Date(Number(data.createdAtMs)).toISOString() : null,
    updated: data.updatedAtMs ? new Date(Number(data.updatedAtMs)).toISOString() : null,
  }
}

