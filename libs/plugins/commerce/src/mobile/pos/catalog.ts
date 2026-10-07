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

import type { ListQueryFilter } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  collection,
  type DocumentData,
  type Firestore,
  getDocs,
  limit,
  query,
} from 'firebase/firestore'
import { PRODUCT_LIST_BASE, PRODUCT_LIST_QUERY } from '../../lib/constants/product-list-query'
import {
  type HostProduct,
  liftLegacyProduct,
  type ProductCategory,
  type ProductVariant,
  variantHasPrice,
} from '../../lib/model/commerce'
import { type ListCursor, type ListPage, planList, readListPage } from '../data/list-page'
import {
  lineLabelWithModifiers,
  type ModifierSelection,
  productModifierGroups,
  type ProductModifierGroup,
  resolveLineModifiers,
} from '../../lib/model/product-modifiers'
import { productsListRequest } from '../data/products'
import { scannedProductCode } from '../data/scanned-codes'
import type { PosCartPick } from './cart'

/*==========================================
 * WHAT THE TILL SELLS (AGL-3618).
 *
 * The register's item grid reads the catalog the console's register reads:
 * live, ACTIVE products in name order, with a typed word as the name search
 * and a scan as a whole-code lookup over the flattened `barcodes`/`skus`
 * arrays (`PRODUCT_LIST_QUERY`, the products hub's declaration). A category
 * tile is one more predicate on that same query (`categoryIds` contains),
 * served by the hub's `(categoryIds, nameLower)` composite; the planner
 * refuses a category and a search word together, since Firestore takes one
 * array clause, so the grid offers one or the other. Quick keys are the
 * products the merchant marked `posQuickKey` in the product editor (AGL-3607),
 * the same set the console register shows, on the composite declared for it.
 *
 * Reads go through the Firebase JS SDK under the console's own rules; the
 * prices shown here are a preview the server re-prices when the sale opens.
 *=========================================*/

/** How many tiles one read fills; the grid pages further on scroll. */
export const POS_GRID_PAGE_SIZE = 60
/** Categories a store keeps are a short taxonomy; the grid reads them whole. */
export const POS_CATEGORY_CEILING = 200

export interface PosVariant {
  id: string
  /** "Large / Blue"; null for the default variant of a product without options. */
  label: string | null
  /** Null while the variant has no price yet: the till refuses to ring it up. */
  unitCents: number | null
  sku: string | null
  barcode: string | null
  /** Tracked units, or null when the variant is not tracked. */
  inventory: number | null
}

export interface PosItem {
  id: string
  name: string
  imageUrl: string | null
  variants: PosVariant[]
  categoryIds: string[]
  /** Choices added at the register ("Oat milk"), priced by the server. */
  modifierGroups: ProductModifierGroup[]
  /** Lowest and highest priced variant, for the tile. */
  fromCents: number | null
  toCents: number | null
}

export function variantLabelOf(variant: Pick<ProductVariant, 'options'>): string | null {
  const values = Object.values(variant.options ?? {}).filter(Boolean)
  return values.length ? values.join(' / ') : null
}

export function posVariantFrom(variant: ProductVariant): PosVariant {
  const inventory = variant.inventory
  return {
    id: variant.id,
    label: variantLabelOf(variant),
    unitCents: variantHasPrice(variant) ? Math.round(Number(variant.priceUsd) * 100) : null,
    sku: variant.sku?.trim() || null,
    barcode: variant.barcode?.trim() || null,
    inventory: typeof inventory === 'number' && Number.isFinite(inventory) ? inventory : null,
  }
}

export function posItemFrom(id: string, data: DocumentData): PosItem {
  const product = liftLegacyProduct(data as Partial<HostProduct> & { name?: string })
  const variants = product.variants.map(posVariantFrom)
  const prices = variants.map((variant) => variant.unitCents).filter((cents): cents is number => cents !== null)
  return {
    id,
    name: product.name,
    imageUrl: product.mediaUrls?.[0] ?? product.imageUrl ?? null,
    variants,
    categoryIds: [...(product.categoryIds ?? [])],
    modifierGroups: productModifierGroups(product),
    fromCents: prices.length ? Math.min(...prices) : null,
    toCents: prices.length ? Math.max(...prices) : null,
  }
}

/**
 * A product with options or modifiers opens the item sheet; one with a
 * single variant and nothing to choose goes straight into the basket.
 */
export function itemNeedsSheet(item: PosItem): boolean {
  return item.variants.length > 1 || item.modifierGroups.length > 0
}

/**
 * What one variant, with its modifier choices, puts in the basket, or why it
 * cannot be sold yet. The modifiers are checked and previewed with the same
 * resolver the server prices them with.
 */
export function pickOf(
  item: PosItem,
  variant: PosVariant,
  modifiers: readonly ModifierSelection[] = [],
): PosCartPick | { problem: string } {
  if (variant.unitCents === null) return { problem: `Set a price for ${item.name} before selling it.` }
  const resolved = resolveLineModifiers({ name: item.name, modifierGroups: item.modifierGroups }, modifiers)
  if (!resolved.ok) return { problem: resolved.error ?? `Choose the options for ${item.name}.` }
  return {
    productId: item.id,
    // A product without options has one `default` variant, which the server
    // rings up when no `variantId` is sent.
    variantId: variant.id === 'default' ? null : variant.id,
    name: item.name,
    variantLabel: lineLabelWithModifiers(variant.label ?? undefined, resolved.modifiers) || null,
    modifiers: resolved.modifiers.map((entry) => ({ groupId: entry.groupId, optionId: entry.optionId })),
    unitCents: variant.unitCents + resolved.extraCents,
  }
}

/** Sold out, by the tracked count: the till warns, the server decides (`pos-order.ts`). */
export function variantSoldOut(variant: PosVariant): boolean {
  return variant.inventory !== null && variant.inventory <= 0
}

export interface PosGridArgs {
  /** Typed words: the name search. */
  search?: string
  /** A category tile: every product filed under it. */
  categoryId?: string | null
  /** The merchant's quick keys only. */
  quickKeys?: boolean
}

/**
 * The grid's plan: the products hub's query, narrowed to what the till may
 * sell. A typed word searches the whole catalog, past any category or the
 * quick keys: a cashier who types is looking for something else.
 */
export function posGridPlan(args: PosGridArgs) {
  const search = args.search?.trim() ?? ''
  const request = productsListRequest({ filter: 'active', search })
  const narrowed: ListQueryFilter[] = search
    ? []
    : args.quickKeys
      ? [{ path: 'posQuickKey', op: '==', value: true }]
      : args.categoryId
        ? [{ path: 'categoryIds', op: 'array-contains', value: args.categoryId }]
        : []
  return planList(PRODUCT_LIST_QUERY, { ...request, base: [...request.base, ...narrowed] })
}

export const posKeys = {
  all: (hostId: string) => ['commerce', hostId, 'pos'] as const,
  grid: (hostId: string, args: PosGridArgs) =>
    [
      'commerce',
      hostId,
      'pos',
      'grid',
      args.search?.trim() ?? '',
      args.categoryId ?? '',
      args.quickKeys ? 'quick' : '',
    ] as const,
  categories: (hostId: string) => ['commerce', hostId, 'pos', 'categories'] as const,
  context: (hostId: string) => ['commerce', hostId, 'pos', 'context'] as const,
}

const productsPath = (hostId: string) => `hosts/${hostId}/products`

/** The grid as an infinite query: `useInfiniteQuery(posGridQuery(firestore, hostId, args))`. */
export function posGridQuery(firestore: Firestore, hostId: string, args: PosGridArgs) {
  const plan = posGridPlan(args)
  return {
    queryKey: posKeys.grid(hostId, args),
    initialPageParam: null as ListCursor,
    queryFn: ({ pageParam }: { pageParam: ListCursor }): Promise<ListPage<PosItem>> =>
      readListPage({
        firestore,
        path: productsPath(hostId),
        plan,
        cursor: pageParam,
        pageSize: POS_GRID_PAGE_SIZE,
        map: posItemFrom,
      }),
    getNextPageParam: (page: ListPage<PosItem>): ListCursor | undefined => page.next ?? undefined,
  }
}

/** The variant a scanned code names: its barcode first, then its SKU. */
export function variantForCode(item: PosItem, code: string): PosVariant | null {
  const needle = code.trim().toLowerCase()
  return (
    item.variants.find((variant) => variant.barcode?.toLowerCase() === needle) ??
    item.variants.find((variant) => variant.sku?.toLowerCase() === needle) ??
    null
  )
}

export type PosScanResult =
  | { kind: 'found'; item: PosItem; variant: PosVariant }
  | { kind: 'missing'; code: string }
  | { kind: 'unreadable' }

/**
 * A scan, as a LOOKUP over the whole catalog rather than the tiles on screen:
 * by barcode first (what the scanner produced), then by SKU, active products
 * only. The console register answers a scan the same way (AGL-2501).
 */
export async function findItemByCode(firestore: Firestore, hostId: string, raw: string): Promise<PosScanResult> {
  const code = scannedProductCode(raw)
  if (!code) return { kind: 'unreadable' }
  for (const field of ['barcodes', 'skus'] as const) {
    const plan = planList(PRODUCT_LIST_QUERY, productsListRequest({ filter: 'active', code: { field, value: code } }))
    const page = await readListPage({ firestore, path: productsPath(hostId), plan, cursor: null, pageSize: 1, map: posItemFrom })
    const item = page.rows[0]
    if (item) return { kind: 'found', item, variant: variantForCode(item, code) ?? item.variants[0] }
  }
  return { kind: 'missing', code }
}

export interface PosCategory {
  id: string
  name: string
  parentId: string | null
  order: number
}

export function posCategoryFrom(id: string, data: DocumentData): PosCategory {
  const raw = data as Partial<ProductCategory>
  const order = Number(raw.order)
  return {
    id,
    name: String(raw.name ?? '').trim() || 'Category',
    parentId: raw.parentId || null,
    order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER,
  }
}

/** The merchant's order, then the name: how the console's category tree lists them. */
export function sortCategories(categories: readonly PosCategory[]): PosCategory[] {
  return [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** The tiles for one level: top-level categories, or the children of one. */
export function categoryLevel(categories: readonly PosCategory[], parentId: string | null): PosCategory[] {
  const ids = new Set(categories.map((category) => category.id))
  return sortCategories(
    categories.filter((category) =>
      parentId === null
        ? // A child whose parent was deleted shows at the top rather than vanishing.
          category.parentId === null || !ids.has(category.parentId)
        : category.parentId === parentId,
    ),
  )
}

export function posCategoriesQuery(firestore: Firestore, hostId: string) {
  return {
    queryKey: posKeys.categories(hostId),
    queryFn: async (): Promise<PosCategory[]> => {
      const snapshot = await getDocs(
        query(collection(firestore, 'hosts', hostId, 'productCategories'), limit(POS_CATEGORY_CEILING)),
      )
      return sortCategories(snapshot.docs.map((entry) => posCategoryFrom(entry.id, entry.data())))
    },
    staleTime: 5 * 60_000,
  }
}

/** The live scope every till read keeps, restated for specs. */
export const POS_GRID_SCOPE = PRODUCT_LIST_BASE
