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

import {
  ColorPicker as AglynColorPicker,
  type ColorPickerProps as AglynColorPickerProps,
} from '@aglyn/shared-ui-color-picker'
import {
  buildCssGradient,
  type CssGradient,
  type CssGradientStop,
  type CssGradientType,
  parseCssGradient,
  parsePaletteTokenCssVar,
  paletteTokenToCssVar,
} from '@aglyn/shared-data-enums'
import {
  Box,
  Button,
  ButtonBase,
  ClickAwayListener,
  FormHelperText,
  IconButton,
  MenuItem,
  Paper,
  Popper,
  Stack,
  TextField as MuiTextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ColorTokenGrid,
  type ColorPickerTokenOption,
  rgbColorToCss,
  TokenSwatch,
  useColorPickerTokenOptions,
} from '../components/color-picker-tokens'
import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

/**
 * CssGradient (AGL-1331): the Background Fill editor.
 *
 * The Styles panel's Colors group offered *Text Color* and *Background
 * Color* and nothing else, so a gradient could not be authored at all —
 * and typing one into Background Color was accepted, stored as
 * `background-color: linear-gradient(…)`, and dropped by the CSS parser
 * with no error anywhere. This is the control that expresses the value,
 * and `describeCssColorProblem` is the guard that stops the silent store;
 * the two ship together on purpose.
 *
 * The PERSISTED value is ONE CSS string under `backgroundImage` — the same
 * contract as `CssDimensionField`, so nothing downstream has to know
 * this editor exists. A **Solid** fill writes `''`, which clears
 * `backgroundImage` and leaves the neighbouring Background Color field to
 * do the job; the two never fight over one property.
 *
 * Stops bind to palette TOKENS or to literals, and a single gradient can
 * mix them: the marketing CTA's endpoints are `primary.main` /
 * `secondary.main` while its mid stop `#7A5CF0` has no token at all. A
 * token stop persists as `var(--mui-palette-primary-main, #00B0FF)` and is
 * substituted against the site theme by the node renderer
 * (`resolvePaletteVarsSx`) — see that module for why the reference is not
 * left to the browser.
 *
 * Anything the editor cannot model — `conic-gradient`, `to bottom right`,
 * a comma-stacked image list — falls back to a free-text box holding the
 * raw string, so no existing value is destroyed by an editor that cannot
 * show it. The stacked case reaches that box only because `parseCssGradient`
 * splits top-level layers first (AGL-1336); until it did, a tint over a
 * photo opened in the STOP editor and the author's first edit deleted the
 * photo.
 */

/** What the fill-type switch offers; `solid` means "no background image". */
type GradientFillType = 'solid' | CssGradientType

interface GradientDraft {
  fill: GradientFillType
  angle: string
  stops: CssGradientStop[]
  /** The value is not a gradient this editor can model — held verbatim. */
  raw?: string
}

const DEFAULT_ANGLE = 180

const emptyDraft: GradientDraft = { fill: 'solid', angle: '', stops: [] }

export const seedGradientDraft = (value: unknown): GradientDraft => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return emptyDraft
  const parsed = parseCssGradient(text)
  // A non-gradient background image (`url(…)`) is still someone's value.
  if (!parsed) return { ...emptyDraft, fill: 'linear', raw: text }
  if (parsed.raw !== undefined) {
    return { fill: parsed.type, angle: '', stops: [], raw: parsed.raw }
  }
  return {
    fill: parsed.type,
    angle: parsed.angle === undefined ? '' : `${parsed.angle}`,
    stops: parsed.stops,
  }
}

export const serializeGradientDraft = (draft: GradientDraft): string => {
  if (draft.raw !== undefined) return draft.raw
  if (draft.fill === 'solid') return ''
  const angle = draft.angle.trim()
  const gradient: CssGradient = {
    type: draft.fill,
    angle: angle === '' ? undefined : Number(angle),
    stops: draft.stops,
  }
  return buildCssGradient(gradient)
}

/** The two stops a fresh gradient starts from — brand ends when available. */
function defaultStops(options: ColorPickerTokenOption[]): CssGradientStop[] {
  const pick = (path: string) => options.find((option) => option.value === path)
  const start = pick('primary.main')
  const end = pick('secondary.main')
  return [
    {
      color: start
        ? paletteTokenToCssVar(start.value, start.light ?? start.dark)
        : '#ffffff',
      position: 0,
    },
    {
      color: end
        ? paletteTokenToCssVar(end.value, end.light ?? end.dark)
        : '#000000',
      position: 100,
    },
  ]
}

/** The token a stop is bound to, or undefined when it is a literal. */
function stopToken(
  color: string,
  options: ColorPickerTokenOption[],
): ColorPickerTokenOption | undefined {
  const ref = parsePaletteTokenCssVar(color)
  if (!ref) return undefined
  return options.find((option) => option.value === ref.path)
}

/**
 * A preview-safe copy of the value: token references resolve to the SITE
 * theme's colour rather than to whatever `--mui-palette-*` the surrounding
 * app happens to define (the console defines its own).
 */
function previewGradient(
  draft: GradientDraft,
  options: ColorPickerTokenOption[],
): string {
  const resolved = {
    ...draft,
    stops: draft.stops.map((stop) => {
      const ref = parsePaletteTokenCssVar(stop.color)
      if (!ref) return stop
      const token = options.find((option) => option.value === ref.path)
      const color = token?.light ?? token?.dark ?? ref.fallback ?? stop.color
      return { ...stop, color }
    }),
  }
  return serializeGradientDraft(resolved)
}

/** Swatch + label button that opens one stop's two-stage colour picker. */
const GradientStopColor = (props: {
  color: string
  label: string
  disabled?: boolean
  presetColors?: string[]
  ColorPickerProps?: Partial<AglynColorPickerProps>
  onChange: (color: string) => void
}) => {
  const { color, label, disabled, presetColors, ColorPickerProps, onChange } =
    props
  const options = useColorPickerTokenOptions()
  const token = stopToken(color, options)
  const literal = parsePaletteTokenCssVar(color)?.fallback ?? color
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [stage, setStage] = useState<'tokens' | 'custom'>('tokens')

  const handleOpen = useCallback(
    (event: { currentTarget: HTMLElement }) => {
      // Tokens first, exactly like the colour field's two-stage picker —
      // unless the theme offers none, in which case the token stage would
      // be an empty grid.
      setStage(options.length ? 'tokens' : 'custom')
      setAnchor((previous) => (previous ? null : event.currentTarget))
    },
    [options.length],
  )

  return (
    <ClickAwayListener onClickAway={() => setAnchor(null)}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <ButtonBase
          aria-label={label}
          disabled={disabled}
          onClick={handleOpen}
          sx={{
            width: '100%',
            justifyContent: 'flex-start',
            gap: 0.75,
            px: 1,
            py: 0.75,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          {token ? (
            <TokenSwatch light={token.light} dark={token.dark} size={18} />
          ) : (
            <Box
              sx={{
                width: 18,
                height: 18,
                flexShrink: 0,
                borderRadius: '50%',
                border: 1,
                borderColor: 'divider',
                backgroundColor: literal,
              }}
            />
          )}
          <Typography variant="caption" noWrap>
            {token ? token.label : literal}
          </Typography>
        </ButtonBase>
        <Popper
          open={Boolean(anchor)}
          anchorEl={anchor}
          sx={{ zIndex: 'tooltip', maxWidth: 280 }}
          disablePortal
        >
          {stage === 'tokens' && options.length ? (
            <ColorTokenGrid
              options={options}
              value={token?.value ?? ''}
              onSelect={(path) => {
                const picked = options.find((option) => option.value === path)
                onChange(
                  paletteTokenToCssVar(path, picked?.light ?? picked?.dark),
                )
                setAnchor(null)
              }}
              onCustom={() => setStage('custom')}
            />
          ) : (
            <Paper sx={{ p: 0.5 }}>
              {options.length ? (
                <Button
                  size="small"
                  fullWidth
                  sx={{ mb: 0.5 }}
                  onClick={() => setStage('tokens')}
                >
                  {'‹ Theme colors'}
                </Button>
              ) : null}
              <AglynColorPicker
                {...ColorPickerProps}
                // A `var()` reference is not parseable by the picker; seed
                // it with the colour that reference resolves to.
                color={token?.light ?? token?.dark ?? literal}
                onChange={(picked: any) => onChange(rgbColorToCss(picked.rgb))}
                presetColors={presetColors}
              />
            </Paper>
          )}
        </Popper>
      </Box>
    </ClickAwayListener>
  )
}
GradientStopColor.displayName = 'AglynGradientStopColor'

export interface CssGradientProps extends BaseFieldProps {
  /** Swatches offered on the custom stage, same as the colour field. */
  presetColors?: string[]
  ColorPickerProps?: Partial<AglynColorPickerProps>
  FormFieldGridProps?: FormFieldGridProps
}

export const CssGradientField = (props: CssGradientProps) => {
  const {
    input,
    isReadOnly,
    isDisabled,
    label,
    helperText,
    description,
    validateOnMount,
    meta,
    help,
    presetColors,
    ColorPickerProps,
    FormFieldGridProps = {},
    // Free-text leftovers from an attribute schema that must never reach
    // the DOM.
    inputProps: _inputProps,
    InputProps: _InputProps,
    multiline: _multiline,
    placeholder: _placeholder,
    ...rest
  } = useFieldApi(props)
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const options = useColorPickerTokenOptions()
  const value = typeof input.value === 'string' ? input.value : ''
  const locked = Boolean(isDisabled || isReadOnly)

  const [draft, setDraft] = useState<GradientDraft>(() =>
    seedGradientDraft(value),
  )
  // Re-seed only when the value changed OUTSIDE this field (a different
  // node selected, an undo) — re-seeding from our own emits would fight
  // the caret in the angle and position boxes.
  const emittedRef = useRef(value)
  useEffect(() => {
    if (value === emittedRef.current) return
    emittedRef.current = value
    setDraft(seedGradientDraft(value))
  }, [value])

  const commit = useCallback(
    (next: GradientDraft) => {
      const serialized = serializeGradientDraft(next)
      emittedRef.current = serialized
      setDraft(next)
      input.onChange(serialized)
    },
    [input],
  )

  const handleFillChange = useCallback(
    (event: { target: { value: unknown } }) => {
      const fill = (event.target.value || 'solid') as GradientFillType
      if (fill === 'solid') {
        commit({ ...emptyDraft })
        return
      }
      // Switching INTO a gradient with nothing to show yet starts from the
      // brand ends, so the author sees a gradient immediately instead of an
      // empty stop list that serializes to nothing.
      const stops = draft.stops.length >= 2 ? draft.stops : defaultStops(options)
      const angle =
        fill === 'linear' ? draft.angle || `${DEFAULT_ANGLE}` : ''
      commit({ fill, angle, stops, raw: undefined })
    },
    [commit, draft.angle, draft.stops, options],
  )

  const handleAngleChange = useCallback(
    (event: { target: { value: string } }) => {
      commit({ ...draft, angle: event.target.value })
    },
    [commit, draft],
  )

  const handleStopColor = useCallback(
    (index: number) => (color: string) => {
      const stops = draft.stops.map((stop, i) =>
        i === index ? { ...stop, color } : stop,
      )
      commit({ ...draft, stops })
    },
    [commit, draft],
  )

  const handleStopPosition = useCallback(
    (index: number) =>
      (event: { target: { value: string } }) => {
        const text = event.target.value.trim()
        const position = text === '' ? undefined : Number(text)
        const stops = draft.stops.map((stop, i) =>
          i === index ? { ...stop, position } : stop,
        )
        commit({ ...draft, stops })
      },
    [commit, draft],
  )

  const handleAddStop = useCallback(() => {
    const last = draft.stops[draft.stops.length - 1]
    const previous = draft.stops[draft.stops.length - 2]
    const between =
      typeof last?.position === 'number' && typeof previous?.position === 'number'
        ? Math.round((last.position + previous.position) / 2)
        : undefined
    const stop: CssGradientStop = {
      color: last?.color ?? '#ffffff',
      position: between,
    }
    // The new stop lands BEFORE the last one when it can be positioned
    // between the two — the CTA's mid stop is that shape.
    const stops =
      between === undefined
        ? [...draft.stops, stop]
        : [...draft.stops.slice(0, -1), stop, last]
    commit({ ...draft, stops })
  }, [commit, draft])

  const handleRemoveStop = useCallback(
    (index: number) => () => {
      commit({ ...draft, stops: draft.stops.filter((_, i) => i !== index) })
    },
    [commit, draft],
  )

  const handleRawChange = useCallback(
    (event: { target: { value: string } }) => {
      const text = event.target.value
      // Edited back into a gradient this editor CAN model? Take the
      // structured controls back rather than stranding the author in the
      // text box (the css-dimension rule).
      const reseeded = seedGradientDraft(text)
      commit(reseeded.raw === undefined && text.trim() !== ''
        ? reseeded
        : { ...draft, raw: text })
    },
    [commit, draft],
  )

  const preview = useMemo(
    () => previewGradient(draft, options),
    [draft, options],
  )

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <MuiTextField
        {...rest}
        select
        fullWidth
        size="small"
        name={input.name}
        label={label}
        value={draft.raw !== undefined ? 'custom' : draft.fill}
        onChange={handleFillChange}
        disabled={locked || draft.raw !== undefined}
        error={!!invalid}
        helperText={
          invalid ||
          ((meta.touched || validateOnMount) && meta.warning) ||
          helperText ||
          description
        }
        slotProps={{ htmlInput: { 'aria-label': 'Fill type' } }}
      >
        <MenuItem value="solid">Solid color</MenuItem>
        <MenuItem value="linear">Linear gradient</MenuItem>
        <MenuItem value="radial">Radial gradient</MenuItem>
        {draft.raw !== undefined ? (
          <MenuItem value="custom">Custom CSS</MenuItem>
        ) : null}
      </MuiTextField>

      {draft.raw !== undefined ? (
        <>
          <MuiTextField
            fullWidth
            size="small"
            multiline
            label="Background image"
            value={draft.raw}
            onChange={handleRawChange}
            disabled={locked}
            sx={{ mt: 1 }}
            slotProps={{ htmlInput: { 'aria-label': 'Background image CSS' } }}
          />
          <FormHelperText>
            {'This background is richer than the stop editor can show — ' +
              'stacked layers, a conic gradient, a direction keyword. It is ' +
              'kept exactly as written; editing it back to a plain linear ' +
              'or radial gradient brings the controls back.'}
          </FormHelperText>
        </>
      ) : draft.fill === 'solid' ? null : (
        <>
          <Box
            aria-label="Gradient preview"
            sx={{
              mt: 1,
              height: 28,
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              backgroundImage: preview || 'none',
            }}
          />
          {draft.fill === 'linear' ? (
            <MuiTextField
              fullWidth
              size="small"
              type="number"
              label="Angle"
              value={draft.angle}
              onChange={handleAngleChange}
              disabled={locked}
              sx={{ mt: 1 }}
              slotProps={{
                htmlInput: { 'aria-label': 'Angle', inputMode: 'numeric' },
                input: { endAdornment: <Typography variant="caption">deg</Typography> },
              }}
            />
          ) : null}
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {draft.stops.map((stop, index) => (
              <Stack
                key={index}
                direction="row"
                spacing={0.5}
                sx={{ alignItems: 'center' }}
              >
                <GradientStopColor
                  color={stop.color}
                  label={`Stop ${index + 1} color`}
                  disabled={locked}
                  presetColors={presetColors}
                  ColorPickerProps={ColorPickerProps}
                  onChange={handleStopColor(index)}
                />
                <MuiTextField
                  size="small"
                  type="number"
                  value={stop.position ?? ''}
                  onChange={handleStopPosition(index)}
                  disabled={locked}
                  sx={{ width: 88 }}
                  slotProps={{
                    htmlInput: {
                      'aria-label': `Stop ${index + 1} position`,
                      inputMode: 'numeric',
                    },
                    input: {
                      endAdornment: (
                        <Typography variant="caption">%</Typography>
                      ),
                    },
                  }}
                />
                <IconButton
                  size="small"
                  aria-label={`Remove stop ${index + 1}`}
                  // A gradient needs two ends; the last two are not
                  // removable, so the control can never serialize to a
                  // value that silently clears the background.
                  disabled={locked || draft.stops.length <= 2}
                  onClick={handleRemoveStop(index)}
                >
                  {'×'}
                </IconButton>
              </Stack>
            ))}
          </Stack>
          <Button
            size="small"
            onClick={handleAddStop}
            disabled={locked}
            sx={{ mt: 0.5 }}
          >
            Add stop
          </Button>
        </>
      )}
    </FormFieldGrid>
  )
}

export default CssGradientField
