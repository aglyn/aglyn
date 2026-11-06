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
  Collapse,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { memo, useCallback, useId, useState } from 'react'
import * as CommerceModel from '../../model'
import { CardPictureField, type ProductMediaPick } from './product-builder-fields.component'

type Patch = Partial<CommerceModel.HostProduct>

export interface ProductAddOnsFieldsProps {
  modifierGroups: readonly CommerceModel.ProductModifierGroup[]
  /** The product's options, to name what a choice is priced by. */
  options: readonly CommerceModel.ProductOption[]
  /** The product's variants, each of which a choice may be priced on. */
  variants: readonly Pick<CommerceModel.ProductVariant, 'id' | 'options'>[]
  update: (patch: Patch) => void
  /** Opens the media browser for a choice's picture (AGL-4205); without it, no picture is chosen. */
  pick?: ProductMediaPick
}

function newId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`
}

/** Dollars as typed, to whole cents; blank is free. */
function centsFromDollars(value: string): number {
  const number = Math.round(Number(String(value).replace(/[^0-9.]/g, '')) * 100)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/** Cents as the price field shows them; blank for free. */
function dollarsFromCents(cents: number | undefined): string {
  return cents ? (cents / 100).toFixed(2) : ''
}

/**
 * What a choice's per-variant prices are called (AGL-4100): by the one
 * option a product varies by ("Price by size"), else by variant.
 */
export function priceByLabel(options: readonly Pick<CommerceModel.ProductOption, 'name'>[]): string {
  const named = options.filter((option) => option.name?.trim())
  return named.length === 1 ? `Price by ${named[0].name.trim().toLowerCase()}` : 'Price by variant'
}

/** A new group, as the console makes it from now on: shown on the website (AGL-4100). */
export function newAddOnGroup(): CommerceModel.ProductModifierGroup {
  return {
    id: newId('g'),
    name: '',
    min: 0,
    max: 1,
    online: true,
    options: [{ id: newId('o'), name: '', priceCents: 0 }],
  }
}

/**
 * A choice's prices by variant with one variant's price set or cleared. A
 * cleared price follows the choice's own; with none left the field is
 * dropped, never stored as `undefined` (the save is a client-direct write,
 * which refuses one).
 */
export function withVariantPrice(
  option: CommerceModel.ProductModifierOption,
  variantId: string,
  raw: string,
): CommerceModel.ProductModifierOption {
  const { priceCentsByVariant, ...rest } = option
  const next = { ...(priceCentsByVariant ?? {}) }
  if (raw.trim() === '') delete next[variantId]
  else next[variantId] = centsFromDollars(raw)
  return Object.keys(next).length ? { ...rest, priceCentsByVariant: next } : rest
}

/**
 * A choice with its card changed (AGL-4205): its picture, its note, or what
 * it includes as a combo, typed one item per line. A cleared field is
 * dropped, never stored as `undefined`.
 */
export function withChoiceCard(
  option: CommerceModel.ProductModifierOption,
  patch: { imageUrl?: string | null; note?: string | null; includes?: string | null },
): CommerceModel.ProductModifierOption {
  const next: CommerceModel.ProductModifierOption = { ...option }
  if ('imageUrl' in patch) {
    const url = String(patch.imageUrl ?? '').trim()
    if (url) next.imageUrl = url
    else delete next.imageUrl
  }
  if ('note' in patch) {
    const note = String(patch.note ?? '').trim().slice(0, CommerceModel.PRODUCT_CHOICE_NOTE_MAX)
    if (note) next.note = note
    else delete next.note
  }
  if ('includes' in patch) {
    const items = String(patch.includes ?? '')
      .split('\n')
      .map((item) => item.trim().slice(0, CommerceModel.PRODUCT_COMBO_ITEM_MAX))
      .filter(Boolean)
      .slice(0, CommerceModel.PRODUCT_COMBO_MAX_ITEMS)
    if (items.length) next.includes = items
    else delete next.includes
  }
  return next
}

/**
 * The product's add-ons (AGL-4100, from the register's modifiers of
 * AGL-3607): choices added to the item that are not stocked variants — walls
 * and printing on a canopy, a milk in a latte — each free or adding to the
 * price, and able to cost more on one variant than another. A group with a
 * minimum of 1 or more must be answered before the item is added. Each group
 * says whether the website's product page offers it; the register always
 * does.
 *
 * Offered on every store, with or without the point of sale, and saved with
 * the product, so editing it takes exactly what editing the product takes.
 * Memoized on its own props like every section of this editor (AGL-3423).
 */
export const ProductAddOnsFields = memo(function ProductAddOnsFields(
  props: ProductAddOnsFieldsProps,
) {
  const { modifierGroups, options, variants, update, pick } = props
  const helpId = useId()
  const [pricedByVariant, setPricedByVariant] = useState<Record<string, boolean>>({})
  const [cardOpen, setCardOpen] = useState<Record<string, boolean>>({})
  const setGroups = useCallback(
    (groups: CommerceModel.ProductModifierGroup[]) => update({ modifierGroups: groups }),
    [update],
  )
  const editGroup = (index: number, patch: Partial<CommerceModel.ProductModifierGroup>) =>
    setGroups(modifierGroups.map((group, at) => (at === index ? { ...group, ...patch } : group)))
  const replaceOption = (
    groupIndex: number,
    optionIndex: number,
    next: CommerceModel.ProductModifierOption,
  ) => {
    const group = modifierGroups[groupIndex]
    editGroup(groupIndex, {
      options: group.options.map((option, at) => (at === optionIndex ? next : option)),
    })
  }
  const editOption = (
    groupIndex: number,
    optionIndex: number,
    patch: Partial<CommerceModel.ProductModifierOption>,
  ) => replaceOption(groupIndex, optionIndex, { ...modifierGroups[groupIndex].options[optionIndex], ...patch })
  const problem = CommerceModel.modifierGroupsProblem(modifierGroups)
  const variesByVariant = variants.length > 1
  const byLabel = priceByLabel(options)

  return (
    <Stack spacing={2}>
      <Typography id={helpId} variant="body2" color="text.secondary">
        {'Add-ons are choices added to the item that don’t need their own stock, such as walls or ' +
          'printing on a canopy, or a milk in a latte. Each can be free or add to the price, and can ' +
          'cost more on a larger size. Show a group on the website to offer it on the product’s page; ' +
          'the register offers every group.'}
      </Typography>
      {modifierGroups.map((group, groupIndex) => (
        <Box
          key={group.id}
          role="group"
          aria-label={group.name || 'Add-on group'}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 1 }}>
              <TextField
                label="Group name"
                size="small"
                value={group.name}
                onChange={(event) => editGroup(groupIndex, { name: event.target.value })}
                sx={{ flex: 1, minWidth: (theme) => theme.spacing(20) }}
              />
              <TextField
                label="At least"
                size="small"
                value={group.min}
                onChange={(event) =>
                  editGroup(groupIndex, { min: Math.max(0, Math.round(Number(event.target.value) || 0)) })
                }
                helperText={group.min > 0 ? 'Required' : 'Optional'}
                sx={{ width: (theme) => theme.spacing(12) }}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
              <TextField
                label="At most"
                size="small"
                value={group.max}
                onChange={(event) =>
                  editGroup(groupIndex, { max: Math.max(1, Math.round(Number(event.target.value) || 1)) })
                }
                sx={{ width: (theme) => theme.spacing(12) }}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
              <Button
                color="error"
                onClick={() => setGroups(modifierGroups.filter((_group, at) => at !== groupIndex))}
              >
                {'Remove group'}
              </Button>
            </Stack>
            <FormControlLabel
              control={
                <Switch
                  checked={group.online === true}
                  onChange={(event) => editGroup(groupIndex, { online: event.target.checked })}
                />
              }
              label="Show on the website"
            />
            <Typography variant="caption" color="text.secondary">
              {group.online === true
                ? 'Offered on the product’s page and at the register.'
                : 'Offered at the register only.'}
            </Typography>
            {group.options.map((option, optionIndex) => {
              const optionKey = `${group.id}:${option.id}`
              const byVariantOpen =
                pricedByVariant[optionKey] ?? Object.keys(option.priceCentsByVariant ?? {}).length > 0
              const hasCard = Boolean(option.imageUrl || option.note || option.includes?.length)
              const cardShown = cardOpen[optionKey] ?? hasCard
              const choiceLabel = option.name || 'this choice'
              return (
                <Box key={option.id}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                    <TextField
                      label="Choice"
                      size="small"
                      value={option.name}
                      onChange={(event) => editOption(groupIndex, optionIndex, { name: event.target.value })}
                      sx={{ flex: 1, minWidth: (theme) => theme.spacing(20) }}
                    />
                    <TextField
                      label="Adds ($)"
                      size="small"
                      defaultValue={dollarsFromCents(option.priceCents)}
                      placeholder="0.00"
                      onBlur={(event) =>
                        editOption(groupIndex, optionIndex, { priceCents: centsFromDollars(event.target.value) })
                      }
                      sx={{ width: (theme) => theme.spacing(15) }}
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                    {variesByVariant ? (
                      <Button
                        size="small"
                        aria-expanded={byVariantOpen}
                        onClick={() =>
                          setPricedByVariant((open) => ({ ...open, [optionKey]: !byVariantOpen }))
                        }
                      >
                        {byLabel}
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      aria-expanded={cardShown}
                      onClick={() => setCardOpen((open) => ({ ...open, [optionKey]: !cardShown }))}
                    >
                      {'Picture & combo'}
                    </Button>
                    <IconButton
                      aria-label={`Remove ${option.name || 'choice'}`}
                      onClick={() =>
                        editGroup(groupIndex, {
                          options: group.options.filter((_option, at) => at !== optionIndex),
                          max: Math.max(1, Math.min(group.max, group.options.length - 1)),
                        })
                      }
                    >
                      {'✕'}
                    </IconButton>
                  </Stack>
                  {variesByVariant ? (
                    <Collapse in={byVariantOpen} unmountOnExit>
                      <Stack spacing={1} sx={{ pl: 2, pt: 1.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          {`What “${option.name || 'this choice'}” adds on each. Leave one blank to use ` +
                            'the price above.'}
                        </Typography>
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                            gap: 1,
                          }}
                        >
                          {variants.map((variant) => (
                            <TextField
                              key={variant.id}
                              label={CommerceModel.variantPriceLabel(variant)}
                              size="small"
                              defaultValue={dollarsFromCents(option.priceCentsByVariant?.[variant.id])}
                              placeholder={dollarsFromCents(option.priceCents) || '0.00'}
                              onBlur={(event) =>
                                replaceOption(
                                  groupIndex,
                                  optionIndex,
                                  withVariantPrice(
                                    modifierGroups[groupIndex].options[optionIndex],
                                    variant.id,
                                    event.target.value,
                                  ),
                                )
                              }
                              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                            />
                          ))}
                        </Box>
                      </Stack>
                    </Collapse>
                  ) : null}
                  <Collapse in={cardShown} unmountOnExit>
                    <Stack spacing={1} sx={{ pl: 2, pt: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {`What “${choiceLabel}” shows on its picture card. List what it includes to make it ` +
                          'a combo: shoppers can open the list on its card.'}
                      </Typography>
                      <CardPictureField
                        imageUrl={option.imageUrl}
                        label={choiceLabel}
                        pick={pick}
                        onChange={(imageUrl) =>
                          replaceOption(
                            groupIndex,
                            optionIndex,
                            withChoiceCard(modifierGroups[groupIndex].options[optionIndex], { imageUrl }),
                          )
                        }
                      />
                      <TextField
                        label="Note"
                        size="small"
                        defaultValue={option.note ?? ''}
                        placeholder="Blocks wind on one side"
                        onBlur={(event) =>
                          replaceOption(
                            groupIndex,
                            optionIndex,
                            withChoiceCard(modifierGroups[groupIndex].options[optionIndex], {
                              note: event.target.value,
                            }),
                          )
                        }
                        slotProps={{ htmlInput: { maxLength: CommerceModel.PRODUCT_CHOICE_NOTE_MAX } }}
                      />
                      <TextField
                        label="Combo: what it includes"
                        size="small"
                        multiline
                        minRows={2}
                        defaultValue={(option.includes ?? []).join('\n')}
                        placeholder={'Full wall ×2\nSteel weights ×4\nRoller bag'}
                        helperText={`One item per line, up to ${CommerceModel.PRODUCT_COMBO_MAX_ITEMS}. Leave it empty for a single choice.`}
                        onBlur={(event) =>
                          replaceOption(
                            groupIndex,
                            optionIndex,
                            withChoiceCard(modifierGroups[groupIndex].options[optionIndex], {
                              includes: event.target.value,
                            }),
                          )
                        }
                      />
                    </Stack>
                  </Collapse>
                </Box>
              )
            })}
            <Box>
              <Button
                onClick={() =>
                  editGroup(groupIndex, {
                    options: [...group.options, { id: newId('o'), name: '', priceCents: 0 }],
                  })
                }
                disabled={group.options.length >= CommerceModel.POS_MAX_MODIFIER_OPTIONS}
              >
                {'Add choice'}
              </Button>
            </Box>
          </Stack>
        </Box>
      ))}
      <Box>
        <Button
          variant="outlined"
          aria-describedby={helpId}
          onClick={() => setGroups([...modifierGroups, newAddOnGroup()])}
          disabled={modifierGroups.length >= CommerceModel.POS_MAX_MODIFIER_GROUPS}
        >
          {'New add-on group'}
        </Button>
      </Box>
      {problem && modifierGroups.length ? (
        <Typography variant="body2" color="warning.main">
          {problem}
        </Typography>
      ) : null}
    </Stack>
  )
})
