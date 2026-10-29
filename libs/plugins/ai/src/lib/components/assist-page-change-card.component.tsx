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

import type { MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { AppLink, HelpTip } from '@aglyn/shared-ui-jsx'
import { Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import { assistPageChangeOutput, type AssistPageChangeProposal } from '../model/assist-page-change'
import { followAiJobEvents } from './ai-job-events'
import { aiJobOutputHref } from './ai-job-links'

/**
 * A change to a page the site already has, asked in the chat (AGL-4116):
 * the edit job making it, then the draft it made, opened in the Besigner,
 * where the person checks it and publishes it. No plan, no AI jobs page.
 */

export interface AssistPageChangeCardProps {
  proposal: AssistPageChangeProposal
  /** The edit job, as last seen; `null` while it is being created. */
  job: AiJobSummary | null
  /** Why the job could not be started, when it could not. */
  notice: string | null
  orgId: string
  orgSlug: string
  user: MaybeTokenSource
  /** The job as it moved, for the thread to keep. */
  onJob: (job: AiJobSummary) => void
  /** Starts the same change again, after it failed. */
  onRetry: () => void
  busy?: boolean
}

const ASSIST_PAGE_CHANGE_HELP = pluginDocsHelp('aiAssistBuilds', {
  anchor: '#change-a-page',
  excerpt:
    'The change is saved as a new draft of the page. Open it in the Besigner to check it and publish it; until then visitors see the page as it is.',
})

export function assistPageChangeMakingCopy(pageName: string): string {
  return `Making the change as a draft of ${pageName}…`
}

export function assistPageChangeReadyCopy(pageName: string): string {
  return `Your draft of ${pageName} is ready. Visitors see the page as it is until you publish the draft.`
}

export function AssistPageChangeCard({
  proposal,
  job,
  notice,
  orgId,
  orgSlug,
  user,
  onJob,
  onRetry,
  busy = false,
}: AssistPageChangeCardProps): JSX.Element {
  const userRef = useRef(user)
  userRef.current = user
  const onJobRef = useRef(onJob)
  onJobRef.current = onJob

  // Follow the job until it settles; one waiting on the person has nothing
  // more to say on the stream.
  const following = Boolean(
    job && !AI_JOB_TERMINAL_STATUSES.includes(job.status) && job.status !== 'needs_review' && job.status !== 'needs_input',
  )
  const jobId = job?.id ?? null
  useEffect(() => {
    if (!following || !jobId) return
    const controller = new AbortController()
    void followAiJobEvents(() => userRef.current, orgId, jobId, controller.signal, (next) => onJobRef.current(next))
    return () => controller.abort()
  }, [following, jobId, orgId])

  const output = assistPageChangeOutput(job)
  const href = output ? aiJobOutputHref(output, orgSlug) : null
  const stopped = Boolean(job && (job.status === 'failed' || job.status === 'canceled'))
  const waiting = Boolean(job && (job.status === 'needs_review' || job.status === 'needs_input'))

  return (
    <Paper variant="outlined" sx={{ mt: 1, p: 1.5 }} aria-label="Page change">
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2">{proposal.summary}</Typography>
        <HelpTip {...ASSIST_PAGE_CHANGE_HELP} />
      </Stack>
      {(!job && !notice) || following ? (
        <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center' }}>
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary">
            {assistPageChangeMakingCopy(proposal.pageName)}
          </Typography>
        </Stack>
      ) : null}
      {notice && (
        <Typography variant="body2" color="error" sx={{ mt: 0.5 }} role="alert">
          {notice}
        </Typography>
      )}
      {output && (
        <>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {assistPageChangeReadyCopy(proposal.pageName)}
          </Typography>
          {href && (
            <Button size="small" variant="contained" component={AppLink} href={href} sx={{ mt: 1 }}>
              {'Open in the Besigner'}
            </Button>
          )}
        </>
      )}
      {waiting && (
        <Typography variant="body2" sx={{ mt: 0.5 }} role="alert">
          {job?.review?.message ?? job?.error ?? 'The change is waiting on you.'}
        </Typography>
      )}
      {stopped && (
        <>
          <Typography variant="body2" color="error" sx={{ mt: 0.5 }} role="alert">
            {job?.error ?? 'The change could not be made.'}
          </Typography>
          <Button size="small" sx={{ mt: 1 }} disabled={busy} onClick={onRetry}>
            {'Try again'}
          </Button>
        </>
      )}
    </Paper>
  )
}
