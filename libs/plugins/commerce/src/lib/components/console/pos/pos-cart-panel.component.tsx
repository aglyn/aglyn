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

import type { ReactNode } from 'react'
import { Box, Button, ButtonBase, IconButton, Stack, TextField, Typography } from '@mui/material'
import type { ModifierSelection, StockShortfall } from '../../../model'
import { POS_TOUCH_PX } from './pos-product-grid.component'
import { usd } from './pos-api'

export interface RegisterLine {
  productId: string
  variantId?: string
  name: string
  variantLabel?: string
  /** Per unit, modifiers included: the register's estimate until the server prices it. */
  unitAmountCents: number
  quantity: number
  /** The modifier options picked (AGL-3607); the server prices them. */
  modifiers?: ModifierSelection[]
}

export interface PosCartPanelProps {
  lines: RegisterLine[]
  shortfalls: Array<Pick<StockShortfall, 'available'> | null>
  onQuantity: (index: number, quantity: number) => void
  onRemove: (index: number) => void
  /** Opens the line in the item sheet to change its options or quantity. */
  onEdit?: (index: number) => void
  discountPct: number
  onDiscountPct: (value: number) => void
  /** The register's customer lookup (AGL-3609), under the discount. */
  customer?: ReactNode
  /** Lines can no longer change: a sale is open against them. */
  locked: boolean
}

/**
 * The basket (AGL-3607): lines with large quantity steppers, the stock
 * warning under any line the shelf cannot cover (AGL-2357, said and never
 * enforced), the cashier's discount and the customer the sale is for.
 */
export function PosCartPanel(props: PosCartPanelProps) {
  const { lines, locked } = props
  return (
    <Stack spacing={1} sx={{ minHeight: 0 }}>
      <Box sx={{ overflowY: 'auto', flex: 1 }}>
        {lines.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Tap products to add them.'}
          </Typography>
        ) : (
          lines.map((line, index) => (
            <Box key={`${line.productId}:${line.variantId ?? ''}:${index}`} sx={{ py: 0.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <ButtonBase
                  disabled={locked || !props.onEdit}
                  onClick={() => props.onEdit?.(index)}
                  aria-label={locked ? undefined : `Change ${line.name}`}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: POS_TOUCH_PX,
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    borderRadius: 1,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {`${line.quantity}× ${line.name}`}
                    </Typography>
                    {line.variantLabel ? (
                      <Typography variant="caption" color="text.secondary" component="p" noWrap>
                        {line.variantLabel}
                      </Typography>
                    ) : null}
                  </Box>
                </ButtonBase>
                {!locked ? (
                  <>
                    <IconButton
                      aria-label={`One fewer ${line.name}`}
                      onClick={() => props.onQuantity(index, line.quantity - 1)}
                      sx={{ width: POS_TOUCH_PX, height: POS_TOUCH_PX }}
                    >
                      {'−'}
                    </IconButton>
                    <IconButton
                      aria-label={`One more ${line.name}`}
                      onClick={() => props.onQuantity(index, line.quantity + 1)}
                      sx={{ width: POS_TOUCH_PX, height: POS_TOUCH_PX }}
                    >
                      {'+'}
                    </IconButton>
                  </>
                ) : null}
                <Typography variant="body2">{usd(line.unitAmountCents * line.quantity)}</Typography>
                {!locked ? (
                  <Button
                    color="error"
                    onClick={() => props.onRemove(index)}
                    aria-label={`Remove ${line.name}`}
                    sx={{ minWidth: POS_TOUCH_PX, minHeight: POS_TOUCH_PX }}
                  >
                    {'✕'}
                  </Button>
                ) : null}
              </Stack>
              {props.shortfalls[index] ? (
                <Typography variant="caption" color="warning.main">
                  {`Only ${props.shortfalls[index]?.available} in stock — selling ${line.quantity}`}
                </Typography>
              ) : null}
            </Box>
          ))
        )}
      </Box>
      <Stack direction="row" spacing={1}>
        <TextField
          label="Discount %"
          value={props.discountPct || ''}
          onChange={(event) =>
            props.onDiscountPct(Math.min(100, Math.max(0, Number(event.target.value) || 0)))
          }
          disabled={locked}
          sx={{ width: 120 }}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
        />
      </Stack>
      {props.customer}
    </Stack>
  )
}
PosCartPanel.displayName = 'PosCartPanel'
