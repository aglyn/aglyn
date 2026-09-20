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

/**
 * A plugin's own scheduled jobs, run by the CONSOLE (AGL-2981).
 *
 * The platform already has a beat for work that belongs on the tenant — the
 * job runner behind `pluginJobsBeat` — and it is the wrong place for a job
 * that holds a credential only the console may hold: a provider key, a
 * sealed grant to a person's mailbox. Those jobs have to run in the console,
 * and until now the only way to get one there was a console route of its own
 * and a literal in the scheduler's route list, which is a plugin's route in
 * the platform's code.
 *
 * So a plugin DECLARES a console job here instead, and the platform runs
 * every declared job from one route, `/api/admin/plugin-crons`, which the
 * Cloud Scheduler job that drives the console's fifteen-minute sweeps posts
 * like any other of its routes. A plugin that adds a job adds a declaration;
 * the scheduler, its firewall rule and its deploy are unchanged.
 *
 * ## One schedule
 *
 * Every declared job runs on that tick: {@link PLUGIN_CONSOLE_CRON_SCHEDULE}.
 * A job that has nothing to do returns at once. A job that needs a slower
 * cadence keeps its own "last ran" mark and skips; one that needs a faster
 * one is not a job for this runner.
 *
 * ## Watched like every other job
 *
 * Each job has its own row on `/api/health/crons` —
 * {@link pluginConsoleCronScheduledJobs} — and the runner stamps that row's
 * `platformCronBeats` mark when it invokes the job, BEFORE the work, the rule
 * every console cron follows: the mark answers "is this job still being
 * scheduled", and a job that throws was still scheduled. A job that stops
 * being run — its plugin unregistered it, the route stopped being posted —
 * goes red on the board within its grace.
 *
 * ## Isolated, and bounded
 *
 * Jobs run concurrently, each in its own try: a throw is logged against its
 * plugin and reported as `null`, and never stops another job. Each is handed
 * a deadline, and a job that starts no new unit of work after it lets the
 * route answer before its caller gives up.
 *
 * Declared from a plugin's `consoleServerDeclarations` — the console's boot
 * registrations — with the job's body imported lazily, so boot pays for the
 * declaration and the tick pays for the work.
 */

import { SCHEDULED_JOBS, type ScheduledJob } from '../app-utils/health-report'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** The console route that runs every declared job, as the scheduler posts it. */
export const PLUGIN_CONSOLE_CRONS_ROUTE = '/api/admin/plugin-crons'

/** The runner's own row on `/api/health/crons`: is the route being posted at all. */
export const PLUGIN_CONSOLE_CRONS_JOB_ID = 'plugin-console-crons'

/**
 * The tick every declared job runs on, five-field UTC: the console's
 * fifteen-minute sweep (`CONSOLE_FAST_CRON_SCHEDULE` in `cloud/functions`).
 */
export const PLUGIN_CONSOLE_CRON_SCHEDULE = '*/15 * * * *'

/** How late a declared job may be before its row goes red: three missed ticks. */
export const PLUGIN_CONSOLE_CRON_GRACE_MINUTES = 45

/** What one run of a job is handed. */
export interface PluginConsoleCronContext {
  /** When the tick began, epoch ms. */
  nowMs: number
  /** Start no new unit of work after this, epoch ms. */
  deadlineMs: number
}

/** What a job reports for the tick's answer and log: counts, flags, a word — never content. */
export type PluginConsoleCronReport = Readonly<Record<string, number | boolean | string | null>>

export interface PluginConsoleCronJob {
  /**
   * The job's id: its `platformCronBeats` document and its health row.
   * Starts with the plugin's own id — `acme-mail-sync` for `acme-mail` — so
   * two plugins' jobs, and a plugin's job and the platform's, never share one.
   */
  id: string
  /** What the health board calls it. */
  label: string
  /** What stops happening when it stops, in a sentence the board renders. */
  drives: string
  run(context: PluginConsoleCronContext): Promise<PluginConsoleCronReport>
}

/** A declared job, without its body. */
export interface PluginConsoleCronDeclaration {
  pluginId: string
  id: string
  label: string
  drives: string
}

interface Registration extends PluginConsoleCronDeclaration {
  run: PluginConsoleCronJob['run']
}

const registrations: Registration[] = []

/** A job id as a beat document and a health row can carry it. */
const JOB_ID = /^[a-z][a-z0-9-]*$/

/** Job ids the platform's own inventory holds. */
const PLATFORM_JOB_IDS = new Set([...SCHEDULED_JOBS.map((job) => job.id), PLUGIN_CONSOLE_CRONS_JOB_ID])

/**
 * Declares a plugin's console job. Owner = the loader's marker inside a
 * register fn, else `options.pluginId`; a job with neither throws, as does
 * an id that is not the plugin's own (`<pluginId>-…`), one the platform's
 * inventory holds, one another plugin declared, and a job with no label or
 * no consequence. The same plugin declaring the same id again replaces its
 * job in place.
 */
export function registerPluginConsoleCron(
  job: PluginConsoleCronJob,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a plugin console job was registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  const id = String(job?.id ?? '').trim()
  if (!JOB_ID.test(id) || !id.startsWith(`${pluginId}-`) || id === `${pluginId}-`) {
    throw new Error(
      `plugin console job "${id}" from "${pluginId}" needs an id of its own: ` +
        `"${pluginId}-" and a lowercase name`,
    )
  }
  if (PLATFORM_JOB_IDS.has(id)) {
    throw new Error(`plugin console job "${id}" is a platform job's id; refused "${pluginId}"`)
  }
  const incumbent = registrations.find((entry) => entry.id === id)
  if (incumbent && incumbent.pluginId !== pluginId) {
    throw new Error(
      `plugin console job "${id}" is already declared by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  const label = String(job.label ?? '').trim()
  const drives = String(job.drives ?? '').trim()
  if (!label || !drives || typeof job.run !== 'function') {
    throw new Error(`plugin console job "${id}" needs a label, what it drives, and a run function`)
  }
  const registration: Registration = { pluginId, id, label, drives, run: job.run }
  const index = registrations.findIndex((entry) => entry.id === id)
  if (index >= 0) registrations[index] = registration
  else registrations.push(registration)
}

/** Every declared job, in declaration order, without its body. */
export function listPluginConsoleCrons(): PluginConsoleCronDeclaration[] {
  return registrations.map(({ pluginId, id, label, drives }) => ({ pluginId, id, label, drives }))
}

/**
 * The declared jobs as rows of the scheduled-job inventory, for
 * `/api/health/crons` to judge beside the platform's own.
 */
export function pluginConsoleCronScheduledJobs(): ScheduledJob[] {
  return registrations.map((entry) => ({
    id: entry.id,
    label: entry.label,
    cron: PLUGIN_CONSOLE_CRON_SCHEDULE,
    runner: 'cloud-scheduler',
    target: `consoleFastCrons → console ${PLUGIN_CONSOLE_CRONS_ROUTE} (${entry.pluginId})`,
    graceMinutes: PLUGIN_CONSOLE_CRON_GRACE_MINUTES,
    drives: entry.drives,
  }))
}

export interface RunPluginConsoleCronsOptions {
  nowMs: number
  deadlineMs: number
  /** Only these jobs, by id — a manual re-run of one. Absent runs every job. */
  jobIds?: readonly string[] | null
  /**
   * Stamps a job's `platformCronBeats` mark. Must not throw; the runner
   * awaits it before the job starts.
   */
  beat(jobId: string, nowMs: number): Promise<unknown>
}

/**
 * Runs the declared jobs — every one, or the ones named — concurrently,
 * each after its beat. Answers each job's report by id, or `null` for one
 * that threw. Never throws.
 */
export async function runPluginConsoleCrons(
  options: RunPluginConsoleCronsOptions,
): Promise<Record<string, PluginConsoleCronReport | null>> {
  const wanted = options.jobIds?.length ? new Set(options.jobIds) : null
  const jobs = [...registrations].filter((entry) => !wanted || wanted.has(entry.id))
  const settled = await Promise.all(
    jobs.map(async (job): Promise<[string, PluginConsoleCronReport | null]> => {
      try {
        await options.beat(job.id, options.nowMs)
      } catch {
        // A beat that cannot be written must not take down the job it
        // describes; a write that keeps failing reads as a silent job.
      }
      try {
        return [job.id, await job.run({ nowMs: options.nowMs, deadlineMs: options.deadlineMs })]
      } catch (error) {
        console.error(`[plugins] ${job.pluginId} console job ${job.id} failed`, error)
        return [job.id, null]
      }
    }),
  )
  // Declaration order, whichever job finished first.
  return Object.fromEntries(settled)
}

/** Test seam: forget every declared job. */
export function resetPluginConsoleCronsForTests(): void {
  registrations.length = 0
}
