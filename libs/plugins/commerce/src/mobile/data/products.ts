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
  commitWithSiteWideEntryAs,
  releaseSiteWideOutboxEntry,
} from '@aglyn/aglyn/app-utils/site-wide-outbox'
import type { ListFilterRequest } from '@aglyn/shared-util-tools/list-query/list-filter'
import {
  deleteField,
  doc,
  type DocumentData,
  type DocumentReference,
  getDoc,
  runTransaction,
  type Transaction,
} from 'firebase/firestore'
import {
  PRODUCT_LIST_BASE,
  PRODUCT_LIST_QUERY,
  productListRequestClauses,
} from '../../lib/constants/product-list-query'
import {
  adjustVariantInventory,
  appliedVariantInventoryDelta,
  commerceSlug,
  type HostProduct,
  type InventoryAdjustment,
  type InventoryAdjustmentReason,
  isLowStock,
  liftLegacyProduct,
  productInventory,
  productPriceRange,
  productSearchFields,
  productStockFields,
  type ProductStatus,
  type ProductType,
  type ProductVariant,
  validateProduct,
} from '../../lib/model/commerce'
import { productCollectionFields, readSmartCollections } from '../../lib/model/smart-collection-reads'
import { type CommerceMobileContext, MobileApiError, newResourceId, nowOf } from './context'
import { type ListCursor, type ListPage, planList, readListPage, searchWords } from './list-page'
import { commerceKeys } from './orders'
import { scannedProductCode } from './scanned-codes'

/*
 * Products on the phone (AGL-3621): the catalog list and its search, one
 * product, create and edit, and a stock count.
 *
 * The list is the console's catalog table — `PRODUCT_LIST_QUERY` over live
 * products (`deletedAt == null`), name order — so a status chip, the search
 * word and a scanned barcode are each a predicate on the one query.
 *
 * Writes follow the console's doors: a NEW product goes through
 * `/api/hosts/resources`, which enforces the plan's product cap and the
 * commerce entitlement; an edit and a stock count are client writes under
 * the same rules, carrying the site-wide cache drop the product page is owed
 * (`site-wide-outbox`). Unlike the console's dialog, which replaces the whole
 * document from the copy it opened with, both run in a TRANSACTION over the
 * live document: a phone left open on a product for an hour must not write
 * back the stock count it read, after the till sold three.
 */

export const PRODUCTS_COLLECTION = (hostId: string) => `hosts/${hostId}/products`

export type ProductFilterId = 'all' | ProductStatus

export const PRODUCT_FILTERS: ReadonlyArray<{ id: ProductFilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Draft' },
  { id: 'archived', label: 'Archived' },
]

export interface ProductsListArgs {
  filter: ProductFilterId
  search?: string
  /** A scanned or typed code, matched whole against every variant's barcode or SKU. */
  code?: { field: ProductCodeField; value: string }
}

export function productsListRequest(args: ProductsListArgs) {
  const clauses: ListFilterRequest[] = []
  if (args.filter !== 'all') clauses.push({ field: 'status', op: 'equals', value: args.filter })
  if (args.code) clauses.push({ field: args.code.field, op: 'contains', value: args.code.value })
  return {
    base: PRODUCT_LIST_BASE,
    clauses: productListRequestClauses(clauses),
    // A code and a search word would both be the query's one array clause.
    search: args.code ? [] : searchWords(args.search ?? ''),
  }
}

export interface ProductRow {
  id: string
  name: string
  status: ProductStatus
  type: ProductType
  imageUrl: string | null
  /** Low and high variant price, in dollars as stored. */
  priceRange: [number, number]
  /** Tracked units across variants, or null when nothing is tracked. */
  inventory: number | null
  lowStock: boolean
  variantCount: number
}

export function productRow(id: string, data: DocumentData): ProductRow {
  const product = liftLegacyProduct(data as Partial<HostProduct> & { name?: string })
  return {
    id,
    name: product.name,
    status: product.status,
    type: product.type,
    imageUrl: product.mediaUrls?.[0] ?? product.imageUrl ?? null,
    priceRange: productPriceRange(product),
    inventory: productInventory(product),
    lowStock: isLowStock(product),
    variantCount: product.variants.length,
  }
}

export function productsListQuery(context: CommerceMobileContext, args: ProductsListArgs) {
  const plan = planList(PRODUCT_LIST_QUERY, productsListRequest(args))
  return {
    queryKey: [
      ...commerceKeys.products(context.hostId),
      'list',
      args.filter,
      args.search ?? '',
      args.code?.field ?? '',
      args.code?.value ?? '',
    ] as const,
    initialPageParam: null as ListCursor,
    queryFn: ({ pageParam }: { pageParam: ListCursor }): Promise<ListPage<ProductRow>> =>
      readListPage({
        firestore: context.firestore,
        path: PRODUCTS_COLLECTION(context.hostId),
        plan,
        cursor: pageParam,
        map: productRow,
      }),
    getNextPageParam: (page: ListPage<ProductRow>): ListCursor | undefined => page.next ?? undefined,
  }
}

export type ProductCodeField = 'barcodes' | 'skus'

/**
 * The products a scanned code names, and which key named them: by barcode
 * first, then by SKU — a shelf label may carry either. Live products only,
 * as the list. Null when the code is unreadable or names nothing.
 */
export async function matchProductCode(
  context: CommerceMobileContext,
  raw: string,
): Promise<{ field: ProductCodeField; code: string; rows: ProductRow[] } | null> {
  const code = scannedProductCode(raw)
  if (!code) return null
  for (const field of ['barcodes', 'skus'] as const) {
    const page = await productsListQuery(context, { filter: 'all', code: { field, value: code } }).queryFn({
      pageParam: null,
    })
    if (page.rows.length) return { field, code, rows: page.rows }
  }
  return null
}

/** The products a scanned code names; see `matchProductCode`. */
export async function findProductsByCode(context: CommerceMobileContext, raw: string): Promise<ProductRow[]> {
  return (await matchProductCode(context, raw))?.rows ?? []
}

/** One product, as the editor and the stock sheet read it. */
export interface ProductDetail {
  id: string
  product: HostProduct
  row: ProductRow
}

export function productQuery(context: CommerceMobileContext, productId: string) {
  return {
    queryKey: [...commerceKeys.products(context.hostId), 'one', productId] as const,
    queryFn: async (): Promise<ProductDetail | null> => {
      const snapshot = await getDoc(doc(context.firestore, PRODUCTS_COLLECTION(context.hostId), productId))
      const data = snapshot.data()
      if (!snapshot.exists() || !data || data['deletedAt']) return null
      return {
        id: snapshot.id,
        product: liftLegacyProduct(data as HostProduct),
        row: productRow(snapshot.id, data),
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Create and edit                                                     */
/* ------------------------------------------------------------------ */

/** What the phone's editor edits on a variant. Stock moves through `adjustStock`. */
export interface VariantEdit {
  id: string
  priceUsd: number
  compareAtPriceUsd?: number | null
  sku?: string
  barcode?: string
}

/** What the phone's editor edits. Options, SEO and digital files stay in the console. */
export interface ProductEdit {
  name: string
  description?: string
  status: ProductStatus
  type: ProductType
  mediaUrls: string[]
  variants: VariantEdit[]
}

/** A product nobody has saved yet, as the console's editor starts one. */
export function blankProductEdit(): ProductEdit & { inventory: number | null } {
  return {
    name: '',
    description: '',
    status: 'draft',
    type: 'physical',
    mediaUrls: [],
    variants: [{ id: 'default', priceUsd: 0 }],
    inventory: null,
  }
}

export function productEditOf(product: HostProduct): ProductEdit {
  return {
    name: product.name,
    description: product.description ?? '',
    status: product.status,
    type: product.type,
    mediaUrls: [...(product.mediaUrls ?? [])],
    variants: product.variants.map((variant) => ({
      id: variant.id,
      priceUsd: variant.priceUsd,
      compareAtPriceUsd: variant.compareAtPriceUsd ?? null,
      sku: variant.sku ?? '',
      barcode: variant.barcode ?? '',
    })),
  }
}

const trimmed = (value: string | undefined): string | undefined => {
  const text = (value ?? '').trim()
  return text ? text : undefined
}

/** The edit laid over a product: the live one for an edit, a blank one for a create. */
export function applyProductEdit(base: HostProduct, edit: ProductEdit): HostProduct {
  const byId = new Map(edit.variants.map((variant) => [variant.id, variant]))
  const variants: ProductVariant[] = base.variants.map((variant) => {
    const change = byId.get(variant.id)
    if (!change) return variant
    const next: ProductVariant = { ...variant, priceUsd: Number(change.priceUsd) }
    const compareAt = change.compareAtPriceUsd
    if (compareAt == null || compareAt === ('' as never)) delete next.compareAtPriceUsd
    else next.compareAtPriceUsd = Number(compareAt)
    const sku = trimmed(change.sku)
    const barcode = trimmed(change.barcode)
    if (sku) next.sku = sku
    else delete next.sku
    if (barcode) next.barcode = barcode
    else delete next.barcode
    return next
  })
  const name = edit.name.trim().slice(0, 120)
  return {
    ...base,
    name,
    slug: base.slug || commerceSlug(name),
    description: edit.description ?? base.description,
    status: edit.status,
    type: edit.type,
    mediaUrls: [...edit.mediaUrls],
    variants,
  }
}

/** Why the edit cannot be saved, or null — the console editor's own check. */
export function checkProductEdit(base: HostProduct, edit: ProductEdit): string | null {
  return validateProduct(applyProductEdit(base, edit))
}

/** The derived keys every product writer stamps beside what was edited. */
function derivedFields(product: HostProduct) {
  return {
    ...productSearchFields({ name: product.name, variants: product.variants }),
    priceUsd: product.variants[0]?.priceUsd ?? 0,
    ...productStockFields({ variants: product.variants, oversellPolicy: product.oversellPolicy }),
    imageUrl: product.mediaUrls?.[0] ?? product.imageUrl ?? null,
  }
}

/** Asks the console to drop the site's cached pages; the outbox entry is the fallback. */
async function settleCacheDrop(context: CommerceMobileContext, entry: DocumentReference | null): Promise<void> {
  const reason = await context.api
    .request<{ reason?: string }>('screens/revalidate', {
      method: 'POST',
      body: { hostId: context.hostId, entireHost: true },
    })
    .then((body) => (typeof body?.reason === 'string' ? body.reason : 'ok'))
    .catch(() => null)
  await releaseSiteWideOutboxEntry(entry, reason)
}

/** A transaction over the site's documents, with the site-wide cache drop staged beside it. */
async function writeSiteWide(
  context: CommerceMobileContext,
  write: (transaction: Transaction) => Promise<void>,
): Promise<void> {
  const entry = await commitWithSiteWideEntryAs(
    context.hostId,
    (stage) =>
      runTransaction(context.firestore, async (transaction) => {
        await write(transaction)
        stage?.(transaction, context.firestore)
      }),
    newResourceId,
  )
  void settleCacheDrop(context, entry)
}

/** A new product id, minted once per editor so a retried create cannot make two. */
export function newProductId(): string {
  return newResourceId()
}

/**
 * Creates a product through the resources route, under an id the editor
 * minted when it opened: a retry after a lost response finds its own product
 * (409) and counts as the save it was.
 */
export async function createProduct(
  context: CommerceMobileContext,
  input: { productId: string; edit: ProductEdit; inventory?: number | null },
): Promise<{ id: string }> {
  const blank: HostProduct = {
    name: '',
    slug: '',
    type: input.edit.type,
    status: input.edit.status,
    variants: input.edit.variants.map((variant) => ({
      id: variant.id,
      priceUsd: 0,
      ...(input.inventory != null && input.edit.variants.length === 1
        ? { inventory: Math.max(0, Math.round(input.inventory)) }
        : {}),
    })),
  }
  const product = applyProductEdit(blank, input.edit)
  const problem = validateProduct(product)
  if (problem) throw new MobileApiError(problem, 400)
  const membership = await productCollectionFields(context.firestore, context.hostId, {
    name: product.name,
    type: product.type,
    tags: product.tags,
    categoryIds: product.categoryIds,
    variants: product.variants,
  })
  const now = nowOf(context)
  try {
    await context.api.request('hosts/resources', {
      method: 'POST',
      body: {
        hostId: context.hostId,
        resource: 'product',
        id: input.productId,
        data: { ...product, ...derivedFields(product), ...membership, createdAtMs: now, updatedAtMs: now },
      },
    })
  } catch (error) {
    if ((error as { status?: unknown } | null)?.status !== 409) throw error
  }
  return { id: input.productId }
}

/** Saves an edit over the LIVE product, re-deriving its search, stock and collection keys. */
export async function updateProduct(
  context: CommerceMobileContext,
  input: { productId: string; edit: ProductEdit },
): Promise<void> {
  const ref = doc(context.firestore, PRODUCTS_COLLECTION(context.hostId), input.productId)
  // Read outside the transaction: the smart collections are rules, not the product.
  const smart = await readSmartCollections(context.firestore, context.hostId)
  await writeSiteWide(context, async (transaction) => {
    const snapshot = await transaction.get(ref)
    const data = snapshot.data()
    if (!snapshot.exists() || !data || data['deletedAt']) {
      throw new MobileApiError('This product was deleted', 404)
    }
    const product = applyProductEdit(liftLegacyProduct(data as HostProduct), input.edit)
    const problem = validateProduct(product)
    if (problem) throw new MobileApiError(problem, 400)
    const derived = derivedFields(product)
    const membership = await productCollectionFields(
      context.firestore,
      context.hostId,
      { name: product.name, type: product.type, tags: product.tags, categoryIds: product.categoryIds, variants: product.variants },
      smart,
    )
    transaction.update(ref, {
      name: product.name,
      slug: product.slug,
      description: product.description ?? '',
      status: product.status,
      type: product.type,
      mediaUrls: product.mediaUrls ?? [],
      variants: product.variants,
      ...derived,
      // `productSearchFields` omits a key with no codes; a stored one must go.
      skus: derived.skus ?? deleteField(),
      barcodes: derived.barcodes ?? deleteField(),
      ...membership,
      updatedAtMs: nowOf(context),
    })
  })
}

/* ------------------------------------------------------------------ */
/* Stock                                                               */
/* ------------------------------------------------------------------ */

export const STOCK_REASONS: ReadonlyArray<{ id: InventoryAdjustmentReason; label: string }> = [
  { id: 'restock', label: 'Restock' },
  { id: 'correction', label: 'Correction' },
  { id: 'damage', label: 'Damaged' },
]

export interface StockAdjustInput {
  productId: string
  variantId: string
  /** Units added (positive) or removed (negative). */
  delta: number
  reason: InventoryAdjustmentReason
  locationId?: string
}

/**
 * Moves a variant's count and writes the ledger row in ONE transaction over
 * the live product: the console writes the two separately, from the count it
 * loaded, and a sale between the load and the save is overwritten. Records
 * `appliedDelta` when the floor absorbed part of a removal, as the sale path
 * does, so a later reversal restores only what moved.
 */
export async function adjustStock(context: CommerceMobileContext, input: StockAdjustInput): Promise<{ inventory: number | null }> {
  const delta = Math.round(Number(input.delta))
  if (!Number.isFinite(delta) || delta === 0) throw new MobileApiError('Enter a number of units', 400)
  const ref = doc(context.firestore, PRODUCTS_COLLECTION(context.hostId), input.productId)
  const ledger = doc(context.firestore, `hosts/${context.hostId}/inventoryAdjustments`, newResourceId())
  let inventory: number | null = null
  await writeSiteWide(context, async (transaction) => {
    const snapshot = await transaction.get(ref)
    const data = snapshot.data()
    if (!snapshot.exists() || !data) throw new MobileApiError('This product was deleted', 404)
    const product = liftLegacyProduct(data as HostProduct)
    const variant = product.variants.find((entry) => entry.id === input.variantId)
    if (!variant) throw new MobileApiError('That variant is no longer on this product', 404)
    if (variant.inventory == null) throw new MobileApiError('Stock is not tracked for this variant', 409)
    const applied = appliedVariantInventoryDelta(product, input.variantId, delta, input.locationId)
    const variants = adjustVariantInventory(product, input.variantId, delta, input.locationId)
    const stock = productStockFields({ variants, oversellPolicy: product.oversellPolicy })
    inventory = stock.inventory
    const now = nowOf(context)
    transaction.update(ref, { variants, ...stock, updatedAtMs: now })
    const row: InventoryAdjustment = {
      productId: input.productId,
      variantId: input.variantId,
      delta,
      ...(applied !== delta ? { appliedDelta: applied } : {}),
      reason: input.reason,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      atMs: now,
    }
    transaction.set(ledger, row)
  })
  return { inventory }
}
