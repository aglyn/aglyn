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

import { featureLockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { registerAiJobPauseReader } from './ai-jobs'

/**
 * A workspace whose AI staff have paused runs none of its queued AI jobs
 * (AGL-3037).
 *
 * The staff org page's Pause AI writes `ai-generate` for ONE workspace on the
 * lockdown carrier (`feature--ai-generate--org--{orgId}`), and every jobs door
 * refuses a request for that workspace through `featureLockdownRefusal`, the
 * rung of the gate ladder. A job queued before the pause has no request to
 * refuse, so the machine asks the same verdict, with the same arguments,
 * before it claims a step: the platform lock, then `ai-generate`
 * platform-wide, then the pause for the job's workspace — with the staff
 * bypass the ladder grants, which only an inline door's caller can carry.
 *
 * Registered by a call from the console surface, the one app that runs jobs,
 * so the machine itself never loads the Admin SDK the lockdown reads run on.
 */
export async function isAiGenerationPausedFor(input: {
  orgId: string
  staff: boolean
}): Promise<boolean> {
  const refusal = await featureLockdownRefusal({
    feature: 'ai-generate',
    staff: input.staff,
    orgId: input.orgId,
  })
  return refusal !== null
}

/** Registers the pause the jobs machine asks before it claims a step. */
export function registerAiJobsPause(): void {
  registerAiJobPauseReader(isAiGenerationPausedFor)
}
