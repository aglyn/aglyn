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

import { registerPluginApiRoute } from '@aglyn/aglyn/app-utils/api-plugins'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { registerFunnelFigureReaders } from './server/funnel-figures'
import {
  funnelsDeleteHandler,
  funnelsInventoryHandler,
  funnelsProposeHandler,
  funnelsResultsHandler,
  funnelsSaveHandler,
} from './server/funnels-api'

/**
 * The funnels plugin's console API (AGL-3605): its five doors under
 * `/api/funnels/*`, and the `funnels.*` figure readers the AI insight job
 * reads from the same process.
 */
export function registerFunnelsConsoleApi(): void {
  registerPluginApiRoute('funnels/inventory', funnelsInventoryHandler)
  registerPluginApiRoute('funnels/results', funnelsResultsHandler)
  registerPluginApiRoute('funnels/save', funnelsSaveHandler)
  registerPluginApiRoute('funnels/delete', funnelsDeleteHandler)
  registerPluginApiRoute('funnels/propose', funnelsProposeHandler)
  registerFunnelFigureReaders(() => firebaseAdmin.app().firestore())
}
