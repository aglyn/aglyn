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

import { TextField as MuiTextField } from '@mui/material'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

export interface TextFieldProps extends BaseFieldProps {
  placeholder?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps?: Record<string, any>
  FormFieldGridProps?: FormFieldGridProps
}

export const TextField = (props: TextFieldProps) => {
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
    help,
    FormFieldGridProps = {},
    ...rest
  } = useFieldApi(props)
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <MuiTextField
        {...input}
        fullWidth
        error={!!invalid}
        helperText={
          invalid ||
          ((meta.touched || validateOnMount) && meta.warning) ||
          helperText ||
          description
        }
        disabled={isDisabled}
        label={label}
        placeholder={placeholder}
        required={isRequired}
        slotProps={{
          input: { readOnly: isReadOnly },
          htmlInput: { ...inputProps },
        }}
        {...rest}
      />
    </FormFieldGrid>
  )
}

export default TextField
