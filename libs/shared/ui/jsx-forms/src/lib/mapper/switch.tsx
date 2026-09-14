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
import { useStoredFieldHasValue } from './stored-field-value'
import FormFieldGrid, {
  buildFieldClear,
  type FormFieldGridProps,
} from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

export interface SwitchProps extends BaseFieldProps {
  onText?: string
  offText?: string
  /**
   * Offer the reset-to-unset affordance (AGL-2486). A switch can only be on or
   * off, so without it a field whose unset state means something — a page
   * handing the choice back to its component's default — has no way back.
   */
  clearable?: boolean
  /**
   * The position shown while nothing is stored — the default a page falls
   * back to. Without it an unset switch reads as off, which is wrong wherever
   * the value that applies is on.
   */
  unsetChecked?: boolean
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
    clearable,
    unsetChecked,
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
  const hasValue = useStoredFieldHasValue(input.name)
  const clear = buildFieldClear({
    clearable,
    label,
    hasValue,
    locked: Boolean(isDisabled || isReadOnly),
    onClear: () => input.onChange(undefined),
  })

  return (
    <FormFieldGrid help={help} clear={clear} {...FormFieldGridProps}>
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
                checked={hasValue ? input.checked : Boolean(unsetChecked)}
                disabled={isDisabled || isReadOnly}
                onChange={({ target: { checked } }) => input.onChange(checked)}
                {...SwitchProps}
              />
            }
            label={
              <FormLabel {...FormLabelProps}>
                {(hasValue ? input.checked : unsetChecked)
                  ? onText || label
                  : offText || label}
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
