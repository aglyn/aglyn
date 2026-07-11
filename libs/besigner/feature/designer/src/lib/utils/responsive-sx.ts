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

/** MUI breakpoint keys, smallest to largest (`xs` doubles as the base). */
export const SX_BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'] as const
export type SxBreakpoint = (typeof SX_BREAKPOINTS)[number]

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
 */
export function readSxValue(
  sx: Record<string, any> | undefined,
  property: string,
  breakpoint: SxBreakpoint | null,
): unknown {
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
 */
export function writeSxValue(
  sx: Record<string, any> | undefined,
  property: string,
  value: unknown,
  breakpoint: SxBreakpoint | null,
): Record<string, any> {
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
