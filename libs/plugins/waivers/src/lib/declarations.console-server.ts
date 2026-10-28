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
import { WAIVERS_PLUGIN_ID } from './constants/bundle-common'

/** The retention job's id: its health row and its beat document. */
export const WAIVERS_RETENTION_JOB_ID = 'waivers-retention'

/**
 * Waivers' console boot registrations (AGL-4042): the retention job, on the
 * console's fifteen-minute tick, which stamps a site's signed waivers again
 * when the store changes its retention period, and deletes each signed
 * waiver once that period has run out. The job, the Admin SDK and the
 * settings read load with the first tick, through this plugin's own module.
 */
export function registerWaiversConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: WAIVERS_RETENTION_JOB_ID,
      label: 'Waiver retention',
      drives:
        'Deletes each signed waiver, with its drawn signature and paper photo, once the store’s retention period has run out, and applies a changed period to the waivers already signed. If it stops, signed waivers are kept past their period.',
      run: async (context) => (await import('./server/retention-job')).runWaiversRetentionJob(context),
    },
    { pluginId: WAIVERS_PLUGIN_ID },
  )
}
