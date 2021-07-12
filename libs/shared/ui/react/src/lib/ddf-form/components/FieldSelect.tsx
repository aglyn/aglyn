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

import { forwardRef, ReactNode } from 'react'

import MuiSelect, { SelectProps as MuiSelectProps } from '@material-ui/core/Select'
import MuiFormControl, { FormControlProps as MuiFormControlProps } from '@material-ui/core/FormControl'
import MuiFormHelperText, { FormHelperTextProps as MuiFormHelperTextProps } from '@material-ui/core/FormHelperText'
import MuiInputLabel, { InputLabelProps as MuiInputLabelProps } from '@material-ui/core/InputLabel'
import MuiMenuItem, { MenuItemProps as MuiMenuItemProps } from '@material-ui/core/MenuItem'
import { createStyles, WithStyles, withStyles, Theme } from '@material-ui/core/styles'

import clsx from 'clsx'
import useFieldApi, { UseFieldApiConfig } from '@data-driven-forms/react-form-renderer/use-field-api'

import { withGridItem } from '../field-hocs'
import { validationMessage } from '../utils'


export type Props = MuiSelectProps & UseFieldApiConfig & {
  isReadOnly?: boolean
  isDisabled?: boolean
  isRequired?: boolean
  description?: ReactNode
  validateOnMount?: boolean
  FormControlProps?: Partial<MuiFormControlProps>
  disableDefaultOption?: boolean
  defaultOption?: MuiMenuItemProps
}

const styles = createStyles({
  root: {
    width: '100%',
    display: 'flex',
  }
})

const FieldSelect = forwardRef<any, Props & WithStyles<typeof styles>>(
  function  RefRenderFn(props, ref) {
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
      classes,
      className,
      options = [],
      variant,
      FormControlProps,
      defaultOption,
      disableDefaultOption,
      ...rest
    } = useFieldApi(props)
    const invalidMessage = validationMessage(meta, validateOnMount)
    const helpText = invalidMessage || ((meta.touched || validateOnMount) && meta.warning) || helperText || description

    return (
      <MuiFormControl
        ref={ref}
        className={clsx(classes.root, className)}
        variant={variant}
        {...FormControlProps}
      >
        <MuiInputLabel id={`field-select-${input.name}`}>
          {label}
        </MuiInputLabel>
        <MuiSelect
          {...input}
          disabled={isDisabled}
          error={Boolean(invalidMessage)}
          inputProps={{ readOnly: isReadOnly, ...inputProps }}
          label={label}
          labelId={`field-select-${input.name}`}
          required={isRequired}
          fullWidth
          {...rest}
        >

          {disableDefaultOption ? null : (
            <MuiMenuItem value={''} {...defaultOption}>
              {defaultOption?.children ?? '(Default)'}
            </MuiMenuItem>
          )}
          {options.map(({children, label, value, ...item}, index) => (
            <MuiMenuItem key={value ?? index} value={value} {...item}>
              {children ?? label}
            </MuiMenuItem>
          ))}
        </MuiSelect>
        {!helpText ? null : (
          <MuiFormHelperText>{helpText}</MuiFormHelperText>
        )}
      </MuiFormControl>
    )
  }
)

FieldSelect.displayName = 'FieldSelect'

export default withGridItem(withStyles(styles, {name: 'FieldSelect'})(FieldSelect))
