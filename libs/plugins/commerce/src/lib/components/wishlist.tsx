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
import { mdiHeartOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'wishlist'

export const WISHLIST_UPDATED_EVENT = 'aglyn:wishlist-updated'

function storageKey(hostId: string): string {
  return `aglyn_wishlist_${hostId}`
}

/** Guest wishlist ids from localStorage. */
export function readLocalWishlist(hostId: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(hostId))
    return raw ? (JSON.parse(raw) as string[]).slice(0, 200) : []
  } catch {
    return []
  }
}

function writeLocalWishlist(hostId: string, productIds: string[]): void {
  try {
    window.localStorage.setItem(
      storageKey(hostId),
      JSON.stringify(productIds.slice(0, 200)),
    )
  } catch {
    // Private-mode storage failures degrade to session-only behavior.
  }
}

/**
 * Toggles a product on the wishlist (AGL-297): members persist on their
 * doc (guest list merges in on first signed-in call); guests persist in
 * localStorage. Returns whether the product is on the list afterward.
 */
export async function toggleWishlist(
  hostId: string,
  productId: string,
): Promise<boolean> {
  const local = readLocalWishlist(hostId)
  const has = local.includes(productId)
  const next = has
    ? local.filter((id) => id !== productId)
    : [...local, productId]
  writeLocalWishlist(hostId, next)
  // Best-effort member sync — 401 just means guest.
  void fetch('/api/membership/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostId,
      action: has ? 'remove' : 'add',
      productId,
    }),
  }).catch(() => undefined)
  window.dispatchEvent(new Event(WISHLIST_UPDATED_EVENT))
  return !has
}

export interface WishlistProps {
  heading?: string
  emptyText?: string
}

interface CatalogItem {
  id: string
  name: string
  slug: string
  priceUsd: number
  imageUrl?: string
  soldOut: boolean
}

/**
 * Wishlist block (AGL-297): renders the saved products (member doc when
 * signed in — merging any guest list — else localStorage) as cards
 * linking to their PDPs, with remove buttons.
 */
const Wishlist = forwardRef<HTMLDivElement, WishlistProps>((props, ref) => {
  const { heading, emptyText, ...rest } = props
  const { hostId } = Aglyn.useSite()
  const [items, setItems] = useState<CatalogItem[] | null>(null)

  const refresh = useCallback(async () => {
    if (!hostId) return
    let productIds = readLocalWishlist(hostId)
    try {
      // Merge the guest list into the member doc; response is canonical.
      const response = await fetch('/api/membership/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, action: 'merge', productIds }),
      })
      if (response.ok) {
        const payload = await response.json()
        productIds = payload?.productIds ?? productIds
        writeLocalWishlist(hostId, productIds)
      }
    } catch {
      // Guest path.
    }
    if (productIds.length === 0) return setItems([])
    try {
      const response = await fetch(
        `/api/commerce/catalog?hostId=${encodeURIComponent(hostId)}` +
          `&ids=${encodeURIComponent(productIds.join(','))}&limit=100`,
      )
      const payload = await response.json()
      setItems(payload?.items ?? [])
    } catch {
      setItems([])
    }
  }, [hostId])

  useEffect(() => {
    void refresh()
    const handler = () => void refresh()
    window.addEventListener(WISHLIST_UPDATED_EVENT, handler)
    return () => window.removeEventListener(WISHLIST_UPDATED_EVENT, handler)
  }, [refresh])

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
        {'Wishlist — saved products render here'}
      </Box>
    )
  }

  return (
    <Box ref={ref} {...rest}>
      {heading ? (
        <Typography variant="h5" gutterBottom>
          {heading}
        </Typography>
      ) : null}
      {items && items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {emptyText || 'Nothing saved yet — tap the heart on any product.'}
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              md: 'repeat(4, 1fr)',
            },
          }}
        >
          {(items ?? []).map((item) => (
            <Card key={item.id} variant="outlined">
              <CardActionArea href={`/products/${item.slug}`}>
                {item.imageUrl ? (
                  <CardMedia
                    component="img"
                    image={item.imageUrl}
                    alt={item.name}
                    sx={{ height: 120, objectFit: 'cover' }}
                  />
                ) : (
                  <Box sx={{ height: 120, bgcolor: 'action.hover' }} />
                )}
                <CardContent sx={{ pb: 1 }}>
                  <Typography variant="body2" noWrap>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.soldOut ? 'Sold out' : `$${item.priceUsd}`}
                  </Typography>
                </CardContent>
              </CardActionArea>
              <Button
                size="small"
                color="error"
                fullWidth
                onClick={() => void toggleWishlist(hostId, item.id)}
              >
                {'Remove'}
              </Button>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  )
})
Wishlist.displayName = 'AglynWishlist'

export const schema: Aglyn.ComponentSchema<WishlistProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Wishlist',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiHeartOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Shown above the saved products.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'emptyText',
      label: 'Empty text',
      description: 'Copy when nothing is saved.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Wishlist',
    pluginId: BUNDLE_ID,
    description: 'Saved products with links back to their pages',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiHeartOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Your wishlist' },
    },
  },
]

export default Wishlist
