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

import type { SitePageEnricher } from '@aglyn/aglyn/server'
import { queryPublicCatalog, type PublicCatalogResult } from './catalog'

/** Component id of the block this enricher seeds; persisted, never renamed. */
const PRODUCT_GRID_ID = 'product-grid'

/**
 * Grids seeded per page. A page with a dozen grids would turn one render
 * into a dozen catalog reads, so the walk stops after this many — the rest
 * fetch client-side exactly as they did before, which is a slower first
 * paint rather than a broken page.
 */
const MAX_SEEDED_GRIDS = 4

interface GridProps {
  source?: 'all' | 'collection' | 'category' | 'tag'
  collectionId?: string
  collectionSlug?: string
  categoryId?: string
  categorySlug?: string
  tag?: string
  sort?: string
  maxItems?: number | string
  pageSize?: number | string
  showCategories?: boolean
  showPriceFilter?: boolean
}

interface ComposedNode {
  $id?: string
  componentId?: string
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
  /** Child node IDS — denormalized nodes do not nest (see below). */
  nodes?: string[]
}

/**
 * Every product-grid node on the page.
 *
 * `composeScreenNodes` returns `Record<string, node>` — a DENORMALIZED FLAT
 * MAP keyed by node id, whose children are id STRINGS in `nodes`. It does not
 * return a tree, and there is no `children` array anywhere in it.
 *
 * The first version of this walked `children` recursively and therefore
 * matched nothing at all, on any page. It shipped green because the unit
 * tests fed it a nested fixture — the fixture encoded the assumption instead
 * of the actual contract, so the tests only ever proved the walker was
 * self-consistent. Iterating the map's values is both correct and simpler;
 * the flat shape means no recursion is needed.
 *
 * Sorted by id so that the MAX_SEEDED_GRIDS cap takes a deterministic subset
 * rather than whichever ones the map happened to enumerate first.
 */
function collectGridNodes(nodes: unknown): ComposedNode[] {
  if (!nodes || typeof nodes !== 'object') return []
  const found: ComposedNode[] = []
  for (const value of Object.values(nodes as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const shaped = value as ComposedNode
    if (shaped.componentId === PRODUCT_GRID_ID && shaped.$id) {
      found.push(shaped)
    }
  }
  return found.sort((a, b) => String(a.$id).localeCompare(String(b.$id)))
}

/** Positive integer from a props value that may arrive as a string. */
function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.floor(parsed)
}

/**
 * The collection slug a grid on a `/collections/{slug}` page follows when
 * it has no pinned collection — the server-side twin of the grid's
 * `collectionSlugFromLocation()`, which reads `window.location`.
 */
function collectionSlugFromPath(path: string): string {
  const match = path.match(/\/collections\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

/**
 * Seeds each product grid's FIRST, UNFILTERED page (AGL-659).
 *
 * `/products` shipped 11KB of HTML with zero words in it: the grid fetches
 * its catalog in a `useEffect`, so the server rendered skeleton cards and
 * crawlers indexed an empty shell. The fix is to run the same query on the
 * server and hand the result down through `pageData`.
 *
 * Three things this deliberately does NOT do:
 *
 * - It does not seed anything the visitor can change. Search text, category
 *   chips, type chips and the price slider all start empty on mount, so a
 *   props-derived query is exactly what the grid's own first fetch would
 *   send. Seed a filtered page and SSR would disagree with hydration.
 * - It does not seed later pages. Load more still goes to the API.
 * - It does not share one slice between grids. Seeds are keyed by node id,
 *   because a collection-scoped grid and an all-products grid on the same
 *   page must not receive each other's items — wrong products would get
 *   indexed and visibly swap on hydrate.
 *
 * Failures are swallowed by the enricher runner, and the grid falls back to
 * fetching. A catalog read that errors must not take a page down.
 */
export const commerceSitePageEnricher: SitePageEnricher = async ({
  hostId,
  path,
  nodes,
}) => {
  const grids = collectGridNodes(nodes).slice(0, MAX_SEEDED_GRIDS)
  if (!grids.length) return undefined

  const seeds: Record<string, PublicCatalogResult> = {}
  await Promise.all(
    grids.map(async (node) => {
      const props = (node.resolvedProps ??
        node.props ??
        {}) as unknown as GridProps
      const source = props.source ?? 'all'
      // Ids first (rename-safe, AGL-343), slugs as the legacy path — the
      // same precedence the grid applies when it builds its own params.
      const collectionSlug =
        source === 'collection'
          ? props.collectionSlug || collectionSlugFromPath(path)
          : props.collectionSlug
      const pageLimit = positiveInt(props.pageSize)
      const limit = pageLimit ?? positiveInt(props.maxItems)

      try {
        const result = await queryPublicCatalog({
          hostId,
          ...(source === 'collection'
            ? props.collectionId
              ? { collectionId: props.collectionId }
              : collectionSlug
                ? { collectionSlug }
                : {}
            : {}),
          ...(source === 'category'
            ? props.categoryId
              ? { categoryId: props.categoryId }
              : props.categorySlug
                ? { categorySlug: props.categorySlug }
                : {}
            : {}),
          ...(source === 'tag' && props.tag ? { tag: props.tag } : {}),
          ...(props.sort ? { sort: props.sort } : {}),
          ...(limit ? { limit } : {}),
          // Facets ride along only when a control needs them, matching the
          // grid's `facets=1` condition on its first request.
          facets: Boolean(props.showCategories || props.showPriceFilter),
        })
        seeds[node.$id as string] = result
      } catch (error) {
        // One grid failing leaves the others seeded; this one fetches.
        console.error('commerce grid seed failed', node.$id, error)
      }
    }),
  )

  if (!Object.keys(seeds).length) return undefined

  return {
    // Merged shallowly into the page props, so this key is the whole
    // `pageData` for a screen page. Screens never reach a page resolver
    // (the loader returns a resolver's answer before enrichers run), so
    // there is no resolver-written pageData here to preserve.
    pageData: { commerce: { grids: seeds } },
  }
}

export default commerceSitePageEnricher
