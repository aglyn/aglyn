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

import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import { OUTREACH_PERMISSIONS } from './constants/bundle-common'

let declared = false

/**
 * The plugin's DECLARATIONS (AGL-4047): its permission keys (`outreach.use`), which
 * the one permission catalog lists beside the core keys. Loaded eagerly by
 * the console, client and server, through the generated declarations
 * manifests (the tenant runtime never loads it: the plugin is the console's
 * alone), so the role editor offers the keys, a
 * custom role or a per-member override keeps them, and a route resolves
 * them whether or not a request has touched the plugin yet. Light by
 * construction: nothing here reaches a provider, Firestore or React.
 */
export function registerOutreachConsoleDeclarations(): void {
  if (declared) return
  declared = true
  registerPluginPermissions(OUTREACH_PERMISSIONS)
}

registerOutreachConsoleDeclarations()
