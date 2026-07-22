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
import { mdiMagnify, mdiViewGridOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Chip from '@mui/material/Chip'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import Slider from '@mui/material/Slider'
import SvgIcon from '@mui/material/SvgIcon'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
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
  /** Debounced visitor search box above the grid (server-side, AGL-561). */
  showSearch?: boolean
  /** Category filter chips from the host's categories (AGL-561). */
  showCategories?: boolean
  /** Sort select: newest, name, price low→high / high→low (AGL-561). */
  showSort?: boolean
  /** Physical / digital / services filter chips (AGL-561). */
  showTypeFilter?: boolean
  /** Price range slider bounded by the catalog's prices (AGL-564). */
  showPriceFilter?: boolean
  /** Products per page; shows a Load more button while more remain. */
  pageSize?: number
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

interface CatalogCategory {
  id: string
  name: string
  slug: string
}

/** Price facet from the catalog handler, in cents (AGL-564). */
interface CatalogPriceBounds {
  minCents: number
  maxCents: number
}

/**
 * This grid's first page, resolved server-side by the commerce site-page
 * enricher (AGL-659). Same shape the catalog endpoint returns, because both
 * go through `queryPublicCatalog`.
 */
interface CatalogSeed {
  items?: CatalogItem[]
  categories?: CatalogCategory[]
  priceBounds?: CatalogPriceBounds
  nextOffset?: number
}

const SAMPLE_ITEMS: CatalogItem[] = [
  { id: 's1', name: 'Sample product', slug: '#', priceUsd: 29, maxPriceUsd: 29, soldOut: false },
  { id: 's2', name: 'Another product', slug: '#', priceUsd: 49, maxPriceUsd: 59, compareAtPriceUsd: 79, soldOut: false },
  { id: 's3', name: 'Third product', slug: '#', priceUsd: 12, maxPriceUsd: 12, soldOut: true },
]

/** Inert chips shown on the besigner canvas when categories are on. */
const SAMPLE_CATEGORIES: CatalogCategory[] = [
  { id: 'sc1', name: 'Apparel', slug: 'apparel' },
  { id: 'sc2', name: 'Accessories', slug: 'accessories' },
]

/** Inert slider bounds on the canvas, matching the sample cards. */
const SAMPLE_PRICE_BOUNDS: CatalogPriceBounds = {
  minCents: 1200,
  maxCents: 4900,
}

const TYPE_OPTIONS = [
  { value: 'physical', label: 'Physical' },
  { value: 'digital', label: 'Digital' },
  { value: 'service', label: 'Services' },
] as const

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
] as const

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
 * `/products/{slug}` (PDP routes, AGL-292). Catalog UX (AGL-561):
 * optional debounced search, category chips, type chips, a sort
 * select, and Load more paging — all resolved server-side by the
 * catalog handler so large catalogs stay cheap.
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
      showSearch,
      showCategories,
      showSort,
      showTypeFilter,
      showPriceFilter,
      pageSize,
      ...rest
    } = props
    const site = Aglyn.useSite()
    const { hostId } = site
    // Server-rendered first page (AGL-659). The site-page enricher ran this
    // grid's own query on the server and keyed the result by node id — two
    // grids on a page have different queries, so an unkeyed seed would put
    // the wrong products in one of them. Absent in the besigner and preview,
    // where there is no pageData at all and the effect below still fetches.
    const nodeId = Aglyn.useNodeId()
    const seed = (
      site.pageData as
        | { commerce?: { grids?: Record<string, CatalogSeed> } }
        | undefined
    )?.commerce?.grids?.[nodeId]

    const [items, setItems] = useState<CatalogItem[] | null>(
      seed?.items ?? null,
    )
    const [sort, setSort] = useState(sortProp)
    const [inStockOnly, setInStockOnly] = useState(false)
    const [activeTag, setActiveTag] = useState('')
    // Catalog UX state (AGL-561): the search box debounces into
    // `query`; a chip pick overrides any pinned category ('*' = All);
    // paging appends via `nextOffset` from the catalog handler.
    const [searchInput, setSearchInput] = useState('')
    const [query, setQuery] = useState('')
    const [activeCategoryId, setActiveCategoryId] = useState('')
    const [activeType, setActiveType] = useState('')
    const [categories, setCategories] = useState<CatalogCategory[]>(
      seed?.categories ?? [],
    )
    // Price filter (AGL-564): the slider drags into `priceInput` (whole
    // dollars) and debounces into `priceFilter`, which drives the query;
    // null = untouched (no price params sent). Bounds come from the
    // handler's price facets.
    const [priceBounds, setPriceBounds] = useState<CatalogPriceBounds | null>(
      seed?.priceBounds ?? null,
    )
    const [priceInput, setPriceInput] = useState<number[] | null>(null)
    const [priceFilter, setPriceFilter] = useState<number[] | null>(null)
    const [nextOffset, setNextOffset] = useState<number | null>(
      seed?.nextOffset ?? null,
    )
    const [loadingMore, setLoadingMore] = useState(false)
    const fetchSeq = useRef(0)
    const collectionSlug =
      source === 'collection'
        ? collectionSlugProp || collectionSlugFromLocation()
        : collectionSlugProp
    const pageLimit =
      pageSize && Number(pageSize) > 0 ? Math.floor(Number(pageSize)) : 0
    const pinnedCategoryId = source === 'category' ? categoryId ?? '' : ''

    // Debounce keystrokes so large catalogs aren't fetched per letter.
    useEffect(() => {
      const timer = setTimeout(() => setQuery(searchInput.trim()), 300)
      return () => clearTimeout(timer)
    }, [searchInput])

    // Debounce slider drags the same way (AGL-564): one fetch per
    // settled range, not one per pixel of thumb movement.
    useEffect(() => {
      const timer = setTimeout(() => setPriceFilter(priceInput), 300)
      return () => clearTimeout(timer)
    }, [priceInput])

    const loadPage = useCallback(
      async (offset: number): Promise<void> => {
        if (!hostId) return
        const seq = ++fetchSeq.current
        const params = new URLSearchParams({ hostId })
        // Ids first (rename-safe, AGL-343); slugs remain as the legacy path.
        if (source === 'collection') {
          if (collectionId) params.set('collectionId', collectionId)
          else if (collectionSlug) params.set('collection', collectionSlug)
        }
        const effectiveCategoryId =
          activeCategoryId === '*' ? '' : activeCategoryId || pinnedCategoryId
        if (effectiveCategoryId) {
          params.set('categoryId', effectiveCategoryId)
        } else if (!activeCategoryId && source === 'category' && categorySlug) {
          params.set('category', categorySlug)
        }
        if (source === 'tag' && tag) params.set('tag', tag)
        if (query) params.set('q', query)
        if (activeType) params.set('type', activeType)
        // Slider dollars → API cents (AGL-564).
        if (priceFilter) {
          params.set('minPriceCents', String(priceFilter[0] * 100))
          params.set('maxPriceCents', String(priceFilter[1] * 100))
        }
        if (sort) params.set('sort', sort)
        const limit = pageLimit || maxItems
        if (limit) params.set('limit', String(limit))
        if (offset) params.set('offset', String(offset))
        if ((showCategories || showPriceFilter) && offset === 0) {
          params.set('facets', '1')
        }
        try {
          const response = await fetch(
            `/api/commerce/catalog?${params.toString()}`,
          )
          const payload = await response.json()
          if (seq !== fetchSeq.current) return
          const pageItems: CatalogItem[] = payload?.items ?? []
          setItems((prev) =>
            offset && prev ? [...prev, ...pageItems] : pageItems,
          )
          setNextOffset(
            typeof payload?.nextOffset === 'number' ? payload.nextOffset : null,
          )
          if (Array.isArray(payload?.categories)) {
            setCategories(payload.categories)
          }
          const bounds = payload?.priceBounds
          if (
            typeof bounds?.minCents === 'number' &&
            typeof bounds?.maxCents === 'number'
          ) {
            setPriceBounds(bounds)
          }
        } catch {
          if (seq !== fetchSeq.current) return
          if (!offset) setItems([])
          setNextOffset(null)
        }
      },
      [
        hostId,
        source,
        collectionId,
        collectionSlug,
        categorySlug,
        tag,
        sort,
        maxItems,
        query,
        activeCategoryId,
        activeType,
        priceFilter,
        pageLimit,
        pinnedCategoryId,
        showCategories,
        showPriceFilter,
      ],
    )

    // A seeded grid already holds exactly what `loadPage(0)` would return,
    // so the first pass skips the fetch (AGL-659) — every later run, after
    // a filter or sort change, goes to the API as before.
    const seededRef = useRef(Boolean(seed))
    useEffect(() => {
      if (!hostId) return
      if (seededRef.current) {
        seededRef.current = false
        return
      }
      void loadPage(0)
      // Invalidate any in-flight request on dep change or unmount.
      return () => {
        fetchSeq.current++
      }
    }, [hostId, loadPage])

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

    // Catalog controls (AGL-561): search on top, category/type chips
    // under it with the sort select right-aligned — the layout every
    // mainstream commerce PLP uses. Server-side; sample data inert.
    const chipCategories = categories.length
      ? categories
      : !hostId && showCategories
        ? SAMPLE_CATEGORIES
        : []
    const selectedCategoryId =
      activeCategoryId === '*' ? '' : activeCategoryId || pinnedCategoryId
    const hasCatalogControls = Boolean(
      showSearch || showCategories || showSort || showTypeFilter ||
        showPriceFilter,
    )
    // Price slider bounds (AGL-564), widened to whole dollars so both
    // ends stay reachable; sample bounds keep the canvas designable.
    const sliderBounds = hostId ? priceBounds : SAMPLE_PRICE_BOUNDS
    const sliderMin = sliderBounds ? Math.floor(sliderBounds.minCents / 100) : 0
    const sliderMax = sliderBounds ? Math.ceil(sliderBounds.maxCents / 100) : 0
    const showSlider = Boolean(showPriceFilter && sliderMin < sliderMax)
    const controls = hasCatalogControls ? (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
        {showSearch ? (
          <TextField
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search products…"
            size="small"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SvgIcon fontSize="small" color="disabled">
                      <path d={mdiMagnify.path} />
                    </SvgIcon>
                  </InputAdornment>
                ),
              },
              htmlInput: { 'aria-label': 'Search products', type: 'search' },
            }}
          />
        ) : null}
        {showCategories || showTypeFilter || showSort ? (
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {showCategories && chipCategories.length ? (
              <>
                <Chip
                  label="All"
                  size="small"
                  variant={selectedCategoryId ? 'outlined' : 'filled'}
                  color={selectedCategoryId ? 'default' : 'secondary'}
                  onClick={() => setActiveCategoryId('*')}
                />
                {chipCategories.map((category) => (
                  <Chip
                    key={category.id}
                    label={category.name}
                    size="small"
                    variant={
                      selectedCategoryId === category.id ? 'filled' : 'outlined'
                    }
                    color={
                      selectedCategoryId === category.id
                        ? 'secondary'
                        : 'default'
                    }
                    onClick={() =>
                      setActiveCategoryId((prev) =>
                        (prev || pinnedCategoryId) === category.id
                          ? '*'
                          : category.id,
                      )
                    }
                  />
                ))}
              </>
            ) : null}
            {showTypeFilter
              ? TYPE_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    size="small"
                    variant={activeType === option.value ? 'filled' : 'outlined'}
                    color={
                      activeType === option.value ? 'secondary' : 'default'
                    }
                    onClick={() =>
                      setActiveType((prev) =>
                        prev === option.value ? '' : option.value,
                      )
                    }
                  />
                ))
              : null}
            {showSort ? (
              <>
                <Box sx={{ flex: 1 }} />
                <TextField
                  select
                  size="small"
                  value={
                    SORT_OPTIONS.some((option) => option.value === sort)
                      ? sort
                      : 'name'
                  }
                  onChange={(event) =>
                    setSort(event.target.value as ProductGridProps['sort'])
                  }
                  sx={{ minWidth: 180 }}
                  slotProps={{
                    htmlInput: { 'aria-label': 'Sort products' },
                  }}
                >
                  {SORT_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            ) : null}
          </Box>
        ) : null}
        {showSlider ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              maxWidth: 360,
              px: 1,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {`$${sliderMin}`}
            </Typography>
            <Slider
              size="small"
              value={priceInput ?? [sliderMin, sliderMax]}
              min={sliderMin}
              max={sliderMax}
              step={1}
              disableSwap
              disabled={!hostId}
              onChange={(_event, value) =>
                setPriceInput(Array.isArray(value) ? value : [value, value])
              }
              valueLabelDisplay="auto"
              valueLabelFormat={(value) => `$${value}`}
              getAriaLabel={(index) =>
                index === 0 ? 'Minimum price' : 'Maximum price'
              }
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {`$${sliderMax}`}
            </Typography>
          </Box>
        ) : null}
      </Box>
    ) : null

    if (visible && visible.length === 0 && !hasCatalogControls) {
      return (
        <Box ref={ref} {...rest} sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {emptyText || 'No products here yet — check back soon.'}
          </Typography>
        </Box>
      )
    }
    // With controls visible the empty state renders inline, so a
    // no-result search still leaves the box available to clear.
    const emptyState = (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {query || activeType || selectedCategoryId || priceFilter
            ? 'No products match — try clearing a filter.'
            : emptyText || 'No products here yet — check back soon.'}
        </Typography>
      </Box>
    )
    const loadMore =
      hostId && pageLimit && nextOffset != null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Button
            variant="outlined"
            disabled={loadingMore}
            onClick={async () => {
              if (nextOffset == null || loadingMore) return
              setLoadingMore(true)
              await loadPage(nextOffset)
              setLoadingMore(false)
            }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </Box>
      ) : null

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

    const body = visible && visible.length === 0 ? emptyState : grid
    if (!showFilters) {
      return (
        <Box ref={ref} {...rest}>
          {controls}
          {body}
          {loadMore}
        </Box>
      )
    }
    return (
      <Box ref={ref} {...rest}>
        {controls}
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
        {body}
        {loadMore}
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
    {
      name: 'showSearch',
      label: 'Search box',
      description:
        'Visitor search box above the grid — matches product names, ' +
        'descriptions, and tags (server-side).',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'showCategories',
      label: 'Category chips',
      description:
        'Filter chips built from your product categories, with an All chip.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'showSort',
      label: 'Sort select',
      description:
        'Visitor sort: newest, name, price low→high, price high→low.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'showTypeFilter',
      label: 'Type filter',
      description: 'Physical / digital / services chips.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'showPriceFilter',
      label: 'Price filter',
      description:
        'Price range slider between your lowest and highest product prices.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'pageSize',
      label: 'Page size',
      description:
        'Products per page with a Load more button; blank loads once ' +
        '(capped by Max items).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
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
  {
    // Full shop page (AGL-561): the grid with every catalog control on
    // — search, category chips, sort, and Load more paging.
    $id: generatePresetId(ID, 'shop'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Shop catalog',
    pluginId: BUNDLE_ID,
    description: 'Product grid with search, category chips, sort, and paging',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiViewGridOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        source: 'all',
        sort: 'newest',
        columns: 3,
        showSearch: true,
        showCategories: true,
        showSort: true,
        pageSize: 12,
      },
    },
  },
]

export default ProductGrid
