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

import { BesignerDeviceFlag } from '@aglyn/besigner'
import type { Theme } from '@aglyn/shared-ui-theme'

/**
 * Artboard device preview styling (AGL-581).
 *
 * CSS media queries always evaluate against the BROWSER viewport, so a
 * narrowed artboard never triggered visibility bands
 * (`@media (max-width:599.95px)` in node sx), breakpoint-scoped sx
 * values (`{ xs, sm, md }`), or MUI's own breakpoint-derived component
 * styles. When a device is selected in the toolbar the canvas now pins
 * both mechanisms to the device's width:
 *
 * - `resolveSxForDeviceWidth` statically evaluates width-only `@media`
 *   keys in node sx: matching slices inline where the key sat (keeping
 *   cascade order), off-device slices drop. Applied per-Leaf through
 *   `LeafSxTransformContext` — canvas only.
 * - `createDevicePinnedTheme` rebuilds the canvas theme's breakpoint
 *   helpers so every `theme.breakpoints.up/down/...` query is forced
 *   always-true or never-true for the device width. Responsive sx
 *   objects, Stack/Grid responsive props, and component styleOverrides
 *   all resolve through these helpers at render time.
 *
 * Fluid Responsive (the default) provides neither, so the canvas keeps
 * today's real-viewport behavior; the published tenant never sees any
 * of this.
 */

/**
 * The simulated viewport width per artboard device. XS mirrors the
 * artboard's 390px phone frame; the rest sit exactly on the theme
 * breakpoints so "SM - Tablet" activates the tablet band and the `sm`
 * slice of responsive values.
 */
export const DEVICE_PREVIEW_XS_WIDTH = 390

type BreakpointValues = Partial<
  Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number>
>

/**
 * The width the canvas should simulate for an artboard device flag, or
 * null when no device is pinned (Fluid Responsive / scale-to-fit).
 */
export function devicePreviewWidth(
  flag: BesignerDeviceFlag | undefined,
  breakpointValues: BreakpointValues = {},
): number | null {
  switch (flag) {
    case BesignerDeviceFlag.XS:
      return DEVICE_PREVIEW_XS_WIDTH
    case BesignerDeviceFlag.SM:
      return breakpointValues.sm ?? 600
    case BesignerDeviceFlag.MD:
      return breakpointValues.md ?? 900
    case BesignerDeviceFlag.LG:
      return breakpointValues.lg ?? 1200
    case BesignerDeviceFlag.XL:
      return breakpointValues.xl ?? 1536
    default:
      return null
  }
}

const MEDIA_CONDITION_PATTERN =
  /^\(\s*(min-width|max-width|width)\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i

const MEDIA_TYPE_PATTERN = /^(only\s+)?(all|screen)$/i

function evaluateWidthMediaClause(
  clause: string,
  width: number,
): boolean | null {
  let matches = true
  for (const rawPart of clause.split(/\band\b/i)) {
    const part = rawPart.trim()
    if (!part) return null
    if (MEDIA_TYPE_PATTERN.test(part)) continue
    const condition = MEDIA_CONDITION_PATTERN.exec(part)
    if (!condition) return null
    const feature = condition[1].toLowerCase()
    const value = parseFloat(condition[2])
    if (feature === 'min-width') matches = matches && width >= value
    else if (feature === 'max-width') matches = matches && width <= value
    else matches = matches && width === value
  }
  return matches
}

/**
 * Statically evaluates a width-only `@media` query at the given
 * viewport width. Returns null when the query involves anything beyond
 * px width conditions and the all/screen media types (color-scheme,
 * hover, em units…) — such queries must stay live in the browser.
 * Comma-separated clauses OR together, per the media-query spec.
 */
export function evaluateWidthMediaQuery(
  query: string,
  width: number,
): boolean | null {
  const conditions = query.replace(/^@media/i, '').trim()
  if (!conditions) return null
  let matches = false
  for (const clause of conditions.split(',')) {
    const verdict = evaluateWidthMediaClause(clause.trim(), width)
    if (verdict === null) return null
    matches = matches || verdict
  }
  return matches
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Returns a copy of an sx value with width-only `@media` slices
 * resolved at the device width: matching slices inline exactly where
 * the media key sat (later duplicate keys override earlier ones — the
 * same order the CSS cascade gives equal-specificity rules), and
 * off-device slices drop. Non-width media keys pass through untouched,
 * as do arrays (per-entry) and theme callbacks (wrapped).
 */
export function resolveSxForDeviceWidth<T>(sx: T, width: number): T {
  if (Array.isArray(sx)) {
    return sx.map((entry) => resolveSxForDeviceWidth(entry, width)) as T
  }
  if (typeof sx === 'function') {
    const callback = sx as (...args: unknown[]) => unknown
    return ((...args: unknown[]) =>
      resolveSxForDeviceWidth(callback(...args), width)) as T
  }
  if (!isPlainObject(sx)) return sx

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sx)) {
    if (key.trimStart().startsWith('@media')) {
      const verdict = evaluateWidthMediaQuery(key, width)
      if (verdict === null) {
        // Not a pure width query — leave it to the real viewport.
        out[key] = value
        continue
      }
      if (!verdict) continue // Off-device slice — dropped on canvas.
      const slice = resolveSxForDeviceWidth(value, width)
      if (!isPlainObject(slice)) continue
      for (const [sliceKey, sliceValue] of Object.entries(slice)) {
        out[sliceKey] =
          isPlainObject(out[sliceKey]) && isPlainObject(sliceValue)
            ? { ...(out[sliceKey] as object), ...sliceValue }
            : sliceValue
      }
      continue
    }
    out[key] =
      isPlainObject(value) || Array.isArray(value)
        ? resolveSxForDeviceWidth(value, width)
        : value
  }
  return out as T
}

type ThemeBreakpoints = Theme['breakpoints']
type BreakpointArg = string | number

/**
 * Returns breakpoint helpers whose queries are forced for the given
 * width: helpers whose real media query would match a `width`-wide
 * viewport emit an always-true query (a sub-pixel min-width), the rest
 * emit a never-true one (an unreachable min-width). Each helper/key
 * pair gets a distinct slot number so forced queries never collide
 * into one style-object key. `values`/`keys`/`unit` stay real —
 * components (e.g. MuiContainer) read them as pixel numbers.
 *
 * `internal_mediaKeys` is rebuilt from the pinned `up()` outputs so
 * MUI's style engine pre-seeds them in ascending-breakpoint order —
 * responsive sx slices keep mobile-first cascade order no matter what
 * order they were authored in.
 */
export function pinBreakpointsToWidth(
  breakpoints: ThemeBreakpoints,
  width: number,
): ThemeBreakpoints {
  const keys: readonly string[] = breakpoints.keys ?? [
    'xs',
    'sm',
    'md',
    'lg',
    'xl',
  ]
  const values = (breakpoints.values ?? {}) as Record<string, number>
  const unit = (breakpoints as { unit?: string }).unit ?? 'px'
  const step = (breakpoints as { step?: number }).step ?? 5

  const valueOf = (key: BreakpointArg): number | null => {
    const value = typeof key === 'number' ? key : values[key]
    return typeof value === 'number' ? value : null
  }
  const slotOf = (key: BreakpointArg): number =>
    typeof key === 'number'
      ? 60 + (Math.abs(Math.round(key)) % 900)
      : Math.max(0, keys.indexOf(key))
  const force = (matches: boolean, slot: number): string =>
    matches
      ? `@media (min-width:${slot / 1000}${unit})`
      : `@media (min-width:${100000 + slot}${unit})`

  // Match semantics mirror createBreakpoints exactly: up = min-width v,
  // down = max-width v - step/100, between = both.
  const upMatches = (key: BreakpointArg): boolean | null => {
    const value = valueOf(key)
    return value == null ? null : width >= value
  }
  const downMatches = (key: BreakpointArg): boolean | null => {
    const value = valueOf(key)
    return value == null ? null : width <= value - step / 100
  }
  const betweenMatches = (
    start: BreakpointArg,
    end: BreakpointArg,
  ): boolean | null => {
    const lower = upMatches(start)
    const upper = downMatches(end)
    return lower == null || upper == null ? null : lower && upper
  }
  const onlyMatches = (key: BreakpointArg): boolean | null => {
    const index = typeof key === 'number' ? -1 : keys.indexOf(key)
    return index !== -1 && index + 1 < keys.length
      ? betweenMatches(key, keys[index + 1])
      : upMatches(key)
  }

  const pinned: ThemeBreakpoints = {
    ...breakpoints,
    up: (key) => {
      const matches = upMatches(key)
      return matches == null
        ? breakpoints.up(key)
        : force(matches, slotOf(key))
    },
    down: (key) => {
      const matches = downMatches(key)
      return matches == null
        ? breakpoints.down(key)
        : force(matches, 1000 + slotOf(key))
    },
    between: (start, end) => {
      const matches = betweenMatches(start, end)
      return matches == null
        ? breakpoints.between(start, end)
        : force(matches, 2000 + slotOf(start) * 10 + slotOf(end))
    },
    only: (key) => {
      const matches = onlyMatches(key)
      return matches == null
        ? breakpoints.only(key)
        : force(matches, 3000 + slotOf(key))
    },
    not: (key) => {
      const matches = onlyMatches(key)
      return matches == null
        ? breakpoints.not(key)
        : force(!matches, 4000 + slotOf(key))
    },
  }
  ;(pinned as { internal_mediaKeys?: string[] }).internal_mediaKeys = keys.map(
    (key) => pinned.up(key as Parameters<ThemeBreakpoints['up']>[0]),
  )
  return pinned
}

/**
 * A canvas-only clone of the site theme pinned to the device width:
 * breakpoint helpers are forced (see {@link pinBreakpointsToWidth}) and
 * the toolbar mixin — whose real viewport queries were baked in at
 * createTheme time — is rebuilt against them. The dense xs-landscape
 * (48px) toolbar rule is intentionally omitted: device previews
 * simulate portrait-first widths, and that rule only exists for real
 * rotated phones.
 */
export function createDevicePinnedTheme(theme: Theme, width: number): Theme {
  const breakpoints = pinBreakpointsToWidth(theme.breakpoints, width)
  // Responsive font sizes (responsiveFontSizes) are baked into the
  // typography VARIANTS as literal `@media (min-width:…px)` string keys
  // at createTheme time — pinning the breakpoint helpers can't reach
  // them, so they'd keep matching the real browser viewport (AGL-593).
  // Flatten each variant object at the device width with the same
  // resolver Leaf sx uses; scalars and functions (pxToRem, fontFamily)
  // pass through untouched.
  const typography = Object.fromEntries(
    Object.entries(theme.typography as unknown as Record<string, unknown>).map(
      ([key, value]) => [
        key,
        value && typeof value === 'object' && !Array.isArray(value)
          ? resolveSxForDeviceWidth(value, width)
          : value,
      ],
    ),
  ) as unknown as Theme['typography']
  return {
    ...theme,
    breakpoints,
    typography,
    mixins: {
      ...theme.mixins,
      toolbar: {
        minHeight: 56,
        [breakpoints.up('sm')]: { minHeight: 64 },
      },
    },
  }
}
