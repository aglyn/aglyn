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
import { Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { aiBuildCanRetry, aiBuildItemRows, aiBuildOutcomeLine } from '../model/ai-build-progress'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import type { AssistBuildProposal } from '../model/assist-build'
import { followAiJobEvents } from './ai-job-events'
import { AiJobPlan } from './ai-job-plan.component'
import { resumeAiJobRequest } from './ai-job-requests'
import { openAiJobs } from './ai-jobs-store'

/**
 * The one card a build proposed in the chat becomes (AGL-3616): while its
 * job plans, a line saying so; then the job's own plan card, with its one
 * price and Confirm — the same `AiJobPlan` the AI jobs drawer shows, so
 * confirming here and there is one door; then where the build stands, item
 * by item, with AI jobs a click away. The job itself is started by the
 * panel, once, when the turn that proposed it ends; this card only follows
 * it, so re-rendering a stored thread never starts a second build.
 */
export interface AssistBuildCardProps {
  proposal: AssistBuildProposal
  /** The job the proposal started, as last seen; `null` while it is being created. */
  job: AiJobSummary | null
  /** Why the job could not be created or confirmed, when it could not. */
  notice: string | null
  orgId: string
  user: MaybeTokenSource
  staff?: boolean
  /** The job as it moved, for the thread to keep. */
  onJob: (job: AiJobSummary) => void
  onNotice: (notice: string | null) => void
}

const ITEM_STATES = { done: 'built', active: 'building', waiting: 'waiting', failed: 'failed', skipped: 'not built' } as const

export function AssistBuildCard({
  proposal,
  job,
  notice,
  orgId,
  user,
  staff = false,
  onJob,
  onNotice,
}: AssistBuildCardProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  const userRef = useRef(user)
  userRef.current = user
  const onJobRef = useRef(onJob)
  onJobRef.current = onJob

  // Follow a job that is still planning or building; a plan waiting for its
  // confirmation and a settled job need nothing more from the stream.
  const following = Boolean(job && !AI_JOB_TERMINAL_STATUSES.includes(job.status) && job.status !== 'needs_review')
  const jobId = job?.id ?? null
  useEffect(() => {
    if (!following || !jobId) return
    const controller = new AbortController()
    void followAiJobEvents(() => userRef.current, orgId, jobId, controller.signal, (next) => onJobRef.current(next))
    return () => controller.abort()
  }, [following, jobId, orgId])

  const resume = async (target: AiJobSummary, options?: { publish?: boolean; retry?: 'failed-items' }) => {
    setBusy(true)
    onNotice(null)
    const decision = await resumeAiJobRequest(user, orgId, target, options)
    if (decision.job) onJob(decision.job)
    if (decision.error) onNotice(decision.error)
    setBusy(false)
  }

  const settled = job ? AI_JOB_TERMINAL_STATUSES.includes(job.status) : false
  const outcome = job ? aiBuildOutcomeLine(job) : null
  return (
    <Paper variant="outlined" sx={{ mt: 1, p: 1.5 }} aria-label="Build plan">
      <Typography variant="subtitle2">{proposal.summary}</Typography>
      {!job && !notice && (
        <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center' }}>
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary">
            {'Planning what to build on this site…'}
          </Typography>
        </Stack>
      )}
      {notice && (
        <Typography variant="body2" color="error" sx={{ mt: 0.5 }} role="alert">
          {notice}
        </Typography>
      )}
      {job && job.status === 'needs_review' && (
        <AiJobPlan job={job} busy={busy} staff={staff} user={user} onResume={(target, options) => void resume(target, options)} />
      )}
      {job && following && (
        <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center' }}>
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary">
            {job.plan?.status === 'confirmed'
              ? 'Building each part in turn. What it makes is an unpublished draft unless you chose to publish.'
              : 'Planning what to build on this site…'}
          </Typography>
        </Stack>
      )}
      {job && (job.items?.length ?? 0) > 0 && job.status !== 'needs_review' && (
        <Box component="ul" aria-label="Items" sx={{ m: 0, mt: 0.5, pl: 2 }}>
          {aiBuildItemRows(job).map((row) => (
            <Typography key={row.slot} component="li" variant="caption" data-item-state={row.state}>
              {`${row.label} — ${ITEM_STATES[row.state]}`}
              {row.detail ? `. ${row.detail}` : ''}
            </Typography>
          ))}
        </Box>
      )}
      {settled && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {outcome ?? job?.error ?? ''}
        </Typography>
      )}
      {job && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {job && aiBuildCanRetry(job) && (
            <Button size="small" variant="contained" disabled={busy} onClick={() => void resume(job, { retry: 'failed-items' })}>
              {'Try again what failed'}
            </Button>
          )}
          <Button size="small" onClick={() => openAiJobs({ jobId: job.id })}>
            {'Open in AI jobs'}
          </Button>
        </Stack>
      )}
    </Paper>
  )
}
