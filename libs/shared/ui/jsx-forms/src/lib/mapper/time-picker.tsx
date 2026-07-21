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
  TimePicker as MuiTimePicker,
  type TimePickerProps as MuiTimePickerProps,
} from '@mui/x-date-pickers'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

export interface TimePickerProps extends BaseFieldProps {
  placeholder?: string
  FormFieldGridProps?: FormFieldGridProps
  TimePickerProps?: Omit<
    MuiTimePickerProps,
    'value' | 'onChange' | 'disabled' | 'readOnly'
  >
}

export const TimePicker = (props: TimePickerProps) => {
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
    TimePickerProps = {},
    ...rest
  } = useFieldApi(props)

  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <MuiTimePicker
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
        readOnly={isReadOnly}
        disabled={isDisabled || isReadOnly}
        {...input}
        value={input.value || null}
        {...TimePickerProps}
        {...rest}
      />
    </FormFieldGrid>
  )
}

export default TimePicker
