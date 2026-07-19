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
}

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
    const { productId: productIdProp, heading, ...rest } = props
    const { hostId } = Aglyn.useSite()
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
        const response = await fetch('/api/commerce/reviews', {
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
          {'★★★★★ Product reviews render here'}
        </Box>
      )
    }

    return (
      <Box ref={ref} {...rest} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {aggregate.count > 0 ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'AggregateRating',
                ratingValue: aggregate.average,
                reviewCount: aggregate.count,
              }),
            }}
          />
        ) : null}
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
ProductReviews.displayName = 'AglynProductReviews'

export const schema: Aglyn.ComponentSchema<ProductReviewsProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Product reviews',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiStarOutline.path, sx: { color: '#2e7d32' } },
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
      description: 'Defaults to "Reviews".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
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
