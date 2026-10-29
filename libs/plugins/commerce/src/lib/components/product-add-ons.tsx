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

import Checkbox from '@mui/material/Checkbox'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import FormHelperText from '@mui/material/FormHelperText'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import {
  modifierGroupRequired,
  modifierOptionPriceCents,
  type ModifierSelection,
  type ProductModifierGroup,
  type ProductModifierOption,
} from '../model/product-modifiers'

export interface ProductAddOnsProps {
  /** The groups the website shows, as the product's page received them. */
  groups: readonly ProductModifierGroup[]
  /** The variant picked: a choice priced by variant shows its price on it. */
  variantId?: string
  value: readonly ModifierSelection[]
  onChange: (next: ModifierSelection[]) => void
  /** The store's money, e.g. `$1,250.00`. */
  formatCents: (cents: number) => string
  disabled?: boolean
}

/** The picks with one group's answer replaced, in the groups' own order. */
export function withGroupAnswer(
  groups: readonly ProductModifierGroup[],
  value: readonly ModifierSelection[],
  groupId: string,
  optionIds: readonly string[],
): ModifierSelection[] {
  const others = value.filter((pick) => pick.groupId !== groupId)
  const answer = optionIds.map((optionId) => ({ groupId, optionId }))
  const order = new Map(groups.map((group, index) => [group.id, index]))
  return [...others, ...answer].sort(
    (a, b) => (order.get(a.groupId) ?? 0) - (order.get(b.groupId) ?? 0),
  )
}

/** What a group asks for, said under it. */
export function addOnGroupHint(group: Pick<ProductModifierGroup, 'min' | 'max'>): string {
  if (group.max === 1) return group.min > 0 ? 'Choose one' : 'Optional'
  if (group.min > 0 && group.min === group.max) return `Choose ${group.min}`
  if (group.min > 0) return `Choose ${group.min} to ${group.max}`
  return `Choose up to ${group.max}`
}

/**
 * The add-ons a product's page offers (AGL-4100): a group that takes one
 * choice is a select, one that takes several is a set of checkboxes, each
 * choice with what it adds on the picked variant. A required group is marked
 * as the form builder marks a required field. Its own chunk, loaded only by a
 * product that has add-ons on the website.
 */
export function ProductAddOns(props: ProductAddOnsProps) {
  const { groups, variantId, value, onChange, formatCents, disabled } = props
  const priceLabel = (option: ProductModifierOption) => {
    const cents = modifierOptionPriceCents(option, variantId)
    return cents > 0 ? `${option.name} (+${formatCents(cents)})` : option.name
  }
  return (
    <Stack spacing={1.5} sx={{ mb: 1.5 }}>
      {groups.map((group) => {
        const chosen = value
          .filter((pick) => pick.groupId === group.id)
          .map((pick) => pick.optionId)
        const required = modifierGroupRequired(group)
        if (group.max === 1) {
          return (
            <TextField
              key={group.id}
              select
              size="small"
              fullWidth
              required={required}
              disabled={disabled}
              label={group.name}
              value={chosen[0] ?? ''}
              onChange={(event) =>
                onChange(
                  withGroupAnswer(
                    groups,
                    value,
                    group.id,
                    event.target.value ? [String(event.target.value)] : [],
                  ),
                )
              }
              helperText={addOnGroupHint(group)}
            >
              {required ? null : (
                <MenuItem value="">
                  <em>{'None'}</em>
                </MenuItem>
              )}
              {group.options.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {priceLabel(option)}
                </MenuItem>
              ))}
            </TextField>
          )
        }
        const full = chosen.length >= group.max
        return (
          <FormControl
            key={group.id}
            component="fieldset"
            required={required}
            disabled={disabled}
            variant="standard"
          >
            <FormLabel component="legend">{group.name}</FormLabel>
            <FormGroup>
              {group.options.map((option) => {
                const checked = chosen.includes(option.id)
                return (
                  <FormControlLabel
                    key={option.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={checked}
                        disabled={disabled || (!checked && full)}
                        onChange={(event) =>
                          onChange(
                            withGroupAnswer(
                              groups,
                              value,
                              group.id,
                              event.target.checked
                                ? group.options
                                    .map((entry) => entry.id)
                                    .filter((id) => id === option.id || chosen.includes(id))
                                : chosen.filter((id) => id !== option.id),
                            ),
                          )
                        }
                      />
                    }
                    label={priceLabel(option)}
                  />
                )
              })}
            </FormGroup>
            <FormHelperText>{addOnGroupHint(group)}</FormHelperText>
          </FormControl>
        )
      })}
    </Stack>
  )
}

ProductAddOns.displayName = 'ProductAddOns'

export default ProductAddOns
