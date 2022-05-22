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

import {FormFieldGrid, validationError} from '@data-driven-forms/mui-component-mapper'
import {useFieldApi, type UseFieldApiComponentConfig} from '@data-driven-forms/react-form-renderer'
import {
  Box,
  FormControl,
  FormControlProps as MuiFormControlProps,
  FormHelperText,
  type GridProps,
  InputLabel,
  Select,
  Stack,
  type TextFieldProps,
} from '@mui/material'
import {useCallback, useId, useState} from 'react'
import {SketchPicker, SketchPickerProps} from 'react-color'


type InternalColorPickerProps = Partial<TextFieldProps> & {
  FormFieldGridProps: GridProps;
  ColorPickerProps: Partial<SketchPickerProps>
  FormControlProps: Partial<MuiFormControlProps>
}

export type ColorPickerProps = InternalColorPickerProps & UseFieldApiComponentConfig


const ColorPickerComponent = (props: ColorPickerProps) => {
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
    FormFieldGridProps,
    FormControlProps,
    ColorPickerProps,
    defaultValue,
    onChange,
    ...rest
  } = useFieldApi(props as any)
  console.log('defaultValue', rest, defaultValue, input)
  const invalid = validationError(meta, validateOnMount)
  const hasError = Boolean(invalid)
  const [value, setValue] = useState(defaultValue || '')
  const handleChange = useCallback((value: string, e: any) => {
    console.log('handleChange', value, e)
    setValue(value || '')
    input?.onChange && input?.onChange(value)
    inputProps?.onChange && inputProps?.onChange(e)
    onChange && onChange(e)
  }, [input, inputProps, onChange])
  const handleTextChange = useCallback((e: any) => {
    handleChange(e.target.value, e)
  }, [handleChange])
  const handleColorChange = useCallback((color: any, e: any) => {
    handleChange(color.hex, e)
  }, [handleChange])

  const $id = `color-picker-${useId()}`

  return (
    <FormFieldGrid {...FormFieldGridProps}>
      <FormControl {...FormControlProps} fullWidth error={hasError}>
        <InputLabel id={$id + '-label'}>
          {label}
        </InputLabel>
        <Select
          {...input}
          fullWidth
          error={hasError}
          disabled={isDisabled}
          label={label}
          labelId={$id + '-label'}
          id={$id + '-select'}
          placeholder={placeholder}
          required={isRequired}
          inputProps={{
            readOnly: isReadOnly,
            ...inputProps,
          }}
          {...rest}
          onChange={handleTextChange}
          value={value}
          MenuProps={{
            // disablePortal: true,
            PaperProps: {
              sx: {
                minWidth: 'auto',
                px: 0, py: 0,
              },
            },
            MenuListProps: {
              disablePadding: true,
              ...{component: 'div'} as any,
              sx: {
                px: 0, py: 0,
              },
            },
          }}
          renderValue={(value) => (
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box
                width={22}
                height={22}
                borderRadius={1}
                borderWidth={1}
                borderColor="divider"
                borderStyle="solid"
                display="flex"
                backgroundColor={value}
              />
              <div>
                {value}
              </div>
            </Stack>
          )}
        >
          <SketchPicker
            {...ColorPickerProps}
            width={320}
            style={{boxShadow: 'none'}}
            color={value}
            onChangeComplete={handleColorChange}
          />
        </Select>
        <FormHelperText>
          {invalid || ((meta.touched || validateOnMount) && meta.warning) || helperText || description}
        </FormHelperText>
      </FormControl>
    </FormFieldGrid>
  )
}

ColorPickerComponent.defaultProps = {
  FormFieldGridProps: {},
  ColorPickerProps: {},
}

export {ColorPickerComponent}
export default ColorPickerComponent
