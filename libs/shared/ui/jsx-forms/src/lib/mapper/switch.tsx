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
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0).
 */

import {
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
  Switch as MuiSwitch,
  type SwitchProps as MuiSwitchProps,
} from '@mui/material'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

export interface SwitchProps extends BaseFieldProps {
  onText?: string
  offText?: string
  FormFieldGridProps?: FormFieldGridProps
  FormControlProps?: FormControlProps
  FormGroupProps?: FormGroupProps
  FormControlLabelProps?: Partial<FormControlLabelProps>
  SwitchProps?: MuiSwitchProps
  FormLabelProps?: FormLabelProps
  FormHelperTextProps?: FormHelperTextProps
}

export const Switch = (props: SwitchProps) => {
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
    onText,
    offText,
    help,
    FormFieldGridProps = {},
    FormControlProps = {},
    FormGroupProps = {},
    FormControlLabelProps = {},
    SwitchProps = {},
    FormLabelProps = {},
    FormHelperTextProps = {},
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
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <FormControl
        required={isRequired}
        error={!!invalid}
        component="fieldset"
        {...FormControlProps}
      >
        <FormGroup {...FormGroupProps}>
          <FormControlLabel
            control={
              <MuiSwitch
                {...rest}
                {...input}
                disabled={isDisabled || isReadOnly}
                onChange={({ target: { checked } }) => input.onChange(checked)}
                {...SwitchProps}
              />
            }
            label={
              <FormLabel {...FormLabelProps}>
                {input.checked ? onText || label : offText || label}
              </FormLabel>
            }
            {...FormControlLabelProps}
          />
          {text && (
            <FormHelperText {...FormHelperTextProps}>{text}</FormHelperText>
          )}
        </FormGroup>
      </FormControl>
    </FormFieldGrid>
  )
}

export default Switch
