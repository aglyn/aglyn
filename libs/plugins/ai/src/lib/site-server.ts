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
import { SITE_CHAT_HISTORY_ROUTE, SITE_CHAT_ROUTE } from './model/site-chat'
import { createSiteChatPageEnricher } from './server/site-chat-enricher'

/**
 * The AI plugin's published-site surface (AGL-4250): the site chat. Its own
 * module (`modules.tenantApi`), so a published site loads three route
 * registrations and the page enricher, never the console's AI doors. The
 * door's code and the Admin SDK reads behind it load on the first request.
 */
export function registerAiSiteApi(): void {
  registerSitePageEnricher(
    createSiteChatPageEnricher({
      readSettings: async (hostId) => (await import('./server/site-chat-page-reads')).readSiteChatSettingsDoc(hostId),
      flagOn: async (orgId) => (await import('./server/site-chat-page-reads')).siteChatReleasedFor(orgId),
    }),
  )
  registerPluginApiRoute(SITE_CHAT_ROUTE, {
    web: async (request) => (await import('./server/site-chat-platform')).siteChatDoor()(request),
  })
  registerPluginApiRoute(SITE_CHAT_HISTORY_ROUTE, {
    web: async (request) => (await import('./server/site-chat-platform')).siteChatHistoryDoor()(request),
  })
  registerPluginApiRoute(`${SITE_CHAT_ROUTE}/handoff`, {
    web: async (request) => (await import('./server/site-chat-platform')).siteChatHandOffDoor()(request),
  })
}
