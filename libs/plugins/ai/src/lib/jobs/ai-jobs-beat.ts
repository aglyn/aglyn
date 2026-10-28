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

import { randomUUID } from 'crypto'
import { featureLockdownRefusal, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { AI_JOB_SWEEP_BUDGET_MS, sweepAiJobs, type SweepAiJobsResult } from './ai-jobs'
import { sweepAiEmptySites, type AiEmptySiteSweepResult } from './ai-empty-site-sweep'
import { sweepAiPlanReminders, type AiPlanReminderSweepResult } from './ai-jobs-notify'

/**
 * Resume AI generation jobs on the AI jobs beat (AGL-2904, AGL-3026).
 *
 * A job's first step runs inline in the console route when it can; every
 * step after it, every step too long for an inline door, and any step a
 * budget cut short, runs here. The sweep bounds itself at
 * `AI_JOB_SWEEP_BUDGET_MS` of wall clock and hands the rest to the next beat
 * — the ordering of the queue is the cursor, so nothing is stored between
 * beats and nothing can be skipped.
 *
 * ## Why the console runs it
 *
 * A step calls the AI provider, and the provider's key is held by the
 * console alone: the tenant app serves every published site, and a
 * credential it holds is one request-handling bug away from a visitor. So
 * the beat is a console route (`server/ai-jobs-beat-route.ts`, registered
 * by the console surface), driven every minute by its own Cloud Scheduler
 * job in `cloud/functions` on the console's cron secret — the reason the
 * sending-domain sweep is a console route and not a job on the tenant's
 * platform beat. A beat must resolve to the minute: a step handed back by
 * a budget, or a page pass waiting on the next, should resume on the next
 * minute, not the next quarter hour.
 *
 * ## The kill switch
 *
 * `ai-generate` on the staff lockdown page is the lever for a provider
 * incident or a spend runaway on the generative doors, and this beat is the
 * one generative caller with no request to refuse. So it asks the same
 * feature verdict a door would — the platform scope and then the feature
 * document — and does nothing while either is locked. A job it leaves
 * queued stays queued: its lease is not taken, so nothing expires and
 * nothing is lost, and the first beat after the lock lifts picks it up.
 *
 * The same switch paused for ONE workspace (AGL-3037) holds that workspace's
 * jobs and no other's: `runAiJobStep` asks the verdict with the job's org
 * before it claims a step, and leaves a paused workspace's job queued.
 */

/** The beat's row in `SCHEDULED_JOBS`, and the mark it leaves for `/api/health/crons`. */
export const AI_JOBS_BEAT_CRON_ID = 'ai-jobs-beat'

/**
 * The console path the beat is registered at: the one path this plugin
 * registers outside its own prefixes. `/api/admin/` is where the console's
 * scheduled sweeps live, and the console's edge lets a request past its bot
 * challenge there when it carries the cron secret's header — a route
 * anywhere else would need a firewall rule of its own before a scheduler
 * could reach it. The console app serves this exact path from a named route
 * with the sweep's function time, so the plugin dispatcher never serves it.
 */
export const AI_JOBS_BEAT_PATH = 'admin/ai-jobs-beat'

/** What one beat did: nothing while `ai-generate` is locked, else the sweep's account. */
export type AiJobsBeatResult =
  | { held: true }
  | ({
      held: false
      emptySites: AiEmptySiteSweepResult | null
      planReminders: AiPlanReminderSweepResult | null
    } & SweepAiJobsResult)

/**
 * One beat: the switch, then the empty sites a guided start left that are
 * due for removal (AGL-3936), then the one reminder a plan waiting a day
 * for its confirmation is owed (AGL-4076), then one sweep under its own
 * lease owner. The owner is fresh per beat and fixed for the whole sweep, so
 * two beats overlapping inside a lease never read each other's lease as
 * their own.
 *
 * The removals and the reminders come first, each a few a beat inside its
 * own budget, and whatever they took comes off the sweep's budget, so the
 * route's arithmetic inside `maxDuration` holds. A removal or a reminder that
 * fails never holds up a job's step.
 */
export async function runAiJobsBeat(): Promise<AiJobsBeatResult> {
  const locked = await featureLockdownRefusal({ feature: 'ai-generate' })
  if (locked) {
    console.warn('ai jobs beat held: ai-generate is locked')
    return { held: true }
  }
  const firestore = firebaseAdmin.app().firestore()
  const startedAt = Date.now()
  const emptySites = await sweepAiEmptySites({ firestore }).catch((error: unknown) => {
    console.error('ai jobs beat: the empty site sweep failed', error)
    return null
  })
  if (emptySites?.removed) console.info(`ai jobs: ${emptySites.removed} empty site(s) removed`)
  const planReminders = await sweepAiPlanReminders({ firestore }).catch((error: unknown) => {
    console.error('ai jobs beat: the plan reminders failed', error)
    return null
  })
  const result = await sweepAiJobs({
    firestore,
    owner: `beat:${randomUUID()}`,
    budgetMs: Math.max(0, AI_JOB_SWEEP_BUDGET_MS - (Date.now() - startedAt)),
  })
  if (result.due) {
    console.info(
      `ai jobs: ${result.ran} step(s) run, ${result.skipped} skipped, ` +
        `${result.paused} held by a workspace's AI pause, ` +
        `${result.remaining} left for the next beat` +
        (result.budgetExhausted ? ' (budget exhausted)' : ''),
    )
  }
  return { held: false, emptySites, planReminders, ...result }
}
