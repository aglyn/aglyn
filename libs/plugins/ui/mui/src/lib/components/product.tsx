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
import { mdiCartOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'product'

export interface ProductProps {
  /** Id of the product doc under hosts/{hostId}/products. */
  productId?: string
  name?: string
  /** Display price; the charge always uses the product doc's price. */
  priceUsd?: string
  description?: string
  imageUrl?: string
  buyLabel?: string
}

/**
 * Commerce Starter product block (AGL-90): displays from its own props,
 * but Buy posts {hostId, productId} to the tenant's /api/commerce/checkout,
 * which prices from the server-side product doc — canvas props can't forge
 * a charge. Inert without SiteContext (besigner canvas/preview).
 */
const Product = forwardRef<HTMLDivElement, ProductProps>((props, ref) => {
  const {
    productId,
    name,
    priceUsd,
    description,
    imageUrl,
    buyLabel,
    ...rest
  } = props
  const { hostId } = Aglyn.useSite()
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')

  const handleBuy = useCallback(async () => {
    if (!hostId || !productId || status === 'sending') return
    setStatus('sending')
    try {
      const response = await fetch('/api/commerce/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, productId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload?.url) {
        window.location.assign(payload.url)
        return
      }
      setStatus('error')
    } catch {
      setStatus('error')
    }
  }, [hostId, productId, status])

  return (
    <Card ref={ref} variant="outlined" sx={{ maxWidth: 360 }} {...rest}>
      {imageUrl ? (
        <CardMedia
          component="img"
          image={imageUrl}
          alt={name ?? ''}
          sx={{ height: 200, objectFit: 'cover' }}
        />
      ) : null}
      <CardContent>
        <Typography variant="h6">{name || 'Product name'}</Typography>
        {priceUsd ? (
          <Typography variant="subtitle1" color="text.secondary">
            {`$${priceUsd}`}
          </Typography>
        ) : null}
        {description ? (
          <Typography variant="body2" sx={{ mt: 1 }}>
            {description}
          </Typography>
        ) : null}
        {status === 'error' ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {'Checkout is unavailable right now.'}
          </Alert>
        ) : null}
        <Button
          variant="contained"
          color="primary"
          sx={{ mt: 2 }}
          disabled={status === 'sending'}
          onClick={handleBuy}
          fullWidth
        >
          {status === 'sending' ? 'Redirecting…' : buyLabel || 'Buy now'}
        </Button>
      </CardContent>
    </Card>
  )
})
Product.displayName = 'AglynProduct'

export const schema: Aglyn.ComponentSchema<ProductProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Product',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiCartOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'productId',
      description:
        'Product id from the Products card on the host dashboard — the ' +
        'charge uses that product’s price.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Product id',
    },
    {
      name: 'name',
      description: 'Displayed product name.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Name',
    },
    {
      name: 'priceUsd',
      description: 'Displayed price (the charge uses the product doc).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Price (USD)',
    },
    {
      name: 'description',
      description: 'Short product description.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Description',
    },
    {
      name: 'imageUrl',
      description: 'Product image URL (copy from the Media library).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Image URL',
    },
    {
      name: 'buyLabel',
      description: 'Buy button label.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Button label',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Product',
    pluginId: BUNDLE_ID,
    description: 'Product card with a Stripe Checkout buy button',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiCartOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        name: 'My product',
        priceUsd: '25',
        description: 'A short description of what the buyer gets.',
        buyLabel: 'Buy now',
      },
    },
  },
]

export default Product
