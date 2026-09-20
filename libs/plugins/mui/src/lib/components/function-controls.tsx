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

import type * as Aglyn from '@aglyn/aglyn'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useId } from 'react'

/**
 * How one function parameter is ASKED (AGL-3202), shared by the Function
 * Widget, which asks every parameter in a row, and the Function Input
 * element, which asks one wherever the author put it.
 */

/** The control a parameter is drawn as. `auto` follows the parameter. */
export type FunctionControlKind =
  | 'auto'
  | 'number'
  | 'text'
  | 'select'
  | 'chips'
  | 'switch'

export const FUNCTION_CONTROL_KINDS: readonly FunctionControlKind[] = [
  'auto',
  'number',
  'text',
  'select',
  'chips',
  'switch',
]

/** What each input starts with: the parameter's own default, or nothing. */
export function initialFunctionArguments(
  definition: Aglyn.HostFunction | undefined,
): Record<string, string> {
  const args: Record<string, string> = {}
  for (const parameter of definition?.parameters ?? []) {
    if (parameter.defaultValue != null && parameter.defaultValue !== '') {
      args[parameter.name] = String(parameter.defaultValue)
    } else if (parameter.options?.length) {
      // A select always shows a choice, so the function has to receive the
      // one on screen — not an empty string the visitor never saw.
      args[parameter.name] = String(parameter.options[0].value)
    }
  }
  return args
}

/** A result as a visitor reads it. */
export function displayFunctionValue(
  value: number | string | boolean | undefined,
): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return value == null ? '' : String(value)
}

/**
 * Whether a result counts as "yes" for an element that shows or hides on it.
 * The strings a function is likely to have built — `'false'`, `'0'`, `'no'` —
 * read as no, because a text local is the only way a function can carry a
 * flag it computed from text.
 */
export function isFunctionValueTruthy(
  value: number | string | boolean | undefined,
): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  const text = String(value ?? '').trim().toLowerCase()
  return text !== '' && text !== 'false' && text !== '0' && text !== 'no'
}

/** `control: auto` resolved against what the parameter is. */
export function resolveFunctionControl(
  control: FunctionControlKind | undefined,
  parameter: Pick<Aglyn.HostFunctionParameter, 'type' | 'options'> | undefined,
  hasChoices: boolean,
): Exclude<FunctionControlKind, 'auto'> {
  if (control && control !== 'auto') return control
  if (hasChoices || parameter?.options?.length) return 'select'
  if (parameter?.type === 'boolean') return 'switch'
  if (parameter?.type === 'number') return 'number'
  return 'text'
}

/** Two values name the same choice: "25" and 25.0 are one quick pick. */
function sameChoice(left: string, right: string): boolean {
  if (left === right) return true
  if (left.trim() === '' || right.trim() === '') return false
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && a === b
}

export interface FunctionParameterControlProps {
  /** The parameter's identifier; the label when nothing better is given. */
  name: string
  type?: Aglyn.FunctionValueType
  required?: boolean
  control?: FunctionControlKind
  label?: string
  hideLabel?: boolean
  /** The choices offered by a select or a row of chips. */
  options?: Aglyn.HostFunctionParameterOption[]
  value: string
  onChange: (value: string) => void
  /** The besigner draws the control so it can be designed around; it is inert. */
  disabled?: boolean
  width?: number | string
}

/**
 * One parameter, drawn as what it is.
 *
 * - **select** is NATIVE. A portal-mounted menu is one more thing a
 *   transformed or clipped ancestor can misplace, and on a phone the platform
 *   picker is the better control.
 * - **chips** are quick picks: buttons that SET the value, pressed when the
 *   value matches. They are how a number box gets "10 · 25 · 50 · 100"
 *   beside it — two controls on one parameter, which is why this takes a
 *   value and an onChange and holds no state of its own.
 */
export function FunctionParameterControl(props: FunctionParameterControlProps) {
  const {
    name,
    type,
    required,
    control,
    label,
    hideLabel,
    options = [],
    value,
    onChange,
    disabled,
    width,
  } = props
  const groupLabelId = useId()
  const text = label?.trim() || name
  const kind = resolveFunctionControl(control, { type, options }, options.length > 0)
  if (kind === 'chips') {
    return (
      <Stack spacing={0.75} role="group" aria-labelledby={groupLabelId}>
        <Typography
          id={groupLabelId}
          variant="caption"
          color="text.secondary"
          sx={hideLabel ? visuallyHidden : { fontWeight: 500 }}
        >
          {text}
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
          {options.map((option) => {
            const pressed = sameChoice(value, option.value)
            return (
              <Chip
                key={option.value}
                label={option.label?.trim() || option.value}
                size="small"
                clickable={!disabled}
                disabled={disabled}
                color={pressed ? 'primary' : 'default'}
                variant={pressed ? 'filled' : 'outlined'}
                aria-pressed={pressed}
                onClick={() => onChange(option.value)}
              />
            )
          })}
        </Stack>
      </Stack>
    )
  }
  if (kind === 'switch') {
    return (
      <FormControlLabel
        label={text}
        disabled={disabled}
        control={
          <Switch
            checked={value === 'true'}
            onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
          />
        }
      />
    )
  }
  if (kind === 'select') {
    return (
      <TextField
        select
        label={hideLabel ? undefined : text}
        required={Boolean(required)}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        size="small"
        slotProps={{
          select: { native: true },
          htmlInput: hideLabel ? { 'aria-label': text } : undefined,
        }}
        sx={{ minWidth: width ?? 200 }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label?.trim() || option.value}
          </option>
        ))}
      </TextField>
    )
  }
  return (
    <TextField
      label={hideLabel ? undefined : text}
      required={Boolean(required)}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      type={kind === 'number' ? 'number' : undefined}
      slotProps={{
        htmlInput: {
          ...(kind === 'number' ? { inputMode: 'decimal' } : {}),
          ...(hideLabel ? { 'aria-label': text } : {}),
        },
      }}
      sx={{ width: width ?? (label ? 200 : 140) }}
    />
  )
}

const visuallyHidden = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
} as const
