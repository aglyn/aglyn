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

import { FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import { memo } from 'react'
import * as CommerceModel from '../../model'

type Patch = Partial<CommerceModel.HostProduct>

/** What the section reads of a variant: never its price or SKU, so typing those does not redraw it. */
export type CheckInVariant = Pick<CommerceModel.ProductVariant, 'id' | 'options' | 'checkIn'>

export interface ProductCheckInFieldsProps {
  checkIn: CommerceModel.ProductCheckIn | undefined
  variants: readonly CheckInVariant[]
  update: (patch: Patch | ((at: CommerceModel.HostProduct) => Patch)) => void
}

type VariantChoice = 'product' | 'on' | 'off'

/** A whole number of people from 1 to the ceiling, from what was typed; blank is 1. */
function headcountFrom(value: string): number {
  const count = Math.round(Number(value))
  return Number.isFinite(count) && count >= 1 ? Math.min(count, CommerceModel.CHECK_IN_MAX_HEADCOUNT) : 1
}

function variantLabel(variant: CheckInVariant): string {
  const values = Object.values(variant.options ?? {})
  return values.length ? values.join(' / ') : 'Default'
}

/**
 * Check-in at the window (AGL-4043): whether each item sold of this product
 * is somebody to check in on the day it is for — a day pass, a camping
 * spot, parking — and how many people one item admits. A product with
 * options can turn it on or off per variant ("Spectator" needs no
 * wristband) and give a variant its own number of people. "Ask the buyer
 * which day" lets an online buyer pick the day (a pass bought ahead);
 * without an answer it is the day they buy.
 *
 * Memoized on its own props like every section of this editor (AGL-3423).
 */
export const ProductCheckInFields = memo(function ProductCheckInFields(props: ProductCheckInFieldsProps) {
  const { checkIn, variants, update } = props
  const enabled = checkIn?.enabled === true
  const headcount = checkIn?.headcount ?? 1
  const askUseDate = checkIn?.askUseDate === true
  /** The product's setting with one part changed, keeping the others. */
  const productOn = (patch: Partial<CommerceModel.ProductCheckIn>): CommerceModel.ProductCheckIn => ({
    enabled: true,
    headcount,
    ...(askUseDate ? { askUseDate: true } : {}),
    ...patch,
  })

  const setProduct = (next: CommerceModel.ProductCheckIn) => update({ checkIn: next })
  // Written against the draft as it stands, so a price typed meanwhile is kept.
  const setVariant = (id: string, next: CommerceModel.ProductCheckIn | undefined) =>
    update((at) => ({
      variants: at.variants.map((variant) => {
        if (variant.id !== id) return variant
        const { checkIn: _previous, ...rest } = variant
        return next ? { ...rest, checkIn: next } : rest
      }),
    }))

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" component="h3">
        {'Check-in'}
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            onChange={(event) => setProduct(event.target.checked ? productOn({}) : { enabled: false })}
          />
        }
        label="Needs check-in"
      />
      <Typography variant="body2" color="text.secondary">
        {'Each one sold, online or at the register, is somebody to check in at the window on the day it is for, ' +
          'with an optional wristband number or color.'}
      </Typography>
      {enabled ? (
        <TextField
          label="People per item"
          size="small"
          value={headcount}
          onChange={(event) => setProduct(productOn({ headcount: headcountFrom(event.target.value) }))}
          helperText={headcount > 1 ? `Buying 3 makes ${3 * headcount} check-ins` : 'Buying 3 makes 3 check-ins'}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          sx={{ maxWidth: (theme) => theme.spacing(28) }}
        />
      ) : null}
      {enabled ? (
        <FormControlLabel
          control={
            <Switch
              checked={askUseDate}
              onChange={(event) => {
                const { askUseDate: _was, ...rest } = productOn({})
                setProduct(event.target.checked ? { ...rest, askUseDate: true } : rest)
              }}
            />
          }
          label="Ask the buyer which day"
        />
      ) : null}
      {enabled ? (
        <Typography variant="body2" color="text.secondary">
          {askUseDate
            ? 'Buyers online can pick the day they will use it, from today on. If they skip it, it is for the day they buy.'
            : 'It is for the day it is bought. Turn this on to sell passes ahead for a day the buyer picks.'}
        </Typography>
      ) : null}
      {variants.length > 1
        ? variants.map((variant) => {
            const own = CommerceModel.normalizeProductCheckIn(variant.checkIn)
            const choice: VariantChoice = own ? (own.enabled ? 'on' : 'off') : 'product'
            return (
              <Stack key={variant.id} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  select
                  size="small"
                  label={variantLabel(variant)}
                  value={choice}
                  onChange={(event) => {
                    const picked = event.target.value as VariantChoice
                    setVariant(
                      variant.id,
                      picked === 'product'
                        ? undefined
                        : picked === 'on'
                          ? {
                              enabled: true,
                              headcount: own?.headcount ?? headcount,
                              ...(askUseDate ? { askUseDate: true } : {}),
                            }
                          : { enabled: false },
                    )
                  }}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="product">{enabled ? 'Same as the product (needs check-in)' : 'Same as the product (no check-in)'}</MenuItem>
                  <MenuItem value="on">{'Needs check-in'}</MenuItem>
                  <MenuItem value="off">{'No check-in'}</MenuItem>
                </TextField>
                {choice === 'on' ? (
                  <TextField
                    label="People per item"
                    size="small"
                    value={own?.headcount ?? 1}
                    onChange={(event) =>
                      setVariant(variant.id, {
                        enabled: true,
                        headcount: headcountFrom(event.target.value),
                        ...(own?.askUseDate ? { askUseDate: true } : {}),
                      })
                    }
                    slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                    sx={{ flex: 1 }}
                  />
                ) : null}
                {choice === 'on' ? (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={own?.askUseDate === true}
                        onChange={(event) =>
                          setVariant(variant.id, {
                            enabled: true,
                            headcount: own?.headcount ?? 1,
                            ...(event.target.checked ? { askUseDate: true } : {}),
                          })
                        }
                      />
                    }
                    label="Ask which day"
                    sx={{ flex: 1 }}
                  />
                ) : null}
              </Stack>
            )
          })
        : null}
    </Stack>
  )
})

ProductCheckInFields.displayName = 'ProductCheckInFields'
