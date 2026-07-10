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

import {
  FormControl,
  type FormControlLabelProps,
  FormControlLabel,
  type FormControlProps,
  FormHelperText,
  type FormHelperTextProps,
  FormLabel,
  type FormLabelProps,
  Radio as MuiRadio,
} from '@mui/material'
import { styled } from '@mui/material/styles'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps, OptionValue, SelectOption } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

const PREFIX = 'Radio'

const classes = {
  grid: `${PREFIX}-grid`,
}

const StyledFormFieldGrid = styled(FormFieldGrid)(() => ({
  [`&.${classes.grid}`]: {
    '&:first-of-type': {
      marginTop: 8,
    },
  },
}))

interface RadioFieldOptionProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps?: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface RadioOptionProps<T = OptionValue> {
  name: string
  option: SelectOption<T>
  isDisabled?: boolean
  isReadOnly?: boolean
  FormControlLabelProps?: Partial<FormControlLabelProps>
  RadioProps?: RadioFieldOptionProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

function RadioOption<T = OptionValue>({
  name,
  option,
  isDisabled,
  isReadOnly,
  FormControlLabelProps,
  RadioProps: { inputProps, ...RadioProps } = {},
  ...props
}: RadioOptionProps<T>) {
  const { input } = useFieldApi({
    name,
    type: 'radio',
    value: option.value,
  })

  return (
    <FormControlLabel
      key={`${name}-${String(option.value)}`}
      control={
        <MuiRadio
          {...input}
          name={name}
          disabled={isDisabled || isReadOnly}
          onChange={() => input.onChange(option.value)}
          slotProps={{
            input: { readOnly: isReadOnly, ...inputProps },
          }}
          {...RadioProps}
        />
      }
      label={option.label}
      {...FormControlLabelProps}
      {...props}
    />
  )
}

export interface RadioProps<T = OptionValue> extends BaseFieldProps {
  options?: SelectOption<T>[]
  FormFieldGridProps?: FormFieldGridProps
  FormControlProps?: FormControlProps
  FormLabelProps?: FormLabelProps
  FormHelperTextProps?: FormHelperTextProps
  FormControlLabelProps?: Partial<FormControlLabelProps>
  RadioProps?: RadioFieldOptionProps
}

export function Radio<T = OptionValue>({ name, ...props }: RadioProps<T>) {
  const {
    options = [],
    isDisabled,
    label,
    isRequired,
    helperText,
    description,
    isReadOnly,
    meta,
    validateOnMount,
    FormFieldGridProps = {},
    FormControlProps = {},
    FormLabelProps = {},
    FormHelperTextProps = {},
    FormControlLabelProps = {},
    RadioProps = {},
    ...rest
  } = useFieldApi({
    ...props,
    name,
    type: 'radio',
  })

  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const text =
    invalid ||
    ((meta.touched || validateOnMount) && meta.warning) ||
    helperText ||
    description

  return (
    <StyledFormFieldGrid className={classes.grid} {...FormFieldGridProps}>
      <FormControl
        required={isRequired}
        error={!!invalid}
        component="fieldset"
        {...FormControlProps}
      >
        <FormLabel component="legend" {...FormLabelProps}>
          {label}
        </FormLabel>
        {(options as SelectOption<T>[]).map((option) => (
          <RadioOption<T>
            key={String(option.value)}
            name={name || ''}
            option={option}
            isDisabled={isDisabled}
            isReadOnly={isReadOnly}
            FormControlLabelProps={FormControlLabelProps}
            RadioProps={RadioProps}
            {...rest}
          />
        ))}
        {text && (
          <FormHelperText {...FormHelperTextProps}>{text}</FormHelperText>
        )}
      </FormControl>
    </StyledFormFieldGrid>
  )
}

export default Radio
