/**
 * @license
 * Copyright 2022 Aglyn LLC
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
  FormControl as MuiFormControl,
  FormControlLabel as MuiFormControlLabel,
  type FormControlLabelProps as MuiFormControlLabelProps,
  type FormControlProps as MuiFormControlProps,
  FormGroup as MuiFormGroup,
  type FormGroupProps as MuiFormGroupProps,
  FormHelperText as MuiFormHelperText,
  type FormHelperTextProps as MuiFormHelperTextProps,
  FormLabel as MuiFormLabel,
  type FormLabelProps as MuiFormLabelProps,
  Switch as MuiSwitch,
  type SwitchProps as MuiSwitchProps,
} from '@mui/material'
import {forwardRef, type ReactNode} from 'react'
import {validationMessage} from '../utils/validation-message'
import {useFieldApi, type UseFieldApiConfig} from '../vendor/data-driven-forms'


export type SwitchBaseProps = MuiSwitchProps & UseFieldApiConfig

export interface SwitchProps extends SwitchBaseProps {
  isReadOnly?: boolean
  isDisabled?: boolean
  isRequired?: boolean
  label?: ReactNode
  helperText?: ReactNode
  description?: ReactNode
  validateOnMount?: boolean
  onText?: ReactNode
  offText?: ReactNode
  FormControlProps?: MuiFormControlProps
  FormGroupProps?: MuiFormGroupProps
  FormControlLabelProps?: MuiFormControlLabelProps
  SwitchProps?: MuiSwitchProps
  FormLabelProps?: MuiFormLabelProps
  FormHelperTextProps?: MuiFormHelperTextProps
}

const SwitchComponent = forwardRef<any, SwitchProps>(
  function RefRenderFn(props, ref) {
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
      FormControlProps,
      FormGroupProps,
      FormControlLabelProps,
      SwitchProps,
      FormLabelProps,
      FormHelperTextProps,
      ...rest
    } = useFieldApi({
      ...props,
      type: 'checkbox',
    })
    const invalid = validationMessage(meta, validateOnMount)
    const helpText = invalid || ((meta.touched || validateOnMount) && meta.warning) || helperText || description

    return (
      <MuiFormControl
        ref={ref}
        required={isRequired}
        error={!!invalid}
        component="fieldset" {...FormControlProps}>
        <MuiFormGroup {...FormGroupProps}>
          <MuiFormControlLabel
            control={
              <MuiSwitch
                {...SwitchProps}
                {...rest}
                {...input}
                readOnly={isReadOnly}
                disabled={isDisabled || isReadOnly}
                onChange={({target: {checked}}) => input.onChange(checked)}
              />
            }
            label={
              <MuiFormLabel {...FormLabelProps}>
                {input.checked ? onText || label : offText || label}
              </MuiFormLabel>
            }
            {...FormControlLabelProps}
          />
          {helpText && (
            <MuiFormHelperText {...FormHelperTextProps}>
              {helpText}
            </MuiFormHelperText>
          )}
        </MuiFormGroup>
      </MuiFormControl>
    )
  },
)

SwitchComponent.displayName = 'SwitchComponent'
SwitchComponent.aglyn = true

export default SwitchComponent
