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
import { WEGLOT_CONNECT_HOSTS } from './constants'

/**
 * Weglot (AGL-3700) is MERCHANT-PROVIDED: the merchant signs up with Weglot,
 * pays Weglot, and pastes their own project's public key. Aglyn's servers
 * never call Weglot and hold no Weglot account; the visitor's browser loads
 * Weglot's script on the merchant's site because the merchant chose it. So no
 * host below is an Aglyn sub-processor — each is `not-a-subprocessor` on the
 * registry's "the customer rather than Aglyn chose it" term — and the evidence
 * is written down for each.
 */
const MERCHANT_CHOSE =
  'Reached only from a visitor’s browser on a published site whose admin switched the Weglot plugin on and entered their own Weglot project key (the runtime in `libs/plugins/weglot/src/lib/weglot-loader.ts`); the merchant engaged Weglot, not the platform, and no platform server calls it.'

const HOST_ROLES: Record<(typeof WEGLOT_CONNECT_HOSTS)[number], string> = {
  'cdn.weglot.com':
    'Weglot’s CDN: the `weglot.min.js` script, its stylesheet, the project settings (`/projects-settings/{key}.json`) and the switcher’s flag images.',
  'cdn-api-weglot.com':
    'Weglot’s translation API (`/translate`, `/translations/slugs`), which answers the translations for the page the visitor is reading.',
  'api.weglot.com':
    'Weglot’s API (`/project-settings`, and `/pageviews` when the merchant’s Weglot project counts page views).',
}

export const WEGLOT_HOSTS: PluginEgressHostDeclaration[] = WEGLOT_CONNECT_HOSTS.map(
  (host) => ({
    host,
    disposition: 'not-a-subprocessor' as const,
    reason: `${HOST_ROLES[host]} ${MERCHANT_CHOSE}`,
    dataReceived:
      'From the visitor’s browser: the merchant’s public project key, the text of the page being translated, the page address, the language chosen and the browser’s language, with the request metadata any website load carries (IP address, user agent). Nothing from the platform’s servers, and no workspace data beyond what the published page already shows.',
  }),
)

/** The plugin's `subprocessors` entry: no Aglyn recipient, only the merchant’s vendor’s hosts. */
export function weglotSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: WEGLOT_HOSTS }
}
