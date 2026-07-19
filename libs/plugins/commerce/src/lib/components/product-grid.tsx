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

import * as Aglyn from '@aglyn/aglyn'
import { mdiViewGridOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Chip from '@mui/material/Chip'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'product-grid'

export interface ProductGridProps {
  /** Filter source; 'all' lists the whole active catalog. */
  source?: 'all' | 'collection' | 'category' | 'tag'
  /** Collection id when source = collection (rename-safe, AGL-343). */
  collectionId?: string
  /** Legacy collection slug; used only when no collectionId is set.
   * Blank follows the /collections/{slug} URL (AGL-298). */
  collectionSlug?: string
  /** Faceted controls above the grid: tags, availability, sort. */
  showFilters?: boolean
  /** Category id when source = category (rename-safe, AGL-343). */
  categoryId?: string
  /** Legacy category slug; used only when no categoryId is set. */
  categorySlug?: string
  /** Tag when source = tag. */
  tag?: string
  sort?: 'name' | 'price-asc' | 'price-desc' | 'newest'
  /** Grid columns on desktop (1-6); mobile always stacks to 2/1. */
  columns?: number
  maxItems?: number
  /** Empty-state copy when nothing matches. */
  emptyText?: string
}

interface CatalogItem {
  id: string
  name: string
  slug: string
  priceUsd: number
  maxPriceUsd: number
  compareAtPriceUsd?: number
  imageUrl?: string
  soldOut: boolean
  tags?: string[]
}

const SAMPLE_ITEMS: CatalogItem[] = [
  { id: 's1', name: 'Sample product', slug: '#', priceUsd: 29, maxPriceUsd: 29, soldOut: false },
  { id: 's2', name: 'Another product', slug: '#', priceUsd: 49, maxPriceUsd: 59, compareAtPriceUsd: 79, soldOut: false },
  { id: 's3', name: 'Third product', slug: '#', priceUsd: 12, maxPriceUsd: 12, soldOut: true },
]

function collectionSlugFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const match = window.location.pathname.match(/\/collections\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

function priceLabel(item: CatalogItem): string {
  return item.priceUsd === item.maxPriceUsd
    ? `$${item.priceUsd}`
    : `From $${item.priceUsd}`
}

/**
 * Product grid / PLP block (AGL-291): active catalog items from the
 * public listing API, filterable by collection/category/tag, designable
 * in besigner with sample cards (no SiteContext = inert canvas, same
 * convention as the mui Product block). Cards navigate to
 * `/products/{slug}` (PDP routes, AGL-292).
 */
const ProductGrid = forwardRef<HTMLDivElement, ProductGridProps>(
  (props, ref) => {
    const {
      source,
      collectionId,
      collectionSlug: collectionSlugProp,
      categoryId,
      categorySlug,
      tag,
      sort: sortProp,
      columns,
      maxItems,
      emptyText,
      showFilters,
      ...rest
    } = props
    const { hostId } = Aglyn.useSite()
    const [items, setItems] = useState<CatalogItem[] | null>(null)
    const [sort, setSort] = useState(sortProp)
    const [inStockOnly, setInStockOnly] = useState(false)
    const [activeTag, setActiveTag] = useState('')
    const collectionSlug =
      source === 'collection'
        ? collectionSlugProp || collectionSlugFromLocation()
        : collectionSlugProp

    useEffect(() => {
      if (!hostId) return
      let active = true
      const params = new URLSearchParams({ hostId })
      // Ids first (rename-safe, AGL-343); slugs remain as the legacy path.
      if (source === 'collection') {
        if (collectionId) params.set('collectionId', collectionId)
        else if (collectionSlug) params.set('collection', collectionSlug)
      }
      if (source === 'category') {
        if (categoryId) params.set('categoryId', categoryId)
        else if (categorySlug) params.set('category', categorySlug)
      }
      if (source === 'tag' && tag) params.set('tag', tag)
      if (sort) params.set('sort', sort)
      if (maxItems) params.set('limit', String(maxItems))
      void fetch(`/api/commerce/catalog?${params.toString()}`)
        .then((response) => response.json())
        .then((payload) => {
          if (active) setItems(payload?.items ?? [])
        })
        .catch(() => {
          if (active) setItems([])
        })
      return () => {
        active = false
      }
    }, [
      hostId,
      source,
      collectionId,
      collectionSlug,
      categoryId,
      categorySlug,
      tag,
      sort,
      maxItems,
    ])

    const desktopColumns = Math.min(6, Math.max(1, columns ?? 3))
    const gridSx = {
      display: 'grid',
      gap: 2,
      gridTemplateColumns: {
        xs: 'repeat(1, 1fr)',
        sm: 'repeat(2, 1fr)',
        md: `repeat(${desktopColumns}, 1fr)`,
      },
    }
    let visible = hostId ? items : SAMPLE_ITEMS
    if (visible && showFilters) {
      if (inStockOnly) visible = visible.filter((item) => !item.soldOut)
      if (activeTag) {
        visible = visible.filter((item) =>
          (item.tags ?? []).includes(activeTag),
        )
      }
    }
    const facetTags = showFilters
      ? [...new Set((items ?? []).flatMap((item) => item.tags ?? []))].slice(
          0,
          12,
        )
      : []

    if (hostId && items === null) {
      return (
        <Box ref={ref} {...rest} sx={gridSx}>
          {Array.from({ length: desktopColumns }, (_item, index) => (
            <Card key={index} variant="outlined">
              <Skeleton variant="rectangular" height={160} />
              <CardContent>
                <Skeleton width="70%" />
                <Skeleton width="30%" />
              </CardContent>
            </Card>
          ))}
        </Box>
      )
    }
    if (visible && visible.length === 0) {
      return (
        <Box ref={ref} {...rest} sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {emptyText || 'No products here yet — check back soon.'}
          </Typography>
        </Box>
      )
    }

    const grid = (
      <Box sx={gridSx}>
        {(visible ?? []).map((item) => (
          <Card key={item.id} variant="outlined">
            <CardActionArea
              href={hostId ? `/products/${item.slug}` : undefined}
              disabled={!hostId}
            >
              {item.imageUrl ? (
                <CardMedia
                  component="img"
                  image={item.imageUrl}
                  alt={item.name}
                  sx={{ height: 160, objectFit: 'cover' }}
                />
              ) : (
                <Box sx={{ height: 160, bgcolor: 'action.hover' }} />
              )}
              <CardContent>
                <Typography variant="subtitle2" noWrap>
                  {item.name}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    {priceLabel(item)}
                  </Typography>
                  {item.compareAtPriceUsd ? (
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ textDecoration: 'line-through' }}
                    >
                      {`$${item.compareAtPriceUsd}`}
                    </Typography>
                  ) : null}
                  {item.soldOut ? (
                    <Chip label="Sold out" size="small" variant="outlined" />
                  ) : null}
                </Box>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    )

    if (!showFilters) {
      return (
        <Box ref={ref} {...rest}>
          {grid}
        </Box>
      )
    }
    return (
      <Box ref={ref} {...rest}>
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            alignItems: 'center',
            mb: 2,
          }}
        >
          <Chip
            label="In stock"
            size="small"
            variant={inStockOnly ? 'filled' : 'outlined'}
            color={inStockOnly ? 'secondary' : 'default'}
            onClick={() => setInStockOnly((prev) => !prev)}
          />
          {facetTags.map((facetTag) => (
            <Chip
              key={facetTag}
              label={facetTag}
              size="small"
              variant={activeTag === facetTag ? 'filled' : 'outlined'}
              color={activeTag === facetTag ? 'secondary' : 'default'}
              onClick={() =>
                setActiveTag((prev) => (prev === facetTag ? '' : facetTag))
              }
            />
          ))}
          <Box sx={{ flex: 1 }} />
          <Chip
            label={
              sort === 'price-asc'
                ? 'Price ↑'
                : sort === 'price-desc'
                  ? 'Price ↓'
                  : 'A–Z'
            }
            size="small"
            variant="outlined"
            onClick={() =>
              setSort((prev) =>
                prev === 'price-asc'
                  ? 'price-desc'
                  : prev === 'price-desc'
                    ? 'name'
                    : 'price-asc',
              )
            }
          />
        </Box>
        {grid}
      </Box>
    )
  },
)
ProductGrid.displayName = 'AglynProductGrid'

export const schema: Aglyn.ComponentSchema<ProductGridProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Product grid',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiViewGridOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'source',
      label: 'Show',
      description: 'Which products to list.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { label: 'All products', value: 'all' },
        { label: 'A collection', value: 'collection' },
        { label: 'A category', value: 'category' },
        { label: 'A tag', value: 'tag' },
      ],
    },
    {
      name: 'collectionId',
      label: 'Collection',
      description:
        'Pick the collection — stored by id, so renaming it never breaks ' +
        'this grid. Leave empty on collection template screens to follow ' +
        'the /collections/{slug} URL.',
      component: Aglyn.FieldComponentType.COLLECTION_SELECT,
    },
    {
      name: 'collectionSlug',
      label: 'Collection slug (legacy)',
      description: 'Used only when no collection is picked above.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'categoryId',
      label: 'Category',
      description:
        'Pick the category — stored by id, rename-safe.',
      component: Aglyn.FieldComponentType.CATEGORY_SELECT,
    },
    {
      name: 'categorySlug',
      label: 'Category slug (legacy)',
      description: 'Used only when no category is picked above.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'tag',
      label: 'Tag',
      description: 'Products tagged with this value.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'sort',
      label: 'Sort',
      description: 'Listing order.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { label: 'Name', value: 'name' },
        { label: 'Price (low → high)', value: 'price-asc' },
        { label: 'Price (high → low)', value: 'price-desc' },
        { label: 'Newest', value: 'newest' },
      ],
    },
    {
      name: 'columns',
      label: 'Columns',
      description: 'Desktop columns (1-6).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'maxItems',
      label: 'Max items',
      description: 'Cap the number of cards.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'emptyText',
      label: 'Empty text',
      description: 'Copy when nothing matches.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'showFilters',
      label: 'Show filters',
      description: 'Tag chips, in-stock toggle, and price sort above the grid.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Product grid',
    pluginId: BUNDLE_ID,
    description: 'Responsive grid of catalog products',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiViewGridOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { source: 'all', sort: 'name', columns: 3 },
    },
  },
]

export default ProductGrid
