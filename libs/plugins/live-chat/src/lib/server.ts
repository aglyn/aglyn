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
import { registerSitePageEnricher } from '@aglyn/aglyn/plugin-manager/site-page-hooks'
import { LIVE_CHAT_SETTINGS_ROUTE } from './constants'
import { createLiveChatSitePageEnricher } from './server/site-page-enricher'

/**
 * The tenant half (AGL-3698): the page enricher that hands a page its chat
 * slice. The Admin SDK loads with the first site that runs the chat; every
 * other site's compose stops at the plugin switch it already holds.
 */
export function registerLiveChatApi(): void {
  registerSitePageEnricher(
    createLiveChatSitePageEnricher({
      readSettings: async (hostId) =>
        (await import('./server/platform-deps')).readLiveChatSettingsDoc(hostId),
    }),
  )
}

/** The console half: the settings card's route. */
export function registerLiveChatConsoleApi(): void {
  registerPluginApiRoute(LIVE_CHAT_SETTINGS_ROUTE, async (req, res) =>
    (await import('./server/platform-deps')).liveChatSettingsHandler()(req, res),
  )
}
