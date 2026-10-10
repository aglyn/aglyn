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

import {
  authorizedFetch,
  type MaybeTokenSource,
  type TokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { AiFreeCreditsLeft } from '../model/ai-site-job'
import { aiJobsActivity, type AiJobsActivity } from '../model/ai-job-activity'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'

/**
 * WHERE A PERSON FINDS THEIR AI JOBS (AGL-3593).
 *
 * Two things every AI surface in the console shares, kept in this module
 * rather than in any one component because the surfaces that need them — a
 * brief dialog on the Screens page, the guided start's full-screen dialog,
 * the top-bar indicator, the Assist launcher and the drawer inside the
 * panel — are mounted in different zones and know nothing of one another.
 * All of them are this plugin's, so no shell, zone or event bus carries it.
 *
 * ── Opening AI jobs ──────────────────────────────────────────────────────
 *
 * {@link openAiJobs} is the one action every "Open AI jobs" button, the
 * indicator and a notification's link take: the Assist panel subscribes, opens
 * itself, expands its AI jobs drawer, and scrolls to and highlights the job
 * named. A request is a sequence number as well as a job, so asking twice for
 * the same job opens it twice.
 *
 * ── The workspace's unsettled jobs ───────────────────────────────────────
 *
 * The indicator, the launcher's badge and the drawer's open-by-default rule
 * read the same list: the workspace's jobs that are not yet settled, from
 * the jobs route's `status=active` (a Firestore `in` query under the
 * (status, createdAt) index, never a filter of a loaded window). ONE list per
 * person and workspace however many surfaces read it, re-read on a timer only
 * while something in it is still moving or waiting and the tab is in view —
 * a workspace with nothing running costs one read per page load and no more.
 *
 * Every surface that learns a job's state some other way — the dialog that
 * created it, the drawer's event stream, the in-dialog confirm — hands it in
 * through {@link publishAiJob}, so the indicator moves the moment the job
 * does rather than on the next read.
 */

// ── Opening AI jobs ───────────────────────────────────────────────────────

/** The latest request to open AI jobs; `seq` is 0 until anything asked. */
export interface AiJobsOpenRequest {
  seq: number
  /** The job to scroll to and highlight, or `null` for the drawer alone. */
  jobId: string | null
}

let openRequest: AiJobsOpenRequest = { seq: 0, jobId: null }
const openListeners = new Set<() => void>()

/**
 * Opens the Assist panel on its AI jobs drawer, expanded, scrolled to
 * `jobId` when one is named. A surface that covers the panel — a dialog —
 * closes itself beside the call; this opens, it does not close anything.
 */
export function openAiJobs(options: { jobId?: string | null } = {}): void {
  openRequest = { seq: openRequest.seq + 1, jobId: options.jobId ?? null }
  for (const listener of openListeners) listener()
}

function subscribeOpen(listener: () => void): () => void {
  openListeners.add(listener)
  return () => {
    openListeners.delete(listener)
  }
}

const readOpen = (): AiJobsOpenRequest => openRequest

/** The latest open request, for the panel; a new `seq` is a new request. */
export function useAiJobsOpenRequest(): AiJobsOpenRequest {
  return useSyncExternalStore(subscribeOpen, readOpen, readOpen)
}

/**
 * The query parameter a notification's link carries: a console page opened
 * with `?aiJob={id}` opens AI jobs on that job, the way pressing the
 * indicator does.
 */
export { AI_JOB_LINK_PARAM } from '../model/ai-job-notice'

// ── The workspace's unsettled jobs ────────────────────────────────────────

/** How often a list with something in it is read again, while the tab is in view. */
export const AI_JOBS_ACTIVE_POLL_MS = 15_000

/** The most unsettled jobs one read lists; a glance, not an archive. */
const ACTIVE_LIMIT = 20

const NONE: readonly AiJobSummary[] = Object.freeze([])

interface Entry {
  jobs: readonly AiJobSummary[]
  /** Who reads it, kept current by whichever surface subscribed last. */
  user: MaybeTokenSource
  orgId: string
  uid: string
  subscribers: number
  inflight: boolean
  timer: ReturnType<typeof setTimeout> | null
  /** The route said the feature is not this workspace's: nothing is read again. */
  closed: boolean
  listeners: Set<() => void>
}

const entries = new Map<string, Entry>()

/**
 * Who hears of a read as it starts and what a Free workspace has left when it
 * lands (AGL-3722): the usage strip's store follows the jobs list this way
 * rather than by import, so this module stays out of the strip's chunk.
 */
export interface AiJobsReadWatcher {
  start: (uid: string, orgId: string) => void
  done: (uid: string, orgId: string, credits: AiFreeCreditsLeft | undefined) => void
}
const readWatchers = new Set<AiJobsReadWatcher>()

/** Listen to the jobs list's reads; returns the way to stop. */
export function watchAiJobsReads(watcher: AiJobsReadWatcher): () => void {
  readWatchers.add(watcher)
  return () => {
    readWatchers.delete(watcher)
  }
}

const keyOf = (uid: string, orgId: string): string => `${uid}\n${orgId}`

function emit(entry: Entry): void {
  for (const listener of entry.listeners) listener()
}

function isSettled(job: AiJobSummary): boolean {
  return AI_JOB_TERMINAL_STATUSES.includes(job.status)
}

function schedule(entry: Entry): void {
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
  if (entry.closed || entry.subscribers === 0 || entry.jobs.length === 0) return
  entry.timer = setTimeout(() => {
    entry.timer = null
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    // A hidden tab reads nothing; coming back into view reads at once.
    if (hidden) return
    void read(entry)
  }, AI_JOBS_ACTIVE_POLL_MS)
}

async function read(entry: Entry): Promise<void> {
  if (entry.inflight || entry.closed) return
  entry.inflight = true
  for (const watcher of readWatchers) watcher.start(entry.uid, entry.orgId)
  try {
    const response = await authorizedFetch(
      entry.user,
      `/api/ai/jobs?orgId=${encodeURIComponent(entry.orgId)}&status=active&limit=${ACTIVE_LIMIT}`,
    )
    if (response.status === 404 || response.status === 403) {
      // The release flag off, or a plan or member without generation: there
      // is nothing to count, now or on the next tick.
      entry.closed = true
      entry.jobs = NONE
      emit(entry)
      return
    }
    if (!response.ok) return
    const payload = (await response.json().catch(() => null)) as {
      jobs?: AiJobSummary[]
      freeCredits?: AiFreeCreditsLeft
    } | null
    // The same read carries what a Free workspace has left, so the usage
    // strip follows jobs that spend between chat messages (AGL-3722).
    for (const watcher of readWatchers) watcher.done(entry.uid, entry.orgId, payload?.freeCredits)
    entry.jobs = Object.freeze((payload?.jobs ?? []).filter((job) => !isSettled(job)))
    emit(entry)
  } catch {
    // An unreachable route keeps what was last read; the next tick asks again.
  } finally {
    entry.inflight = false
    schedule(entry)
  }
}

function entryFor(uid: string, orgId: string, user: MaybeTokenSource): Entry {
  const key = keyOf(uid, orgId)
  let entry = entries.get(key)
  if (!entry) {
    entry = {
      jobs: NONE,
      user,
      orgId,
      uid,
      subscribers: 0,
      inflight: false,
      timer: null,
      closed: false,
      listeners: new Set(),
    }
    entries.set(key, entry)
  }
  return entry
}

/**
 * Hands a job's latest state to every surface counting this workspace's jobs:
 * a new job joins the list, a settled one leaves it. Keyed on the job's own
 * workspace, for every person whose list holds that workspace in this tab.
 */
export function publishAiJob(job: AiJobSummary | null | undefined): void {
  if (!job?.orgId) return
  for (const entry of entries.values()) {
    if (entry.orgId !== job.orgId || entry.closed) continue
    const index = entry.jobs.findIndex((known) => known.id === job.id)
    let next: AiJobSummary[]
    if (isSettled(job)) {
      if (index === -1) continue
      next = entry.jobs.filter((known) => known.id !== job.id)
      // A job that just settled has just spent: read what is left (AGL-3722).
      if (entry.subscribers > 0) void read(entry)
    } else if (index === -1) {
      next = [job, ...entry.jobs]
    } else {
      next = [...entry.jobs]
      next[index] = job
    }
    entry.jobs = Object.freeze(next)
    emit(entry)
    // A list that just gained its first job starts its timer.
    if (!entry.timer && !entry.inflight) schedule(entry)
  }
}

/** Forget every list and request; specs start each case from nothing. */
export function resetAiJobsStoreForTests(): void {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer)
  }
  entries.clear()
  openListeners.clear()
  readWatchers.clear()
  openRequest = { seq: 0, jobId: null }
}

/**
 * The workspace's jobs that are not yet settled, newest first, for the
 * signed-in person — empty while the first read is in flight, where the
 * route refuses, and when `enabled` is false (a surface whose own gates have
 * not passed reads nothing at all).
 */
export function useAiJobsInFlight(
  user: (TokenSource & { uid?: string | null }) | null | undefined,
  orgId: string | null | undefined,
  enabled = true,
): readonly AiJobSummary[] {
  const uid = user?.uid ?? null
  const userRef = useRef<MaybeTokenSource>(user)
  userRef.current = user
  const entry = useMemo(
    () => (enabled && uid && orgId ? entryFor(uid, orgId, userRef.current) : null),
    [enabled, uid, orgId],
  )

  useEffect(() => {
    if (!entry) return undefined
    entry.user = userRef.current
    entry.subscribers += 1
    if (entry.subscribers === 1) void read(entry)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && entry.jobs.length > 0) void read(entry)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      entry.subscribers -= 1
      if (entry.subscribers === 0 && entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
    }
  }, [entry])

  const subscribe = useMemo(
    () => (listener: () => void) => {
      if (!entry) return () => undefined
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
      }
    },
    [entry],
  )
  const snapshot = (): readonly AiJobSummary[] => entry?.jobs ?? NONE
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** What the indicator and the launcher show for the workspace, or `null` for nothing. */
export function useAiJobsActivity(
  user: (TokenSource & { uid?: string | null }) | null | undefined,
  orgId: string | null | undefined,
  enabled = true,
): AiJobsActivity<AiJobSummary> | null {
  const jobs = useAiJobsInFlight(user, orgId, enabled)
  return useMemo(() => aiJobsActivity(jobs), [jobs])
}
