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

import type { PickedMedia } from '@aglyn/aglyn'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { memo } from 'react'
import * as CommerceModel from '../../model'

/*
 * THE PRODUCT BUILDER'S FIELDS IN THE PRODUCT EDITOR (AGL-4205).
 *
 * A product page whose Product detail block shows its choices as picture
 * cards draws a card for each choice. A variant's card carries the variant's
 * picture (the one the gallery already switches to) and a short note; an
 * add-on choice's card carries its own, set beside the choice. The switch
 * here offers "Get a free mockup" on the product's page.
 */

/** Opens the media browser and hands what was chosen to `apply`. */
export type ProductMediaPick = (apply: (media: PickedMedia) => void) => Promise<void>

type Patch = Partial<CommerceModel.HostProduct>
type ProductUpdate = (patch: Patch | ((product: CommerceModel.HostProduct) => Patch)) => void

/** A variant as this section reads it: what names it and what its card shows. */
export type VariantCardSlice = Pick<CommerceModel.ProductVariant, 'id' | 'options' | 'imageUrl' | 'note'>

/**
 * The variants with one variant's card changed. A cleared picture or note is
 * dropped, never stored as `undefined` (the save is a client-direct write,
 * which refuses one).
 */
export function withVariantCard(
  variants: readonly CommerceModel.ProductVariant[],
  variantId: string,
  patch: { imageUrl?: string | null; note?: string | null },
): CommerceModel.ProductVariant[] {
  return variants.map((variant) => {
    if (variant.id !== variantId) return variant
    const next: CommerceModel.ProductVariant = { ...variant }
    for (const key of ['imageUrl', 'note'] as const) {
      if (!(key in patch)) continue
      const value = String(patch[key] ?? '').trim()
      if (value) next[key] = key === 'note' ? value.slice(0, CommerceModel.PRODUCT_CHOICE_NOTE_MAX) : value
      else delete next[key]
    }
    return next
  })
}

/** A small picture with Choose and Remove beside it: the card's picture field. */
export function CardPictureField(props: {
  imageUrl: string | undefined
  /** Who the picture is of, for the buttons' names. */
  label: string
  pick: ProductMediaPick | undefined
  onChange: (imageUrl: string | null) => void
}) {
  const { imageUrl, label, pick, onChange } = props
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      {imageUrl ? (
        <Box
          component="img"
          src={imageUrl}
          alt=""
          sx={{
            width: (theme) => theme.spacing(7),
            height: (theme) => theme.spacing(7),
            objectFit: 'cover',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
          }}
        />
      ) : null}
      <Button
        size="small"
        disabled={!pick}
        aria-label={`${imageUrl ? 'Change' : 'Choose'} the picture for ${label}`}
        onClick={() => void pick?.((media) => onChange(media.url))}
      >
        {imageUrl ? 'Change picture' : 'Choose picture'}
      </Button>
      {imageUrl ? (
        <Button size="small" color="inherit" aria-label={`Remove the picture for ${label}`} onClick={() => onChange(null)}>
          {'Remove'}
        </Button>
      ) : null}
    </Stack>
  )
}

export interface ProductBuilderFieldsProps {
  /** Each variant's id, options and card, and nothing else (AGL-3423). */
  variants: readonly VariantCardSlice[]
  mockupRequests: boolean
  update: ProductUpdate
  pick: ProductMediaPick | undefined
}

/**
 * The "Product page" section of the product editor: the free-mockup switch
 * and each variant's picture card. Memoized on its own slice of the product,
 * like every section of this editor, so a keystroke in a price leaves it be.
 */
export const ProductBuilderFields = memo(function ProductBuilderFields(props: ProductBuilderFieldsProps) {
  const { variants, mockupRequests, update, pick } = props
  const setCard = (variantId: string, patch: { imageUrl?: string | null; note?: string | null }) =>
    update((product) => ({ variants: withVariantCard(product.variants, variantId, patch) }))
  return (
    <Stack spacing={2}>
      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={mockupRequests}
              onChange={(event) => update({ mockupRequests: event.target.checked })}
            />
          }
          label="Offer a free mockup"
        />
        <Typography variant="body2" color="text.secondary">
          {mockupRequests
            ? 'The product’s page shows Get a free mockup. It opens the request form placed in the page’s ' +
              'Product detail block, filled in with what the shopper picked. The request arrives in your Inbox, ' +
              'and Start a quote begins with those picks at their prices.'
            : 'Turn on to let shoppers ask for a mockup of what they picked before they buy.'}
        </Typography>
      </Box>
      <Box>
        <Typography variant="subtitle2" component="p">
          {'Picture cards'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {'When the page shows choices as picture cards, each option’s card shows this picture and note. ' +
            'The picture is also the one the gallery shows when the option is picked.'}
        </Typography>
        <Stack spacing={1.5}>
          {variants.map((variant) => {
            const label = CommerceModel.variantPriceLabel(variant)
            return (
              <Stack
                key={variant.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ alignItems: { sm: 'center' } }}
              >
                <Typography variant="body2" sx={{ minWidth: (theme) => theme.spacing(16), fontWeight: 500 }}>
                  {label}
                </Typography>
                <CardPictureField
                  imageUrl={variant.imageUrl}
                  label={label}
                  pick={pick}
                  onChange={(imageUrl) => setCard(variant.id, { imageUrl })}
                />
                <TextField
                  label="Note"
                  size="small"
                  defaultValue={variant.note ?? ''}
                  placeholder="Fits two tables"
                  onBlur={(event) => setCard(variant.id, { note: event.target.value })}
                  sx={{ flex: 1 }}
                  slotProps={{
                    htmlInput: {
                      maxLength: CommerceModel.PRODUCT_CHOICE_NOTE_MAX,
                      'aria-label': `Note for ${label}`,
                    },
                  }}
                />
              </Stack>
            )
          })}
        </Stack>
      </Box>
    </Stack>
  )
})
