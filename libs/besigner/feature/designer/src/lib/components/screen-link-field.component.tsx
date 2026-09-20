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

import type * as Aglyn from '@aglyn/aglyn'
import {
  bareFragmentLinkWarning,
  formatScreenLinkValue,
  linkTargetKind,
  parseScreenLinkValue,
  resolveScreenHref,
  ScreenLinkContext,
  screenLinkTargetOptions,
  screenRoutesAnswerFor,
  unavailableScreenLabel,
  useLinkTargetLabel,
} from '@aglyn/aglyn'
import {
  EXTERNAL_URL_OPTION,
  LinkTargetAutocomplete,
  type LinkTargetChangeDetail,
  type LinkTargetChoice,
} from '@aglyn/aglyn-markdown-editor'
import {
  FormFieldGrid,
  type FormFieldGridProps,
  useFieldApi,
  validationError,
  type ExtendedFieldMeta,
} from '@aglyn/shared-ui-jsx-forms'
import { Stack, TextField } from '@mui/material'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * The picker's "type a URL instead" choice (AGL-1335) — UI-only and never
 * stored. Defined beside the shared lookup, which offers the same choice in
 * the markdown link dialog, and re-exported here where it was first needed.
 */
export { EXTERNAL_URL_OPTION }

/** Mapper key for {@link ScreenLinkField} in the attributes form. */
export const SCREEN_LINK_FIELD_COMPONENT = 'aglyn-screen-link-field'

/** The escape hatch the `Link` picker ends its list with. */
const EXTERNAL_CHOICE: readonly LinkTargetChoice[] = [
  { value: EXTERNAL_URL_OPTION, label: 'External URL or path…' },
]

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
  /** Whose default `defaultValue` is, in the empty option's words. */
  defaultOwner?: 'component' | 'layout'
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
 *
 * A search, not a list (AGL-3119): screens, listings and feeds narrow as the
 * author types, and a collection ENTRY is looked up through
 * `LinkTargetSearchContext` and stored as `entry:<collectionId>/<entryId>`,
 * so a renamed post keeps every link to it.
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
    defaultOwner = 'component',
    name,
    error,
  } = props
  const { screens, labels } = useContext(ScreenLinkContext)
  const screenId = parseScreenLinkValue(value)
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

  // Screens by name, then the site's collection listings (AGL-2799) and their
  // feeds — built by the same function as the attributes panel's Screen
  // picker.
  const options = useMemo(
    () => screenLinkTargetOptions(screens, labels, 'label'),
    [screens, labels],
  )

  // A stored id the routing map doesn't know still has to be selectable, or
  // opening the dialog would silently rewrite the author's link to "unset".
  // Not an entry: the map holds none, and the lookup names one by reading it.
  const unknownScreen =
    screenId &&
    linkTargetKind(screenId) !== 'entry' &&
    resolveScreenHref(screens, screenId) === undefined
      ? screenId
      : undefined

  const defaultScreen = defaultValue
    ? parseScreenLinkValue(defaultValue)
    : undefined
  // An entry default is named by the same lookup a picked entry is.
  const defaultEntry = useLinkTargetLabel(
    defaultScreen && linkTargetKind(defaultScreen) === 'entry'
      ? defaultScreen
      : undefined,
  )
  const describeDefault = () => {
    if (!defaultValue) return undefined
    if (!defaultScreen) return defaultValue
    if (defaultEntry) return defaultEntry.label
    return labels?.[defaultScreen] ?? screens?.[defaultScreen] ?? undefined
  }
  const described = describeDefault()
  const resolvedEmptyLabel =
    emptyLabel ??
    (described
      ? `Use the ${defaultOwner} default (${described})`
      : defaultValue
        ? `Use the ${defaultOwner} default`
        : 'Not set')
  // A default that is a screen reference is not a URL, so it must not be
  // offered as one in the text box.
  const urlPlaceholder =
    placeholder && !parseScreenLinkValue(placeholder)
      ? placeholder
      : 'https://example.com'

  const selectValue = external
    ? EXTERNAL_URL_OPTION
    : screenId
      ? screenId
      : ''

  const leading = useMemo<LinkTargetChoice[]>(
    () => [
      { value: '', label: resolvedEmptyLabel },
      ...(unknownScreen
        ? [
            {
              value: unknownScreen,
              // Wording shared with the plain Screen picker (AGL-1893): the
              // same condition told two different stories in two panels, and
              // "Unknown screen" reads as "we cannot look it up" rather than
              // "this link is dead". The value stays the bare id — the
              // handler re-wraps it through `formatScreenLinkValue`.
              label: unavailableScreenLabel(
                unknownScreen,
                screenRoutesAnswerFor(screens, unknownScreen),
              ),
            },
          ]
        : []),
    ],
    [resolvedEmptyLabel, unknownScreen, screens],
  )

  const handleSelect = useCallback(
    (next: string, detail: LinkTargetChangeDetail) => {
      if (next === EXTERNAL_URL_OPTION) {
        setExternal(true)
        // An address typed straight into the lookup is used as typed.
        // Otherwise keep whatever literal was already there — switching
        // modes back and forth must not eat a URL typed a moment ago.
        onChange(detail.address ?? literal)
        return
      }
      setExternal(false)
      onChange(next ? formatScreenLinkValue(next) : '')
    },
    [literal, onChange],
  )

  return (
    <Stack spacing={1} sx={{ width: '100%' }}>
      <LinkTargetAutocomplete
        name={name}
        label={label}
        size={size}
        value={selectValue}
        disabled={disabled}
        error={error}
        onChange={handleSelect}
        helperText={external ? undefined : helperText}
        targets={options}
        leading={leading}
        trailing={EXTERNAL_CHOICE}
        addressOption={EXTERNAL_URL_OPTION}
      />
      {external ? (
        <TextField
          size={size}
          value={literal}
          disabled={disabled}
          placeholder={urlPlaceholder}
          helperText={
            // A bare `#fragment` goes nowhere on the published page
            // (AGL-2867); saying so outranks the general note, and only a
            // validation error outranks it.
            (error ? helperText : bareFragmentLinkWarning(literal)) ??
            helperText ??
            'Typed addresses do not follow a screen rename.'
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
    propDefaultOwner,
    emptyLabel,
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
        defaultOwner={propDefaultOwner}
        emptyLabel={emptyLabel}
        disabled={isDisabled || isReadOnly}
        error={Boolean(invalid)}
        helperText={invalid || helperText || description}
      />
    </FormFieldGrid>
  )
}
ScreenLinkField.displayName = 'ScreenLinkField'

/** Mapper key for {@link ScreenTargetField}, the attributes panel's Screen picker. */
export const SCREEN_TARGET_FIELD_COMPONENT = 'aglyn-screen-target-field'

/**
 * The options `resolveAttributeField` built, sorted into the targets the
 * routing map holds — offered in groups, narrowed as the author types — and
 * the choices pinned above them: the empty one, and a stored target the host
 * no longer has. An entry is neither: the lookup names it by reading it.
 */
function splitScreenTargetOptions(
  options: unknown,
  screens: Aglyn.ScreenRouteMap | undefined,
): { leading: LinkTargetChoice[]; targets: LinkTargetChoice[] } {
  const leading: LinkTargetChoice[] = []
  const targets: LinkTargetChoice[] = []
  for (const option of Array.isArray(options) ? options : []) {
    const value = typeof option?.value === 'string' ? option.value : ''
    const choice = { value, label: String(option?.label ?? value) }
    if (value && linkTargetKind(value) === 'entry') continue
    if (value && resolveScreenHref(screens, value) !== undefined) {
      targets.push(choice)
    } else {
      leading.push(choice)
    }
  }
  return { leading, targets }
}

/**
 * The attributes panel's Screen picker (`SCREEN_SELECT`) as the lookup
 * (AGL-3119): the Screen Link's "Screen", the "Link to screen" of a Button and
 * an Image, the Link Container's target, an Accordion header's, a Form's
 * redirect, and each tab of a Tabs strip.
 *
 * It was a plain select over the routing map, which had no room for entries.
 * Its options are still the ones `resolveAttributeField` builds, so both
 * pickers offer one list; the value is stored exactly as the select stored it
 * — a bare screen id, or a listing's, feed's or entry's own key — and there is
 * no typed-address choice, because each of these elements carries its own
 * External URL field for that.
 */
export function ScreenTargetField(props: ScreenLinkFieldProps) {
  const {
    input,
    isDisabled,
    isReadOnly,
    label,
    helperText,
    description,
    validateOnMount,
    meta,
    help,
    options,
    FormFieldGridProps = {},
  } = useFieldApi(props as never) as Record<string, any>
  const { screens } = useContext(ScreenLinkContext)
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)
  const { leading, targets } = useMemo(
    () => splitScreenTargetOptions(options, screens),
    [options, screens],
  )
  const stored = typeof input.value === 'string' ? input.value.trim() : ''

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <LinkTargetAutocomplete
        name={input.name}
        value={stored}
        onChange={(next) => input.onChange(next)}
        targets={targets}
        leading={leading}
        label={label}
        disabled={isDisabled || isReadOnly}
        error={Boolean(invalid)}
        helperText={invalid || helperText || description}
      />
    </FormFieldGrid>
  )
}
ScreenTargetField.displayName = 'ScreenTargetField'

export default ScreenLinkField
