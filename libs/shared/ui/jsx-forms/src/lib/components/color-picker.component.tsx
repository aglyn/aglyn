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
  type FormFieldGridProps,
  validationError,
} from '../mapper'
import {
  useFieldApi,
  type UseFieldApiComponentConfig,
} from '@data-driven-forms/react-form-renderer'
import {
  Box,
  Button,
  ClickAwayListener,
  type FormControlProps as MuiFormControlProps,
  type GridProps,
  IconButton,
  type IconButtonProps,
  InputAdornment,
  type InputAdornmentProps,
  Paper,
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
import {
  ColorTokenGrid,
  type ColorPickerTokenOption,
  rgbColorToCss,
  type RgbColorValue,
  TokenSwatch,
  useColorPickerTokenOptions,
} from './color-picker-tokens'

interface TextFieldColorSwatchProps extends Partial<InputAdornmentProps> {
  color: string
  /** Set when the value is a theme token — renders the split swatch. */
  token?: ColorPickerTokenOption
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
    const { color, token, IconButtonProps, ...rest } = props

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
            {token ? (
              <TokenSwatch light={token.light} dark={token.dark} />
            ) : (
              <Swatch color={color} />
            )}
          </Box>
        </IconButton>
      </InputAdornment>
    );
  },
)
TextFieldColorSwatch.displayName = 'AglynTextFieldColorSwatch'

type InternalColorPickerProps = Partial<TextFieldProps> & {
  /** Contextual help tooltip, same contract as every other field. */
  help?: FormFieldGridProps['help']
  FormFieldGridProps?: Partial<GridProps>
  ColorPickerProps?: Partial<AglynColorPickerProps>
  FormControlProps?: Partial<MuiFormControlProps>
  PopperProps?: Partial<PopperProps>
  presetColors?: string[]
}

export type ColorPickerProps = InternalColorPickerProps &
  UseFieldApiComponentConfig

type RGBColor = RgbColorValue

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
      // Every other field forwards `help` to FormFieldGrid, which renders
      // the tip. This one used to swallow it into `...rest`, so a colour
      // field given a help tip rendered nothing at all and gave no clue
      // why — found while adding tips to the styles panel (AGL-1220).
      help,
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
        const val = rgbColorToCss(value || '') || ''
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

    // Two-stage picking (AGL-588): theme token references first, the
    // raw color picker behind an explicit "Custom color" step. A stored
    // token path re-opens on the token stage with its swatch selected; a
    // hex/rgb value re-opens on the custom stage. `stage` only tracks an
    // explicit in-session choice — it resets whenever the popper opens.
    const tokenOptions = useColorPickerTokenOptions()
    const activeToken = useMemo(
      () => tokenOptions.find((option) => option.value === value),
      [tokenOptions, value],
    )
    const [stage, setStage] = useState<'tokens' | 'custom' | undefined>()
    const effectiveStage =
      stage ??
      (!tokenOptions.length || (value && !activeToken) ? 'custom' : 'tokens')

    const handleClickAway = useCallback((e: MouseEvent | TouchEvent) => setOpen(false), [])
    const handleFocus = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        setStage(undefined)
        setOpen(true)
        onFocus && onFocus(e)
      },
      [onFocus],
    )

    const handleTokenSelect = useCallback(
      (tokenPath: string, e: any) => {
        handleChange(tokenPath, e)
        setOpen(false)
      },
      [handleChange],
    )

    const startAdornment = useMemo(
      () => (
        <TextFieldColorSwatch
          color={value}
          token={activeToken}
          IconButtonProps={{
            onClick: () => {
              setStage(undefined)
              setOpen((prev) => !prev)
            },
          }}
        />
      ),
      [value, activeToken],
    )

    return (
      <FormFieldGrid ref={ref} help={help} {...FormFieldGridProps}>
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
              {effectiveStage === 'tokens' ? (
                <ColorTokenGrid
                  options={tokenOptions}
                  value={value}
                  onSelect={handleTokenSelect}
                  onCustom={() => setStage('custom')}
                />
              ) : (
                <Paper sx={{ p: 0.5 }}>
                  {tokenOptions.length ? (
                    <Button
                      size="small"
                      fullWidth
                      sx={{ mb: 0.5 }}
                      onClick={() => setStage('tokens')}
                    >
                      ‹ Theme colors
                    </Button>
                  ) : null}
                  <AglynColorPicker
                    {...ColorPickerProps}
                    // A token path is not parseable by the picker; seed it
                    // with the token's resolved color instead.
                    color={
                      activeToken
                        ? activeToken.light ?? activeToken.dark ?? ''
                        : value
                    }
                    onChange={handleColorChange}
                    presetColors={presetColors}
                  />
                </Paper>
              )}
            </Popper>
          </div>
        </ClickAwayListener>
      </FormFieldGrid>
    )
  },
)
ColorPickerComponent.displayName = 'ColorPickerComponent'

export default ColorPickerComponent
