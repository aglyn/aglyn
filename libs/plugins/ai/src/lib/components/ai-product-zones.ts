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
 * What the commerce plugin's product zones hand this plugin's widgets.
 *
 * `productEditor`, `productsHub` and `productImport` are zones the commerce
 * plugin hosts and declares (`registerPluginZone`), with their props on its
 * own zone tokens. A plugin never imports another plugin, so the widgets
 * registered there read the props through the shapes restated here — the
 * zone's props as the host documents them, by the same names. A widget is
 * handed whatever the host passes, so this restates what the host SENDS; a
 * field dropped from the host's declaration leaves a widget reading
 * `undefined`, which is why every member below is one the host documents in
 * the injection zones reference.
 *
 * Types only: nothing here reaches a bundle.
 */

export type ConsoleProductType = 'physical' | 'digital' | 'service'

export interface ConsoleProductOption {
  name: string
  values: string[]
}

/** A product as the editor holds it: saved, or staged and unsaved. */
export interface ConsoleProductDraft {
  /** `null` for a product nobody has saved yet. */
  id: string | null
  name: string
  type: ConsoleProductType
  description: string
  tags: string[]
  categoryIds: string[]
  options: ConsoleProductOption[]
  /** The product's media, in order; the first is the photo the storefront leads with. */
  mediaUrls: string[]
  seoTitle: string
  seoDescription: string
}

/**
 * Copy proposed for one product. A field left out is left alone;
 * `optionNames` renames the product's options in order.
 */
export interface ConsoleProductCopyValues {
  description?: string
  tags?: string[]
  categoryIds?: string[]
  optionNames?: string[]
  seoTitle?: string
  seoDescription?: string
}

/** The `productEditor` zone: the product, and a door that stages copy as unsaved edits. */
export interface ConsoleProductEditorZoneProps {
  hostId: string
  orgId: string | undefined
  product: ConsoleProductDraft
  categories: ReadonlyArray<{ id: string; name: string }>
  proposeValues: (values: ConsoleProductCopyValues, key: string) => void
}

/** A catalog row as the products hub holds it. */
export interface ConsoleProductSummary {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
  priceMissing: boolean
  hasPhoto: boolean
}

/** A new product proposed to the hub, which creates it as a draft with no price. */
export interface ConsoleProposedProduct {
  name: string
  type: ConsoleProductType
  description: string
  tags: string[]
  options: ConsoleProductOption[]
  seoTitle: string
  seoDescription: string
}

/** A discount proposed to the hub, which creates it switched off. */
export interface ConsoleProposedDiscount {
  name: string
  code: string | null
  kind: 'percent' | 'fixed' | 'free_shipping'
  valuePct: number | null
  valueCents: number | null
  minSubtotalCents: number | null
}

/** The `productsHub` zone: the catalog rows, the latest import, and the hub's writes. */
export interface ConsoleProductsHubZoneProps {
  hostId: string
  orgId: string | undefined
  products: readonly ConsoleProductSummary[]
  lastImport: {
    key: string
    productIds: readonly string[]
    options: Readonly<Record<string, boolean>>
  } | null
  applyProductCopy: (productId: string, values: ConsoleProductCopyValues) => Promise<void>
  createProductDrafts: (products: readonly ConsoleProposedProduct[]) => Promise<string[]>
  createCategories: (names: readonly string[]) => Promise<number>
  createDiscountDrafts: (discounts: readonly ConsoleProposedDiscount[]) => Promise<number>
}

/** The `productImport` zone: the import's size and the options set for it. */
export interface ConsoleProductImportZoneProps {
  hostId: string
  orgId: string | undefined
  count: number
  options: Readonly<Record<string, boolean>>
  setOption: (key: string, on: boolean) => void
}

/** What `productsCreate` hands each widget: the site and its org (AGL-3596). */
export interface ConsoleProductsCreateZoneProps {
  hostId: string
  orgId: string | undefined
}
