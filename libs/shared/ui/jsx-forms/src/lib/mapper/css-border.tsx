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
  InputAdornment,
  MenuItem,
  Select,
  TextField as MuiTextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, {
  buildFieldClear,
  type FormFieldGridProps,
} from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

/**
 * CssBorder (AGL-2486, Zach 2026-08-22): a thickness box plus a line-style
 * picker for anything holding a CSS border shorthand.
 *
 * This is not very friendly for
 * someone who does not know code. Every control in that group was a raw
 * shorthand text box — `Border` wanted you to type `1px solid`, the four
 * per-side fields wanted the same, and `Outline` wanted `2px solid`. A
 * border is two obvious choices (how thick, what kind of line) plus a
 * colour, and the panel was asking a mom-and-pop shop owner — one of
 * Aglyn's three stated ICPs — to memorise CSS shorthand grammar to make
 * them.
 *
 * **The persisted value is unchanged: still one CSS shorthand string**
 * (`"1px solid"`, `"2px dashed"`, `"none"`, `""`). This is purely an input
 * affordance, so renderers, published documents and existing nodes stay
 * untouched, and it composes with the responsive/scheme pipeline exactly as
 * the free-text box did.
 *
 * **Colour deliberately stays its own field.** MUI declares `border` with
 * `borderTransform`, which only turns a bare NUMBER into `${n}px solid` and
 * otherwise passes the string through verbatim — so a palette token inside
 * the shorthand would not resolve, and the panel's per-scheme colour scoping
 * (`SCHEME_SCOPED_STYLE_FIELDS`) is keyed on `borderColor`. Folding the
 * colour in here would have cost both. The group instead places Border
 * Color immediately beside this control so the three choices read as one
 * row.
 *
 * **The escape hatch is the same one `CssDimension` uses.** A value this
 * editor cannot model — `thin solid`, `1px solid #f00`, `calc()` in a
 * width, a `{{token}}` binding — falls back to a plain text box holding the
 * raw string rather than being clobbered, and flips back to the structured
 * controls the moment the text becomes a plain `<width> <style>` again. The
 * mode is DERIVED from the value, never remembered in a flag that can go
 * stale.
 */

/**
 * The line styles offered.
 *
 * `none` is on the list and is a real value, not the absence of one: it
 * removes a border a component or the theme is drawing, which is different
 * from clearing the field (that hands the decision back to the theme). The
 * long tail CSS also has — `groove`, `ridge`, `inset`, `outset` — is
 * deliberately absent: they are bevel effects nobody has asked for, and an
 * author who wants one still has the raw text box.
 */
export const CSS_BORDER_STYLES = [
  'solid',
  'dashed',
  'dotted',
  'double',
  'none',
] as const

export type CssBorderStyle = (typeof CSS_BORDER_STYLES)[number]

/** Plain-English name for each line style — no CSS vocabulary required. */
export const CSS_BORDER_STYLE_LABELS: Record<CssBorderStyle, string> = {
  solid: 'Solid line',
  dashed: 'Dashed line',
  dotted: 'Dotted line',
  double: 'Double line',
  none: 'No line',
}

/**
 * What the CLOSED picker shows, which is not what the menu shows.
 *
 * The picker is an `endAdornment` inside a half-width field, so its width
 * comes straight out of the box the author types the thickness into — and
 * out of the room the field's own label needs. "Dashed line" collides with
 * `Border Bottom`; "Dashed" does not. The menu, which has the whole popover
 * to itself, keeps the sentence.
 */
export const CSS_BORDER_STYLE_SHORT_LABELS: Record<CssBorderStyle, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
  double: 'Double',
  none: 'None',
}

/** Draft state: what the two controls show, before serialization. */
export interface BorderDraft {
  /** Thickness in pixels as typed (or the whole raw string in custom mode). */
  width: string
  /** Selected line style, `''` when none is chosen. */
  style: CssBorderStyle | ''
  /** The value is not `<width>px <style>` — the text box holds it verbatim. */
  custom: boolean
}

/** A bare pixel thickness: `1`, `1px`, `0.5px`. Units other than px are raw. */
const BORDER_WIDTH_PATTERN = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:px)?$/i

/**
 * Reads a stored shorthand into the two controls.
 *
 * Accepts exactly the shapes this editor can put back together — a pixel
 * width, a known style, or both in either CSS order — and marks everything
 * else `custom` so the raw text survives untouched. `0` is a legitimate
 * width (it is how an author removes a border while keeping its box), and
 * `strictNullChecks` is off repo-wide, so emptiness is spelled out rather
 * than left to a falsy test.
 */
export const seedBorderDraft = (value: unknown): BorderDraft => {
  // A bare NUMBER is what MUI's own `borderTransform` reads as `${n}px
  // solid`, so the controls must show exactly that rather than blanking.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { width: `${value}`, style: 'solid', custom: false }
  }
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return { width: '', style: '', custom: false }

  const parts = text.split(/\s+/)
  if (parts.length > 2) return { width: text, style: '', custom: true }

  let width = ''
  let style: CssBorderStyle | '' = ''
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (!style && (CSS_BORDER_STYLES as readonly string[]).includes(lower)) {
      style = lower as CssBorderStyle
      continue
    }
    const matched = BORDER_WIDTH_PATTERN.exec(part)
    if (width === '' && matched) {
      width = matched[1]
      continue
    }
    // Anything the pair cannot account for (a colour, `thin`, `2rem`)
    // makes the whole value raw — a partial parse would silently drop it.
    return { width: text, style: '', custom: true }
  }
  return { width, style, custom: false }
}

/**
 * Serializes the two controls back into one shorthand.
 *
 * `none` is the whole value — a width in front of it is meaningless CSS and
 * would read as a thickness the author cannot see the effect of.
 */
export const serializeBorderDraft = (draft: BorderDraft): string => {
  if (draft.custom) return draft.width
  if (draft.style === 'none') return 'none'
  const width = draft.width.trim()
  const parts: string[] = []
  if (width !== '') parts.push(`${width}px`)
  if (draft.style) parts.push(draft.style)
  return parts.join(' ')
}

export interface CssBorderProps extends BaseFieldProps {
  placeholder?: string
  /** Offer the reset-to-unset affordance (AGL-2486). */
  clearable?: boolean
  FormFieldGridProps?: FormFieldGridProps
}

export const CssBorderField = (props: CssBorderProps) => {
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
    clearable,
    FormFieldGridProps = {},
    // Free-text leftovers from the schema these fields were authored with
    // as TEXT_FIELDs; they must never reach the DOM.
    inputProps: _inputProps,
    InputProps: _InputProps,
    multiline: _multiline,
    type: _type,
    options: _options,
    ...rest
  } = useFieldApi(props)

  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const value =
    typeof input.value === 'number' ? `${input.value}` : `${input.value ?? ''}`

  const [draft, setDraft] = useState<BorderDraft>(() =>
    seedBorderDraft(input.value),
  )
  // Re-seed only when the value changed OUTSIDE this field (a different
  // node selected, an undo, a breakpoint switch). Re-seeding from our own
  // emits would round a half-typed decimal out from under the caret — the
  // same hazard `CssDimension` documents.
  const emittedRef = useRef(serializeBorderDraft(seedBorderDraft(input.value)))
  useEffect(() => {
    const incoming = `${input.value ?? ''}`
    if (incoming === emittedRef.current) return
    emittedRef.current = incoming
    setDraft(seedBorderDraft(input.value))
  }, [input.value])

  const commit = useCallback(
    (next: BorderDraft) => {
      const serialized = serializeBorderDraft(next)
      emittedRef.current = serialized
      // A raw value the author edited back into a plain `<width> <style>`
      // gets the structured controls back immediately, so the escape hatch
      // is never a one-way door.
      const reseeded = seedBorderDraft(serialized)
      setDraft(next.custom && !reseeded.custom ? reseeded : next)
      input.onChange(serialized)
    },
    [input],
  )

  const clear = buildFieldClear({
    clearable,
    label,
    hasValue: value !== '',
    locked: Boolean(isDisabled || isReadOnly),
    // Clearing drops the STYLE as well as the thickness. Emptying the
    // number alone would leave `solid` selected and the next keystroke
    // would silently re-adopt it, which is the trap AGL-2486 fixed for
    // lengths and units.
    onClear: () => commit({ width: '', style: '', custom: false }),
  })

  const handleWidthChange = useCallback(
    (event: { target: { value: string } }) => {
      const width = event.target.value
      // Typing a thickness with no line style yet means a solid line —
      // a bare `1px` draws nothing at all, which is the silent no-op that
      // made the free-text version feel broken.
      const style =
        !draft.custom && !draft.style && width.trim() !== ''
          ? ('solid' as CssBorderStyle)
          : draft.style
      commit({ ...draft, width, style })
    },
    [commit, draft],
  )

  const handleStyleChange = useCallback(
    (event: { target: { value: unknown } }) => {
      const style = (event.target.value || '') as CssBorderStyle | ''
      // "No line" IS the whole value, so the thickness goes away with it
      // and comes back when a drawn style is picked again.
      commit({
        ...draft,
        style,
        width: style === 'none' ? '' : draft.width,
      })
    },
    [commit, draft],
  )

  const noLine = !draft.custom && draft.style === 'none'

  const styleSelect = (
    <InputAdornment position="end" sx={{ ml: 0 }}>
      <Select
        value={draft.custom ? '' : draft.style}
        onChange={handleStyleChange}
        disabled={isDisabled || isReadOnly || draft.custom}
        variant="standard"
        disableUnderline
        // Without displayEmpty an unset style renders nothing at all, which
        // reads as a broken control rather than "no line chosen yet".
        displayEmpty
        renderValue={(selected) =>
          draft.custom
            ? 'custom'
            : selected
              ? CSS_BORDER_STYLE_SHORT_LABELS[selected as CssBorderStyle]
              : // An unset picker is one em-dash wide, exactly like the unit
                // picker on a length field. The words "line style" here read
                // as help but behave as layout: they push the adornment over
                // the field's own label on every per-side border.
                '—'
        }
        inputProps={{ 'aria-label': 'Line style' }}
        sx={{
          '& .MuiSelect-select': {
            pr: '20px !important',
            py: 0,
            textOverflow: 'ellipsis',
          },
          fontSize: '0.8125rem',
          color: 'text.secondary',
          minWidth: 0,
          maxWidth: 96,
        }}
      >
        <MenuItem value="">
          <em>{'not set'}</em>
        </MenuItem>
        {CSS_BORDER_STYLES.map((style) => (
          <MenuItem key={style} value={style}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                width: '100%',
              }}
            >
              {/* The line itself, drawn in the style it names — the whole
                  point of retiring the shorthand is that the choice can be
                  made by looking. */}
              <Box
                aria-hidden
                sx={{
                  width: 34,
                  flexShrink: 0,
                  borderTopWidth: style === 'double' ? 3 : 2,
                  borderTopStyle: style === 'none' ? 'solid' : style,
                  borderTopColor:
                    style === 'none' ? 'transparent' : 'text.primary',
                }}
              />
              <Typography variant="body2" noWrap>
                {CSS_BORDER_STYLE_LABELS[style]}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </Select>
    </InputAdornment>
  )

  return (
    <FormFieldGrid help={help} clear={clear} {...FormFieldGridProps}>
      <MuiTextField
        {...rest}
        name={input.name}
        value={noLine ? '' : draft.width}
        onChange={handleWidthChange}
        onBlur={input.onBlur}
        onFocus={input.onFocus}
        fullWidth
        error={!!invalid}
        helperText={
          invalid ||
          ((meta.touched || validateOnMount) && meta.warning) ||
          helperText ||
          description
        }
        disabled={isDisabled}
        label={label}
        placeholder={noLine ? 'no line' : placeholder}
        required={isRequired}
        type={draft.custom || noLine ? 'text' : 'number'}
        slotProps={{
          /**
           * The label is ALWAYS pinned above the box, never floating
           * inside it (AGL-2486, Zach 2026-08-22).
           *
           * Two reasons, and they point the same way. `Border Bottom` is
           * thirteen characters and the box is a half column with a
           * picker parked in its right-hand end, so an un-shrunk label
           * runs straight into the adornment — the overlap Zach reported
           * on the old panel, reappearing on the new control. And "No
           * line" is shown through the PLACEHOLDER, which MUI hides
           * behind CSS while the label is un-shrunk, so the field would
           * print its label over an empty box on a node that demonstrably
           * has a value.
           *
           * It also settles the group's rhythm: Border Color, Corner
           * Radius and Shadow all sit under a pinned label, so the six
           * border editors doing something different was the odd one out.
           */
          inputLabel: { shrink: true },
          input: {
            readOnly: isReadOnly || noLine,
            endAdornment: (
              <>
                {/* The unit is STATED, not asked for — that is the whole
                    point of retiring the shorthand. It is hidden in raw
                    mode, where the text is not a pixel thickness, and on
                    "no line", where there is no thickness at all. */}
                {/* The unit is only stated once there is a number to put it
                    after. On an empty field it is pure width, and width is
                    what pushes the label into the adornments. */}
                {draft.custom || noLine || draft.width.trim() === '' ? null : (
                  <InputAdornment
                    position="end"
                    sx={{
                      ml: 0,
                      mr: 0.5,
                      '& .MuiTypography-root': {
                        fontSize: '0.8125rem',
                        color: 'text.secondary',
                      },
                    }}
                  >
                    {'px'}
                  </InputAdornment>
                )}
                {styleSelect}
              </>
            ),
          },
          htmlInput: {
            inputMode: 'decimal',
            min: 0,
            step: 1,
            // The VALUE is never the control that gets squeezed: the style
            // picker is a fixed-width adornment sibling, so without a floor
            // the number box is whatever is left in a narrow docked panel.
            style: { minWidth: '4.5ch' },
            'aria-label':
              typeof label === 'string' ? `${label} thickness` : undefined,
          },
        }}
      />
    </FormFieldGrid>
  )
}
CssBorderField.displayName = 'AglynCssBorderField'

export default CssBorderField
