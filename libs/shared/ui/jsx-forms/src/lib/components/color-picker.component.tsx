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
// Deep import rather than through the barrel: this is a sibling module in
// the same lib and the barrel is edited by everything.
import { buildFieldClear } from '../mapper/form-field-grid'
import {
  useFieldApi,
  type UseFieldApiComponentConfig,
} from '@data-driven-forms/react-form-renderer'
import {
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
  paletteTokenToAlphaCssVar,
  parsePaletteTokenAlphaCssVar,
} from '@aglyn/shared-data-enums'
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
  /** Opacity the token carries, 0–1 (AGL-2486). */
  tokenAlpha?: number
  IconButtonProps?: Partial<IconButtonProps>
}

/**
 * Solid swatch for a literal colour, geometrically identical to
 * {@link TokenSwatch}: same box, same hairline ring, so a field showing a
 * token, a field showing a hex and an EMPTY field differ only in what fills
 * the circle. The ring is the element's own border rather than a wrapper's,
 * which is what keeps it concentric — a wrapper sized by its content rounds
 * its radius against its own padded box and reads as an off-centre ellipse
 * at this size.
 *
 * An unset field paints nothing and is the ring alone; `transparent` spells
 * that out so the declaration is never emitted with an empty value.
 */
const Swatch = styled('span', {
  shouldForwardProp: (propName) => propName !== 'color',
})<{ color: string }>(({ theme, color }) => ({
  width: 22,
  height: 22,
  flexShrink: 0,
  display: 'inline-flex',
  backgroundColor: color || 'transparent',
  borderRadius: '50%',
  border: `1px solid ${theme.palette.divider}`,
}))

const TextFieldColorSwatch = forwardRef<any, TextFieldColorSwatchProps>(
  (props, ref) => {
    const { color, token, tokenAlpha, IconButtonProps, ...rest } = props

    return (
      <InputAdornment ref={ref} position={'start'} {...rest}>
        <IconButton ref={ref} edge="start" {...IconButtonProps}>
          {token ? (
            <TokenSwatch
              light={token.light}
              dark={token.dark}
              alpha={tokenAlpha}
            />
          ) : (
            <Swatch color={color} />
          )}
        </IconButton>
      </InputAdornment>
    )
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
  /** Offer the reset-to-unset affordance (AGL-2486). */
  clearable?: boolean
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
      clearable,
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
    // A token carrying an author-chosen opacity (AGL-2486). It is stored as
    // `rgba(var(--mui-palette-primary-mainChannel, 31 41 55) / 0.12)` — still
    // a REFERENCE, so the site palette keeps driving it — and reading it back
    // here is what makes the picker re-open on the token with its slider at
    // 12% instead of on the custom stage showing an opaque string.
    const alphaToken = useMemo(
      () => parsePaletteTokenAlphaCssVar(value),
      [value],
    )
    const tokenPath = alphaToken ? alphaToken.path : value
    const tokenAlpha = alphaToken ? alphaToken.alpha : 1
    const activeToken = useMemo(
      () => tokenOptions.find((option) => option.value === tokenPath),
      [tokenOptions, tokenPath],
    )

    /**
     * The value a token + opacity pair is STORED as. A fully opaque token
     * stays the bare palette path (`primary.main`) — MUI's own sx resolution
     * handles it, and nothing about the shipped format changes for the
     * overwhelmingly common case. Only a real alpha reaches for the channel
     * form.
     */
    const writeToken = useCallback(
      (path: string, opacity: number) => {
        if (!(opacity < 1)) return path
        const option = tokenOptions.find((entry) => entry.value === path)
        // The literal fallback: what the token resolves to today, so a render
        // path that skips substitution still paints the right colour at the
        // right opacity.
        return paletteTokenToAlphaCssVar(
          path,
          opacity,
          option ? (option.light ?? option.dark) : undefined,
        )
      },
      [tokenOptions],
    )
    const [stage, setStage] = useState<'tokens' | 'custom' | undefined>()
    const effectiveStage =
      stage ??
      (!tokenOptions.length || (value && !activeToken) ? 'custom' : 'tokens')

    const handleClickAway = useCallback(
      (e: MouseEvent | TouchEvent) => setOpen(false),
      [],
    )
    const handleFocus = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        setStage(undefined)
        setOpen(true)
        onFocus && onFocus(e)
      },
      [onFocus],
    )

    const handleTokenSelect = useCallback(
      (picked: string, e: any) => {
        // Keeps the opacity across a token change: an author dialling a wash
        // to 12% and then trying it in secondary is adjusting ONE decision.
        handleChange(writeToken(picked, tokenAlpha), e)
        setOpen(false)
      },
      [handleChange, writeToken, tokenAlpha],
    )

    // Dragging the slider must not close the popper — this is the one control
    // in the picker an author adjusts continuously, so it commits live like
    // every other field in the styles panel and leaves the palette open.
    const handleOpacityChange = useCallback(
      (opacity: number) => {
        if (!activeToken) return
        handleChange(writeToken(activeToken.value, opacity), undefined)
      },
      [activeToken, handleChange, writeToken],
    )

    const startAdornment = useMemo(
      () => (
        <TextFieldColorSwatch
          color={value}
          token={activeToken}
          tokenAlpha={tokenAlpha}
          IconButtonProps={{
            onClick: () => {
              setStage(undefined)
              setOpen((prev) => !prev)
            },
          }}
        />
      ),
      [value, activeToken, tokenAlpha],
    )

    // The way back to "no colour" (AGL-2486). A colour picker has no empty
    // swatch and the text box re-parses whatever is left in it, so before
    // this there was no click anywhere in the panel that took a colour off
    // again — only another colour.
    const clear = buildFieldClear({
      clearable,
      label,
      hasValue: value !== '' && value !== undefined && value !== null,
      locked: Boolean(isDisabled || isReadOnly),
      onClear: () => {
        setOpen(false)
        handleChange('', undefined)
      },
    })

    return (
      <FormFieldGrid
        ref={ref}
        help={help}
        clear={clear}
        {...FormFieldGridProps}
      >
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
                  value={tokenPath}
                  onSelect={handleTokenSelect}
                  onCustom={() => setStage('custom')}
                  // Only once a token is picked: there is nothing to make
                  // translucent while the field is empty, and an opacity on a
                  // literal is already expressible through the custom
                  // picker's own alpha channel.
                  opacity={tokenAlpha}
                  onOpacityChange={
                    activeToken ? handleOpacityChange : undefined
                  }
                  // The picker itself offers the way back, not just the
                  // field's corner (AGL-2486): an author who opened the
                  // palette to change a colour is exactly the author who
                  // wants to take it off.
                  onClear={clear && !clear.hidden ? clear.onClear : undefined}
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
                        ? (activeToken.light ?? activeToken.dark ?? '')
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
