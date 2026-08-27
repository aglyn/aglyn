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

import { unstable_styleFunctionSx as styleFunctionSx } from '@mui/system'
import { createTheme } from '@mui/material/styles'
import { CSS_UNITS, CssUnit } from '@aglyn/shared-data-enums'

import { BESIGNER_DOCS_ANCHORS } from '../utils/docs-help.generated'
import { buildSpacingScaleOptions } from '../utils/theme-scale-options'
import {
  findSpacingStep,
  isSpacingSet,
  isThemeSpacingStep,
  spacingDescription,
  spacingDisplayText,
  UNIT_GLOSS,
  UNIT_GROUPS,
  unitDocsAnchor,
  UNITS_NOT_SPACING,
} from './spacing-value'

/**
 * The box styler's value rules (AGL-2486, item 5).
 *
 * Two claims carry the feature and both are checked against something
 * other than themselves: that a stored step is a NUMBER which MUI's own sx
 * pipeline resolves through `theme.spacing`, and that every unit the menu
 * offers points at a docs anchor the GENERATED registry really has.
 */
const theme = createTheme()
const steps = buildSpacingScaleOptions(theme as any)

const resolve = (sx: Record<string, unknown>) =>
  styleFunctionSx({ theme, sx }) as Record<string, unknown>

describe('a spacing step is stored as a number so it follows the theme', () => {
  it('resolves every offered step through MUI, and re-resolves when the theme changes', () => {
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) {
      // The value is the thing MUI multiplies — a number, never a string.
      expect(typeof step.value).toBe('number')
      expect(resolve({ marginTop: step.value }).marginTop).toBe(step.hint)
    }

    // The whole point: the SAME stored step means something different
    // under a retuned theme. A flattened '16px' could not do this.
    const dense = createTheme({ spacing: 4 })
    expect(
      styleFunctionSx({ theme: dense, sx: { marginTop: 2 } }) as any,
    ).toEqual({ marginTop: '8px' })
    expect(resolve({ marginTop: 2 }).marginTop).toBe('16px')
  })

  it('is not the same as a numeric STRING, which the browser drops', () => {
    // MUI multiplies numbers and passes strings through untouched, so
    // `'2'` would reach the page as `margin-top: 2` and be discarded.
    expect(resolve({ marginTop: '2' }).marginTop).toBe('2')
    expect(isThemeSpacingStep('2')).toBe(false)
    expect(isThemeSpacingStep(2)).toBe(true)
  })

  it('reads a host theme with its own spacing unit', () => {
    const dense = buildSpacingScaleOptions(createTheme({ spacing: 4 }) as any)
    const medium = dense.find((step) => step.label === 'Medium')
    expect(medium?.value).toBe(3)
    expect(medium?.hint).toBe('12px')
  })

  it('offers no ladder at all when the theme cannot resolve one', () => {
    expect(buildSpacingScaleOptions(undefined)).toEqual([])
    expect(buildSpacingScaleOptions({} as any)).toEqual([])
  })
})

describe('zero is a value, not the absence of one', () => {
  it('counts 0 as set — the trap strictNullChecks-off invites', () => {
    // `if (!value)` would fold this into "unset", hide it from the author
    // and lose it on the next write. It is the answer that cancels space
    // a parent or a preset put there.
    expect(isSpacingSet(0)).toBe(true)
    expect(isSpacingSet(undefined)).toBe(false)
    expect(isSpacingSet(null as any)).toBe(false)
    expect(isSpacingSet('')).toBe(false)
    expect(isSpacingSet('   ')).toBe(false)
    expect(isSpacingSet('0px')).toBe(true)
  })

  it('renders 0 as a measurement rather than as the empty state', () => {
    // '' is the diagram's cue to show the side's NAME instead, so a 0
    // that produced '' would read as "nothing set here".
    expect(spacingDisplayText(0, steps)).toBe('0px')
    expect(spacingDisplayText(undefined, steps)).toBe('')
    expect(resolve({ paddingTop: 0 }).paddingTop).toBe('0px')
  })

  it('keeps None on the ladder with the value 0', () => {
    const none = steps.find((step) => step.label === 'None')
    expect(none).toEqual({ value: 0, label: 'None', hint: '0px' })
    expect(findSpacingStep(0, steps)).toBe(none)
  })
})

describe('what a side shows', () => {
  it('shows a step resolved, and says it is theme-backed in the long form', () => {
    const medium = steps.find((step) => step.label === 'Medium')
    expect(spacingDisplayText(medium!.value, steps)).toBe(medium!.hint)
    expect(spacingDescription(medium!.value, steps)).toBe(
      `Medium (theme spacing) — ${medium!.hint}`,
    )
  })

  it('passes a custom amount through as written', () => {
    expect(spacingDisplayText('1.5rem', steps)).toBe('1.5rem')
    expect(spacingDisplayText('auto', steps)).toBe('auto')
    expect(spacingDescription('auto', steps)).toBe('auto')
    expect(spacingDescription(undefined, steps)).toBe('Not set')
  })

  it('resolves a step the ladder has no rung for, rather than showing 7x', () => {
    // `p: 10` is an ordinary thing to find on a hero and 10 is not a rung.
    // `10×` named the step but not the amount, so it could not be compared
    // with the `32px` sitting beside it in the same diagram.
    expect(spacingDisplayText(7, steps)).toBe('56px')
    expect(spacingDescription(7, steps)).toBe(
      '7× the theme spacing unit — 56px',
    )
  })

  it('falls back to the multiple when no ladder can resolve it', () => {
    expect(spacingDisplayText(7, [])).toBe('7×')
    expect(spacingDescription(7, [])).toBe('7× the theme spacing unit')
  })
})

describe('every unit is explained and linked (AGL-2486)', () => {
  const offered = UNIT_GROUPS.flatMap((group) => group.units)

  it('accounts for every unit the shared list has, exactly once', () => {
    // A unit added to CssUnit but neither grouped nor explicitly excluded
    // would be unreachable from this menu; one listed twice renders two
    // identical rows. Excluding by name rather than by omission is what
    // keeps this a check rather than a restatement.
    expect([...offered, ...UNITS_NOT_SPACING].sort()).toEqual(
      [...CSS_UNITS].sort(),
    )
    expect(new Set(offered).size).toBe(offered.length)
  })

  it('leaves resolution units out — dpi is not an amount of space', () => {
    expect(UNITS_NOT_SPACING).toContain(CssUnit.DPI)
    expect(offered).not.toContain(CssUnit.DPI)
  })

  it('gives every unit a plain-language gloss', () => {
    for (const unit of offered) {
      expect(`${UNIT_GLOSS[unit] ?? ''}`.length).toBeGreaterThan(0)
    }
  })

  it('points every unit at an anchor the GENERATED docs registry has', () => {
    // The claim is that these links land somewhere real. Checking them
    // against the generated anchor list — not a hand-written copy of it —
    // is what makes a renamed docs heading fail here.
    const anchors: readonly string[] =
      BESIGNER_DOCS_ANCHORS.responsiveStyling as readonly string[]
    for (const unit of offered) {
      expect(anchors).toContain(unitDocsAnchor(unit))
    }
  })

  it('gives each documented unit a section of its own, not the fallback', () => {
    expect(unitDocsAnchor(CssUnit.PIXELS)).toBe('#unit-px')
    expect(unitDocsAnchor(CssUnit.REM)).toBe('#unit-rem')
    expect(unitDocsAnchor(CssUnit.EM)).toBe('#unit-em')
    expect(unitDocsAnchor(CssUnit.PERCENT)).toBe('#unit-percent')
    expect(unitDocsAnchor(CssUnit.CH)).toBe('#unit-ch')
    expect(unitDocsAnchor(CssUnit.VIEWPORT_WIDTH)).toBe('#unit-viewport')
    expect(unitDocsAnchor(CssUnit.VIEWPORT_HEIGHT)).toBe('#unit-viewport')
    expect(unitDocsAnchor(CssUnit.SMALL_VIEWPORT_WIDTH)).toBe(
      '#unit-small-viewport',
    )
    expect(unitDocsAnchor(CssUnit.SMALL_VIEWPORT_HEIGHT)).toBe(
      '#unit-small-viewport',
    )
  })

  it('falls back rather than linking nowhere', () => {
    expect(unitDocsAnchor(CssUnit.PICAS)).toBe('#spacing-custom-amounts')
  })
})
