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

import type { ConsoleThemePreset } from './feature-plugins'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * The built-in themes as the console's SERVER reads them (AGL-3660).
 *
 * The theme picker lists presets from the console extensions the theme page
 * loads, which never run in an API process. A server job that starts a site
 * from one of them — the AI site start picks a base theme and layers the
 * site's own look over it as an override, exactly as a person's pick and
 * edits are stored (`theme-library.ts`) — reads the same presets here, each
 * plugin registering its list from its server declarations.
 */
export interface PluginThemePresets {
  presets: readonly ConsoleThemePreset[]
}

export const PLUGIN_THEME_PRESETS = definePluginServiceContract<PluginThemePresets>(
  'core.theme.presets',
  { multiple: true },
)

/** Registers a plugin's built-in themes for server readers. */
export function registerPluginThemePresets(
  presets: readonly ConsoleThemePreset[],
  options: { pluginId: string },
): void {
  registerPluginService(PLUGIN_THEME_PRESETS, { presets }, { pluginId: options.pluginId })
}

/**
 * Every built-in theme the server has registered, in registration order, the
 * first preset under an id winning, as the picker lists them.
 */
export function listServerThemePresets(): ConsoleThemePreset[] {
  const seen = new Set<string>()
  const out: ConsoleThemePreset[] = []
  for (const entry of resolvePluginServices(PLUGIN_THEME_PRESETS)) {
    for (const preset of entry.impl.presets ?? []) {
      if (!preset?.id || seen.has(preset.id)) continue
      seen.add(preset.id)
      out.push(preset)
    }
  }
  return out
}
