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

import { registerConsoleExtension } from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import { THEME_PRESETS } from './presets'

/**
 * Built-in themes (AGL-3405): contributes Bootstrap, Minimal and Material 3
 * to every site's theme picker through `ConsoleExtension.themePresets`.
 *
 * Nothing else: no page, no widget and no server surface. A theme a site
 * picks is copied onto the site and edited as an override there, so the
 * published page never loads this plugin — the console's theme page is the
 * one place it is fetched.
 */
export function registerThemesConsole(): void {
  registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Themes',
    themePresets: THEME_PRESETS,
  })
}
