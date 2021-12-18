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

import {styled} from '@aglyn/shared-feature-themes'
import MuiFormControl, {FormControlProps as MuiFormControlProps} from '@mui/material/FormControl'
import MuiFormHelperText from '@mui/material/FormHelperText'
import MuiInputLabel from '@mui/material/InputLabel'
import MuiMenuItem, {MenuItemProps as MuiMenuItemProps} from '@mui/material/MenuItem'
import MuiSelect, {SelectProps as MuiSelectProps} from '@mui/material/Select'
import {forwardRef, ReactNode} from 'react'
import {useFieldApi, UseFieldApiConfig} from '../ddf-reexports'
import {withGridItem} from '../field-hocs'
import {validationMessage} from '../utils'


const SelectFormControl = styled(MuiFormControl, {
  name: 'SelectFormControl',
})({
  width: '100%',
  display: 'flex',
})

export type FieldSelectProps = MuiSelectProps &
  UseFieldApiConfig & {
  isReadOnly?: boolean
  isDisabled?: boolean
  isRequired?: boolean
  description?: ReactNode
  validateOnMount?: boolean
  FormControlProps?: Partial<MuiFormControlProps>
  disableDefaultOption?: boolean
  defaultOption?: MuiMenuItemProps
}

const FieldSelect = forwardRef<any, FieldSelectProps>(
  function RefRenderFn(props, ref) {
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
      FormControlProps,
      defaultOption,
      disableDefaultOption,
      ...rest
    } = useFieldApi(props)
    const invalidMessage = validationMessage(meta, validateOnMount)
    const helpText =
      invalidMessage ||
      ((meta.touched || validateOnMount) && meta.warning) ||
      helperText ||
      description

    return (
      <SelectFormControl ref={ref} variant={variant} size="small" {...FormControlProps}>
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
          placeholder={placeholder}
          fullWidth
          {...rest}
        >
          {disableDefaultOption ? null : (
            <MuiMenuItem value={''} {...defaultOption}>
              {defaultOption?.children ?? '(Default)'}
            </MuiMenuItem>
          )}
          {options.map(({children, label, value, ...item}, index) => (
            <MuiMenuItem key={item.id ?? value ?? index} value={value} {...item}>
              {children ?? label}
            </MuiMenuItem>
          ))}
        </MuiSelect>
        {!helpText ? null : <MuiFormHelperText>{helpText}</MuiFormHelperText>}
      </SelectFormControl>
    )
  },
)

FieldSelect.displayName = 'FieldSelect'

export default withGridItem(FieldSelect)
