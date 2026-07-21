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
 * updated for the current @mui/x-date-pickers slots API.
 */

import type { TextFieldProps } from '@mui/material'

import {
  DatePicker as MuiDatePicker,
  type DatePickerProps as MuiDatePickerProps,
} from '@mui/x-date-pickers'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

export interface DatePickerProps extends BaseFieldProps {
  placeholder?: string
  FormFieldGridProps?: FormFieldGridProps
  DatePickerProps?: Omit<
    MuiDatePickerProps,
    'value' | 'onChange' | 'disabled' | 'readOnly'
  >
}

export const DatePicker = (props: DatePickerProps) => {
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
    help,
    FormFieldGridProps = {},
    DatePickerProps = {},
    ...rest
  } = useFieldApi(props)

  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <MuiDatePicker
        slotProps={{
          textField: {
            fullWidth: true,
            margin: 'normal',
            label,
            helperText:
              invalid ||
              ((meta.touched || validateOnMount) && meta.warning) ||
              helperText ||
              description,
            placeholder,
            required: isRequired,
            error: !!invalid,
            onBlur: input.onBlur,
            onFocus: input.onFocus,
          } as TextFieldProps,
        }}
        disabled={isDisabled || isReadOnly}
        readOnly={isReadOnly}
        {...input}
        value={input.value || null}
        {...DatePickerProps}
        {...rest}
      />
    </FormFieldGrid>
  )
}

export default DatePicker
