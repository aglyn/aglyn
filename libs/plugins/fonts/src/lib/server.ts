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

import { registerPluginApiRoute } from '@aglyn/aglyn/app-utils/api-plugins'
import { FONTS_PREPARE_ROUTE, FONTS_THEME_ROUTE } from './installer/constants'

/**
 * The fonts plugin's console doors (AGL-3656), named in `plugins.config.json`
 * as `consoleApi`, each loaded on its first request so the console's server
 * pays nothing for them at boot:
 *
 * - `/api/fonts/cost` — what a theme's fonts cost a visitor, for the font
 *   picker's cost badge;
 * - `/api/fonts/prepare` — checks, converts and subsets an uploaded font
 *   (harfbuzz's WASM loads with it);
 * - `/api/fonts/theme` — installs, lists, roles and removes a site's own
 *   fonts for an app that holds no theme draft (AGL-3668).
 */
export function registerFontsConsoleApi(): void {
  registerPluginApiRoute('fonts/cost', async (req, res) =>
    (await import('./server/font-cost-route')).fontCostHandler(req, res),
  )
  registerPluginApiRoute(FONTS_PREPARE_ROUTE, {
    web: async (request) => (await import('./server/prepare-route')).prepareFontRoute(request),
  })
  registerPluginApiRoute(FONTS_THEME_ROUTE, {
    web: async (request) => (await import('./server/theme-route')).fontsThemeRoute(request),
  })
}
