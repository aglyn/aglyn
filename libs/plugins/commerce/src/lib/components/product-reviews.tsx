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
import { mdiStarOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Rating from '@mui/material/Rating'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'product-reviews'

export interface ProductReviewsProps {
  /** Product id; blank resolves from the /products/{slug} page product. */
  productId?: string
  heading?: string
  /**
   * `product` (default): one product's reviews with the submit form.
   * `store`: the store's latest approved reviews across every product, with
   * the average and count, and no form — for a storefront home. In store
   * scope the block draws its own heading (`heading`, default "What
   * customers say") and draws NOTHING when there are no approved reviews,
   * so a page never shows an empty reviews band.
   */
  scope?: 'product' | 'store'
  /** Store scope: how many reviews to show (default 6, at most 12). */
  maxItems?: number
  /** Store scope: the heading's level, 2–4 (default 2). */
  headingLevel?: 2 | 3 | 4 | '2' | '3' | '4'
}

interface StoreReviewView {
  id: string
  rating: number
  body: string
  authorName: string
  verified: boolean
  createdAtMs: number
  productName?: string
  productSlug?: string
}

const EDITOR_HINT_SX = {
  p: 3,
  border: '1px dashed',
  borderColor: 'divider',
  borderRadius: 1,
  color: 'text.secondary',
  fontSize: 13,
  fontFamily: 'system-ui, sans-serif',
} as const

interface ReviewView {
  id: string
  rating: number
  body: string
  authorName: string
  verified: boolean
  reply?: string | null
  createdAtMs: number
}

async function resolveProductIdFromSlug(hostId: string): Promise<string> {
  const match = window.location.pathname.match(/\/products\/([^/?#]+)/)
  if (!match) return ''
  const response = await fetch(
    `/api/commerce/product?hostId=${encodeURIComponent(hostId)}` +
      `&slug=${encodeURIComponent(decodeURIComponent(match[1]))}`,
  ).catch(() => null)
  if (!response?.ok) return ''
  const payload = await response.json().catch(() => ({}))
  return String(payload?.product?.id ?? '')
}

/**
 * Product reviews block (AGL-324): approved reviews with verified-buyer
 * badges, seller replies, an aggregate summary (emitted as JSON-LD
 * AggregateRating), and a submit form feeding the moderation queue.
 */
const ProductReviews = forwardRef<HTMLDivElement, ProductReviewsProps>(
  (props, ref) => {
    if (props.scope === 'store') return <StoreReviews ref={ref} {...props} />
    return <SingleProductReviews ref={ref} {...props} />
  },
)
ProductReviews.displayName = 'AglynProductReviews'

/**
 * The store-wide reviews band (`scope: 'store'`): the store's latest APPROVED
 * reviews, read-only stars, the reviewer's first name and initial, a verified
 * badge, and the product reviewed. Real reviews or nothing: with none it
 * renders an empty, zero-height element — never sample reviews on a live page
 * (sample testimonials presented as customers' would be fake reviews). The
 * editor, which has no site, gets a dashed hint instead.
 */
const StoreReviews = forwardRef<HTMLDivElement, ProductReviewsProps>(
  (props, ref) => {
    const {
      productId: _productId,
      heading,
      scope: _scope,
      maxItems,
      headingLevel,
      ...rest
    } = props
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { hostId } = Aglyn.useSite()
    const [payload, setPayload] = useState<{
      reviews: StoreReviewView[]
      aggregate: { count: number; average: number }
    } | null>(null)
    const limit = maxItems && Number(maxItems) > 0 ? Math.min(12, Math.floor(Number(maxItems))) : 6

    useEffect(() => {
      if (!hostId) return
      let active = true
      void fetch(
        `/api/commerce/reviews?hostId=${encodeURIComponent(hostId)}` +
          `&scope=store&limit=${limit}`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (!active || !body) return
          setPayload({
            reviews: Array.isArray(body.reviews) ? body.reviews : [],
            aggregate: body.aggregate ?? { count: 0, average: 0 },
          })
        })
        .catch(() => undefined)
      return () => {
        active = false
      }
    }, [hostId, limit])

    if (!hostId) {
      return (
        <Box ref={ref} {...rest} sx={[EDITOR_HINT_SX, ...nodeSx]}>
          {'★★★★★ Customer reviews appear here once shoppers review your products'}
        </Box>
      )
    }
    // Loading, failed, or none approved: nothing at all — not the node's
    // padding, not a heading over an empty band.
    if (!payload || payload.reviews.length === 0) {
      return <Box ref={ref} data-store-reviews-empty="" sx={{ display: 'none' }} />
    }
    // A select may store the level as a string; read it as a number.
    const asked = Number(headingLevel)
    const level = asked === 3 || asked === 4 ? asked : 2
    const { aggregate } = payload
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[{ display: 'flex', flexDirection: 'column', gap: 3 }, ...nodeSx]}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, textAlign: 'center' }}>
          <Typography variant={level === 2 ? 'h4' : level === 3 ? 'h5' : 'h6'} component={`h${level}`}>
            {heading || 'What customers say'}
          </Typography>
          {aggregate.count > 0 ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Rating value={aggregate.average} precision={0.1} readOnly size="small" />
              <Typography variant="body2" color="text.secondary">
                {`${aggregate.average} out of 5 · ${aggregate.count} ${aggregate.count === 1 ? 'review' : 'reviews'}`}
              </Typography>
            </Box>
          ) : null}
        </Box>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          }}
        >
          {payload.reviews.map((review) => (
            <Box
              key={review.id}
              component="figure"
              sx={{
                m: 0,
                p: 2.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: 'background.paper',
              }}
            >
              <Rating value={review.rating} readOnly size="small" />
              <Typography component="blockquote" variant="body1" sx={{ m: 0, flex: 1 }}>
                {review.body}
              </Typography>
              <Box component="figcaption" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {review.authorName}
                </Typography>
                {review.verified ? (
                  <Chip label="Verified buyer" size="small" variant="outlined" color="success" />
                ) : null}
              </Box>
              {review.productName ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component={review.productSlug ? 'a' : 'span'}
                  {...(review.productSlug ? { href: `/products/${review.productSlug}` } : {})}
                  sx={{ textDecoration: 'none' }}
                >
                  {review.productName}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      </Box>
    )
  },
)
StoreReviews.displayName = 'AglynStoreReviews'

const SingleProductReviews = forwardRef<HTMLDivElement, ProductReviewsProps>(
  (props, ref) => {
    const {
      productId: productIdProp,
      heading,
      scope: _scope,
      maxItems: _maxItems,
      headingLevel: _headingLevel,
      ...rest
    } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { hostId } = Aglyn.useSite()
    const siteFetch = Aglyn.useSiteFetch()
    const [productId, setProductId] = useState(productIdProp ?? '')
    const [reviews, setReviews] = useState<ReviewView[] | null>(null)
    const [aggregate, setAggregate] = useState({ count: 0, average: 0 })
    const [form, setForm] = useState({
      rating: 5,
      body: '',
      authorName: '',
      authorEmail: '',
    })
    const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>(
      'idle',
    )

    useEffect(() => {
      if (!hostId) return
      let active = true
      void (async () => {
        const resolved =
          productIdProp || (await resolveProductIdFromSlug(hostId))
        if (!active || !resolved) return
        setProductId(resolved)
        const response = await fetch(
          `/api/commerce/reviews?hostId=${encodeURIComponent(hostId)}` +
            `&productId=${encodeURIComponent(resolved)}`,
        ).catch(() => null)
        if (!active || !response?.ok) return
        const payload = await response.json().catch(() => ({}))
        setReviews(payload?.reviews ?? [])
        setAggregate(payload?.aggregate ?? { count: 0, average: 0 })
      })()
      return () => {
        active = false
      }
    }, [hostId, productIdProp])

    const handleSubmit = async () => {
      if (!hostId || !productId || state === 'busy') return
      setState('busy')
      try {
        const response = await siteFetch('/api/commerce/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, productId, ...form }),
        })
        setState(response.ok ? 'done' : 'error')
      } catch {
        setState('error')
      }
    }

    if (!hostId) {
      return (
        <Box ref={ref} {...rest} sx={[EDITOR_HINT_SX, ...nodeSx]}>
          {'★★★★★ Product reviews render here'}
        </Box>
      )
    }

    return (
      <Box ref={ref} {...rest} sx={[{ display: 'flex', flexDirection: 'column', gap: 1.5 }, ...nodeSx]}>
        {/* No JSON-LD here any more (AGL-686). This block used to emit a
            free-standing `AggregateRating` node, which schema.org ignores —
            a rating has to be a PROPERTY of the Product it rates. The PDP's
            server-rendered Product node now carries `aggregateRating`,
            built from the same `readProductReviews` reader this block's API
            uses, so the structured data and the visible stars cannot
            disagree. It also removes the one call site that was primed to
            become stored XSS the moment a reviewer name went into it. */}
        <Typography variant="h6">
          {heading || 'Reviews'}
          {aggregate.count > 0 ? ` (${aggregate.average} ★ · ${aggregate.count})` : ''}
        </Typography>
        {(reviews ?? []).map((review) => (
          <Box key={review.id}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Rating value={review.rating} size="small" readOnly />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {review.authorName}
              </Typography>
              {review.verified ? (
                <Chip label="Verified buyer" size="small" variant="outlined" color="success" />
              ) : null}
            </Box>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {review.body}
            </Typography>
            {review.reply ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', pl: 2, mt: 0.5, borderLeft: 2, borderColor: 'divider' }}
              >
                {`Seller: ${review.reply}`}
              </Typography>
            ) : null}
            <Divider sx={{ mt: 1.5 }} />
          </Box>
        ))}
        {reviews && reviews.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No reviews yet — be the first.'}
          </Typography>
        ) : null}
        {state === 'done' ? (
          <Alert severity="success">
            {'Thanks — your review is awaiting moderation.'}
          </Alert>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 480 }}>
            <Typography variant="subtitle2">{'Write a review'}</Typography>
            <Rating
              value={form.rating}
              onChange={(_event, value) =>
                setForm((prev) => ({ ...prev, rating: value ?? 5 }))
              }
            />
            <TextField
              placeholder="What did you think?"
              value={form.body}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, body: event.target.value }))
              }
              size="small"
              multiline
              minRows={2}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                placeholder="Name"
                value={form.authorName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, authorName: event.target.value }))
                }
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                placeholder="Email (verifies your purchase)"
                type="email"
                value={form.authorEmail}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, authorEmail: event.target.value }))
                }
                size="small"
                sx={{ flex: 1.4 }}
              />
            </Box>
            {state === 'error' ? (
              <Alert severity="error">{'Could not submit — check the fields.'}</Alert>
            ) : null}
            <Button
              variant="outlined"
              size="small"
              disabled={state === 'busy' || !form.body.trim() || !form.authorEmail.trim()}
              onClick={handleSubmit}
              sx={{ alignSelf: 'flex-start' }}
            >
              {'Submit review'}
            </Button>
          </Box>
        )}
      </Box>
    )
  },
)
SingleProductReviews.displayName = 'AglynSingleProductReviews'

export const schema: Aglyn.ComponentSchema<ProductReviewsProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Product reviews',
  description:
    'Approved reviews with verified-buyer badges, and a form to add one.',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiStarOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'productId',
      label: 'Product id',
      description:
        'Whose reviews these are. Blank reads the product from the URL, ' +
        'which is what you want on a product template; naming one pins the ' +
        'block to that product wherever it is placed.',
      component: Aglyn.FieldComponentType.PRODUCT_SELECT,
    },
    {
      name: 'heading',
      label: 'Heading',
      description: 'Defaults to "Reviews" ("What customers say" store-wide).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      // Default `product`, so a page that already places this block keeps it.
      name: 'scope',
      label: 'Show',
      description:
        'One product’s reviews with a form, or the store’s latest approved ' +
        'reviews across every product. Store-wide shows nothing until a ' +
        'shopper’s review is approved.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { label: 'This product', value: 'product' },
        { label: 'Whole store', value: 'store' },
      ],
    },
    {
      name: 'maxItems',
      label: 'Max reviews',
      description: 'Store-wide: how many to show (default 6, at most 12).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'headingLevel',
      label: 'Heading level',
      description: 'Store-wide: the heading’s level on the page (default H2).',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { label: 'H2', value: '2' },
        { label: 'H3', value: '3' },
        { label: 'H4', value: '4' },
      ],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Product reviews',
    pluginId: BUNDLE_ID,
    description: 'Verified-buyer reviews with a submit form',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiStarOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default ProductReviews
