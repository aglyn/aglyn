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

import { ListQueryNotices } from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { Box, Card, CardActionArea, Chip, Stack, TextField, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/** The smallest comfortable touch target, in px (WCAG 2.5.5). */
export const POS_TOUCH_PX = 44

export interface PosGridCategory {
  $id: string
  name: string
}

export interface PosProductGridProps {
  search: string
  onSearch: (value: string) => void
  /** Enter in the search box: a barcode wedge finishing a scan. */
  onSearchEnter: () => void
  categories: PosGridCategory[]
  categoryId: string
  onCategory: (id: string) => void
  notices: Parameters<typeof ListQueryNotices>[0]['notices']
  products: any[]
  onAdd: (product: any, variant?: any) => void
  /** A slot under the search, for the register's reader and display status. */
  toolbar?: ReactNode
}

/**
 * The register's product picker (AGL-3607): search and scan, category chips
 * and large tiles. Touch-first: every tap target is at least 44px.
 */
export function PosProductGrid(props: PosProductGridProps) {
  const { products, onAdd } = props
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
        slotProps={{ htmlInput: { 'aria-label': 'Search or scan barcode', enterKeyHint: 'search' } }}
      />
      {props.toolbar}
      {props.categories.length > 0 ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ overflowX: 'auto', pb: 0.5, flexShrink: 0 }}
          role="toolbar"
          aria-label="Categories"
        >
          <Chip
            label="All"
            color={props.categoryId ? 'default' : 'primary'}
            onClick={() => props.onCategory('')}
            sx={{ minHeight: POS_TOUCH_PX }}
          />
          {props.categories.map((category) => (
            <Chip
              key={category.$id}
              label={category.name}
              color={props.categoryId === category.$id ? 'primary' : 'default'}
              onClick={() => props.onCategory(category.$id)}
              sx={{ minHeight: POS_TOUCH_PX }}
            />
          ))}
        </Stack>
      ) : null}
      {props.notices.length ? <ListQueryNotices refused={[]} notices={props.notices} /> : null}
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          alignContent: 'start',
        }}
      >
        {products.map((product: any) => (
          <Card key={product.$id} variant="outlined">
            <CardActionArea onClick={() => onAdd(product)} sx={{ p: 1.5, minHeight: 88 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {product.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {`$${product.variants[0]?.priceUsd ?? 0}`}
                {product.variants.length > 1 ? ` · ${product.variants.length} variants` : ''}
              </Typography>
            </CardActionArea>
            {product.variants.length > 1 ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, p: 0.5 }}>
                {product.variants.slice(0, 6).map((variant: any) => (
                  <Chip
                    key={variant.id}
                    label={Object.values(variant.options ?? {}).join('/') || 'Default'}
                    onClick={() => onAdd(product, variant)}
                    sx={{ minHeight: POS_TOUCH_PX }}
                  />
                ))}
              </Box>
            ) : null}
          </Card>
        ))}
      </Box>
    </Box>
  )
}
PosProductGrid.displayName = 'PosProductGrid'
