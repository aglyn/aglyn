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
  HostTheme,
  HostThemeFont,
  HostThemeFontCategory,
  HostThemeTypographyVariantKey,
} from '@aglyn/shared-data-types'

/**
 * A theme's body and heading fonts, read and written (AGL-3656).
 *
 * Moved here from `@aglyn/shared-ui-theme/util/theme-editor-fields`, which
 * re-exports every name, so the theme editor, the AI site look and a site
 * starter's theme (AGL-4049) set fonts through one writer. The editor's
 * module is a UI library, which the platform core and the server data layer
 * may not import; this one is a utility they can.
 *
 * Pure functions over `HostTheme`: no MUI, no React.
 */

/** The CSS stack a theme names a family by: the family, then its generic fallback. */
export function fontFamilyStack(
  family: string,
  category: HostThemeFontCategory,
) {
  const fallback = category === 'monospace' ? 'monospace' : category === 'serif' ? 'serif' : 'sans-serif'
  return `"${family}", ${fallback}`
}

/**
 * The text styles a separate heading font is set on: `h1`…`h6`, and
 * `displayXl`, the platform's rung above `h1`, which a heading font left off
 * would draw in the body font — and load the body font's heaviest weight for.
 */
export const THEME_HEADING_VARIANTS: readonly HostThemeTypographyVariantKey[] = [
  'displayXl',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]

/**
 * One family a theme sets text in, as the font picker shows and writes it
 * (AGL-3656): a `fonts` entry and the role it plays.
 */
export interface ThemeFontChoice {
  family: string
  category: HostThemeFontCategory
  /** Upright weights to load, ascending. */
  weights: number[]
  /** Italic weights to load, ascending; absent or empty for none. */
  italics?: number[]
  source: 'google' | 'custom'
}

/**
 * The theme's body font and, when it differs, its heading font. `null` is the
 * theme default: the base stack, nothing loaded.
 */
export interface ThemeFontSelection {
  body: ThemeFontChoice | null
  heading: ThemeFontChoice | null
}

/** The first family a CSS font-family stack names, unquoted. */
export function firstStackFamily(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined
  const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '').trim()
  return first || undefined
}

/** The category a stack's generic keyword names, for a font that records none. */
function stackCategory(stack: unknown): HostThemeFontCategory {
  if (typeof stack !== 'string') return 'sans-serif'
  if (/\bmonospace\b/i.test(stack)) return 'monospace'
  if (/(^|,)\s*serif\b/i.test(stack)) return 'serif'
  return 'sans-serif'
}

function sortedWeights(values: readonly unknown[] | undefined): number[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => Math.round(Number(value)))
        .filter((value) => Number.isFinite(value) && value >= 1 && value <= 1000),
    ),
  ].sort((a, b) => a - b)
}

function choiceOf(font: HostThemeFont, stack: unknown): ThemeFontChoice {
  const italics = sortedWeights(font.italics)
  return {
    family: font.family.trim(),
    category: font.category ?? stackCategory(stack),
    weights: sortedWeights(font.weights).length ? sortedWeights(font.weights) : [400],
    ...(italics.length ? { italics } : {}),
    source: font.source === 'custom' ? 'custom' : 'google',
  }
}

function findFont(theme: HostTheme | undefined, family: string | undefined) {
  if (!family) return undefined
  const wanted = family.toLowerCase()
  return theme?.fonts?.find(
    (font) =>
      font.family?.trim().toLowerCase() === wanted && (font.source ?? 'google') !== 'system',
  )
}

/**
 * The body and heading fonts a theme sets text in (AGL-3656).
 *
 * The body font is the family the theme-wide stack names first, when the
 * theme loads it: a font the theme lists that no stack names draws nothing,
 * which is what the theme default is. The heading font is the family `h1`
 * names, when that is a loaded font other than the body's.
 */
export function readThemeFonts(theme: HostTheme | undefined): ThemeFontSelection {
  const stack = theme?.typography?.fontFamily
  const bodyFont = findFont(theme, firstStackFamily(stack))
  const headingStack = theme?.typography?.variants?.h1?.fontFamily
  const headingFont = findFont(theme, firstStackFamily(headingStack))
  return {
    body: bodyFont ? choiceOf(bodyFont, stack) : null,
    heading:
      headingFont && headingFont !== bodyFont ? choiceOf(headingFont, headingStack) : null,
  }
}

function fontEntry(choice: ThemeFontChoice): HostThemeFont {
  const italics = sortedWeights(choice.italics)
  return {
    family: choice.family.trim(),
    weights: sortedWeights(choice.weights).length ? sortedWeights(choice.weights) : [400],
    ...(italics.length ? { italics } : {}),
    source: choice.source,
    category: choice.category,
  }
}

/**
 * Sets the theme's body and heading fonts (AGL-3656): the `fonts` entries the
 * page loads, the theme-wide stack, and the stack of each style in
 * {@link THEME_HEADING_VARIANTS} for a heading font of its own. `null` goes
 * back to the theme default for that role.
 *
 * An uploaded (`custom`) font the theme lists but no longer sets text in is
 * kept, because it is the site's own and is picked again from the list; a
 * Google font nothing sets text in any more is dropped, so the page stops
 * loading it. Everything else in the typography — sizes, weights, a variant's own
 * family that is not a heading — is left as it was.
 */
export function writeThemeFonts(theme: HostTheme, selection: ThemeFontSelection): HostTheme {
  const body = selection.body
  const heading =
    selection.heading &&
    (!body || selection.heading.family.toLowerCase() !== body.family.toLowerCase())
      ? selection.heading
      : null
  const previous = readThemeFonts(theme)
  const previousHeadingStack = previous.heading
    ? theme.typography?.variants?.h1?.fontFamily
    : undefined

  const chosen = [body, heading].filter((entry): entry is ThemeFontChoice => !!entry)
  const chosenKeys = new Set(chosen.map((entry) => entry.family.trim().toLowerCase()))
  // Families a text style other than a heading still names, by hand or by
  // an earlier editor: they keep loading, as their style keeps drawing them.
  const otherStyles = new Set(
    Object.entries(theme.typography?.variants ?? {})
      .filter(([key]) => !(THEME_HEADING_VARIANTS as readonly string[]).includes(key))
      .map(([, variant]) => firstStackFamily(variant?.fontFamily)?.toLowerCase())
      .filter((family): family is string => !!family),
  )
  const kept = (theme.fonts ?? []).filter((font) => {
    const key = font.family?.trim().toLowerCase() ?? ''
    if (!key || chosenKeys.has(key)) return false
    return font.source === 'custom' || otherStyles.has(key)
  })
  const fonts = [...chosen.map(fontEntry), ...kept]

  const typography = { ...theme.typography }
  if (body) typography.fontFamily = fontFamilyStack(body.family.trim(), body.category)
  else delete typography.fontFamily

  const variants = { ...typography.variants }
  for (const key of THEME_HEADING_VARIANTS) {
    const variant = { ...variants[key] }
    if (heading) {
      variant.fontFamily = fontFamilyStack(heading.family.trim(), heading.category)
    } else if (
      variant.fontFamily !== undefined &&
      (variant.fontFamily === previousHeadingStack ||
        !findFont({ fonts }, firstStackFamily(variant.fontFamily)))
    ) {
      // The heading font this theme had, or a family it no longer loads.
      delete variant.fontFamily
    }
    if (Object.keys(variant).length) variants[key] = variant
    else delete variants[key]
  }
  if (Object.keys(variants).length) typography.variants = variants
  else delete typography.variants

  const next: HostTheme = { ...theme }
  if (fonts.length) next.fonts = fonts
  else delete next.fonts
  if (Object.keys(typography).length) next.typography = typography
  else delete next.typography
  return next
}
