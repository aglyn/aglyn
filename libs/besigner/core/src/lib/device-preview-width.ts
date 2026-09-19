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

// By path, not the barrel: the flag enum alone, without the managers and
// controllers the barrel evaluates.
import { BesignerDeviceFlag } from './constants/besigner'

/**
 * The width of the artboard's phone frame, and the viewport width XS - Mobile
 * previews a page at.
 */
export const DEVICE_PREVIEW_XS_WIDTH = 390

/** A theme's breakpoint values, as `theme.breakpoints.values` holds them. */
export type DevicePreviewBreakpointValues = Partial<
  Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number>
>

/**
 * The viewport width the device switcher previews a page at (AGL-581), or
 * null when no device is pinned (Fluid Responsive, scale to fit).
 *
 * XS is the artboard's phone frame; SM, MD, LG and XL sit exactly on the
 * site theme's own breakpoints, so "SM - Tablet" activates the tablet band
 * and the `sm` slice of responsive values. The defaults are MUI's, for a
 * theme that names none.
 *
 * This is the one notion of what each device is. The canvas pins its theme to
 * it, and the AI plugin's device-width audit renders every golden page at it
 * (AGL-3020): a page the audit passed at a width the switcher does not show
 * would be a page nobody looked at.
 */
export function devicePreviewWidth(
  flag: BesignerDeviceFlag | undefined,
  breakpointValues: DevicePreviewBreakpointValues = {},
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
