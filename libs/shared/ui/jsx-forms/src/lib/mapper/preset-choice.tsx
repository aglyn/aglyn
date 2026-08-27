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
  Box,
  MenuItem,
  TextField as MuiTextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, {
  buildFieldClear,
  type FormFieldGridProps,
} from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

/**
 * PresetChoice (AGL-2486): a named-preset picker with a raw escape hatch, for
 * the properties whose honest answer is "pick one of these five" but whose CSS
 * is a grammar.
 *
 * Three fields in the styles panel have that shape. Corner Radius as a text
 * box can only offer `8px, 50%, or a theme spacing number` — three value
 * systems in one helper line. A Shadow select with no escape hatch has to send
 * the author to the custom-CSS section for anything off the list. Font Family
 * as free text can advise "prefer theme typography" and give no way to act
 * on it.
 *
 * All three are built here as: **the theme's own answers first, then a short
 * list of plain-English presets, then Custom…** — and the preset shows what it
 * looks like rather than what to type.
 *
 * **The persisted value is whatever the property already stored** — a
 * number for the theme-multiple properties, a CSS string otherwise. This is
 * an input affordance, not a shape change.
 *
 * **A stored value that matches no preset opens the field in its custom
 * state showing that value**, so a hand-authored `box-shadow` or font stack
 * round-trips and keeps rendering. That is the rule for every editor in
 * this panel: the mode is DERIVED from the value, never remembered in a
 * flag, so an author who typed raw CSS last month is never told their value
 * is gone.
 */

/** One offered preset. */
export interface PresetChoiceOption {
  /**
   * The value STORED.
   *
   * A NUMBER where the property's bare number is a theme multiple —
   * `borderRadius: 2` renders 8px through `shape.borderRadius`, and the
   * string `'2'` would reach CSS as `border-radius: 2` and be dropped. The
   * panel's own `normalizeStyleValue` enforces the same rule one level up;
   * emitting the number here means it never has to rescue this field.
   */
  value: string | number
  /** The author's name for it (`Rounded`, `Soft shadow`, `Sans-serif`). */
  label: string
  /** What it resolves to in this theme today (`8px`, `system default`). */
  hint?: string
  /**
   * CSS the menu row renders ITSELF with, so the choice is made by looking
   * rather than by reading. See {@link PresetChoiceProps.previewKind}.
   */
  preview?: string
}

/** How a menu row shows what the preset does. */
export type PresetChoicePreview = 'none' | 'shadow' | 'radius' | 'font'

export interface PresetChoiceProps extends BaseFieldProps {
  choices?: PresetChoiceOption[]
  /**
   * What the preview swatch on each row demonstrates. `font` renders the
   * option's own label in that face — the only preview that tells a
   * non-developer anything about a font stack. `shadow` and `radius` draw a
   * small tile carrying the value.
   */
  previewKind?: PresetChoicePreview
  /** Label of the escape-hatch entry; defaults to `Custom…`. */
  customLabel?: string
  /** Helper shown while the raw text box is open. */
  customHelperText?: string
  placeholder?: string
  /** Offer the reset-to-unset affordance (AGL-2486). */
  clearable?: boolean
  FormFieldGridProps?: FormFieldGridProps
}

/** Sentinel for the escape-hatch entry. Never a stored value. */
export const PRESET_CHOICE_CUSTOM = '__custom__'

/** The text a stored value shows in the raw box. */
export const presetChoiceValueToText = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}` : ''
  return `${value}`
}

/**
 * The preset a stored value names, compared as TEXT.
 *
 * A stored `2` and an option whose value is the number `2` are the same
 * choice, and so are a stored `'50%'` and the string option — but the form
 * value round-trips through controls that can only hand back strings, so
 * comparing by identity would show "Custom" for a value the author picked
 * from this very menu one render ago.
 */
export const findPresetChoice = (
  choices: PresetChoiceOption[],
  value: unknown,
): PresetChoiceOption | undefined => {
  const text = presetChoiceValueToText(value)
  if (text === '') return undefined
  return choices.find(
    (choice) => presetChoiceValueToText(choice.value) === text,
  )
}

/** The swatch that shows what a preset does, or null when it shows nothing. */
const PresetPreview = (props: {
  kind: PresetChoicePreview
  option: PresetChoiceOption
}) => {
  const { kind, option } = props
  const preview = option.preview ?? presetChoiceValueToText(option.value)
  if (kind === 'none' || kind === 'font' || preview === '') return null
  return (
    <Box
      aria-hidden
      sx={{
        width: 26,
        height: 18,
        flexShrink: 0,
        // A neutral tile the effect is applied TO. `background.paper`
        // rather than a literal so the swatch stays legible in both
        // schemes — the console chrome is theme-aware here.
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        ...(kind === 'shadow'
          ? { boxShadow: preview === 'none' ? 'none' : preview }
          : { borderRadius: preview }),
      }}
    />
  )
}

export const PresetChoiceField = (props: PresetChoiceProps) => {
  const {
    input,
    isReadOnly,
    isDisabled,
    isRequired,
    label,
    placeholder,
    helperText,
    description,
    validateOnMount,
    meta,
    help,
    choices = [],
    previewKind = 'none',
    customLabel = 'Custom…',
    customHelperText,
    clearable,
    FormFieldGridProps = {},
    // Schema leftovers from the TEXT_FIELD/SELECT these were authored as.
    inputProps: _inputProps,
    InputProps: _InputProps,
    multiline: _multiline,
    type: _type,
    options: _options,
    ...rest
  } = useFieldApi(props)

  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const text = presetChoiceValueToText(input.value)
  const matched = findPresetChoice(choices, input.value)

  /**
   * The raw box is open because the AUTHOR asked for it.
   *
   * The other reason it opens — a stored value that matches no preset — is
   * DERIVED below rather than mirrored into this flag, and that distinction
   * is load-bearing. `choices` come from the site theme, which resolves
   * ASYNCHRONOUSLY: the styles panel mounts before `useHostThemeDocument`
   * answers, so on first render every preset list is empty and every stored
   * value "matches no preset". A remembered flag would latch that and every
   * preset field would sit in its custom state showing a raw `2` for the
   * rest of the session, with the real menu one render away and unreachable
   * — a mutation test caught exactly this.
   *
   * Deriving instead makes the control self-healing: the moment the theme
   * arrives and the value matches, the preset menu takes over on its own.
   * The flag is only ever set by a click on Custom…, and cleared by
   * choosing a preset or by clearing the field, so it can never disagree
   * with a value it did not cause.
   */
  const [customPicked, setCustomPicked] = useState(false)
  const custom = customPicked || (text !== '' && !matched)

  const commit = useCallback(
    (next: string | number) => {
      input.onChange(next)
    },
    [input],
  )

  const clear = buildFieldClear({
    clearable,
    label,
    hasValue: text !== '',
    locked: Boolean(isDisabled || isReadOnly),
    onClear: () => {
      setCustomPicked(false)
      commit('')
    },
  })

  const handleSelect = useCallback(
    (event: { target: { value: unknown } }) => {
      const picked = `${event.target.value ?? ''}`
      if (picked === PRESET_CHOICE_CUSTOM) {
        // Opening the raw box must NOT clear what is already there: the
        // commonest reason to open it is to tweak a preset by hand.
        setCustomPicked(true)
        return
      }
      setCustomPicked(false)
      const choice = choices.find(
        (entry) => presetChoiceValueToText(entry.value) === picked,
      )
      // The option's own `value` is emitted, not the select's string, so a
      // numeric preset stays a NUMBER and keeps its theme-multiple meaning.
      commit(choice ? choice.value : '')
    },
    [choices, commit],
  )

  const selectValue = custom
    ? PRESET_CHOICE_CUSTOM
    : matched
      ? presetChoiceValueToText(matched.value)
      : ''

  return (
    <FormFieldGrid help={help} clear={clear} {...FormFieldGridProps}>
      <MuiTextField
        {...rest}
        select
        name={custom ? `${input.name}-preset` : input.name}
        value={selectValue}
        onChange={handleSelect}
        fullWidth
        size="small"
        margin="dense"
        error={!!invalid && !custom}
        helperText={
          custom
            ? undefined
            : invalid ||
              ((meta.touched || validateOnMount) && meta.warning) ||
              // Naming what the preset resolves to is what makes it
              // checkable: `Rounded` means nothing until it says `8px`.
              (matched?.hint
                ? `${matched.label} — ${matched.hint}`
                : undefined) ||
              helperText ||
              description
        }
        disabled={isDisabled}
        label={label}
        required={isRequired}
        slotProps={{
          select: { displayEmpty: true },
          // `displayEmpty` renders "Not set" in the box while the value is
          // empty, and MUI only floats a label once it thinks there IS a
          // value — so the label sat ON the placeholder. Pinning it shrunk
          // is the documented pairing for `displayEmpty` and is the same
          // fix `CssDimension` carries for its keyword values (AGL-2486).
          inputLabel: { shrink: true },
        }}
      >
        <MenuItem value="">
          <em>{'Not set'}</em>
        </MenuItem>
        {choices.map((choice) => (
          <MenuItem
            key={presetChoiceValueToText(choice.value)}
            value={presetChoiceValueToText(choice.value)}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                width: '100%',
                minWidth: 0,
              }}
            >
              <PresetPreview kind={previewKind} option={choice} />
              <Typography
                variant="body2"
                noWrap
                sx={{
                  flexGrow: 1,
                  minWidth: 0,
                  // A font preset renders its own name in its own face —
                  // the only preview that says anything useful about a
                  // typeface to someone who cannot read a font stack.
                  ...(previewKind === 'font'
                    ? {
                        fontFamily:
                          choice.preview ??
                          presetChoiceValueToText(choice.value),
                      }
                    : {}),
                }}
              >
                {choice.label}
              </Typography>
              {choice.hint ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {choice.hint}
                </Typography>
              ) : null}
            </Box>
          </MenuItem>
        ))}
        <MenuItem value={PRESET_CHOICE_CUSTOM}>
          <em>{customLabel}</em>
        </MenuItem>
      </MuiTextField>
      {custom ? (
        <MuiTextField
          name={input.name}
          value={text}
          onChange={(event) => commit(event.target.value)}
          onBlur={input.onBlur}
          onFocus={input.onFocus}
          fullWidth
          size="small"
          margin="dense"
          error={!!invalid}
          helperText={
            invalid ||
            ((meta.touched || validateOnMount) && meta.warning) ||
            customHelperText ||
            helperText ||
            description
          }
          disabled={isDisabled}
          placeholder={placeholder}
          slotProps={{
            htmlInput: {
              readOnly: isReadOnly,
              // The visible label belongs to the SELECT — it names the
              // field — so the raw box needs an accessible name of its
              // own, or it is an unlabelled input that screen readers and
              // tests both read as anonymous. Qualified rather than
              // duplicated, because both are on screen at once.
              'aria-label':
                typeof label === 'string'
                  ? `${label} custom value`
                  : `${input.name} custom value`,
            },
          }}
        />
      ) : null}
    </FormFieldGrid>
  )
}
PresetChoiceField.displayName = 'AglynPresetChoiceField'

export default PresetChoiceField
