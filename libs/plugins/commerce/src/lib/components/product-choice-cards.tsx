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

import * as Aglyn from '@aglyn/aglyn'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useId, useState, type ReactNode } from 'react'
import {
  modifierGroupRequired,
  modifierOptionIsCombo,
  modifierOptionPriceCents,
  type ModifierSelection,
  type ProductModifierGroup,
  type ProductModifierOption,
} from '../model/product-modifiers'
import { addOnGroupHint, withGroupAnswer } from './product-add-ons'

/*
 * THE PRODUCT BUILDER'S PICTURE CARDS (AGL-4205).
 *
 * A Product detail block set to show its choices as picture cards draws each
 * of the product's options (size, style) and each of its add-on groups as a
 * row of cards: the choice's picture, its name, what it costs, and the
 * owner's short note. A combo's card folds out what it includes. A group
 * that takes one choice behaves as radio buttons, one that takes several as
 * check boxes up to its maximum, and a required group is marked and cannot
 * be emptied. Its own chunk: only a page that shows cards downloads it.
 */

/** A variant as the cards read it. */
export interface CardVariant {
  id: string
  options?: Record<string, string>
  priceUsd: number | null
  soldOut?: boolean
  imageUrl?: string
  note?: string
}

/**
 * The variant a card for one option value stands for: the one the shopper's
 * other picks make with this value, else the first that carries the value.
 */
export function variantForOptionValue<V extends CardVariant>(
  variants: readonly V[],
  selections: Readonly<Record<string, string>>,
  optionName: string,
  value: string,
): V | undefined {
  const wanted = { ...selections, [optionName]: value }
  return (
    variants.find((variant) =>
      Object.entries(wanted).every(([name, picked]) => (variant.options?.[name] ?? picked) === picked),
    ) ?? variants.find((variant) => variant.options?.[optionName] === value)
  )
}

/**
 * A group's answer after a card is pressed. One-choice groups act as radio
 * buttons (an optional one can be cleared by pressing its pick again); a
 * several-choice group adds or removes the choice, never past its maximum.
 * The answer keeps the group's own order.
 */
export function pressChoice(
  group: Pick<ProductModifierGroup, 'min' | 'max' | 'options'>,
  chosen: readonly string[],
  optionId: string,
): string[] {
  const picked = chosen.includes(optionId)
  if (group.max === 1) {
    if (picked) return group.min > 0 ? [...chosen] : []
    return [optionId]
  }
  if (picked) return chosen.filter((id) => id !== optionId)
  if (chosen.length >= group.max) return [...chosen]
  return group.options.map((option) => option.id).filter((id) => id === optionId || chosen.includes(id))
}

/** What a card says a choice adds: its price, or that it adds nothing. */
export function addOnPriceLabel(cents: number, formatCents: (cents: number) => string): string {
  return cents > 0 ? `+${formatCents(cents)}` : 'No extra charge'
}

interface ChoiceCardProps {
  name: string
  price: string
  note?: string
  imageUrl?: string
  selected: boolean
  disabled?: boolean
  role: 'radio' | 'checkbox'
  onPress: () => void
  badge?: ReactNode
  includes?: readonly string[]
}

/** One card: picture, name, price and note, pressed to pick; a combo's contents fold out below. */
function ChoiceCard(props: ChoiceCardProps) {
  const { name, price, note, imageUrl, selected, disabled, role, onPress, badge, includes } = props
  const { hostId } = Aglyn.useSite()
  const [open, setOpen] = useState(false)
  const contentsId = useId()
  const src = imageUrl ? Aglyn.siteRelativeMediaSrc(imageUrl, { hostId }) : undefined
  return (
    <Card
      variant="outlined"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        borderWidth: 2,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'action.selected' : 'background.paper',
        opacity: disabled && !selected ? 0.6 : 1,
      }}
    >
      <CardActionArea
        role={role}
        aria-checked={selected}
        disabled={disabled}
        onClick={onPress}
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        {src ? (
          <CardMedia
            component="img"
            image={src}
            alt=""
            sx={{ aspectRatio: '4 / 3', objectFit: 'cover' }}
            {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
          />
        ) : null}
        <CardContent sx={{ flex: 1, p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Typography variant="subtitle2" component="span">
              {name}
            </Typography>
            {badge}
          </Stack>
          <Typography variant="body2" color={selected ? 'primary' : 'text.primary'} sx={{ fontWeight: 600 }}>
            {price}
          </Typography>
          {note ? (
            <Typography variant="caption" color="text.secondary" component="p">
              {note}
            </Typography>
          ) : null}
        </CardContent>
      </CardActionArea>
      {includes?.length ? (
        <Box sx={{ px: 1, pb: 1 }}>
          <Button
            size="small"
            aria-expanded={open}
            aria-controls={contentsId}
            onClick={() => setOpen((was) => !was)}
          >
            {open ? 'Hide what’s included' : 'What’s included'}
          </Button>
          <Collapse in={open} id={contentsId}>
            <List dense disablePadding aria-label={`${name} includes`}>
              {includes.map((item) => (
                <ListItem key={item} disableGutters sx={{ py: 0 }}>
                  <ListItemText primary={item} slotProps={{ primary: { variant: 'body2' } }} />
                </ListItem>
              ))}
            </List>
          </Collapse>
        </Box>
      ) : null}
    </Card>
  )
}

/** A heading, its hint, and the grid of cards under it. */
function CardGroup(props: {
  label: string
  hint: string
  required: boolean
  role: 'radiogroup' | 'group'
  children: ReactNode
}) {
  const { label, hint, required, role, children } = props
  const labelId = useId()
  return (
    <Box component="section" aria-labelledby={labelId}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography id={labelId} variant="subtitle1" component="h2">
          {label}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          color={required ? 'primary' : 'default'}
          label={hint}
        />
      </Stack>
      <Box
        role={role}
        aria-labelledby={labelId}
        aria-required={required || undefined}
        sx={{
          display: 'grid',
          gridTemplateColumns: (theme) => `repeat(auto-fill, minmax(${theme.spacing(19)}, 1fr))`,
          gap: 1.5,
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

export interface ProductChoiceCardsProps {
  /** The options the shopper chooses among (size, style), with their values. */
  options: ReadonlyArray<{ name: string; values: readonly string[] }>
  variants: readonly CardVariant[]
  selections: Readonly<Record<string, string>>
  onSelect: (optionName: string, value: string) => void
  /** The add-on groups the website offers; empty draws none. */
  groups: readonly ProductModifierGroup[]
  /** The variant picked: a choice priced by variant shows its price on it. */
  variantId?: string
  value: readonly ModifierSelection[]
  onChange: (next: ModifierSelection[]) => void
  /** The store's money, e.g. `$1,250.00`. */
  formatCents: (cents: number) => string
  /** What a card says where a variant has no price yet. */
  unpricedLabel: string
  disabled?: boolean
}

/** The product's options and add-ons as picture cards (AGL-4205). */
export function ProductChoiceCards(props: ProductChoiceCardsProps) {
  const {
    options,
    variants,
    selections,
    onSelect,
    groups,
    variantId,
    value,
    onChange,
    formatCents,
    unpricedLabel,
    disabled,
  } = props
  const addOnCard = (group: ProductModifierGroup, option: ProductModifierOption, chosen: string[]) => {
    const selected = chosen.includes(option.id)
    const full = group.max > 1 && chosen.length >= group.max
    return (
      <ChoiceCard
        key={option.id}
        name={option.name}
        price={addOnPriceLabel(modifierOptionPriceCents(option, variantId), formatCents)}
        note={option.note}
        imageUrl={option.imageUrl}
        selected={selected}
        disabled={disabled || (!selected && full)}
        role={group.max === 1 ? 'radio' : 'checkbox'}
        badge={modifierOptionIsCombo(option) ? <Chip size="small" color="secondary" label="Combo" /> : null}
        includes={option.includes}
        onPress={() => onChange(withGroupAnswer(groups, value, group.id, pressChoice(group, chosen, option.id)))}
      />
    )
  }
  return (
    <Stack spacing={3} sx={{ mb: 2 }}>
      {options.map((option) => (
        <CardGroup key={option.name} label={option.name} hint="Choose one" required role="radiogroup">
          {option.values.map((choice) => {
            const variant = variantForOptionValue(variants, selections, option.name, choice)
            return (
              <ChoiceCard
                key={choice}
                name={choice}
                price={
                  typeof variant?.priceUsd === 'number'
                    ? formatCents(Math.round(variant.priceUsd * 100))
                    : unpricedLabel
                }
                note={variant?.note}
                imageUrl={variant?.imageUrl}
                selected={selections[option.name] === choice}
                role="radio"
                badge={variant?.soldOut ? <Chip size="small" variant="outlined" label="Sold out" /> : null}
                onPress={() => onSelect(option.name, choice)}
              />
            )
          })}
        </CardGroup>
      ))}
      {groups.map((group) => {
        const chosen = value.filter((pick) => pick.groupId === group.id).map((pick) => pick.optionId)
        return (
          <CardGroup
            key={group.id}
            label={group.name}
            hint={addOnGroupHint(group)}
            required={modifierGroupRequired(group)}
            role={group.max === 1 ? 'radiogroup' : 'group'}
          >
            {group.options.map((option) => addOnCard(group, option, chosen))}
          </CardGroup>
        )
      })}
    </Stack>
  )
}

ProductChoiceCards.displayName = 'ProductChoiceCards'

export default ProductChoiceCards
