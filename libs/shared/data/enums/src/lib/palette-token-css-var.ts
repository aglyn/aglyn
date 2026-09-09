/**
 * @license
 * Copyright 2023 Aglyn LLC
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

/**
 * Palette tokens as CSS custom properties: the `var(--mui-palette-…)` form a
 * bound colour is persisted in, its channel variant for author-chosen alpha,
 * and the readers that take both back apart.
 *
 * Its own module because a published page reads only these — the sx palette
 * resolver rewrites every token-bound colour on the page through them — while
 * `styles.ts` around it is authoring-surface work: the unit enum and its
 * pickers, the dimension parser, and the whole gradient model. None of that
 * runs to resolve a colour, and a bundler cannot drop it around three named
 * imports.
 */

/**
 * Splits a CSS argument list on TOP-LEVEL commas, respecting nesting.
 *
 * Exported because the gradient parser in `styles.ts` splits stop lists with
 * the same rule; one implementation, so a nested `rgba()` cannot start
 * parsing differently in the two places.
 */
export function splitTopLevelArgs(text: string): string[] {
  const args: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    // A comma inside `var(--x, #fff)` or `rgba(0, 0, 0, .5)` belongs to
    // that function, not to the stop list.
    else if (char === ',' && depth === 0) {
      args.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  args.push(text.slice(start).trim())
  return args
}

/**
 * CSS custom-property prefix MUI uses for palette entries — the same one
 * `theme.vars.palette.*` emits under the default `mui` cssVarPrefix.
 *
 * A gradient stop bound to a THEME TOKEN is persisted as
 * `var(--mui-palette-primary-main, #00B0FF)` (AGL-1331): `backgroundImage`
 * is not one of MUI's palette-keyed sx properties (only `color`, `bgcolor`
 * and `backgroundColor` are), so a bare `primary.main` inside a gradient
 * would reach CSS verbatim and the whole declaration would be dropped —
 * the exact silent failure this issue is about. A `var()` reference with a
 * literal fallback is valid CSS everywhere, so the worst case is the
 * fallback colour, never a vanished background.
 */
const PALETTE_CSS_VAR_PREFIX = '--mui-palette-'

/** A palette token reference parsed out of a `var()` expression. */
export interface PaletteTokenRef {
  /** Dot path into the palette, e.g. `primary.main`. */
  path: string
  /** Literal colour rendered when the custom property is undefined. */
  fallback?: string
}

/**
 * The CSS custom-property name a palette token path maps to:
 * `primary.main` becomes `--mui-palette-primary-main`, matching MUI's own
 * naming. Path segments are lowercase words in every token the picker
 * offers, so the `.`/`-` swap is exactly reversible by
 * {@link cssVarNameToPaletteToken}.
 */
export function paletteTokenToCssVarName(path: string): string {
  return `${PALETTE_CSS_VAR_PREFIX}${path.trim().split('.').join('-')}`
}

/** Inverse of {@link paletteTokenToCssVarName}; undefined for other vars. */
export function cssVarNameToPaletteToken(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed.startsWith(PALETTE_CSS_VAR_PREFIX)) return undefined
  const rest = trimmed.slice(PALETTE_CSS_VAR_PREFIX.length)
  return rest ? rest.split('-').join('.') : undefined
}

/** Builds the persisted form of a token-bound colour. */
export function paletteTokenToCssVar(path: string, fallback?: string): string {
  const name = paletteTokenToCssVarName(path)
  return fallback ? `var(${name}, ${fallback})` : `var(${name})`
}

/**
 * Reads a `var(--mui-palette-…[, fallback])` expression back into its token
 * path plus fallback. Anything else (a literal, a non-palette custom
 * property) returns undefined so callers treat it as a plain colour.
 */
export function parsePaletteTokenCssVar(
  value: string | undefined | null,
): PaletteTokenRef | undefined {
  if (!value) return undefined
  const text = `${value}`.trim()
  if (!text.toLowerCase().startsWith('var(') || !text.endsWith(')')) {
    return undefined
  }
  const [name, ...fallbackParts] = splitTopLevelArgs(text.slice(4, -1))
  if (name === undefined) return undefined
  const path = cssVarNameToPaletteToken(name)
  if (!path) return undefined
  const fallback = fallbackParts.join(', ').trim()
  return fallback ? { path, fallback } : { path }
}

/**
 * Suffix MUI appends to a palette custom property holding the SPACE-SEPARATED
 * RGB channels of a colour — `--mui-palette-primary-mainChannel` is
 * `31 41 55` where `--mui-palette-primary-main` is `#1F2937`.
 *
 * MUI publishes these for exactly one reason: so alpha can be applied to a
 * palette TOKEN at render time, as `rgba(var(…Channel) / 0.12)`, instead of
 * the token being flattened to a literal `rgba(…)` by
 * whoever wrote the style. That distinction is the whole feature: a flattened
 * literal stops following the palette, so a white-label site or a palette
 * change keeps the old colour for ever and nothing reports it. The designer's
 * own chrome already uses this form (`box-styler/components/box-diagram.tsx`).
 */
const PALETTE_CHANNEL_SUFFIX = 'Channel'

/** `primary.main` → `--mui-palette-primary-mainChannel`. */
export function paletteTokenToChannelCssVarName(path: string): string {
  return `${paletteTokenToCssVarName(path)}${PALETTE_CHANNEL_SUFFIX}`
}

/**
 * The palette path a CHANNEL custom property names — `primary.main` for
 * `--mui-palette-primary-mainChannel` — or undefined when the name is not a
 * channel reference. Note this returns the path of the COLOUR, not of a
 * `mainChannel` key: a theme built with plain `createTheme` (which is what
 * `createResponsiveTheme` does) has no channel entries at all, so the
 * resolver derives the triplet from the colour itself.
 */
export function channelCssVarNameToPaletteToken(
  name: string,
): string | undefined {
  const trimmed = `${name ?? ''}`.trim()
  // Case-insensitive on the suffix only: CSS custom properties ARE
  // case-sensitive, but a value that reached us through a CSS minifier or a
  // hand edit should still round-trip into the picker rather than reading as
  // an opaque literal.
  if (
    trimmed.slice(-PALETTE_CHANNEL_SUFFIX.length).toLowerCase() !==
    PALETTE_CHANNEL_SUFFIX.toLowerCase()
  ) {
    return undefined
  }
  return cssVarNameToPaletteToken(
    trimmed.slice(0, -PALETTE_CHANNEL_SUFFIX.length),
  )
}

const HEX_CHANNEL_PATTERN = /^#([0-9a-f]{3,8})$/i
const RGB_FUNCTION_PATTERN = /^rgba?\(([^()]*)\)$/i

/**
 * A colour's `R G B` triplet — MUI's channel form — or undefined when the
 * value is not one this can read (a named colour, `hsl()`, a `var()` that has
 * not been substituted yet). Undefined is a real answer: the caller then
 * leaves the reference's literal fallback in place rather than emitting a
 * malformed `rgba()` that the browser would drop.
 *
 * An alpha component in the input is deliberately DISCARDED — the channel is
 * the colour, and the alpha being applied is the author's, not the palette's.
 */
export function cssColorToChannel(
  color: string | undefined | null,
): string | undefined {
  const text = `${color ?? ''}`.trim()
  if (!text) return undefined
  const hex = HEX_CHANNEL_PATTERN.exec(text)
  if (hex) {
    const digits = hex[1]
    // `#abc` and `#abcd` are shorthand: each digit doubles. The 8-digit form
    // carries alpha in the last pair, which is dropped with the rest.
    const expanded =
      digits.length <= 4
        ? digits
            .split('')
            .map((digit) => `${digit}${digit}`)
            .join('')
        : digits
    if (expanded.length < 6) return undefined
    const channels = [0, 2, 4].map((offset) =>
      Number.parseInt(expanded.slice(offset, offset + 2), 16),
    )
    return channels.some((channel) => Number.isNaN(channel))
      ? undefined
      : channels.join(' ')
  }
  const fn = RGB_FUNCTION_PATTERN.exec(text)
  if (!fn) return undefined
  // Both the legacy comma form and the modern `r g b / a` form, since either
  // can appear in a hand-authored palette.
  const parts = fn[1]
    .split('/')[0]
    .split(/[\s,]+/)
    .filter((part) => part !== '')
  if (parts.length < 3) return undefined
  const channels = parts.slice(0, 3).map((part) => Number.parseFloat(part))
  if (channels.some((channel) => !Number.isFinite(channel))) return undefined
  return channels.map((channel) => Math.round(channel)).join(' ')
}

/** A palette token carrying an author-chosen alpha. */
export interface PaletteAlphaTokenRef {
  /** Dot path into the palette, e.g. `primary.main`. */
  path: string
  /** Opacity in [0, 1]. */
  alpha: number
  /** Literal channel triplet rendered when the custom property is undefined. */
  fallback?: string
}

/**
 * The persisted form of "a theme token at N% opacity":
 * `rgba(var(--mui-palette-primary-mainChannel, 31 41 55) / 0.12)`.
 *
 * A CSS var reference with a literal fallback, exactly like the gradient
 * field's token stops (AGL-1331) — the reference is what keeps the value a
 * TOKEN, and the fallback is what renders if the substitution pass is ever
 * skipped, so the worst case is a slightly stale colour rather than a dropped
 * declaration. `fallbackColor` is the colour the token resolves to today; it
 * is converted to channels here so callers never have to know the form.
 */
export function paletteTokenToAlphaCssVar(
  path: string,
  alpha: number,
  fallbackColor?: string,
): string {
  const name = paletteTokenToChannelCssVarName(path)
  const fallback = cssColorToChannel(fallbackColor)
  const reference = fallback ? `var(${name}, ${fallback})` : `var(${name})`
  // Trimmed so `0.5` does not persist as `0.50`, and clamped because an
  // out-of-range alpha is a dropped declaration, not a clipped colour.
  const clamped = Math.min(1, Math.max(0, Number(alpha)))
  const amount = Number.isFinite(clamped) ? Number(clamped.toFixed(4)) : 1
  return `rgba(${reference} / ${amount})`
}

const ALPHA_TOKEN_PATTERN =
  /^rgba?\(\s*var\(\s*(--mui-palette-[a-z0-9-]+channel)\s*(?:,([^()]*))?\)\s*\/\s*([0-9]*\.?[0-9]+)\s*\)$/i

/**
 * Reads {@link paletteTokenToAlphaCssVar} back into its token path and alpha,
 * so re-opening the picker on a stored value shows the TOKEN and its opacity
 * rather than an opaque string. Anything else returns undefined and is treated
 * as a plain colour.
 */
export function parsePaletteTokenAlphaCssVar(
  value: string | undefined | null,
): PaletteAlphaTokenRef | undefined {
  if (!value) return undefined
  const matched = ALPHA_TOKEN_PATTERN.exec(`${value}`.trim())
  if (!matched) return undefined
  const path = channelCssVarNameToPaletteToken(matched[1])
  if (!path) return undefined
  const alpha = Number.parseFloat(matched[3])
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return undefined
  const fallback = (matched[2] ?? '').trim()
  return fallback ? { path, alpha, fallback } : { path, alpha }
}
