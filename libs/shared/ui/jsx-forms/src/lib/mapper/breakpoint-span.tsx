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
  buildBreakpointSpan,
  parseBreakpointSpan,
  SPAN_BREAKPOINTS,
  type SpanBreakpoint,
  type SpanValue,
} from '@aglyn/shared-data-enums'
import {
  Box,
  Button,
  FormHelperText,
  FormLabel,
  MenuItem,
  Select,
  TextField as MuiTextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'
import { type ExtendedFieldMeta, validationError } from './validation-error'

/**
 * BreakpointSpan (AGL-2486): the per-breakpoint editor for a MUI Grid cell's
 * **Span** and **Offset**.
 *
 * Both were free-text boxes taking a developer syntax — `xs:12 md:2` — with
 * the syntax explained only in a tooltip. Aglyn's authors are not reading the
 * MUI Grid docs, so the capability was there and unreachable: in practice a
 * cell got one number and never became responsive.
 *
 * The PERSISTED value is unchanged: still ONE string, still the same syntax,
 * parsed by the same shared pair the Grid element itself uses
 * (`parseBreakpointSpan`/`buildBreakpointSpan` in `@aglyn/shared-data-enums`).
 * This is an input affordance, not a shape change, so renderers, published
 * documents and existing nodes stay untouched — the same rule
 * {@link CssDimensionField} follows for CSS lengths.
 *
 * Two things the layout of this editor has to get right:
 *
 *  - A value authored with NO breakpoint (`"6"`) is a scalar and applies at
 *    every size. It is NOT the same string as `xs:6`, and MUI's prop is
 *    either a scalar or an object — never both. So the row leads with an
 *    **All** cell, and picking a breakpoint disables it (and vice versa)
 *    rather than silently dropping one of the two.
 *  - Anything this editor cannot model — a `{{token}}`, an unknown
 *    breakpoint, a span wider than the offered list — must NOT be clobbered.
 *    It falls back to a raw text box holding the string verbatim, and flips
 *    back to the controls the moment the text becomes modellable again. The
 *    same escape hatch is reachable on purpose (**Edit as text**) so the full
 *    syntax stays available to anyone who wants it.
 */

/** Draft state: what the row of controls shows, before serialization. */
export interface SpanDraft {
  /** The value is not modellable — the text box holds it verbatim. */
  custom: boolean
  /** Raw string, in custom mode only. */
  text: string
  /** The breakpoint-less value; `''` when unset. */
  base: string
  /** Per-breakpoint values as option strings; `''` when unset. */
  values: Record<SpanBreakpoint, string>
}

const emptyValues = (): Record<SpanBreakpoint, string> =>
  SPAN_BREAKPOINTS.reduce(
    (acc, key) => {
      acc[key] = ''
      return acc
    },
    {} as Record<SpanBreakpoint, string>,
  )

/** `''` is the only "unset"; `'0'` is a real offset an author can mean. */
const isSet = (value: string) => value !== '' && value !== undefined && value !== null

export const seedSpanDraft = (value: unknown): SpanDraft => {
  const parsed = parseBreakpointSpan(value as string | number)
  if (parsed.raw !== undefined) {
    return { custom: true, text: parsed.raw, base: '', values: emptyValues() }
  }
  const values = emptyValues()
  for (const key of SPAN_BREAKPOINTS) {
    const span = parsed.values?.[key]
    if (span !== undefined) values[key] = `${span}`
  }
  return {
    custom: false,
    text: '',
    base: parsed.base === undefined ? '' : `${parsed.base}`,
    values,
  }
}

/** `'auto'`/`'grow'` stay keywords; everything else is a number. */
const toSpanValue = (option: string): SpanValue =>
  option === 'auto' || option === 'grow' ? option : Number(option)

export const serializeSpanDraft = (draft: SpanDraft): string => {
  if (draft.custom) return draft.text
  if (isSet(draft.base)) return buildBreakpointSpan({ base: toSpanValue(draft.base) })
  const values: Partial<Record<SpanBreakpoint, SpanValue>> = {}
  for (const key of SPAN_BREAKPOINTS) {
    const option = draft.values[key]
    if (isSet(option)) values[key] = toSpanValue(option)
  }
  return Object.keys(values).length ? buildBreakpointSpan({ values }) : ''
}

export interface BreakpointSpanProps extends BaseFieldProps {
  /** Offer MUI's `grow` keyword. False for Offset, which has no `grow`. */
  allowGrow?: boolean
  /** Lowest column count offered. 0 for Offset, 1 for Span. */
  minSpan?: number
  /** Highest column count offered; the container's `columns` default. */
  maxSpan?: number
  FormFieldGridProps?: FormFieldGridProps
}

/** Human labels for the cells, in the order they are rendered. */
const CELL_LABELS: Record<SpanBreakpoint | 'base', string> = {
  base: 'All',
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
}

export const BreakpointSpanField = (props: BreakpointSpanProps) => {
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
    allowGrow = true,
    minSpan = 1,
    maxSpan = 12,
    FormFieldGridProps = {},
    // Leftovers from the attribute schema this field was authored with as a
    // TEXT_FIELD; they must never reach the DOM.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    inputProps: _inputProps,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    InputProps: _InputProps,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    multiline: _multiline,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type: _type,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    component: _component,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    tokenOptions: _tokenOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    tokenLabelContext: _tokenLabelContext,
    // Deliberately NOT spread onto the box below: the root here is a
    // `<fieldset>`, and a schema's leftover keys (`dataType`, `options`, …)
    // would land on the DOM as unknown attributes.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...rest
  } = useFieldApi(props)
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)

  // A value persisted as a bare NUMBER (`size: 6`) is still a value the
  // author has to see; reading only strings would blank the row and then
  // overwrite the number on the first edit.
  const value =
    input.value === undefined || input.value === null ? '' : `${input.value}`

  const [draft, setDraft] = useState<SpanDraft>(() => seedSpanDraft(value))
  // Re-seed only when the value changed OUTSIDE this field (a different node
  // selected, an undo). Re-seeding from our own emits would fight the
  // author's half-finished text in custom mode.
  const emittedRef = useRef(value)
  useEffect(() => {
    if (value === emittedRef.current) return
    emittedRef.current = value
    setDraft(seedSpanDraft(value))
  }, [value])

  const commit = useCallback(
    (next: SpanDraft) => {
      const serialized = serializeSpanDraft(next)
      emittedRef.current = serialized
      // Text the author edited back into a modellable span gets the
      // structured controls back immediately, so the mode stays DERIVED from
      // the value rather than remembered in a flag that can go stale.
      const reparsed = parseBreakpointSpan(serialized)
      setDraft(
        next.custom && serialized.trim() !== '' && reparsed.raw === undefined
          ? seedSpanDraft(serialized)
          : next,
      )
      input.onChange(serialized)
    },
    [input],
  )

  const anyBreakpointSet = SPAN_BREAKPOINTS.some((key) => isSet(draft.values[key]))
  const baseSet = isSet(draft.base)
  const locked = isDisabled || isReadOnly

  /**
   * The options a cell offers. A stored value the list does not carry — a
   * span wider than `maxSpan` because the container overrode `columns` — is
   * appended rather than dropped, so selecting nothing else cannot silently
   * rewrite it.
   */
  const optionsFor = useCallback(
    (current: string) => {
      const options: string[] = ['auto']
      if (allowGrow) options.push('grow')
      for (let span = minSpan; span <= maxSpan; span += 1) {
        options.push(`${span}`)
      }
      if (isSet(current) && !options.includes(current)) options.push(current)
      return options
    },
    [allowGrow, maxSpan, minSpan],
  )

  const cells = useMemo(
    () => [
      { key: 'base' as const, label: CELL_LABELS.base },
      ...SPAN_BREAKPOINTS.map((key) => ({ key, label: CELL_LABELS[key] })),
    ],
    [],
  )

  const handleCellChange = useCallback(
    (key: SpanBreakpoint | 'base', option: string) => {
      if (key === 'base') {
        commit({ ...draft, base: option })
        return
      }
      commit({ ...draft, values: { ...draft.values, [key]: option } })
    },
    [commit, draft],
  )

  const handleTextChange = useCallback(
    (event: { target: { value: string } }) => {
      commit({ ...draft, custom: true, text: event.target.value })
    },
    [commit, draft],
  )

  const toggleCustom = useCallback(() => {
    if (draft.custom) {
      // Back to the controls, seeded from whatever the text now says. Text
      // the controls cannot model keeps the text box (seedSpanDraft returns
      // custom), which is the honest answer rather than a silent wipe.
      setDraft(seedSpanDraft(draft.text))
      return
    }
    setDraft({ ...draft, custom: true, text: serializeSpanDraft(draft) })
  }, [draft])

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      {/* A plain box, NOT a FormControl: this field owns six inputs, and a
          FormControl parent both warns ("multiple InputBase components
          inside a FormControl") and pushes its own error/focus state into
          every one of them. Label and helper text are rendered directly and
          told their state instead. */}
      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <FormLabel
            component="legend"
            error={!!invalid}
            disabled={isDisabled}
            required={isRequired}
            sx={{ fontSize: '0.75rem' }}
          >
            {label}
          </FormLabel>
          <Button
            size="small"
            variant="text"
            onClick={toggleCustom}
            disabled={locked}
            sx={{ minWidth: 0, fontSize: '0.6875rem', px: 0.5 }}
          >
            {draft.custom ? 'Use breakpoints' : 'Edit as text'}
          </Button>
        </Box>

        {draft.custom ? (
          <MuiTextField
            name={input.name}
            value={draft.text}
            onChange={handleTextChange}
            onBlur={input.onBlur}
            onFocus={input.onFocus}
            size="small"
            fullWidth
            disabled={isDisabled}
            placeholder={(placeholder as string) ?? 'xs:12 md:6'}
            slotProps={{ input: { readOnly: isReadOnly } }}
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 0.75,
              mt: 0.5,
            }}
          >
            {cells.map(({ key, label: cellLabel }) => {
              const current = key === 'base' ? draft.base : draft.values[key]
              // MUI's prop is a scalar OR an object. Rather than dropping one
              // of the two at serialize time, the unusable half is visibly
              // out of play.
              const disabled =
                locked ||
                (key === 'base' ? anyBreakpointSet : baseSet)
              return (
                <Box key={key}>
                  <Typography
                    variant="caption"
                    component="label"
                    htmlFor={`${input.name}-${key}`}
                    sx={{
                      display: 'block',
                      color: 'text.secondary',
                      lineHeight: 1.4,
                    }}
                  >
                    {cellLabel}
                  </Typography>
                  <Select
                    id={`${input.name}-${key}`}
                    size="small"
                    fullWidth
                    displayEmpty
                    disabled={disabled}
                    value={current}
                    onChange={(event) =>
                      handleCellChange(key, `${event.target.value ?? ''}`)
                    }
                    onBlur={input.onBlur}
                    inputProps={{ 'aria-label': `${label} ${cellLabel}` }}
                    renderValue={(selected) =>
                      isSet(selected as string) ? (selected as string) : '—'
                    }
                    sx={{ '& .MuiSelect-select': { py: 0.5 } }}
                  >
                    <MenuItem value="">
                      <em>{'—'}</em>
                    </MenuItem>
                    {optionsFor(current).map((option) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ))}
                  </Select>
                </Box>
              )
            })}
          </Box>
        )}

        <FormHelperText error={!!invalid} disabled={isDisabled}>
          {invalid ||
            ((meta.touched || validateOnMount) && meta.warning) ||
            helperText ||
            description}
        </FormHelperText>
      </Box>
    </FormFieldGrid>
  )
}

export default BreakpointSpanField
