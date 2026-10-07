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

import { registerPluginConsoleCron } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { BUNDLE_ID } from './constants/bundle-common'

/** The drop-off sweep's job id: its health row and its beat document. */
export const FUNNELS_DROP_OFF_JOB_ID = 'funnels-drop-off'

/**
 * The funnels plugin's console boot registrations (AGL-3605): the drop-off
 * sweep, on the console's fifteen-minute tick. The sweep, the Admin SDK and
 * the host event bus load with the first tick, through this plugin's own
 * module.
 */
export function registerFunnelsConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: FUNNELS_DROP_OFF_JOB_ID,
      label: 'Funnel drop-off follow-ups',
      drives:
        'Raises “Left a funnel” for each person who identified themselves on a site and stopped at a funnel step its automations watch. If it stops, no drop-off automation starts.',
      run: async (context) => (await import('./server/drop-off-job')).runFunnelsDropOffJob(context),
    },
    { pluginId: BUNDLE_ID },
  )
}
