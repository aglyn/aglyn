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
import { registerPluginJob } from '@aglyn/aglyn/server'
import { featureLockdownRefusal, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { AI_JOB_SWEEP_BUDGET_MS, sweepAiJobs } from './ai-jobs'

/**
 * Resume AI generation jobs on the platform job beat (AGL-2904).
 *
 * A job's first step runs inline in the console route when it can; every
 * step after it, and any step the route's budget cut short, runs here. The
 * beat fires every minute against a 120 s function timeout, so the sweep
 * bounds itself at `AI_JOB_SWEEP_BUDGET_MS` of wall clock and hands the
 * rest to the next beat — the ordering of the queue is the cursor, so
 * nothing is stored between beats and nothing can be skipped.
 *
 * ## Why the beat and not a schedule of its own
 *
 * The reason `sending-domain-recheck-job.ts` gives: the runner route already
 * fires from the project's one Cloud Scheduler job, and a second scheduled
 * route is a second thing to orphan. The runner's due-ness check makes an
 * interval into a schedule, and the sweep is bounded by its own clock.
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
 */

/**
 * The namespace this job registers under. Not a plugin: the registry never
 * interprets `pluginId`, and an id with no manifest passes the runner's
 * release-flag filter untouched, the way `core` does. Its own name rather
 * than `core`, so the run-jobs response reads which surface the beat spent
 * its time on.
 */
export const AI_JOBS_PLUGIN_ID = 'ai'

export const AI_JOBS_BEAT_JOB = 'ai-jobs'

/** The one place the sweep is scheduled; exported for the spec, not for callers. */
export async function runAiJobsBeat(): Promise<void> {
  const locked = await featureLockdownRefusal({ feature: 'ai-generate' })
  if (locked) {
    console.warn('ai jobs beat held: ai-generate is locked')
    return
  }
  const result = await sweepAiJobs({
    firestore: firebaseAdmin.app().firestore(),
    owner: `beat:${randomUUID()}`,
    budgetMs: AI_JOB_SWEEP_BUDGET_MS,
  })
  if (result.due) {
    console.info(
      `ai jobs: ${result.ran} step(s) run, ${result.skipped} skipped, ` +
        `${result.remaining} left for the next beat` +
        (result.budgetExhausted ? ' (budget exhausted)' : ''),
    )
  }
}

registerPluginJob({
  pluginId: AI_JOBS_PLUGIN_ID,
  name: 'ai-jobs',
  // The beat is the resolution: a step cut short by the route's budget
  // should resume on the next minute, not the next quarter hour.
  intervalMinutes: 1,
  description:
    'Run the queued steps of AI generation jobs across every workspace, ' +
    'inside a wall-clock budget, and resume any the console route left.',
  /*
   * PLATFORM scope, and the reason is what this job spends rather than
   * where it writes. It reads jobs by collection group across every org and
   * writes only to `orgs/{orgId}/aiJobs` — drafts and new versions, never a
   * publish — so a site lock has nothing here to withhold: nothing a job
   * produces is visible to a visitor until a member publishes it through a
   * door that IS gated. What a lock on this beat is for is the provider
   * bill, and that is the `ai-generate` feature switch the handler asks
   * before it claims a step.
   */
  lockdown: {
    scope: 'platform',
    reason:
      'provider spend: writes only unpublished drafts under the org and ' +
      'resolves no host; the ai-generate feature switch is the lock that ' +
      'applies, and the handler asks it before claiming a step.',
  },
  handler: async () => {
    await runAiJobsBeat()
  },
})
