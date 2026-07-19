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
import { mdiShapePlus } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'related-products'

export interface RelatedProductsProps {
  /** Anchor product id; blank follows the /products/{slug} page. */
  productId?: string
  heading?: string
  maxItems?: number
}

interface CatalogItem {
  id: string
  name: string
  slug: string
  priceUsd: number
  imageUrl?: string
}

/**
 * Related products / upsell strip (AGL-325): the product's manual list,
 * else "frequently bought together" from recent orders, else tag and
 * category neighbors — resolved server-side, rendered as cards.
 */
const RelatedProducts = forwardRef<HTMLDivElement, RelatedProductsProps>(
  (props, ref) => {
    const { productId: productIdProp, heading, maxItems, ...rest } = props
    const { hostId } = Aglyn.useSite()
    const [items, setItems] = useState<CatalogItem[] | null>(null)

    useEffect(() => {
      if (!hostId) return
      let active = true
      void (async () => {
        let anchor = productIdProp ?? ''
        if (!anchor) {
          const match = window.location.pathname.match(/\/products\/([^/?#]+)/)
          if (!match) return
          const response = await fetch(
            `/api/commerce/product?hostId=${encodeURIComponent(hostId)}` +
              `&slug=${encodeURIComponent(decodeURIComponent(match[1]))}`,
          ).catch(() => null)
          const payload = await response?.json().catch(() => ({}))
          anchor = String(payload?.product?.id ?? '')
        }
        if (!active || !anchor) return
        const relatedResponse = await fetch(
          `/api/commerce/related?hostId=${encodeURIComponent(hostId)}` +
            `&productId=${encodeURIComponent(anchor)}`,
        ).catch(() => null)
        const related = await relatedResponse?.json().catch(() => ({}))
        const ids: string[] = related?.productIds ?? []
        if (!active || ids.length === 0) return setItems([])
        const catalogResponse = await fetch(
          `/api/commerce/catalog?hostId=${encodeURIComponent(hostId)}` +
            `&ids=${encodeURIComponent(ids.join(','))}`,
        ).catch(() => null)
        const catalog = await catalogResponse?.json().catch(() => ({}))
        if (active) setItems(catalog?.items ?? [])
      })()
      return () => {
        active = false
      }
    }, [hostId, productIdProp])

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            p: 3,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'Related products render here'}
        </Box>
      )
    }
    if (!items || items.length === 0) return <Box ref={ref} {...rest} />

    return (
      <Box ref={ref} {...rest}>
        <Typography variant="h6" gutterBottom>
          {heading || 'You may also like'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1 }}>
          {items
            .slice(0, maxItems && maxItems > 0 ? maxItems : 6)
            .map((item) => (
              <Card key={item.id} variant="outlined" sx={{ minWidth: 160 }}>
                <CardActionArea href={`/products/${item.slug}`}>
                  {item.imageUrl ? (
                    <CardMedia
                      component="img"
                      image={item.imageUrl}
                      alt={item.name}
                      sx={{ height: 110, objectFit: 'cover' }}
                    />
                  ) : (
                    <Box sx={{ height: 110, bgcolor: 'action.hover' }} />
                  )}
                  <CardContent sx={{ py: 1 }}>
                    <Typography variant="body2" noWrap>
                      {item.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {`$${item.priceUsd}`}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
        </Box>
      </Box>
    )
  },
)
RelatedProducts.displayName = 'AglynRelatedProducts'

export const schema: Aglyn.ComponentSchema<RelatedProductsProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Related products',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiShapePlus.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'productId',
      label: 'Product id',
      description: 'Blank follows the product page URL.',
      component: Aglyn.FieldComponentType.PRODUCT_SELECT,
    },
    {
      name: 'heading',
      label: 'Heading',
      description: 'Defaults to "You may also like".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'maxItems',
      label: 'Max items',
      description: 'Cap the strip (default 6).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Related products',
    pluginId: BUNDLE_ID,
    description: 'Manual picks or frequently-bought-together',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiShapePlus.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default RelatedProducts
