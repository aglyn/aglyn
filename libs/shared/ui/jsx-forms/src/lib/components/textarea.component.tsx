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
  TextField as MuiTextField,
  type TextFieldProps as MuiTextFieldProps,
} from '@mui/material'
import { forwardRef } from 'react'
import { validationMessage } from '../utils/validation-message'
import {
  useFieldApi,
  type UseFieldApiConfig,
} from '../vendor/data-driven-forms'

export type TextareaProps = MuiTextFieldProps &
  UseFieldApiConfig & {
    isReadOnly?: boolean
    isDisabled?: boolean
    isRequired?: boolean
    description?: JSX.Node
    validateOnMount?: boolean
  }

const TextareaComponent = forwardRef<any, TextareaProps>((props, ref) => {
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
    ...rest
  } = useFieldApi(props as UseFieldApiConfig)
  const invalidMessage = validationMessage(meta, validateOnMount)
  const helpText =
    invalidMessage ||
    ((meta.touched || validateOnMount) && meta.warning) ||
    helperText ||
    description

  return (
    <MuiTextField
      {...input}
      ref={ref}
      disabled={isDisabled}
      error={Boolean(invalidMessage)}
      helperText={helpText}
      slotProps={{ htmlInput: { readOnly: isReadOnly, ...inputProps } }}
      label={label}
      placeholder={placeholder}
      required={isRequired}
      size="small"
      fullWidth
      multiline
      {...rest}
    />
  )
})

TextareaComponent.displayName = 'TextareaComponent'
TextareaComponent.aglyn = true

export default TextareaComponent
