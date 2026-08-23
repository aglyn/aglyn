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

import { CssUnit } from '@aglyn/shared-data-enums'
import type { SpacingScaleOption } from '../utils/theme-scale-options'
import type { BesignerDocsAnchor } from '../utils/docs-help'

/**
 * The box styler's value logic (AGL-2486, item 5), kept apart from the
 * components so the rules can be asserted rather than described.
 *
 * A side of the box holds one of three things, and telling them apart is
 * the whole job:
 *
 * - a **theme spacing step**, stored as a NUMBER, which MUI resolves
 *   through `theme.spacing` at render (`2` → 16px under `spacing: 8`);
 * - a **custom amount**, stored as a CSS string (`'12px'`, `'2rem'`,
 *   `'auto'`);
 * - **nothing** — the property is absent and the element inherits.
 *
 * `0` belongs to the first group, not the third. It means "no space", it
 * renders as `0px`, and it is the value an author picks to cancel space a
 * parent or a preset put there. `strictNullChecks` is off repo-wide, so
 * every `if (!value)` in this file's neighbourhood would have silently
 * folded that answer into "unset" — hence the explicit predicates below.
 */

/** A box spacing value as STORED: a theme step, or a CSS string. */
export type BoxSpacingValue = string | number | undefined

/**
 * Whether the author has set this side at all.
 *
 * The one that matters: `isSpacingSet(0)` is TRUE. `0` is a decision, and
 * an editor that reads it as "unset" both hides it from the author and
 * loses it on the next write.
 */
export function isSpacingSet(value: BoxSpacingValue): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  return `${value}`.trim() !== ''
}

/**
 * Whether this value is a theme spacing step — the form that keeps
 * following the theme — rather than a flattened CSS string.
 *
 * A numeric STRING is deliberately not a step: MUI passes strings through
 * untouched, so `'2'` reaches the browser as `margin-top: 2` and is
 * dropped by the CSS parser. Only a real number is resolved.
 */
export function isThemeSpacingStep(value: BoxSpacingValue): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/** The ladder entry a stored value corresponds to, if any. */
export function findSpacingStep(
  value: BoxSpacingValue,
  steps: readonly SpacingScaleOption[],
): SpacingScaleOption | undefined {
  if (!isThemeSpacingStep(value)) return undefined
  return (steps ?? []).find((step) => step.value === value)
}

/**
 * The theme's spacing UNIT, inferred from the ladder itself.
 *
 * The ladder already carries the answer — a rung of 1 whose hint is `8px`
 * says the unit is 8 — so nothing extra has to be threaded through to
 * resolve a step that has no rung of its own. Returns 0 when the ladder
 * cannot say, which callers read as "cannot resolve".
 */
function spacingUnitOf(steps: readonly SpacingScaleOption[]): number {
  for (const step of steps ?? []) {
    if (!step || step.value === 0) continue
    const px = Number.parseFloat(`${step.hint}`)
    if (Number.isFinite(px) && `${step.hint}`.endsWith('px')) {
      const unit = px / step.value
      if (Number.isFinite(unit) && unit > 0) return unit
    }
  }
  return 0
}

/**
 * The compact text one side of the diagram shows — what the element
 * actually renders, so the diagram reads as a measurement rather than as a
 * vocabulary quiz. `''` when nothing is set, which is the caller's cue to
 * show the side's name instead.
 *
 * A step resolves to its hint (`16px`) so an author comparing two sides is
 * comparing like with like; which of them is theme-backed is carried by
 * the marker and the tooltip, not by making the numbers incomparable.
 */
export function spacingDisplayText(
  value: BoxSpacingValue,
  steps: readonly SpacingScaleOption[],
): string {
  if (!isSpacingSet(value)) return ''
  const step = findSpacingStep(value, steps)
  if (step) return step.hint
  // A number the current theme has no rung for is still a valid step, and
  // it is common — `p: 10` is an ordinary thing to find on a hero. It is
  // resolved through the theme's own unit rather than shown as `10×`,
  // which named the step but not the amount, and so could not be compared
  // with the `32px` sitting next to it.
  if (typeof value === 'number') {
    const unit = spacingUnitOf(steps)
    return unit ? `${Math.round(value * unit * 100) / 100}px` : `${value}×`
  }
  return `${value}`
}

/**
 * The long form used in tooltips and the editor's title, e.g.
 * `Medium (theme spacing) — 16px`. Names the theme connection explicitly,
 * because that is the property an author cannot see from the number.
 */
export function spacingDescription(
  value: BoxSpacingValue,
  steps: readonly SpacingScaleOption[],
): string {
  if (!isSpacingSet(value)) return 'Not set'
  const step = findSpacingStep(value, steps)
  if (step) return `${step.label} (theme spacing) — ${step.hint}`
  if (typeof value === 'number') {
    const unit = spacingUnitOf(steps)
    const resolved = unit ? ` — ${Math.round(value * unit * 100) / 100}px` : ''
    return `${value}× the theme spacing unit${resolved}`
  }
  return `${value}`
}

/* ── Units ────────────────────────────────────────────────────────────── */

/** How the unit menu groups itself, so a long list stays readable. */
export const UNIT_GROUPS: ReadonlyArray<{
  label: string
  units: readonly CssUnit[]
}> = [
  {
    label: 'Common',
    units: [CssUnit.PIXELS, CssUnit.REM, CssUnit.EM, CssUnit.PERCENT],
  },
  { label: 'Relative to text', units: [CssUnit.CH] },
  {
    label: 'Relative to the screen',
    units: [
      CssUnit.VIEWPORT_WIDTH,
      CssUnit.VIEWPORT_HEIGHT,
      CssUnit.SMALL_VIEWPORT_WIDTH,
      CssUnit.SMALL_VIEWPORT_HEIGHT,
      CssUnit.LARGE_VIEWPORT_WIDTH,
      CssUnit.LARGE_VIEWPORT_HEIGHT,
      CssUnit.DYNAMIC_VIEWPORT_WIDTH,
      CssUnit.DYNAMIC_VIEWPORT_HEIGHT,
      CssUnit.VIEWPORT_MIN,
      CssUnit.VIEWPORT_MAX,
    ],
  },
  {
    label: 'Keywords',
    units: [CssUnit.AUTO, CssUnit.INHERIT, CssUnit.INITIAL, CssUnit.UNSET],
  },
  {
    label: 'Print',
    units: [
      CssUnit.POINTS,
      CssUnit.PICAS,
      CssUnit.MILLIMETERS,
      CssUnit.CENTIMETERS,
      CssUnit.INCHES,
    ],
  },
]

/**
 * Units in the shared list that are NOT lengths, and so are never offered
 * as an amount of space.
 *
 * `dpi` is a resolution — it answers "how dense are the dots?", not "how
 * far?" — and `margin-top: 2dpi` is not a thing. It is named here rather
 * than quietly left out so the coverage check below stays a real check:
 * a unit added to `CssUnit` and forgotten still fails.
 */
export const UNITS_NOT_SPACING: readonly CssUnit[] = [CssUnit.DPI]

/**
 * The plain-language gloss shown beside each unit in the menu — the
 * one-line version of what the docs page explains at length.
 */
export const UNIT_GLOSS: Partial<Record<CssUnit, string>> = {
  [CssUnit.PIXELS]: 'a fixed dot on screen',
  [CssUnit.REM]: "multiples of the page's base text size",
  [CssUnit.EM]: "multiples of THIS element's text size",
  [CssUnit.PERCENT]: "a share of the parent's width",
  [CssUnit.CH]: 'the width of one character',
  [CssUnit.VIEWPORT_WIDTH]: '1% of the window width',
  [CssUnit.VIEWPORT_HEIGHT]: '1% of the window height',
  [CssUnit.SMALL_VIEWPORT_WIDTH]: 'window width at its smallest',
  [CssUnit.SMALL_VIEWPORT_HEIGHT]: 'window height with the address bar showing',
  [CssUnit.LARGE_VIEWPORT_WIDTH]: 'window width at its largest',
  [CssUnit.LARGE_VIEWPORT_HEIGHT]: 'window height with the address bar hidden',
  [CssUnit.DYNAMIC_VIEWPORT_WIDTH]: 'window width right now',
  [CssUnit.DYNAMIC_VIEWPORT_HEIGHT]: 'window height right now',
  [CssUnit.VIEWPORT_MIN]: 'the smaller of the two window sides',
  [CssUnit.VIEWPORT_MAX]: 'the larger of the two window sides',
  [CssUnit.AUTO]: 'let the browser decide',
  [CssUnit.INHERIT]: 'take the parent’s value',
  [CssUnit.INITIAL]: "back to CSS's own default",
  [CssUnit.UNSET]: 'inherit, or reset if it cannot',
  [CssUnit.POINTS]: 'points, as in print',
  [CssUnit.PICAS]: 'picas (12 points)',
  [CssUnit.MILLIMETERS]: 'millimetres, for print',
  [CssUnit.CENTIMETERS]: 'centimetres, for print',
  [CssUnit.INCHES]: 'inches, for print',
}

type ResponsiveStylingAnchor = BesignerDocsAnchor<'responsiveStyling'>

/**
 * Which section of the responsive-styling page explains a unit
 * (AGL-2486, item 5).
 *
 * Typed against the page's REAL heading anchors, so renaming a docs
 * heading turns this map into a compile error rather than a dead link —
 * which is the point of the generated registry.
 */
const UNIT_ANCHORS: Partial<Record<CssUnit, ResponsiveStylingAnchor>> = {
  [CssUnit.PIXELS]: '#unit-px',
  [CssUnit.REM]: '#unit-rem',
  [CssUnit.EM]: '#unit-em',
  [CssUnit.PERCENT]: '#unit-percent',
  [CssUnit.CH]: '#unit-ch',
  [CssUnit.VIEWPORT_WIDTH]: '#unit-viewport',
  [CssUnit.VIEWPORT_HEIGHT]: '#unit-viewport',
  [CssUnit.VIEWPORT_MIN]: '#unit-viewport',
  [CssUnit.VIEWPORT_MAX]: '#unit-viewport',
  [CssUnit.SMALL_VIEWPORT_WIDTH]: '#unit-small-viewport',
  [CssUnit.SMALL_VIEWPORT_HEIGHT]: '#unit-small-viewport',
  [CssUnit.LARGE_VIEWPORT_WIDTH]: '#unit-small-viewport',
  [CssUnit.LARGE_VIEWPORT_HEIGHT]: '#unit-small-viewport',
  [CssUnit.DYNAMIC_VIEWPORT_WIDTH]: '#unit-small-viewport',
  [CssUnit.DYNAMIC_VIEWPORT_HEIGHT]: '#unit-small-viewport',
}

/**
 * The docs anchor for a unit. Units with no section of their own fall back
 * to the custom-amounts section, so every entry in the menu has somewhere
 * to send an author who does not recognise it.
 */
export function unitDocsAnchor(unit: CssUnit): ResponsiveStylingAnchor {
  return UNIT_ANCHORS[unit] ?? '#spacing-custom-amounts'
}
