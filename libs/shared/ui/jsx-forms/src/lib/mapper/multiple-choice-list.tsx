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
 * updated for the current MUI Grid API.
 */

import { type ReactNode, createContext, useContext } from 'react'

import {
  Checkbox,
  type CheckboxProps as MuiCheckboxProps,
  FormControl,
  type FormControlLabelProps,
  FormControlLabel,
  type FormControlProps,
  FormGroup,
  type FormGroupProps,
  FormHelperText,
  type FormHelperTextProps,
  FormLabel,
  type FormLabelProps,
  Grid,
  type GridProps,
} from '@mui/material'

import MultipleChoiceListCommon from '@data-driven-forms/common/multiple-choice-list'

import type { OptionValue, SelectOption } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

interface CheckboxContextValue {
  FormControlLabelProps?: Omit<FormControlLabelProps, 'control' | 'label'>
  CheckboxProps?: MuiCheckboxProps
  FormFieldGridProps?: GridProps
  FormControlProps?: FormControlProps
  FormLabelProps?: FormLabelProps
  FormGroupProps?: FormGroupProps
  FormHelperTextProps?: FormHelperTextProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: Record<string, any>
}

const CheckboxContext = createContext<CheckboxContextValue>({
  props: {},
})

interface FinalCheckboxProps<T extends OptionValue = OptionValue> {
  label?: ReactNode
  isDisabled?: boolean
  checked?: boolean
  onChange?: (value: T) => void
  value?: T
}

const FinalCheckbox = <T extends OptionValue = OptionValue>({
  label,
  checked,
  onChange,
  value,
}: FinalCheckboxProps<T>) => {
  const {
    FormControlLabelProps,
    CheckboxProps,
    props: { isDisabled },
  } = useContext(CheckboxContext)

  return (
    <FormControlLabel
      {...FormControlLabelProps}
      control={
        <Checkbox
          checked={checked}
          onChange={() => onChange && onChange(value as T)}
          disabled={isDisabled}
          {...CheckboxProps}
        />
      }
      label={label}
    />
  )
}

interface WrapperProps {
  label?: ReactNode
  isRequired?: boolean
  children?: ReactNode
  meta: ExtendedFieldMeta
  validateOnMount?: boolean
  helperText?: ReactNode
  description?: ReactNode
}

const Wrapper = ({
  label,
  isRequired,
  children,
  meta,
  validateOnMount,
  helperText,
  description,
}: WrapperProps) => {
  const invalid = validationError(meta, validateOnMount)
  const {
    FormFieldGridProps,
    FormControlProps,
    FormLabelProps,
    FormGroupProps,
    FormHelperTextProps,
  } = useContext(CheckboxContext)

  return (
    <Grid container size={{ xs: 12 }} {...FormFieldGridProps}>
      <FormControl
        required={isRequired}
        error={!!invalid}
        component="fieldset"
        {...FormControlProps}
      >
        <FormLabel {...FormLabelProps}>{label}</FormLabel>
        <FormGroup {...FormGroupProps}>{children}</FormGroup>
        {(invalid || helperText || description) && (
          <FormHelperText {...FormHelperTextProps}>
            {invalid || helperText || description}
          </FormHelperText>
        )}
      </FormControl>
    </Grid>
  )
}

export interface MultipleChoiceListProps<T extends OptionValue = OptionValue> {
  name: string
  options?: SelectOption<T>[]
  FormControlProps?: FormControlProps
  FormLabelProps?: FormLabelProps
  FormGroupProps?: FormGroupProps
  FormHelperTextProps?: FormHelperTextProps
  FormFieldGridProps?: GridProps
  FormControlLabelProps?: Omit<FormControlLabelProps, 'control' | 'label'>
  CheckboxProps?: MuiCheckboxProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export const MultipleChoiceList = <T extends OptionValue = OptionValue>({
  FormControlProps = {},
  FormLabelProps = {},
  FormGroupProps = {},
  FormHelperTextProps = {},
  FormFieldGridProps = {},
  FormControlLabelProps = {},
  CheckboxProps = {},
  name,
  options,
  ...props
}: MultipleChoiceListProps<T>) => (
  <CheckboxContext.Provider
    value={{
      FormControlProps,
      FormLabelProps,
      FormGroupProps,
      FormHelperTextProps,
      FormFieldGridProps,
      FormControlLabelProps,
      CheckboxProps,
      props,
    }}
  >
    <MultipleChoiceListCommon
      name={name}
      // The common list only maps over options; ReactNode labels render
      // fine even though its prop type says string.
      options={options as never}
      {...props}
      Wrapper={Wrapper}
      Checkbox={FinalCheckbox}
    />
  </CheckboxContext.Provider>
)

export default MultipleChoiceList
