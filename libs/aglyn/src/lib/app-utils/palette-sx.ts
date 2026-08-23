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

// Subpath, NOT the `@aglyn/shared-data-enums` barrel — see the note on the
// same import in `merge-node-sx.ts` (AGL-2486). The barrel reaches
// `firebase/auth`; this file wants one string helper out of `lib/styles`.
import {
  channelCssVarNameToPaletteToken,
  cssColorToChannel,
  cssVarNameToPaletteToken,
} from '@aglyn/shared-data-enums/styles'

/**
 * Palette-token references inside sx STRING values (AGL-1331).
 *
 * MUI resolves palette token paths for the handful of sx properties it
 * declares with `themeKey: 'palette'` — `color`, `bgcolor`,
 * `backgroundColor`, `borderColor`. Everything else, `backgroundImage`
 * included, reaches CSS verbatim. So a gradient stop bound to a theme
 * token cannot be written as `primary.main`: it has to be a value CSS
 * itself understands.
 *
 * The Background Fill field therefore persists token stops as
 * `var(--mui-palette-primary-main, #00B0FF)`, and this pass substitutes
 * the ACTIVE theme's palette value before the sx reaches emotion. Two
 * reasons it resolves here rather than leaving the `var()` to the browser:
 *
 * 1. Sites build their theme with `createResponsiveTheme` (plain
 *    `createTheme`, no `cssVariables`), so `--mui-palette-*` is not defined
 *    on the tenant at all — the browser would fall back to the literal and
 *    a later palette change would never reach the gradient.
 * 2. On the canvas the opposite hazard: the besigner runs INSIDE the
 *    console's `CssVarsProvider`, which DOES define `--mui-palette-*` — the
 *    console's own brand colours. An unresolved `var()` would paint the
 *    console's primary into the site's gradient.
 *
 * Substituting from the site theme's palette is correct in both places, and
 * it makes scheme adaptation free: the leaf resolves against the theme that
 * is already light or dark, so a token stop behaves exactly like
 * `backgroundColor: 'primary.main'` does.
 *
 * The literal fallback is never wasted work — it is what renders if this
 * pass is ever skipped, so the failure mode of the whole feature is a
 * slightly stale colour rather than a dropped declaration.
 *
 * AGL-2486 extends the same mechanism to ALPHA. `rgba(…)` cannot take a
 * colour, only channels, so "primary.main at 12%" persists as
 * `rgba(var(--mui-palette-primary-mainChannel, 31 41 55) / 0.12)` and this
 * pass derives the triplet from the palette colour — see
 * {@link readPaletteVarValue}. Flattening to `rgba(31, 41, 55, 0.12)` at
 * author time would have been simpler and wrong: the value stops being a
 * token, so a white-label palette swap silently keeps the old brand colour.
 */

/**
 * Matches one `var(--mui-palette-…[, fallback])` reference. The fallback
 * group allows ONE level of nesting so an `rgb(…)`/`rgba(…)` fallback — what
 * the colour picker emits for a token whose palette entry is not a hex —
 * is captured whole rather than truncated at its first `)`.
 */
const PALETTE_VAR_PATTERN =
  /var\(\s*(--mui-palette-[a-z0-9-]+)\s*(?:,((?:[^()]|\([^()]*\))*))?\)/gi

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Resolves a dot path into a palette object to its colour string. */
function readPaletteToken(
  palette: Record<string, unknown> | undefined,
  path: string,
): string | undefined {
  if (!palette) return undefined
  const resolved = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[key]
          : undefined,
      palette,
    )
  return typeof resolved === 'string' ? resolved : undefined
}

/**
 * What one `--mui-palette-…` custom property stands for in this palette.
 *
 * Two shapes, because MUI publishes two (AGL-2486):
 *
 * - `--mui-palette-primary-main` — the colour itself.
 * - `--mui-palette-primary-mainChannel` — its `31 41 55` RGB triplet, which
 *   is how alpha is applied to a TOKEN rather than to a flattened literal:
 *   `rgba(var(--mui-palette-primary-mainChannel) / 0.12)`. That is the whole
 *   point of the channel form, and it is what the styles panel's opacity
 *   control persists.
 *
 * The direct read comes first so a theme that really does define channel
 * entries (anything built through `CssVarsProvider`) wins with its own
 * values. `createResponsiveTheme` is plain `createTheme` and defines none, so
 * for every Aglyn site the triplet is DERIVED here from the colour the token
 * resolves to — which is exactly what keeps an alpha'd token following the
 * palette instead of freezing the colour it had on the day it was authored.
 */
function readPaletteVarValue(
  name: string,
  palette: Record<string, unknown> | undefined,
): string | undefined {
  const path = cssVarNameToPaletteToken(name)
  const direct = path ? readPaletteToken(palette, path) : undefined
  if (direct) return direct
  const channelPath = channelCssVarNameToPaletteToken(name)
  if (!channelPath) return undefined
  const color = readPaletteToken(palette, channelPath)
  return color ? cssColorToChannel(color) : undefined
}

/**
 * Substitutes palette `var()` references in one string. Returns the same
 * string (identity) when there is nothing to substitute, so callers can
 * cheaply tell an untouched value from a rewritten one. A reference whose
 * token the palette does not define collapses to its literal fallback —
 * never left as a `var()` that an ancestor provider could hijack.
 */
export function resolvePaletteVars(
  value: string,
  palette: Record<string, unknown> | undefined,
): string {
  if (!value.includes('--mui-palette-')) return value
  return value.replace(
    PALETTE_VAR_PATTERN,
    (match, name: string, fallback?: string) => {
      const resolved = readPaletteVarValue(name, palette)
      if (resolved) return resolved
      const literal = (fallback ?? '').trim()
      return literal || match
    },
  )
}

/**
 * Walks an sx value substituting palette `var()` references against the
 * active theme's palette. Arrays resolve per entry, theme callbacks are
 * wrapped, nested objects (breakpoint slices, pseudo selectors, custom
 * CSS) resolve recursively, and the input is never mutated. Values with no
 * palette reference come back by identity, so an sx that uses none is not
 * reallocated.
 */
export function resolvePaletteVarsSx<T>(
  sx: T,
  palette: Record<string, unknown> | undefined,
): T {
  if (typeof sx === 'string') return resolvePaletteVars(sx, palette) as T
  if (Array.isArray(sx)) {
    let changed = false
    const next = sx.map((entry) => {
      const resolved = resolvePaletteVarsSx(entry, palette)
      if (resolved !== entry) changed = true
      return resolved
    })
    return (changed ? next : sx) as T
  }
  if (typeof sx === 'function') {
    const callback = sx as (...args: unknown[]) => unknown
    return ((...args: unknown[]) =>
      resolvePaletteVarsSx(callback(...args), palette)) as T
  }
  if (!isPlainObject(sx)) return sx

  let changed = false
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sx)) {
    const resolved = resolvePaletteVarsSx(value, palette)
    if (resolved !== value) changed = true
    out[key] = resolved
  }
  return (changed ? out : sx) as T
}

export default resolvePaletteVarsSx
