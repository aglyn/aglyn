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
  pluginProductCatalog,
  type CatalogOffer,
  type CatalogPage,
  type CatalogStore,
} from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { tenantDataTag, withRenderCache } from '@aglyn/tenant-data-admin/render-cache'

/**
 * THE CATALOG, AS FEEDS READ IT (AGL-3637): the store and its offers from
 * core's `core.product-catalog` contract, page by page, cached between
 * fetches.
 *
 * Cached per page under the site's data tag, so the six channels' fetches
 * share one read of the products, and any product edit — every product write
 * announces a site-wide change, which busts that tag — reaches the next
 * fetch at once. Stock that a sale takes is not announced, so the TTL bounds
 * how stale availability can be.
 */

/** About this many offers per page: well under the data cache's 2 MB item. */
export const FEED_PAGE_OFFERS = 500
/** A ceiling on one feed: 400 pages of 500 offers. */
export const FEED_MAX_PAGES = 400
/** How long a cached page may serve before a fetch reads the products again. */
export const FEED_CACHE_TTL_SECONDS = 1800

export class CatalogUnavailableError extends Error {
  constructor() {
    super('No plugin publishes a product catalog on this deployment.')
    this.name = 'CatalogUnavailableError'
  }
}

function catalog() {
  const found = pluginProductCatalog()
  if (!found) throw new CatalogUnavailableError()
  return found
}

/** The store, cached; `null` for a site that does not sell, which is not cached. */
export async function cachedStore(hostId: string): Promise<CatalogStore | null> {
  return withRenderCache<CatalogStore | null>({
    key: ['sales-channels-store', hostId],
    revalidate: FEED_CACHE_TTL_SECONDS,
    tags: [tenantDataTag(hostId)],
    read: () => catalog().store(hostId),
    store: (value) => value !== null,
  })
}

/** One page of offers, cached by where it starts. */
export async function cachedPage(hostId: string, cursor: string | null): Promise<CatalogPage> {
  return withRenderCache<CatalogPage>({
    key: ['sales-channels-page', hostId, cursor ?? '', String(FEED_PAGE_OFFERS)],
    revalidate: FEED_CACHE_TTL_SECONDS,
    tags: [tenantDataTag(hostId)],
    read: () => catalog().page({ hostId, cursor, limit: FEED_PAGE_OFFERS }),
  })
}

/**
 * Up to `maxOffers` offers read straight from the catalog, uncached: for
 * diagnostics, which a merchant runs right after fixing a product.
 */
export async function readOffers(
  hostId: string,
  maxOffers: number,
): Promise<{ offers: CatalogOffer[]; partial: boolean }> {
  const offers: CatalogOffer[] = []
  let cursor: string | null = null
  for (let pages = 0; pages < FEED_MAX_PAGES; pages += 1) {
    const page: CatalogPage = await catalog().page({ hostId, cursor, limit: FEED_PAGE_OFFERS })
    offers.push(...page.offers)
    cursor = page.nextCursor
    if (!cursor) return { offers, partial: false }
    if (offers.length >= maxOffers) return { offers, partial: true }
  }
  return { offers, partial: true }
}

/** The store, uncached. */
export async function readStore(hostId: string): Promise<CatalogStore | null> {
  return catalog().store(hostId)
}
