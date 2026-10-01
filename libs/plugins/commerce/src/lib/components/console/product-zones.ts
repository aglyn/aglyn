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
  definePluginZone,
  registerPluginZone,
} from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { BUNDLE_ID } from '../../constants/bundle-common'

/**
 * The zones this plugin hosts on its product surfaces (AGL-2916): the product
 * editor, the products hub and the CSV import dialog.
 *
 * Each is drawn through the shell's renderer (`useConsoleWidgetSlot`), so a
 * widget there passes the same enablement, entitlement and permission gates as
 * one on a console page. The props are this plugin's words for its catalog,
 * declared on the zone's token; a widget from another plugin restates the
 * shape it reads rather than importing this package. A widget proposes and
 * never writes: every write is this plugin's, with the guards it carries.
 */

/** A product type, as the commerce catalog names it. */
export type ConsoleProductType = 'physical' | 'digital' | 'service'

/** A product option axis: its name and the values a shopper picks from. */
export interface ConsoleProductOption {
  name: string
  values: string[]
}

/** A product as the commerce editor holds it: saved, or staged and unsaved. */
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
 * Copy a widget proposes for one product. A field left out is left alone;
 * `optionNames` renames the product's options in order, keeping every
 * variant, and is ignored unless it names each option once.
 */
export interface ConsoleProductCopyValues {
  description?: string
  tags?: string[]
  categoryIds?: string[]
  optionNames?: string[]
  seoTitle?: string
  seoDescription?: string
}

/**
 * What the `productEditor` zone hands each widget: the product as the editor
 * holds it, and `proposeValues`, which stages copy in the editor as unsaved
 * edits. The zone sits under the product's description, tags and categories,
 * as the editor's search listing hosts `seoFields`. Save product is the
 * write, with the guards it carries.
 */
export interface ConsoleProductEditorZoneProps {
  hostId: string
  /** The org the page names; `undefined` where the host does not know it. */
  orgId: string | undefined
  product: ConsoleProductDraft
  /** The site's categories, as the editor's picker lists them. */
  categories: ReadonlyArray<{ id: string; name: string }>
  /**
   * Stages `values` in the editor as unsaved edits under `key`. Save product
   * is what stores them; a widget never writes the product itself.
   */
  proposeValues: (values: ConsoleProductCopyValues, key: string) => void
}

/** A catalog row as the products hub holds it. */
export interface ConsoleProductSummary {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
  /** Whether a variant of the product has no price yet. */
  priceMissing: boolean
  /** Whether the product has a photo. */
  hasPhoto: boolean
}

/** A new product a widget asks the hub to create, always as a draft with no price. */
export interface ConsoleProposedProduct {
  name: string
  type: ConsoleProductType
  description: string
  tags: string[]
  options: ConsoleProductOption[]
  seoTitle: string
  seoDescription: string
}

/** A discount a widget asks the hub to create, always switched off. */
export interface ConsoleProposedDiscount {
  name: string
  /** The code a shopper types, or `null` for a discount that applies on its own. */
  code: string | null
  kind: 'percent' | 'fixed' | 'free_shipping'
  valuePct: number | null
  valueCents: number | null
  minSubtotalCents: number | null
}

/**
 * What the `productsHub` zone hands each widget: the catalog rows the hub
 * holds, the products its latest import created, and the hub's own writes a
 * widget may ask it to make — copy onto saved products, new draft products,
 * categories and switched-off discounts. The zone sits above the catalog
 * table. Each write is the hub's, with its seed, allowance and slug checks; a
 * widget writes nothing itself. Every write resolves once it is stored and
 * throws with a message a person can act on when the hub refuses it: an
 * allowance the plan has no room for, a product that is gone.
 *
 * The creates are safe to ask twice: a product or a category named like one
 * the site has, and a discount with the code (or, with no code, the name) of
 * one the site has, are passed over, so a proposal applied again, by anyone,
 * creates nothing it already created.
 */
export interface ConsoleProductsHubZoneProps {
  hostId: string
  /** The org the page names; `undefined` where the host does not know it. */
  orgId: string | undefined
  /** The catalog rows the hub holds, in its order. */
  products: readonly ConsoleProductSummary[]
  /**
   * The products the hub's latest CSV import created in this visit, and the
   * options the `productImport` zone set for them; `null` before any import.
   * `key` is new for each import.
   */
  lastImport: {
    key: string
    productIds: readonly string[]
    options: Readonly<Record<string, boolean>>
  } | null
  /** Writes copy onto a saved product, read fresh from the store. */
  applyProductCopy: (productId: string, values: ConsoleProductCopyValues) => Promise<void>
  /** Creates each product as a draft with no price, and resolves with the ids it created. */
  createProductDrafts: (products: readonly ConsoleProposedProduct[]) => Promise<string[]>
  /** Creates categories by name, and resolves with how many it created. */
  createCategories: (names: readonly string[]) => Promise<number>
  /** Creates each discount switched off, and resolves with how many it created. */
  createDiscountDrafts: (discounts: readonly ConsoleProposedDiscount[]) => Promise<number>
}

/**
 * What the `productImport` zone hands each widget, inside the CSV import
 * dialog: how many products the import creates, and options a widget sets
 * for what happens to them once they land. The hub hands the options, with
 * the ids of the products the import created, to `productsHub` as its
 * `lastImport`.
 */
export interface ConsoleProductImportZoneProps {
  hostId: string
  /** The org the page names; `undefined` where the host does not know it. */
  orgId: string | undefined
  /** How many products the import creates. */
  count: number
  /** The options set for this import, by key. */
  options: Readonly<Record<string, boolean>>
  /** Sets one option; the hub carries it to `productsHub` with what the import created. */
  setOption: (key: string, on: boolean) => void
}

export const PRODUCT_EDITOR_ZONE =
  definePluginZone<ConsoleProductEditorZoneProps>('productEditor')

export const PRODUCTS_HUB_ZONE =
  definePluginZone<ConsoleProductsHubZoneProps>('productsHub')

export const PRODUCT_IMPORT_ZONE =
  definePluginZone<ConsoleProductImportZoneProps>('productImport')

/**
 * Declares the three zones, from the console registrar. The ids are the ones
 * widgets have always registered under, so a widget written for them keeps
 * working. Each is `bare`: the section is one item of a layout this plugin
 * draws — among the editor's fields, above the catalog table, inside the
 * import dialog — and a wrapper would add a gap the page already spaces.
 */
export function registerCommerceZones(): void {
  const owner = { pluginId: BUNDLE_ID }
  registerPluginZone(
    {
      zone: PRODUCT_EDITOR_ZONE,
      label: 'Product editor',
      surface: 'console',
      layout: 'bare',
      description:
        'Under a product’s description, tags and categories in the product editor. A widget here proposes copy for the fields through `proposeValues`, staged as unsaved edits; Save product is the write.',
    },
    owner,
  )
  registerPluginZone(
    {
      zone: PRODUCTS_HUB_ZONE,
      label: 'Products hub',
      surface: 'console',
      layout: 'bare',
      description:
        'Above the catalog table on the Products page. A widget here proposes copy, draft products, categories and switched-off discounts, and asks the hub to write them; every write is the hub’s, with its allowance and slug checks.',
    },
    owner,
  )
  registerPluginZone(
    {
      zone: PRODUCT_IMPORT_ZONE,
      label: 'Product CSV import',
      surface: 'console',
      layout: 'bare',
      description:
        'Inside the CSV import dialog. A widget here sets options for what happens to the imported products once they land; the hub hands them to `productsHub` with the ids the import created.',
    },
    owner,
  )
}
