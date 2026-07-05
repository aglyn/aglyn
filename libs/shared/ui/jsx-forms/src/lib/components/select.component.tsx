/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  FormControl as MuiFormControl,
  type FormControlProps as MuiFormControlProps,
  FormHelperText as MuiFormHelperText,
  InputLabel as MuiInputLabel,
  MenuItem as MuiMenuItem,
  type MenuItemProps as MuiMenuItemProps,
  Select as MuiSelect,
  type SelectProps as MuiSelectProps,
} from '@mui/material'
import { forwardRef } from 'react'
import { validationMessage } from '../utils/validation-message'
import {
  useFieldApi,
  type UseFieldApiConfig,
} from '../vendor/data-driven-forms'

export type SelectBaseProps = MuiSelectProps & UseFieldApiConfig

export type SelectProps = SelectBaseProps & {
  isReadOnly?: boolean
  isDisabled?: boolean
  isRequired?: boolean
  description?: JSX.Node
  validateOnMount?: boolean
  FormControlProps?: Partial<MuiFormControlProps>
  disableDefaultOption?: boolean
  defaultOption?: MuiMenuItemProps
}

export const SelectComponent = forwardRef<any, SelectProps>((props, ref) => {
  const {
    input,
    isReadOnly,
    isDisabled,
    placeholder,
    isRequired,
    label,
    helperText,
    description,
    validateOnMount,
    meta,
    inputProps,
    options = [],
    variant,
    FormControlProps: { sx: formControlSx, ...formControlProps } = {},
    defaultOption,
    disableDefaultOption,
    ...rest
  } = useFieldApi(props as UseFieldApiConfig)
  const invalidMessage = validationMessage(meta, validateOnMount)
  const helpText =
    invalidMessage ||
    ((meta.touched || validateOnMount) && meta.warning) ||
    helperText ||
    description

  return (
    <MuiFormControl
      ref={ref}
      variant={variant}
      size="small"
      sx={mergeSxProps({ width: '100%', display: 'flex' }, formControlSx)}
      {...formControlProps}
    >
      <MuiInputLabel id={`field-select-${input.name}`}>{label}</MuiInputLabel>
      <MuiSelect
        {...input}
        disabled={isDisabled}
        error={Boolean(invalidMessage)}
        inputProps={{
          readOnly: isReadOnly,
          ...inputProps,
        }}
        label={label}
        labelId={`field-select-${input.name}`}
        required={isRequired}
        fullWidth
        {...rest}
      >
        {disableDefaultOption ? null : (
          <MuiMenuItem value={''} {...defaultOption}>
            {defaultOption?.children ?? 'None'}
          </MuiMenuItem>
        )}
        {options.map(
          ({ children, label, value, ...item }: any, key: number) => (
            <MuiMenuItem
              key={item.key ?? item.id ?? value ?? key}
              value={value}
              {...item}
            >
              {children ?? label}
            </MuiMenuItem>
          ),
        )}
      </MuiSelect>
      {!helpText ? null : <MuiFormHelperText>{helpText}</MuiFormHelperText>}
    </MuiFormControl>
  )
})

SelectComponent.displayName = 'SelectComponent'
SelectComponent.aglyn = true

export default SelectComponent
