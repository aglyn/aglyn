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

import { registerPluginJob } from '@aglyn/aglyn/server'
import { resumeScopeSweeps } from '@aglyn/tenant-data-admin/server/scope-sharing-sweep'

/**
 * Finishes the sharing sweeps a site change could not finish inline (AGL-4047).
 *
 * A CORE job for the reason `sending-domain-recheck-job.ts` gives: media and
 * every plugin's shared documents go through it, so no one plugin's switch may
 * decide whether it runs. It reads one document on a quiet beat.
 */
registerPluginJob({
  pluginId: 'core',
  name: 'resume-scope-sweeps',
  intervalMinutes: 5,
  description:
    'Finish keeping documents shared with all sites except some in step with ' +
    'the sites in their workspace.',
  lockdown: {
    scope: 'platform',
    reason:
      'Rewrites which sites an org-owned document names at orgs/{orgId}/… and ' +
      'resolves no host. A locked site named on a document serves nothing ' +
      'because of it, since the lock stops the serving, and taking a site off ' +
      'a list is the direction a lock points.',
  },
  handler: async () => {
    const tally = await resumeScopeSweeps()
    if (tally.droppedAfterFailing) {
      console.error(
        `scope sweeps: gave up on ${tally.droppedAfterFailing}; the weekly drift report counts what they left`,
      )
    }
  },
})
