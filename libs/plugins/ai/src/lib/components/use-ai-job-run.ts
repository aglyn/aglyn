'use client'

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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import {
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AI_JOB_TERMINAL_STATUSES,
  type AiJobKind,
  type AiJobSummary,
} from '../model/ai-jobs.types'
import { followAiJobEvents } from './ai-job-events'
import { publishAiJob } from './ai-jobs-store'

/**
 * Starting one AI job from a console control, and following it until it
 * settles (AGL-2919): the jobs route's create door, then its events door, the
 * way the SEO card follows its jobs. A control that starts a job the beat
 * runs shows its progress here and its result when it arrives; closing the
 * control stops following, and the job carries on in AI jobs.
 */

/** What a control asks the create door for. */
export interface AiJobRequest {
  orgId: string
  /** `null` for a job about the workspace rather than one site. */
  hostId: string | null
  kind: AiJobKind
  brief: string
  inputs: Record<string, string>
}

/** Whether a job has stopped moving: finished, or waiting on something only a person can change. */
export function aiJobSettled(job: AiJobSummary | null): boolean {
  if (!job) return false
  return (
    AI_JOB_TERMINAL_STATUSES.includes(job.status) ||
    job.status === 'needs_input' ||
    job.status === 'needs_review'
  )
}

/**
 * Why a settled job has no result to show, in words a person can act on, or
 * `null` for a job that finished.
 */
export function aiJobProblem(job: AiJobSummary | null, failed: string): string | null {
  if (!job || !aiJobSettled(job) || job.status === 'done') return null
  if (job.status === 'canceled') return 'The job was canceled.'
  if (job.status === 'needs_review') return job.review?.message || job.error || failed
  return job.error || failed
}

export interface AiJobRun {
  /** The job as it last arrived; `null` before one is started. */
  job: AiJobSummary | null
  /** The create door is being asked. */
  starting: boolean
  /** The job exists and has not settled. */
  running: boolean
  /** Why the create door refused, or could not be reached. */
  notice: string | null
  /** Starts the job, `true` once it exists, and follows it from there; `false` when the door refused. */
  start: (request: AiJobRequest) => Promise<boolean>
  /** Stops following and forgets the job, for a control asked again. */
  reset: () => void
}

export function useAiJobRun(user: MaybeTokenSource, failed: string): AiJobRun {
  const userRef = useRef(user)
  userRef.current = user
  const [job, setJob] = useState<AiJobSummary | null>(null)
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const watchRef = useRef<AbortController | null>(null)

  useEffect(() => () => watchRef.current?.abort(), [])

  /** Follows a job through the events route until it settles or the control goes. */
  const watch = useCallback(async (jobId: string, orgId: string) => {
    watchRef.current?.abort()
    const controller = new AbortController()
    watchRef.current = controller
    await followAiJobEvents(() => userRef.current, orgId, jobId, controller.signal, setJob)
  }, [])

  const start = useCallback(
    async (request: AiJobRequest) => {
      watchRef.current?.abort()
      setStarting(true)
      setNotice(null)
      setJob(null)
      let next: AiJobSummary | undefined
      try {
        const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          const locked = parseLockdownRefusal(response.status, payload)
          setNotice(locked ? lockdownRefusalText(locked) : String(payload?.error ?? failed))
          return false
        }
        next = payload?.job as AiJobSummary | undefined
        if (!next) {
          setNotice(failed)
          return false
        }
        setJob(next)
        // The indicator counts it from the moment it exists (AGL-3593).
        publishAiJob(next)
      } catch {
        setNotice(failed)
        return false
      } finally {
        setStarting(false)
      }
      if (!aiJobSettled(next)) void watch(next.id, request.orgId)
      return true
    },
    [failed, watch],
  )

  const reset = useCallback(() => {
    watchRef.current?.abort()
    setJob(null)
    setNotice(null)
  }, [])

  return { job, starting, running: Boolean(job && !aiJobSettled(job)), notice, start, reset }
}
