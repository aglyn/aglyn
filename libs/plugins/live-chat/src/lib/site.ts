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

import { registerSiteRuntime } from '@aglyn/aglyn/plugin-manager/site-runtime'
import { LiveChatRuntime } from './components/live-chat-runtime'

/**
 * The site half (AGL-3698): the launcher runtime the tenant page mounts. The
 * loader fetches this module only on a page whose enricher answered a chat
 * slice, so a page without the chat never downloads it.
 */
export function registerLiveChatSite(): void {
  registerSiteRuntime({
    // Literals, not the constants: the contribution check reads this call
    // statically and holds it to `contributes.site.features` (AGL-3116).
    // `site.spec.ts` holds them to LIVE_CHAT_RUNTIME_ID.
    pluginId: 'live-chat',
    runtimeId: 'live-chat-launcher',
    Component: LiveChatRuntime,
  })
}
