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
  Autocomplete,
  Box,
  TextField as MuiTextField,
  Typography,
} from '@mui/material'
import { useCallback, useMemo } from 'react'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, {
  buildFieldClear,
  type FormFieldGridProps,
} from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

/**
 * ThemeScale (AGL-2486): a field that offers the THEME's own scale for a
 * property while still accepting any raw CSS value.
 *
 * Font Size, Font Weight and Z-Index shipped as free text and a bare select
 * of magic numbers, with no connection to the theme at all — so a heading
 * styled here was pinned to `32px` while every heading the theme renders
 * moved with `typography.h4`, and a sticky bar was given `1300` next to a
 * modal the theme puts at exactly 1300. Colour has had theme references
 * since AGL-588; these three had none.
 *
 * **The stored value is a theme token PATH, not a resolved number.** MUI's
 * sx system declares `fontSize` and `fontWeight` with `themeKey:
 * 'typography'` and `zIndex` with `themeKey: 'zIndex'`, so `h4.fontSize`,
 * `fontWeightBold` and `appBar` are resolved against the ACTIVE theme at
 * render — exactly the way `color: 'primary.main'` already is. Storing the
 * resolved `2.125rem` instead would have been simpler and wrong for the same
 * reason a flattened colour is wrong: it stops following the theme, so a
 * type-scale change silently leaves this element behind.
 *
 * Free text is a first-class answer, not a fallback: `18px`, `1.25rem`,
 * `700` and `1400` are all legitimate, and an author who wants an exact
 * value must not have to fight a select to get one. Hence a `freeSolo`
 * combo box rather than two controls — one box that suggests the scale and
 * accepts anything.
 */

/** One entry of a theme scale the field offers. */
export interface ThemeScaleOption {
  /** The value STORED — a theme token path (`h4.fontSize`, `appBar`). */
  value: string
  /** The author's name for it (`Heading 4`, `App bar`). */
  label: string
  /** What it resolves to in this theme today (`2.125rem`, `1100`). */
  hint?: string
}

export interface ThemeScaleProps extends BaseFieldProps {
  /** The theme scale offered; an empty list leaves a plain text box. */
  scaleOptions?: ThemeScaleOption[]
  placeholder?: string
  /** Offer the reset-to-unset affordance (AGL-2486). */
  clearable?: boolean
  FormFieldGridProps?: FormFieldGridProps
}

/** The text a stored value shows. Numbers are values too (`zIndex: 1400`). */
export const themeScaleValueToText = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}` : ''
  return `${value}`
}

/**
 * Whether an option should be offered for what the author has typed.
 *
 * Matches the token path, the friendly label AND the resolved hint, so
 * `bold` finds `fontWeightBold`, `700` finds it too (that is what it
 * resolves to), and `modal` finds the z-index layer. A text that already IS
 * an option's value shows the WHOLE scale rather than the one entry it
 * matches — otherwise picking a token would leave the author unable to see
 * the neighbours to switch to.
 */
export const filterThemeScaleOptions = (
  options: ThemeScaleOption[],
  text: string,
): ThemeScaleOption[] => {
  const query = `${text ?? ''}`.trim().toLowerCase()
  if (!query) return options
  if (options.some((option) => option.value.toLowerCase() === query)) {
    return options
  }
  return options.filter((option) =>
    [option.value, option.label, option.hint]
      .filter((part) => typeof part === 'string' && part !== '')
      .some((part) => `${part}`.toLowerCase().includes(query)),
  )
}

export const ThemeScaleField = (props: ThemeScaleProps) => {
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
    scaleOptions = [],
    clearable,
    FormFieldGridProps = {},
    // Leftovers from a schema that used to declare these as TEXT_FIELDs;
    // they must never reach the DOM.
    inputProps: _inputProps,
    InputProps: _InputProps,
    multiline: _multiline,
    type: _type,
    options: _options,
    ...rest
  } = useFieldApi(props)

  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const text = themeScaleValueToText(input.value)

  const commit = useCallback(
    (next: string) => {
      input.onChange(next)
    },
    [input],
  )

  const clear = buildFieldClear({
    clearable,
    label,
    hasValue: text !== '',
    locked: Boolean(isDisabled || isReadOnly),
    onClear: () => commit(''),
  })

  const filterOptions = useCallback(
    (options: ThemeScaleOption[], state: { inputValue: string }) =>
      filterThemeScaleOptions(options, state.inputValue),
    [],
  )

  // The token the current value names, so the helper text can say what it
  // resolves to — the one thing a token path cannot say for itself.
  const activeOption = useMemo(
    () => scaleOptions.find((option) => option.value === text),
    [scaleOptions, text],
  )

  return (
    <FormFieldGrid help={help} clear={clear} {...FormFieldGridProps}>
      <Autocomplete<ThemeScaleOption, false, true, true>
        freeSolo
        disableClearable
        fullWidth
        size="small"
        disabled={Boolean(isDisabled)}
        readOnly={Boolean(isReadOnly)}
        options={scaleOptions}
        filterOptions={filterOptions}
        inputValue={text}
        // `onInputChange` rather than `onChange`: it fires for BOTH a typed
        // value and a picked option, so a raw `18px` and a `h4.fontSize`
        // travel the same path and cannot commit differently.
        onInputChange={(_event, next) => commit(next ?? '')}
        getOptionLabel={(option) =>
          typeof option === 'string' ? option : option.value
        }
        renderOption={(optionProps, option) => {
          const { key, ...liProps } = optionProps as typeof optionProps & {
            key?: string
          }
          return (
            <Box component="li" key={option.value} {...liProps}>
              <Box sx={{ display: 'flex', width: '100%', gap: 1 }}>
                <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
                  {option.label}
                </Typography>
                {option.hint ? (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {option.hint}
                  </Typography>
                ) : null}
              </Box>
            </Box>
          )
        }}
        renderInput={(params) => (
          <MuiTextField
            {...params}
            label={label}
            margin="dense"
            required={Boolean(isRequired)}
            error={Boolean(invalid)}
            placeholder={placeholder}
            helperText={
              invalid ||
              ((meta.touched || validateOnMount) && meta.warning) ||
              // Naming the resolved value is what makes the token readable:
              // `h4.fontSize` means nothing until it says `2.125rem`.
              (activeOption?.hint
                ? `${activeOption.label} — ${activeOption.hint}`
                : undefined) ||
              helperText ||
              description
            }
          />
        )}
        {...rest}
      />
    </FormFieldGrid>
  )
}
ThemeScaleField.displayName = 'AglynThemeScaleField'

export default ThemeScaleField
