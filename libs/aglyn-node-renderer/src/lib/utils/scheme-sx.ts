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

/**
 * Scheme-scoped node sx (AGL-588).
 *
 * Sites resolve light/dark by SWAPPING a single-mode MUI theme: the
 * tenant's `HostThemeProvider` picks the scheme from the shared cookie +
 * `prefers-color-scheme` mode state and rebuilds the theme via
 * `hostThemeToThemeOptions(theme, scheme)`; the besigner canvas does the
 * same through `useAglynSiteTheme({ scheme: canvasScheme })`. There is no
 * CSS-variables/attribute selector and no pure media-query dark mode to
 * target — a `@media (prefers-color-scheme: dark)` slice would ignore the
 * cookie override and would never show on the canvas. Scheme overrides
 * are therefore resolved in JS against the ACTIVE theme's
 * `palette.mode`, exactly like MUI's own non-CSS-vars
 * `theme.applyStyles('dark', …)`.
 *
 * Persisted shape — the scheme dimension wraps the breakpoint dimension
 * (scheme OUTER, breakpoints INNER): a node's sx may carry a single
 * reserved {@link SX_SCHEME_DARK_KEY} slice whose entries are ordinary
 * style properties, each optionally in MUI's responsive-object form:
 *
 * ```ts
 * {
 *   color: { xs: '#111', md: '#222' },        // base = light scheme
 *   '@scheme dark': { color: '#eee' },        // dark override
 * }
 * ```
 *
 * Light (the default scheme) IS the base — there is no light slice.
 * Renderers that predate this feature emit the slice as an unknown
 * `@scheme dark { … }` at-rule, which browsers drop: dark overrides
 * simply fall back to the base styles, never breaking light rendering.
 */

/** Reserved node-sx key holding dark-scheme style overrides. */
export const SX_SCHEME_DARK_KEY = '@scheme dark'

export type SxScheme = 'light' | 'dark'

/** MUI breakpoint keys, smallest to largest (`xs` doubles as the base). */
const SCHEME_SX_BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'] as const

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isResponsiveObject = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every((key) =>
    (SCHEME_SX_BREAKPOINTS as readonly string[]).includes(key),
  )

/**
 * The value a (possibly responsive) sx property resolves to at the given
 * breakpoint index, following MUI's mobile-first cascade. Plain values
 * apply at every width.
 */
function resolveResponsive(value: unknown, index: number): unknown {
  if (!isResponsiveObject(value)) return value
  for (let i = index; i >= 0; i -= 1) {
    const slice = value[SCHEME_SX_BREAKPOINTS[i]]
    if (slice !== undefined) return slice
  }
  return undefined
}

/**
 * Merges a dark-scheme override over a base property value with real
 * CSS-cascade semantics: at every breakpoint the override wins where it
 * resolves (mobile-first within its own responsive object) and the base
 * shows through where it does not. Plain (non-responsive) overrides
 * therefore replace the property at every width; a `{ md: … }` override
 * keeps the base's xs–sm values. The merged result is compacted —
 * duplicate consecutive slices collapse and a single `xs` slice becomes
 * a plain value.
 */
export function mergeSchemeValue(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (base === undefined) return override
  if (!isResponsiveObject(base) && !isResponsiveObject(override)) {
    return override
  }
  const merged: Record<string, unknown> = {}
  let previous: unknown
  let hasPrevious = false
  SCHEME_SX_BREAKPOINTS.forEach((breakpoint, index) => {
    const fromOverride = resolveResponsive(override, index)
    const resolved =
      fromOverride !== undefined ? fromOverride : resolveResponsive(base, index)
    if (resolved === undefined) return
    if (!hasPrevious || resolved !== previous) {
      merged[breakpoint] = resolved
      hasPrevious = true
      previous = resolved
    }
  })
  const keys = Object.keys(merged)
  if (keys.length === 0) return undefined
  if (keys.length === 1 && keys[0] === 'xs') return merged['xs']
  return merged
}

/**
 * Resolves {@link SX_SCHEME_DARK_KEY} slices in an sx value against the
 * active scheme: in dark, each slice entry merges over the base property
 * ({@link mergeSchemeValue}); in light, slices drop. Arrays resolve
 * per entry, theme callbacks are wrapped, and nested objects (pseudo
 * selectors, custom CSS) resolve recursively. The input is never
 * mutated.
 */
export function resolveSchemeSx<T>(sx: T, scheme: SxScheme): T {
  if (Array.isArray(sx)) {
    return sx.map((entry) => resolveSchemeSx(entry, scheme)) as T
  }
  if (typeof sx === 'function') {
    const callback = sx as (...args: unknown[]) => unknown
    return ((...args: unknown[]) =>
      resolveSchemeSx(callback(...args), scheme)) as T
  }
  if (!isPlainObject(sx)) return sx

  const { [SX_SCHEME_DARK_KEY]: darkSlice, ...rest } = sx as Record<
    string,
    unknown
  >
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) {
    out[key] =
      isPlainObject(value) || Array.isArray(value)
        ? resolveSchemeSx(value, scheme)
        : value
  }
  if (scheme === 'dark' && isPlainObject(darkSlice)) {
    for (const [key, value] of Object.entries(darkSlice)) {
      const merged = mergeSchemeValue(out[key], value)
      if (merged === undefined) delete out[key]
      else out[key] = merged
    }
  }
  return out as T
}

export default resolveSchemeSx
