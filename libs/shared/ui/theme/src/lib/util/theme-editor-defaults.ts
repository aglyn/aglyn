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

import type { HostThemeScheme } from '@aglyn/shared-data-types'
import {
  consoleOptions,
  consoleThemeDark,
  consoleThemeLight,
} from '../console.theme'
import {
  DEFAULT_TOOLBAR_SM,
  DEFAULT_TOOLBAR_XS,
  type ThemeColorToken,
} from './theme-editor-fields'

/**
 * What each theme editor control resolves to when the site sets nothing
 * (AGL-1180, AGL-2938): the brand theme every site is layered over.
 *
 * Read off the BUILT themes rather than the options, because text, divider
 * and the light and dark shades are derived by MUI, and the raw options would
 * leave those slots with nothing to report. The editor shows these beside
 * every "Default", and anything that proposes a change to a site's theme
 * reads the same values, so "the default primary" is one color wherever it
 * is named.
 *
 * Kept apart from `theme-editor-fields.ts` because this module builds the
 * brand themes when it loads, and the catalog is read where no theme needs
 * building.
 */

type PaletteRecord = Record<string, unknown>

function builtPalette(scheme: HostThemeScheme): PaletteRecord {
  return (scheme === 'dark' ? consoleThemeDark : consoleThemeLight)
    .palette as unknown as PaletteRecord
}

/** The color a slot renders in one scheme when the site leaves it unset. */
export function inheritedThemeColor(
  scheme: HostThemeScheme,
  token: ThemeColorToken,
): string | undefined {
  const palette = builtPalette(scheme)
  const [group, key] = token.split('.')
  const value =
    token === 'divider'
      ? palette['divider']
      : (palette[group] as PaletteRecord | undefined)?.[key ?? 'main']
  return typeof value === 'string' ? value : undefined
}

/**
 * The corner radius the brand theme ships. Read rather than written as a
 * literal, so the default the editor shows cannot stop matching the theme.
 */
export const INHERITED_BORDER_RADIUS =
  typeof consoleThemeLight.shape?.borderRadius === 'number'
    ? consoleThemeLight.shape.borderRadius
    : 4

/** The spacing unit the brand theme ships. */
export const INHERITED_SPACING =
  typeof consoleOptions.spacing === 'number' ? consoleOptions.spacing : 8

/**
 * The first family of the brand's font stack — what "Theme default" means in
 * the font select, named rather than left as a long CSS list.
 */
export const INHERITED_FONT_FAMILY = String(
  (consoleOptions.typography as { fontFamily?: string } | undefined)
    ?.fontFamily ?? '',
)
  .split(',')[0]
  .replace(/["']/g, '')
  .trim()

/** MUI's own toolbar heights, which apply while the site sets none. */
export const INHERITED_TOOLBAR_HEIGHTS = {
  xs: DEFAULT_TOOLBAR_XS,
  sm: DEFAULT_TOOLBAR_SM,
} as const
