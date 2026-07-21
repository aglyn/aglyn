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
 * updated for the current MUI Grid API.
 */

import type { ReactNode } from 'react'

import {
  FormControl,
  type FormControlProps,
  FormGroup,
  type FormGroupProps,
  FormHelperText,
  type FormHelperTextProps,
  FormLabel,
  type FormLabelProps,
  Grid,
  type GridProps,
  Slider as MuiSlider,
  type SliderProps as MuiSliderProps,
} from '@mui/material'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

export interface SliderProps extends BaseFieldProps {
  FormFieldGridProps?: FormFieldGridProps
  FormControlProps?: FormControlProps
  FormGroupProps?: FormGroupProps
  FormLabelProps?: FormLabelProps
  FormHelperTextProps?: FormHelperTextProps
  before?: ReactNode
  after?: ReactNode
  InputGridProps?: GridProps
  BeforeGridProps?: GridProps
  SliderGridProps?: GridProps
  AfterGridProps?: GridProps
  min?: number
  max?: number
  step?: number
  SliderProps?: Omit<
    MuiSliderProps,
    'name' | 'value' | 'onChange' | 'onBlur' | 'onFocus'
  >
}

export const Slider = (props: SliderProps) => {
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
    help,
    FormFieldGridProps = {},
    FormControlProps = {},
    FormGroupProps = {},
    FormLabelProps = {},
    FormHelperTextProps = {},
    before,
    after,
    InputGridProps = {},
    BeforeGridProps = {},
    SliderGridProps = {},
    AfterGridProps = {},
    min = 0,
    max = 100,
    SliderProps = {},
    ...rest
  } = useFieldApi(props)

  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const text =
    invalid ||
    ((meta.touched || validateOnMount) && meta.warning) ||
    helperText ||
    description

  const defaultValue = (max + min) / 2

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <FormControl
        fullWidth
        required={isRequired}
        error={!!invalid}
        component="fieldset"
        {...FormControlProps}
      >
        <FormGroup {...FormGroupProps}>
          <FormLabel component="legend" {...FormLabelProps}>
            {label}
          </FormLabel>
          <Grid container spacing={2} alignItems="center" {...InputGridProps}>
            {before && <Grid {...BeforeGridProps}>{before}</Grid>}
            <Grid size="grow" {...SliderGridProps}>
              <MuiSlider
                {...input}
                value={input.value || defaultValue}
                min={min}
                max={max}
                disabled={isDisabled || isReadOnly}
                onChange={(_e, value) => input.onChange(value)}
                {...SliderProps}
                {...rest}
              />
            </Grid>
            {after && <Grid {...AfterGridProps}>{after}</Grid>}
          </Grid>
          {text && (
            <FormHelperText {...FormHelperTextProps}>{text}</FormHelperText>
          )}
        </FormGroup>
      </FormControl>
    </FormFieldGrid>
  )
}

export default Slider
