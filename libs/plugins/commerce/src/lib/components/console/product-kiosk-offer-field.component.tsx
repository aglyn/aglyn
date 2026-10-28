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

import { Checkbox, FormControlLabel, FormGroup, FormLabel, Stack, Switch, Typography } from '@mui/material'
import { memo, useId } from 'react'
import * as CommerceModel from '../../model'

type Patch = Partial<CommerceModel.HostProduct>

/** What the section reads of a variant: never its price or SKU, so typing those does not redraw it. */
export type KioskOfferVariant = Pick<CommerceModel.ProductVariant, 'id' | 'options' | 'offerOnKiosk'>

export interface ProductKioskOfferFieldProps {
  /** `productOfferedOnKiosk` of the product: absent reads as on. */
  offerOnKiosk: boolean
  variants: readonly KioskOfferVariant[]
  update: (patch: Patch | ((at: CommerceModel.HostProduct) => Patch)) => void
}

function variantLabel(variant: KioskOfferVariant): string {
  const values = Object.values(variant.options ?? {})
  return values.length ? values.join(' / ') : 'Default'
}

/**
 * "Offer on the kiosk" (AGL-4038): whether the self-service kiosk offers the
 * product, and for a product with options, which of its variants. On (the
 * default, and what every product stored before the choice reads as) the
 * kiosk offers it as it always has; off, the kiosk leaves it out and refuses
 * it in a cart, while the register, the POS apps and the site sell it as
 * before. The same choice for every product a store sells.
 *
 * Memoized on its own props like every section of this editor (AGL-3423).
 */
export const ProductKioskOfferField = memo(function ProductKioskOfferField(props: ProductKioskOfferFieldProps) {
  const { offerOnKiosk, variants, update } = props
  const helpId = useId()
  const variantsLabelId = useId()
  const setVariant = (variantId: string, offered: boolean) =>
    update((at) => ({
      variants: at.variants.map((variant) =>
        variant.id === variantId ? { ...variant, offerOnKiosk: offered } : variant,
      ),
    }))
  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        control={
          <Switch
            checked={offerOnKiosk}
            onChange={(event) => update({ offerOnKiosk: event.target.checked })}
            slotProps={{ input: { 'aria-describedby': helpId } }}
          />
        }
        label="Offer on the kiosk"
      />
      <Typography id={helpId} variant="body2" color="text.secondary">
        {offerOnKiosk
          ? 'Customers can order it at your self-service kiosk.'
          : 'Left off the self-service kiosk. The register, the POS apps and your site still sell it.'}
      </Typography>
      {offerOnKiosk && variants.length > 1 ? (
        <FormGroup aria-labelledby={variantsLabelId} sx={{ pl: 1 }}>
          <FormLabel id={variantsLabelId} sx={{ typography: 'body2' }}>
            {'Variants the kiosk offers'}
          </FormLabel>
          {variants.map((variant) => (
            <FormControlLabel
              key={variant.id}
              control={
                <Checkbox
                  size="small"
                  checked={variant.offerOnKiosk !== false}
                  onChange={(event) => setVariant(variant.id, event.target.checked)}
                />
              }
              label={variantLabel(variant)}
            />
          ))}
        </FormGroup>
      ) : null}
    </Stack>
  )
})
