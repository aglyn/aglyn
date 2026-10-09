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

import { registerPluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import { registerSitePageEnricher } from '@aglyn/aglyn/plugin-manager/site-page-hooks'
import { getPluginConfig } from '@aglyn/tenant-data-admin/server/realm-plugins'
import { WEGLOT_PLUGIN_ID } from './constants'
import { WEGLOT_CONFIG_SCHEMA } from './model/weglot-settings'
import { createWeglotSitePageEnricher } from './server/site-page-enricher'

let registered = false

/**
 * The plugin's tenant server half (AGL-3700): the page enricher that decides
 * whether a published page carries Weglot. No API routes — Weglot is reached
 * from the visitor's browser only, with the merchant's own public key.
 */
export function registerWeglotApi(): void {
  if (registered) return
  registered = true
  registerPluginConfigSchema(WEGLOT_CONFIG_SCHEMA)
  registerSitePageEnricher(
    createWeglotSitePageEnricher((orgId, hostId) =>
      getPluginConfig(orgId, WEGLOT_PLUGIN_ID, { hostId }),
    ),
  )
}
