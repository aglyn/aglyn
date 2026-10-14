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

import type {
  PluginEgressHostDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'

/**
 * Tidio and LiveChat (AGL-3698): each the merchant's OWN chat account, which
 * the merchant signed up for, contracts with and names to their site by its
 * public key or license number. Aglyn's servers send the vendor nothing: the
 * plugin's code puts the vendor's loader on the merchant's published pages,
 * and the VISITOR'S browser talks to the vendor from there — only after the
 * visitor pressed the chat launcher, or, where the merchant chose to load it
 * with the page, after the visitor's recorded consent grants analytics. So
 * each loader host is a destination the customer chose, the shape the
 * marketplaces and delivery apps already take.
 */

const BROWSER_ONLY =
  'Nothing from the platform’s servers. The site visitor’s browser loads the vendor’s widget, which then sends the vendor what the visitor types into the chat, the page they are on and the browser’s technical details (IP address, user agent, language), and stores the vendor’s own visitor identifier in the browser. No account, payment or order data the platform holds is sent.'

export const LIVE_CHAT_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: 'code.tidio.co',
    disposition: 'not-a-subprocessor',
    reason:
      'Customer-chosen destination. Tidio’s widget loader for the merchant’s own Tidio account, named by the public key a site admin saves in the Live chat card, added to that site’s published pages by `libs/plugins/live-chat/src/lib/loader.ts` only when a visitor asks for the chat (or, where the merchant chose it, once the visitor’s consent grants analytics). The widget then reaches Tidio’s own hosts, which the tenant policy admits for that site alone.',
    dataReceived: BROWSER_ONLY,
  },
  {
    host: 'cdn.livechatinc.com',
    disposition: 'not-a-subprocessor',
    reason:
      'Customer-chosen destination. LiveChat’s widget loader for the merchant’s own LiveChat account, named by the license number a site admin saves in the Live chat card, added to that site’s published pages by `libs/plugins/live-chat/src/lib/loader.ts` only when a visitor asks for the chat (or, where the merchant chose it, once the visitor’s consent grants analytics). The widget then reaches LiveChat’s own hosts, which the tenant policy admits for that site alone.',
    dataReceived: BROWSER_ONLY,
  },
]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen chat service. */
export function liveChatSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: LIVE_CHAT_HOSTS }
}
