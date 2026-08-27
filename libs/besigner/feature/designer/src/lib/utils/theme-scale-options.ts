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

import type {
  PresetChoiceOption,
  ThemeScaleOption,
} from '@aglyn/shared-ui-jsx-forms'

/**
 * The theme scales the styles panel offers for Font Size, Font Weight and
 * Z-Index (AGL-2486, item 12).
 *
 * Every option's `value` is a token path MUI's sx system resolves ITSELF —
 * `fontSize` and `fontWeight` are declared with `themeKey: 'typography'` and
 * `zIndex` with `themeKey: 'zIndex'`, so `h4.fontSize`, `fontWeightBold` and
 * `appBar` behave exactly like `color: 'primary.main'` does. Nothing new has
 * to resolve them and nothing downstream has to know these lists exist: the
 * panel stores a string, the theme turns it into a number.
 *
 * They are built from the SITE theme rather than hardcoded, so a host that
 * has retuned its type scale or added a z-index layer offers its own values,
 * and the `hint` on each option is read out of that theme too — which is the
 * only thing that makes `h4.fontSize` legible to an author.
 */

/** The subset of a theme these builders read. */
export interface ThemeScaleSource {
  typography?: Record<string, unknown>
  zIndex?: Record<string, unknown>
  /** A created theme exposes `spacing` as a FUNCTION (`spacing(2)` →
   * `'16px'`); raw theme options carry the bare unit number. Both are
   * accepted because both reach these builders. */
  spacing?: ((factor: number) => string | number) | number
  /** `shape.borderRadius` — the unit a bare `borderRadius` number multiplies. */
  shape?: { borderRadius?: number | string }
  /** `theme.shadows`, MUI's 25-entry elevation ladder. */
  shadows?: ReadonlyArray<string>
}

/** `mobileStepper` → `Mobile stepper`. */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** What a theme value reads as in the hint, or '' when it is not a scalar. */
function hintOf(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}` : ''
  return typeof value === 'string' ? value : ''
}

/**
 * The typography variants offered as font sizes, in the order a type scale
 * is read rather than alphabetically. A variant the theme does not define —
 * or defines without a `fontSize` — is dropped, so a slimmed-down host theme
 * offers only what it really has.
 */
const FONT_SIZE_VARIANTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'h1', label: 'Heading 1' },
  { key: 'h2', label: 'Heading 2' },
  { key: 'h3', label: 'Heading 3' },
  { key: 'h4', label: 'Heading 4' },
  { key: 'h5', label: 'Heading 5' },
  { key: 'h6', label: 'Heading 6' },
  { key: 'subtitle1', label: 'Subtitle 1' },
  { key: 'subtitle2', label: 'Subtitle 2' },
  { key: 'body1', label: 'Body' },
  { key: 'body2', label: 'Body small' },
  { key: 'button', label: 'Button' },
  { key: 'caption', label: 'Caption' },
  { key: 'overline', label: 'Overline' },
]

/**
 * Every variant the theme defines, not just the ones MUI ships (AGL-2486).
 *
 * The list above names MUI's own variants in reading order; a host that adds
 * rungs of its own — Aglyn's theme carries `lede`, `bodyCompact` and `micro`
 * for the 17/13/11px steps MUI has no name for — is unreachable from a fixed
 * list, which leaves an author typing the pixels. Discovering the extras keeps
 * the curated order for the familiar ones and appends whatever else the host
 * defined, sorted small to large so the ramp still reads.
 *
 * A variant is anything under `theme.typography` that is an OBJECT carrying a
 * `fontSize`; that skips `fontFamily`, the `fontWeight*` scalars and
 * `pxToRem` without naming them.
 */
function themeTypographyVariants(
  typography: Record<string, unknown> | undefined,
): Array<{ key: string; label: string }> {
  if (!typography) return []
  const known = new Set(FONT_SIZE_VARIANTS.map((entry) => entry.key))
  const extra: Array<{ key: string; label: string; size: number }> = []
  for (const key of Object.keys(typography)) {
    if (known.has(key)) continue
    const value = typography[key]
    if (!value || typeof value !== 'object') continue
    const size = (value as Record<string, unknown>).fontSize
    const parsed = Number.parseFloat(String(size ?? ''))
    if (!Number.isFinite(parsed)) continue
    extra.push({ key, label: humanizeKey(key), size: parsed })
  }
  extra.sort((a, b) => a.size - b.size)
  return [...FONT_SIZE_VARIANTS, ...extra.map(({ key, label }) => ({ key, label }))]
}

/** Font sizes from `theme.typography`, e.g. `h4.fontSize` → `2.125rem`. */
export function buildFontSizeScaleOptions(
  theme: ThemeScaleSource | undefined,
): ThemeScaleOption[] {
  const typography = theme?.typography
  if (!typography) return []
  const options: ThemeScaleOption[] = []
  for (const { key, label } of themeTypographyVariants(typography)) {
    const variant = typography[key]
    if (!variant || typeof variant !== 'object') continue
    const fontSize = (variant as Record<string, unknown>)['fontSize']
    const hint = hintOf(fontSize)
    if (!hint) continue
    options.push({ value: `${key}.fontSize`, label, hint })
  }
  return options
}

/**
 * The four weights MUI's typography names, then the plain CSS ladder.
 *
 * Both halves are offered because both are real answers: `fontWeightBold`
 * follows a host that decides its bold is 600, while `700` is what an author
 * who wants exactly 700 means. The token entries come first so the
 * theme-following answer is the one in reach.
 */
/**
 * Weight tokens are DISCOVERED, not listed (AGL-2486).
 *
 * Hardcoding MUI's four defaults would hide every weight a host adds to its
 * own ramp — Aglyn's theme carries SemiBold 600, ExtraBold 800 and Black 900 —
 * leaving a raw number as the only way to reach the brand's own weight.
 * Reading the keys off `theme.typography` means any host's ramp shows up with
 * no edit here.
 *
 * Ordered by the weight each resolves to, so the menu reads light → heavy
 * rather than in whatever order the theme object happened to be written.
 */
const FONT_WEIGHT_KEY = /^fontWeight(.+)$/

function themeFontWeightTokens(
  typography: Record<string, unknown> | undefined,
): Array<{ key: string; label: string; weight: number }> {
  if (!typography) return []
  const found: Array<{ key: string; label: string; weight: number }> = []
  for (const key of Object.keys(typography)) {
    const match = FONT_WEIGHT_KEY.exec(key)
    if (!match) continue
    const raw = typography[key]
    const weight =
      typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''))
    if (!Number.isFinite(weight)) continue
    found.push({ key, label: `${humanizeKey(match[1])} (theme)`, weight })
  }
  return found.sort((a, b) => a.weight - b.weight)
}

const FONT_WEIGHT_LADDER: ReadonlyArray<{ value: string; label: string }> = [
  { value: '100', label: 'Thin' },
  { value: '200', label: 'Extra light' },
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi bold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra bold' },
  { value: '900', label: 'Black' },
]

export function buildFontWeightScaleOptions(
  theme: ThemeScaleSource | undefined,
): ThemeScaleOption[] {
  const typography = theme?.typography
  const options: ThemeScaleOption[] = []
  for (const { key, label } of themeFontWeightTokens(typography)) {
    const hint = hintOf(typography ? typography[key] : undefined)
    if (!hint) continue
    options.push({ value: key, label, hint })
  }
  for (const entry of FONT_WEIGHT_LADDER) {
    options.push({ value: entry.value, label: entry.label, hint: entry.value })
  }
  return options
}

/**
 * Stacking layers from `theme.zIndex`, ordered by the layer they sit on
 * rather than alphabetically — an author picking "above the app bar" is
 * reading the stack, not the key names.
 *
 * This is the one of the three where a raw number is usually the WRONG
 * answer: typing `1300` next to a modal the theme also puts at 1300 is a
 * coin toss, and a host that re-tunes its layers leaves that number behind.
 */
export function buildZIndexScaleOptions(
  theme: ThemeScaleSource | undefined,
): ThemeScaleOption[] {
  const zIndex = theme?.zIndex
  if (!zIndex) return []
  return Object.keys(zIndex)
    .filter((key) => typeof zIndex[key] === 'number')
    .sort((a, b) => (zIndex[a] as number) - (zIndex[b] as number))
    .map((key) => ({
      value: key,
      label: humanizeKey(key),
      hint: `${zIndex[key]}`,
    }))
}

/* ── Spacing ──────────────────────────────────────────────────────────── */

/**
 * One rung of the theme's spacing ladder, as the box styler offers it
 * (AGL-2486, item 5).
 *
 * **`value` is a NUMBER and that is the whole point.** MUI's sx system
 * resolves a bare number on a spacing property through `theme.spacing`, so
 * `marginTop: 2` renders 16px under `spacing: 8` and 8px under `spacing: 4`
 * — it keeps following the theme exactly the way `h4.fontSize` and
 * `primary.main` do. Storing the resolved `'16px'` instead would be wrong
 * for the same reason a flattened colour is wrong: it stops tracking the
 * theme the moment anyone retunes it.
 *
 * The numeric form is also the ONLY one that works. MUI multiplies numbers
 * and passes strings through untouched, so the string `'2'` would reach the
 * browser as `margin-top: 2` and be dropped by the CSS parser.
 */
export interface SpacingScaleOption {
  /** The theme spacing STEP, stored as a number so MUI resolves it. */
  value: number
  /** The author's name for it (`Medium`) — no CSS vocabulary required. */
  label: string
  /** What it resolves to in this theme today (`16px`). */
  hint: string
}

/**
 * The ladder offered, in the order a scale is read.
 *
 * Named rather than numbered because this is the one control in the panel
 * a non-developer is guaranteed to meet: "Medium" is a choice anyone can
 * make, "2" is a question about what the unit is. The resolved value rides
 * along in the hint so the answer is still there for whoever wants it.
 *
 * `0` is on the ladder as **None**, and it is a real value meaning "no
 * space", not the absence of one — the styler keeps "not set" as a separate
 * answer that removes the property entirely.
 */
const SPACING_STEPS: ReadonlyArray<{ step: number; label: string }> = [
  { step: 0, label: 'None' },
  { step: 0.5, label: 'Hairline' },
  { step: 1, label: 'Extra small' },
  { step: 2, label: 'Small' },
  { step: 3, label: 'Medium' },
  { step: 4, label: 'Large' },
  { step: 6, label: 'Extra large' },
  { step: 8, label: 'Huge' },
  { step: 12, label: 'Giant' },
]

/** What one step resolves to, or `''` when the theme cannot answer. */
function resolveSpacing(
  spacing: ThemeScaleSource['spacing'],
  step: number,
): string {
  if (typeof spacing === 'function') {
    const resolved = spacing(step)
    if (typeof resolved === 'number') {
      return Number.isFinite(resolved) ? `${resolved}px` : ''
    }
    return typeof resolved === 'string' ? resolved : ''
  }
  // Raw theme options carry the bare unit; mirror MUI's own arithmetic.
  if (typeof spacing === 'number' && Number.isFinite(spacing)) {
    return `${spacing * step}px`
  }
  return ''
}

/**
 * The spacing ladder read off the SITE theme, so a host that set
 * `spacing: 4` offers its own eight-step ladder rather than Aglyn's.
 *
 * A theme with no usable `spacing` yields an empty list, which leaves the
 * styler on custom amounts only — never a ladder of numbers that resolve to
 * nothing.
 */
export function buildSpacingScaleOptions(
  theme: ThemeScaleSource | undefined,
): SpacingScaleOption[] {
  const spacing = theme?.spacing
  const options: SpacingScaleOption[] = []
  for (const { step, label } of SPACING_STEPS) {
    const hint = resolveSpacing(spacing, step)
    // `'0px'` is truthy, so None survives this guard — the check is for a
    // theme that cannot resolve the step at all, not for a zero value.
    if (hint === '') continue
    options.push({ value: step, label, hint })
  }
  return options
}

/** Every theme scale the style field groups need, built once per theme. */
export interface StyleThemeScales {
  fontSize: ThemeScaleOption[]
  fontWeight: ThemeScaleOption[]
  zIndex: ThemeScaleOption[]
  /** The box styler's spacing ladder (AGL-2486, item 5). */
  spacing: SpacingScaleOption[]
  /** Corner-radius presets on the theme's shape scale (AGL-2486). */
  cornerRadius: PresetChoiceOption[]
  /** Drop-shadow presets named by what they look like (AGL-2486). */
  shadow: PresetChoiceOption[]
  /** The theme's own faces, then web-safe stacks (AGL-2486). */
  fontFamily: PresetChoiceOption[]
  /** Whole typography variants — `typography: 'h2'` (AGL-2486). */
  typographyVariant: PresetChoiceOption[]
  /** Grid/flex gaps on the theme's spacing ladder (AGL-2486). */
  gap: PresetChoiceOption[]
}

export function buildStyleThemeScales(
  theme: ThemeScaleSource | undefined,
): StyleThemeScales {
  return {
    fontSize: buildFontSizeScaleOptions(theme),
    fontWeight: buildFontWeightScaleOptions(theme),
    zIndex: buildZIndexScaleOptions(theme),
    spacing: buildSpacingScaleOptions(theme),
    cornerRadius: buildCornerRadiusChoices(theme),
    shadow: buildShadowChoices(theme),
    fontFamily: buildFontFamilyChoices(theme),
    typographyVariant: buildTypographyVariantChoices(theme),
    gap: buildGapChoices(theme),
  }
}

/* ── Corner radius ────────────────────────────────────────────────────── */

/**
 * MUI's own unit for a bare `borderRadius` number, and its default.
 *
 * `borderRadius: 2` renders 8px because MUI multiplies the number by
 * `shape.borderRadius` (4 unless a host changed it) — the same
 * theme-following arithmetic `spacing` gets, and the reason the presets
 * below store NUMBERS. A host that set `shape.borderRadius: 6` gets a
 * ladder of its own without anyone editing this file.
 */
const DEFAULT_SHAPE_RADIUS = 4

function shapeRadiusUnit(theme: ThemeScaleSource | undefined): number {
  const raw = theme?.shape?.borderRadius
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  // A theme may carry a CSS length (`'4px'`); read the leading number so
  // the hints stay right rather than silently reverting to the default.
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return DEFAULT_SHAPE_RADIUS
}

/**
 * The rounding ladder, named the way an author describes a shape rather
 * than the way CSS spells one (AGL-2486).
 *
 * A text box for corner radius invites three value systems at once — a pixel
 * length, a percentage, or a theme multiple — and two of them are wrong,
 * because the theme scale behind this property is SHAPE, not spacing. Every
 * rung here is a theme multiple except the two that cannot be: a pill needs a
 * radius larger than the box can ever be, and a circle is a percentage.
 */
const RADIUS_STEPS: ReadonlyArray<{ step: number; label: string }> = [
  { step: 0, label: 'Square' },
  { step: 1, label: 'Slightly rounded' },
  { step: 2, label: 'Rounded' },
  { step: 3, label: 'More rounded' },
  { step: 4, label: 'Very rounded' },
]

/**
 * A radius large enough that any box reads as a pill (CSS clamps a radius
 * to half the shorter side), expressed in px rather than as a theme
 * multiple because it is deliberately NOT following the theme — a pill is
 * a shape, not a spacing decision.
 */
const PILL_RADIUS = '9999px'

/** Corner-radius presets, with what each resolves to in THIS theme. */
export function buildCornerRadiusChoices(
  theme: ThemeScaleSource | undefined,
): PresetChoiceOption[] {
  const unit = shapeRadiusUnit(theme)
  const options: PresetChoiceOption[] = RADIUS_STEPS.map(({ step, label }) => ({
    value: step,
    label,
    hint: `${step * unit}px`,
    // The menu tile draws the real shape, so the choice is made by looking.
    preview: `${step * unit}px`,
  }))
  options.push({ value: PILL_RADIUS, label: 'Pill', preview: PILL_RADIUS })
  options.push({
    value: '50%',
    label: 'Circle',
    hint: 'square elements only',
    preview: '50%',
  })
  return options
}

/* ── Shadow ───────────────────────────────────────────────────────────── */

/**
 * Drop-shadow presets named by what they LOOK like (AGL-2486).
 *
 * The labels say what the shadow looks like, `No shadow` is offered as the
 * real value it is (a component or the theme may be drawing one), and the
 * escape hatch is a `Custom…` entry in this very control rather than a helper
 * pointing at the custom-CSS section.
 *
 * ## The menu is SHORT but the values are theme ELEVATIONS
 *
 * Two constraints pull apart here. MUI's ladder is 25 near-identical Material
 * elevations, which is a worse menu than a handful of shadows that visibly
 * differ — nobody should scroll 25 rows. But a literal CSS shadow is a bespoke
 * value that ignores `theme.shadows`, so a host that retunes its elevations
 * leaves every stored shadow behind.
 *
 * Both hold at once by curating INDICES: six rungs off the host's own
 * ladder, each stored as the number `boxShadow` already resolves through
 * (`themeKey: 'shadows'`), and each previewing the CSS that number renders
 * so the row still shows what it looks like. Same trick as Corner Radius —
 * store the theme multiple, preview the resolved value.
 *
 * `none` stays a string because it is the real value it is: a component or
 * the theme may be drawing a shadow this element wants gone.
 */
const SHADOW_STEPS: ReadonlyArray<{ elevation: number; label: string }> = [
  { elevation: 1, label: 'Barely there — a hairline lift' },
  { elevation: 3, label: 'Soft — sits on the page' },
  { elevation: 6, label: 'Lifted — floats a little' },
  { elevation: 12, label: 'Raised — floats well above' },
  { elevation: 24, label: 'Highest — dialog level' },
]

/**
 * Literal CSS shadows, reached only when a theme carries no usable `shadows`
 * array, so the control never degrades to an empty menu on a host with an
 * unusual theme.
 */
const FALLBACK_SHADOWS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '0 1px 3px rgba(0,0,0,0.2)', label: 'Soft — sits on the page' },
  { value: '0 4px 12px rgba(0,0,0,0.15)', label: 'Lifted — floats a little' },
  { value: '0 12px 32px rgba(0,0,0,0.25)', label: 'Raised — floats well above' },
  {
    value: 'inset 0 2px 6px rgba(0,0,0,0.2)',
    label: 'Inset — pressed into the page',
  },
]

export function buildShadowChoices(
  theme?: ThemeScaleSource | undefined,
): PresetChoiceOption[] {
  const shadows = theme?.shadows
  const options: PresetChoiceOption[] = [{ value: 'none', label: 'No shadow' }]
  if (!Array.isArray(shadows) || shadows.length === 0) {
    for (const entry of FALLBACK_SHADOWS) {
      options.push({ value: entry.value, label: entry.label, preview: entry.value })
    }
    return options
  }
  for (const { elevation, label } of SHADOW_STEPS) {
    const resolved = shadows[elevation]
    // A host with a shorter ladder simply offers fewer rungs rather than
    // storing an index that resolves to nothing.
    if (typeof resolved !== 'string' || !resolved || resolved === 'none') continue
    options.push({
      value: elevation,
      label,
      hint: `Elevation ${elevation}`,
      preview: resolved,
    })
  }
  return options
}

/* ── Font family ──────────────────────────────────────────────────────── */

/**
 * The typography variants whose own `fontFamily` is worth offering. A theme
 * that gives headings a display face and body a text face has TWO answers
 * an author should be able to pick, and neither of them is a font name they
 * have to know how to spell.
 */
const FONT_FAMILY_VARIANTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'h1', label: 'Theme heading font' },
  { key: 'body1', label: 'Theme body font' },
  { key: 'button', label: 'Theme button font' },
]

/**
 * Web-safe stacks, offered AFTER the theme's own faces.
 *
 * Deliberately short and generic: these are the families that render
 * without a webfont on every platform, so picking one can never cost a
 * page-load or leave a visitor on a fallback the author never saw. Anything
 * else — a Google font, a licensed face — is a Custom… value, which is the
 * honest place for it because it also needs the font to be loaded.
 */
const WEB_SAFE_FONTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'system-ui, sans-serif', label: 'System sans-serif' },
  { value: 'Georgia, serif', label: 'Georgia (serif)' },
  { value: '"Times New Roman", Times, serif', label: 'Times (serif)' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial (sans-serif)' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana (sans-serif)' },
  {
    value: '"Trebuchet MS", Helvetica, sans-serif',
    label: 'Trebuchet (sans-serif)',
  },
  { value: '"Courier New", Courier, monospace', label: 'Courier (monospace)' },
]

/** The first word of a stack, for a hint that fits a narrow menu row. */
function firstFamily(stack: string): string {
  const first = stack.split(',')[0] ?? ''
  return first.trim().replace(/^["']|["']$/g, '')
}

/**
 * Font-family choices: the SITE THEME's own faces first, then web-safe
 *
 * The old field was free text carrying the advice *"Prefer theme typography
 * when possible"* — advice with no way to act on it. Leading with the
 * theme's faces makes the recommended answer the first one in reach, and
 * every row renders its own label in its own face so the choice can be made
 * by looking.
 *
 * A theme face is stored as the resolved STACK rather than as a token path,
 * because MUI declares `fontFamily` with `themeKey: 'typography'` and
 * `typography.fontFamily` is the only path that resolves — `h1.fontFamily`
 * does not. Duplicates are collapsed so a theme using one face everywhere
 * offers it once.
 */
export function buildFontFamilyChoices(
  theme: ThemeScaleSource | undefined,
): PresetChoiceOption[] {
  const typography = theme?.typography
  const options: PresetChoiceOption[] = []
  const seen = new Set<string>()
  const push = (value: string, label: string) => {
    const stack = value.trim()
    if (stack === '' || seen.has(stack)) return
    seen.add(stack)
    options.push({ value: stack, label, hint: firstFamily(stack) })
  }
  if (typography) {
    const base = typography['fontFamily']
    if (typeof base === 'string') push(base, 'Theme default font')
    for (const { key, label } of FONT_FAMILY_VARIANTS) {
      const variant = typography[key]
      if (!variant || typeof variant !== 'object') continue
      const family = (variant as Record<string, unknown>)['fontFamily']
      if (typeof family === 'string') push(family, label)
    }
  }
  for (const font of WEB_SAFE_FONTS) push(font.value, font.label)
  return options
}

/* ── Typography variant ───────────────────────────────────────────────── */

/**
 * Whole text styles from `theme.typography` (AGL-2486).
 *
 * Every other control in this group sets ONE property, so matching a heading
 * to the theme takes five correct picks in a row — face, size, weight, line
 * height, letter spacing — and getting any of them wrong leaves text that
 * looks almost right. `typography: 'h2'` is a single sx key that applies all
 * of them at once, and it is the key MUI itself reaches for.
 *
 * Without this control a page can carry eleven headings at MUI's default `h2`
 * — Light 300 at 60px — while every panel in the besigner reports nothing
 * wrong: no field says "this is a Heading 2", only fields that say "this is
 * 60px" once somebody types it.
 *
 * The hint names what the variant resolves to in THIS theme rather than in
 * the abstract, because "Heading 2" means nothing until you know the host
 * made it 40px semibold.
 */
export function buildTypographyVariantChoices(
  theme: ThemeScaleSource | undefined,
): PresetChoiceOption[] {
  const typography = theme?.typography
  if (!typography) return []
  const options: PresetChoiceOption[] = []
  for (const { key, label } of themeTypographyVariants(typography)) {
    const variant = typography[key]
    if (!variant || typeof variant !== 'object') continue
    const { fontSize, fontWeight } = variant as Record<string, unknown>
    const parts = [hintOf(fontSize), hintOf(fontWeight) && `weight ${hintOf(fontWeight)}`]
      .filter(Boolean)
      .join(' · ')
    options.push({ value: key, label, hint: parts || undefined })
  }
  return options
}

/* ── Gap ──────────────────────────────────────────────────────────────── */

/**
 * Grid and flex gaps on the theme's spacing ladder (AGL-2486).
 *
 * A free-text box for `gap`, `rowGap` or `columnGap` reads as a CSS length
 * question and gets answered with one — but MUI runs all three through
 * `createUnaryUnit(theme, 'spacing', …)`, exactly like margin and padding. So
 * `gap: 2` is a theme multiple that follows a host retuning its unit, and
 * `gap: '16px'` is a bespoke value that does not.
 *
 * These are the same rungs and the same labels the box styler offers for
 * margin and padding, so the two controls agree; gaps only sit apart because
 * they live in the Grid and Flex groups.
 *
 * A `PresetChoiceOption` rather than a `ThemeScaleOption` because the value
 * STORED is a number and that interface is string-only — the same reason
 * Corner Radius is a preset.
 */
export function buildGapChoices(
  theme: ThemeScaleSource | undefined,
): PresetChoiceOption[] {
  const spacing = theme?.spacing
  const options: PresetChoiceOption[] = []
  for (const { step, label } of SPACING_STEPS) {
    const hint = resolveSpacing(spacing, step)
    if (hint === '') continue
    options.push({ value: step, label, hint })
  }
  return options
}
