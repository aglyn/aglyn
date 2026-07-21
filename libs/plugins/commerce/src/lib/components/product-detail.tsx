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
import * as CommerceModel from '../model'
import { mdiTagOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { CART_UPDATED_EVENT } from './cart'
import { ID as PRODUCT_REVIEWS_ID } from './product-reviews'
import { ID as RELATED_PRODUCTS_ID } from './related-products'
import { readLocalWishlist, toggleWishlist } from './wishlist'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'product-detail'

export interface ProductDetailProps {
  /** Product slug; blank resolves from /products/{slug} in the URL. */
  slug?: string
  buyLabel?: string
  /** Hide the description block (design it separately with tokens). */
  hideDescription?: boolean
}

interface DetailVariant {
  id: string
  options?: Record<string, string>
  priceUsd: number
  compareAtPriceUsd?: number
  soldOut: boolean
  imageUrl?: string
}

interface Detail {
  id: string
  name: string
  slug: string
  description?: string
  mediaUrls: string[]
  options: CommerceModel.ProductOption[]
  variants: DetailVariant[]
  /** Recurring billing (AGL-303); framing + buyer choice on the PDP. */
  subscription?: { interval: 'month' | 'year'; trialDays?: number }
  /** Buyer picks one-time or subscribe at the same price (AGL-545). */
  subscriptionOptional?: boolean
}

const SAMPLE: Detail = {
  id: 'sample',
  name: 'Sample product',
  slug: '#',
  description: 'Drop this block on your product page template.',
  mediaUrls: [],
  options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
  variants: [
    { id: 'a', options: { Size: 'S' }, priceUsd: 29, soldOut: false },
    { id: 'b', options: { Size: 'M' }, priceUsd: 29, soldOut: false },
    { id: 'c', options: { Size: 'L' }, priceUsd: 32, soldOut: true },
  ],
}

function slugFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const match = window.location.pathname.match(/\/products\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

/**
 * Product detail block (AGL-292): gallery, option pickers that resolve
 * the variant (price/media/stock follow), quantity, and a buy button
 * that charges through the server-priced checkout with the selected
 * variant. Resolves its product from the /products/{slug} URL unless a
 * slug prop pins it; sample data on the inert canvas.
 */
const ProductDetail = forwardRef<HTMLDivElement, ProductDetailProps>(
  (props, ref) => {
    const { slug: slugProp, buyLabel, hideDescription, ...rest } = props
    const site = Aglyn.useSite()
    const { hostId } = site
    // Seeded from the server-resolved page data (AGL-659) so the PDP renders
    // its real content in the SSR HTML. Starting at null meant the server
    // emitted a <Skeleton> and the crawler got a product page with no
    // product in it. Absent in the besigner/preview, where the effect below
    // still fetches — so this is an optimisation, not a new requirement.
    const seededProduct = (
      site.pageData as { commerce?: { product?: Detail } } | undefined
    )?.commerce?.product
    const [detail, setDetail] = useState<Detail | null | 'missing'>(
      seededProduct ?? null,
    )
    const [selections, setSelections] = useState<Record<string, string>>({})
    const [quantity, setQuantity] = useState(1)
    const [activeImage, setActiveImage] = useState(0)
    const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')
    const [message, setMessage] = useState('')
    const [added, setAdded] = useState(false)
    const [wishlisted, setWishlisted] = useState(false)
    const [notifyEmail, setNotifyEmail] = useState('')
    const [notifyState, setNotifyState] = useState<'idle' | 'done'>('idle')
    // Buyer-chosen billing (AGL-545): only meaningful when the product
    // is subscriptionOptional; defaults to a one-time purchase.
    const [billing, setBilling] = useState<CommerceModel.CheckoutBillingChoice>(
      'once',
    )

    const slug = slugProp || slugFromLocation()

    useEffect(() => {
      if (hostId && resolvedId) {
        setWishlisted(readLocalWishlist(hostId).includes(resolvedId))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hostId, detail])

    useEffect(() => {
      if (!hostId || !slug) return
      // Already delivered with the page (AGL-659) — refetching the identical
      // payload on hydrate would just be a wasted round trip per visitor.
      if (seededProduct && seededProduct.slug === slug) return
      let active = true
      void fetch(
        `/api/commerce/product?hostId=${encodeURIComponent(hostId)}` +
          `&slug=${encodeURIComponent(slug)}`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!active) return
          const product = payload?.product as Detail | undefined
          setDetail(product ?? 'missing')
          if (product) {
            // GA4 ecommerce mirror (AGL-327) through the site's gtag.
            ;(window as any).gtag?.('event', 'view_item', {
              items: [{ item_id: product.id, item_name: product.name }],
            })
            const first =
              product.variants.find((variant) => !variant.soldOut) ??
              product.variants[0]
            setSelections(first?.options ?? {})
          }
        })
        .catch(() => {
          if (active) setDetail('missing')
        })
      return () => {
        active = false
      }
    }, [hostId, slug])

    const resolvedId =
      hostId && detail && detail !== 'missing' ? detail.id : null
    const resolved: Detail | null = hostId
      ? detail === 'missing'
        ? null
        : detail
      : SAMPLE

    const variant = useMemo(() => {
      if (!resolved) return undefined
      return (
        CommerceModel.findVariant(
          { variants: resolved.variants as any },
          selections,
        ) as DetailVariant | undefined
      ) ?? resolved.variants[0]
    }, [resolved, selections])

    // Add to cart (AGL-293) beside instant buy; badge refresh via event.
    const handleAddToCart = async () => {
      if (!hostId || !resolved || !variant) return
      setAdded(false)
      const response = await fetch('/api/commerce/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          action: 'add',
          productId: resolved.id,
          variantId: variant.id,
          quantity,
        }),
      }).catch(() => null)
      if (response?.ok) {
        setAdded(true)
        ;(window as any).gtag?.('event', 'add_to_cart', {
          items: [{ item_id: resolved.id, item_name: resolved.name }],
        })
        window.dispatchEvent(new Event(CART_UPDATED_EVENT))
      }
    }

    const handleBuy = async () => {
      if (!hostId || !resolved || !variant || status === 'sending') return
      setStatus('sending')
      setMessage('')
      try {
        const response = await fetch('/api/commerce/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            productId: resolved.id,
            variantId: variant.id,
            quantity,
            // Billing choice (AGL-545): the server re-validates against
            // the product doc, so this is a request, not an instruction.
            ...(resolved.subscriptionOptional ? { billing } : {}),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok && payload?.url) {
          window.location.assign(payload.url)
          return
        }
        setMessage(String(payload?.error ?? ''))
        setStatus('error')
      } catch {
        setStatus('error')
      }
    }

    if (hostId && detail === null) {
      return (
        <Box ref={ref} {...rest} sx={{ display: 'flex', gap: 3 }}>
          <Skeleton variant="rectangular" width={320} height={320} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="60%" height={36} />
            <Skeleton width="25%" />
            <Skeleton width="90%" />
          </Box>
        </Box>
      )
    }
    if (!resolved) {
      return (
        <Box ref={ref} {...rest} sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {'Product not found.'}
          </Typography>
        </Box>
      )
    }

    const galleryImage =
      variant?.imageUrl ?? resolved.mediaUrls[activeImage] ?? resolved.mediaUrls[0]

    // Subscription framing (AGL-545): subscription-only products price as
    // $X/mo|/yr with a "Subscribe" button; subscriptionOptional products
    // surface the one-time/subscribe toggle instead. Same price either way
    // — the server re-prices from the product doc regardless.
    const subscription = resolved.subscription
    const intervalSuffix = subscription?.interval === 'year' ? '/yr' : '/mo'
    const subscribing =
      Boolean(subscription) &&
      (!resolved.subscriptionOptional || billing === 'subscribe')

    // schema.org Product/Offer (AGL-299), same inline-script convention
    // as the event-list block (AGL-143).
    const structuredData =
      hostId && resolvedId
        ? {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: resolved.name,
            ...(resolved.description
              ? { description: resolved.description }
              : {}),
            ...(resolved.mediaUrls.length
              ? { image: resolved.mediaUrls }
              : {}),
            offers: {
              '@type': 'Offer',
              priceCurrency: 'USD',
              price: String(variant?.priceUsd ?? 0),
              availability: variant?.soldOut
                ? 'https://schema.org/OutOfStock'
                : 'https://schema.org/InStock',
            },
          }
        : null

    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          display: 'flex',
          gap: 3,
          flexDirection: { xs: 'column', md: 'row' },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {galleryImage ? (
            <Box
              component="img"
              src={galleryImage}
              alt={resolved.name}
              sx={{
                width: '100%',
                aspectRatio: '1 / 1',
                objectFit: 'cover',
                borderRadius: 1,
              }}
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                aspectRatio: '1 / 1',
                bgcolor: 'action.hover',
                borderRadius: 1,
              }}
            />
          )}
          {resolved.mediaUrls.length > 1 ? (
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              {resolved.mediaUrls.map((url, index) => (
                <Box
                  key={`${url}-${index}`}
                  component="img"
                  src={url}
                  alt=""
                  onClick={() => setActiveImage(index)}
                  sx={{
                    width: 56,
                    height: 56,
                    objectFit: 'cover',
                    borderRadius: 1,
                    cursor: 'pointer',
                    border: 2,
                    borderColor:
                      index === activeImage ? 'secondary.main' : 'transparent',
                  }}
                />
              ))}
            </Box>
          ) : null}
        </Box>
        {structuredData ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: Aglyn.safeJsonLd(structuredData) }}
          />
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            {resolved.name}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              {`$${variant?.priceUsd ?? 0}${subscribing ? intervalSuffix : ''}`}
            </Typography>
            {subscribing && subscription?.trialDays ? (
              <Typography variant="caption" color="text.secondary">
                {`${subscription.trialDays}-day free trial`}
              </Typography>
            ) : null}
            {variant?.compareAtPriceUsd ? (
              <>
                <Typography
                  variant="body1"
                  color="text.disabled"
                  sx={{ textDecoration: 'line-through' }}
                >
                  {`$${variant.compareAtPriceUsd}`}
                </Typography>
                <Chip label="Sale" size="small" color="secondary" />
              </>
            ) : null}
            {variant?.soldOut ? (
              <Chip label="Sold out" size="small" variant="outlined" />
            ) : null}
            <Button
              size="small"
              onClick={async () => {
                if (hostId && resolved.id !== 'sample') {
                  setWishlisted(await toggleWishlist(hostId, resolved.id))
                }
              }}
            >
              {wishlisted ? '♥ Saved' : '♡ Save'}
            </Button>
          </Box>
          {subscription && resolved.subscriptionOptional ? (
            <ToggleButtonGroup
              value={billing}
              exclusive
              size="small"
              onChange={(_event, value) => {
                if (value === 'once' || value === 'subscribe') {
                  setBilling(value)
                }
              }}
              sx={{ mb: 2 }}
            >
              <ToggleButton value="once">
                {`One-time $${variant?.priceUsd ?? 0}`}
              </ToggleButton>
              <ToggleButton value="subscribe">
                {`Subscribe $${variant?.priceUsd ?? 0}${intervalSuffix}`}
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}
          {resolved.options.map((option) => (
            <TextField
              key={option.name}
              label={option.name}
              value={selections[option.name] ?? ''}
              onChange={(event) =>
                setSelections((prev) => ({
                  ...prev,
                  [option.name]: event.target.value,
                }))
              }
              size="small"
              select
              fullWidth
              sx={{ mb: 1.5 }}
            >
              {option.values.map((value) => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
          ))}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2 }}>
            <TextField
              label="Qty"
              value={quantity}
              onChange={(event) =>
                setQuantity(
                  Math.max(
                    1,
                    Math.min(99, Math.round(Number(event.target.value)) || 1),
                  ),
                )
              }
              size="small"
              sx={{ width: 80 }}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <Button
              variant="outlined"
              color="primary"
              size="large"
              disabled={!hostId || variant?.soldOut}
              onClick={handleAddToCart}
            >
              {added ? 'Added ✓' : 'Add to cart'}
            </Button>
            <Button
              variant="contained"
              color="primary"
              size="large"
              disabled={!hostId || status === 'sending' || variant?.soldOut}
              onClick={handleBuy}
              sx={{ flex: 1 }}
            >
              {variant?.soldOut
                ? 'Sold out'
                : status === 'sending'
                  ? 'Redirecting…'
                  : buyLabel || (subscribing ? 'Subscribe' : 'Buy now')}
            </Button>
          </Box>
          {status === 'error' ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {message || 'Checkout is unavailable right now.'}
            </Alert>
          ) : null}
          {variant?.soldOut && hostId ? (
            notifyState === 'done' ? (
              <Alert severity="success" sx={{ mb: 2 }}>
                {'We will email you when it is back.'}
              </Alert>
            ) : (
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField
                  placeholder="you@example.com"
                  type="email"
                  value={notifyEmail}
                  onChange={(event) => setNotifyEmail(event.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!notifyEmail.trim()}
                  onClick={async () => {
                    const response = await fetch(
                      '/api/commerce/notify-restock',
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          hostId,
                          productId: resolved.id,
                          email: notifyEmail,
                        }),
                      },
                    ).catch(() => null)
                    if (response?.ok) setNotifyState('done')
                  }}
                >
                  {'Notify me'}
                </Button>
              </Box>
            )
          ) : null}
          {!hideDescription && resolved.description ? (
            <Typography variant="body1" color="text.secondary">
              {resolved.description}
            </Typography>
          ) : null}
        </Box>
      </Box>
    )
  },
)
ProductDetail.displayName = 'AglynProductDetail'

export const schema: Aglyn.ComponentSchema<ProductDetailProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Product detail',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiTagOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'slug',
      label: 'Product slug',
      description:
        'Pin to one product; blank follows the /products/{slug} URL ' +
        '(product page template).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'buyLabel',
      label: 'Buy button label',
      description: 'Defaults to "Buy now".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'hideDescription',
      label: 'Hide description',
      description: 'Design the description separately with tokens.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Product detail',
    pluginId: BUNDLE_ID,
    description: 'Gallery, variant picker, and buy button for one product',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiTagOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    // Product page (AGL-561): the commerce-standard PDP subtree —
    // breadcrumb, detail, related products, reviews — for the product
    // page template screen. `{{product.name}}` resolves there via the
    // site page resolver's token pass (AGL-292); node shapes follow
    // the Sections & Blocks convention (AGL-539) and reference only
    // persisted component ids.
    $id: generatePresetId(ID, 'page'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Product page',
    pluginId: BUNDLE_ID,
    description:
      'Breadcrumb, product detail, related products, and reviews',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiTagOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: Aglyn.MUI_BUNDLE_ID,
      props: { spacing: 4, sx: { py: 2 } },
      nodes: [
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: Aglyn.MUI_BUNDLE_ID,
          props: {
            direction: 'row',
            spacing: 1,
            sx: { alignItems: 'center' },
          },
          nodes: [
            {
              $id: null,
              componentId: 'muiScreenLink',
              pluginId: Aglyn.MUI_BUNDLE_ID,
              props: { children: 'Shop', size: 'small', color: 'inherit' },
            },
            {
              $id: null,
              componentId: 'muiTypography',
              pluginId: Aglyn.MUI_BUNDLE_ID,
              props: { variant: 'body2', children: '/ {{product.name}}' },
            },
          ],
        },
        {
          $id: null,
          componentId: ID,
          pluginId: BUNDLE_ID,
          props: {},
        },
        {
          $id: null,
          componentId: RELATED_PRODUCTS_ID,
          pluginId: BUNDLE_ID,
          props: {},
        },
        {
          $id: null,
          componentId: PRODUCT_REVIEWS_ID,
          pluginId: BUNDLE_ID,
          props: {},
        },
      ],
    },
  },
]

export default ProductDetail
