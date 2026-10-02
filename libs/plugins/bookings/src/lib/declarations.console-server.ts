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

// The registry's own module, not the `@aglyn/aglyn/server` barrel: boot needs
// one registry, not the whole server surface.
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The bookings plugin's CONSOLE-ONLY server declarations (AGL-3080), named
 * under `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. The tenant runtime registers none of it.
 *
 * Its share of a person erasure: every booking the person made on a site of
 * the workspace keeps its service and its time, with the person taken off it
 * (`server/person-eraser.ts`). Declared `requiredPersonEraser`, because the
 * erasure promises it — a console whose boot skipped this refuses to erase.
 *
 * Light at boot: the eraser and the Admin SDK it brings load with the first
 * erasure. Registering again replaces this plugin's own.
 */
export function registerBookingsConsoleServerDeclarations(): void {
  registerPluginPersonEraser(
    async (request) => (await import('./server/person-eraser')).bookingsPersonEraser(request),
    { pluginId: BUNDLE_ID },
  )
}
