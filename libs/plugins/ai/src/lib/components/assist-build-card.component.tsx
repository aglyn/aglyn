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
import { HelpTip } from '@aglyn/shared-ui-jsx'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { aiBuildCanRetry, aiBuildItemRows, aiBuildOutcomeLine, aiBuildRetryCreditRange } from '../model/ai-build-progress'
import { aiCreditRangeText, type AiCreditsPrompt } from '../model/ai-credit-estimate'
import { AiCreditsPromptNotice } from './ai-credits-prompt.component'
import { aiCreditsBillingHref, aiStoreFinishLinks } from './ai-job-links'
import { AiStoreFinishCard } from './ai-store-finish-card.component'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import type { AssistBuildProposal } from '../model/assist-build'
import { followAiJobEvents } from './ai-job-events'
import { AiJobPlan } from './ai-job-plan.component'
import { resumeAiJobRequest, type AiJobResumeOptions } from './ai-job-requests'
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
  /** The workspace's path slug, for Upgrade on a Free build past what is left or paused (AGL-3722). */
  orgSlug?: string | null
}

/** The card's own section of the Assist builds guide (AGL-3660). */
const ASSIST_BUILD_HELP = pluginDocsHelp('aiAssistBuilds', {
  anchor: '#the-plan-card',
  excerpt:
    'What one request will build, item by item, with its estimate. Nothing is built until you choose Confirm plan, and what it makes is a draft.',
})

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
  orgSlug,
}: AssistBuildCardProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  // A Free Try again past what is left (AGL-3722): its prompt, until chosen.
  const [retryPrompt, setRetryPrompt] = useState<AiCreditsPrompt | null>(null)
  const userRef = useRef(user)
  userRef.current = user
  const onJobRef = useRef(onJob)
  onJobRef.current = onJob

  // Follow a job that is still planning or building; a plan waiting for its
  // confirmation and a settled job need nothing more from the stream.
  // A build the meter paused (AGL-3722) waits for Resume, not the stream.
  const paused = job?.status === 'needs_input'
  const following = Boolean(
    job && !AI_JOB_TERMINAL_STATUSES.includes(job.status) && job.status !== 'needs_review' && !paused,
  )
  const jobId = job?.id ?? null
  useEffect(() => {
    if (!following || !jobId) return
    const controller = new AbortController()
    void followAiJobEvents(() => userRef.current, orgId, jobId, controller.signal, (next) => onJobRef.current(next))
    return () => controller.abort()
  }, [following, jobId, orgId])

  const resume = async (target: AiJobSummary, options?: AiJobResumeOptions) => {
    setBusy(true)
    onNotice(null)
    setRetryPrompt(null)
    const decision = await resumeAiJobRequest(user, orgId, target, options)
    if (decision.job) onJob(decision.job)
    // A Free Try again past what is left asks with its choices; a plan's
    // card draws its own from the job the door answered with.
    if (decision.credits && options?.retry) setRetryPrompt(decision.credits)
    else if (decision.error && !(decision.credits && target.status === 'needs_review')) onNotice(decision.error)
    setBusy(false)
  }
  const retryRange = job && aiBuildCanRetry(job) ? aiBuildRetryCreditRange(job) : null

  const settled = job ? AI_JOB_TERMINAL_STATUSES.includes(job.status) : false
  const outcome = job ? aiBuildOutcomeLine(job) : null
  // A build that made the site a store (AGL-3676) ends with what is left before it sells.
  const storeFinish = job && orgSlug ? aiStoreFinishLinks(job, orgSlug) : null
  return (
    <Paper variant="outlined" sx={{ mt: 1, p: 1.5 }} aria-label="Build plan">
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2">{proposal.summary}</Typography>
        <HelpTip {...ASSIST_BUILD_HELP} />
      </Stack>
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
        <AiJobPlan
          job={job}
          busy={busy}
          staff={staff}
          user={user}
          orgSlug={orgSlug}
          onResume={(target, options) => void resume(target, options)}
        />
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
      {job && paused && (
        // Out of credits mid-build (AGL-3722): paused, never failed. What is
        // built is kept, and Resume carries on from the next item.
        <Alert
          severity="warning"
          sx={{ mt: 0.5 }}
          action={
            <Stack direction="row" spacing={1}>
              {orgSlug ? (
                <Button color="inherit" size="small" href={aiCreditsBillingHref(orgSlug)}>
                  {'Upgrade'}
                </Button>
              ) : null}
              <Button color="inherit" size="small" disabled={busy} onClick={() => void resume(job)}>
                {'Resume'}
              </Button>
            </Stack>
          }
        >
          {`Paused. ${job.error ?? 'Your AI credits ran out.'} What is built so far is kept, and Resume carries on from the next item once you upgrade or your credits renew.`}
        </Alert>
      )}
      {job && retryPrompt && (
        <AiCreditsPromptNotice
          prompt={retryPrompt}
          noun="build"
          orgSlug={orgSlug}
          busy={busy}
          onBuildWhatFits={() => void resume(job, { retry: 'failed-items', creditsConfirmed: true })}
        />
      )}
      {settled && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {outcome ?? job?.error ?? ''}
        </Typography>
      )}
      {storeFinish && (
        <Box sx={{ mt: 1 }}>
          <AiStoreFinishCard steps={storeFinish} />
        </Box>
      )}
      {job && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {job && aiBuildCanRetry(job) && (
            <Button size="small" variant="contained" disabled={busy} onClick={() => void resume(job, { retry: 'failed-items' })}>
              {retryRange ? `Try again what failed · ${aiCreditRangeText(retryRange)}` : 'Try again what failed'}
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
