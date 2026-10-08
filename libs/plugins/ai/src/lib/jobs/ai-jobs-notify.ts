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

import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { notifyUsers } from '@aglyn/tenant-data-admin/server/notifications'
import { raiseOperatorAlert } from '@aglyn/tenant-data-admin/server/operator-alerts'
import { AI_BUILD_PARTLY_FAILED, AI_JOB_FAILED } from '../operator-alerts'
import { aiJobNotice } from '../model/ai-job-notice'
import { aiBusinessProfilePrefiller } from './ai-business-profile-prefill'
import { aiJobAutoConfirms } from './ai-job-auto-confirm'
import { registerAiJobTransitionListener, type AiJobTransitionListener } from './ai-jobs'

/**
 * The person who started an AI job is told when it needs them, when it
 * finishes and when it stops (AGL-3593), through the console's notifications
 * — the bell, and the generic notification email for a person who switched
 * that channel on for the category. No other channel: there is no push.
 *
 * The machine calls this where the job's state changes, once per change
 * (`registerAiJobTransitionListener`): the request that ran a step inline,
 * or the beat that ran it with nobody watching — which is exactly when a
 * person needs telling. The recipient is the job's creator, whose job it is
 * and who alone confirms its plan; a teammate is not told about someone
 * else's draft.
 *
 * `notifyUsers` never throws, and honors the person's per-category,
 * per-workspace and per-site preferences.
 */
export function aiJobTransitionNotifier(
  notify: typeof notifyUsers = notifyUsers,
): AiJobTransitionListener {
  return async ({ job, to }) => {
    if (!job.createdBy) return
    // A guided site start's plan is confirmed for it the moment it is kept
    // (AGL-3594): there is nothing for the person to confirm.
    if (to === 'needs-review' && job.review?.reason === 'plan' && aiJobAutoConfirms(job)) return
    await notify([job.createdBy], aiJobNotice(job, to))
  }
}

/** The longest runner error an alert quotes; the log has the rest. */
const ALERT_ERROR_MAX = 300

/** At most this many failed parts are named in a partial-build alert. */
const ALERT_ITEMS_MAX = 5

const capped = (text: string): string =>
  text.length > ALERT_ERROR_MAX ? `${text.slice(0, ALERT_ERROR_MAX)}…` : text

/**
 * Staff are told when a job fails on our side (`ai.jobFailed`), and when a
 * build finishes `done` with parts that failed on our side
 * (`ai.buildPartlyFailed`) — each deduped per job kind, so a broken provider
 * or a broken step is heard about the hour it starts. A failure that is the
 * customer's — the model declined the brief or a part of it, the site
 * switched AI off — raises nothing. `raiseOperatorAlert` never throws.
 */
export function aiJobFailureAlerter(
  raise: typeof raiseOperatorAlert = raiseOperatorAlert,
): AiJobTransitionListener {
  return async ({ job, to, failure }) => {
    if (to === 'done') {
      const items = job.items ?? []
      const ours = items.filter((row) => row.status === 'failed' && row.failure?.ours)
      if (!ours.length) return
      const named = ours
        .slice(0, ALERT_ITEMS_MAX)
        .map((row) => `${row.label} (${row.failure?.reason}${row.failure?.detail ? `: ${row.failure.detail}` : ''})`)
        .join('; ')
      await raise(AI_BUILD_PARTLY_FAILED, {
        dedupeKey: job.kind,
        orgId: job.orgId,
        ...(job.hostId ? { hostId: job.hostId } : {}),
        context: {
          kind: job.kind,
          jobId: job.$id,
          orgId: job.orgId,
          failed: ours.length,
          total: items.length,
          items: capped(ours.length > ALERT_ITEMS_MAX ? `${named}; and ${ours.length - ALERT_ITEMS_MAX} more` : named),
        },
      })
      return
    }
    if (to !== 'failed' || !failure?.ours) return
    const error = failure.error ?? job.error ?? 'no error recorded'
    await raise(AI_JOB_FAILED, {
      dedupeKey: job.kind,
      orgId: job.orgId,
      ...(job.hostId ? { hostId: job.hostId } : {}),
      context: {
        kind: job.kind,
        jobId: job.$id,
        orgId: job.orgId,
        step: failure.stepIndex === null ? 'n/a' : job.steps[failure.stepIndex]?.name ?? failure.stepIndex,
        error: capped(error),
      },
    })
  }
}

/**
 * Registers what the jobs machine tells about each change: the notifier, the
 * staff alert for a failure on our side, and the business profile's prefill
 * from a site job (AGL-3661). One listener, each in turn; the alert and the
 * prefill swallow their own failures, so neither costs the person their notice.
 */
export function registerAiJobsNotify(): void {
  const notify = aiJobTransitionNotifier()
  const alert = aiJobFailureAlerter()
  const prefill = aiBusinessProfilePrefiller(() => firebaseAdmin.app().firestore())
  registerAiJobTransitionListener(async (change) => {
    await notify(change)
    await alert(change)
    await prefill(change)
  })
}
