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
import { recheckSendingDomains } from '@aglyn/tenant-data-admin'

/**
 * Re-check verified sending domains on the platform job beat.
 *
 * ## Why this rides the beat rather than getting a schedule of its own
 *
 * `/api/plugins/run-jobs` already fires every minute from the project's one
 * Cloud Scheduler job, and adding a second scheduled route means adding a
 * runner entry, an inventory row and a monitor — three things that can be
 * moved apart from each other, which is exactly how a job gets orphaned. The
 * beat's due-ness check turns an interval into a schedule for free, and the
 * sweep itself is bounded by a batch size rather than by how long the beat
 * gives it.
 *
 * ## Why it is a CORE job and not the email plugin's
 *
 * The runner subtracts a release-flagged-off plugin's jobs, and org enablement
 * can switch a plugin off entirely. Neither may decide whether a domain is
 * still allowed to be signed for: a workspace with the email plugin turned off
 * still has hosts whose `sendingDomain` points at a record here, and that
 * record's trust must not outlive its DNS because of a flag. `core` ids pass
 * the release filter untouched.
 */

/**
 * The namespace `publish-schedule-job.ts` established for jobs that are core
 * rather than a plugin's. The registry never interprets `pluginId`; it only
 * has to be stable and not collide with a bundle id.
 */
const CORE_JOB_NAMESPACE = 'core'

export const RECHECK_SENDING_DOMAINS_JOB = 'recheck-sending-domains'

/**
 * Hourly, against a daily per-domain staleness floor.
 *
 * The two are deliberately different numbers. The floor is what decides how
 * often any one customer's DNS is read; the beat interval only decides how
 * finely the batches are spread. An hourly beat with a 25-domain batch drains
 * 600 domains a day against a population re-read once a day, so the queue
 * stays short without the sweep ever landing as one large burst of DNS
 * lookups.
 */
const RECHECK_INTERVAL_MINUTES = 60

registerPluginJob({
  pluginId: CORE_JOB_NAMESPACE,
  name: RECHECK_SENDING_DOMAINS_JOB,
  intervalMinutes: RECHECK_INTERVAL_MINUTES,
  description:
    'Re-read the DNS for verified sending domains and un-verify the ones ' +
    'whose records are conclusively gone.',
  /*
   * PLATFORM scope, and the reason is that there is no host anywhere in this
   * job's data. It reads and writes `orgs/{orgId}/sendingDomains/{domain}` and
   * resolves no site: it could not ask the gate a question if it wanted to.
   *
   * The declaration is also true in the sense the contract means rather than
   * only in the sense the data allows. A lock exists to stop work happening
   * for a locked site, and the strongest thing this job does is make a site
   * REFUSE to send — the same direction a lock points. It never restores a
   * domain, never moves a host's mail onto another identity, and never writes
   * anything a suspended site benefits from.
   */
  lockdown: {
    scope: 'platform',
    reason:
      'Re-reads DNS for org-owned sending domains and resolves no host. Its ' +
      'strongest effect is to make sends REFUSE, which is the direction a ' +
      'lock points rather than something a lock would withhold.',
  },
  handler: async () => {
    const summary = await recheckSendingDomains()
    if (summary.revoked || summary.counted) {
      console.warn(
        `sending domains: ${summary.revoked} un-verified, ` +
          `${summary.counted} failing, ${summary.held} inconclusive ` +
          `(${summary.checked} checked)`,
      )
    }
  },
})
