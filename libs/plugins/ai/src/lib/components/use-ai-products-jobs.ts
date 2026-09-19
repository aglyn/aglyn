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
import { useHostOrgId, useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import { readEventFrames } from './assist-jobs-drawer.component'

/**
 * The jobs route, as a commerce card asks it (AGL-2916): whether the feature
 * is this workspace's at all, the site's recent `products` jobs, starting one,
 * and following each until it settles.
 *
 * The shell has already decided the plan and the member's permission before a
 * card mounts; the release flag is the route's, so a 404 or 403 from the list
 * is the card staying absent. A card follows more than one job at a time — a
 * bulk copy job and a catalog, say — so each job has its own watch: every job
 * it starts, and of the jobs it finds already moving, the ones `follows`
 * names as its own.
 */

/** How many recent jobs a card reads to find this site's products jobs. */
export const AI_PRODUCTS_RECENT_JOBS_READ = 20

export type AiProductsJobsVerdict = 'checking' | 'ready' | 'hidden'

export interface AiProductsJobs {
  /** The org the jobs are metered against: the zone's, or the site's. */
  orgId: string | undefined
  verdict: AiProductsJobsVerdict
  /** The site's recent `products` jobs, newest first, kept current while followed. */
  jobs: AiJobSummary[]
  notice: string | null
  setNotice: (notice: string | null) => void
  /** Starts a job and follows it; resolves with the job as created, or `null` with a notice. */
  start: (brief: string, inputs: Record<string, string>) => Promise<AiJobSummary | null>
}

export const isAiJobSettled = (job: AiJobSummary | null | undefined): boolean =>
  Boolean(job && AI_JOB_TERMINAL_STATUSES.includes(job.status))

/** Whether a job is moving now: queued or running, rather than settled or waiting for a person. */
export const isAiJobMoving = (job: AiJobSummary | null | undefined): boolean =>
  job?.status === 'queued' || job?.status === 'running'

const START_FAILED_COPY = 'The AI job could not be started. Try again.'
const LIST_FAILED_COPY = 'Recent AI proposals could not be loaded.'

export function useAiProductsJobs(input: {
  hostId: string
  orgId: string | undefined
  /** Which of the site's moving jobs this card shows, and so follows; none when absent. */
  follows?: (job: AiJobSummary) => boolean
}): AiProductsJobs {
  const { hostId } = input
  // Read through a ref: a card passes a fresh function each render, and the
  // list is read once for who is signed in, not once for each.
  const followsRef = useRef(input.follows)
  followsRef.current = input.follows
  // A plugin-hosted zone may not know the org; the site does.
  const hostOrgId = useHostOrgId(input.orgId ? undefined : hostId)
  const orgId = input.orgId ?? hostOrgId ?? undefined
  const { data: user } = useUser()
  // Held in a ref so the reads key on WHO is signed in, never on the identity
  // of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null

  const [verdict, setVerdict] = useState<AiProductsJobsVerdict>('checking')
  const [jobs, setJobs] = useState<AiJobSummary[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const watches = useRef(new Map<string, AbortController>())

  useEffect(() => {
    const open = watches.current
    return () => {
      for (const controller of open.values()) controller.abort()
      open.clear()
    }
  }, [])

  const put = useCallback((job: AiJobSummary) => {
    setJobs((current) => [job, ...current.filter((entry) => entry.id !== job.id)].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ))
  }, [])

  /** Follows one job through the events route until it settles. */
  const follow = useCallback(
    async (job: AiJobSummary, org: string) => {
      if (!isAiJobMoving(job) || watches.current.has(job.id)) return
      const controller = new AbortController()
      watches.current.set(job.id, controller)
      try {
        let again = true
        while (again && !controller.signal.aborted) {
          again = false
          const response = await authorizedFetch(
            userRef.current,
            `/api/ai/jobs/${encodeURIComponent(job.id)}/events?orgId=${encodeURIComponent(org)}`,
            { signal: controller.signal },
          )
          if (!response.ok || !response.body) return
          await readEventFrames(response.body, (event) => {
            if (event['type'] === 'state') put(event['job'] as AiJobSummary)
            else if (event['type'] === 'reconnect') again = true
          })
        }
      } catch {
        // An aborted or dropped watch leaves the last state shown.
      } finally {
        watches.current.delete(job.id)
      }
    },
    [put],
  )

  useEffect(() => {
    if (!orgId || !hostId || !uid) return
    let active = true
    setVerdict('checking')
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${AI_PRODUCTS_RECENT_JOBS_READ}`,
        )
        if (!active) return
        // The flag off (404) and the plan without generation (403): the
        // feature is not this workspace's, so the card is not here at all.
        if (response.status === 404 || response.status === 403) {
          setVerdict('hidden')
          return
        }
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          const locked = parseLockdownRefusal(response.status, payload)
          setNotice(locked ? lockdownRefusalText(locked) : String(payload?.error ?? LIST_FAILED_COPY))
        } else {
          const recent = ((payload?.jobs ?? []) as AiJobSummary[]).filter(
            (entry) => entry.kind === 'products' && entry.hostId === hostId,
          )
          setJobs(recent)
          for (const job of recent) {
            if (followsRef.current?.(job)) void follow(job, orgId)
          }
        }
        setVerdict('ready')
      } catch {
        if (!active) return
        setNotice(LIST_FAILED_COPY)
        setVerdict('ready')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, hostId, uid, follow])

  const start = useCallback(
    async (brief: string, inputs: Record<string, string>) => {
      if (!orgId) return null
      setNotice(null)
      try {
        const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, hostId, kind: 'products', brief, inputs }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          const locked = parseLockdownRefusal(response.status, payload)
          setNotice(locked ? lockdownRefusalText(locked) : String(payload?.error ?? START_FAILED_COPY))
          return null
        }
        const job = payload?.job as AiJobSummary | undefined
        if (!job) return null
        put(job)
        void follow(job, orgId)
        return job
      } catch {
        setNotice(START_FAILED_COPY)
        return null
      }
    },
    [orgId, hostId, put, follow],
  )

  return { orgId, verdict, jobs, notice, setNotice, start }
}
