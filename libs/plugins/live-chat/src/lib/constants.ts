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

/**
 * Live chat (AGL-3698): the merchant's OWN Tidio or LiveChat account on their
 * site's pages. These are the ids every surface of the plugin agrees on.
 */

export const LIVE_CHAT_PLUGIN_ID = 'live-chat'

/** The console card in the site setup page's `hostSettings` zone. */
export const LIVE_CHAT_WIDGET_ID = 'live-chat-settings'

/** The site runtime the tenant mounts: the launcher and the vendor loader. */
export const LIVE_CHAT_RUNTIME_ID = 'live-chat-launcher'

/** The console card's route: read and save a site's chat settings. */
export const LIVE_CHAT_SETTINGS_ROUTE = 'live-chat/settings'

/**
 * The page-props key the enricher writes and the runtime reads. Absent on a
 * page the chat does not show on, which is also what keeps this plugin's site
 * bundle off that page (`requiredSitePlugins` counts only contributors).
 */
export const LIVE_CHAT_PAGE_PROP = 'liveChat'

/**
 * The site settings document, `hosts/{hostId}/pluginSettings/live-chat`.
 * Written only by the settings route (the rules refuse a client write).
 */
export const LIVE_CHAT_SETTINGS_COLLECTION = 'pluginSettings'

/** How many page addresses one site may list for "only" or "except". */
export const LIVE_CHAT_MAX_PATHS = 50

/** The longest page address a list may hold. */
export const LIVE_CHAT_MAX_PATH_LENGTH = 200

/**
 * The tab's "this visitor asked for the chat" mark, keyed by site. A visitor
 * who opened the chat keeps it on the next page they load in the same tab,
 * so a conversation is not dropped by a full navigation.
 */
export const LIVE_CHAT_SESSION_KEY_PREFIX = 'aglyn:live-chat:'

/**
 * Carried by every script element this plugin adds. Teardown removes only
 * marked elements, so a chat a merchant embedded some other way is never ours
 * to touch. Its value is the provider id.
 */
export const LIVE_CHAT_SCRIPT_ATTRIBUTE = 'data-aglyn-live-chat'

/** How long the vendor has to say it is ready before the launcher gives up. */
export const LIVE_CHAT_READY_TIMEOUT_MS = 20_000
