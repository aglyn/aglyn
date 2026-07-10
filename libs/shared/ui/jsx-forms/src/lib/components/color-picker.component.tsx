/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  ColorPicker as AglynColorPicker,
  type ColorPickerProps as AglynColorPickerProps,
} from '@aglyn/shared-ui-color-picker'
import { styled } from '@aglyn/shared-ui-theme'
import {
  type ExtendedFieldMeta,
  FormFieldGrid,
  validationError,
} from '../mapper'
import {
  useFieldApi,
  type UseFieldApiComponentConfig,
} from '@data-driven-forms/react-form-renderer'
import {
  Box,
  ClickAwayListener,
  type FormControlProps as MuiFormControlProps,
  type GridProps,
  IconButton,
  type IconButtonProps,
  InputAdornment,
  type InputAdornmentProps,
  Popper,
  type PopperProps,
  TextField as MuiTextField,
  type TextFieldProps,
} from '@mui/material'
import {
  type FocusEvent,
  forwardRef,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

interface TextFieldColorSwatchProps extends Partial<InputAdornmentProps> {
  color: string
  IconButtonProps?: Partial<IconButtonProps>
}

const Swatch = styled('span', {
  shouldForwardProp: (propName) => propName !== 'color',
})<{ color: string }>(({ theme, color }) => ({
  width: 22,
  height: 22,
  display: 'flex',
  backgroundColor: color,
  borderRadius: '50%',
}))

const TextFieldColorSwatch = forwardRef<any, TextFieldColorSwatchProps>(
  (props, ref) => {
    const { color, IconButtonProps, ...rest } = props

    return (
      <InputAdornment ref={ref} position={'start'} {...rest}>
        <IconButton ref={ref} edge="start" {...IconButtonProps}>
          <Box
            sx={{
              padding: 0.35,
              border: 1,
              borderColor: 'divider',
              borderRadius: "50%"
            }}>
            <Swatch color={color} />
          </Box>
        </IconButton>
      </InputAdornment>
    );
  },
)
TextFieldColorSwatch.displayName = 'AglynTextFieldColorSwatch'

type InternalColorPickerProps = Partial<TextFieldProps> & {
  FormFieldGridProps?: Partial<GridProps>
  ColorPickerProps?: Partial<AglynColorPickerProps>
  FormControlProps?: Partial<MuiFormControlProps>
  PopperProps?: Partial<PopperProps>
  presetColors?: string[]
}

export type ColorPickerProps = InternalColorPickerProps &
  UseFieldApiComponentConfig

type RGBColor = {
  r: number
  g: number
  b: number
  a: number
}

const getStrValue = (value: RGBColor | string) => {
  if (typeof value === 'string') return value
  const { r, g, b, a } = { ...(value as RGBColor) }
  if (a < 1) return `rgba(${r || 0}, ${g || 0}, ${b || 0}, ${a || 0})`
  return `rgb(${r || 0}, ${g || 0}, ${b || 0})`
}

export const ColorPickerComponent = forwardRef<any, ColorPickerProps>(
  (props, ref) => {
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
      defaultValue,
      onChange,
      onBlur,
      onFocus,
      inputProps,
      InputProps,
      presetColors,
      FormFieldGridProps,
      FormControlProps,
      ColorPickerProps,
      PopperProps,
      ...rest
    } = useFieldApi(props as any)

    const id = `color-picker-${useId()}`
    const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
    const hasError = Boolean(invalid)

    const value = input?.value || defaultValue || ''

    const handleChange = useCallback(
      (value: RGBColor | string, e: any) => {
        const val = getStrValue(value || '') || ''
        input?.onChange && input?.onChange(val)
        inputProps?.onChange && inputProps?.onChange(e, val)
        onChange && onChange(e, val)
      },
      [input, inputProps, onChange],
    )

    const handleTextChange = useCallback(
      (e: any) => {
        handleChange(e.target.value, e)
      },
      [handleChange],
    )

    const handleColorChange = useCallback(
      (color: any, e: any) => {
        handleChange(color.rgb, e)
      },
      [handleChange],
    )

    const popperRef = useRef<HTMLDivElement | null>(null)
    const [fieldRef, setFieldRef] = useState<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)

    const handleClickAway = useCallback((e: MouseEvent | TouchEvent) => setOpen(false), [])
    const handleFocus = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        setOpen(true)
        onFocus && onFocus(e)
      },
      [onFocus],
    )

    const startAdornment = useMemo(
      () => (
        <TextFieldColorSwatch
          color={value}
          IconButtonProps={{
            onClick: () => setOpen((prev) => !prev),
          }}
        />
      ),
      [value],
    )

    return (
      <FormFieldGrid ref={ref} {...FormFieldGridProps}>
        <ClickAwayListener onClickAway={handleClickAway}>
          <div>
            <MuiTextField
              {...input}
              fullWidth
              error={hasError}
              helperText={
                invalid ||
                ((meta.touched || validateOnMount) && meta.warning) ||
                helperText ||
                description
              }
              disabled={isDisabled}
              label={label}
              placeholder={placeholder || 'default'}
              required={isRequired}
              onChange={handleTextChange}
              onFocus={handleFocus}
              value={value}
              slotProps={{
                htmlInput: {
                  ...inputProps,
                  readOnly: isReadOnly,
                },
                input: {
                  startAdornment,
                  ref: setFieldRef,
                  ...InputProps,
                },
              }}
              {...rest}
            />
            <Popper
              id={id}
              ref={popperRef}
              open={Boolean(fieldRef && open)}
              anchorEl={fieldRef}
              sx={{ zIndex: 'tooltip', maxWidth: 280 }}
              disablePortal
              {...PopperProps}
            >
              <AglynColorPicker
                {...ColorPickerProps}
                color={value}
                onChange={handleColorChange}
                presetColors={presetColors}
              />
            </Popper>
          </div>
        </ClickAwayListener>
      </FormFieldGrid>
    )
  },
)
ColorPickerComponent.displayName = 'ColorPickerComponent'

export default ColorPickerComponent
