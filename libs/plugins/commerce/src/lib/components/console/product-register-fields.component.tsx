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

import {
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { memo, useId } from 'react'
import * as CommerceModel from '../../model'

type Patch = Partial<CommerceModel.HostProduct>

export interface ProductRegisterFieldsProps {
  posQuickKey: boolean
  /** `productSellsOnline` of the product: absent reads as on. */
  sellOnline: boolean
  /** What the site does with the reviews of a product sold in person only (AGL-4060). */
  inStoreReviews?: CommerceModel.HostProduct['inStoreReviews']
  update: (patch: Patch) => void
}

export interface ProductSellOnlineFieldProps {
  sellOnline: boolean
  /** What the site does with its reviews while it sells in person only; absent reads as `show`. */
  inStoreReviews?: CommerceModel.HostProduct['inStoreReviews']
  update: (patch: Patch) => void
}

/** The "Reviews on your site" choices, as the editor words them (AGL-4060). */
const IN_STORE_REVIEWS_OPTIONS: ReadonlyArray<{ value: 'show' | 'hide'; label: string; help: string }> = [
  {
    value: 'show',
    label: 'Show, marked Sold in store',
    help: 'Its reviews appear in your site’s reviews and its average, marked “Sold in store”, with no link to a product page.',
  },
  {
    value: 'hide',
    label: 'Hide',
    help: 'Its reviews appear nowhere on your site: not in the reviews list and not in its average. You still see them under Reviews here.',
  },
]

/**
 * The product's "Sell online" switch (AGL-4060). On (the default, and what
 * every product stored before it reads as) the product sells on the site and
 * its channels as it always has; off, it sells in person only.
 */
export const ProductSellOnlineField = memo(function ProductSellOnlineField(
  props: ProductSellOnlineFieldProps,
) {
  const { sellOnline, update } = props
  const helpId = useId()
  const reviews = props.inStoreReviews === 'hide' ? 'hide' : 'show'
  return (
    <Stack spacing={1}>
      <FormControlLabel
        control={
          <Switch
            checked={sellOnline}
            onChange={(event) => update({ sellOnline: event.target.checked })}
            slotProps={{ input: { 'aria-describedby': helpId } }}
          />
        }
        label="Sell online"
      />
      <Typography id={helpId} variant="body2" color="text.secondary">
        {sellOnline
          ? 'Sold on your site — its product page, product grids, search, the cart and checkout — and in any shopping feeds and marketplaces you connect, as well as in person.'
          : `In person only: sold at the register, the kiosk, the ${PLATFORM_BRAND_NAME} POS apps and on draft orders. It has no page on your site and is left out of product grids, search, the sitemap, the cart, checkout and every shopping feed.`}
      </Typography>
      {/*
        Its reviews, while it sells in person only (AGL-4060): shown on the
        site marked "Sold in store" by default, or kept off it. Online, a
        product's reviews are always on its own page, so the choice is not
        offered.
      */}
      {sellOnline ? null : (
        <TextField
          select
          size="small"
          label="Reviews on your site"
          value={reviews}
          onChange={(event) => update({ inStoreReviews: event.target.value as 'show' | 'hide' })}
          helperText={IN_STORE_REVIEWS_OPTIONS.find((option) => option.value === reviews)?.help}
        >
          {IN_STORE_REVIEWS_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      )}
    </Stack>
  )
})

/**
 * The product's register settings (AGL-3607): whether it is a quick key on
 * the register's first screen, and whether it sells online at all. Its
 * add-ons — the register's modifiers — are edited for every store in
 * `ProductAddOnsFields` (AGL-4100), where each group says whether the
 * website offers it too.
 *
 * Memoized on its own props like every section of this editor (AGL-3423):
 * a keystroke elsewhere in the dialog does not redraw it.
 */
export const ProductRegisterFields = memo(function ProductRegisterFields(
  props: ProductRegisterFieldsProps,
) {
  const { update } = props
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" component="h3">
        {'At the register'}
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={props.posQuickKey}
            onChange={(event) => update({ posQuickKey: event.target.checked })}
          />
        }
        label="Quick key at the register"
      />
      <ProductSellOnlineField sellOnline={props.sellOnline} inStoreReviews={props.inStoreReviews} update={update} />
    </Stack>
  )
})
