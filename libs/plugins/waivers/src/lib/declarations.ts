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
import { WAIVERS_PERMISSION_DECLARATIONS } from './constants/permissions'

let declared = false

/**
 * The plugin's client DECLARATIONS (AGL-4047): its permission keys, which the
 * one permission catalog lists beside the core keys. The servers register
 * them from `declarations.server`; this is the console browser's half, so
 * the role editor and a member's Permissions section offer them before any
 * waivers page has loaded. Light by construction: nothing here reaches
 * Firestore or React.
 */
export function registerWaiversDeclarations(): void {
  if (declared) return
  declared = true
  registerPluginPermissions(WAIVERS_PERMISSION_DECLARATIONS)
}

registerWaiversDeclarations()
