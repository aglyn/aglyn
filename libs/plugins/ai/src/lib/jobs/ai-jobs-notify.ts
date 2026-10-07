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

import { notifyUsers } from '@aglyn/tenant-data-admin/server/notifications'
import { aiJobNotice } from '../model/ai-job-notice'
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
    await notify([job.createdBy], aiJobNotice(job, to))
  }
}

/** Registers the notifier the jobs machine tells about each change. */
export function registerAiJobsNotify(): void {
  registerAiJobTransitionListener(aiJobTransitionNotifier())
}
