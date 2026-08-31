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

import { createPluginLoader } from '@aglyn/aglyn/plugin-manager/plugin-loader'
import { TENANT_PLUGIN_MANIFEST } from './plugins.client.generated'

/**
 * The tenant site's plugin loader (AGL-417): activates the org-enabled site
 * plugins from the generated manifest before the canvas renders. One module
 * instance per bundle, so `ensure`'s cached promise is stable for React
 * `use()` suspension (SSR included — the server pass awaits the dynamic
 * imports, so published screens keep their full HTML).
 */
export const sitePluginLoader = createPluginLoader(TENANT_PLUGIN_MANIFEST)
