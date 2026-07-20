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

/**
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0) and
 * updated for the current MUI API (`slotProps`-shaped Autocomplete
 * `renderInput` params instead of `inputProps`).
 */

import { useMemo } from 'react'

import {
  Autocomplete,
  CircularProgress,
  TextField,
} from '@mui/material'

import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'

import DDFSelectImport from '@data-driven-forms/common/select'
import parseInternalValue from '@data-driven-forms/common/select/parse-internal-value'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps, OptionValue, SelectOption, SelectValue } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

export interface SelectProps<T = OptionValue> extends BaseFieldProps {
  options?: SelectOption<T>[]
  loadOptions?: (inputValue: string) => Promise<SelectOption<T>[]>
  isSearchable?: boolean
  isMulti?: boolean
  multiple?: boolean
  isClearable?: boolean
  disableClearable?: boolean
  hideSelectedOptions?: boolean
  closeMenuOnSelect?: boolean
  isFetching?: boolean
  noOptionsMessage?: () => string
  noOptionsText?: () => string
  loadingMessage?: string
  loadingText?: string
  placeholder?: string
  FormFieldGridProps?: FormFieldGridProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TextFieldProps?: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps?: Record<string, any>
  onInputChange?: (value: string) => void
}

/** Returns label of the selected option. */
export function getOptionLabel<T = OptionValue>(
  option: T | SelectOption<T> | undefined,
  options: SelectOption<T>[],
): string {
  if (typeof option === 'undefined') {
    return ''
  }

  if ((option as unknown) === '') {
    return ''
  }

  if (Array.isArray(option) && option.length === 0) {
    return ''
  }

  if (typeof option === 'object' && option !== null) {
    return String((option as SelectOption<T>).label)
  }

  const item = options.find(({ value }) => value === option)
  return (item && String(item.label)) || ''
}

/** Creates the DDF select value format. */
export function createValue<T = OptionValue>(
  option: T | SelectOption<T> | (T | SelectOption<T>)[] | null,
  isMulti: boolean,
): T | SelectOption<T> | (T | SelectOption<T>)[] | null | undefined {
  if (isMulti) {
    return Array.isArray(option)
      ? option.map((item) =>
          typeof item === 'object' ? item : ({ value: item } as SelectOption<T>),
        )
      : option
  }

  return option
}

interface InternalSelectProps<T = OptionValue> {
  value: SelectValue<T>
  options: SelectOption<T>[]
  label?: string
  helperText?: string
  validateOnMount?: boolean
  meta: ExtendedFieldMeta
  isSearchable?: boolean
  description?: string
  isMulti?: boolean
  placeholder?: string
  onInputChange?: (value: string) => void
  isFetching?: boolean
  noOptionsMessage?: () => string
  hideSelectedOptions?: boolean
  closeMenuOnSelect?: boolean
  required?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: any) => void
  onFocus?: () => void
  onBlur?: () => void
  FormFieldGridProps?: FormFieldGridProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TextFieldProps?: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps?: Record<string, any>
  isClearable?: boolean
  isDisabled?: boolean
  loadingText?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

function InternalSelect<T = OptionValue>({
  value,
  options,
  label,
  helperText,
  validateOnMount,
  meta,
  isSearchable,
  description,
  isMulti,
  placeholder = 'Please choose',
  onInputChange,
  isFetching,
  noOptionsMessage,
  hideSelectedOptions,
  closeMenuOnSelect: _closeMenuOnSelect,
  required,
  onChange,
  onFocus,
  onBlur,
  FormFieldGridProps = {},
  TextFieldProps: { inputProps: textFieldInputProps, ...TextFieldProps } = {},
  inputProps = {},
  isClearable,
  isDisabled,
  loadingText = 'Loading...',
  // @data-driven-forms/common always injects classNamePrefix (a
  // react-select concern) into its SelectComponent; keep it out of the
  // Autocomplete spread so it never reaches the DOM (AGL-590).
  classNamePrefix: _classNamePrefix,
  ...rest
}: InternalSelectProps<T>) {
  const invalid = validationError(meta, validateOnMount)
  // When isMulti is true, parseInternalValue always creates a new array; keep
  // the reference stable across renders.
  const internalValue = useMemo(
    () => parseInternalValue(value, isMulti),
    [value, isMulti],
  )

  return (
    <FormFieldGrid {...FormFieldGridProps}>
      <Autocomplete
        filterSelectedOptions={hideSelectedOptions}
        disabled={isDisabled}
        disableClearable={isClearable}
        popupIcon={
          isFetching ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            <ArrowDropDownIcon />
          )
        }
        fullWidth
        loadingText={loadingText}
        {...rest}
        renderInput={(params) => (
          <TextField
            onFocus={onFocus}
            onBlur={onBlur}
            {...params}
            required={required}
            error={!!invalid}
            helperText={
              invalid ||
              ((meta.touched || validateOnMount) && meta.warning) ||
              helperText ||
              description
            }
            label={label}
            margin="normal"
            {...TextFieldProps}
            slotProps={{
              ...params.slotProps,
              ...TextFieldProps.slotProps,
              htmlInput: {
                ...params.slotProps?.htmlInput,
                ...textFieldInputProps,
                ...inputProps,
                readOnly: !isSearchable,
                placeholder:
                  !internalValue ||
                  (internalValue as unknown[]).length === 0
                    ? placeholder
                    : undefined,
              },
            }}
          />
        )}
        noOptionsText={noOptionsMessage && noOptionsMessage()}
        onInputChange={(_event, value) => onInputChange?.(value)}
        options={options}
        multiple={isMulti}
        getOptionLabel={(option) =>
          getOptionLabel(option as T | SelectOption<T>, options)
        }
        value={typeof internalValue === 'undefined' ? null : internalValue}
        onChange={(_event, option) =>
          onChange(createValue(option as SelectOption<T> | null, !!isMulti))
        }
        loading={isFetching}
      />
    </FormFieldGrid>
  )
}

// The common Select's prop types are renderer-version specific; pass through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DDFSelect = DDFSelectImport as React.ComponentType<any>

export function Select<T = OptionValue>(props: SelectProps<T>) {
  const {
    input,
    isRequired,
    isDisabled,
    isReadOnly,
    disabled,
    multiple,
    isMulti,
    isClearable,
    disableClearable,
    loadingMessage,
    loadingText,
    noOptionsMessage,
    noOptionsText,
    closeMenuOnSelect,
    ...rest
  } = useFieldApi(props)

  return (
    <DDFSelect
      {...input}
      isMulti={multiple || isMulti}
      required={isRequired}
      disabled={isDisabled || isReadOnly || disabled}
      disableClearable={!isClearable || disableClearable}
      loadingText={loadingMessage || loadingText}
      noOptionsMessage={noOptionsMessage || noOptionsText}
      closeMenuOnSelect={closeMenuOnSelect}
      {...rest}
      SelectComponent={InternalSelect}
    />
  )
}

export default Select
