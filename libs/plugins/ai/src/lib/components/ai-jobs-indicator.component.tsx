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
'use client'

import { checkEntitlement, type ConsoleTopBarZoneProps } from '@aglyn/aglyn'
import { mdiAutoFix } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Chip, CircularProgress, Tooltip } from '@mui/material'
import { aiJobsActivityLabel } from '../model/ai-job-activity'
import { aiPermissionsOf } from '../model/ai-permissions'
import { openAiJobs, useAiJobsActivity } from './ai-jobs-store'

/**
 * The AI jobs indicator in the console's top bar (AGL-3593), on the
 * `consoleTopBar` zone: one small chip while any of the workspace's jobs is
 * moving or waiting on a person, saying which — `AI · plan ready` before
 * `AI · needs attention` before `AI · planning` — and how many. Pressing it
 * opens AI jobs in the Assist panel on the job that has waited longest.
 *
 * Nothing at all when nothing is in flight, so a workspace with no AI work
 * sees the bar it always had. It reads the shared list the launcher's badge
 * and the drawer read ({@link useAiJobsActivity}): one read per page load,
 * and a re-read only while something is moving.
 *
 * Gated as the plugin's other generative widgets are — the plan's
 * `aiGenerative` and the reader's `ai.generate` at registration — and, here,
 * on the two release flags the drawer it opens needs: `release_ai_generative`
 * for the jobs, `release_assist` for the panel they are listed in. The
 * reader's `ai.generate` on the site in view is asked again, because on a
 * site's pages a collaborator's permission is the site's, not the org's.
 */
export function AiJobsTopBarIndicator({
  scopedOrgId,
  org,
  orgReady,
  releaseVerdict,
  permissionsOnHost,
  productName,
}: ConsoleTopBarZoneProps) {
  const { data: user } = useUser()
  const generate =
    permissionsOnHost?.loaded === true &&
    aiPermissionsOf(permissionsOnHost.granted)['ai.generate'] === true
  const visible =
    Boolean(scopedOrgId) &&
    orgReady &&
    checkEntitlement(org as never, 'aiGenerative') &&
    releaseVerdict('release_ai_generative').visible &&
    releaseVerdict('release_assist').visible &&
    generate
  const activity = useAiJobsActivity(user, scopedOrgId, visible)
  if (!visible || !activity) return null

  const waiting = activity.state !== 'running'
  return (
    <Tooltip title={`Open AI jobs in ${productName} Assist`}>
      <Chip
        size="small"
        clickable
        color={waiting ? 'warning' : 'primary'}
        variant={waiting ? 'filled' : 'outlined'}
        icon={
          waiting ? (
            <MdiIcon path={mdiAutoFix.path} />
          ) : (
            <CircularProgress size={12} color="inherit" aria-hidden />
          )
        }
        label={aiJobsActivityLabel(activity)}
        aria-label={`${aiJobsActivityLabel(activity)}. Open AI jobs`}
        onClick={() => openAiJobs({ jobId: activity.job.id })}
        data-ai-jobs-state={activity.state}
        sx={{ mx: 0.5 }}
      />
    </Tooltip>
  )
}
AiJobsTopBarIndicator.displayName = 'AiJobsTopBarIndicator'

export default AiJobsTopBarIndicator
