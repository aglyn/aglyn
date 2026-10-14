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
import { registerPluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import { WeglotSiteRuntime } from './components/weglot-site-runtime'
import { WEGLOT_PLUGIN_ID, WEGLOT_RUNTIME_ID } from './constants'
import { WEGLOT_CONFIG_SCHEMA } from './model/weglot-settings'

/**
 * The plugin's SITE surface (AGL-3700): the runtime the tenant page renders
 * on every page of a site that switched Weglot on. A site that has not
 * switched it on never loads this module — the plugin is off per site until
 * an admin turns it on (`defaultOffPerSite`).
 */
export function registerWeglotSite(): void {
  registerPluginConfigSchema(WEGLOT_CONFIG_SCHEMA)
  registerSiteRuntime({
    pluginId: WEGLOT_PLUGIN_ID,
    runtimeId: WEGLOT_RUNTIME_ID,
    Component: WeglotSiteRuntime,
  })
}
