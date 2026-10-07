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
  AI_JOB_PLAN_STEP,
  type AiJobKind,
  type AiJobReviewReason,
  type AiJobStatus,
  type AiJobStepStatus,
} from './ai-jobs.types'

/**
 * WHAT A JOB IS DOING, IN THE WORDS EVERY SURFACE SHOWS (AGL-3593).
 *
 * A job's `status` is the machine's word: `needs_review` covers both a plan
 * waiting to be confirmed and an answer that broke a building rule twice, and
 * `queued`/`running` say nothing about whether the job is still planning or
 * already building. The console's surfaces — the AI jobs drawer's header and
 * rows, the top-bar indicator, the Assist launcher's badge, the dialog that
 * started the job, and the notification the machine raises — each tell a
 * person the same thing, so they read it from here and nowhere else. A drawer
 * that counted a refused plan as "running" while the chip said "needs you" is
 * the disagreement this exists to rule out.
 *
 * Pure, and over the fields a stored job and its wire form share, so the
 * server's notifier and the console read the same answer.
 */

/** The fields a phase is read from: a stored job and its wire summary both carry them. */
export interface AiJobPhaseSource {
  status: AiJobStatus
  review?: { reason: AiJobReviewReason } | null
  steps: ReadonlyArray<{ name: string; status: AiJobStepStatus }>
  /** The wire summary's: the machine confirms this job's plan itself. */
  autoConfirm?: boolean
  /** When the job last moved; the wire summary's ISO string. */
  updatedAt?: unknown
}

/**
 * How long a self-confirming plan may sit parked before it reads as waiting
 * for a person after all: a confirmation that never came.
 */
export const AI_JOB_SELF_CONFIRM_GRACE_MS = 5 * 60_000

/**
 * Whether a job is parked on a plan the machine is about to confirm itself
 * (AGL-3596). A guided site start records its plan step — parking the job on
 * the plan as every planned job does — and confirms it in the next write, so
 * a surface that reads in between sees `needs_review` for an instant. That
 * instant is the build going on, never a stop: read as one, it showed the
 * person a failed site that turned green again a moment later. The job's
 * `updatedAt` there is the clock its step was claimed at, so the grace covers
 * the plan step's own run as well as the confirmation. Past
 * {@link AI_JOB_SELF_CONFIRM_GRACE_MS} without the confirmation, the park is
 * what it says.
 */
export function aiJobConfirmingOwnPlan(
  job: Pick<AiJobPhaseSource, 'status' | 'review' | 'autoConfirm' | 'updatedAt'>,
  now: number = Date.now(),
): boolean {
  if (job.status !== 'needs_review' || job.review?.reason !== 'plan' || job.autoConfirm !== true) return false
  const at = typeof job.updatedAt === 'string' ? Date.parse(job.updatedAt) : NaN
  return !Number.isFinite(at) || now - at < AI_JOB_SELF_CONFIRM_GRACE_MS
}

/**
 * Where one job stands, as a person reads it:
 *
 * - `queued` — created, no step has started.
 * - `planning` — its plan step is the one running or next.
 * - `plan-ready` — its plan waits for the person to confirm it.
 * - `building` — a step after the plan (or a kind with no plan) is running or next.
 * - `attention` — it stopped for something only a person can change: an
 *   answer that broke a building rule, a site at an allowance, the
 *   workspace's credits or a switch.
 * - `done`, `failed`, `canceled` — settled.
 */
export type AiJobPhase =
  | 'queued'
  | 'planning'
  | 'plan-ready'
  | 'building'
  | 'attention'
  | 'done'
  | 'failed'
  | 'canceled'

export function aiJobPhase(job: AiJobPhaseSource): AiJobPhase {
  if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
    return job.status
  }
  if (job.status === 'needs_review' && !aiJobConfirmingOwnPlan(job)) {
    return job.review?.reason === 'plan' ? 'plan-ready' : 'attention'
  }
  if (job.status === 'needs_input') return 'attention'
  // Moving: the first step that has not finished says which half it is in.
  const next = job.steps.find((step) => step.status === 'running' || step.status === 'pending')
  if (next?.name === AI_JOB_PLAN_STEP) return 'planning'
  if (job.status === 'queued' && job.steps.every((step) => step.status === 'pending')) {
    return 'queued'
  }
  return 'building'
}

/** Each phase in the words a status line and a chip use. */
export const AI_JOB_PHASE_LABELS: Readonly<Record<AiJobPhase, string>> = {
  queued: 'Queued',
  planning: 'Planning',
  'plan-ready': 'Plan ready',
  building: 'Building',
  attention: 'Needs attention',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
}

/**
 * What the top-bar indicator, the launcher badge and the drawer's header
 * count a job as, or `null` for a settled job, which none of them count.
 *
 * - `needs-you` — a plan waits to be confirmed: the one decision that, left
 *   alone, leaves the person's site unbuilt.
 * - `attention` — stopped for something a person must change, which is not a
 *   plan to confirm.
 * - `running` — queued, planning or building. Never a stopped job.
 */
export type AiJobActivityState = 'needs-you' | 'attention' | 'running'

/** Loudest first: the order the indicator picks its one state by. */
export const AI_JOB_ACTIVITY_PRECEDENCE: readonly AiJobActivityState[] = [
  'needs-you',
  'attention',
  'running',
]

export function aiJobActivityState(job: AiJobPhaseSource): AiJobActivityState | null {
  const phase = aiJobPhase(job)
  if (phase === 'plan-ready') return 'needs-you'
  if (phase === 'attention') return 'attention'
  if (phase === 'queued' || phase === 'planning' || phase === 'building') return 'running'
  return null
}

/**
 * The statuses a job the indicator counts can have: every one that is not in
 * `AI_JOB_TERMINAL_STATUSES`. The jobs route's `status=active` list asks
 * Firestore for exactly these, under the (status, createdAt) index.
 */
export const AI_JOB_ACTIVE_STATUSES: readonly AiJobStatus[] = [
  'queued',
  'running',
  'needs_input',
  'needs_review',
]

/** How many of a list's jobs stand in each state. */
export type AiJobActivityCounts = Readonly<Record<AiJobActivityState, number>>

export function aiJobActivityCounts(jobs: readonly AiJobPhaseSource[]): AiJobActivityCounts {
  const counts: Record<AiJobActivityState, number> = { 'needs-you': 0, attention: 0, running: 0 }
  for (const job of jobs) {
    const state = aiJobActivityState(job)
    if (state) counts[state] += 1
  }
  return counts
}

/**
 * What the indicator and the launcher show for a list of jobs: the loudest
 * state any of them is in, how many are in it, and the job the indicator
 * opens — the oldest of them, which has waited longest. `null` when none is
 * moving or waiting, which is when both show nothing.
 */
export interface AiJobsActivity<T> {
  state: AiJobActivityState
  count: number
  /** The job a click targets. */
  job: T
  /** Planning rather than building, for the running chip's word. */
  planning: boolean
}

export function aiJobsActivity<T extends AiJobPhaseSource>(
  jobs: readonly T[],
): AiJobsActivity<T> | null {
  for (const state of AI_JOB_ACTIVITY_PRECEDENCE) {
    const matching = jobs.filter((job) => aiJobActivityState(job) === state)
    if (!matching.length) continue
    return {
      state,
      count: matching.length,
      // Lists arrive newest first.
      job: matching[matching.length - 1],
      planning:
        state === 'running' &&
        matching.every((job) => {
          const phase = aiJobPhase(job)
          return phase === 'planning' || phase === 'queued'
        }),
    }
  }
  return null
}

/** The chip's words: `AI · plan ready`, `AI · 2 need attention`, `AI · planning`. */
export function aiJobsActivityLabel(activity: AiJobsActivity<unknown>): string {
  const { state, count } = activity
  if (state === 'needs-you') {
    return count === 1 ? 'AI · plan ready' : `AI · ${count} plans ready`
  }
  if (state === 'attention') {
    return count === 1 ? 'AI · needs attention' : `AI · ${count} need attention`
  }
  const verb = activity.planning ? 'planning' : 'working'
  return count === 1 ? `AI · ${verb}` : `AI · ${count} ${verb}`
}

/**
 * The launcher's accessible name: what the button opens, and what waits in it.
 * `Aglyn Assist, 1 AI job needs you`.
 */
export function aiJobsLauncherLabel(
  productName: string,
  activity: AiJobsActivity<unknown> | null,
): string {
  const base = `Open ${productName} Assist`
  if (!activity) return base
  const jobs = activity.count === 1 ? '1 AI job' : `${activity.count} AI jobs`
  const verb = activity.count === 1 ? 'needs' : 'need'
  if (activity.state === 'needs-you') return `${base}, ${jobs} ${verb} you`
  if (activity.state === 'attention') return `${base}, ${jobs} ${verb} attention`
  return `${base}, ${jobs} running`
}

/** The drawer header's chips, one per state that has a job, loudest first. */
export function aiJobsHeaderChips(
  counts: AiJobActivityCounts,
): Array<{ state: AiJobActivityState; label: string }> {
  return AI_JOB_ACTIVITY_PRECEDENCE.filter((state) => counts[state] > 0).map((state) => ({
    state,
    label:
      state === 'needs-you'
        ? `${counts[state]} ${counts[state] === 1 ? 'needs' : 'need'} you`
        : state === 'attention'
          ? `${counts[state]} ${counts[state] === 1 ? 'needs' : 'need'} attention`
          : `${counts[state]} running`,
  }))
}

/** What a job makes, as a sentence's subject: `Your site`, `Your page`. */
const KIND_NOUNS: Partial<Record<AiJobKind, string>> = {
  site: 'site',
  page: 'page',
  template: 'page template',
  layout: 'layout',
  form: 'form',
  component: 'component',
  email: 'email',
  campaign: 'campaign',
  workflow: 'automation',
  logic: 'function',
  theme: 'theme',
  products: 'products',
  experiment: 'experiment',
  insight: 'answer',
  build: 'build',
}

/** The noun for what a job of this kind makes, or `AI job` for a kind with none. */
export function aiJobKindNoun(kind: AiJobKind): string {
  return KIND_NOUNS[kind] ?? 'AI job'
}
