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

import {
  CONSENT_ANALYTICS_VENDORS_PROP,
  type SitePageEnricher,
} from '@aglyn/aglyn/plugin-manager/site-page-hooks'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { LIVE_CHAT_PAGE_PROP, LIVE_CHAT_PLUGIN_ID } from '../constants'
import { liveChatProvider } from '../model/providers'
import {
  liveChatSliceForPage,
  readStoredLiveChatSettings,
} from '../model/settings'

export interface LiveChatEnricherDeps {
  /** The site's stored settings document, or null when there is none. */
  readSettings: (hostId: string) => Promise<unknown>
}

/**
 * The page's chat slice (AGL-3698), or nothing.
 *
 * Runs on every compose of every site, so it answers from the documents the
 * loader already holds wherever it can: a site that has not switched Live
 * chat on — the plugin is off for a site until that site turns it on — costs
 * no read at all. Only a site that runs it reads its settings document.
 *
 * A chat set to load with the page also names its vendor under the shared
 * `consentAnalyticsVendors` prop, which the consent banner reads.
 *
 * Answers `{}` (not `{ liveChat: null }`) where the chat does not show, so
 * the plugin is not counted a contributor to the page and its site bundle
 * stays off it (`requiredSitePlugins`).
 */
export function createLiveChatSitePageEnricher(deps: LiveChatEnricherDeps): SitePageEnricher {
  return async ({ hostId, host, org, path, pathUnknown }) => {
    if (!hostId || !isHostPluginEnabled(org ?? null, host ?? null, LIVE_CHAT_PLUGIN_ID)) return {}
    const settings = readStoredLiveChatSettings(await deps.readSettings(hostId))
    const slice = liveChatSliceForPage(settings, path, Boolean(pathUnknown))
    if (!slice) return {}
    // Loaded with the page only on an analytics grant, so the banner that
    // asks for that grant names the chat too.
    const vendor = slice.loadWithPage ? liveChatProvider(slice.provider)?.label : null
    return {
      [LIVE_CHAT_PAGE_PROP]: slice,
      ...(vendor ? { [CONSENT_ANALYTICS_VENDORS_PROP]: [`${vendor} chat`] } : {}),
    }
  }
}
