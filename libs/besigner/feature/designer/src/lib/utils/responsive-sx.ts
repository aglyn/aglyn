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

import { SX_SCHEME_DARK_KEY, type SxScheme } from '@aglyn/aglyn-node-renderer'
import { BesignerDeviceFlag } from '@aglyn/besigner'
import type { HostThemeScheme } from '@aglyn/shared-data-types'

/** MUI breakpoint keys, smallest to largest (`xs` doubles as the base). */
export const SX_BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'] as const
export type SxBreakpoint = (typeof SX_BREAKPOINTS)[number]

/**
 * The sx scheme scope a styles-panel edit should target for the given
 * artboard canvas scheme (AGL-588). Light is the base — only the dark
 * preview scopes edits into the {@link SX_SCHEME_DARK_KEY} slice — so
 * this returns null unless the artboard previews dark.
 */
export function canvasSchemeToSxScheme(
  scheme: HostThemeScheme | undefined,
): SxScheme | null {
  return scheme === 'dark' ? 'dark' : null
}

/**
 * The breakpoint a styles-panel edit should scope to for the given
 * artboard preview mode (AGL-333). Fluid/scale preview edits the base
 * value, so they return null.
 */
export function deviceFlagToBreakpoint(
  flag: BesignerDeviceFlag | undefined,
): SxBreakpoint | null {
  switch (flag) {
    case BesignerDeviceFlag.XS:
      return 'xs'
    case BesignerDeviceFlag.SM:
      return 'sm'
    case BesignerDeviceFlag.MD:
      return 'md'
    case BesignerDeviceFlag.LG:
      return 'lg'
    case BesignerDeviceFlag.XL:
      return 'xl'
    default:
      return null
  }
}

const isResponsiveObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) =>
    (SX_BREAKPOINTS as readonly string[]).includes(key),
  ) &&
  Object.keys(value).length > 0

/**
 * The value a property resolves to at a breakpoint, following MUI's
 * mobile-first cascade (a breakpoint inherits the nearest smaller slice).
 * `breakpoint: null` reads the base value.
 *
 * Scheme dimension (AGL-588): the persisted nesting is scheme OUTER,
 * breakpoints INNER — `sx['@scheme dark']` holds ordinary properties
 * whose values may be responsive objects. `scheme: 'dark'` reads the
 * dark slice first and falls back to the base, mirroring how the
 * renderer merges the slice over base styles at render time; `'light'`,
 * null, and undefined all read the base (light IS the base).
 */
export function readSxValue(
  sx: Record<string, any> | undefined,
  property: string,
  breakpoint: SxBreakpoint | null,
  scheme?: SxScheme | null,
): unknown {
  if (scheme === 'dark') {
    const slice = sx?.[SX_SCHEME_DARK_KEY] as Record<string, any> | undefined
    const override = readSxValue(slice, property, breakpoint)
    if (override !== undefined) return override
    return readSxValue(sx, property, breakpoint)
  }
  const value = sx?.[property]
  if (!isResponsiveObject(value)) return value
  if (breakpoint === null) return value['xs']
  const index = SX_BREAKPOINTS.indexOf(breakpoint)
  for (let i = index; i >= 0; i -= 1) {
    const slice = value[SX_BREAKPOINTS[i]]
    if (slice !== undefined) return slice
  }
  return undefined
}

/** Whether the property carries per-breakpoint overrides beyond the base. */
export function sxHasBreakpointOverrides(
  sx: Record<string, any> | undefined,
  property: string,
): boolean {
  const value = sx?.[property]
  return (
    isResponsiveObject(value) &&
    Object.keys(value).some((key) => key !== 'xs')
  )
}

/**
 * Returns a new sx object with `property` written at `breakpoint`
 * (`null` = base). Plain values promote to MUI's responsive-object form
 * only when a non-base breakpoint diverges; single-`xs` objects collapse
 * back to plain values; `undefined` clears the slice (and the property
 * once no slice remains).
 *
 * Scheme dimension (AGL-588): `scheme: 'dark'` applies the exact same
 * write to the {@link SX_SCHEME_DARK_KEY} slice instead of the base
 * (scheme OUTER, breakpoints INNER — see {@link readSxValue}); an empty
 * slice is removed entirely. `'light'`/null/undefined write the base.
 * Purely additive: sx documents without dark overrides never change
 * shape.
 */
export function writeSxValue(
  sx: Record<string, any> | undefined,
  property: string,
  value: unknown,
  breakpoint: SxBreakpoint | null,
  scheme?: SxScheme | null,
): Record<string, any> {
  if (scheme === 'dark') {
    const current = (sx?.[SX_SCHEME_DARK_KEY] ?? {}) as Record<string, any>
    const slice = writeSxValue(current, property, value, breakpoint)
    const next: Record<string, any> = { ...sx }
    if (Object.keys(slice).length === 0) delete next[SX_SCHEME_DARK_KEY]
    else next[SX_SCHEME_DARK_KEY] = slice
    return next
  }
  const next: Record<string, any> = { ...sx }
  const current = next[property]
  const key: SxBreakpoint = breakpoint ?? 'xs'

  const slices: Record<string, unknown> = isResponsiveObject(current)
    ? { ...current }
    : current !== undefined
      ? { xs: current }
      : {}

  if (value === undefined || value === '') delete slices[key]
  else slices[key] = value

  const keys = Object.keys(slices)
  if (keys.length === 0) {
    delete next[property]
  } else if (keys.length === 1 && keys[0] === 'xs') {
    next[property] = slices['xs']
  } else {
    next[property] = slices
  }
  return next
}
