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
import { ProductImagePlaceholder } from './product-image-placeholder'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'related-products'

export interface RelatedProductsProps {
  /** Anchor product id; blank follows the /products/{slug} page. */
  productId?: string
  heading?: string
  maxItems?: number
  /**
   * How the items are drawn: `strip`, the default, a scrolling row of small
   * cards; `grid`, tall photo cards (4:5) with the name and price under
   * them in a grid of up to four across — the product grid's photo look.
   */
  layout?: 'strip' | 'grid'
}

interface CatalogItem {
  id: string
  name: string
  slug: string
  priceUsd: number
  imageUrl?: string
  /** Listed before it has a price (AGL-3676). */
  priceComingSoon?: boolean
}

/**
 * Related products / upsell strip (AGL-325): the product's manual list,
 * else "frequently bought together" from recent orders, else tag and
 * category neighbors — resolved server-side, rendered as cards.
 */
const RelatedProducts = forwardRef<HTMLDivElement, RelatedProductsProps>(
  (props, ref) => {
    const { productId: productIdProp, heading, maxItems, layout, ...rest } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const site = Aglyn.useSite()
    const { hostId } = site
    // The page's product, when the server seeded it (AGL-659): its id is the
    // anchor, so the rail skips a product lookup the page already made.
    const seededProductId = (
      site.pageData as { commerce?: { product?: { id?: string } } } | undefined
    )?.commerce?.product?.id
    const [items, setItems] = useState<CatalogItem[] | null>(null)

    useEffect(() => {
      if (!hostId) return
      let active = true
      void (async () => {
        let anchor = productIdProp || seededProductId || ''
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
    }, [hostId, productIdProp, seededProductId])

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={[
            {
              p: 3,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              color: 'text.secondary',
              fontSize: 13,
              fontFamily: 'system-ui, sans-serif',
            },
            ...nodeSx,
          ]}
        >
          {'Related products render here'}
        </Box>
      )
    }
    if (!items || items.length === 0) return <Box ref={ref} {...rest} />

    const grid = layout === 'grid'
    return (
      <Box ref={ref} {...rest}>
        <Typography variant={grid ? 'h5' : 'h6'} component="h2" gutterBottom sx={grid ? { mb: 2 } : undefined}>
          {heading || 'You may also like'}
        </Typography>
        <Box
          sx={
            grid
              ? {
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
                }
              : { display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1 }
          }
        >
          {items
            .slice(0, maxItems && maxItems > 0 ? maxItems : 6)
            .map((item) => {
              // AGL-1726: resolved BEFORE the guard — see the note in
              // `product-detail.tsx`.
              const imageUrl = Aglyn.siteRelativeMediaSrc(item.imageUrl, {
                hostId,
              })
              const mediaSx = grid
                ? { aspectRatio: '4 / 5', borderRadius: 2 }
                : { height: 110 }
              return (
              <Card
                key={item.id}
                variant={grid ? 'elevation' : 'outlined'}
                elevation={0}
                sx={grid ? { bgcolor: 'transparent', overflow: 'visible', minWidth: 0 } : { minWidth: 160 }}
              >
                <CardActionArea
                  href={`/products/${item.slug}`}
                  sx={grid ? { borderRadius: 2 } : undefined}
                >
                  {imageUrl ? (
                    <CardMedia
                      component="img"
                      image={imageUrl}
                      alt={item.name}
                      sx={{ ...mediaSx, objectFit: 'cover' }}
                      // Deferred (AGL-2486). A related-products rail sits at
                      // the BOTTOM of a product page by construction, and it
                      // was fetching eagerly against the gallery hero above
                      // it — the one image on that page that is the LCP.
                      {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
                    />
                  ) : (
                    // Never a blank tile: a product with no photo yet says
                    // so, in the theme's colours (AGL-3676 follow-up).
                    <ProductImagePlaceholder name={item.name} sx={mediaSx} />
                  )}
                  <CardContent sx={grid ? { px: 0.5, pt: 1.5, pb: 1 } : { py: 1 }}>
                    <Typography variant={grid ? 'subtitle1' : 'body2'} noWrap>
                      {item.name}
                    </Typography>
                    <Typography variant={grid ? 'body2' : 'caption'} color="text.secondary">
                      {item.priceComingSoon ? 'Price coming soon' : `$${item.priceUsd}`}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
              )
            })}
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
  description:
    'An upsell strip — your manual picks, or what people buy together.',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiShapePlus.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'productId',
      label: 'Product id',
      description:
        'The product to find relatives OF. Blank reads it from the URL, so ' +
        'a product template shows each product’s own related items; naming ' +
        'one pins the rail to that product’s relatives everywhere.',
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
      type: 'number',
    },
    {
      // Default `strip`, so a page that already places this block keeps it.
      name: 'layout',
      label: 'Layout',
      description: 'A scrolling strip of small cards, or a grid of tall photo cards.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { label: 'Strip', value: 'strip' },
        { label: 'Photo grid', value: 'grid' },
      ],
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
