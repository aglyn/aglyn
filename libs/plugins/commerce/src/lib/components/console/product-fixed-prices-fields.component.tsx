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

import { Box, Stack, TextField, Typography } from '@mui/material'
import { memo, useState } from 'react'
import * as CommerceModel from '../../model'

export interface ProductFixedPricesFieldsProps {
  variants: readonly CommerceModel.ProductVariant[]
  /** The store currency. */
  base: string
  /** The other currencies the store sells in. */
  currencies: readonly CommerceModel.StoreCurrency[]
  rates: CommerceModel.FxRates | undefined
  /**
   * A variant's fixed price in one currency, as typed: blank clears it, so
   * the price converts again.
   */
  onPrice: (index: number, code: string, raw: string) => void
}

const DECIMAL = { inputMode: 'decimal' } as const

/**
 * Prices in other currencies (AGL-4248): for each variant, one field per
 * currency the store sells in. A blank cell is converted from the
 * variant's price at the day's rate, rounded the way the Currencies card
 * says, and shows that figure as its placeholder; a typed one is charged as
 * typed, the way Shopify Markets' fixed prices are.
 *
 * Fields keep what is typed until they are left (`defaultValue` + blur), so
 * a keystroke redraws nothing else in the editor (AGL-3423).
 */
export const ProductFixedPricesFields = memo(function ProductFixedPricesFields(
  props: ProductFixedPricesFieldsProps,
) {
  const { variants, base, currencies, rates, onPrice } = props
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        {'Optional. Leave a price blank to convert it automatically from the price above.'}
      </Typography>
      <Stack spacing={1.5}>
        {variants.map((variant, index) => {
          const label = CommerceModel.variantPriceLabel(variant)
          return (
            <Box key={variant.id}>
              {variants.length > 1 ? (
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {label}
                </Typography>
              ) : null}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                {currencies.map((entry) => {
                  const cellKey = `${variant.id}:${entry.code}`
                  const fixed = variant.fixedPrices?.[entry.code]
                  const converted = CommerceModel.variantHasPrice(variant)
                    ? CommerceModel.variantPriceMinor({ priceUsd: variant.priceUsd }, base, entry, rates)
                    : undefined
                  return (
                    <TextField
                      key={cellKey}
                      label={`Price (${entry.code})`}
                      defaultValue={fixed == null ? '' : String(fixed)}
                      placeholder={CommerceModel.minorToInput(converted, entry.code)}
                      onBlur={(event) => {
                        const bad = CommerceModel.parseMajorInput(event.target.value) === null
                        setInvalid((was) => ({ ...was, [cellKey]: bad }))
                        if (!bad) onPrice(index, entry.code, event.target.value)
                      }}
                      error={invalid[cellKey] === true}
                      helperText={invalid[cellKey] ? 'Not a price' : undefined}
                      size="small"
                      slotProps={{
                        // A label always shows the placeholder (the converted
                        // price) rather than covering it.
                        inputLabel: { shrink: true },
                        htmlInput: { ...DECIMAL, 'aria-label': `Price in ${entry.code} — ${label}` },
                      }}
                    />
                  )
                })}
              </Box>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
})
