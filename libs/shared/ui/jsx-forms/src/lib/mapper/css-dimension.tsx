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

import {
  buildCssDimension,
  CSS_UNITS,
  CssUnit,
  isGlobalUnit,
  parseCssDimension,
} from '@aglyn/shared-data-enums'
import {
  InputAdornment,
  MenuItem,
  Select,
  TextField as MuiTextField,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

/**
 * CssDimension (AGL-1219): a number box plus a unit picker for anything
 * holding a CSS length — an image's Width, a drawer's Width, a video
 * block's Height, and every length in the styles panel's field groups.
 * Authors used to type the whole string (`920px`) into a free-text field
 * and were expected to remember the unit, while the box stylers right
 * above them had a number+unit pair all along.
 *
 * The PERSISTED value is unchanged: still one CSS string (`"920px"`,
 * `"100%"`, `"auto"`, `""`). This is purely an input affordance, so nothing
 * downstream — renderers, published documents, existing nodes — has to know
 * about it. The unit list is {@link CSS_UNITS} (the box styler's list), and
 * parse/serialize is the shared pair in `@aglyn/shared-data-enums` so the
 * two surfaces cannot drift.
 *
 * Values that are not `<number><unit>` — `calc(100% - 2rem)`, `min-content`,
 * a `{{token}}` binding — must NOT be clobbered by an editor that cannot
 * model them, so the field falls back to a plain text box holding the raw
 * string. It flips back to number+unit the moment the text becomes a plain
 * dimension again, which keeps the mode derived from the value rather than
 * remembered in a flag that can go stale.
 */

/** Draft state: what the two controls show, before serialization. */
interface DimensionDraft {
  /** Numeric text (or the whole raw string in custom mode). */
  text: string
  /** Selected unit, `''` when none is chosen. */
  unit: CssUnit | ''
  /** The value is not `<number><unit>` — the text box holds it verbatim. */
  custom: boolean
}

/**
 * How a value stored as a bare NUMBER is to be read (AGL-1219). A node prop
 * is plain CSS, so a number is pixels — the default.
 *
 * `'mui-sizing'` is for the styles panel's `sx` sizing keys, where a number
 * is NOT pixels: MUI's `sizingTransform` renders any number in (0, 1] as a
 * fraction of the parent, so `width: 0.5` is 50%. Read as pixels it would
 * show "0.5" with no unit and the first nudge would turn a half-width
 * element into a 0.6px one.
 */
export type DimensionNumberAs = 'px' | 'mui-sizing'

/**
 * The CSS string a stored value stands for — the only place a bare number
 * is given its meaning. Mirrors MUI's `sizingTransform` for `'mui-sizing'`.
 */
export const dimensionValueToCss = (
  value: unknown,
  numberAs: DimensionNumberAs = 'px',
): string => {
  if (typeof value === 'string') return value
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  if (numberAs === 'mui-sizing' && value <= 1 && value !== 0) {
    // `0.3 * 100` is 30.000000000000004 in binary floating point — MUI
    // emits that verbatim; showing it in a number box would be absurd.
    return `${Number((value * 100).toFixed(4))}%`
  }
  return `${value}px`
}

export const seedDimensionDraft = (
  value: unknown,
  numberAs: DimensionNumberAs = 'px',
): DimensionDraft => {
  const parsed = parseCssDimension(dimensionValueToCss(value, numberAs))
  if (parsed.raw !== undefined) {
    return { text: parsed.raw, unit: '', custom: true }
  }
  return {
    text: parsed.value === undefined ? '' : `${parsed.value}`,
    unit: parsed.unit ?? '',
    custom: false,
  }
}

export const serializeDimensionDraft = (draft: DimensionDraft): string => {
  if (draft.custom) return draft.text
  const trimmed = draft.text.trim()
  return buildCssDimension({
    value: trimmed === '' ? undefined : Number(trimmed),
    unit: draft.unit || undefined,
  })
}

export interface CssDimensionProps extends BaseFieldProps {
  placeholder?: string
  /** Units offered; defaults to the full shared list. */
  units?: CssUnit[]
  /** How a bare number is read. See {@link DimensionNumberAs}. */
  numberAs?: DimensionNumberAs
  FormFieldGridProps?: FormFieldGridProps
}

export const CssDimensionField = (props: CssDimensionProps) => {
  const {
    input,
    isReadOnly,
    isDisabled,
    isRequired,
    label,
    placeholder,
    helperText,
    description,
    validateOnMount,
    meta,
    help,
    units = CSS_UNITS,
    numberAs = 'px',
    FormFieldGridProps = {},
    // Free-text leftovers from the attribute schema that must never reach
    // the DOM (the attributes it was authored with as a TEXT_FIELD).
    inputProps: _inputProps,
    InputProps: _InputProps,
    multiline: _multiline,
    ...rest
  } = useFieldApi(props)
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  // A value authored as a bare number (`width: 320`, or `width: 0.5` in an
  // sx) is still a value the author has to see — reading only strings would
  // blank the field and then overwrite the number on the first edit. The
  // number is resolved to the CSS it stands for HERE, not in the form value,
  // so an untouched field still emits nothing and the stored number survives.
  const value = dimensionValueToCss(input.value, numberAs)

  const [draft, setDraft] = useState<DimensionDraft>(() =>
    seedDimensionDraft(value),
  )
  // Re-seed only when the value changed OUTSIDE this field (a different
  // node selected, an undo). Re-seeding from our own emits would round
  // half-typed decimals ("1." -> 1 -> "1") out from under the caret.
  const emittedRef = useRef(value)
  useEffect(() => {
    if (value === emittedRef.current) return
    emittedRef.current = value
    setDraft(seedDimensionDraft(value))
  }, [value])

  const commit = useCallback(
    (next: DimensionDraft) => {
      const serialized = serializeDimensionDraft(next)
      emittedRef.current = serialized
      // A custom value the author edited back into a plain dimension gets
      // the structured controls back immediately.
      const reparsed = parseCssDimension(serialized)
      setDraft(
        next.custom && serialized.trim() !== '' && reparsed.raw === undefined
          ? seedDimensionDraft(serialized)
          : next,
      )
      input.onChange(serialized)
    },
    [input],
  )

  const keywordUnit = !draft.custom && !!draft.unit && isGlobalUnit(draft.unit)

  const handleTextChange = useCallback(
    (event: { target: { value: string } }) => {
      const text = event.target.value
      // Typing a number into a field with no unit yet means pixels — a
      // bare `320` is not a valid CSS length and silently did nothing
      // when these were free-text fields.
      const unit =
        !draft.custom && !draft.unit && text.trim() !== ''
          ? CssUnit.PIXELS
          : draft.unit
      commit({ ...draft, text, unit })
    },
    [commit, draft],
  )

  const handleUnitChange = useCallback(
    (event: { target: { value: unknown } }) => {
      const unit = (event.target.value || '') as CssUnit | ''
      // Keyword units (`auto`) ARE the whole value, so the quantity goes
      // away with them; it comes back when a real unit is picked again.
      commit({ ...draft, unit, text: unit && isGlobalUnit(unit) ? '' : draft.text })
    },
    [commit, draft],
  )

  const unitSelect = (
    <InputAdornment position="end" sx={{ ml: 0 }}>
      <Select
        value={draft.custom ? '' : draft.unit}
        onChange={handleUnitChange}
        disabled={isDisabled || isReadOnly || draft.custom}
        variant="standard"
        disableUnderline
        // Without displayEmpty an unset unit renders nothing at all, which
        // reads as a broken control rather than "no unit yet".
        displayEmpty
        renderValue={(selected) =>
          draft.custom ? 'custom' : (selected as string) || '—'
        }
        inputProps={{ 'aria-label': 'Unit' }}
        sx={{
          '& .MuiSelect-select': { pr: '20px !important', py: 0 },
          fontSize: '0.8125rem',
          color: 'text.secondary',
          minWidth: 44,
        }}
      >
        <MenuItem value="">
          <em>{'—'}</em>
        </MenuItem>
        {units.map((unit) => (
          <MenuItem key={unit} value={unit}>
            {unit}
          </MenuItem>
        ))}
      </Select>
    </InputAdornment>
  )

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <MuiTextField
        // Schema leftovers first: the controlled value/handlers below must
        // win over anything the attribute was authored with.
        {...rest}
        name={input.name}
        value={keywordUnit ? '' : draft.text}
        onChange={handleTextChange}
        onBlur={input.onBlur}
        onFocus={input.onFocus}
        fullWidth
        error={!!invalid}
        helperText={
          invalid ||
          ((meta.touched || validateOnMount) && meta.warning) ||
          helperText ||
          description
        }
        disabled={isDisabled}
        label={label}
        placeholder={keywordUnit ? `${draft.unit}` : placeholder}
        required={isRequired}
        // A keyword unit has no quantity to type, and a custom expression
        // is free text — only the plain number+unit case is numeric.
        type={draft.custom || keywordUnit ? 'text' : 'number'}
        slotProps={{
          input: {
            readOnly: isReadOnly || keywordUnit,
            endAdornment: unitSelect,
          },
          htmlInput: { inputMode: 'decimal' },
        }}
      />
    </FormFieldGrid>
  )
}

export default CssDimensionField
