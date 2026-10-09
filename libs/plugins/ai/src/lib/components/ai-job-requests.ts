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

import { authorizedFetch, type MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { AI_CREDITS_CONFIRM_CODE, type AiCreditsPrompt } from '../model/ai-credit-estimate'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { assistBuildJobRequest, type AssistBuildProposal } from '../model/assist-build'
import { publishAiJob } from './ai-jobs-store'

/**
 * The two decisions a person makes about a job — confirm its plan (or try a
 * refused step again), and cancel it — as ONE request each, whichever
 * surface they press it on (AGL-3593). The AI jobs drawer and the dialog that
 * started the job both call these, so confirming in the dialog is the same
 * door, the same body and the same answer as confirming in the drawer.
 *
 * Each hands the job it gets back to every counting surface, so the top-bar
 * indicator stops saying "plan ready" the moment the plan is confirmed.
 */

/** A door's answer: the job as it now stands, and the refusal when there is one. */
export interface AiJobDecision {
  job: AiJobSummary | null
  error: string | null
  /**
   * A Free job past what is left (AGL-3722): the door's 409 asks for the
   * person's go-ahead with these figures and choices instead of starting it.
   */
  credits?: AiCreditsPrompt | null
}

/**
 * What a resume asks beyond confirming (AGL-3616): a build's plan confirmed
 * with its publish box ticked, or a finished build's failed items tried again.
 */
export interface AiJobResumeOptions {
  publish?: boolean
  retry?: 'failed-items'
  /** "Build what fits" (AGL-3722): a Free job past what is left, started on the person's go-ahead. */
  creditsConfirmed?: boolean
  /** "Build the home page first" (AGL-3722): the plan narrowed to its home page and what it needs. */
  reduce?: 'first-page'
}

/**
 * Confirms a plan, or tries again a step whose answer broke a building rule
 * (AGL-2935). The door runs the next step inline and answers with the job.
 */
export async function resumeAiJobRequest(
  user: MaybeTokenSource,
  orgId: string,
  job: Pick<AiJobSummary, 'id' | 'hostId'>,
  options: AiJobResumeOptions = {},
): Promise<AiJobDecision> {
  try {
    const response = await authorizedFetch(
      user,
      `/api/ai/jobs/${encodeURIComponent(job.id)}/resume`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId: job.hostId,
          ...(options.publish ? { publish: true } : {}),
          ...(options.retry ? { retry: options.retry } : {}),
          ...(options.creditsConfirmed ? { creditsConfirmed: true } : {}),
          ...(options.reduce ? { reduce: options.reduce } : {}),
        }),
      },
    )
    const payload = await response.json().catch(() => null)
    const next = (payload?.job as AiJobSummary | undefined) ?? null
    publishAiJob(next)
    const credits =
      response.status === 409 && payload?.code === AI_CREDITS_CONFIRM_CODE
        ? ((payload?.credits as AiCreditsPrompt | undefined) ?? null)
        : null
    return {
      job: next,
      error: response.ok
        ? null
        : String(payload?.error ?? 'The job could not be resumed — try again.'),
      ...(credits ? { credits } : {}),
    }
  } catch {
    return { job: null, error: 'The job could not be resumed — try again.' }
  }
}

/**
 * Starts the build a chat turn proposed (AGL-3616): one `build` job on the
 * proposal's site, through the same door every job is created by, which
 * climbs its own gates and plans inline. What comes back stops at its plan
 * card; nothing is built until the person confirms it.
 */
export async function startAssistBuildRequest(
  user: MaybeTokenSource,
  orgId: string,
  proposal: AssistBuildProposal,
): Promise<AiJobDecision> {
  const failed = 'The build could not be planned — try asking again.'
  try {
    const response = await authorizedFetch(user, '/api/ai/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assistBuildJobRequest(orgId, proposal)),
    })
    const payload = await response.json().catch(() => null)
    const next = (payload?.job as AiJobSummary | undefined) ?? null
    if (response.ok && next) publishAiJob(next)
    return {
      job: response.ok ? next : null,
      error: response.ok && next ? null : String(payload?.error ?? failed),
    }
  } catch {
    return { job: null, error: failed }
  }
}

/** Cancels a job that has not settled. */
export async function cancelAiJobRequest(
  user: MaybeTokenSource,
  orgId: string,
  jobId: string,
): Promise<AiJobDecision> {
  try {
    const response = await authorizedFetch(
      user,
      `/api/ai/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      },
    )
    const payload = await response.json().catch(() => null)
    const next = (payload?.job as AiJobSummary | undefined) ?? null
    publishAiJob(next)
    return {
      job: next,
      error: response.ok
        ? null
        : String(payload?.error ?? 'The job could not be canceled — try again.'),
    }
  } catch {
    return { job: null, error: 'The job could not be canceled — try again.' }
  }
}
