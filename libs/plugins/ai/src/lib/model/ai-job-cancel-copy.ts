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

import type { AiJobSummary } from './ai-jobs.types'

/**
 * What every surface that cancels an AI job says (AGL-3616): the job's page,
 * a row of the site's AI jobs list, and the AI jobs list the top-bar chip
 * opens. One wording, so a person reads the same promise wherever they stop
 * a job.
 */

/** The confirm dialog's title. */
export const AI_JOB_CANCEL_TITLE = 'Cancel this AI job?'

/** What canceling does, said before it is done. */
export const AI_JOB_CANCEL_CONFIRM_COPY =
  'Stop building. Pages already built stay as drafts; you won’t be charged for steps that haven’t run.'

/** While the step in flight finishes or stops. */
export const AI_JOB_CANCELING_COPY =
  'Stopping. The step in progress finishes or stops first, and nothing after it runs.'

/** What a canceled job's page says under its heading. */
export const AI_JOB_CANCELED_LEDE =
  'You canceled this job. Anything it already built stays as an unpublished draft, and nothing was published.'

/**
 * Why a job cannot be canceled, or `null` when it can: one that is done,
 * failed or already canceled has nothing left to stop, and one already
 * stopping needs no second cancel. The button stays, disabled, with this as
 * its reason.
 */
export function aiJobCancelBlockedReason(
  job: Pick<AiJobSummary, 'status'> & Partial<Pick<AiJobSummary, 'cancelRequested'>>,
): string | null {
  switch (job.status) {
    case 'done':
      return 'This job already finished.'
    case 'failed':
      return 'This job already stopped.'
    case 'canceled':
      return 'This job was canceled.'
    default:
      return job.cancelRequested ? AI_JOB_CANCELING_COPY : null
  }
}

/**
 * What a canceled job cost (AGL-3616): the credits its finished steps used,
 * which stay charged, less anything given back. "This job used 42 credits
 * before it stopped." — or that it used none.
 */
export function aiJobCanceledCreditsCopy(
  job: Partial<Pick<AiJobSummary, 'creditsSpent' | 'refundedCredits'>>,
): string {
  const net = Math.max(0, Math.floor((job.creditsSpent ?? 0) - (job.refundedCredits ?? 0)))
  if (net === 0) return 'This job used no credits before it stopped.'
  return `This job used ${net} ${net === 1 ? 'credit' : 'credits'} before it stopped.`
}
