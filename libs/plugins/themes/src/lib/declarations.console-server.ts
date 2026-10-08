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

import { registerPluginThemePresets } from '@aglyn/aglyn/plugin-manager/plugin-theme-presets'
import { BUNDLE_ID } from './constants/bundle-common'
import { THEME_PRESETS } from './presets'

/**
 * The themes plugin's console-only server declarations, named under
 * `consoleServerDeclarations` in `plugins.config.json` (AGL-3660): the
 * built-in themes for a server job to start a site from — the AI site start
 * picks one as its base — the same list the theme picker shows.
 */
export function registerThemesConsoleServerDeclarations(): void {
  registerPluginThemePresets(THEME_PRESETS, { pluginId: BUNDLE_ID })
}
