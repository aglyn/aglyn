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
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import * as CommerceModel from '../../../model'
import { usd } from './pos-api'
import { POS_TOUCH_PX } from './pos-product-grid.component'

/** What the dialog hands back: one basket line's worth of choices. */
export interface PosItemChoice {
  variant: CommerceModel.ProductVariant
  modifiers: CommerceModel.ModifierSelection[]
  quantity: number
}

export interface PosItemDialogProps {
  /** The product being added or edited; `null` closes the dialog. */
  product: (CommerceModel.HostProduct & { $id: string }) | null
  /** An existing line's choices, when the cashier tapped a basket line. */
  initial?: { variantId?: string; modifiers?: CommerceModel.ModifierSelection[]; quantity: number }
  onClose: () => void
  onConfirm: (choice: PosItemChoice) => void
  /** Editing only: takes the line out of the basket. */
  onRemove?: () => void
  /**
   * How a price reads; the register's dollars by default. The self-service
   * kiosk (AGL-3623) passes the store's currency.
   */
  formatMoney?: (cents: number) => string
  /**
   * A sold-out variant cannot be added, rather than warned about: a kiosk's
   * customer is not holding the goods the way a cashier is (AGL-3623).
   */
  blockSoldOut?: boolean
  /** The most of one line that can be added; 99 at the register. */
  maxQuantity?: number
}

/** Whether the register must ask before adding: a choice of variant or any modifier. */
export function posItemNeedsChoice(product: CommerceModel.HostProduct): boolean {
  return (
    (product.variants?.length ?? 0) > 1 ||
    CommerceModel.productModifierGroups(product).length > 0
  )
}

/** The variant whose options match every picked value, or undefined. */
function variantFor(
  product: CommerceModel.HostProduct,
  picked: Record<string, string>,
): CommerceModel.ProductVariant | undefined {
  return product.variants.find((variant) =>
    (product.options ?? []).every((option) => variant.options?.[option.name] === picked[option.name]),
  )
}

function variantLabel(variant: CommerceModel.ProductVariant): string {
  return Object.values(variant.options ?? {}).join(' / ') || 'Default'
}

function soldOut(variant: CommerceModel.ProductVariant | undefined): boolean {
  return variant?.inventory != null && variant.inventory <= 0
}

/**
 * The register's item sheet (AGL-3607): the size, color or other variant,
 * then each modifier group — required ones marked, "pick one" groups as a
 * single toggle row and "pick up to N" groups as chips — and the quantity,
 * with the line's price on the Add button as it changes. Full screen on a
 * phone, a dialog on a tablet; every target is at least 44px.
 *
 * The price shown is the register's estimate. The server prices the line
 * again from the product when the sale is charged.
 */
export function PosItemDialog(props: PosItemDialogProps) {
  const { product, initial } = props
  const money = props.formatMoney ?? usd
  const maxQuantity = props.maxQuantity ?? 99
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const groups = useMemo(
    () => (product ? CommerceModel.productModifierGroups(product) : []),
    [product],
  )
  const options = product?.options ?? []
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [variantId, setVariantId] = useState('')
  const [modifiers, setModifiers] = useState<CommerceModel.ModifierSelection[]>([])
  const [quantity, setQuantity] = useState(1)

  useEffect(() => {
    if (!product) return
    const start =
      product.variants.find((variant) => variant.id === initial?.variantId) ??
      product.variants.find((variant) => !soldOut(variant)) ??
      product.variants[0]
    setVariantId(start?.id ?? '')
    setPicked({ ...(start?.options ?? {}) })
    setModifiers(initial?.modifiers ?? [])
    setQuantity(initial?.quantity ?? 1)
  }, [product, initial])

  if (!product) return null

  const variant =
    options.length > 0
      ? variantFor(product, picked)
      : product.variants.find((item) => item.id === variantId)
  const chosen = CommerceModel.resolveLineModifiers(product, modifiers)
  const unitCents = variant
    ? Math.round(Number(variant.priceUsd) * 100) + (chosen.ok ? chosen.extraCents : 0)
    : 0
  const missing = groups.find(
    (group) => modifiers.filter((pick) => pick.groupId === group.id).length < group.min,
  )
  const canAdd =
    Boolean(variant) && chosen.ok && quantity >= 1 && !(props.blockSoldOut && soldOut(variant))

  const toggle = (group: CommerceModel.ProductModifierGroup, optionId: string) => {
    setModifiers((current) => {
      const inGroup = current.filter((pick) => pick.groupId === group.id)
      const has = inGroup.some((pick) => pick.optionId === optionId)
      if (has) return current.filter((pick) => !(pick.groupId === group.id && pick.optionId === optionId))
      // A pick-one group swaps its choice; a pick-many group stops at its max.
      if (group.max === 1) {
        return [...current.filter((pick) => pick.groupId !== group.id), { groupId: group.id, optionId }]
      }
      if (inGroup.length >= group.max) return current
      return [...current, { groupId: group.id, optionId }]
    })
  }

  return (
    <Dialog open onClose={props.onClose} fullScreen={phone} fullWidth maxWidth="sm">
      <DialogTitle>{product.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {options.length > 0
            ? options.map((option) => (
                <Box key={option.name} role="group" aria-label={option.name}>
                  <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>
                    {option.name}
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    value={picked[option.name] ?? null}
                    onChange={(_event, value: string | null) => {
                      if (value) setPicked((current) => ({ ...current, [option.name]: value }))
                    }}
                    sx={{ flexWrap: 'wrap', gap: 1 }}
                  >
                    {option.values.map((value) => (
                      <ToggleButton key={value} value={value} sx={{ minHeight: POS_TOUCH_PX, minWidth: 88 }}>
                        {value}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Box>
              ))
            : product.variants.length > 1 ? (
                <Box role="group" aria-label="Variant">
                  <ToggleButtonGroup
                    exclusive
                    value={variantId || null}
                    onChange={(_event, value: string | null) => value && setVariantId(value)}
                    sx={{ flexWrap: 'wrap', gap: 1 }}
                  >
                    {product.variants.map((item) => (
                      <ToggleButton key={item.id} value={item.id} sx={{ minHeight: POS_TOUCH_PX, minWidth: 88 }}>
                        {`${variantLabel(item)} · ${money(Math.round(Number(item.priceUsd) * 100))}`}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Box>
              ) : null}
          {options.length > 0 && !variant ? (
            <Typography variant="body2" color="warning.main">
              {'That combination is not sold. Pick another.'}
            </Typography>
          ) : null}
          {variant && soldOut(variant) ? (
            <Typography variant="body2" color="warning.main">
              {props.blockSoldOut ? 'Sold out' : 'Out of stock: selling it takes the count below zero.'}
            </Typography>
          ) : null}
          {groups.map((group) => {
            const count = modifiers.filter((pick) => pick.groupId === group.id).length
            const rule = CommerceModel.modifierGroupRequired(group)
              ? group.max === 1
                ? 'Required · pick 1'
                : `Required · pick ${group.min} to ${group.max}`
              : group.max === 1
                ? 'Optional · pick 1'
                : `Optional · up to ${group.max}`
            return (
              <Box key={group.id} role="group" aria-label={group.name}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 1 }}>
                  <Typography variant="subtitle1" component="h3">
                    {group.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={count < group.min ? 'warning.main' : 'text.secondary'}
                  >
                    {rule}
                  </Typography>
                </Stack>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {group.options.map((option) => {
                    const selected = modifiers.some(
                      (pick) => pick.groupId === group.id && pick.optionId === option.id,
                    )
                    return (
                      <Chip
                        key={option.id}
                        label={option.priceCents ? `${option.name} +${money(option.priceCents)}` : option.name}
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        aria-pressed={selected}
                        onClick={() => toggle(group, option.id)}
                        disabled={!selected && group.max > 1 && count >= group.max}
                        sx={{ minHeight: POS_TOUCH_PX, px: 1 }}
                      />
                    )
                  })}
                </Box>
              </Box>
            )
          })}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle1" component="h3" sx={{ flex: 1 }}>
              {'Quantity'}
            </Typography>
            <IconButton
              aria-label="One fewer"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              sx={{ width: POS_TOUCH_PX, height: POS_TOUCH_PX, border: 1, borderColor: 'divider' }}
            >
              {'−'}
            </IconButton>
            <TextField
              value={quantity}
              onChange={(event) => {
                const next = Math.round(Number(event.target.value.replace(/\D/g, '')))
                setQuantity(Math.max(1, Math.min(maxQuantity, next || 1)))
              }}
              sx={{ width: 72 }}
              slotProps={{
                htmlInput: { inputMode: 'numeric', 'aria-label': 'Quantity', style: { textAlign: 'center' } },
              }}
            />
            <IconButton
              aria-label="One more"
              onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}
              sx={{ width: POS_TOUCH_PX, height: POS_TOUCH_PX, border: 1, borderColor: 'divider' }}
            >
              {'+'}
            </IconButton>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        {props.onRemove ? (
          <Button color="error" onClick={props.onRemove} sx={{ minHeight: POS_TOUCH_PX, mr: 'auto' }}>
            {'Remove'}
          </Button>
        ) : null}
        <Button onClick={props.onClose} sx={{ minHeight: POS_TOUCH_PX }}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={!canAdd}
          onClick={() => {
            if (!variant || !chosen.ok) return
            props.onConfirm({ variant, modifiers, quantity })
          }}
          sx={{ minHeight: POS_TOUCH_PX, minWidth: 160 }}
        >
          {missing
            ? `Choose ${missing.name.toLowerCase()}`
            : `${props.onRemove ? 'Update' : 'Add'} · ${money(unitCents * quantity)}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
PosItemDialog.displayName = 'PosItemDialog'
