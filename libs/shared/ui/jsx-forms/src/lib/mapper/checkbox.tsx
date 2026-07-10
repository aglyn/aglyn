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
 * updated for the current MUI API (`slotProps` instead of `inputProps`).
 */

import {
  Checkbox as MuiCheckbox,
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
} from '@mui/material'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import MultipleChoiceList from './multiple-choice-list'
import type { BaseFieldProps, OptionValue, SelectOption } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

export interface SingleCheckboxProps extends BaseFieldProps {
  FormFieldGridProps?: FormFieldGridProps
  FormControlProps?: FormControlProps
  FormGroupProps?: FormGroupProps
  FormControlLabelProps?: Partial<FormControlLabelProps>
  CheckboxProps?: MuiCheckboxProps
  FormLabelProps?: FormLabelProps
  FormHelperTextProps?: FormHelperTextProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps?: Record<string, any>
}

export interface CheckboxProps<T = OptionValue> extends SingleCheckboxProps {
  options?: SelectOption<T>[]
}

export const SingleCheckbox = (props: SingleCheckboxProps) => {
  const {
    input,
    isReadOnly,
    isDisabled,
    isRequired,
    label,
    helperText,
    description,
    validateOnMount,
    meta,
    FormFieldGridProps = {},
    FormControlProps = {},
    FormGroupProps = {},
    FormControlLabelProps = {},
    CheckboxProps = {},
    FormLabelProps = {},
    FormHelperTextProps = {},
    inputProps,
    ...rest
  } = useFieldApi({
    ...props,
    type: 'checkbox',
  })
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const text =
    invalid ||
    ((meta.touched || validateOnMount) && meta.warning) ||
    helperText ||
    description

  return (
    <FormFieldGrid {...FormFieldGridProps}>
      <FormControl
        required={isRequired}
        error={!!invalid}
        component="fieldset"
        {...FormControlProps}
      >
        <FormGroup {...FormGroupProps}>
          <FormControlLabel
            {...FormControlLabelProps}
            control={
              <MuiCheckbox
                {...input}
                {...CheckboxProps}
                disabled={isDisabled || isReadOnly}
                value={input.name}
                slotProps={{
                  input: { readOnly: isReadOnly, ...inputProps },
                }}
                {...rest}
              />
            }
            disabled={isDisabled || isReadOnly}
            label={<FormLabel {...FormLabelProps}>{label}</FormLabel>}
          />
          {text && (
            <FormHelperText {...FormHelperTextProps}>{text}</FormHelperText>
          )}
        </FormGroup>
      </FormControl>
    </FormFieldGrid>
  )
}

export function Checkbox<T = OptionValue>({
  options,
  ...props
}: CheckboxProps<T>) {
  return options ? (
    // The list renders option values opaquely, so the wider generic is
    // safe to narrow to the common OptionValue shape.
    <MultipleChoiceList options={options as SelectOption<OptionValue>[]} {...props} />
  ) : (
    <SingleCheckbox {...props} />
  )
}

export default Checkbox
