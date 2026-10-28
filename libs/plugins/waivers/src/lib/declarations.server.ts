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
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { WAIVERS_PLUGIN_ID } from './constants/bundle-common'
import { WAIVERS_PERMISSION_DECLARATIONS } from './constants/permissions'

/**
 * Waivers' SERVER declarations (AGL-4042), loaded by both apps' servers
 * before any handler runs:
 *
 * - its two permissions, so a route's `resolveOrgPermissions` carries them;
 * - the person eraser, so erasing a customer erases what they signed.
 *
 * Its CRM capture door, `waiver`, is declared from `declarations`, which
 * both servers load too, so the console's browser labels it as well.
 *
 * The eraser reaches its module through a dynamic import, so nothing here
 * loads the data layer in an app's boot.
 */
export function registerWaiversServerDeclarations(): void {
  const owner = { pluginId: WAIVERS_PLUGIN_ID }
  registerPluginPermissions(WAIVERS_PERMISSION_DECLARATIONS)
  registerPluginPersonEraser(async (request) => {
    const { eraseWaiversPerson } = await import('./server/person-eraser')
    return eraseWaiversPerson(request)
  }, owner)
}

registerWaiversServerDeclarations()
