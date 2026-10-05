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

/**
 * One labelled choice among a few, each with a sentence saying what it does
 * and, when it cannot be picked, why. Every "how should this be handled"
 * control in the kit is one of these, so a policy, a picklist value and a
 * package item's collision read the same way.
 */

import { ListItemText, MenuItem, TextField } from '@mui/material'
import type { ReactNode } from 'react'

export interface TransferChoiceOption<T extends string> {
  value: T
  label: string
  description?: string
  disabled?: boolean
}

export interface TransferChoiceSelectProps<T extends string> {
  label: string
  value: T | ''
  options: readonly TransferChoiceOption<T>[]
  onChange(value: T): void
  disabled?: boolean
  /** Shown under the control; a locked rule's reason goes here. */
  helperText?: ReactNode
  /** Shown when nothing is chosen yet. */
  placeholder?: string
  fullWidth?: boolean
  size?: 'small' | 'medium'
  /** Hides the label visually where a table header already names the column. */
  hideLabel?: boolean
}

export function TransferChoiceSelect<T extends string>(
  props: TransferChoiceSelectProps<T>,
) {
  const {
    label,
    value,
    options,
    onChange,
    disabled,
    helperText,
    placeholder,
    fullWidth,
    size = 'small',
    hideLabel,
  } = props
  const chosen = options.find((option) => option.value === value)
  return (
    <TextField
      select
      size={size}
      fullWidth={fullWidth}
      label={hideLabel ? undefined : label}
      value={value}
      disabled={disabled}
      helperText={helperText}
      onChange={(event) => onChange(event.target.value as T)}
      slotProps={{
        select: {
          displayEmpty: Boolean(placeholder),
          renderValue: () => chosen?.label ?? placeholder ?? '',
          ...(hideLabel ? { 'aria-label': label } : {}),
        },
        ...(placeholder ? { inputLabel: { shrink: true } } : {}),
      }}
    >
      {options.map((option) => (
        <MenuItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          <ListItemText primary={option.label} secondary={option.description} />
        </MenuItem>
      ))}
    </TextField>
  )
}

export default TransferChoiceSelect
