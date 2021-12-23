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

import MuiTextField, {TextFieldProps as MuiTextFieldProps} from '@mui/material/TextField'
import {forwardRef, ReactNode} from 'react'
import {useFieldApi, UseFieldApiConfig} from '../ddf-reexports'
import {withGridItem} from '../field-hocs'
import {validationMessage} from '../utils'


export type FieldTextareaProps = MuiTextFieldProps &
  UseFieldApiConfig & {
  isReadOnly?: boolean
  isDisabled?: boolean
  isRequired?: boolean
  description?: ReactNode
  validateOnMount?: boolean
}

const FieldTextarea = forwardRef<any, FieldTextareaProps>(
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
      ...rest
    } = useFieldApi(props)
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
        inputProps={{readOnly: isReadOnly, ...inputProps}}
        label={label}
        placeholder={placeholder}
        required={isRequired}
        size="small"
        fullWidth
        multiline
        {...rest}
      />
    )
  },
)

FieldTextarea.displayName = 'FieldTextarea'

export default withGridItem(FieldTextarea)
