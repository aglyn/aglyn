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

import { AppLink } from '@aglyn/shared-ui-jsx'
import type { MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AI_JOB_PHASE_LABELS,
  aiJobPhase,
  type AiJobPhase,
} from '../model/ai-job-activity'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import { AiJobPlan } from './ai-job-plan.component'
import { cancelAiJobRequest, resumeAiJobRequest } from './ai-job-requests'
import { openAiJobs, publishAiJob } from './ai-jobs-store'
import { followAiJobEvents } from './ai-job-events'
import { aiJobPrimaryLink } from './ai-job-links'
import { aiJobProblem } from './use-ai-job-run'

/**
 * A JOB, WATCHED AND DECIDED WHERE IT WAS STARTED (AGL-3593).
 *
 * The dialog that starts a planned job — "Plan my site", "Plan the page" —
 * used to end on a sentence pointing at a drawer a person had to go and find,
 * and a person who could not find it never got their site built. This is
 * what such a dialog shows instead, once its job exists:
 *
 *  - where the job stands, live — queued, planning, plan ready, building,
 *    then done or failed — read from the same events route the AI jobs
 *    drawer follows;
 *  - the plan, once it is ready, with the drawer's own plan component and its
 *    Confirm, through the same request the drawer sends
 *    ({@link resumeAiJobRequest}), and Cancel beside it;
 *  - once it is done, the one action that opens what it built;
 *  - and always "Open AI jobs", which follows the job anywhere else in the
 *    console.
 *
 * Closing the dialog stops following; the job carries on, and the top-bar
 * indicator, the Assist launcher and the notification the machine raises say
 * when it needs the person again.
 */

export interface AiJobFollowProps {
  /** The job as the create door answered with it. */
  job: AiJobSummary
  orgId: string
  /**
   * Path slug for the link to what the job built. A dialog mounted on a
   * console page that names its org can leave it out: the slug is the first
   * segment of every org-scoped console address.
   */
  orgSlug?: string | null
  user: MaybeTokenSource
  /** What the dialog says about the job it started, above its live status. */
  intro: string
  /**
   * Closes the dialog. Called beside opening AI jobs, because a dialog
   * covers the panel AI jobs opens in.
   */
  onOpenJobs?: () => void
  /** The viewer is staff (AGL-3078): a refused answer's details are theirs to open. */
  staff?: boolean
}

/** What the status line says in each phase, and how loudly. */
const PHASE_LINE: Readonly<
  Record<AiJobPhase, { severity: 'info' | 'warning' | 'success' | 'error'; text: string }>
> = {
  queued: { severity: 'info', text: 'Queued. It starts in a moment.' },
  planning: { severity: 'info', text: 'Planning. The plan appears here when it is ready.' },
  'plan-ready': {
    severity: 'warning',
    text: 'Your plan is ready. Read it below and confirm it to build — nothing is built until you do.',
  },
  building: { severity: 'info', text: 'Building. Everything it builds is an unpublished draft.' },
  attention: { severity: 'warning', text: 'The job stopped and needs you.' },
  done: { severity: 'success', text: 'Done. Your drafts are ready to open.' },
  failed: { severity: 'error', text: 'The job stopped before it finished.' },
  canceled: { severity: 'info', text: 'The job was canceled.' },
}

/** The org slug a console address names: its first segment. */
function orgSlugFromLocation(): string {
  const path = typeof globalThis.location?.pathname === 'string' ? globalThis.location.pathname : ''
  return path.split('/')[1] ?? ''
}

/** Follows `initial` through the events route while mounted, and lets a decision replace it. */
export function useFollowedAiJob(
  user: MaybeTokenSource,
  orgId: string,
  initial: AiJobSummary,
): [AiJobSummary, (job: AiJobSummary) => void] {
  const userRef = useRef(user)
  userRef.current = user
  const [job, setJob] = useState(initial)
  useEffect(() => setJob(initial), [initial])

  // One stream while the job is moving. A job parked for the person settles
  // the stream; confirming moves it again, and the status change re-opens it.
  const moving = job.status === 'queued' || job.status === 'running'
  useEffect(() => {
    if (!moving) return undefined
    const controller = new AbortController()
    void followAiJobEvents(() => userRef.current, orgId, job.id, controller.signal, setJob)
    return () => controller.abort()
  }, [moving, orgId, job.id])

  const replace = useCallback((next: AiJobSummary) => {
    publishAiJob(next)
    setJob(next)
  }, [])
  return [job, replace]
}

export function AiJobFollow({
  job: initial,
  orgId,
  orgSlug,
  user,
  intro,
  onOpenJobs,
  staff = false,
}: AiJobFollowProps) {
  const [job, replace] = useFollowedAiJob(user, orgId, initial)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const phase = aiJobPhase(job)
  const line = PHASE_LINE[phase]
  const moving = phase === 'queued' || phase === 'planning' || phase === 'building'
  const settled = AI_JOB_TERMINAL_STATUSES.includes(job.status)
  const primary = aiJobPrimaryLink(job, orgSlug || orgSlugFromLocation())
  const problem = phase === 'attention' || phase === 'failed' ? aiJobProblem(job, line.text) : null
  const stepsDone = job.steps.filter((step) => step.status === 'done').length

  const decide = useCallback(
    async (request: () => ReturnType<typeof resumeAiJobRequest>) => {
      setBusy(true)
      setNotice(null)
      const { job: next, error } = await request()
      if (next) replace(next)
      if (error) setNotice(error)
      setBusy(false)
    },
    [replace],
  )

  const openJobs = () => {
    openAiJobs({ jobId: job.id })
    onOpenJobs?.()
  }

  return (
    <Stack spacing={2} aria-live="polite">
      <Typography variant="body2" color="text.secondary">
        {intro}
      </Typography>
      <Alert
        severity={line.severity}
        icon={moving ? <CircularProgress size={18} aria-label={AI_JOB_PHASE_LABELS[phase]} /> : undefined}
        action={
          <Button color="inherit" size="small" variant="outlined" onClick={openJobs}>
            {'Open AI jobs'}
          </Button>
        }
      >
        <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Chip size="small" label={AI_JOB_PHASE_LABELS[phase]} />
          {job.steps.length > 1 ? (
            <Typography variant="caption" color="text.secondary">
              {`${stepsDone} of ${job.steps.length} steps`}
            </Typography>
          ) : null}
        </Stack>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {problem ?? line.text}
        </Typography>
      </Alert>
      {primary ? (
        <Box>
          <Button variant="contained" component={AppLink} href={primary.href}>
            {primary.label}
          </Button>
        </Box>
      ) : null}
      {/* The drawer's own plan and its Confirm, on the drawer's request. */}
      <AiJobPlan
        job={job}
        onResume={(target) => void decide(() => resumeAiJobRequest(user, orgId, target))}
        busy={busy}
        staff={staff}
        // "Use the starter site instead" on a guided start that did not work out (AGL-3594).
        user={user ?? undefined}
      />
      {!settled ? (
        <Box>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void decide(() => cancelAiJobRequest(user, orgId, job.id))}
          >
            {'Cancel job'}
          </Button>
        </Box>
      ) : null}
      {notice ? <Alert severity="warning">{notice}</Alert> : null}
    </Stack>
  )
}

export default AiJobFollow
