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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  aiCrmJobAnswers,
  readAiCrmProposal,
  type AiCrmAnswerWanted,
  type AiCrmAnswerWire,
} from '../model/ai-crm'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import { readEventFrames } from './assist-jobs-drawer.component'

/** How many recent jobs are read to find the last answer to a question. */
export const AI_CRM_RECENT_JOBS_READ = 20

export const AI_CRM_LOAD_FAILED_COPY = 'AI suggestions could not be loaded.'
export const AI_CRM_START_FAILED_COPY = 'AI could not be started. Try again.'
export const AI_CRM_ANSWER_GONE_COPY = 'This suggestion is no longer available. Ask again.'

export type AiCrmVerdict = 'checking' | 'ready' | 'hidden'

export interface AiCrmAnswerOptions {
  orgId: string | undefined
  hostId: string | null
  /** The question a widget asks; `null` asks nothing and keeps the widget absent. */
  wanted: AiCrmAnswerWanted | null
  /**
   * Which earlier answer is shown when the widget mounts: the newest any
   * member asked for (`any`, a record's summary), the newest this member did
   * (`mine`), or none, for a question asked afresh each time.
   */
  recall: 'any' | 'mine' | 'none'
}

export interface AiCrmAnswerRun {
  /** `hidden` when the jobs route says the feature is not this workspace's; the widget draws nothing. */
  verdict: AiCrmVerdict
  job: AiJobSummary | null
  answer: AiCrmAnswerWire | null
  notice: string | null
  /** A request is on its way to the create door. */
  busy: boolean
  /** The job asked is not settled yet. */
  running: boolean
  /** Starts a `crm` job and settles it; the answer, or `null` when there is none to show. */
  ask: (brief: string, inputs: Record<string, string>) => Promise<AiCrmAnswerWire | null>
}

type User = Parameters<typeof authorizedFetch>[0]

const isTerminal = (job: AiJobSummary) => AI_JOB_TERMINAL_STATUSES.includes(job.status)

/** A kept answer through its door; `null` when the door has none for this member. */
export async function readAiCrmAnswer(user: User, jobId: string, orgId: string): Promise<AiCrmAnswerWire | null> {
  const response = await authorizedFetch(
    user,
    `/api/ai/crm/${encodeURIComponent(jobId)}?orgId=${encodeURIComponent(orgId)}`,
  )
  if (!response.ok) return null
  const payload = (await response.json().catch(() => null)) as { answer?: Record<string, unknown> } | null
  const proposal = readAiCrmProposal(payload?.answer?.['proposal'])
  if (!payload?.answer || !proposal) return null
  return {
    jobId: String(payload.answer['jobId'] ?? jobId),
    hostId: typeof payload.answer['hostId'] === 'string' ? payload.answer['hostId'] : null,
    createdBy: String(payload.answer['createdBy'] ?? ''),
    proposal,
  }
}

/**
 * One question to a `crm` job from a console widget (AGL-2917): whether the
 * feature is this workspace's, the last answer to it, and asking again.
 *
 * The jobs route decides whether a widget is here at all, as every generative
 * card's does: a 404 (the release flag) or a 403 (the plan) keeps it absent.
 * A job names only its question, so an answer is read from the answer door,
 * which serves it only to a member the CRM lets read the record. A job the
 * create door left for the beat is followed through the events route until
 * it settles.
 */
export function useAiCrmAnswer(options: AiCrmAnswerOptions): AiCrmAnswerRun {
  const { orgId, hostId, recall } = options
  const { data: user } = useUser()
  // Held in a ref so the reads below key on WHO is signed in, never on the
  // identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  // By value, so a widget that builds its question each render asks once.
  const wantedKey = options.wanted ? JSON.stringify(options.wanted) : null

  const [verdict, setVerdict] = useState<AiCrmVerdict>('checking')
  const [job, setJob] = useState<AiJobSummary | null>(null)
  const [answer, setAnswer] = useState<AiCrmAnswerWire | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const watchRef = useRef<AbortController | null>(null)

  useEffect(() => () => watchRef.current?.abort(), [])

  /** Follows a job until it settles, then reads its answer when it is done. */
  const settle = useCallback(async (start: AiJobSummary, org: string): Promise<AiCrmAnswerWire | null> => {
    let current = start
    setJob(current)
    if (!isTerminal(current)) {
      watchRef.current?.abort()
      const controller = new AbortController()
      watchRef.current = controller
      let again = true
      while (again && !controller.signal.aborted && !isTerminal(current)) {
        again = false
        try {
          const response = await authorizedFetch(
            userRef.current,
            `/api/ai/jobs/${encodeURIComponent(current.id)}/events?orgId=${encodeURIComponent(org)}`,
            { signal: controller.signal },
          )
          if (!response.ok || !response.body) break
          await readEventFrames(response.body, (event) => {
            if (event['type'] === 'state') {
              current = event['job'] as AiJobSummary
              setJob(current)
            } else if (event['type'] === 'reconnect') {
              again = true
            }
          })
        } catch {
          break
        }
      }
    }
    if (current.status !== 'done') return null
    const kept = await readAiCrmAnswer(userRef.current, current.id, org).catch(() => null)
    setAnswer(kept)
    if (!kept) setNotice(AI_CRM_ANSWER_GONE_COPY)
    return kept
  }, [])

  useEffect(() => {
    if (!orgId || !uid || !wantedKey) return
    let active = true
    setVerdict('checking')
    setJob(null)
    setAnswer(null)
    setNotice(null)
    void (async () => {
      try {
        const limit = recall === 'none' ? 1 : AI_CRM_RECENT_JOBS_READ
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${limit}`,
        )
        if (!active) return
        // The flag off (404) and the plan without generation (403): the
        // feature is not this workspace's, so the widget is not here at all.
        if (response.status === 404 || response.status === 403) {
          setVerdict('hidden')
          return
        }
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          const locked = parseLockdownRefusal(response.status, payload)
          setNotice(locked ? lockdownRefusalText(locked) : String(payload?.error ?? AI_CRM_LOAD_FAILED_COPY))
          setVerdict('ready')
          return
        }
        setVerdict('ready')
        if (recall === 'none') return
        const wanted = JSON.parse(wantedKey) as AiCrmAnswerWanted
        const found = ((payload?.jobs ?? []) as AiJobSummary[]).find(
          (entry) =>
            entry.hostId === hostId &&
            (recall === 'any' || entry.createdBy === uid) &&
            aiCrmJobAnswers(entry, wanted),
        )
        if (!found) return
        if (!isTerminal(found)) {
          await settle(found, orgId)
          return
        }
        setJob(found)
        if (found.status !== 'done') return
        const kept = await readAiCrmAnswer(userRef.current, found.id, orgId).catch(() => null)
        // An answer the door does not serve this member is simply not shown.
        if (active) setAnswer(kept)
      } catch {
        if (!active) return
        setNotice(AI_CRM_LOAD_FAILED_COPY)
        setVerdict('ready')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, hostId, uid, wantedKey, recall, settle])

  const ask = useCallback(
    async (brief: string, inputs: Record<string, string>): Promise<AiCrmAnswerWire | null> => {
      if (!orgId) return null
      setBusy(true)
      setNotice(null)
      try {
        const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, hostId, kind: 'crm', brief, inputs }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          const locked = parseLockdownRefusal(response.status, payload)
          setNotice(locked ? lockdownRefusalText(locked) : String(payload?.error ?? AI_CRM_START_FAILED_COPY))
          return null
        }
        const next = payload?.job as AiJobSummary | undefined
        if (!next) return null
        setAnswer(null)
        return await settle(next, orgId)
      } catch {
        setNotice(AI_CRM_START_FAILED_COPY)
        return null
      } finally {
        setBusy(false)
      }
    },
    [orgId, hostId, settle],
  )

  return {
    verdict,
    job,
    answer,
    notice,
    busy,
    running: Boolean(job && !isTerminal(job)),
    ask,
  }
}
