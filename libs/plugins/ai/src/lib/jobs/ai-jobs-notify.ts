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

import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { notifyUsers } from '@aglyn/tenant-data-admin/server/notifications'
import { raiseOperatorAlert } from '@aglyn/tenant-data-admin/server/operator-alerts'
import { AI_BUILD_PARTLY_FAILED, AI_JOB_FAILED } from '../operator-alerts'
import { liveCustomDomain } from '@aglyn/aglyn/app-utils/host-naming'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import { aiJobNotice, aiJobPlanReminderNotice, type AiJobNoticeSite } from '../model/ai-job-notice'
import type { AiJob } from '../model/ai-jobs.types'
import { aiBusinessProfilePrefiller } from './ai-business-profile-prefill'
import { aiJobAutoConfirms } from './ai-job-auto-confirm'
import { registerAiJobTransitionListener, type AiJobTransitionListener } from './ai-jobs'

/**
 * The person who started an AI job is told when it needs them, when it
 * finishes and when it stops (AGL-3593), through the console's notifications
 * — the bell, and the generic notification email for a person who switched
 * that channel on for the category. No other channel: there is no push.
 *
 * The machine calls this where the job's state changes, once per change
 * (`registerAiJobTransitionListener`): the request that ran a step inline,
 * or the beat that ran it with nobody watching — which is exactly when a
 * person needs telling. The recipient is the job's creator, whose job it is
 * and who alone confirms its plan; a teammate is not told about someone
 * else's draft.
 *
 * `notifyUsers` never throws, and honors the person's per-category,
 * per-workspace and per-site preferences.
 */
export function aiJobTransitionNotifier(
  notify: typeof notifyUsers = notifyUsers,
  readSite: (hostId: string) => Promise<AiJobNoticeSite | null> = readJobSite,
): AiJobTransitionListener {
  return async ({ job, to }) => {
    if (!job.createdBy) return
    // A guided site start's plan is confirmed for it the moment it is kept
    // (AGL-3594): there is nothing for the person to confirm.
    if (to === 'needs-review' && job.review?.reason === 'plan' && aiJobAutoConfirms(job)) return
    // The site a job worked on, by name and address (AGL-3889): the email is
    // read away from the console, often by someone with several sites.
    const site = job.hostId ? await readSite(job.hostId).catch(() => null) : null
    const notice = aiJobNotice(job, to, site)
    if (!site) {
      await notify([job.createdBy], notice)
      return
    }
    await notify([job.createdBy], notice, {
      emailDetails: [
        { label: 'Site', value: site.name },
        ...(site.url ? [{ label: 'Address', value: site.url }] : []),
      ],
    })
  }
}

/**
 * A job's site as its notice names it: the name its managers gave it, else
 * its address, and where it is live — its custom domain once that serves,
 * else its platform subdomain. `null` for a site that is gone.
 */
export async function readJobSite(
  hostId: string,
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<AiJobNoticeSite | null> {
  const host = await firestore.collection('hosts').doc(hostId).get()
  if (!host.exists) return null
  const data = (host.data() ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const subdomain = text(data['subdomain'])
  const domain = liveCustomDomain(data as never)
  return {
    name: text(data['displayName']) || text(data['name']) || subdomain || hostId,
    url: domain ? `https://${domain}` : subdomain ? `https://${subdomain}.${TENANT_APEX}` : null,
  }
}

// ── The one plan-ready reminder (AGL-4076) ───────────────────────────────

/**
 * How long a plan waits for its confirmation before its one reminder: a day
 * after the job last changed, which for a plan nobody touched is the moment
 * it was ready.
 */
export const AI_PLAN_REMINDER_AFTER_MS = 24 * 60 * 60_000

/**
 * How long after it is due a reminder may still go out. A plan that has
 * waited longer than a day and this is never reminded: the person was told
 * when it was ready, and a reminder about a plan left for a week reads as
 * noise, so the plans already waiting when this shipped are not mailed all
 * at once. It is also the beats a lockdown of `ai-generate` may hold the
 * reminders for before one is missed rather than sent late.
 */
export const AI_PLAN_REMINDER_WINDOW_MS = 6 * 60 * 60_000

/** The waiting jobs one beat reads, oldest first. */
export const AI_PLAN_REMINDER_SCAN = 25

/** The reminders one beat sends; the rest are the next minute's. */
export const AI_PLAN_REMINDER_MAX = 5

/** Wall clock one beat gives the reminders before it runs any job's step. */
export const AI_PLAN_REMINDER_BUDGET_MS = 10_000

/** The org's jobs, as `AI_JOBS_COLLECTION` in `ai-jobs.ts` names them. */
const JOBS_COLLECTION = 'aiJobs'

type Instant = Date | { toMillis(): number } | number | string | null | undefined

function instantMs(value: Instant): number | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return typeof value.toMillis === 'function' ? value.toMillis() : null
}

/**
 * Whether a job is owed its plan reminder now (AGL-4076): its plan waits for
 * the person who started it (`needs_review`, reason `plan`), has waited
 * between a day and a day and {@link AI_PLAN_REMINDER_WINDOW_MS}, and the job
 * was never reminded. Never a plan that is confirmed for its person (a guided
 * start's), a job someone asked to cancel, or one whose site was removed: the
 * same jobs the first notice skips, and the ones that moved on.
 */
export function aiPlanReminderDue(
  job: Pick<AiJob, 'kind' | 'inputs' | 'status' | 'review' | 'createdBy' | 'updatedAt' | 'remindedAt' | 'cancelRequested' | 'siteRemoved'>,
  nowMs: number,
): boolean {
  if (job.status !== 'needs_review' || job.review?.reason !== 'plan' || !job.createdBy) return false
  if (job.remindedAt || job.cancelRequested || job.siteRemoved || aiJobAutoConfirms(job)) return false
  const waitedMs = nowMs - (instantMs(job.updatedAt as Instant) ?? nowMs)
  return waitedMs >= AI_PLAN_REMINDER_AFTER_MS && waitedMs < AI_PLAN_REMINDER_AFTER_MS + AI_PLAN_REMINDER_WINDOW_MS
}

export interface AiPlanReminderSweepResult {
  /** Jobs read that were waiting in the window, reminded or not. */
  scanned: number
  /** Reminders sent. */
  reminded: number
}

export interface SweepAiPlanRemindersOptions {
  firestore: FirebaseFirestore.Firestore
  now?: () => number
  budgetMs?: number
  notify?: typeof notifyUsers
  /** The job's site; `readJobSite` unless a spec replaces it. */
  readSite?: (hostId: string) => Promise<AiJobNoticeSite | null>
}

/**
 * One beat's plan reminders (AGL-4076). A plan that waits for its
 * confirmation is told about once when it is ready (`aiJobTransitionNotifier`)
 * and once more a day later, here, and never again: 13 plans in the 10/10 to
 * 10/28 window waited 4 to 428 hours after their single notice.
 *
 * The waiting jobs are read by the collection-group index the sweep already
 * uses, on (status, updatedAt), inside the window a reminder may go out in,
 * oldest first; every condition is then read again on the job, in the
 * transaction that marks `remindedAt`, so two beats never both send one and a
 * job confirmed, cancelled or deleted in the meantime gets none. The mark is
 * written before the notice: a beat that dies between the two loses a
 * reminder rather than sending a second. `notifyUsers` holds the notice to the
 * person's own settings for AI job needs you, by channel, workspace and site,
 * as it holds the first one; a job whose site is gone is not reminded.
 *
 * The mark leaves `updatedAt` alone, so the job's age in AI jobs stays the
 * age of its plan.
 */
export async function sweepAiPlanReminders(options: SweepAiPlanRemindersOptions): Promise<AiPlanReminderSweepResult> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const budgetMs = options.budgetMs ?? AI_PLAN_REMINDER_BUDGET_MS
  const notify = options.notify ?? notifyUsers
  const readSite = options.readSite ?? ((hostId: string) => readJobSite(hostId, options.firestore))
  const dueBefore = startedAt - AI_PLAN_REMINDER_AFTER_MS
  const waiting = await options.firestore
    .collectionGroup(JOBS_COLLECTION)
    .where('status', '==', 'needs_review')
    .where('updatedAt', '<=', new Date(dueBefore))
    .where('updatedAt', '>', new Date(dueBefore - AI_PLAN_REMINDER_WINDOW_MS))
    .orderBy('updatedAt', 'asc')
    .limit(AI_PLAN_REMINDER_SCAN)
    .get()
  const result: AiPlanReminderSweepResult = { scanned: waiting.size, reminded: 0 }
  for (const doc of waiting.docs) {
    if (result.reminded >= AI_PLAN_REMINDER_MAX || now() - startedAt >= budgetMs) break
    const listed = { ...(doc.data() as Omit<AiJob, '$id'>), $id: doc.id } as AiJob
    if (!aiPlanReminderDue(listed, now())) continue
    try {
      // A job's site, read before the mark, so a job whose site is gone is never marked or told.
      const site = listed.hostId ? await readSite(listed.hostId) : null
      if (listed.hostId && !site) continue
      const job = await options.firestore.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref)
        if (!fresh.exists) return null
        const current = { ...(fresh.data() as Omit<AiJob, '$id'>), $id: fresh.id } as AiJob
        if (!aiPlanReminderDue(current, now())) return null
        tx.update(doc.ref, { remindedAt: new Date(now()) })
        return current
      })
      if (!job) continue
      const notice = aiJobPlanReminderNotice(job, site)
      if (site) {
        await notify([job.createdBy], notice, {
          emailDetails: [
            { label: 'Site', value: site.name },
            ...(site.url ? [{ label: 'Address', value: site.url }] : []),
          ],
        })
      } else {
        await notify([job.createdBy], notice)
      }
      result.reminded += 1
    } catch (error) {
      // One job's fault is isolated; an unmarked job is read again next beat, inside its window.
      console.error('ai plan reminder failed', { orgId: listed.orgId, jobId: listed.$id, error })
    }
  }
  if (result.reminded) console.info(`ai jobs: ${result.reminded} plan reminder(s) sent`)
  return result
}

/** The longest runner error an alert quotes; the log has the rest. */
const ALERT_ERROR_MAX = 300

/** At most this many failed parts are named in a partial-build alert. */
const ALERT_ITEMS_MAX = 5

const capped = (text: string): string =>
  text.length > ALERT_ERROR_MAX ? `${text.slice(0, ALERT_ERROR_MAX)}…` : text

/**
 * Staff are told when a job fails on our side (`ai.jobFailed`), and when a
 * build finishes `done` with parts that failed on our side
 * (`ai.buildPartlyFailed`) — each deduped per job kind, so a broken provider
 * or a broken step is heard about the hour it starts. A failure that is the
 * customer's — the model declined the brief or a part of it, the site
 * switched AI off — raises nothing. `raiseOperatorAlert` never throws.
 */
export function aiJobFailureAlerter(
  raise: typeof raiseOperatorAlert = raiseOperatorAlert,
): AiJobTransitionListener {
  return async ({ job, to, failure }) => {
    if (to === 'done') {
      const items = job.items ?? []
      const ours = items.filter((row) => row.status === 'failed' && row.failure?.ours)
      if (!ours.length) return
      const named = ours
        .slice(0, ALERT_ITEMS_MAX)
        .map((row) => `${row.label} (${row.failure?.reason}${row.failure?.detail ? `: ${row.failure.detail}` : ''})`)
        .join('; ')
      await raise(AI_BUILD_PARTLY_FAILED, {
        dedupeKey: job.kind,
        orgId: job.orgId,
        ...(job.hostId ? { hostId: job.hostId } : {}),
        context: {
          kind: job.kind,
          jobId: job.$id,
          orgId: job.orgId,
          failed: ours.length,
          total: items.length,
          items: capped(ours.length > ALERT_ITEMS_MAX ? `${named}; and ${ours.length - ALERT_ITEMS_MAX} more` : named),
        },
      })
      return
    }
    if (to !== 'failed' || !failure?.ours) return
    const error = failure.error ?? job.error ?? 'no error recorded'
    await raise(AI_JOB_FAILED, {
      dedupeKey: job.kind,
      orgId: job.orgId,
      ...(job.hostId ? { hostId: job.hostId } : {}),
      context: {
        kind: job.kind,
        jobId: job.$id,
        orgId: job.orgId,
        step: failure.stepIndex === null ? 'n/a' : job.steps[failure.stepIndex]?.name ?? failure.stepIndex,
        error: capped(error),
      },
    })
  }
}

/**
 * Registers what the jobs machine tells about each change: the notifier, the
 * staff alert for a failure on our side, and the business profile's prefill
 * from a site job (AGL-3661). One listener, each in turn; the alert and the
 * prefill swallow their own failures, so neither costs the person their notice.
 */
export function registerAiJobsNotify(): void {
  const notify = aiJobTransitionNotifier()
  const alert = aiJobFailureAlerter()
  const prefill = aiBusinessProfilePrefiller(() => firebaseAdmin.app().firestore())
  registerAiJobTransitionListener(async (change) => {
    await notify(change)
    await alert(change)
    await prefill(change)
  })
}
