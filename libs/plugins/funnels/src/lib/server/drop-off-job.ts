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

import type {
  PluginConsoleCronContext,
  PluginConsoleCronReport,
} from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { runDropOffSweep } from './drop-off-sweep'

/**
 * The drop-off sweep on the platform (AGL-3605): the Admin SDK, and the host
 * event bus the automation engine listens on. Loaded by the console job with
 * its first tick.
 */
export function runFunnelsDropOffJob(context: PluginConsoleCronContext): Promise<PluginConsoleCronReport> {
  return runDropOffSweep(
    {
      firestore: firebaseAdmin.app().firestore(),
      emit: async (hostId, event, payload) => {
        await emitHostEvent(hostId, event as never, payload, { actor: { kind: 'platform' } })
      },
    },
    context,
  )
}
