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
  buildCssMeasurement,
  CssUnit,
  isGlobalUnit,
  parseCssMeasurement,
} from '@aglyn/shared-data-enums'
import { HelpTip } from '@aglyn/shared-ui-jsx'
import {
  Box,
  Input,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'

import { besignerDocsUrl } from '../../utils/docs-help'
import type { SpacingScaleOption } from '../../utils/theme-scale-options'
import {
  type BoxSpacingValue,
  isSpacingSet,
  isThemeSpacingStep,
  UNIT_GLOSS,
  UNIT_GROUPS,
  unitDocsAnchor,
} from '../spacing-value'

/**
 * The editor behind one side of the box (AGL-2486, item 5).
 *
 * The control it replaces was a number box with a unit menu and nothing
 * else, so the only answer an author could give was a flattened CSS
 * length. Two consequences followed: the theme's spacing ladder was
 * unreachable from the one panel that most needs it, and a step an author
 * already had — every `Box`, `Paper` and section preset ships numeric
 * padding — read back as blank, because `parseCssMeasurement` rejects a
 * number outright.
 *
 * So the primary control is now the ladder, named in words rather than in
 * CSS, and a custom amount is the deliberate second choice rather than the
 * only one. Which mode is showing is DERIVED from the stored value (a
 * string is a custom amount, a number is a step) with a latch that only
 * ever opens custom mode — a remembered mode goes stale the moment the
 * selection moves to another element.
 */

/** The sentinel the select uses for "no value at all". */
const UNSET = '__unset__'
/** The sentinel that reveals the number + unit pair. */
const CUSTOM = '__custom__'

export interface SpacingEditorProps {
  /** The side's stored value: a theme step, a CSS string, or nothing. */
  value: BoxSpacingValue
  /** The theme's spacing ladder; empty leaves custom amounts only. */
  steps?: readonly SpacingScaleOption[]
  /** Accessible name for the pair, e.g. `Space inside — top`. */
  label: string
  /**
   * Emits the value to STORE.
   *
   * `undefined` means remove the property. A number is a theme step. A
   * string is a finished CSS length — never a bare number as a string,
   * which MUI would pass through and the browser would drop.
   */
  onChange?: (value: BoxSpacingValue) => void
}

export const SpacingEditor = (props: SpacingEditorProps) => {
  const { value, steps, label, onChange } = props
  const ladder = steps ?? []

  // A string value IS custom; the latch only adds the case where the
  // author asked for custom mode while the stored value is still a step.
  const [customLatch, setCustomLatch] = useState(false)
  const isCustom =
    customLatch || (isSpacingSet(value) && !isThemeSpacingStep(value))

  const parsed = useMemo(
    () => parseCssMeasurement(typeof value === 'string' ? value : undefined),
    [value],
  )

  const selectValue = isCustom
    ? CUSTOM
    : isThemeSpacingStep(value)
      ? `${value}`
      : UNSET

  const handleSelect = useCallback(
    (next: string) => {
      if (next === CUSTOM) {
        setCustomLatch(true)
        return
      }
      setCustomLatch(false)
      if (next === UNSET) {
        onChange?.(undefined)
        return
      }
      // The STEP, as a number — MUI multiplies it by `theme.spacing` at
      // render, which is the entire reason this control exists. `0` is a
      // real rung ("None") and must survive: `Number('0')` is 0 and
      // `Number.isFinite(0)` is true, so it does.
      const step = Number(next)
      onChange?.(Number.isFinite(step) ? step : undefined)
    },
    [onChange],
  )

  const emitCustom = useCallback(
    (quantity: string, unit: CssUnit | '') => {
      if (!unit) {
        // No unit is not a length. Clearing is the honest reading — the
        // old control silently emitted `undefined` here too, but by
        // accident rather than on purpose.
        onChange?.(undefined)
        return
      }
      if (isGlobalUnit(unit)) {
        onChange?.(`${unit}`)
        return
      }
      const text = `${quantity}`.trim()
      if (text === '') {
        onChange?.(undefined)
        return
      }
      const numeric = Number(text)
      if (!Number.isFinite(numeric)) {
        onChange?.(undefined)
        return
      }
      // `buildCssMeasurement` keeps `0` (its guard is `_isNum`, not
      // truthiness), so `0px` is emitted rather than swallowed.
      onChange?.(buildCssMeasurement({ value: numeric, unit }))
    },
    [onChange],
  )

  const currentUnit = (parsed?.unit ?? '') as CssUnit | ''
  const currentQuantity =
    parsed?.value === undefined || parsed?.value === null
      ? ''
      : `${parsed.value}`

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <Select
        size="small"
        value={selectValue}
        onChange={(event) => handleSelect(`${event.target.value}`)}
        inputProps={{ 'aria-label': `${label} value` }}
        sx={{ fontSize: '0.78rem' }}
      >
        <MenuItem value={UNSET}>
          <em>{'Not set'}</em>
        </MenuItem>
        {ladder.length ? (
          <ListSubheader sx={{ lineHeight: 2 }}>
            {'Theme spacing'}
          </ListSubheader>
        ) : null}
        {ladder.map((step) => (
          <MenuItem key={step.value} value={`${step.value}`}>
            <Box component="span" sx={{ flex: 1 }}>
              {step.label}
            </Box>
            <Typography
              component="span"
              variant="caption"
              sx={{ color: 'text.secondary', ml: 1 }}
            >
              {step.hint}
            </Typography>
          </MenuItem>
        ))}
        <ListSubheader sx={{ lineHeight: 2 }}>{'Exact amount'}</ListSubheader>
        <MenuItem value={CUSTOM}>{'Custom amount…'}</MenuItem>
      </Select>

      {isCustom ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Input
            value={currentQuantity}
            type="number"
            placeholder="0"
            disabled={
              Boolean(currentUnit) && isGlobalUnit(currentUnit as CssUnit)
            }
            inputProps={{ 'aria-label': `${label} amount` }}
            onChange={(event) =>
              emitCustom(event.target.value, currentUnit || CssUnit.PIXELS)
            }
            sx={{ width: 72, fontSize: '0.78rem' }}
          />
          <Select
            size="small"
            displayEmpty
            value={currentUnit}
            onChange={(event) =>
              emitCustom(currentQuantity, event.target.value as CssUnit | '')
            }
            inputProps={{ 'aria-label': `${label} unit` }}
            renderValue={(unit) => (unit ? `${unit}` : 'unit')}
            sx={{ fontSize: '0.78rem', minWidth: 88 }}
          >
            {UNIT_GROUPS.flatMap((group) => [
              <ListSubheader key={group.label} sx={{ lineHeight: 2 }}>
                {group.label}
              </ListSubheader>,
              ...group.units.map((unit) => (
                <MenuItem key={unit} value={unit}>
                  <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                    <Typography component="span" variant="body2">
                      {unit}
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: 'text.secondary', ml: 1 }}
                    >
                      {UNIT_GLOSS[unit]}
                    </Typography>
                  </Box>
                  {/* Every unit carries its own docs section (AGL-2486):
                      this menu is the one place an author meets the
                      question "what is `ch`?", so it is where the answer
                      has to be. `onClick` stops the tip from also
                      selecting the row it sits in. */}
                  <HelpTip
                    title={`The ${unit} unit`}
                    excerpt={UNIT_GLOSS[unit] ?? 'A CSS unit.'}
                    href={besignerDocsUrl(
                      'responsiveStyling',
                      unitDocsAnchor(unit),
                    )}
                    ariaLabel={`What is ${unit}?`}
                    onClick={(event) => event.stopPropagation()}
                    sx={{ ml: 1, fontSize: '0.9em' }}
                  />
                </MenuItem>
              )),
            ])}
          </Select>
          <HelpTip
            title="Steps or exact amounts"
            excerpt="A theme spacing step keeps following your theme; an exact amount is pinned forever. Units decide what the number is measured against."
            href={besignerDocsUrl('responsiveStyling', '#spacing-units')}
            sx={{ fontSize: '0.9em' }}
          />
        </Stack>
      ) : null}
    </Stack>
  )
}

export default SpacingEditor
