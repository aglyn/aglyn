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

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  type ListQueryFilter,
  type ListQueryPlan,
  type ListQueryRefusal,
  type ListQueryRequest,
  type ListQuerySort,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'
import {
  smartCollectionScope,
  STOREFRONT_CATALOG_BASE,
  STOREFRONT_CATALOG_DECLARATION,
  STOREFRONT_CATALOG_SORTS,
  STOREFRONT_PRODUCT_TYPES,
  storefrontCatalogSort,
} from '../constants/storefront-catalog-query'
import * as CommerceModel from '../model'

export interface PublicCatalogItem {
  id: string
  name: string
  slug: string
  type: CommerceModel.ProductType
  priceUsd: number
  maxPriceUsd: number
  compareAtPriceUsd?: number
  imageUrl?: string
  soldOut: boolean
  tags?: string[]
  /**
   * Listed before any variant has a price (AGL-3676): the card says "Price
   * coming soon" instead of a price, and nothing sells it until one is set.
   * Absent for every product with a price.
   */
  priceComingSoon?: true
  /** How many variants the product sells as: one adds straight to a cart. */
  variantCount: number
  /**
   * The one variant a card's quick add puts in the cart — present only for
   * a product with exactly one variant; several need the product page.
   */
  defaultVariantId?: string
}

/**
 * The photo a product's card shows: the first non-blank of its media, its
 * legacy single image, then the first variant photo. Reading only the first
 * media entry passed a blank one through as the card's image — and a blank
 * resolves to no `src`, so a product WITH a photo drew an empty tile.
 */
export function productCardImage(
  product: Pick<CommerceModel.HostProduct, 'mediaUrls' | 'imageUrl' | 'variants'>,
): string | undefined {
  const candidates = [
    ...(product.mediaUrls ?? []),
    product.imageUrl,
    ...(product.variants ?? []).map((variant) => variant.imageUrl),
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

/** Host category surfaced to grids for filter chips (AGL-561). */
export interface PublicCatalogCategory {
  id: string
  name: string
  slug: string
}

/** Price facet surfaced to grids to bound a range slider (AGL-564). */
export interface PublicCatalogPriceBounds {
  minCents: number
  maxCents: number
}

/**
 * A control the query could not apply, and why — the plan's own refusal,
 * which the grid names through `listQueryRefusals` with the declaration's
 * fields and the categories it shows.
 */
export type PublicCatalogRefusal = ListQueryRefusal

/** Non-negative integer cents from a query param; undefined otherwise. */
function parsePriceCents(value: unknown): number | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  const cents = Number(raw)
  if (!Number.isFinite(cents) || cents < 0) return undefined
  return Math.round(cents)
}

/** A catalog query, already parsed and bounded. */
export interface PublicCatalogQuery {
  hostId: string
  collectionId?: string
  collectionSlug?: string
  categoryId?: string
  categorySlug?: string
  tag?: string
  /** Search: the first word, matched as a word prefix of the product name. */
  query?: string
  type?: CommerceModel.ProductType | ''
  /** The In stock chip: only products a card would not mark sold out. */
  inStock?: boolean
  /** Explicit id list in the given order (wishlist rendering, AGL-297). */
  ids?: string[]
  minPriceCents?: number
  maxPriceCents?: number
  sort?: string
  /** Page size, 1–100. */
  limit?: number
  /** The `nextCursor` a previous page returned — continue after it. */
  after?: string
  /** Include category + price facets in the result. */
  facets?: boolean
  /**
   * Optional per-render dedupe (see {@link CatalogReadScope}). Absent for a
   * one-off call such as the API route, where there is nothing to share with.
   */
  reads?: CatalogReadScope
}

/**
 * Reads shared by every catalog query in ONE render, for ONE host.
 *
 * Two grids on one page asking the SAME question share one answer, and every
 * grid that shows category chips shares one read of the taxonomy. A grid
 * asking a different question — another collection, another sort — runs its
 * own query, because each query now reads only the page it returns rather
 * than the whole catalog (AGL-3321).
 *
 * Scoped to one host and one render deliberately: it holds promises, not
 * data, so nothing is cached across requests and no staleness window opens.
 * Reusing a scope for a second host would serve that host the first one's
 * catalog, which is why it is created per render rather than per module.
 */
export interface CatalogReadScope {
  categories?: Promise<FirebaseFirestore.QuerySnapshot>
  results?: Map<string, Promise<PublicCatalogResult>>
}

/** A fresh read scope. One per render, never reused across hosts. */
export function createCatalogReadScope(): CatalogReadScope {
  return {}
}

/** What both the API route and the SSR seed hand to a product grid. */
export interface PublicCatalogResult {
  items: PublicCatalogItem[]
  /** Pass back as `after` for the next page; absent on the last one. */
  nextCursor?: string
  categories?: PublicCatalogCategory[]
  priceBounds?: PublicCatalogPriceBounds
  /** Controls in force that the query could not apply (AGL-3321). */
  refused?: PublicCatalogRefusal[]
  /** Said about what WAS applied, e.g. that search reads one word. */
  notices?: string[]
}

/** Most products one page returns. */
const CATALOG_PAGE_MAX = 100
/** Page size when a grid names none. */
const CATALOG_PAGE_DEFAULT = 24
/**
 * Members of a MANUAL collection read by id. A hand-curated list is its own
 * complete set, so it is read whole and every visitor control is answered over
 * all of it rather than over a window of the catalog.
 */
const MANUAL_COLLECTION_MAX = 1000
/** Ids per `getAll`, well inside the Admin SDK's comfortable batch. */
const GET_ALL_CHUNK = 100

/** One product as the catalog reads it: stored, lifted, and keyed. */
interface CatalogRow {
  id: string
  product: CommerceModel.HostProduct
  /**
   * The fields the catalog query reads, as the writers stamp them — derived
   * through the same library functions the writers spread, so a held row
   * (a manual collection's member, an id list's entry) answers a predicate
   * exactly as the stored document will once it is backfilled.
   */
  values: Record<string, unknown>
}

function toRow(docSnapshot: FirebaseFirestore.DocumentSnapshot): CatalogRow | null {
  const raw = docSnapshot.data() as Record<string, unknown> | undefined
  if (!raw) return null
  const product = CommerceModel.liftLegacyProduct(raw as never)
  return {
    id: docSnapshot.id,
    product,
    values: {
      ...raw,
      status: product.status,
      type: product.type,
      deletedAt: raw['deletedAt'] ?? null,
      ...CommerceModel.productSearchFields({
        name: String(product.name ?? ''),
        variants: product.variants,
      }),
      ...CommerceModel.productStockFields(product),
    },
  }
}

/** A row's value at a queried path, as the query sees it. */
function rowValue(row: CatalogRow, path: string): unknown {
  return row.values[path]
}

/** A held row a shopper may be shown: live and active, as the query's scope. */
const onSale = (row: CatalogRow) =>
  STOREFRONT_CATALOG_BASE.every((filter) => rowMatches(row, filter))

/** One plan predicate over one row, with Firestore's meaning of each operator. */
function rowMatches(row: CatalogRow, filter: ListQueryFilter): boolean {
  const actual = rowValue(row, filter.path)
  if (actual === undefined) return false
  const value = filter.value
  const list = Array.isArray(value) ? (value as readonly unknown[]) : [value]
  switch (filter.op) {
    case '==':
      return actual === value
    case '!=':
      return actual !== null && actual !== value
    case 'in':
      return list.includes(actual)
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(value)
    case 'array-contains-any':
      return Array.isArray(actual) && actual.some((member) => list.includes(member))
    case '<':
      return typeof actual === typeof value && (actual as number) < (value as number)
    case '<=':
      return typeof actual === typeof value && (actual as number) <= (value as number)
    case '>':
      return typeof actual === typeof value && (actual as number) > (value as number)
    case '>=':
      return typeof actual === typeof value && (actual as number) >= (value as number)
    default:
      return false
  }
}

/** A cursor: the last row's order value and id, opaque to the grid. */
function encodeCursor(value: unknown, id: string): string {
  return Buffer.from(JSON.stringify([value ?? null, id])).toString('base64url')
}

function decodeCursor(raw: string | undefined): { value: unknown; id: string } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [value, id] = parsed
    if (typeof id !== 'string' || !id) return null
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') return null
    return { value, id }
  } catch {
    return null
  }
}

const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0
  // A row without the ordered value sorts after every row with one.
  if (a === undefined || a === null) return 1
  if (b === undefined || b === null) return -1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * One page of rows already held WHOLE — a manual collection, an id list, a
 * smart collection's scan — ordered by `key` then id, after the cursor.
 */
function pageHeldRows(
  rows: readonly CatalogRow[],
  key: (row: CatalogRow) => unknown,
  direction: 'asc' | 'desc',
  after: string | undefined,
  max: number,
): { rows: CatalogRow[]; nextCursor?: string } {
  const signed = (value: number) => (direction === 'desc' ? -value : value)
  const ordered = [...rows].sort(
    (a, b) =>
      signed(compareValues(key(a), key(b))) || signed(compareValues(a.id, b.id)),
  )
  const cursor = decodeCursor(after)
  const start = cursor
    ? ordered.findIndex(
        (row) =>
          signed(compareValues(key(row), cursor.value)) > 0 ||
          (compareValues(key(row), cursor.value) === 0 &&
            signed(compareValues(row.id, cursor.id)) > 0),
      )
    : 0
  if (start === -1) return { rows: [] }
  const page = ordered.slice(start, start + max)
  const last = page[page.length - 1]
  return {
    rows: page,
    ...(last && start + max < ordered.length
      ? { nextCursor: encodeCursor(key(last), last.id) }
      : {}),
  }
}

/** Documents by id, in chunks, dropping the ones that do not exist. */
async function readProductsById(
  productsRef: FirebaseFirestore.CollectionReference,
  ids: readonly string[],
): Promise<CatalogRow[]> {
  const firestore = firebaseAdmin.app().firestore()
  const rows: CatalogRow[] = []
  for (let start = 0; start < ids.length; start += GET_ALL_CHUNK) {
    const refs = ids.slice(start, start + GET_ALL_CHUNK).map((id) => productsRef.doc(id))
    if (!refs.length) continue
    const snapshots = await firestore.getAll(...refs)
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue
      const row = toRow(snapshot)
      if (row) rows.push(row)
    }
  }
  return rows
}

/** The card a grid renders for one product. */
function toItem(row: CatalogRow): PublicCatalogItem {
  const { product } = row
  const [minPrice, maxPrice] = CommerceModel.productPriceRange(product)
  const primary = product.variants[0]
  return {
    id: row.id,
    name: product.name,
    slug: product.slug,
    type: product.type,
    priceUsd: minPrice,
    maxPriceUsd: maxPrice,
    ...(primary?.compareAtPriceUsd
      ? { compareAtPriceUsd: primary.compareAtPriceUsd }
      : {}),
    ...(productCardImage(product) ? { imageUrl: productCardImage(product) } : {}),
    // The same verdict the In stock chip queries (`soldOut`), from the one
    // function every stock writer stores it through.
    soldOut: CommerceModel.productStockFields(product).soldOut,
    ...(product.tags?.length ? { tags: product.tags } : {}),
    ...(product.variants.some((variant) => CommerceModel.variantHasPrice(variant))
      ? {}
      : { priceComingSoon: true as const }),
    variantCount: product.variants.length,
    ...(product.variants.length === 1 && primary?.id ? { defaultVariantId: primary.id } : {}),
  }
}

/**
 * The plan's refusals, as the plan made them; the grid words each one. A
 * search refused because a smart collection already holds the query's one
 * array clause gets a reason a shopper can read.
 */
function refusalsOf(plan: ListQueryPlan): PublicCatalogRefusal[] {
  return plan.refused.map((refusal) =>
    refusal.clause === 'search' && refusal.reason.startsWith('this list is already narrowed')
      ? {
          ...refusal,
          reason: 'this collection is already narrowed by a tag or category, which search cannot combine with',
        }
      : refusal,
  )
}

/** How a sort reads in the grid's select, for the notice below. */
const SORT_LABELS: Readonly<Record<string, string>> = {
  nameLower: 'Name',
  createdAtMs: 'Newest',
}

/** The operators that make a field a range, which must lead the order. */
const RANGE_OPS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=', '!='])

/**
 * The plan, ordered the way the visitor asked when a range forced its field.
 *
 * A range leads the order, so while the price slider (or a smart collection's
 * "price under" rule) is set the query is ordered by price: "high to low"
 * stays high to low, and any other sort — Name, Newest — becomes low to high
 * and is SAID to, rather than silently replaced (AGL-3321).
 *
 * The notice names the cause. The slider is the visitor's to clear, so the
 * sort they chose returns when they do; a collection's rule is in the scope
 * (`request.base`), which no visitor can clear, so that notice says the
 * collection is always ordered by price.
 */
function planFor(request: ListQueryRequest, sort: ListQuerySort): ListQueryPlan {
  const plan = planListQuery(STOREFRONT_CATALOG_DECLARATION, request, nameSearchNormalizers)
  if (plan.orderBy.path !== sort.path) {
    const asked = SORT_LABELS[sort.path]
    if (!asked) return plan
    const byRule = (request.base ?? []).some(
      (filter) => filter.path === plan.orderBy.path && RANGE_OPS.has(filter.op),
    )
    return {
      ...plan,
      notices: [
        ...plan.notices,
        byRule
          ? `Sorted by price, low to high — this collection picks its products by price, so it cannot be sorted by ${asked}.`
          : `Sorted by price, low to high, while a price range is set — ${asked} applies again when it is cleared.`,
      ],
    }
  }
  return plan.orderBy.direction !== sort.direction ? { ...plan, orderBy: sort } : plan
}

/** A price bound as the grid's slider shows it, for a refusal's sentence. */
const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

/**
 * Public catalog listing (AGL-291): active products for storefront blocks —
 * a collection, a category or a tag, searched, filtered by type and price,
 * sorted, and paged by cursor (AGL-561, AGL-564).
 *
 * EVERY CONTROL IS ON THE QUERY (AGL-3321). This used to read `limit(500)`
 * products and narrow them in memory, so a catalog past five hundred answered
 * every search, chip and slider from an arbitrary five hundred of them. Now:
 *
 *   - the catalog, a category or a tag — ONE query built by the list query
 *     plan (`STOREFRONT_CATALOG_DECLARATION`), paged by its own cursor;
 *   - a SMART collection whose rules a query can hold — the same query, with
 *     the rules as its scope (`smartCollectionScope`);
 *   - a MANUAL collection, or an explicit id list — read whole by id, which
 *     is a complete set, and answered over all of it;
 *   - a smart collection whose rules no query can hold (a NOT, an OR, a name
 *     rule, a price over) — the same query, scoped by the membership every
 *     product writer stores (`collectionIds array-contains <id>`), which the
 *     collection-membership route re-stamps whenever the rules change.
 *
 * What one query cannot hold — two array clauses, two ranges — is refused by
 * name in `refused` and not applied, never applied to some rows and not
 * others. Read-only public data; prices here are display-only (charges
 * always come from the docs server-side).
 *
 * Extracted from the handler (AGL-659) so the site-page enricher seeds a
 * grid's first page through THIS function rather than a reimplementation
 * of it. A seed that filters or sorts differently from the API would
 * server-render one set of products and hydrate to another.
 */
export async function queryPublicCatalog(
  params: PublicCatalogQuery,
): Promise<PublicCatalogResult> {
  const { reads, ...question } = params
  if (!reads) return runPublicCatalog(question)
  const key = JSON.stringify(question)
  reads.results ??= new Map()
  const shared = reads.results.get(key)
  if (shared) return shared
  // Stored BEFORE it is awaited, so grids running together under one
  // `Promise.all` share the one in-flight read rather than racing to store it.
  const pending = runPublicCatalog(question, reads)
  reads.results.set(key, pending)
  return pending
}

async function runPublicCatalog(
  params: Omit<PublicCatalogQuery, 'reads'>,
  reads?: CatalogReadScope,
): Promise<PublicCatalogResult> {
  const { hostId } = params
  const collectionSlug = params.collectionSlug ?? ''
  const categorySlug = params.categorySlug ?? ''
  // Id-based filters are preferred (rename-safe, AGL-343); slugs remain
  // for legacy screens and template-URL resolution.
  const collectionIdParam = params.collectionId ?? ''
  const categoryIdParam = params.categoryId ?? ''
  const tag = (params.tag ?? '').trim()
  const query = (params.query ?? '').trim()
  const type = STOREFRONT_PRODUCT_TYPES.includes(params.type as CommerceModel.ProductType)
    ? (params.type as CommerceModel.ProductType)
    : ''
  const ids = (params.ids ?? []).slice(0, CATALOG_PAGE_MAX)
  const asked = Math.floor(Number(params.limit ?? CATALOG_PAGE_DEFAULT))
  const max =
    Number.isFinite(asked) && asked > 0
      ? Math.min(CATALOG_PAGE_MAX, asked)
      : CATALOG_PAGE_DEFAULT
  const sort = storefrontCatalogSort(params.sort)
  const wantFacets = Boolean(params.facets)

  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const productsRef = hostRef.collection('products')
  const sharedCategories = () =>
    (reads
      ? (reads.categories ??=
          hostRef.collection('productCategories').limit(200).get())
      : hostRef.collection('productCategories').limit(200).get())

  // Wishlist and related rendering (AGL-297): an explicit id list is its own
  // complete set — read it by id, keep what is on sale, in the given order.
  if (ids.length) {
    const order = new Map(ids.map((id, index) => [id, index]))
    const rows = (await readProductsById(productsRef, ids)).filter(onSale)
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    return { items: rows.slice(0, max).map(toItem) }
  }

  const [collectionsSnapshot, categoriesSnapshot, collectionByIdSnapshot, facetsSnapshot] =
    await Promise.all([
      // limit(5) not 1: content collections share this path and a slug is
      // unique only within a kind (AGL-954) — the catalog match is picked
      // out below rather than trusting whichever doc came back first.
      !collectionIdParam && collectionSlug
        ? hostRef
            .collection('collections')
            .where('slug', '==', collectionSlug)
            .limit(5)
            .get()
        : null,
      !categoryIdParam && categorySlug
        ? hostRef
            .collection('productCategories')
            .where('slug', '==', categorySlug)
            .limit(1)
            .get()
        : null,
      collectionIdParam
        ? hostRef.collection('collections').doc(collectionIdParam).get()
        : null,
      wantFacets ? sharedCategories() : null,
    ])
  const collectionById =
    collectionByIdSnapshot?.exists &&
    Aglyn.hostCollectionKind(collectionByIdSnapshot.data()) === 'catalog'
      ? collectionByIdSnapshot
      : undefined
  const collectionDoc =
    collectionById ??
    collectionsSnapshot?.docs.find(
      (docSnapshot) => Aglyn.hostCollectionKind(docSnapshot.data()) === 'catalog',
    )
  const collection = collectionDoc
    ? (collectionDoc.data() as CommerceModel.HostCollection)
    : undefined
  const categoryId = categoryIdParam || categoriesSnapshot?.docs[0]?.id || ''

  // Category facets (AGL-561): id/name/slug for grid filter chips,
  // parent-tree order preserved (order, then name). The taxonomy is a
  // bounded picker, read whole.
  const categories: PublicCatalogCategory[] | undefined = facetsSnapshot
    ? facetsSnapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() as CommerceModel.ProductCategory
          return {
            id: docSnapshot.id,
            name: String(data.name ?? ''),
            slug: String(data.slug ?? ''),
            order: Number(data.order ?? 0),
          }
        })
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map(({ id, name, slug }) => ({ id, name, slug }))
    : undefined

  // The visitor's controls, as clauses on the one declaration. A price
  // clause carries the dollars the slider showed, for a refusal's sentence.
  const priceClauses: ListFilterClause[] = [
    ...(params.minPriceCents != null
      ? [{
          field: 'price',
          op: '>=',
          value: String(params.minPriceCents),
          label: dollars(params.minPriceCents),
        }]
      : []),
    ...(params.maxPriceCents != null
      ? [{
          field: 'price',
          op: '<=',
          value: String(params.maxPriceCents),
          label: dollars(params.maxPriceCents),
        }]
      : []),
  ]
  const otherClauses: ListFilterClause[] = [
    ...(categoryId ? [{ field: 'category', op: 'contains', value: categoryId }] : []),
    ...(tag ? [{ field: 'tag', op: 'contains', value: tag }] : []),
    ...(type ? [{ field: 'type', op: 'equals', value: type }] : []),
    ...(params.inStock ? [{ field: 'stock', op: 'is', value: 'false' }] : []),
  ]
  // The words typed, as a quick search hands them over: the plan searches by
  // the first and says so when there were more.
  const search = query.split(/\s+/).filter(Boolean)

  const result = (
    rows: CatalogRow[],
    plan: ListQueryPlan,
    extra: Partial<PublicCatalogResult> = {},
  ): PublicCatalogResult => {
    const refused = refusalsOf(plan)
    const notices = [...plan.notices, ...(extra.notices ?? [])]
    return {
      items: rows.map(toItem),
      ...(extra.nextCursor ? { nextCursor: extra.nextCursor } : {}),
      ...(categories ? { categories } : {}),
      ...(extra.priceBounds ? { priceBounds: extra.priceBounds } : {}),
      ...(refused.length ? { refused } : {}),
      ...(notices.length ? { notices } : {}),
    }
  }

  /*
   * A collection held WHOLE: a manual one's members, or a smart one whose
   * rules no query can hold. The plan still decides what is applied — the
   * same refusals as the query path, so a grid behaves the same whatever it
   * lists — and its predicates are answered over every held row.
   */
  const answerHeld = (
    held: CatalogRow[],
    options: { manualOrder?: Map<string, number>; notices?: string[] },
  ): PublicCatalogResult => {
    const request: ListQueryRequest = {
      base: STOREFRONT_CATALOG_BASE,
      clauses: [...otherClauses, ...priceClauses],
      search,
      sort,
    }
    const plan = planFor(request, sort)
    const unpriced = planFor({ ...request, clauses: otherClauses }, sort)
    const matched = held.filter((row) => plan.filters.every((filter) => rowMatches(row, filter)))
    // Bounds span every OTHER control, so the slider stays anchored while the
    // visitor narrows it.
    const bounding = held.filter((row) =>
      unpriced.filters.every((filter) => rowMatches(row, filter)),
    )
    const priceBounds =
      wantFacets && bounding.length
        ? {
            minCents: Math.min(...bounding.map((row) => Number(rowValue(row, 'priceFromCents')))),
            maxCents: Math.max(...bounding.map((row) => Number(rowValue(row, 'priceFromCents')))),
          }
        : undefined
    // A manual collection keeps the merchant's order unless the visitor (or
    // the author) chose a price or recency sort.
    const keepManual =
      options.manualOrder && plan.orderBy.path === STOREFRONT_CATALOG_SORTS.name.path
    const page = keepManual
      ? pageHeldRows(
          matched,
          (row) => options.manualOrder?.get(row.id) ?? Number.MAX_SAFE_INTEGER,
          'asc',
          params.after,
          max,
        )
      : pageHeldRows(
          matched,
          (row) => rowValue(row, plan.orderBy.path),
          plan.orderBy.direction,
          params.after,
          max,
        )
    return result(page.rows, plan, {
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      ...(priceBounds ? { priceBounds } : {}),
      ...(options.notices ? { notices: options.notices } : {}),
    })
  }

  let scope: ListQueryFilter[] = []
  if (collection) {
    if (collection.mode === 'manual') {
      const memberIds = (collection.productIds ?? []).slice(0, MANUAL_COLLECTION_MAX)
      const manualOrder = new Map(memberIds.map((id, index) => [id, index]))
      return answerHeld(await readProductsById(productsRef, memberIds), { manualOrder })
    }
    const smart = smartCollectionScope(collection)
    if (!(collection.rules ?? []).length) {
      // A smart collection with no rules holds nothing (`matchesCollection`).
      return result([], planFor({ base: STOREFRONT_CATALOG_BASE, clauses: [], sort }, sort))
    }
    if ('unservable' in smart) {
      // Rules no query can express (a NOT, an OR, a name rule, a price over)
      // are answered by the membership every product writer stores
      // (`collectionIds`, AGL-3321): one array clause on the same query, so
      // the grid's other array controls are refused by name beside it.
      scope = [
        {
          path: CommerceModel.PRODUCT_COLLECTION_IDS,
          op: 'array-contains',
          value: String(collectionDoc?.id ?? ''),
        },
      ]
    } else {
      scope = smart.filters
      // A "type is not" rule is `type in […]`; the visitor's Type chip is the
      // narrower question, answered inside it or not at all.
      const typeRule = scope.find((filter) => filter.path === 'type')
      if (typeRule && type) {
        const allowed = Array.isArray(typeRule.value) ? typeRule.value : [typeRule.value]
        if (!allowed.includes(type)) {
          return result([], planFor({ base: STOREFRONT_CATALOG_BASE, clauses: [], sort }, sort))
        }
        scope = scope.filter((filter) => filter !== typeRule)
      }
    }
  }

  // THE QUERY: every predicate, one order, a page and one row to spare.
  const request: ListQueryRequest = {
    base: [...STOREFRONT_CATALOG_BASE, ...scope],
    clauses: [...otherClauses, ...priceClauses],
    search,
    sort,
  }
  const plan = planFor(request, sort)
  const byId = firebaseAdmin.firestore.FieldPath.documentId()
  const ordered = (target: ListQueryPlan) =>
    applyListQuery(productsRef, target).orderBy(byId, target.orderBy.direction)
  let pageQuery = ordered(plan)
  const cursor = decodeCursor(params.after)
  if (cursor) pageQuery = pageQuery.startAfter(cursor.value, cursor.id)

  // Bounds span every OTHER control, so the slider stays anchored while the
  // visitor narrows it: the lowest and highest price the rest allows, as two
  // one-row reads ordered by price.
  const byPrice = STOREFRONT_CATALOG_SORTS['price-asc']
  const unpriced = wantFacets
    ? planFor({ ...request, clauses: otherClauses, sort: byPrice }, byPrice)
    : null
  const pricedBy = (target: ListQueryPlan, direction: 'asc' | 'desc') =>
    ordered({ ...target, orderBy: { path: 'priceFromCents', direction } }).limit(1).get()

  const [snapshot, lowest, highest] = await Promise.all([
    pageQuery.limit(max + 1).get(),
    unpriced ? pricedBy(unpriced, 'asc') : null,
    unpriced ? pricedBy(unpriced, 'desc') : null,
  ])
  const docs = snapshot.docs.slice(0, max)
  const rows = docs.map(toRow).filter((row): row is CatalogRow => Boolean(row))
  const last = docs[docs.length - 1]
  const low = lowest?.docs[0]?.get('priceFromCents')
  const high = highest?.docs[0]?.get('priceFromCents')
  return result(rows, plan, {
    ...(last && snapshot.docs.length > max
      ? { nextCursor: encodeCursor(last.get(plan.orderBy.path), last.id) }
      : {}),
    ...(typeof low === 'number' && typeof high === 'number'
      ? { priceBounds: { minCents: low, maxCents: high } }
      : {}),
  })
}

/** Public catalog listing endpoint — a thin parse over queryPublicCatalog. */
export const catalogHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  try {
    const result = await queryPublicCatalog({
      hostId,
      collectionSlug: String(req.query.collection ?? ''),
      categorySlug: String(req.query.category ?? ''),
      collectionId: String(req.query.collectionId ?? ''),
      categoryId: String(req.query.categoryId ?? ''),
      tag: String(req.query.tag ?? ''),
      query: String(req.query.q ?? ''),
      type: String(req.query.type ?? '') as CommerceModel.ProductType | '',
      inStock: String(req.query.inStock ?? '') === '1',
      ids: String(req.query.ids ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
      // Price-range filter (AGL-564): integer cents on the displayed price.
      minPriceCents: parsePriceCents(req.query.minPriceCents),
      maxPriceCents: parsePriceCents(req.query.maxPriceCents),
      sort: String(req.query.sort ?? 'name'),
      limit: Number(req.query.limit ?? CATALOG_PAGE_DEFAULT),
      after: String(req.query.after ?? ''),
      facets: String(req.query.facets ?? '') === '1',
    })
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300',
    )
    return res.status(200).json(result)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Catalog unavailable' })
  }
}
