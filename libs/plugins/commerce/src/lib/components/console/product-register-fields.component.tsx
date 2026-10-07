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
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { memo, useCallback } from 'react'
import * as CommerceModel from '../../model'

type Patch = Partial<CommerceModel.HostProduct>

export interface ProductRegisterFieldsProps {
  posQuickKey: boolean
  modifierGroups: readonly CommerceModel.ProductModifierGroup[]
  update: (patch: Patch) => void
}

function newId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`
}

/** Dollars as typed, to whole cents; blank is free. */
function centsFromDollars(value: string): number {
  const number = Math.round(Number(String(value).replace(/[^0-9.]/g, '')) * 100)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * The product's register settings (AGL-3607): whether it is a quick key on
 * the register's first screen, and its modifier groups — choices such as
 * "Milk" or "Add-ons" the cashier picks as the item is rung up, each choice
 * free or with a price added to the item. A group with a minimum of 1 or
 * more must be answered before the item can be added.
 *
 * Memoized on its own props like every section of this editor (AGL-3423):
 * a keystroke elsewhere in the dialog does not redraw it.
 */
export const ProductRegisterFields = memo(function ProductRegisterFields(
  props: ProductRegisterFieldsProps,
) {
  const { modifierGroups, update } = props
  const setGroups = useCallback(
    (groups: CommerceModel.ProductModifierGroup[]) => update({ modifierGroups: groups }),
    [update],
  )
  const editGroup = (index: number, patch: Partial<CommerceModel.ProductModifierGroup>) =>
    setGroups(modifierGroups.map((group, at) => (at === index ? { ...group, ...patch } : group)))
  const editOption = (
    groupIndex: number,
    optionIndex: number,
    patch: Partial<CommerceModel.ProductModifierOption>,
  ) => {
    const group = modifierGroups[groupIndex]
    editGroup(groupIndex, {
      options: group.options.map((option, at) => (at === optionIndex ? { ...option, ...patch } : option)),
    })
  }
  const problem = CommerceModel.modifierGroupsProblem(modifierGroups)

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
      <Typography variant="body2" color="text.secondary">
        {'Modifiers are choices added as the item is rung up, such as a milk or an extra shot. ' +
          'Each can be free or add to the price.'}
      </Typography>
      {modifierGroups.map((group, groupIndex) => (
        <Box
          key={group.id}
          role="group"
          aria-label={group.name || 'Modifier group'}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label="Group name"
                size="small"
                value={group.name}
                onChange={(event) => editGroup(groupIndex, { name: event.target.value })}
                sx={{ flex: 1 }}
              />
              <TextField
                label="At least"
                size="small"
                value={group.min}
                onChange={(event) =>
                  editGroup(groupIndex, { min: Math.max(0, Math.round(Number(event.target.value) || 0)) })
                }
                helperText={group.min > 0 ? 'Required' : 'Optional'}
                sx={{ width: 96 }}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
              <TextField
                label="At most"
                size="small"
                value={group.max}
                onChange={(event) =>
                  editGroup(groupIndex, { max: Math.max(1, Math.round(Number(event.target.value) || 1)) })
                }
                sx={{ width: 96 }}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
              <Button
                color="error"
                onClick={() => setGroups(modifierGroups.filter((_group, at) => at !== groupIndex))}
              >
                {'Remove group'}
              </Button>
            </Stack>
            {group.options.map((option, optionIndex) => (
              <Stack key={option.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  label="Choice"
                  size="small"
                  value={option.name}
                  onChange={(event) => editOption(groupIndex, optionIndex, { name: event.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Adds ($)"
                  size="small"
                  defaultValue={option.priceCents ? (option.priceCents / 100).toFixed(2) : ''}
                  placeholder="0.00"
                  onBlur={(event) =>
                    editOption(groupIndex, optionIndex, { priceCents: centsFromDollars(event.target.value) })
                  }
                  sx={{ width: 120 }}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
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
            ))}
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
          onClick={() =>
            setGroups([
              ...modifierGroups,
              {
                id: newId('g'),
                name: '',
                min: 0,
                max: 1,
                options: [{ id: newId('o'), name: '', priceCents: 0 }],
              },
            ])
          }
          disabled={modifierGroups.length >= CommerceModel.POS_MAX_MODIFIER_GROUPS}
        >
          {'Add modifier group'}
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
