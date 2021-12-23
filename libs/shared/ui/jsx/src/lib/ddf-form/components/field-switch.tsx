/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import MuiFormControl, {FormControlProps as MuiFormControlProps} from '@mui/material/FormControl'
import MuiFormControlLabel, {
  FormControlLabelProps as MuiFormControlLabelProps,
} from '@mui/material/FormControlLabel'
import MuiFormGroup, {FormGroupProps as MuiFormGroupProps} from '@mui/material/FormGroup'
import MuiFormHelperText, {
  FormHelperTextProps as MuiFormHelperTextProps,
} from '@mui/material/FormHelperText'
import MuiFormLabel, {FormLabelProps as MuiFormLabelProps} from '@mui/material/FormLabel'
import MuiSwitch, {SwitchProps as MuiSwitchProps} from '@mui/material/Switch'
import {forwardRef, ReactNode} from 'react'
import {useFieldApi, UseFieldApiConfig} from '../ddf-reexports'

import {withGridItem} from '../field-hocs'
import {validationMessage} from '../utils'


export type FieldSwitchProps = MuiSwitchProps & UseFieldApiConfig & {
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

const FieldSwitch = forwardRef<any, FieldSwitchProps>(
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

FieldSwitch.displayName = 'FieldSwitch'

export default withGridItem(FieldSwitch)
