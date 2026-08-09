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

import * as Aglyn from '@aglyn/aglyn'
import {
  FormFieldGrid,
  type FormFieldGridProps,
  useFieldApi,
  validationError,
  type ExtendedFieldMeta,
} from '@aglyn/shared-ui-jsx-forms'
import { MenuItem, Stack, TextField } from '@mui/material'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Select value standing for "type a URL instead" (AGL-1335).
 *
 * UI-only: it is never stored. The persisted value in that mode is the URL
 * the author types, so the AGL-1191 rule about `''`-valued options does not
 * bite here — the one `''` option means genuinely unset, which is exactly
 * what the graft reads as "fall back to the component's default".
 *
 * Spelled with a character no Firestore id contains so it can never collide
 * with a real screen id in the same list.
 */
export const EXTERNAL_URL_OPTION = 'external-url:'

/** Mapper key for {@link ScreenLinkField} in the attributes form. */
export const SCREEN_LINK_FIELD_COMPONENT = 'aglyn-screen-link-field'

export interface ScreenLinkValuePickerProps {
  /** Stored value: `screen:<id>`, a literal href, or empty. */
  value?: string
  onChange: (next: string) => void
  label?: ReactNode
  helperText?: ReactNode
  /** Placeholder for the URL box — the component's default, where set. */
  placeholder?: string
  disabled?: boolean
  size?: 'small' | 'medium'
  /** Label on the "unset" option; the wording differs per surface. */
  emptyLabel?: string
  /**
   * The component default this field falls back to when left unset — named
   * on the empty option so "not set" says what the page will actually
   * render. A screen reference is resolved to the screen's NAME here: the
   * stored `screen:9aXk…` is not a sentence anyone can act on.
   */
  defaultValue?: string
  name?: string
  error?: boolean
}

/**
 * The screen picker a `Link`-typed value is authored with (AGL-1335) — a
 * screen list with an external-URL escape hatch, controlled and free of the
 * form stack so BOTH ends can use the same control: the component's
 * Properties dialog (its `Default` cell) and the instance Attributes panel.
 *
 * Two ends mattering is the whole point of the issue. `Link` used to be a
 * plain text box in both places, so a prop-driven CTA stored a hardcoded
 * path and broke silently when the target screen was renamed — a regression
 * against the Button's own `Link to screen` field (AGL-139) that the prop
 * replaced. A picked screen stores `screen:<id>` and resolves through the
 * published routing map at render, exactly like that field.
 *
 * The screen list comes from {@link Aglyn.ScreenLinkContext} — the same map
 * the canvas resolves hrefs against, so the picker can never offer a screen
 * the renderer would not resolve. A value the map does not know (a screen
 * deleted since, or a component opened before the map loads) is kept and
 * shown rather than silently reset to "not set".
 */
export function ScreenLinkValuePicker(props: ScreenLinkValuePickerProps) {
  const {
    value,
    onChange,
    label,
    helperText,
    placeholder,
    disabled,
    size = 'small',
    emptyLabel,
    defaultValue,
    name,
    error,
  } = props
  const { screens, labels } = useContext(Aglyn.ScreenLinkContext)
  const screenId = Aglyn.parseScreenLinkValue(value)
  const literal = screenId ? '' : (value ?? '')

  // Mode is remembered, not derived, for one reason: choosing "External
  // URL" leaves the value empty until something is typed, and a derived
  // mode would snap the box shut under the author's cursor. It re-syncs
  // whenever a value arrives from OUTSIDE (a different instance selected,
  // an undo), which is what keeps a remembered flag from going stale.
  const [external, setExternal] = useState(() => !screenId && Boolean(literal))
  useEffect(() => {
    if (screenId) setExternal(false)
    else if (literal) setExternal(true)
  }, [screenId, literal])

  const options = useMemo(
    () =>
      Object.entries(screens ?? {})
        .map(([id, path]) => ({
          id,
          label: `${labels?.[id] ?? id} (${path === '/' ? '/' : `/${path}`})`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [screens, labels],
  )

  // A stored id the routing map doesn't know still has to be selectable, or
  // opening the dialog would silently rewrite the author's link to "unset".
  const unknownScreen = screenId && !screens?.[screenId] ? screenId : undefined

  const describeDefault = () => {
    if (!defaultValue) return undefined
    const defaultScreen = Aglyn.parseScreenLinkValue(defaultValue)
    if (!defaultScreen) return defaultValue
    return labels?.[defaultScreen] ?? screens?.[defaultScreen] ?? undefined
  }
  const described = describeDefault()
  const resolvedEmptyLabel =
    emptyLabel ??
    (described
      ? `Use the component default (${described})`
      : defaultValue
        ? 'Use the component default'
        : 'Not set')
  // A default that is a screen reference is not a URL, so it must not be
  // offered as one in the text box.
  const urlPlaceholder =
    placeholder && !Aglyn.parseScreenLinkValue(placeholder)
      ? placeholder
      : 'https://example.com'

  const selectValue = external
    ? EXTERNAL_URL_OPTION
    : screenId
      ? screenId
      : ''

  const handleSelect = useCallback(
    (event: { target: { value: unknown } }) => {
      const next = String(event.target.value ?? '')
      if (next === EXTERNAL_URL_OPTION) {
        setExternal(true)
        // Keep whatever literal was already there — switching modes back
        // and forth must not eat a URL that was typed a moment ago.
        onChange(literal)
        return
      }
      setExternal(false)
      onChange(next ? Aglyn.formatScreenLinkValue(next) : '')
    },
    [literal, onChange],
  )

  return (
    <Stack spacing={1} sx={{ width: '100%' }}>
      <TextField
        select
        name={name}
        label={label}
        size={size}
        value={selectValue}
        disabled={disabled}
        error={error}
        onChange={handleSelect}
        helperText={external ? undefined : helperText}
        fullWidth
        // Without displayEmpty a MUI Select renders NOTHING for `''`, which
        // reads as a broken control rather than "no screen chosen".
        slotProps={{ select: { displayEmpty: true } }}
      >
        <MenuItem value="">{resolvedEmptyLabel}</MenuItem>
        {unknownScreen ? (
          <MenuItem value={unknownScreen}>
            {`Unknown screen (${unknownScreen})`}
          </MenuItem>
        ) : null}
        {options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
        <MenuItem value={EXTERNAL_URL_OPTION}>
          {'External URL or path…'}
        </MenuItem>
      </TextField>
      {external ? (
        <TextField
          size={size}
          value={literal}
          disabled={disabled}
          placeholder={urlPlaceholder}
          helperText={
            helperText ?? 'Typed addresses do not follow a screen rename.'
          }
          onChange={(event) => onChange(event.target.value)}
          fullWidth
          slotProps={{ htmlInput: { 'aria-label': 'External URL' } }}
        />
      ) : null}
    </Stack>
  )
}
ScreenLinkValuePicker.displayName = 'ScreenLinkValuePicker'

export interface ScreenLinkFieldProps {
  [key: string]: unknown
  placeholder?: string
  FormFieldGridProps?: FormFieldGridProps
}

/**
 * The data-driven-forms adapter for {@link ScreenLinkValuePicker}, registered
 * as {@link SCREEN_LINK_FIELD_COMPONENT} in the attributes mapper so a
 * `Link`-typed instance prop edits with the picker instead of a text box
 * (AGL-1335).
 *
 * The stored string flows through react-final-form exactly like the text
 * field it replaces, so the debounced autosave commits it through the
 * existing path with nothing new to teach it.
 */
export function ScreenLinkField(props: ScreenLinkFieldProps) {
  const {
    input,
    isDisabled,
    isReadOnly,
    label,
    placeholder,
    helperText,
    description,
    validateOnMount,
    meta,
    help,
    propDefault,
    FormFieldGridProps = {},
    // Nothing is spread onto the controls below, so free-text leftovers
    // from a schema authored as a TEXT_FIELD (`multiline`, `inputProps`,
    // the token-picker inputs) are simply never read — they cannot reach
    // the select the way they would through a `{...rest}`.
  } = useFieldApi(props as never) as Record<string, any>
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <ScreenLinkValuePicker
        name={input.name}
        value={input.value ?? ''}
        onChange={input.onChange}
        label={label}
        placeholder={placeholder}
        defaultValue={propDefault}
        disabled={isDisabled || isReadOnly}
        error={Boolean(invalid)}
        helperText={invalid || helperText || description}
      />
    </FormFieldGrid>
  )
}
ScreenLinkField.displayName = 'ScreenLinkField'

export default ScreenLinkField
