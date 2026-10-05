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
  buildTransferPlan,
  isBlankTransferValue,
  TRANSFER_SYSTEM_GROUP,
  TRANSFER_WARNING_CLASSES,
  type BuildTransferPlanInput,
  type DeriveProblemCode,
  type MatchKeySpec,
  type PlannedTransferRow,
  type RowMatchOutcome,
  type TransferAliasDictionary,
  type TransferField,
  type TransferFieldChange,
  type TransferFieldGroup,
  type TransferLockedRule,
  type TransferPlan,
  type TransferPlanRow,
  type TransferResourcePreset,
  type TransferWarning,
  type TransferWarningClass,
  type TransferWarningSample,
} from '@aglyn/aglyn/data-transfer'
import type { PicklistSpec } from '@aglyn/aglyn/app-utils/picklists'
import {
  COMMERCE_MAX_VARIANTS,
  COMMERCE_SLUG_MAX_LENGTH,
  commerceSlug,
  productInventory,
  productPriceRange,
  validateProduct,
  type HostProduct,
  type ProductOption,
  type ProductStatus,
  type ProductType,
  type ProductVariant,
} from '../model/commerce'

/*
 * PRODUCTS ON THE TRANSFER FRAMEWORK (AGL-3531).
 *
 * ## One product, one row per variant
 *
 * A product's file is laid out the way storefront platforms lay theirs out:
 * a row per variant, the product's own fields (title, description, tags…)
 * on its first row, and every row carrying the product's handle. Images
 * follow the same convention — the first on the first row, the next on the
 * second, and rows of only a handle and an image when there are more images
 * than variants. So a store moving here from Shopify uploads its own export
 * as it is, and the Shopify preset writes one Shopify reads back.
 *
 * ## Rows fold into products
 *
 * The engine plans rows; a product is several. `planProductTransfer` (this
 * resource's `plan` hook) folds the rows of one handle into one product: the
 * first row decides whether the product is new or which one it is (by
 * handle, then SKU, then ID — the person's order), its product fields are
 * planned against the product, and every row's variant fields are planned
 * against the variant it names — by SKU, then by its option values, then the
 * single variant of a single-variant product. A match is UPDATED; the old
 * importer created a second product under a suffixed slug.
 *
 * Every row keeps its own verdict and diff, so the dry run shows what each
 * line of the file does, and the plan stashes what the apply needs on the
 * row (`commerce`): the product's id — minted here for a new one, so a retry
 * finds what it already wrote — the variant's, and for a new product the
 * whole document.
 *
 * ## What a file never sets
 *
 * Option names already on a product (renaming one moves every variant, which
 * the product editor does), stock kept by location (moved per location), and
 * the search, stock and collection keys every write derives.
 */

/*==========================================
 * FIELDS
 *=========================================*/

/** The field ids, as the catalog and every file name them. */
export const PRODUCT_FIELD = {
  handle: 'handle',
  title: 'title',
  description: 'description',
  kind: 'type',
  status: 'status',
  published: 'published',
  tags: 'tags',
  categories: 'categories',
  option1Name: 'option1Name',
  option2Name: 'option2Name',
  option3Name: 'option3Name',
  image: 'image',
  seoTitle: 'seoTitle',
  seoDescription: 'seoDescription',
  taxExempt: 'taxExempt',
  oversellPolicy: 'oversellPolicy',
  lowStockThreshold: 'lowStockThreshold',
  option1Value: 'option1Value',
  option2Value: 'option2Value',
  option3Value: 'option3Value',
  sku: 'sku',
  barcode: 'barcode',
  price: 'price',
  compareAtPrice: 'compareAtPrice',
  inventory: 'inventory',
  weightGrams: 'weightGrams',
  variantImage: 'variantImage',
  priceFrom: 'priceFrom',
  totalInventory: 'totalInventory',
  soldOut: 'soldOut',
  variantCount: 'variantCount',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
} as const

const F = PRODUCT_FIELD

/** The picklists the product fields name. */
export const PRODUCT_KIND_PICKLIST = 'commerce.productKind'
export const PRODUCT_STATUS_PICKLIST = 'commerce.productStatus'
export const PRODUCT_OVERSELL_PICKLIST = 'commerce.oversellPolicy'
export const PRODUCT_CATEGORY_PICKLIST = 'commerce.categories'

const KIND_LABELS: Record<ProductType, string> = {
  physical: 'Physical',
  digital: 'Digital',
  service: 'Service',
}
const STATUS_LABELS: Record<ProductStatus, string> = {
  active: 'Active',
  draft: 'Draft',
  archived: 'Archived',
}
const OVERSELL_LABELS: Record<'deny' | 'backorder', string> = {
  deny: 'Stop selling',
  backorder: 'Keep selling',
}

/** A fixed list as the values step matches it: a file adds nothing to it. */
function fixedList(labels: Record<string, string>, defaultValueId: string): PicklistSpec {
  return {
    restricted: true,
    standardValues: Object.entries(labels).map(([id, label]) => ({ id, label })),
    defaultValueId,
  }
}

/** The fixed lists products name, by picklist id. */
export const PRODUCT_FIXED_PICKLISTS: Readonly<Record<string, PicklistSpec>> = {
  [PRODUCT_KIND_PICKLIST]: fixedList(KIND_LABELS, 'physical'),
  [PRODUCT_STATUS_PICKLIST]: fixedList(STATUS_LABELS, 'active'),
  [PRODUCT_OVERSELL_PICKLIST]: fixedList(OVERSELL_LABELS, 'deny'),
}

/** The id a label of a fixed list names, by label or id in any case; `null` for none. */
export function fixedListId(picklistId: string, value: unknown): string | null {
  const spec = PRODUCT_FIXED_PICKLISTS[picklistId]
  const key = String(value ?? '').trim().toLowerCase()
  if (!spec || !key) return null
  const found = spec.standardValues.find(
    (entry) => entry.id.toLowerCase() === key || entry.label.toLowerCase() === key,
  )
  return found ? found.id : null
}

/** A fixed list's label for a stored id. */
function fixedListLabel(picklistId: string, id: unknown): string | null {
  const spec = PRODUCT_FIXED_PICKLISTS[picklistId]
  return spec?.standardValues.find((entry) => entry.id === id)?.label ?? null
}

export const PRODUCT_TRANSFER_GROUPS: readonly TransferFieldGroup[] = [
  { id: 'product', label: 'Product' },
  { id: 'variant', label: 'Variant' },
  { id: 'options', label: 'Options' },
  { id: 'media', label: 'Images' },
  { id: 'selling', label: 'Selling' },
  { id: 'seo', label: 'Search listing' },
  { id: 'computed', label: 'Computed' },
]

/** The fields a product's first row carries: the product's own. */
export const PRODUCT_LEVEL_FIELDS: readonly string[] = [
  F.handle,
  F.title,
  F.description,
  F.kind,
  F.status,
  F.published,
  F.tags,
  F.categories,
  F.option1Name,
  F.option2Name,
  F.option3Name,
  F.image,
  F.seoTitle,
  F.seoDescription,
  F.taxExempt,
  F.oversellPolicy,
  F.lowStockThreshold,
]

/** The fields every row carries for its own variant. */
export const VARIANT_LEVEL_FIELDS: readonly string[] = [
  F.option1Value,
  F.option2Value,
  F.option3Value,
  F.sku,
  F.barcode,
  F.price,
  F.compareAtPrice,
  F.inventory,
  F.weightGrams,
  F.variantImage,
]

const OPTION_NAME_FIELDS = [F.option1Name, F.option2Name, F.option3Name] as const
const OPTION_VALUE_FIELDS = [F.option1Value, F.option2Value, F.option3Value] as const

/** Every writable product field, in picker order. */
export const PRODUCT_STANDARD_FIELDS: readonly TransferField[] = [
  {
    id: F.handle,
    label: 'Handle',
    group: 'product',
    type: 'text',
    maxLength: 80,
    aliases: ['slug', 'url handle', 'product handle'],
    description: 'The product’s address, /products/<handle>. Rows with one handle are one product.',
  },
  {
    id: F.title,
    label: 'Title',
    group: 'product',
    type: 'text',
    aliases: ['name', 'product name', 'product title'],
    description: 'Needed for a new product.',
  },
  {
    id: F.description,
    label: 'Description',
    group: 'product',
    type: 'longText',
    aliases: ['body', 'body html', 'product description', 'description html'],
  },
  {
    id: F.kind,
    label: 'Kind',
    group: 'product',
    type: 'picklist',
    picklistId: PRODUCT_KIND_PICKLIST,
    aliases: ['product kind', 'type'],
    description: 'Physical, Digital or Service.',
  },
  {
    id: F.status,
    label: 'Status',
    group: 'product',
    type: 'picklist',
    picklistId: PRODUCT_STATUS_PICKLIST,
    aliases: ['product status'],
    description: 'Active, Draft or Archived.',
  },
  {
    id: F.published,
    label: 'Published',
    group: 'product',
    type: 'boolean',
    aliases: ['visible', 'online'],
    description: 'Read as the status when the file has no Status: yes is Active, no is Draft.',
  },
  {
    id: F.tags,
    label: 'Tags',
    group: 'product',
    type: 'text',
    aliases: ['tag', 'keywords'],
    description: 'Separated by commas; their case is kept, because collections match a tag exactly.',
  },
  {
    id: F.categories,
    label: 'Categories',
    group: 'product',
    type: 'multiPicklist',
    picklistId: PRODUCT_CATEGORY_PICKLIST,
    aliases: ['category', 'product categories'],
    description: 'By name. A name the site does not have can be added as a new category.',
  },
  { id: F.option1Name, label: 'Option 1 name', group: 'options', type: 'text', maxLength: 60 },
  { id: F.option1Value, label: 'Option 1 value', group: 'options', type: 'text', maxLength: 60 },
  { id: F.option2Name, label: 'Option 2 name', group: 'options', type: 'text', maxLength: 60 },
  { id: F.option2Value, label: 'Option 2 value', group: 'options', type: 'text', maxLength: 60 },
  { id: F.option3Name, label: 'Option 3 name', group: 'options', type: 'text', maxLength: 60 },
  { id: F.option3Value, label: 'Option 3 value', group: 'options', type: 'text', maxLength: 60 },
  {
    id: F.sku,
    label: 'SKU',
    group: 'variant',
    type: 'text',
    aliases: ['variant sku', 'stock keeping unit', 'item number'],
  },
  {
    id: F.barcode,
    label: 'Barcode',
    group: 'variant',
    type: 'text',
    aliases: ['variant barcode', 'gtin', 'upc', 'ean', 'isbn'],
  },
  {
    id: F.price,
    label: 'Price',
    group: 'variant',
    type: 'currency',
    aliases: ['variant price', 'price usd', 'unit price'],
    description: 'In US dollars. Needed for a new variant.',
  },
  {
    id: F.compareAtPrice,
    label: 'Compare-at price',
    group: 'variant',
    type: 'currency',
    aliases: ['variant compare at price', 'compare at price', 'was price', 'original price'],
    description: 'The strike-through price; above the price, or a product is refused.',
  },
  {
    id: F.inventory,
    label: 'Inventory',
    group: 'variant',
    type: 'integer',
    aliases: ['variant inventory qty', 'inventory quantity', 'quantity', 'stock', 'on hand'],
    description: 'Units in stock; blank is not counted. Stock kept by location is changed on the products page.',
  },
  {
    id: F.weightGrams,
    label: 'Weight (grams)',
    group: 'variant',
    type: 'number',
    aliases: ['variant grams', 'grams', 'weight'],
  },
  {
    id: F.variantImage,
    label: 'Variant image',
    group: 'variant',
    type: 'url',
    aliases: ['variant image url'],
  },
  {
    id: F.image,
    label: 'Image',
    group: 'media',
    type: 'url',
    aliases: ['image url', 'image src', 'photo', 'picture'],
    description: 'One image per row; the first row’s is the photo the storefront leads with.',
  },
  {
    id: F.seoTitle,
    label: 'SEO title',
    group: 'seo',
    type: 'text',
    aliases: ['meta title', 'page title', 'search title'],
  },
  {
    id: F.seoDescription,
    label: 'SEO description',
    group: 'seo',
    type: 'longText',
    aliases: ['meta description', 'search description'],
  },
  {
    id: F.taxExempt,
    label: 'Tax exempt',
    group: 'selling',
    type: 'boolean',
    aliases: ['tax free', 'no tax'],
  },
  {
    id: F.oversellPolicy,
    label: 'When sold out',
    group: 'selling',
    type: 'picklist',
    picklistId: PRODUCT_OVERSELL_PICKLIST,
    aliases: ['oversell policy', 'inventory policy', 'backorders'],
    description: 'Stop selling, or Keep selling as a backorder.',
  },
  {
    id: F.lowStockThreshold,
    label: 'Low stock alert at',
    group: 'selling',
    type: 'integer',
    aliases: ['low stock threshold', 'reorder point'],
  },
]

export const PRODUCT_DERIVED_FIELDS: readonly TransferField[] = [
  { id: F.priceFrom, label: 'Lowest price', group: 'computed', type: 'number' },
  { id: F.totalInventory, label: 'Total inventory', group: 'computed', type: 'integer' },
  { id: F.soldOut, label: 'Sold out', group: 'computed', type: 'boolean' },
  { id: F.variantCount, label: 'Variants', group: 'computed', type: 'integer' },
]

export const PRODUCT_SYSTEM_FIELDS: readonly TransferField[] = [
  { id: F.createdAt, label: 'Created', group: TRANSFER_SYSTEM_GROUP.id, type: 'datetime' },
  { id: F.updatedAt, label: 'Updated', group: TRANSFER_SYSTEM_GROUP.id, type: 'datetime' },
]

/** Handle, then SKU, then the Aglyn ID. */
export const PRODUCT_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: F.handle, normalizer: 'slug' },
  { fieldId: F.sku, normalizer: 'caseless' },
  { fieldId: 'id', normalizer: 'aglynId' },
]

/**
 * A product's handle and its option names are changed in the product editor,
 * never by a file: the handle is the product's address, and renaming an
 * option moves every variant. A file gives a new product both, and names an
 * option a product does not have yet.
 */
export const PRODUCT_LOCKED_RULES: readonly TransferLockedRule[] = [
  {
    fieldId: F.handle,
    reason:
      'A product’s handle is its address; a file gives a new product one, and an existing product’s is changed in the product editor.',
    forced: { mode: 'fillBlanks', blank: 'leave' },
  },
  ...OPTION_NAME_FIELDS.map((fieldId) => ({
    fieldId,
    reason:
      'An option a product already has is renamed in the product editor, where every variant moves with it; a file only names an option the product does not have yet.',
    forced: { mode: 'fillBlanks' as const, blank: 'leave' as const },
  })),
]

/*==========================================
 * THE SHOPIFY LAYOUT
 *=========================================*/

/** Shopify's product CSV columns, by the field each one means. */
export const SHOPIFY_PRODUCT_COLUMNS: Readonly<Record<string, string>> = {
  [F.handle]: 'Handle',
  [F.title]: 'Title',
  [F.description]: 'Body (HTML)',
  [F.tags]: 'Tags',
  [F.published]: 'Published',
  [F.option1Name]: 'Option1 Name',
  [F.option1Value]: 'Option1 Value',
  [F.option2Name]: 'Option2 Name',
  [F.option2Value]: 'Option2 Value',
  [F.option3Name]: 'Option3 Name',
  [F.option3Value]: 'Option3 Value',
  [F.sku]: 'Variant SKU',
  [F.weightGrams]: 'Variant Grams',
  [F.inventory]: 'Variant Inventory Qty',
  [F.oversellPolicy]: 'Variant Inventory Policy',
  [F.price]: 'Variant Price',
  [F.compareAtPrice]: 'Variant Compare At Price',
  [F.barcode]: 'Variant Barcode',
  [F.image]: 'Image Src',
  [F.seoTitle]: 'SEO Title',
  [F.seoDescription]: 'SEO Description',
  [F.variantImage]: 'Variant Image',
  [F.status]: 'Status',
}

/** Shopify's export headers, so its file maps column for column. */
export const PRODUCT_ALIAS_DICTIONARIES: readonly TransferAliasDictionary[] = [
  {
    source: 'Shopify',
    aliases: Object.fromEntries(
      Object.entries(SHOPIFY_PRODUCT_COLUMNS).map(([fieldId, column]) => [fieldId, [column]]),
    ),
  },
]

/**
 * The Shopify preset: Shopify's product CSV columns, in Shopify's order and
 * under Shopify's names. Status is left out — Shopify reads it in lowercase
 * and Published says the same thing — and so is the kind, which Shopify's
 * "Type" does not mean.
 */
export const SHOPIFY_PRODUCT_PRESET: TransferResourcePreset = {
  id: 'shopify',
  label: 'Shopify',
  description: 'Shopify’s product CSV: its columns, its order and its names.',
  fieldIds: [
    F.handle,
    F.title,
    F.description,
    F.tags,
    F.published,
    F.option1Name,
    F.option1Value,
    F.option2Name,
    F.option2Value,
    F.option3Name,
    F.option3Value,
    F.sku,
    F.weightGrams,
    F.inventory,
    F.oversellPolicy,
    F.price,
    F.compareAtPrice,
    F.barcode,
    F.image,
    F.seoTitle,
    F.seoDescription,
    F.variantImage,
  ],
  headers: Object.fromEntries(
    Object.entries(SHOPIFY_PRODUCT_COLUMNS).filter(([fieldId]) => fieldId !== F.status),
  ),
}

/*==========================================
 * A PRODUCT AS RECORDS
 *=========================================*/

/** Where a product's record keeps its variants, apart from its fields. */
export const PRODUCT_VARIANT_ORDER = '$variants'

/** The record key one variant's values live under. */
export function productVariantKey(variantId: string): string {
  return `$variant:${variantId}`
}

/** A variant's values, as a file names them. */
export type VariantRecord = Record<string, unknown> & {
  /** Its stock is kept per location. */
  $byLocation?: boolean
}

/** A product as a stored document, the way every reader lifts one. */
type StoredProduct = Partial<HostProduct> & {
  createdAt?: unknown
  updatedAt?: unknown
  createdAtMs?: number
  updatedAtMs?: number
}

const isoOf = (value: unknown, ms?: number): string | null => {
  const time =
    typeof ms === 'number'
      ? ms
      : value && typeof (value as { toMillis?: () => number }).toMillis === 'function'
        ? (value as { toMillis: () => number }).toMillis()
        : typeof value === 'number'
          ? value
          : null
  return time === null || !Number.isFinite(time) ? null : new Date(time).toISOString()
}

/** One variant as a file names it. */
export function variantRecord(variant: ProductVariant, options: readonly ProductOption[]): VariantRecord {
  const values: VariantRecord = {
    [F.sku]: variant.sku ?? null,
    [F.barcode]: variant.barcode ?? null,
    [F.price]: Number.isFinite(Number(variant.priceUsd)) ? Number(variant.priceUsd) : null,
    [F.compareAtPrice]: variant.compareAtPriceUsd ?? null,
    [F.inventory]: typeof variant.inventory === 'number' ? variant.inventory : null,
    [F.weightGrams]: variant.weightGrams ?? null,
    [F.variantImage]: variant.imageUrl ?? null,
  }
  OPTION_VALUE_FIELDS.forEach((fieldId, axis) => {
    const name = options[axis]?.name
    values[fieldId] = name ? (variant.options?.[name] ?? null) : null
  })
  if (variant.inventoryByLocation && Object.keys(variant.inventoryByLocation).length) values.$byLocation = true
  return values
}

/**
 * A product as one record: its fields by field id, and its variants under
 * {@link productVariantKey} in the order {@link PRODUCT_VARIANT_ORDER} lists
 * them. The lookup answers this shape, so the dry run's before → after and
 * undo's "edited since" both read a product the way a file names it.
 */
export function productRecord(
  stored: StoredProduct,
  categoryNames: ReadonlyMap<string, string> = new Map(),
): Record<string, unknown> {
  const product = stored as HostProduct
  const options = product.options ?? []
  const variants = Array.isArray(product.variants) ? product.variants : []
  const [low] = variants.length ? productPriceRange(product) : [null]
  const total = variants.length ? productInventory(product) : null
  const record: Record<string, unknown> = {
    [F.handle]: product.slug ?? null,
    [F.title]: product.name ?? null,
    [F.description]: product.description ?? null,
    [F.kind]: fixedListLabel(PRODUCT_KIND_PICKLIST, product.type ?? 'physical'),
    [F.status]: fixedListLabel(PRODUCT_STATUS_PICKLIST, product.status ?? 'active'),
    [F.published]: (product.status ?? 'active') === 'active',
    [F.tags]: product.tags?.length ? product.tags.join(', ') : null,
    [F.categories]: (product.categoryIds ?? []).map((id) => categoryNames.get(id) ?? id),
    [F.image]: product.mediaUrls?.length ? [...product.mediaUrls] : product.imageUrl ? [product.imageUrl] : [],
    [F.seoTitle]: product.seo?.title ?? null,
    [F.seoDescription]: product.seo?.description ?? null,
    [F.taxExempt]: product.taxExempt ?? null,
    [F.oversellPolicy]: fixedListLabel(PRODUCT_OVERSELL_PICKLIST, product.oversellPolicy ?? 'deny'),
    [F.lowStockThreshold]: product.lowStockThreshold ?? null,
    [F.priceFrom]: low,
    [F.totalInventory]: total,
    [F.soldOut]: total !== null && total <= 0 && product.oversellPolicy !== 'backorder',
    [F.variantCount]: variants.length,
    [F.createdAt]: isoOf(stored.createdAt, stored.createdAtMs),
    [F.updatedAt]: isoOf(stored.updatedAt, stored.updatedAtMs),
    [PRODUCT_VARIANT_ORDER]: variants.map((variant) => variant.id),
  }
  OPTION_NAME_FIELDS.forEach((fieldId, axis) => {
    record[fieldId] = options[axis]?.name ?? null
  })
  for (const variant of variants) record[productVariantKey(variant.id)] = variantRecord(variant, options)
  return record
}

/**
 * A product's rows in a file, holding only `fieldIds`: one per variant (and
 * per image past the variants), the product's own fields on the first, the
 * handle and the ID on every one.
 */
export function productExportRows(
  id: string,
  stored: StoredProduct,
  fieldIds: readonly string[],
  categoryNames: ReadonlyMap<string, string> = new Map(),
): Array<Record<string, unknown>> {
  const record = productRecord(stored, categoryNames)
  const variantIds = record[PRODUCT_VARIANT_ORDER] as string[]
  const images = record[F.image] as string[]
  const count = Math.max(1, variantIds.length, images.length)
  const variantFields = new Set(VARIANT_LEVEL_FIELDS)
  const rows: Array<Record<string, unknown>> = []
  for (let index = 0; index < count; index += 1) {
    const variantId = variantIds[index]
    const variant = variantId ? (record[productVariantKey(variantId)] as VariantRecord) : null
    const row: Record<string, unknown> = {}
    for (const fieldId of fieldIds) {
      if (fieldId === 'id') row[fieldId] = id
      else if (fieldId === F.handle) row[fieldId] = record[F.handle]
      else if (fieldId === F.image) row[fieldId] = images[index] ?? null
      else if (variantFields.has(fieldId)) row[fieldId] = variant ? (variant[fieldId] ?? null) : null
      else row[fieldId] = index === 0 ? (record[fieldId] ?? null) : null
    }
    rows.push(row)
  }
  return rows
}

/** How many rows {@link productExportRows} writes for a product. */
export function productExportRowCount(stored: Pick<StoredProduct, 'variants' | 'mediaUrls' | 'imageUrl'>): number {
  const variants = Array.isArray(stored.variants) ? stored.variants.length : 0
  const images = stored.mediaUrls?.length ?? (stored.imageUrl ? 1 : 0)
  return Math.max(1, variants, images)
}

/*==========================================
 * THE PLAN
 *=========================================*/

/** What a planned product row carries for the apply. */
export interface ProductRowPlan {
  /** The product the row writes: its id, or the id a new one is created under. */
  productId: string
  /** The file row carrying the product's own fields. */
  leader: number
  /**
   * `create` makes the product (its leader); `part` is a row folded into a
   * product the leader creates; `update` writes this row's changes into an
   * existing product.
   */
  role: 'create' | 'part' | 'update'
  /** The variant this row writes, when it writes one. */
  variant?: { id: string; isNew: boolean }
  /** On a new product's leader: the whole document's parts. */
  create?: {
    slug: string
    values: Record<string, unknown>
    variants: Array<{ id: string; values: Record<string, unknown> }>
  }
  /** Why the product this row belongs to cannot be stored, when it cannot. */
  problem?: string
}

/** A planned row with what the apply needs. */
export type ProductPlannedRow = PlannedTransferRow & { commerce?: ProductRowPlan }

export interface ProductPlanContext {
  /** A new product's id. */
  newProductId(): string
  /** A new variant's id, unique within its product. */
  newVariantId(): string
  /** Whether a slug is held by a product already (deleted ones included). */
  slugTaken?(slug: string): boolean
  /** How many products the site may still create; unbounded when absent. */
  maxCreates?: number
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim())

/** A money cell as US dollars: the derived amount, or the number as typed. */
function dollars(value: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value === 'number') return { ok: true, value }
  if (typeof value === 'object' && 'amountMinor' in (value as object)) {
    const amount = value as { amountMinor: number; currency: string }
    if (String(amount.currency).toUpperCase() !== 'USD') {
      return { ok: false, message: `Prices are in US dollars; ${amount.currency} is not converted.` }
    }
    return { ok: true, value: Math.round(Number(amount.amountMinor)) / 100 }
  }
  const number = Number(value)
  return Number.isFinite(number) ? { ok: true, value: number } : { ok: false, message: `"${String(value)}" is not a price.` }
}

/** The tags a cell names, in their own case. */
export function productTagList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',')
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const tag = String(raw).trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/**
 * A row's values the way the plan compares them with a record: prices in
 * dollars, a fixed list's label checked, tags as one comma list, Published
 * read as the status. What cannot be read is dropped as a located problem.
 */
function normalizeRow(row: TransferPlanRow): TransferPlanRow {
  const values: Record<string, unknown> = { ...row.values }
  const problems = [...(row.problems ?? [])]
  const drop = (fieldId: string, code: DeriveProblemCode, message: string) => {
    problems.push({ fieldId, raw: text(values[fieldId]), code, message })
    delete values[fieldId]
  }
  for (const fieldId of [F.price, F.compareAtPrice]) {
    if (!(fieldId in values)) continue
    const read = dollars(values[fieldId])
    if ('message' in read) drop(fieldId, 'invalidCurrency', read.message)
    else values[fieldId] = read.value
  }
  for (const [fieldId, picklistId] of [
    [F.kind, PRODUCT_KIND_PICKLIST],
    [F.status, PRODUCT_STATUS_PICKLIST],
    [F.oversellPolicy, PRODUCT_OVERSELL_PICKLIST],
  ] as const) {
    if (isBlankTransferValue(values[fieldId])) continue
    const id = fixedListId(picklistId, values[fieldId])
    if (id) values[fieldId] = fixedListLabel(picklistId, id)
    else drop(fieldId, 'invalidJson', `"${text(values[fieldId])}" is not one of ${PRODUCT_FIXED_PICKLISTS[picklistId]?.standardValues.map((entry) => entry.label).join(', ')}.`)
  }
  if (F.tags in values && !isBlankTransferValue(values[F.tags])) {
    values[F.tags] = productTagList(values[F.tags]).join(', ')
  }
  if (F.handle in values && !isBlankTransferValue(values[F.handle])) {
    const slug = commerceSlug(text(values[F.handle]))
    if (slug) values[F.handle] = slug
    else drop(F.handle, 'invalidUrl', `"${text(values[F.handle])}" has no letters or numbers to make a handle from.`)
  }
  if (F.published in values) {
    if (isBlankTransferValue(values[F.status]) && typeof values[F.published] === 'boolean') {
      values[F.status] = values[F.published] ? STATUS_LABELS.active : STATUS_LABELS.draft
    }
    delete values[F.published]
  }
  return { ...row, values, ...(problems.length ? { problems } : {}) }
}

const pick = (values: Readonly<Record<string, unknown>>, fieldIds: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const fieldId of fieldIds) if (fieldId in values) out[fieldId] = values[fieldId]
  return out
}

const hasAny = (values: Readonly<Record<string, unknown>>, fieldIds: readonly string[]): boolean =>
  fieldIds.some((fieldId) => !isBlankTransferValue(values[fieldId]))

/** Which product a row belongs to in the file. */
function groupKey(row: TransferPlanRow, position: number): string {
  const handle = text(row.values[F.handle])
  if (handle) return `h:${handle}`
  const id = text(row.values['id'])
  if (id) return `i:${id}`
  return `r:${position}`
}

interface Group {
  key: string
  positions: number[]
}

/** Warnings, tallied the way the core tallies them, for what this plan adds and merges. */
class Tally {
  private readonly byClass = new Map<TransferWarningClass, TransferWarning & { rowSet: Set<number>; fieldSet: Set<string> }>()

  merge(warnings: readonly TransferWarning[]): void {
    for (const warning of warnings) {
      const entry = this.entry(warning.class, warning.requiresAcknowledgement)
      entry.count += warning.count
      for (const sample of warning.samples) {
        entry.rowSet.add(sample.row)
        if (entry.samples.length < 5) entry.samples.push(sample)
      }
      for (const fieldId of warning.fieldIds) entry.fieldSet.add(fieldId)
      entry.requiresAcknowledgement ||= warning.requiresAcknowledgement
    }
  }

  add(warningClass: TransferWarningClass, sample: TransferWarningSample): void {
    const entry = this.entry(warningClass, true)
    entry.count += 1
    entry.rowSet.add(sample.row)
    if (sample.fieldId) entry.fieldSet.add(sample.fieldId)
    if (entry.samples.length < 5) entry.samples.push(sample)
  }

  private entry(warningClass: TransferWarningClass, acknowledge: boolean) {
    let entry = this.byClass.get(warningClass)
    if (!entry) {
      entry = {
        class: warningClass,
        count: 0,
        rows: 0,
        fieldIds: [],
        samples: [],
        requiresAcknowledgement: acknowledge,
        rowSet: new Set(),
        fieldSet: new Set(),
      }
      this.byClass.set(warningClass, entry)
    }
    return entry
  }

  list(order: readonly TransferWarningClass[]): TransferWarning[] {
    return [...this.byClass.values()]
      .sort((a, b) => order.indexOf(a.class) - order.indexOf(b.class))
      .map(({ rowSet, fieldSet, ...warning }) => ({
        ...warning,
        rows: Math.max(rowSet.size, warning.rows),
        fieldIds: [...fieldSet],
      }))
  }
}

/** The order the core lists warning classes in. */
const WARNING_ORDER: readonly TransferWarningClass[] = TRANSFER_WARNING_CLASSES

/** A variant line's identity in the product it targets. */
function optionKey(values: Readonly<Record<string, unknown>>, names: readonly (string | null)[]): string | null {
  const parts: string[] = []
  OPTION_VALUE_FIELDS.forEach((fieldId, axis) => {
    const value = text(values[fieldId])
    if (value && names[axis]) parts.push(`${names[axis]}=${value.toLowerCase()}`)
  })
  return parts.length ? parts.join('|') : null
}

/** The value a field's diff leaves, or what the record held. */
function after(diff: readonly TransferFieldChange[], before: Readonly<Record<string, unknown>>, fieldId: string): unknown {
  const change = diff.find((entry) => entry.fieldId === fieldId)
  return change ? change.after : before[fieldId]
}

/**
 * A product's document from its record values (see {@link productRecord}),
 * for checking what a plan would store with the model's own rules.
 */
export function productFromRecord(
  values: Readonly<Record<string, unknown>>,
  variants: ReadonlyArray<{ id: string; values: Readonly<Record<string, unknown>> }>,
): HostProduct {
  const names = OPTION_NAME_FIELDS.map((fieldId) => text(values[fieldId]))
  const options: ProductOption[] = []
  names.forEach((name, axis) => {
    if (!name) return
    const seen: string[] = []
    for (const variant of variants) {
      const value = text(variant.values[OPTION_VALUE_FIELDS[axis] as string])
      if (value && !seen.includes(value)) seen.push(value)
    }
    options.push({ name, values: seen })
  })
  return {
    name: text(values[F.title]),
    slug: text(values[F.handle]),
    type: (fixedListId(PRODUCT_KIND_PICKLIST, values[F.kind]) ?? 'physical') as ProductType,
    status: (fixedListId(PRODUCT_STATUS_PICKLIST, values[F.status]) ?? 'active') as ProductStatus,
    ...(options.length ? { options } : {}),
    variants: variants.map((variant) => variantFromRecord(variant.id, variant.values, names)),
  }
}

/** One variant of a document from its record values. */
export function variantFromRecord(
  id: string,
  values: Readonly<Record<string, unknown>>,
  optionNames: readonly (string | null | undefined)[],
): ProductVariant {
  const options: Record<string, string> = {}
  OPTION_VALUE_FIELDS.forEach((fieldId, axis) => {
    const name = text(optionNames[axis])
    const value = text(values[fieldId])
    if (name && value) options[name] = value
  })
  const number = (fieldId: string): number | undefined => {
    const raw = values[fieldId]
    return raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? undefined : Number(raw)
  }
  const inventory = number(F.inventory)
  return {
    id,
    ...(Object.keys(options).length ? { options } : {}),
    priceUsd: number(F.price) as number,
    ...(text(values[F.sku]) ? { sku: text(values[F.sku]) } : {}),
    ...(text(values[F.barcode]) ? { barcode: text(values[F.barcode]) } : {}),
    ...(number(F.compareAtPrice) !== undefined ? { compareAtPriceUsd: number(F.compareAtPrice) } : {}),
    ...(number(F.weightGrams) !== undefined ? { weightGrams: number(F.weightGrams) } : {}),
    ...(text(values[F.variantImage]) ? { imageUrl: text(values[F.variantImage]) } : {}),
    inventory: inventory === undefined ? null : Math.max(0, Math.round(inventory)),
  }
}

/** The fields a new product is refused without. */
const PRODUCT_PLAN_FIELDS = (fields: readonly TransferField[]) =>
  fields
    .filter((field) => !VARIANT_LEVEL_FIELDS.includes(field.id))
    .map((field) => (field.id === F.title ? { ...field, required: true } : field))
const VARIANT_PLAN_FIELDS = (fields: readonly TransferField[]) =>
  fields
    .filter((field) => VARIANT_LEVEL_FIELDS.includes(field.id))
    .map((field) => (field.id === F.price ? { ...field, required: true } : field))

/**
 * The products resource's plan: the core's plan per product and per variant,
 * folded back into one verdict per file row (see the block header).
 */
export function planProductTransfer(input: BuildTransferPlanInput, context: ProductPlanContext): TransferPlan {
  const rows = input.rows.map(normalizeRow)
  const tally = new Tally()

  // The groups, in the order their first rows appear.
  const groups = new Map<string, Group>()
  rows.forEach((row, position) => {
    const key = groupKey(row, position)
    const group = groups.get(key) ?? { key, positions: [] }
    group.positions.push(position)
    groups.set(key, group)
  })
  const ordered = [...groups.values()]

  // The product half: each group's first row, with the group's images and option names.
  const leaders = ordered.map((group): TransferPlanRow => {
    const first = rows[group.positions[0] as number] as TransferPlanRow
    const values = pick(first.values, [...PRODUCT_LEVEL_FIELDS, 'id'])
    const images: string[] = []
    for (const position of group.positions) {
      const url = text(rows[position]?.values[F.image])
      if (url && !images.includes(url)) images.push(url)
    }
    if (images.length) values[F.image] = images
    else delete values[F.image]
    OPTION_NAME_FIELDS.forEach((fieldId) => {
      if (!isBlankTransferValue(values[fieldId])) return
      for (const position of group.positions) {
        const name = text(rows[position]?.values[fieldId])
        if (name) {
          values[fieldId] = name
          break
        }
      }
    })
    return { ...first, values }
  })
  const leaderMatches = ordered.map(
    (group) => input.matches[group.positions[0] as number] ?? ({ kind: 'new' } as RowMatchOutcome),
  )
  const productPlan = buildTransferPlan({
    fields: PRODUCT_PLAN_FIELDS(input.fields),
    rows: leaders,
    matches: leaderMatches,
    existing: input.existing,
    policy: input.policy,
    limits: context.maxCreates === undefined ? {} : { maxCreates: context.maxCreates },
  })
  tally.merge(productPlan.warnings)

  const variantFields = VARIANT_PLAN_FIELDS(input.fields)
  const out: ProductPlannedRow[] = new Array(rows.length)
  // Slugs this plan gives new products, so two new ones never share one.
  const handedOut = new Set<string>()

  ordered.forEach((group, at) => {
    const planned = productPlan.rows[at] as PlannedTransferRow
    const leaderPosition = group.positions[0] as number
    const leaderIndex = (rows[leaderPosition] as TransferPlanRow).index
    const original = (position: number): RowMatchOutcome =>
      input.matches[position] ?? ({ kind: 'new' } as RowMatchOutcome)

    // A product that writes nothing: every row of it follows its first.
    if (planned.verdict === 'skip' || planned.verdict === 'fail') {
      for (const position of group.positions) {
        const row = rows[position] as TransferPlanRow
        out[position] =
          position === leaderPosition
            ? planned
            : {
                index: row.index,
                verdict: planned.verdict,
                recordId: null,
                ...(planned.reason ? { reason: planned.reason } : {}),
                diff: [],
                heldBack: [],
                warnings: [],
                match: original(position),
              }
      }
      return
    }

    const creating = planned.verdict === 'create'
    const productId = creating ? context.newProductId() : (planned.recordId as string)
    const before = creating ? {} : (input.existing.get(productId) ?? {})
    const optionNames = OPTION_NAME_FIELDS.map((fieldId) => text(after(planned.diff, before, fieldId)) || null)

    // The variants the product has, and which one each line names.
    const existingVariants = creating
      ? []
      : ((before[PRODUCT_VARIANT_ORDER] as string[] | undefined) ?? []).map((id) => ({
          id,
          values: (before[productVariantKey(id)] ?? {}) as VariantRecord,
        }))
    const lines = group.positions.filter((position) => {
      const values = (rows[position] as TransferPlanRow).values
      return hasAny(values, VARIANT_LEVEL_FIELDS)
    })
    const claimed = new Map<string, number>()
    const lineTargets = new Map<number, { id: string; isNew: boolean; via?: { fieldId: string; value: string } }>()
    const lineMatches: RowMatchOutcome[] = []
    const lineRows: TransferPlanRow[] = []
    const linePositions: number[] = []
    const existingVariantValues = new Map<string, Readonly<Record<string, unknown>>>()
    const duplicates = new Map<number, number>()
    for (const position of lines) {
      const row = rows[position] as TransferPlanRow
      const sku = text(row.values[F.sku]).toLowerCase()
      const key = optionKey(row.values, optionNames)
      let target = sku ? existingVariants.find((variant) => text(variant.values[F.sku]).toLowerCase() === sku) : undefined
      let via: { fieldId: string; value: string } | undefined = sku ? { fieldId: F.sku, value: sku } : undefined
      if (!target && key) {
        target = existingVariants.find((variant) => optionKey(variant.values, optionNames) === key)
        via = { fieldId: F.option1Value, value: key }
      }
      if (!target && !key && !sku && existingVariants.length === 1 && lines.length === 1) {
        target = existingVariants[0]
        via = { fieldId: 'id', value: target?.id ?? '' }
      }
      // Two lines naming one variant, or one new variant twice: the first one counts.
      const identity = target ? `v:${target.id}` : sku ? `s:${sku}` : key ? `o:${key}` : null
      const earlier = identity ? claimed.get(identity) : undefined
      if (earlier !== undefined) {
        duplicates.set(position, earlier)
        continue
      }
      if (identity) claimed.set(identity, position)
      const id = target ? target.id : context.newVariantId()
      lineTargets.set(position, { id, isNew: !target, ...(via ? { via } : {}) })
      lineRows.push({ ...row, values: pick(row.values, VARIANT_LEVEL_FIELDS) })
      linePositions.push(position)
      if (target) {
        existingVariantValues.set(`${productId}::${target.id}`, target.values)
        lineMatches.push({ kind: 'matched', recordId: `${productId}::${target.id}`, via: via as { fieldId: string; value: string } })
      } else {
        lineMatches.push({ kind: 'new' })
      }
    }
    const variantPlan = buildTransferPlan({
      fields: variantFields,
      rows: lineRows,
      matches: lineMatches,
      existing: existingVariantValues,
      policy: input.policy,
    })
    tally.merge(variantPlan.warnings)
    const lineVerdicts = new Map<number, PlannedTransferRow>()
    lineRows.forEach((row, at) => {
      const position = linePositions[at] as number
      const verdict = variantPlan.rows[at] as PlannedTransferRow
      const target = lineTargets.get(position)
      // Stock kept per location moves per location, never as one total.
      if (target && !target.isNew && verdict.verdict === 'update') {
        const values = existingVariantValues.get(`${productId}::${target.id}`) as VariantRecord | undefined
        if (values?.$byLocation && verdict.diff.some((change) => change.fieldId === F.inventory)) {
          verdict.diff = verdict.diff.filter((change) => change.fieldId !== F.inventory)
          verdict.heldBack = [...verdict.heldBack, F.inventory]
          verdict.warnings = [...new Set([...verdict.warnings, 'lockedRule' as const])]
          tally.add('lockedRule', {
            row: row.index,
            fieldId: F.inventory,
            value: text(row.values[F.inventory]),
            detail: 'This variant’s stock is kept by location; change it per location on the products page.',
          })
          if (!verdict.diff.length) verdict.verdict = 'unchanged'
        }
      }
      lineVerdicts.set(position, verdict)
    })

    // A new product needs a variant.
    const createdLines = [...lineVerdicts.entries()].filter(([, verdict]) => verdict.verdict === 'create')
    if (creating && !createdLines.length) {
      for (const position of group.positions) {
        const row = rows[position] as TransferPlanRow
        out[position] = {
          index: row.index,
          verdict: 'fail',
          recordId: null,
          reason: 'missingRequired',
          missing: [F.price],
          diff: position === leaderPosition ? planned.diff : [],
          heldBack: [],
          warnings: position === leaderPosition ? planned.warnings : [],
          match: original(position),
        }
      }
      return
    }

    // The handle a new product is stored under: the file's, or one made from its title.
    let slug = ''
    let problem: string | undefined
    if (creating) {
      const base = text(after(planned.diff, before, F.handle)) || commerceSlug(text(after(planned.diff, before, F.title))) || 'product'
      const taken = (candidate: string) => handedOut.has(candidate) || Boolean(context.slugTaken?.(candidate))
      slug = base
      for (let suffix = 2; taken(slug); suffix += 1) {
        const tail = `-${suffix}`
        slug = `${base.slice(0, COMMERCE_SLUG_MAX_LENGTH - tail.length)}${tail}`
      }
      handedOut.add(slug)
      if (slug !== base) {
        tally.add('lockedRule', {
          row: leaderIndex,
          fieldId: F.handle,
          value: base,
          detail: `Another product holds /products/${base}; this one is created at /products/${slug}.`,
        })
        planned.warnings = [...new Set([...planned.warnings, 'lockedRule' as const])]
        planned.heldBack = [...planned.heldBack, F.handle]
      }
    }

    // What the product would hold once every row of it is written, by the model's own rules.
    const productValues: Record<string, unknown> = { ...before }
    for (const change of planned.diff) productValues[change.fieldId] = change.after
    if (creating) productValues[F.handle] = slug
    const finalVariants = existingVariants.map((variant) => ({ id: variant.id, values: { ...variant.values } as Record<string, unknown> }))
    for (const [position, verdict] of lineVerdicts) {
      if (verdict.verdict !== 'create' && verdict.verdict !== 'update') continue
      const target = lineTargets.get(position) as { id: string; isNew: boolean }
      let entry = finalVariants.find((variant) => variant.id === target.id)
      if (!entry) {
        entry = { id: target.id, values: {} }
        finalVariants.push(entry)
      }
      for (const change of verdict.diff) entry.values[change.fieldId] = change.after
    }
    if (finalVariants.length > COMMERCE_MAX_VARIANTS) {
      problem = `A product holds at most ${COMMERCE_MAX_VARIANTS} variants; this file gives it ${finalVariants.length}.`
    } else {
      const check = validateProduct(productFromRecord(productValues, finalVariants))
      if (check) problem = check
    }

    const create = creating
      ? {
          slug,
          values: Object.fromEntries(planned.diff.map((change) => [change.fieldId, change.after])),
          variants: createdLines.map(([position, verdict]) => ({
            id: (lineTargets.get(position) as { id: string }).id,
            values: Object.fromEntries(verdict.diff.map((change) => [change.fieldId, change.after])),
          })),
        }
      : undefined

    for (const position of group.positions) {
      const row = rows[position] as TransferPlanRow
      const isLeader = position === leaderPosition
      const line = lineVerdicts.get(position)
      const target = lineTargets.get(position)
      const duplicateOf = duplicates.get(position)
      const base: Pick<PlannedTransferRow, 'index' | 'match'> = { index: row.index, match: original(position) }
      if (duplicateOf !== undefined) {
        const firstRow = (rows[duplicateOf] as TransferPlanRow).index
        tally.add('duplicateInFile', {
          row: row.index,
          fieldId: F.sku,
          value: text(row.values[F.sku]) || text(row.values[F.option1Value]),
          detail: `The same variant as row ${firstRow + 1}`,
        })
        out[position] = {
          ...base,
          verdict: 'skip',
          recordId: creating ? null : productId,
          reason: 'duplicateInFile',
          diff: [],
          heldBack: [],
          warnings: ['duplicateInFile'],
        }
        continue
      }
      const productDiff = isLeader ? planned.diff : []
      const lineDiff = line && (line.verdict === 'create' || line.verdict === 'update') ? line.diff : []
      const writes = productDiff.length + lineDiff.length > 0
      const lineFailed = line && (line.verdict === 'fail' || line.verdict === 'skip')
      if (lineFailed && isLeader && (productDiff.length || creating)) {
        // The product's own changes still land; the variant on this row does not, and says so.
        tally.add('droppedCell', {
          row: row.index,
          ...(line.missing?.[0] ? { fieldId: line.missing[0] } : {}),
          detail: `The variant on this row is not written (${line.reason ?? line.verdict}).`,
        })
      }
      const warnings = [...new Set([...(isLeader ? planned.warnings : []), ...(line?.warnings ?? [])])]
      const heldBack = [...(isLeader ? planned.heldBack : []), ...(line?.heldBack ?? [])]
      const plan: ProductRowPlan = {
        productId,
        leader: leaderIndex,
        role: creating ? (isLeader ? 'create' : 'part') : 'update',
        ...(target && lineDiff.length ? { variant: { id: target.id, isNew: target.isNew } } : {}),
        ...(isLeader && create ? { create } : {}),
        ...(problem ? { problem } : {}),
      }
      if (lineFailed && (!isLeader || !(productDiff.length || creating))) {
        out[position] = {
          ...base,
          verdict: line.verdict,
          recordId: creating ? null : productId,
          ...(line.reason ? { reason: line.reason } : {}),
          ...(line.missing ? { missing: line.missing } : {}),
          diff: [],
          heldBack,
          warnings,
        }
        continue
      }
      const verdict: PlannedTransferRow['verdict'] = creating
        ? isLeader || writes
          ? 'create'
          : 'unchanged'
        : writes
          ? 'update'
          : 'unchanged'
      out[position] = {
        ...base,
        verdict,
        recordId: creating ? null : productId,
        diff: [...productDiff, ...lineDiff],
        heldBack,
        warnings,
        ...(verdict === 'create' || verdict === 'update' ? { commerce: plan } : problem ? { commerce: plan } : {}),
      } as ProductPlannedRow
    }
  })

  const summary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: out.length }
  for (const row of out) summary[row.verdict] += 1
  const warnings = tally.list(WARNING_ORDER)
  return {
    rows: out,
    summary,
    warnings,
    acknowledgementsRequired: warnings.filter((entry) => entry.requiresAcknowledgement).map((entry) => entry.class),
  }
}

/** The handles a plan may create products under, for the server to ask which are taken. */
export function productPlanHandles(rows: readonly TransferPlanRow[]): string[] {
  const out = new Set<string>()
  for (const row of rows) {
    const handle = commerceSlug(text(row.values[F.handle])) || commerceSlug(text(row.values[F.title]))
    if (handle) out.add(handle)
  }
  return [...out]
}

/*==========================================
 * WHAT A PLANNED ROW WRITES
 *=========================================*/

/** Category names → ids, for the categories a row names. */
export type CategoryIdsOf = (names: readonly string[]) => string[]

/** The product fields a row's changes set, as the document stores them. */
function productFieldPatch(
  changes: Readonly<Record<string, unknown>>,
  categoryIdsOf: CategoryIdsOf,
): Partial<HostProduct> & { seo?: HostProduct['seo'] } {
  const patch: Partial<HostProduct> = {}
  const has = (fieldId: string) => fieldId in changes
  const value = (fieldId: string) => changes[fieldId]
  if (has(F.title)) patch.name = text(value(F.title))
  if (has(F.description)) patch.description = text(value(F.description)) || undefined
  if (has(F.kind)) patch.type = (fixedListId(PRODUCT_KIND_PICKLIST, value(F.kind)) ?? 'physical') as ProductType
  if (has(F.status)) patch.status = (fixedListId(PRODUCT_STATUS_PICKLIST, value(F.status)) ?? 'active') as ProductStatus
  if (has(F.tags)) patch.tags = productTagList(value(F.tags))
  if (has(F.categories)) {
    const names = Array.isArray(value(F.categories)) ? (value(F.categories) as unknown[]).map(text).filter(Boolean) : []
    patch.categoryIds = categoryIdsOf(names)
  }
  if (has(F.image)) {
    const urls = Array.isArray(value(F.image)) ? (value(F.image) as unknown[]).map(text).filter(Boolean) : []
    patch.mediaUrls = urls
  }
  if (has(F.taxExempt)) patch.taxExempt = value(F.taxExempt) === true
  if (has(F.oversellPolicy)) {
    patch.oversellPolicy = (fixedListId(PRODUCT_OVERSELL_PICKLIST, value(F.oversellPolicy)) ?? 'deny') as 'deny' | 'backorder'
  }
  if (has(F.lowStockThreshold)) {
    const threshold = Number(value(F.lowStockThreshold))
    patch.lowStockThreshold = value(F.lowStockThreshold) === null || !Number.isFinite(threshold) ? undefined : Math.max(0, Math.round(threshold))
  }
  return patch
}

/** A product with one planned row's changes written into it — the product's own on its first row, and the row's variant. */
export function applyProductRow(
  current: HostProduct,
  changes: {
    product?: Readonly<Record<string, unknown>>
    variant?: { id: string; isNew: boolean; values: Readonly<Record<string, unknown>> }
  },
  categoryIdsOf: CategoryIdsOf,
): HostProduct {
  const next: HostProduct = {
    ...current,
    options: (current.options ?? []).map((option) => ({ ...option, values: [...option.values] })),
    variants: current.variants.map((variant) => ({ ...variant })),
  }
  const product = changes.product ?? {}
  Object.assign(next, productFieldPatch(product, categoryIdsOf))
  if (F.seoTitle in product || F.seoDescription in product) {
    const seo = { ...(current.seo ?? {}) }
    if (F.seoTitle in product) seo.title = text(product[F.seoTitle]) || undefined
    if (F.seoDescription in product) seo.description = text(product[F.seoDescription]) || undefined
    next.seo = Object.fromEntries(Object.entries(seo).filter(([, entry]) => entry !== undefined))
  }
  // An option the product does not have yet takes its name.
  const options = next.options as ProductOption[]
  OPTION_NAME_FIELDS.forEach((fieldId, axis) => {
    const name = text(product[fieldId])
    if (name && !options[axis]) options[axis] = { name, values: [] }
  })
  const variant = changes.variant
  if (variant) {
    const names = options.map((option) => option?.name ?? null)
    const at = next.variants.findIndex((entry) => entry.id === variant.id)
    const existing = at >= 0 ? (next.variants[at] as ProductVariant) : null
    const record = existing ? variantRecord(existing, options) : {}
    const merged = variantFromRecord(variant.id, { ...record, ...variant.values }, names)
    const written: ProductVariant = existing
      ? {
          ...existing,
          ...merged,
          // What a file never names is kept: stock by location, and anything the variant carries besides.
          ...(existing.inventoryByLocation ? { inventoryByLocation: existing.inventoryByLocation, inventory: existing.inventory } : {}),
        }
      : merged
    for (const key of ['sku', 'barcode', 'compareAtPriceUsd', 'weightGrams', 'imageUrl'] as const) {
      if (merged[key] === undefined) delete written[key]
    }
    if (at >= 0) next.variants[at] = written
    else next.variants.push(written)
    // Each option value the variant holds is one its option offers.
    options.forEach((option, axis) => {
      const value = text(variant.values[OPTION_VALUE_FIELDS[axis] as string])
      if (option && value && !option.values.includes(value)) option.values.push(value)
    })
  }
  next.options = options.filter(Boolean)
  if (!next.options.length) delete next.options
  return next
}

/** A new product's document from its leader's plan, before the platform's stamps. */
export function createProductDocument(
  create: NonNullable<ProductRowPlan['create']>,
  categoryIdsOf: CategoryIdsOf,
): HostProduct {
  const base = productFromRecord({ ...create.values, [F.handle]: create.slug }, create.variants)
  return applyProductRow(
    { ...base, variants: base.variants },
    { product: Object.fromEntries(Object.entries(create.values).filter(([fieldId]) => !OPTION_NAME_FIELDS.includes(fieldId as never))) },
    categoryIdsOf,
  )
}

/** The values one planned row changes, split into the product's and its variant's. */
export function productRowChanges(row: ProductPlannedRow): {
  product: Record<string, unknown>
  variant?: { id: string; isNew: boolean; values: Record<string, unknown> }
} {
  const product: Record<string, unknown> = {}
  const variant: Record<string, unknown> = {}
  for (const change of row.diff) {
    if (VARIANT_LEVEL_FIELDS.includes(change.fieldId)) variant[change.fieldId] = change.after
    else if (PRODUCT_LEVEL_FIELDS.includes(change.fieldId)) product[change.fieldId] = change.after
  }
  const target = row.commerce?.variant
  return { product, ...(target ? { variant: { ...target, values: variant } } : {}) }
}
