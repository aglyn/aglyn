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

import { createPluginLoader } from '@aglyn/aglyn'
import { CONSOLE_PLUGIN_MANIFEST } from './plugins.client.generated'
import { registerPluginDeclarations } from './plugins.declarations.generated'

/**
 * The plugins' declarations (AGL-2939) ride with the loader module, which
 * every console shell imports: the staff lockdown page lists a plugin's
 * levers and the billing pages fold its add-on before any org's plugins
 * have been activated. They load like the plugins do, so the plugins gate
 * holds the first paint on this rather than reading an empty catalog.
 */
export const pluginDeclarationsReady: Promise<void> = registerPluginDeclarations()

/**
 * The console's plugin loader (AGL-417): activates the org-enabled plugins
 * from the generated manifest — 'console' surfaces (nav + pages) behind the
 * providers gate, 'site' surfaces (canvas components) on the editor pages.
 * One module instance per bundle so registration is shared and cached.
 */
export const consolePluginLoader = createPluginLoader(CONSOLE_PLUGIN_MANIFEST)
