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

import {
  erasePluginSite,
  type PluginSiteEraseRequest,
  type PluginSiteEraseResult,
} from '@aglyn/aglyn/plugin-manager/plugin-site-erase'
import type { AiJob } from '../model/ai-jobs.types'

/**
 * THE EMPTY SITE A GUIDED START LEFT IS REMOVED (AGL-3936).
 *
 * Since AGL-3859 a site is created only when its start is admitted: the
 * starter, Skip, or "Plan my site". A site start cancelled or failed before
 * it built anything leaves that site with no page, public, answering "This
 * site is coming soon". The build page offers Start again, Try again and Use
 * the starter, and a person who leaves without choosing used to leave the
 * placeholder behind for good (kc-x-carder 2026-10-15, cancelled 13 s in;
 * pflomo 2026-10-17, 35 s in).
 *
 * So when a site job settles `canceled` or `failed` with nothing built, a due
 * marker is written, `aiEmptySiteSweeps/{hostId}`, an hour out. The AI jobs
 * beat reads the markers that are due, a few a beat, and checks every
 * condition again at that moment; only a site that is still truly empty is
 * deleted, through `core.site-erase` — the console's own delete path, so the
 * subdomain, the routing index, the org's site count, the members' rows and
 * the cache all go as they do for a site its admin deletes. Anything a person
 * did in the hour keeps the site and drops the marker. The starter is never
 * written for them: the starter is written only when a person chooses it.
 *
 * The marker is server-only (the rules deny every client), holds ids and
 * instants and nothing a person wrote, and is deleted once it is decided.
 */

/** The due markers, top level, one per site, keyed by the site's id. */
export const AI_EMPTY_SITE_SWEEPS_COLLECTION = 'aiEmptySiteSweeps'

/** How long a person has to come back and choose before the empty site goes. */
export const AI_EMPTY_SITE_GRACE_MS = 60 * 60_000

/** Markers one beat decides; the rest wait for the next minute's beat. */
export const AI_EMPTY_SITE_SWEEP_MAX = 3

/** Wall clock one beat gives the removals before it runs any job's step. */
export const AI_EMPTY_SITE_SWEEP_BUDGET_MS = 20_000

/** A removal the eraser could not make is tried again this much later. */
export const AI_EMPTY_SITE_RETRY_MS = 15 * 60_000

/** Removals tried this many times without an answer are given up and logged. */
export const AI_EMPTY_SITE_MAX_ATTEMPTS = 5

/** The workspace feed's words for it; the feed names the site beside them. */
export const AI_EMPTY_SITE_ACTIVITY = 'Removed an empty site'

/** Why, on the staff audit row. */
export const AI_EMPTY_SITE_REASON = 'ai-start-empty'

/** The org's jobs, as `AI_JOBS_COLLECTION` in `ai-jobs.ts` names them (that module imports this one). */
const JOBS_COLLECTION = 'aiJobs'

/**
 * What a site holds that a person, or a start, put there. One document in
 * any of them keeps the site: pages and emails (`screens`), layouts, forms,
 * media, components, templates, content collections, redirects and plugin
 * settings. `activity` and the visitors' `analytics` beacon are not on the
 * list, and are read on their own terms below.
 */
export const AI_EMPTY_SITE_CONTENT_COLLECTIONS = [
  'screens',
  'layouts',
  'forms',
  'media',
  'components',
  'templates',
  'collections',
  'redirects',
  'pluginSettings',
] as const

/** The site's own feed entries that are not a person editing it. */
const UNEDITED_ACTIVITY = new Set(['Created the site'])

/** More feed entries than this and the site was worked on. */
const ACTIVITY_SCAN = 20

type Firestore = FirebaseFirestore.Firestore
type Instant = Date | { toMillis(): number } | number | string | null | undefined

function toMillis(value: Instant): number | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return typeof value.toMillis === 'function' ? value.toMillis() : null
}

/** The due marker, as stored. */
export interface AiEmptySiteSweep {
  hostId: string
  orgId: string
  jobId: string
  /** What the job ended as. */
  status: 'canceled' | 'failed'
  settledAt: Date
  dueAt: Date
  attempts: number
}

/**
 * Whether a job leaves the empty site this sweep is for: a site start that
 * ended `canceled` or `failed` with nothing built — no output but the
 * site's listing proposal, which rides out with the first unit and builds
 * nothing (the rule `aiSiteStarterFallbackOffered` offers the starter by).
 */
export function aiJobLeavesEmptySite(
  job: Pick<AiJob, 'kind' | 'status' | 'hostId' | 'outputs' | 'siteRemoved'>,
): boolean {
  if (job.kind !== 'site' || !job.hostId || job.siteRemoved) return false
  if (job.status !== 'canceled' && job.status !== 'failed') return false
  return (job.outputs ?? []).every((output) => output.resource === 'seo')
}

/**
 * Writes the due marker for a job that just ended, when it leaves an empty
 * site. Never throws: a marker that could not be written leaves the site as
 * it was before this existed, and must not fail the write it follows.
 */
export async function scheduleAiEmptySiteSweep(
  firestore: Firestore,
  job: Pick<AiJob, '$id' | 'orgId' | 'kind' | 'status' | 'hostId' | 'outputs' | 'siteRemoved'>,
  now = new Date(),
): Promise<boolean> {
  if (!aiJobLeavesEmptySite(job) || !job.hostId) return false
  const marker: AiEmptySiteSweep = {
    hostId: job.hostId,
    orgId: job.orgId,
    jobId: job.$id,
    status: job.status as AiEmptySiteSweep['status'],
    settledAt: now,
    dueAt: new Date(now.getTime() + AI_EMPTY_SITE_GRACE_MS),
    attempts: 0,
  }
  try {
    await firestore.collection(AI_EMPTY_SITE_SWEEPS_COLLECTION).doc(job.hostId).set(marker)
    return true
  } catch (error) {
    console.warn('ai empty site: the removal could not be scheduled', {
      orgId: job.orgId,
      jobId: job.$id,
      hostId: job.hostId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Drops a site's marker: a job started, resumed or retried on the site, so
 * it is not empty for long. Never throws; the beat's check at due time says
 * the same thing if this write is lost.
 */
export async function clearAiEmptySiteSweep(firestore: Firestore, hostId: string | null | undefined): Promise<void> {
  if (!hostId) return
  try {
    await firestore.collection(AI_EMPTY_SITE_SWEEPS_COLLECTION).doc(hostId).delete()
  } catch {
    // A marker left behind is decided at its due time, against the site as it is then.
  }
}

/** What the check at due time found. */
export type AiEmptySiteVerdict =
  | { kind: 'empty'; name: string | null }
  /** The job settled again after the marker was written: wait a full grace from then. */
  | { kind: 'later'; dueAt: Date }
  /** The site is kept; the marker is dropped. */
  | { kind: 'keep'; reason: string }

/**
 * Every condition, read again as the site is now (AGL-3936). The site is
 * removed only when all of them hold:
 *
 * - it exists, in the marker's workspace, with no custom domain, no sending
 *   domain, no page on its routing map, and no staff hold;
 * - the job is still the one that ended, still `canceled` or `failed`, and
 *   still built nothing — not resumed, retried or finished since;
 * - no other AI job names the site;
 * - nothing in {@link AI_EMPTY_SITE_CONTENT_COLLECTIONS}: no page, email,
 *   layout, form or media file;
 * - the site's own feed holds nothing but "Created the site" and the AI
 *   job's own `ai.job.*` entries: nobody edited it.
 */
export async function aiEmptySiteVerdict(
  firestore: Firestore,
  marker: Pick<AiEmptySiteSweep, 'hostId' | 'orgId' | 'jobId' | 'dueAt'>,
): Promise<AiEmptySiteVerdict> {
  const hostRef = firestore.collection('hosts').doc(marker.hostId)
  const host = await hostRef.get()
  if (!host.exists) return { kind: 'keep', reason: 'site-gone' }
  if (host.get('orgId') !== marker.orgId) return { kind: 'keep', reason: 'site-moved' }
  const text = (field: string) => String(host.get(field) ?? '').trim()
  if (text('cname') || host.get('hasCustomDomain') === true) return { kind: 'keep', reason: 'custom-domain' }
  if (text('sendingLabel')) return { kind: 'keep', reason: 'sending-domain' }
  if (host.get('suspended') === true || host.get('suspendedAt')) return { kind: 'keep', reason: 'staff-hold' }
  const routes = host.get('screens')
  if (routes && typeof routes === 'object' && Object.keys(routes as object).length > 0) {
    return { kind: 'keep', reason: 'routed-pages' }
  }

  const jobSnapshot = await firestore
    .collection('orgs')
    .doc(marker.orgId)
    .collection(JOBS_COLLECTION)
    .doc(marker.jobId)
    .get()
  if (!jobSnapshot.exists) return { kind: 'keep', reason: 'job-gone' }
  const job = { ...(jobSnapshot.data() as Omit<AiJob, '$id'>), $id: jobSnapshot.id } as AiJob
  if (job.hostId !== marker.hostId || !aiJobLeavesEmptySite(job)) return { kind: 'keep', reason: 'job-moved-on' }
  const settledMs = toMillis(job.updatedAt as Instant)
  const markedMs = marker.dueAt.getTime() - AI_EMPTY_SITE_GRACE_MS
  if (settledMs !== null && settledMs > markedMs + 1_000) {
    return { kind: 'later', dueAt: new Date(settledMs + AI_EMPTY_SITE_GRACE_MS) }
  }

  const [others, ...contents] = await Promise.all([
    firestore
      .collection('orgs')
      .doc(marker.orgId)
      .collection(JOBS_COLLECTION)
      .where('hostId', '==', marker.hostId)
      .limit(2)
      .get(),
    ...AI_EMPTY_SITE_CONTENT_COLLECTIONS.map((name) => hostRef.collection(name).limit(1).get()),
  ])
  if (others.docs.some((doc) => doc.id !== marker.jobId)) return { kind: 'keep', reason: 'another-job' }
  const held = AI_EMPTY_SITE_CONTENT_COLLECTIONS.find((_, index) => !contents[index].empty)
  if (held) return { kind: 'keep', reason: `has-${held}` }

  const activity = await hostRef.collection('activity').limit(ACTIVITY_SCAN + 1).get()
  if (activity.size > ACTIVITY_SCAN) return { kind: 'keep', reason: 'edited' }
  const edited = activity.docs.some((doc) => {
    const action = String(doc.get('action') ?? '')
    return !UNEDITED_ACTIVITY.has(action) && !action.startsWith('ai.job.')
  })
  if (edited) return { kind: 'keep', reason: 'edited' }

  const name = host.get('displayName')
  return { kind: 'empty', name: typeof name === 'string' && name ? name : null }
}

export interface AiEmptySiteSweepResult {
  /** Markers that were due. */
  due: number
  /** Sites removed. */
  removed: number
  /** Markers dropped because the site was kept, or was already gone. */
  kept: number
  /** Markers moved later: the job settled again, or the eraser did not answer. */
  later: number
}

export interface SweepAiEmptySitesOptions {
  firestore: Firestore
  now?: () => number
  max?: number
  budgetMs?: number
  /** The site's removal; `core.site-erase` unless a spec replaces it. */
  erase?: (request: PluginSiteEraseRequest) => Promise<PluginSiteEraseResult>
}

/**
 * One beat's removals (AGL-3936): the markers due now, oldest first, a few
 * at a time and inside a few seconds of wall clock, each decided against the
 * site as it is at that moment. The marker goes once it is decided; one the
 * eraser could not answer is tried again later, and given up after
 * {@link AI_EMPTY_SITE_MAX_ATTEMPTS}.
 */
export async function sweepAiEmptySites(options: SweepAiEmptySitesOptions): Promise<AiEmptySiteSweepResult> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const budgetMs = options.budgetMs ?? AI_EMPTY_SITE_SWEEP_BUDGET_MS
  const erase = options.erase ?? erasePluginSite
  const markers = options.firestore.collection(AI_EMPTY_SITE_SWEEPS_COLLECTION)
  const due = await markers
    .where('dueAt', '<=', new Date(startedAt))
    .orderBy('dueAt', 'asc')
    .limit(options.max ?? AI_EMPTY_SITE_SWEEP_MAX)
    .get()
  const result: AiEmptySiteSweepResult = { due: due.size, removed: 0, kept: 0, later: 0 }

  for (const doc of due.docs) {
    if (now() - startedAt >= budgetMs) break
    const stored = doc.data() as Partial<AiEmptySiteSweep> & { dueAt?: Instant; settledAt?: Instant }
    const marker = {
      hostId: String(stored.hostId ?? doc.id),
      orgId: String(stored.orgId ?? ''),
      jobId: String(stored.jobId ?? ''),
      dueAt: new Date(toMillis(stored.dueAt) ?? startedAt),
      attempts: Number(stored.attempts ?? 0),
    }
    try {
      if (!marker.orgId || !marker.jobId) {
        await doc.ref.delete()
        result.kept += 1
        continue
      }
      const verdict = await aiEmptySiteVerdict(options.firestore, marker)
      if (verdict.kind === 'keep') {
        await doc.ref.delete()
        result.kept += 1
        console.info('ai empty site kept', { ...marker, reason: verdict.reason })
        continue
      }
      if (verdict.kind === 'later') {
        await doc.ref.set({ dueAt: verdict.dueAt }, { merge: true })
        result.later += 1
        continue
      }
      const erased = await erase({
        hostId: marker.hostId,
        orgId: marker.orgId,
        activity: AI_EMPTY_SITE_ACTIVITY,
        reason: AI_EMPTY_SITE_REASON,
      })
      if (erased.erased) {
        // Said on the job only once the site is gone, so its pages can say so.
        await options.firestore
          .collection('orgs')
          .doc(marker.orgId)
          .collection(JOBS_COLLECTION)
          .doc(marker.jobId)
          .set({ siteRemoved: { at: new Date(now()), name: verdict.name } }, { merge: true })
        await doc.ref.delete()
        result.removed += 1
        console.info('ai empty site removed', marker)
        continue
      }
      const refused = 'reason' in erased ? erased.reason : 'unavailable'
      if (refused !== 'unavailable') {
        await doc.ref.delete()
        result.kept += 1
        console.info('ai empty site kept', { ...marker, reason: refused })
        continue
      }
      await retryLater(doc.ref, marker, now())
      result.later += 1
    } catch (error) {
      console.error('ai empty site sweep failed', { ...marker, error })
      await retryLater(doc.ref, marker, now()).catch(() => undefined)
      result.later += 1
    }
  }
  return result
}

/** Moves a marker the eraser could not answer later, or gives it up. */
async function retryLater(
  ref: FirebaseFirestore.DocumentReference,
  marker: { hostId: string; orgId: string; jobId: string; attempts: number },
  nowMs: number,
): Promise<void> {
  const attempts = marker.attempts + 1
  if (attempts >= AI_EMPTY_SITE_MAX_ATTEMPTS) {
    console.error('ai empty site: removal given up', { ...marker, attempts })
    await ref.delete()
    return
  }
  await ref.set({ attempts, dueAt: new Date(nowMs + AI_EMPTY_SITE_RETRY_MS) }, { merge: true })
}
