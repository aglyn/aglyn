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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

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
 * Displayed price in cents (AGL-564): the low end of the variant range —
 * the number grid cards render (`$X` / `From $X`) — so price filtering
 * matches what visitors see.
 */
export function displayedPriceCents(
  product: Pick<CommerceModel.HostProduct, 'variants'>,
): number {
  return Math.round(CommerceModel.productPriceRange(product)[0] * 100)
}

/** Non-negative integer cents from a query param; undefined otherwise. */
function parsePriceCents(value: unknown): number | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  const cents = Number(raw)
  if (!Number.isFinite(cents) || cents < 0) return undefined
  return Math.round(cents)
}

/**
 * Case-insensitive catalog search (AGL-561): matches the product name,
 * description, or any tag. An empty/blank query matches everything.
 */
export function matchesCatalogQuery(
  product: Pick<CommerceModel.HostProduct, 'name' | 'description' | 'tags'>,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    product.name.toLowerCase().includes(needle) ||
    (product.description ?? '').toLowerCase().includes(needle) ||
    (product.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
  )
}

/** A catalog query, already parsed and bounded. */
export interface PublicCatalogQuery {
  hostId: string
  collectionId?: string
  collectionSlug?: string
  categoryId?: string
  categorySlug?: string
  tag?: string
  /** Free-text search over name, description and tags. */
  query?: string
  type?: CommerceModel.ProductType | ''
  /** Explicit id list in the given order (wishlist rendering, AGL-297). */
  ids?: string[]
  minPriceCents?: number
  maxPriceCents?: number
  sort?: string
  /** Page size, 1–100. */
  limit?: number
  offset?: number
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
 * The products read does not vary with the query — the whole catalog is
 * fetched and then filtered in memory by collection, category, tag, price and
 * search text. A page carrying four product grids therefore issued four
 * identical 500-document reads and threw three of them away.
 *
 * This shares the READ, never the RESULT. Each grid still filters and sorts
 * the shared snapshot independently, because a collection-scoped grid and an
 * all-products grid on the same page must not receive each other's items.
 *
 * Scoped to one host and one render deliberately: it holds a promise, not
 * data, so nothing is cached across requests and no staleness window opens.
 * Reusing a scope for a second host would serve that host the first one's
 * catalog, which is why it is created per render rather than per module.
 */
export interface CatalogReadScope {
  products?: Promise<FirebaseFirestore.QuerySnapshot>
  categories?: Promise<FirebaseFirestore.QuerySnapshot>
}

/** A fresh read scope. One per render, never reused across hosts. */
export function createCatalogReadScope(): CatalogReadScope {
  return {}
}

/** What both the API route and the SSR seed hand to a product grid. */
export interface PublicCatalogResult {
  items: PublicCatalogItem[]
  nextOffset?: number
  categories?: PublicCatalogCategory[]
  priceBounds?: PublicCatalogPriceBounds
}

/**
 * Public catalog listing (AGL-291): active products for storefront
 * blocks — filterable by collection/category slug or tag, sortable,
 * capped at 100 items per request. Storefront catalog UX (AGL-561)
 * adds text search, a product-type filter, offset paging (for Load
 * more), and facets for filter chips. The price-range filter (AGL-564)
 * bounds on the displayed price and reports `priceBounds`.
 * Read-only public data; prices here are display-only (charges always
 * come from the docs server-side).
 *
 * Extracted from the handler (AGL-659) so the site-page enricher seeds a
 * grid's first page through THIS function rather than a reimplementation
 * of it. A seed that filters or sorts differently from the API would
 * server-render one set of products and hydrate to another.
 */
export async function queryPublicCatalog(
  params: PublicCatalogQuery,
): Promise<PublicCatalogResult> {
  const { hostId } = params
  const collectionSlug = params.collectionSlug ?? ''
  const categorySlug = params.categorySlug ?? ''
  // Id-based filters are preferred (rename-safe, AGL-343); slugs remain
  // for legacy screens and template-URL resolution.
  const collectionIdParam = params.collectionId ?? ''
  const categoryIdParam = params.categoryId ?? ''
  const tag = params.tag ?? ''
  const query = params.query ?? ''
  const type = ['physical', 'digital', 'service'].includes(params.type ?? '')
    ? (params.type as CommerceModel.ProductType)
    : ''
  const ids = (params.ids ?? []).slice(0, 100)
  const minPriceCents = params.minPriceCents
  const maxPriceCents = params.maxPriceCents
  const sort = params.sort || 'name'
  const max = Math.min(100, Math.max(1, Number(params.limit ?? 24)))
  const offset = Math.max(0, Math.round(Number(params.offset ?? 0)) || 0)
  const wantFacets = Boolean(params.facets)

  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const reads = params.reads
  // Assigned into the scope BEFORE it is awaited, so grids running together
  // under one `Promise.all` share the single in-flight read rather than each
  // starting their own and racing to store it.
  const sharedProducts = () =>
    (reads
      ? (reads.products ??= hostRef.collection('products').limit(500).get())
      : hostRef.collection('products').limit(500).get())
  const sharedCategories = () =>
    (reads
      ? (reads.categories ??=
          hostRef.collection('productCategories').limit(200).get())
      : hostRef.collection('productCategories').limit(200).get())
  const [
    productsSnapshot,
    collectionsSnapshot,
    categoriesSnapshot,
    collectionByIdSnapshot,
    facetsSnapshot,
  ] =
    await Promise.all([
      sharedProducts(),
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
  const collection =
    collectionById ??
    collectionsSnapshot?.docs.find(
      (docSnapshot) => Aglyn.hostCollectionKind(docSnapshot.data()) === 'catalog',
    )
  const categoryId = categoryIdParam || categoriesSnapshot?.docs[0]?.id

  let products = productsSnapshot.docs
    .map((docSnapshot) => ({
      ...CommerceModel.liftLegacyProduct(docSnapshot.data() as any),
      $id: docSnapshot.id,
    }))
    .filter((product) => !product.deletedAt && product.status === 'active')
  if (collection) {
    const shaped = collection.data() as CommerceModel.HostCollection
    products = products.filter((product) =>
      CommerceModel.matchesCollection(product, shaped, product.$id),
    )
    if (shaped.mode === 'manual') {
      const order = new Map(
        (shaped.productIds ?? []).map((id, index) => [id, index]),
      )
      products.sort(
        (a, b) => (order.get(a.$id) ?? 999) - (order.get(b.$id) ?? 999),
      )
    }
  }
  if (categoryId) {
    products = products.filter((product) =>
      (product.categoryIds ?? []).includes(categoryId),
    )
  }
  if (tag) {
    products = products.filter((product) =>
      (product.tags ?? []).includes(tag),
    )
  }
  // Storefront catalog UX (AGL-561): type filter + text search.
  if (type) {
    products = products.filter((product) => product.type === type)
  }
  if (query.trim()) {
    products = products.filter((product) =>
      matchesCatalogQuery(product, query),
    )
  }
  // Wishlist rendering (AGL-297): explicit id list, given order.
  if (ids.length) {
    const order = new Map(ids.map((id, index) => [id, index]))
    products = products
      .filter((product) => order.has(product.$id))
      .sort((a, b) => (order.get(a.$id) ?? 0) - (order.get(b.$id) ?? 0))
  }
  // Price facets + filter (AGL-564): bounds are computed before the
  // price filter (with everything else applied) so the grid's slider
  // stays anchored while the visitor narrows it. Both use the
  // displayed price — the low end of the variant range grid cards
  // show — so filtering matches what visitors see.
  const priceBounds: PublicCatalogPriceBounds | undefined =
    wantFacets && products.length
      ? {
          minCents: Math.min(...products.map(displayedPriceCents)),
          maxCents: Math.max(...products.map(displayedPriceCents)),
        }
      : undefined
  if (minPriceCents != null || maxPriceCents != null) {
    products = products.filter((product) => {
      const cents = displayedPriceCents(product)
      return (
        (minPriceCents == null || cents >= minPriceCents) &&
        (maxPriceCents == null || cents <= maxPriceCents)
      )
    })
  }
  if (sort === 'price-asc' || sort === 'price-desc') {
    products.sort((a, b) => {
      const [minA] = CommerceModel.productPriceRange(a)
      const [minB] = CommerceModel.productPriceRange(b)
      return sort === 'price-asc' ? minA - minB : minB - minA
    })
  } else if (sort === 'newest') {
    products.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
  } else if (
    !ids.length &&
    (!collection || (collection.data() as any).mode !== 'manual')
  ) {
    products.sort((a, b) => a.name.localeCompare(b.name))
  }

  // Offset paging (AGL-561): grids pass `offset` for Load more;
  // `nextOffset` comes back only while more filtered items remain.
  const page = products.slice(offset, offset + max)
  const nextOffset =
    offset + max < products.length ? offset + max : undefined

  const items: PublicCatalogItem[] = page.map((product) => {
    const [minPrice, maxPrice] = CommerceModel.productPriceRange(product)
    const primary = product.variants[0]
    const inventory = CommerceModel.productInventory(product)
    return {
      id: product.$id,
      name: product.name,
      slug: product.slug,
      type: product.type,
      priceUsd: minPrice,
      maxPriceUsd: maxPrice,
      ...(primary?.compareAtPriceUsd
        ? { compareAtPriceUsd: primary.compareAtPriceUsd }
        : {}),
      ...(product.mediaUrls?.[0] || product.imageUrl
        ? { imageUrl: product.mediaUrls?.[0] ?? product.imageUrl }
        : {}),
      soldOut:
        inventory != null &&
        inventory <= 0 &&
        product.oversellPolicy !== 'backorder',
      ...(product.tags?.length ? { tags: product.tags } : {}),
    }
  })
  // Category facets (AGL-561): id/name/slug for grid filter chips,
  // parent-tree order preserved (order, then name).
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

  return {
    items,
    ...(nextOffset != null ? { nextOffset } : {}),
    ...(categories ? { categories } : {}),
    ...(priceBounds ? { priceBounds } : {}),
  }
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
      ids: String(req.query.ids ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
      // Price-range filter (AGL-564): integer cents on the displayed price.
      minPriceCents: parsePriceCents(req.query.minPriceCents),
      maxPriceCents: parsePriceCents(req.query.maxPriceCents),
      sort: String(req.query.sort ?? 'name'),
      limit: Number(req.query.limit ?? 24),
      offset: Number(req.query.offset ?? 0),
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
