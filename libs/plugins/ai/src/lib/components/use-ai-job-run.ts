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
  type TokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AI_JOB_TERMINAL_STATUSES,
  type AiJobKind,
  type AiJobSummary,
} from '../model/ai-jobs.types'
import { readEventFrames } from './assist-jobs-drawer.component'

/**
 * Starting one AI job from a console control, and following it until it
 * settles (AGL-2919): the jobs route's create door, then its events door, the
 * way the SEO card follows its jobs. A control that starts a job the beat
 * runs shows its progress here and its result when it arrives; closing the
 * control stops following, and the job carries on in AI jobs.
 */

/** Whether the jobs route serves a workspace: still asking, yes, or no. */
export type AiJobsVerdict = 'checking' | 'ready' | 'hidden'

/**
 * One answer per member and workspace, however many controls ask. The
 * automation run history draws a control on every failed run, and each asking
 * the route would be a request a row.
 */
const verdicts = new Map<string, Promise<Exclude<AiJobsVerdict, 'checking'>>>()

/** Forgets every answer, so the next control to mount asks the route again. */
export function forgetAiJobsVerdicts(): void {
  verdicts.clear()
}

function askJobsRoute(
  user: MaybeTokenSource,
  uid: string,
  orgId: string,
): Promise<Exclude<AiJobsVerdict, 'checking'>> {
  const key = `${uid}\n${orgId}`
  const known = verdicts.get(key)
  if (known) return known
  const answer = authorizedFetch(user, `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=1`)
    // The release flag off (404) and a plan or member without generation
    // (403): the feature is not this workspace's, so the control is absent.
    .then((response): Exclude<AiJobsVerdict, 'checking'> =>
      response.status === 404 || response.status === 403 ? 'hidden' : 'ready',
    )
    .catch((): Exclude<AiJobsVerdict, 'checking'> => {
      // A request that never arrived is no answer, so the next control asks again.
      verdicts.delete(key)
      return 'hidden'
    })
  verdicts.set(key, answer)
  return answer
}

/**
 * Whether a control that starts a job should be drawn. The shell decided the
 * plan and the member's permission before mounting it; the release flag is the
 * route's to decide.
 */
export function useAiJobsVerdict(
  user: (TokenSource & { uid?: string | null }) | null | undefined,
  orgId: string | undefined,
): AiJobsVerdict {
  // Held in a ref so the question keys on WHO is signed in, never on the
  // identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [verdict, setVerdict] = useState<AiJobsVerdict>('checking')

  useEffect(() => {
    if (!orgId || !uid) return
    let active = true
    setVerdict('checking')
    void askJobsRoute(userRef.current, uid, orgId).then((answer) => {
      if (active) setVerdict(answer)
    })
    return () => {
      active = false
    }
  }, [orgId, uid])

  return verdict
}

/** What a control asks the create door for. */
export interface AiJobRequest {
  orgId: string
  hostId: string
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
    let again = true
    while (again && !controller.signal.aborted) {
      again = false
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs/${encodeURIComponent(jobId)}/events?orgId=${encodeURIComponent(orgId)}`,
          { signal: controller.signal },
        )
        if (!response.ok || !response.body) return
        await readEventFrames(response.body, (event) => {
          if (controller.signal.aborted) return
          if (event['type'] === 'state') setJob(event['job'] as AiJobSummary)
          else if (event['type'] === 'reconnect') again = true
        })
      } catch {
        return
      }
    }
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
