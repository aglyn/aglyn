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
  type ContactFieldDefinition,
  type CrmCustomValue,
  contactFieldCurrency,
  currencyFractionDigits,
  currencyMinorToMajor,
  parseCurrencyInput,
} from '@aglyn/aglyn'
import { Checkbox, FormControlLabel, InputAdornment, MenuItem, TextField } from '@mui/material'
import { useEffect, useState } from 'react'

/** An ISO stamp as the `<input type="date">` value it corresponds to. */
export const isoToDateInput = (value: CrmCustomValue | undefined): string => {
  if (typeof value !== 'string' || !value) return ''
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''
}

/** The longest text a text or link control accepts — the model's own cap. */
const TEXT_MAX = 2000

export interface CrmCustomFieldControlProps {
  definition: Pick<ContactFieldDefinition, 'key' | 'label' | 'type' | 'options' | 'required' | 'currency'>
  /** The value as shown — the draft's where touched, else the stored one. */
  value: CrmCustomValue | undefined
  /** `null` is the explicit "cleared" every surface writes for an emptied control. */
  onChange: (value: CrmCustomValue) => void
  disabled?: boolean
}

/**
 * ONE control per custom-field type (AGL-2601, shared since AGL-2661), the
 * same on a contact's card, a company's drawer and a deal's.
 *
 * A checkbox, a choice list, a number box, a date picker, or a text or
 * link box — chosen by the definition's type, which is also what every
 * reader coerces the value by. Clearing any of them hands back `null`
 * rather than deleting the key: a `where` on the key can still find the
 * record, and an export still shows the column.
 */
export function CrmCustomFieldControl(props: CrmCustomFieldControlProps) {
  const { definition, value, onChange, disabled } = props
  const label = definition.label || definition.key
  switch (definition.type) {
    case 'checkbox':
      return (
        <FormControlLabel
          control={
            <Checkbox
              checked={value === true}
              disabled={disabled}
              onChange={(event) => onChange(event.target.checked)}
              slotProps={{ input: { 'aria-label': label } }}
            />
          }
          label={definition.required ? `${label} *` : label}
        />
      )
    case 'select':
      return (
        <TextField
          select
          size="small"
          label={label}
          required={definition.required === true}
          disabled={disabled}
          value={
            typeof value === 'string' && (definition.options ?? []).includes(value) ? value : ''
          }
          onChange={(event) => onChange(event.target.value || null)}
          fullWidth
        >
          <MenuItem value="">{'—'}</MenuItem>
          {(definition.options ?? []).map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      )
    case 'number':
      return (
        <TextField
          size="small"
          type="number"
          label={label}
          required={definition.required === true}
          disabled={disabled}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => {
            const text = event.target.value
            if (text === '') return onChange(null)
            const parsed = Number(text)
            if (Number.isFinite(parsed)) onChange(parsed)
          }}
          fullWidth
        />
      )
    case 'currency':
      return <CurrencyFieldControl {...props} label={label} />
    case 'date':
      return (
        <TextField
          size="small"
          type="date"
          label={label}
          required={definition.required === true}
          disabled={disabled}
          value={isoToDateInput(value)}
          onChange={(event) => {
            const text = event.target.value
            const ms = text ? Date.parse(text) : Number.NaN
            onChange(Number.isFinite(ms) ? new Date(ms).toISOString() : null)
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          fullWidth
        />
      )
    default:
      return (
        <TextField
          size="small"
          type={definition.type === 'url' ? 'url' : 'text'}
          label={label}
          required={definition.required === true}
          disabled={disabled}
          value={typeof value === 'string' ? value : value == null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value || null)}
          slotProps={{ htmlInput: { maxLength: TEXT_MAX } }}
          fullWidth
        />
      )
  }
}
CrmCustomFieldControl.displayName = 'CrmCustomFieldControl'

/** A stored amount as the text its box shows: major units, the currency's decimals. */
export function currencyInputText(value: CrmCustomValue | undefined, code: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return currencyMinorToMajor(value, code).toFixed(currencyFractionDigits(code))
}

/**
 * A currency field's box (AGL-3756): typed in major units with the code
 * beside it, stored as minor units. The text is kept as typed while the box
 * is being edited, so "12." is not rewritten to "12.00" under the cursor.
 */
function CurrencyFieldControl(props: CrmCustomFieldControlProps & { label: string }) {
  const { definition, value, onChange, disabled, label } = props
  const code = contactFieldCurrency(definition)
  const [text, setText] = useState(() => currencyInputText(value, code))
  useEffect(() => {
    setText((typed) => (parseCurrencyInput(typed, code) === (typeof value === 'number' ? value : null) ? typed : currencyInputText(value, code)))
  }, [value, code])
  return (
    <TextField
      size="small"
      label={label}
      required={definition.required === true}
      disabled={disabled}
      value={text}
      onChange={(event) => {
        const typed = event.target.value
        setText(typed)
        if (!typed.trim()) return onChange(null)
        const minor = parseCurrencyInput(typed, code)
        if (minor !== null) onChange(minor)
      }}
      slotProps={{
        htmlInput: { inputMode: 'decimal' },
        input: { endAdornment: <InputAdornment position="end">{code.toUpperCase()}</InputAdornment> },
      }}
      fullWidth
    />
  )
}

export default CrmCustomFieldControl
