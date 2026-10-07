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

import { mdiCreation } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useConsoleHostRoute, useHostOrgId, useUser } from '@aglyn/tenant-feature-instance'
import { Button } from '@mui/material'
import { useState } from 'react'
import { AiInsightDialog } from './ai-insight-dialog.component'
import { useAiJobsVerdict } from './use-ai-job-run'

/**
 * "Ask AI about these numbers" (AGL-3603), in the header of the marketing
 * plugin's Conversions section and of one campaign's report, through the zone
 * that plugin hosts there.
 *
 * It opens the insight dialog the Assist panel opens, on the `marketing`
 * surface: the question starts an `insight` job, which reads the site's
 * figures through the readers the owning plugins publish — the campaigns, the
 * conversions they were credited with, the revenue they earned, the forms and
 * the traffic — and every insight it keeps cites the rows its numbers come
 * from. Nothing is changed or sent.
 *
 * The props restate the half of the zone's contract this widget reads.
 */

/** What the `marketingInsights` zone hands this widget. */
export interface AiMarketingInsightButtonProps {
  hostId: string | null
  subject: 'conversions' | 'campaign'
  campaign: string | null
}

/** The question the dialog opens on, from what the report is about. */
export function aiMarketingInsightQuestion(
  subject: AiMarketingInsightButtonProps['subject'],
  campaign: string | null,
): string {
  if (subject === 'campaign' && campaign) {
    return `How did the campaign “${campaign}” do — what did it cause, and what did it earn?`
  }
  return 'Which campaigns brought in the most conversions, and what did they earn?'
}

export function AiMarketingInsightButton(props: AiMarketingInsightButtonProps) {
  const { hostId, subject, campaign } = props
  const { data: user } = useUser()
  const orgId = useHostOrgId(hostId ?? undefined) ?? undefined
  const verdict = useAiJobsVerdict(user, orgId)
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const [open, setOpen] = useState(false)

  // The figures are one site's: with no site there is nothing to read.
  if (!hostId || !orgId || verdict !== 'ready') return null

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MdiIcon path={mdiCreation.path} />}
        onClick={() => setOpen(true)}
      >
        {'Ask AI about these numbers'}
      </Button>
      <AiInsightDialog
        open={open}
        onClose={() => setOpen(false)}
        orgId={orgId}
        orgSlug={orgSlug ?? ''}
        hostId={hostId}
        host={subdomain}
        surface="marketing"
        user={user}
        uid={user?.uid ?? null}
        question={aiMarketingInsightQuestion(subject, campaign)}
      />
    </>
  )
}
AiMarketingInsightButton.displayName = 'AiMarketingInsightButton'

export default AiMarketingInsightButton
