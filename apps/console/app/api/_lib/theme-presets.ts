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

import type { ConsoleThemePreset } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import type { HostTheme } from '@aglyn/shared-data-types'

/**
 * The built-in themes as `/api/hosts/theme` offers them to an app that does
 * not run the themes plugin's console code (AGL-3668): enough to draw the
 * picker row (name, one line, three swatches); picking one sends only its id,
 * and the route reads the theme itself from the server's registry.
 */
export interface ThemePresetSummary {
  id: string
  name: string
  description: string
  /** The light scheme's primary, secondary and page colors, as stored; missing ones left out. */
  swatches: string[]
}

export function summarizeThemePresets(presets: readonly ConsoleThemePreset[]): ThemePresetSummary[] {
  return presets.map((preset) => {
    const light = preset.theme.colorSchemes?.light
    const swatches = [light?.primary?.main, light?.secondary?.main, light?.background?.default].filter(
      (color): color is string => typeof color === 'string' && color.length > 0,
    )
    return { id: preset.id, name: preset.name, description: preset.description ?? '', swatches }
  })
}

/** The theme a picked built-in id stands for, or undefined when no plugin registers it. */
export function presetTargetFromRegistry(
  id: string,
  presets: readonly ConsoleThemePreset[],
): { id: string; name: string; theme: HostTheme } | undefined {
  const preset = presets.find((entry) => entry.id === id)
  return preset ? { id: preset.id, name: preset.name, theme: preset.theme } : undefined
}
