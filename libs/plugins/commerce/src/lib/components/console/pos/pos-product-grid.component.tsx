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
'use client'

import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { ListQueryNotices } from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  Box,
  Card,
  CardActionArea,
  Chip,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import * as CommerceModel from '../../../model'

/** The smallest comfortable touch target, in px (WCAG 2.5.5). */
export const POS_TOUCH_PX = 44

/** The category chip that shows the store's quick keys (AGL-3607). */
export const POS_QUICK_KEYS = '__quick'

export interface PosGridCategory {
  $id: string
  name: string
}

export interface PosProductGridProps {
  hostId: string
  search: string
  onSearch: (value: string) => void
  /** Enter in the search box: a barcode wedge finishing a scan. */
  onSearchEnter: () => void
  categories: PosGridCategory[]
  /** `''` for all, {@link POS_QUICK_KEYS}, or a category id. */
  categoryId: string
  onCategory: (id: string) => void
  notices: Parameters<typeof ListQueryNotices>[0]['notices']
  products: any[]
  /** How many of each product are in the basket, for the tile badge. */
  basketCounts: ReadonlyMap<string, number>
  onTap: (product: any) => void
  /** A slot under the search, for the register's reader and display status. */
  toolbar?: ReactNode
}

function cents(variant: { priceUsd?: number } | undefined): number {
  return Math.round(Number(variant?.priceUsd ?? 0) * 100)
}

/** `$4.50`, or `From $4.50` when the variants are not all one price. */
export function posTilePrice(product: CommerceModel.HostProduct): string {
  const prices = (product.variants ?? []).map(cents)
  const low = Math.min(...prices)
  const label = CommerceModel.formatReceiptMoney(Number.isFinite(low) ? low : 0, 'usd')
  return prices.some((price) => price !== low) ? `From ${label}` : label
}

/** What the tile says about the shelf: nothing when it is untracked or plenty. */
export function posTileStock(product: CommerceModel.HostProduct): string | null {
  const tracked = (product.variants ?? []).filter((variant) => variant.inventory != null)
  if (tracked.length === 0 || tracked.length < (product.variants ?? []).length) return null
  const total = tracked.reduce((sum, variant) => sum + Math.max(0, Number(variant.inventory)), 0)
  if (total <= 0) return 'Out of stock'
  if (total <= Math.max(3, Number(product.lowStockThreshold ?? 0))) return `${total} left`
  return null
}

/**
 * The register's product picker (AGL-3607): search and scan, a category bar
 * that opens on the store's quick keys, and photo tiles with the price, the
 * shelf and how many are already in the basket. A product with variants or
 * modifiers opens the item sheet; any other adds at a tap. Touch-first:
 * every target is at least 44px, and the tiles reflow from two columns on a
 * phone to six on a landscape tablet.
 */
export function PosProductGrid(props: PosProductGridProps) {
  const { products, hostId } = props
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
      <TextField
        placeholder="Search or scan barcode…"
        value={props.search}
        onChange={(event) => props.onSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onSearchEnter()
        }}
        fullWidth
        autoFocus
        slotProps={{
          htmlInput: { 'aria-label': 'Search or scan barcode', enterKeyHint: 'search' },
          input: props.search
            ? {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="Clear search"
                      onClick={() => props.onSearch('')}
                      sx={{ width: POS_TOUCH_PX, height: POS_TOUCH_PX }}
                    >
                      {'✕'}
                    </IconButton>
                  </InputAdornment>
                ),
              }
            : undefined,
        }}
      />
      {props.toolbar}
      <Stack
        direction="row"
        spacing={1}
        sx={{ overflowX: 'auto', pb: 0.5, flexShrink: 0 }}
        role="toolbar"
        aria-label="Categories"
      >
        <Chip
          label="★ Quick keys"
          color={props.categoryId === POS_QUICK_KEYS ? 'primary' : 'default'}
          onClick={() => props.onCategory(POS_QUICK_KEYS)}
          aria-pressed={props.categoryId === POS_QUICK_KEYS}
          sx={{ minHeight: POS_TOUCH_PX }}
        />
        <Chip
          label="All"
          color={props.categoryId ? 'default' : 'primary'}
          onClick={() => props.onCategory('')}
          aria-pressed={!props.categoryId}
          sx={{ minHeight: POS_TOUCH_PX }}
        />
        {props.categories.map((category) => (
          <Chip
            key={category.$id}
            label={category.name}
            color={props.categoryId === category.$id ? 'primary' : 'default'}
            onClick={() => props.onCategory(category.$id)}
            aria-pressed={props.categoryId === category.$id}
            sx={{ minHeight: POS_TOUCH_PX }}
          />
        ))}
      </Stack>
      {props.notices.length ? <ListQueryNotices refused={[]} notices={props.notices} /> : null}
      {products.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {props.categoryId === POS_QUICK_KEYS && !props.search
            ? 'No quick keys yet. Turn on “Quick key at the register” on the products you sell most.'
            : 'No products match.'}
        </Typography>
      ) : null}
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: 'repeat(auto-fill, minmax(150px, 1fr))',
          },
          alignContent: 'start',
        }}
      >
        {products.map((product: any) => {
          const image = resolveMediaSrc(product.mediaUrls?.[0] ?? product.imageUrl, { hostId })
          const stock = posTileStock(product)
          const inBasket = props.basketCounts.get(product.$id) ?? 0
          const choices =
            product.variants.length > 1 ||
            CommerceModel.productModifierGroups(product).length > 0
          return (
            <Card key={product.$id} variant="outlined" sx={{ position: 'relative' }}>
              {inBasket > 0 ? (
                <Box
                  aria-label={`${inBasket} in the basket`}
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 1,
                    minWidth: 28,
                    height: 28,
                    px: 0.75,
                    borderRadius: 14,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    typography: 'subtitle2',
                    pointerEvents: 'none',
                  }}
                >
                  {inBasket}
                </Box>
              ) : null}
              <CardActionArea
                onClick={() => props.onTap(product)}
                aria-label={`${product.name}, ${posTilePrice(product)}${choices ? ', choose options' : ''}`}
                sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
              >
                {image ? (
                  <Box
                    component="img"
                    src={image}
                    alt=""
                    loading="lazy"
                    sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <Box
                    aria-hidden
                    sx={{
                      width: '100%',
                      aspectRatio: '4 / 3',
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'action.hover',
                      color: 'text.secondary',
                      typography: 'h4',
                    }}
                  >
                    {String(product.name ?? '?').slice(0, 1).toUpperCase()}
                  </Box>
                )}
                <Box sx={{ p: 1.25, minHeight: 64 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {product.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {posTilePrice(product)}
                    {choices ? ' · Options' : ''}
                  </Typography>
                  {stock ? (
                    <Typography variant="caption" color={stock === 'Out of stock' ? 'error.main' : 'warning.main'}>
                      {stock}
                    </Typography>
                  ) : null}
                </Box>
              </CardActionArea>
            </Card>
          )
        })}
      </Box>
    </Box>
  )
}
PosProductGrid.displayName = 'PosProductGrid'
