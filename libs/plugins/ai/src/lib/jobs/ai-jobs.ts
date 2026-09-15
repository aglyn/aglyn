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
 * `FieldValue` straight from the SDK rather than through `./firebase-admin`,
 * for the reason `assist-usage.ts` gives: the default-app initialization
 * would ride into every unit test that touches a job, and the statics need
 * no app at all.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { checkEntitlement } from '@aglyn/aglyn/server'
import {
  assistCreditsFromUsd,
  assistFreeTasteRefusalText,
  assistHardCapRefusalText,
  assistRefusedByHardCap,
} from '@aglyn/aglyn/app-utils/assist-credits'
import {
  AI_JOB_TERMINAL_STATUSES,
  type AiJob,
  type AiJobApplied,
  type AiJobKind,
  type AiJobOutput,
  type AiJobPlan,
  type AiJobReview,
  type AiJobStatus,
  type AiJobStep,
  type AiJobSummary,
} from '../model/ai-jobs.types'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { aiAllotmentRefusalText } from '../model/ai-allotments'
import { resolveAiModelChoice } from '../providers/model-choice'
import { aiOutputTargetType } from '../activity/ai-activity-actions'
import {
  logAiJobCanceled,
  logAiJobCreated,
  logAiJobNeedsInput,
  logAiJobOutput,
  type AiActivityActor,
} from '../activity/ai-activity'
import { AI_UPSTREAM_FAILURE_COPY, AiUpstreamError } from '../runtime/ai-runtime'
import { recordUserAiRefusal } from '../usage/ai-usage-by-user'
import {
  runAiJobTextStep,
  type AiJobStepOutcome,
  type AiJobStepRunner,
} from './ai-job-text-step'
import {
  assistExchangeExpiry,
  recordAssistCost,
  releaseAssistMessage,
  reserveAssistMessage,
  type AssistReservation,
} from '../usage/assist-usage'

/**
 * AI generation jobs — the Firestore state machine (AGL-2904).
 *
 * One document per job under the org, written only by this module through
 * the Admin SDK; the rules let a member READ their org's jobs and nobody
 * write them. The console route creates a job and runs its first step
 * inline when it can; the platform job beat claims and runs whatever is
 * queued, across every org, inside a wall-clock budget. Both go through
 * `runAiJobStep`, so there is exactly one place a step is claimed, metered,
 * run and recorded.
 *
 * ── Credits, per step ────────────────────────────────────────────────────
 *
 * Every step is an assist message to the meter: `reserveAssistMessage`
 * BEFORE the provider is called — the same read-and-increment transaction
 * the chat route takes, so a job cannot slip past the org's monthly ceiling
 * by being asynchronous — and `recordAssistCost` after, at the serving
 * model's rates, so the usage rollup and the invoice see a job's tokens
 * exactly as they see a chat turn's. The credit figure on the job is that
 * cost at the plan's credit rate, rounded up like every other credit.
 *
 * A refused reservation is NOT a failure. The org is out of credits, over
 * its cap, or has switched overage off — all things a member can change —
 * so the job parks as `needs_input` with the refusal in customer-safe words
 * and the beat tries it again once it has rested. `failed` is reserved for
 * a step that cannot succeed by waiting.
 *
 * ── What a step may not do ───────────────────────────────────────────────
 *
 * A step runner writes drafts and returns. It does not touch the job
 * document, the meter or the lease: the machine owns those, so a runner
 * written next month cannot forget the reservation or record itself done
 * while the provider is still generating.
 */

export const AI_JOBS_COLLECTION = 'aiJobs'

/**
 * How long a claim holds the step. Longer than any single provider call the
 * text step makes and shorter than two beats, so a step abandoned by a
 * frozen process is recovered on the beat after next rather than never.
 */
export const AI_JOB_LEASE_MS = 90_000

/** A step handed back by a retryable provider failure this many times fails. */
export const AI_JOB_STEP_MAX_ATTEMPTS = 3

/**
 * The most passes one step may take by asking to continue (AGL-2910). A site
 * audit's passes are its units of generated work; this bounds a runner that
 * never finishes, not a real site.
 */
export const AI_JOB_STEP_MAX_PASSES = 40

/**
 * The nominal credit figure shown as held per outstanding step. Not a
 * bound — the reservation and the monthly ceiling are — but the console
 * must show a running job as costing something before its bill is known.
 */
export const AI_JOB_STEP_RESERVE_CREDITS = 50

/**
 * How long the console route waits for the first step before handing the
 * job to the beat. Inside the route's 60 s `maxDuration` with room for the
 * ladder and the writes on either side; a step still running at the bound
 * is aborted and re-queued, and the answer says `queued`.
 */
export const AI_JOB_INLINE_BUDGET_MS = 25_000

/** Wall clock one beat may spend running steps before it yields. */
export const AI_JOB_SWEEP_BUDGET_MS = 45_000

/** Jobs one beat reads as candidates; the budget usually stops it first. */
export const AI_JOB_SWEEP_MAX_JOBS = 25

/** Parked jobs one beat re-queues, on top of the active candidates. */
export const AI_JOB_SWEEP_MAX_PARKED = 5

/** How long a `needs_input` job rests before the beat tries its reservation again. */
export const AI_JOB_NEEDS_INPUT_RETRY_MS = 60 * 60_000

export const AI_JOB_NOT_AVAILABLE_COPY =
  'This kind of AI job is not available yet.'
export const AI_JOB_REFUSED_COPY =
  'The model declined this brief. Try rephrasing it.'

type Firestore = FirebaseFirestore.Firestore
type Transaction = FirebaseFirestore.Transaction

/** A stored instant as the SDK returns it, or as this module wrote it. */
type Instant = Date | { toMillis(): number } | number | string | null | undefined

function toMillis(value: Instant): number | null {
  if (value == null) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return typeof value.toMillis === 'function' ? value.toMillis() : null
}

function toIso(value: Instant): string | null {
  const millis = toMillis(value)
  return millis === null ? null : new Date(millis).toISOString()
}

export function isAiJobTerminal(status: AiJobStatus): boolean {
  return AI_JOB_TERMINAL_STATUSES.includes(status)
}

// ── The step runner registry ──────────────────────────────────────────────

/** The step a planned kind runs first (AGL-2935). */
export const AI_JOB_PLAN_STEP = 'plan'

/**
 * The kinds that build site structure, and so plan before they generate
 * (AGL-2935): the plan their first step proposes is what their generation
 * step executes, once a person has confirmed it.
 */
export const AI_PLANNED_JOB_KINDS: readonly AiJobKind[] = [
  'page',
  'site',
  'component',
  'layout',
  'template',
  'form',
  'email',
]

const stepRunners = new Map<AiJobKind, AiJobStepRunner>()
let planStepRunner: AiJobStepRunner | null = null

/** Idempotent per kind; last registration wins. */
export function registerAiJobStep(kind: AiJobKind, runner: AiJobStepRunner): void {
  stepRunners.set(kind, runner)
}

export function aiJobStepRunnerFor(kind: AiJobKind): AiJobStepRunner | null {
  return stepRunners.get(kind) ?? null
}

/**
 * The plan step every planned kind runs first. Registered by its own module
 * (`ai-job-plan-step.ts`), which the plugin's server surface loads, so this
 * machine — and every spec that drives it — never loads the inventory
 * reader and the Admin SDK behind it. `null` unregisters it.
 */
export function registerAiJobPlanStep(runner: AiJobStepRunner | null): void {
  planStepRunner = runner
}

/** The runner for one step of one job: the plan step by its name, else the kind's own. */
export function aiJobRunnerForStep(kind: AiJobKind, stepName: string): AiJobStepRunner | null {
  return stepName === AI_JOB_PLAN_STEP ? planStepRunner : aiJobStepRunnerFor(kind)
}

/**
 * The step names a job of this kind carries, in order. A planned kind plans
 * only once something can build the plan: until its generation runner is
 * registered, its job fails fast and free, rather than spending on a plan
 * nothing will execute.
 */
export function aiJobStepNames(kind: AiJobKind): string[] {
  if (kind === 'text') return ['draft']
  return AI_PLANNED_JOB_KINDS.includes(kind) && planStepRunner && stepRunners.has(kind)
    ? [AI_JOB_PLAN_STEP, 'generate']
    : ['generate']
}

/** The text step (AGL-2904). Every kind with no runner refuses until its issue lands. */
registerAiJobStep('text', runAiJobTextStep)

/**
 * The theme step (AGL-2938), loaded the first time a theme job runs rather
 * than when this module does: it builds the brand themes it measures
 * contrast against and may read a site's logo, and a process that never runs
 * a theme job should pay for neither.
 */
registerAiJobStep('theme', async (context) => {
  const { runAiJobThemeStep } = await import('./ai-job-theme-step')
  return runAiJobThemeStep(context)
})

/**
 * The SEO step (AGL-2910), loaded the first time an SEO job runs rather than
 * when this module does: it reads pages, versions and layouts, and a process
 * that never runs one should load none of that.
 */
registerAiJobStep('seo', async (context) => {
  const { runAiJobSeoStep } = await import('./ai-job-seo-step')
  return runAiJobSeoStep(context)
})

// ── Documents ─────────────────────────────────────────────────────────────

function jobsCollection(firestore: Firestore, orgId: string) {
  return firestore.collection('orgs').doc(orgId).collection(AI_JOBS_COLLECTION)
}

function jobFrom(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): AiJob | null {
  if (!snapshot.exists) return null
  const data = snapshot.data() as Omit<AiJob, '$id'>
  return { ...data, $id: snapshot.id }
}

export interface CreateAiJobInput {
  orgId: string
  hostId?: string | null
  kind: AiJobKind
  brief: string
  inputs?: Record<string, unknown>
  /** The model the creator picked (AGL-2942); absent or `null` for Auto. */
  model?: string | null
  createdBy: string
  /** The creator's address, for the activity row; the document stores the uid only. */
  createdByEmail?: string | null
}

/**
 * A new job, `queued`, with its step plan laid out and nothing run.
 *
 * The activity row is written once the document is, so the feed never names
 * a job that does not exist. The brief's length stands in for the brief,
 * which is the customer's own text and is not logged (AGL-2929).
 */
export async function createAiJob(
  firestore: Firestore,
  input: CreateAiJobInput,
  now = new Date(),
): Promise<AiJob> {
  const brief = input.brief.trim()
  if (!brief) throw new Error('an AI job needs a brief')
  const steps: AiJobStep[] = aiJobStepNames(input.kind).map((name) => ({
    name,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    creditsSpent: 0,
    error: null,
    attempts: 0,
  }))
  const ref = jobsCollection(firestore, input.orgId).doc()
  const data = {
    orgId: input.orgId,
    hostId: input.hostId ?? null,
    kind: input.kind,
    status: 'queued' as AiJobStatus,
    brief,
    inputs: input.inputs ?? {},
    model: input.model ?? null,
    steps,
    outputs: [] as AiJobOutput[],
    creditsReserved: steps.length * AI_JOB_STEP_RESERVE_CREDITS,
    creditsSpent: 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    // The brief is verbatim customer text, so it expires on the same clock
    // as an assist exchange; the TTL policy keys on this field.
    expiresAt: assistExchangeExpiry(now),
    error: null,
    lease: null,
  }
  await ref.set(data)
  await logAiJobCreated(
    input.orgId,
    { uid: input.createdBy, email: input.createdByEmail ?? null },
    {
      jobId: ref.id,
      kind: input.kind,
      briefLength: brief.length,
      hostId: input.hostId ?? null,
    },
  )
  return { ...(data as unknown as Omit<AiJob, '$id'>), $id: ref.id }
}

export async function getAiJob(
  firestore: Firestore,
  orgId: string,
  jobId: string,
): Promise<AiJob | null> {
  return jobFrom(await jobsCollection(firestore, orgId).doc(jobId).get())
}

export interface ListAiJobsOptions {
  status?: AiJobStatus
  limit?: number
}

/** Newest first. Needs the (status, createdAt) index when filtered. */
export async function listAiJobs(
  firestore: Firestore,
  orgId: string,
  options: ListAiJobsOptions = {},
): Promise<AiJob[]> {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 20)), 100)
  let query: FirebaseFirestore.Query = jobsCollection(firestore, orgId)
  if (options.status) query = query.where('status', '==', options.status)
  const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get()
  return snapshot.docs
    .map((doc) => jobFrom(doc))
    .filter((job): job is AiJob => job !== null)
}

/** The wire form. `running` is the lease, read against `now`. */
export function aiJobSummary(job: AiJob, now = new Date()): AiJobSummary {
  const leaseUntil = toMillis(job.lease?.until as Instant)
  return {
    id: job.$id,
    orgId: job.orgId,
    hostId: job.hostId ?? null,
    kind: job.kind,
    status: job.status,
    brief: job.brief,
    steps: (job.steps ?? []).map((step) => ({
      name: step.name,
      status: step.status,
      startedAt: toIso(step.startedAt as Instant),
      endedAt: toIso(step.endedAt as Instant),
      creditsSpent: step.creditsSpent ?? 0,
      error: step.error ?? null,
    })),
    outputs: job.outputs ?? [],
    creditsReserved: job.creditsReserved ?? 0,
    creditsSpent: job.creditsSpent ?? 0,
    createdBy: job.createdBy,
    createdAt: toIso(job.createdAt as Instant) ?? new Date(0).toISOString(),
    updatedAt: toIso(job.updatedAt as Instant) ?? new Date(0).toISOString(),
    error: job.error ?? null,
    running:
      job.status === 'running' &&
      leaseUntil !== null &&
      leaseUntil > now.getTime(),
    plan: job.plan
      ? {
          ...job.plan,
          labels: job.plan.labels ?? {},
          proposedAt: toIso(job.plan.proposedAt as Instant),
          confirmedAt: toIso(job.plan.confirmedAt as Instant),
          confirmedBy: job.plan.confirmedBy ?? null,
        }
      : null,
    review: job.review ?? null,
    applied: job.applied
      ? {
          at: toIso(job.applied.at as Instant),
          by: job.applied.by,
          versions: job.applied.versions ?? {},
          staged: job.applied.staged ?? [],
        }
      : null,
  }
}

// ── The lease ─────────────────────────────────────────────────────────────

export interface ClaimedAiJobStep {
  job: AiJob
  stepIndex: number
}

function leaseIsLive(job: AiJob, owner: string, nowMs: number): boolean {
  const lease = job.lease
  if (!lease) return false
  if (lease.owner === owner) return false
  const until = toMillis(lease.until as Instant)
  return until !== null && until > nowMs
}

function nextStepIndex(job: AiJob): number {
  return (job.steps ?? []).findIndex(
    (step) => step.status === 'pending' || step.status === 'running',
  )
}

/**
 * Take the lease on the job's next step, in one transaction.
 *
 * Refuses — `null` — when the job is terminal or parked, when it has no
 * step left, or when ANOTHER owner's lease has not yet expired. That last
 * clause is the whole point: the console route and two overlapping beats
 * can all look at one job inside the same minute, and only one of them may
 * spend the reservation for its step. An expired lease is claimable, which
 * is how a step abandoned mid-flight by a frozen process is recovered — the
 * stale lease is released by being taken, not by a sweep of its own.
 */
export async function claimNextStep(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  owner: string,
  now = new Date(),
): Promise<ClaimedAiJobStep | null> {
  const ref = jobsCollection(firestore, orgId).doc(jobId)
  return firestore.runTransaction(async (tx: Transaction) => {
    const job = jobFrom(await tx.get(ref))
    if (!job) return null
    if (job.status !== 'queued' && job.status !== 'running') return null
    if (leaseIsLive(job, owner, now.getTime())) return null
    const stepIndex = nextStepIndex(job)
    if (stepIndex === -1) return null
    const steps = job.steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            status: 'running' as const,
            startedAt: step.startedAt ?? now,
            attempts: (step.attempts ?? 0) + 1,
          }
        : step,
    )
    const lease = { owner, until: new Date(now.getTime() + AI_JOB_LEASE_MS) }
    tx.set(
      ref,
      { status: 'running', steps, lease, updatedAt: now },
      { merge: true },
    )
    return {
      job: {
        ...job,
        status: 'running',
        steps: steps as AiJob['steps'],
        lease: lease as unknown as AiJob['lease'],
        updatedAt: now as unknown as AiJob['updatedAt'],
      },
      stepIndex,
    }
  })
}

/**
 * Extend the lease while a long step is still running. `false` when the
 * caller no longer holds it — the step was recovered by someone else, and
 * the caller's result must not overwrite theirs.
 */
export async function heartbeatStep(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  owner: string,
  now = new Date(),
): Promise<boolean> {
  const ref = jobsCollection(firestore, orgId).doc(jobId)
  return firestore.runTransaction(async (tx: Transaction) => {
    const job = jobFrom(await tx.get(ref))
    if (!job || job.status !== 'running' || job.lease?.owner !== owner) {
      return false
    }
    tx.set(
      ref,
      {
        lease: { owner, until: new Date(now.getTime() + AI_JOB_LEASE_MS) },
        updatedAt: now,
      },
      { merge: true },
    )
    return true
  })
}

export interface RecordStepInput {
  /** `pending` hands the step back for another attempt. */
  status: 'done' | 'failed' | 'pending'
  creditsSpent: number
  error?: string | null
  outputs?: AiJobOutput[]
  /** The plan the step proposed, kept on the job (AGL-2935). */
  plan?: AiJobPlan
  /** The step stopped for a person: the job parks `needs_review` in this same write. */
  review?: AiJobReview
  /**
   * With `pending`: the step is handed back because it made progress and
   * asked to continue (AGL-2910), not because an attempt failed. Its
   * attempts count again from zero and its passes by one.
   */
  continued?: boolean
}

export interface RecordedStep {
  job: AiJob
  /** Steps still to run after this one. */
  remaining: number
}

/**
 * Record what a step cost and produced, and hand the lease back.
 *
 * Credits and outputs are recorded whatever the job's status is by now —
 * a job canceled while its provider call was in flight still spent the
 * tokens, and hiding that would make the bill disagree with the document.
 * The status transition is the caller's next call (`completeAiJob`,
 * `failAiJob`), except that a step handed back or a step with more steps
 * behind it re-queues here, so the beat sees it without another write —
 * and a step that stopped for a person parks the job `needs_review` here,
 * in the same transaction, so no beat can claim the next step in between.
 */
export async function recordStep(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  owner: string,
  stepIndex: number,
  input: RecordStepInput,
  now = new Date(),
): Promise<RecordedStep> {
  const ref = jobsCollection(firestore, orgId).doc(jobId)
  return firestore.runTransaction(async (tx: Transaction) => {
    const job = jobFrom(await tx.get(ref))
    if (!job) throw new Error(`ai job ${orgId}/${jobId} vanished`)
    const steps = job.steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            status: input.status,
            endedAt: input.status === 'pending' ? null : now,
            creditsSpent: (step.creditsSpent ?? 0) + input.creditsSpent,
            error: input.error ?? null,
            ...(input.continued && input.status === 'pending'
              ? { attempts: 0, passes: (step.passes ?? 0) + 1 }
              : {}),
          }
        : step,
    )
    const remaining = steps.filter(
      (step) => step.status === 'pending' || step.status === 'running',
    ).length
    const settled = input.status !== 'pending'
    const ownsLease = job.lease?.owner === owner
    const parksForReview = Boolean(input.review) && !isAiJobTerminal(job.status)
    const status: AiJobStatus = isAiJobTerminal(job.status)
      ? job.status
      : job.status === 'needs_input'
        ? job.status
        : parksForReview
          ? 'needs_review'
          : input.status === 'failed'
            ? 'running'
            : remaining > 0
              ? 'queued'
              : 'running'
    const patch = {
      status,
      steps,
      outputs: [...(job.outputs ?? []), ...(input.outputs ?? [])],
      creditsSpent: (job.creditsSpent ?? 0) + input.creditsSpent,
      creditsReserved: settled
        ? Math.max(0, (job.creditsReserved ?? 0) - AI_JOB_STEP_RESERVE_CREDITS)
        : (job.creditsReserved ?? 0),
      updatedAt: now,
      ...(ownsLease ? { lease: null } : {}),
      // A plan the step produced is kept whatever the job's status is by
      // now, for the reason its credits are.
      ...(input.plan ? { plan: input.plan } : {}),
      // A doctrine or limit review's sentence is the job's customer-safe
      // error, as a meter park's is; a plan waiting to be confirmed is not an
      // error.
      ...(parksForReview && input.review
        ? {
            review: input.review,
            error: input.review.reason === 'plan' ? null : input.review.message,
          }
        : {}),
    }
    tx.set(ref, patch, { merge: true })
    return {
      job: { ...job, ...(patch as unknown as Partial<AiJob>) } as AiJob,
      remaining,
    }
  })
}

async function transition(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  apply: (job: AiJob) => Record<string, unknown> | null,
): Promise<{ job: AiJob; changed: boolean }> {
  const ref = jobsCollection(firestore, orgId).doc(jobId)
  return firestore.runTransaction(async (tx: Transaction) => {
    const job = jobFrom(await tx.get(ref))
    if (!job) throw new Error(`ai job ${orgId}/${jobId} vanished`)
    const patch = apply(job)
    if (!patch) return { job, changed: false }
    tx.set(ref, patch, { merge: true })
    return {
      job: { ...job, ...(patch as unknown as Partial<AiJob>) } as AiJob,
      changed: true,
    }
  })
}

/** Every step done: the job is `done` and holds nothing. */
export async function completeAiJob(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  now = new Date(),
): Promise<AiJob> {
  const { job } = await transition(firestore, orgId, jobId, (current) =>
    isAiJobTerminal(current.status)
      ? null
      : {
          status: 'done',
          creditsReserved: 0,
          lease: null,
          error: null,
          updatedAt: now,
        },
  )
  return job
}

/**
 * Terminal failure. `message` is the only thing a customer reads, so it is
 * a fixed sentence; whatever the provider or the runner actually said goes
 * to the log beside the ids an operator would search for.
 */
export async function failAiJob(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  message: string,
  detail?: { stepIndex?: number; error?: unknown },
  now = new Date(),
): Promise<AiJob> {
  console.error('ai job failed', {
    orgId,
    jobId,
    stepIndex: detail?.stepIndex ?? null,
    error: detail?.error instanceof Error ? detail.error.message : detail?.error ?? null,
  })
  const { job } = await transition(firestore, orgId, jobId, (current) =>
    isAiJobTerminal(current.status)
      ? null
      : {
          status: 'failed',
          error: message,
          creditsReserved: 0,
          lease: null,
          steps: current.steps.map((step) =>
            step.status === 'running'
              ? { ...step, status: 'failed', endedAt: now, error: message }
              : step,
          ),
          updatedAt: now,
        },
  )
  return job
}

/**
 * Park the job for something only the workspace can change. The running
 * step goes back to `pending` so the same step is what runs when the beat
 * tries again; its attempt is not counted, because nothing was attempted.
 */
export async function markAiJobNeedsInput(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  reason: string,
  now = new Date(),
): Promise<AiJob> {
  const { job } = await transition(firestore, orgId, jobId, (current) =>
    isAiJobTerminal(current.status)
      ? null
      : {
          status: 'needs_input',
          error: reason,
          lease: null,
          steps: current.steps.map((step) =>
            step.status === 'running'
              ? {
                  ...step,
                  status: 'pending',
                  attempts: Math.max(0, (step.attempts ?? 0) - 1),
                }
              : step,
          ),
          updatedAt: now,
        },
  )
  return job
}

/**
 * Cancel. Idempotent — a terminal job is returned unchanged — and it does
 * not wait for a step in flight: the runner holding the lease finishes its
 * provider call, records what it cost, and finds the job canceled when it
 * goes to complete it.
 *
 * The activity row is written only when the cancel changed something: a
 * second cancel of the same job is not a second act. `actor` is the member
 * who canceled; a cancel with nobody named is recorded as nobody's rather
 * than as the creator's.
 */
export async function cancelAiJob(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  now = new Date(),
  actor: AiActivityActor | null = null,
): Promise<{ job: AiJob; changed: boolean }> {
  const result = await transition(firestore, orgId, jobId, (current) =>
    isAiJobTerminal(current.status)
      ? null
      : {
          status: 'canceled',
          creditsReserved: 0,
          lease: null,
          updatedAt: now,
        },
  )
  if (result.changed) {
    await logAiJobCanceled(orgId, actor ?? { uid: null }, {
      jobId,
      kind: result.job.kind,
    })
  }
  return result
}

/**
 * Resume a job that stopped for a person (AGL-2935): confirm its plan, or
 * try again the step whose answer broke a building rule. One transaction,
 * so two confirmations land once; anything but a `needs_review` job comes
 * back unchanged. The pending step's attempts start over — a person asking
 * again is not a provider failing again — and a confirmed plan with no step
 * left behind it completes the job rather than queueing nothing.
 */
export async function resumeAiJob(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  actor: { uid: string },
  now = new Date(),
): Promise<{ job: AiJob; changed: boolean }> {
  return transition(firestore, orgId, jobId, (current) => {
    if (current.status !== 'needs_review') return null
    const steps = current.steps.map((step) =>
      step.status === 'pending' ? { ...step, attempts: 0 } : step,
    )
    const pending = steps.some((step) => step.status === 'pending')
    const confirmed =
      current.review?.reason === 'plan' && current.plan
        ? {
            plan: {
              ...current.plan,
              status: 'confirmed',
              confirmedAt: now,
              confirmedBy: actor.uid,
            },
          }
        : {}
    return {
      status: pending ? 'queued' : 'done',
      steps,
      review: null,
      error: null,
      ...confirmed,
      ...(pending ? {} : { creditsReserved: 0 }),
      updatedAt: now,
    }
  })
}

/**
 * Record what a person applied from a finished job's outputs (AGL-2910): the
 * versions an apply opened and the listings it staged. The apply door calls
 * this after its own writes, so the record names only what exists. It never
 * changes the job's status, its steps or its spend.
 */
export async function recordAiJobApplied(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  applied: AiJobApplied,
  now = new Date(),
): Promise<AiJob> {
  const { job } = await transition(firestore, orgId, jobId, () => ({
    applied,
    updatedAt: now,
  }))
  return job
}

// ── Audit ─────────────────────────────────────────────────────────────────

export type AiJobAuditAction = 'ai.job.output' | 'ai.job.cancel' | 'ai.job.resume' | 'ai.job.apply'

export interface AiJobAuditEntry {
  action: AiJobAuditAction
  actorUid: string
  actorEmail?: string | null
  orgId: string
  jobId: string
  after: Record<string, unknown>
}

/**
 * One `adminAudit` row, the same writer shape the billing routes use. Never
 * throws: an audit row that fails to land is logged, not turned into a
 * failed job the customer paid for.
 */
export async function writeAiJobAudit(
  firestore: Firestore,
  entry: AiJobAuditEntry,
): Promise<void> {
  try {
    await firestore.collection('adminAudit').add({
      actorUid: entry.actorUid,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      target: `orgs/${entry.orgId}/${AI_JOBS_COLLECTION}/${entry.jobId}`,
      after: entry.after,
      at: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    console.error('ai job audit write failed', {
      orgId: entry.orgId,
      jobId: entry.jobId,
      action: entry.action,
      error,
    })
  }
}

// ── Running a step ────────────────────────────────────────────────────────

/**
 * The refusal in customer-safe words. The org's own wall names the switch
 * (AGL-2653); a cap, a band and a budget are told apart because one is a
 * figure the org set, one is what its plan sold, and one is the operator's
 * backstop; the message cap resets on a clock the others do not.
 */
export function aiJobRefusalText(
  org: Partial<AglynOrgBilling> | null,
  reservation: Pick<AssistReservation, 'refusedBy' | 'budgetUsd' | 'allotment'>,
): string {
  const refusedBy = reservation.refusedBy
  // A hard allotment (AGL-2942) — the creator's, theirs on the job's site,
  // or the site's — in the sentence every door gives, naming who can raise
  // it. A member can change that, so the job parks rather than fails.
  if (refusedBy === 'allotment') {
    return aiAllotmentRefusalText(reservation.allotment?.refusal?.scope)
  }
  if (assistRefusedByHardCap(org, refusedBy)) {
    return assistHardCapRefusalText(org)
  }
  // The Free taste's own precautions (AGL-2925), in the sentences every
  // other door uses — each names a clock or an upgrade.
  const taste = assistFreeTasteRefusalText(refusedBy)
  if (taste) return taste
  switch (refusedBy) {
    case 'cap':
      return 'This workspace reached the AI spending cap it set for the month'
    case 'band':
      return 'This workspace used its AI credits for the month'
    case 'budget':
      return reservation.budgetUsd === null
        ? 'This workspace reached its AI spending limit for the month'
        : 'This workspace used its AI credits for the month'
    default:
      return 'This workspace reached its AI limit for the month'
  }
}

export interface RunAiJobStepOptions {
  /** Who is claiming: a request id or a beat id. */
  owner: string
  now?: Date
  /**
   * A reservation the caller already holds for THIS step — the console
   * route's gate ladder takes one before the job exists. Every later step
   * reserves for itself.
   */
  reservation?: AssistReservation
  /** The org billing document when the caller has it; read otherwise. */
  org?: Partial<AglynOrgBilling> | null
  /** Ends the provider call when the caller's budget does. */
  signal?: AbortSignal
  /**
   * The person on the request when a route runs the step inline. The beat
   * has none: what a step produces is then credited to the job's creator,
   * whose brief it is, never to nobody (AGL-2929).
   */
  actor?: AiActivityActor
}

export type AiJobStepRun =
  /** Nothing to do: terminal, parked, no step left, or another owner's lease. */
  | { outcome: 'not-claimable' }
  /** The reservation was refused; the job is parked with the reason. */
  | { outcome: 'needs_input'; job: AiJob }
  /** The step stopped for a person (AGL-2935): its plan waits, or its answer broke a rule twice. */
  | { outcome: 'needs_review'; job: AiJob }
  /** The step ran and was recorded; `job.status` says whether more remain. */
  | { outcome: 'done'; job: AiJob }
  | { outcome: 'failed'; job: AiJob }
  /** A retryable provider failure; the step is pending again. */
  | { outcome: 'requeued'; job: AiJob }

/**
 * A budget that ended before the provider answered. `fetch` rejects with
 * the signal's reason, which is an `AbortError` for a manual abort and a
 * `TimeoutError` for `AbortSignal.timeout` — the one the route and the
 * sweep actually hand in.
 */
function isAbort(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

/** A step outcome that carries no tokens and no cost: the provider was never reached. */
export function aiJobStepSpentNothing(
  outcome: Pick<AiJobStepOutcome, 'usage' | 'estCostUsd'>,
): boolean {
  const { usage } = outcome
  return (
    outcome.estCostUsd === 0 &&
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.cacheReadTokens === 0 &&
    usage.cacheWriteTokens === 0
  )
}

/**
 * Claim, reserve, run, meter, record — one step of one job.
 *
 * The order is the invariant. The reservation is taken AFTER the claim so
 * a refused claim costs nothing, and BEFORE the runner so the org's ceiling
 * binds before a token is spent. The cost is recorded before the step is,
 * so a process cut off between the two leaves the bill right and the step
 * recoverable, never the other way round.
 */
export async function runAiJobStep(
  firestore: Firestore,
  orgId: string,
  jobId: string,
  options: RunAiJobStepOptions,
): Promise<AiJobStepRun> {
  const now = options.now ?? new Date()
  const claimed = await claimNextStep(firestore, orgId, jobId, options.owner, now)
  if (!claimed) return { outcome: 'not-claimable' }
  const { job, stepIndex } = claimed
  const step = job.steps[stepIndex]

  // A reservation the caller took before the job existed is a message
  // counted against the org; a step that fails before the provider is
  // reached spends nothing, so the message goes back rather than standing
  // as capacity the org paid for and never used.
  const releaseHeld = async () => {
    if (!options.reservation) return
    await releaseAssistMessage(firestore, orgId, options.reservation).catch(
      (releaseError) =>
        console.error('ai job release failed', { orgId, jobId, releaseError }),
    )
  }

  const runner = aiJobRunnerForStep(job.kind, step.name)
  if (!runner) {
    await releaseHeld()
    return {
      outcome: 'failed',
      job: await failAiJob(firestore, orgId, jobId, AI_JOB_NOT_AVAILABLE_COPY, {
        stepIndex,
        error: `no runner registered for kind ${job.kind}`,
      }, now),
    }
  }
  if ((step.attempts ?? 0) > AI_JOB_STEP_MAX_ATTEMPTS) {
    await releaseHeld()
    return {
      outcome: 'failed',
      job: await failAiJob(firestore, orgId, jobId, AI_UPSTREAM_FAILURE_COPY, {
        stepIndex,
        error: `step ${step.name} exhausted ${AI_JOB_STEP_MAX_ATTEMPTS} attempts`,
      }, now),
    }
  }

  const org =
    options.org ??
    (((await firestore.collection('orgs').doc(orgId).get()).data() ??
      {}) as Partial<AglynOrgBilling>)
  const entitled =
    checkEntitlement(org, 'aiAssist') || checkEntitlement(org, 'aiGenerative')

  let reservation: AssistReservation
  if (options.reservation) {
    reservation = options.reservation
  } else {
    try {
      // The creator's allotments on the job's site (AGL-2942): the step is
      // their spend, as the meter below attributes it.
      reservation = await reserveAssistMessage(firestore, orgId, entitled, now, org, {
        uid: job.createdBy,
        hostId: job.hostId ?? null,
      })
    } catch (error) {
      // The meter is unreachable, not refusing. Hand the step back; the
      // next beat asks again.
      console.error('ai job reservation failed', { orgId, jobId, error })
      const { job: requeued } = await recordStep(
        firestore, orgId, jobId, options.owner, stepIndex,
        { status: 'pending', creditsSpent: 0 },
        now,
      )
      return { outcome: 'requeued', job: requeued }
    }
  }
  // A refused step is the creator's refusal (AGL-2928), on their month,
  // beside the org counter the reservation moved; an admitted one records
  // nothing.
  recordUserAiRefusal(firestore, orgId, job.createdBy, reservation)
  if (!reservation.allowed) {
    const refusal = aiJobRefusalText(org, reservation)
    const parked = await markAiJobNeedsInput(firestore, orgId, jobId, refusal, now)
    // Nobody parked the job — the meter did — so the row carries no actor
    // rather than the creator's name on an act they did not perform. Only
    // when the job was not already parked for this: the reason the last
    // park stored survives the beat's re-queue, so a job the meter refuses
    // again on its hourly retry is one row, not one an hour; a different
    // ceiling is a new row. The meter names a ceiling on every refusal; the
    // guard narrows the type.
    if (reservation.refusedBy && job.error !== refusal) {
      await logAiJobNeedsInput(orgId, { uid: null }, {
        jobId,
        kind: job.kind,
        reason: reservation.refusedBy,
      })
    }
    return { outcome: 'needs_input', job: parked }
  }

  // The model each step runs on (AGL-2942): the creator's pick where the
  // plan and the allotment allowlists the reservation read allow it, the
  // routing table otherwise. Handed to the runner as a function of the step
  // kind, because the runner — not the machine — knows what kind it runs.
  const bounds = {
    plan: resolveEffectivePlan(org),
    allotmentModels: reservation.allotment?.models ?? null,
    orgModels: reservation.allotment?.orgModels ?? null,
  }
  const modelFor = (kind: Parameters<typeof resolveAiModelChoice>[0]) =>
    resolveAiModelChoice(kind, job.model ?? null, bounds)?.model

  let outcome: AiJobStepOutcome
  try {
    outcome = await runner({
      job, stepIndex, now, signal: options.signal, firestore, org, modelFor,
    })
  } catch (error) {
    // The provider refused the request or the budget ended before it
    // answered: no usage came back, so nothing is metered and the message
    // goes back to the org. The provider's own words are already in the
    // log under the request id (AGL-2815).
    await releaseAssistMessage(firestore, orgId, reservation).catch((releaseError) =>
      console.error('ai job release failed', { orgId, jobId, releaseError }),
    )
    const retryable =
      (error instanceof AiUpstreamError && error.retryable) || isAbort(error)
    if (retryable) {
      const { job: requeued } = await recordStep(
        firestore, orgId, jobId, options.owner, stepIndex,
        { status: 'pending', creditsSpent: 0 },
        now,
      )
      return { outcome: 'requeued', job: requeued }
    }
    return {
      outcome: 'failed',
      job: await failAiJob(firestore, orgId, jobId, AI_UPSTREAM_FAILURE_COPY, {
        stepIndex,
        error,
      }, now),
    }
  }

  // A step that failed before it reached the provider — the site it builds
  // from could not be read, say (AGL-2938) — spent nothing: its message goes
  // back and nothing is metered, exactly as for a request the provider
  // refused.
  if (outcome.failure && aiJobStepSpentNothing(outcome)) {
    await releaseAssistMessage(firestore, orgId, reservation).catch((releaseError) =>
      console.error('ai job release failed', { orgId, jobId, releaseError }),
    )
    await recordStep(
      firestore, orgId, jobId, options.owner, stepIndex,
      { status: 'failed', creditsSpent: 0, error: outcome.failure },
      now,
    )
    return {
      outcome: 'failed',
      job: await failAiJob(firestore, orgId, jobId, outcome.failure, {
        stepIndex,
        error: `step failure before the provider: ${outcome.failure}`,
      }, now),
    }
  }

  // A step that stopped before the provider without failing — a site with no
  // room for the draft (AGL-2909), say — spent nothing too: its message goes
  // back and there is nothing to meter. What it returns is still recorded
  // below, as any step's is.
  const spentNothing = aiJobStepSpentNothing(outcome)
  if (spentNothing) {
    await releaseAssistMessage(firestore, orgId, reservation).catch((releaseError) =>
      console.error('ai job release failed', { orgId, jobId, releaseError }),
    )
  } else {
    // Tokens were spent, so the bill is written first and its failure is a
    // log line, never a failed job — the same rule the chat route keeps.
    try {
      await recordAssistCost(
        firestore,
        orgId,
        {
          route: 'ai/jobs',
          hostId: job.hostId ?? null,
          model: outcome.model,
          tier: entitled ? 'entitled' : 'free',
          usage: outcome.usage,
          docsPaths: [],
          stopReason: outcome.stopReason,
          deflected: false,
          // The account this job drew on, as the reservation decided it
          // (AGL-2925): a Free job lands on the owner's allowance and the
          // platform's day; a paid one on neither.
          free: reservation.free ?? null,
          // The step is the creator's spend, under the job's kind (AGL-2928).
          uid: job.createdBy,
          kind: job.kind,
        },
        now,
      )
    } catch (error) {
      console.error('ai job cost record failed', { orgId, jobId, error })
    }
  }
  const credits = assistCreditsFromUsd(outcome.estCostUsd)

  // A model that declined, or a step that got nothing usable out of the
  // model's answer (AGL-2938), fails the job with its own sentence. The
  // tokens are already on the bill above.
  if (outcome.refused || outcome.failure) {
    const message = outcome.refused ? AI_JOB_REFUSED_COPY : (outcome.failure as string)
    await recordStep(
      firestore, orgId, jobId, options.owner, stepIndex,
      { status: 'failed', creditsSpent: credits, error: message },
      now,
    )
    return {
      outcome: 'failed',
      job: await failAiJob(firestore, orgId, jobId, message, {
        stepIndex,
        error: outcome.refused ? 'stop_reason refusal' : `step failure: ${message}`,
      }, now),
    }
  }

  // A step that stopped for a person parks the job in the same write that
  // records it (AGL-2935): a plan review completes the step, so confirming
  // runs the next one; a doctrine or limit review hands it back, so trying
  // again runs the same one.
  //
  // A step that asks to continue (AGL-2910) is recorded as this pass — its
  // cost, its credits, its outputs, its audit rows — and handed back as
  // `pending`, so the next claim runs the same step again. A step that stopped
  // for a person never continues: the review is what it waits on. The pass
  // cap is what stops a runner that never finishes: past it the pass is
  // recorded as the step's last, and what it produced stands.
  const review = outcome.review
  const continuing =
    !review && Boolean(outcome.continue) && (step.passes ?? 0) + 1 < AI_JOB_STEP_MAX_PASSES
  if (!review && outcome.continue && !continuing) {
    console.warn('ai job step reached its pass cap', { orgId, jobId, stepIndex })
  }
  const recorded = await recordStep(
    firestore, orgId, jobId, options.owner, stepIndex,
    {
      status: continuing || (review && review.reason !== 'plan') ? 'pending' : 'done',
      ...(continuing ? { continued: true } : {}),
      creditsSpent: credits,
      outputs: outcome.outputs,
      ...(outcome.plan ? { plan: outcome.plan } : {}),
      ...(review ? { review } : {}),
    },
    now,
  )
  const actor: AiActivityActor = options.actor ?? { uid: job.createdBy }
  for (const output of outcome.outputs) {
    await writeAiJobAudit(firestore, {
      action: 'ai.job.output',
      actorUid: job.createdBy,
      orgId,
      jobId,
      after: {
        resource: output.resource,
        id: output.id,
        versionId: output.versionId ?? null,
        hostId: output.hostId,
        label: output.label,
        credits,
      },
    })
    // The customer-visible row, one per output: the label names the thing,
    // never its text, which is the site's content.
    await logAiJobOutput(orgId, actor, {
      jobId,
      hostId: output.hostId,
      resource: {
        type: aiOutputTargetType(output.resource),
        id: output.id,
        name: output.label,
        versionId: output.versionId ?? null,
      },
    })
  }
  if (review && recorded.job.status === 'needs_review') {
    // Nobody parked the job but its own step, so the row names no actor, as
    // the meter's park does.
    await logAiJobNeedsInput(orgId, { uid: null }, {
      jobId,
      kind: job.kind,
      reason: review.reason,
    })
    return { outcome: 'needs_review', job: recorded.job }
  }
  if (recorded.remaining > 0 || isAiJobTerminal(recorded.job.status)) {
    return { outcome: 'done', job: recorded.job }
  }
  return {
    outcome: 'done',
    job: await completeAiJob(firestore, orgId, jobId, now),
  }
}

// ── The beat's sweep ──────────────────────────────────────────────────────

export interface DueAiJob {
  orgId: string
  jobId: string
}

export interface SweepAiJobsOptions {
  firestore: Firestore
  /** The beat's identity for its leases. */
  owner: string
  now?: () => number
  budgetMs?: number
  maxJobs?: number
  /** Test seams; the defaults query Firestore and run the real step. */
  listDue?: () => Promise<DueAiJob[]>
  runStep?: (
    orgId: string,
    jobId: string,
    options: RunAiJobStepOptions,
  ) => Promise<AiJobStepRun>
}

export interface SweepAiJobsResult {
  /** Candidates the queries returned. */
  due: number
  /** Steps this sweep actually ran to a recorded result. */
  ran: number
  /** Claims another owner held, or jobs with nothing left. */
  skipped: number
  /** Candidates left untouched because the wall clock ran out. */
  remaining: number
  budgetExhausted: boolean
}

/**
 * Every job the beat should look at, oldest first: queued and running
 * across every org, then `needs_input` jobs that have rested long enough
 * for the org's standing to have changed. Two queries rather than one, so
 * a workspace with many parked jobs cannot fill the candidate list and
 * starve the queue behind it. Both use the collection-group index on
 * (status, updatedAt).
 *
 * The ordering is the cursor. A job this sweep touches has its `updatedAt`
 * moved and goes to the back of the next query; one it did not reach keeps
 * its place at the front. So there is no stored position to fall behind
 * or skip past — the same shape `media-move.ts` gives its budgeted loop,
 * where what was not done is simply what is asked for next.
 */
export async function listDueAiJobs(
  firestore: Firestore,
  nowMs: number,
  maxJobs = AI_JOB_SWEEP_MAX_JOBS,
  maxParked = AI_JOB_SWEEP_MAX_PARKED,
): Promise<DueAiJob[]> {
  const group = firestore.collectionGroup(AI_JOBS_COLLECTION)
  const [active, parked] = await Promise.all([
    group
      .where('status', 'in', ['queued', 'running'])
      .orderBy('updatedAt', 'asc')
      .limit(maxJobs)
      .get(),
    group
      .where('status', '==', 'needs_input')
      .where('updatedAt', '<=', new Date(nowMs - AI_JOB_NEEDS_INPUT_RETRY_MS))
      .orderBy('updatedAt', 'asc')
      .limit(maxParked)
      .get(),
  ])
  return [...active.docs, ...parked.docs]
    .map((doc) => ({ orgId: String(doc.get('orgId') ?? ''), jobId: doc.id }))
    .filter((due) => due.orgId !== '')
}

/**
 * Run due steps until the budget is spent, and account for every candidate.
 *
 * The bound is wall clock, not a count, for the reason `media-move.ts`
 * gives: one step is one provider round trip of unknown length, so any
 * fixed number would be wrong for some brief. The budget is checked BETWEEN
 * jobs, and the step in flight gets the time that is left as its abort
 * signal, so the sweep still finishes whichever step it has started. At
 * least one candidate is always attempted, so a beat that yields having
 * done nothing cannot starve a queue behind a slow clock.
 *
 * A `needs_input` job is re-queued before its step is claimed, because the
 * claim admits only queued and running jobs; the reservation inside the
 * step is what decides whether the org's standing has changed.
 */
export async function sweepAiJobs(
  options: SweepAiJobsOptions,
): Promise<SweepAiJobsResult> {
  const now = options.now ?? Date.now
  const budgetMs = options.budgetMs ?? AI_JOB_SWEEP_BUDGET_MS
  const startedAt = now()
  const listDue =
    options.listDue ??
    (() => listDueAiJobs(options.firestore, now(), options.maxJobs))
  const runStep =
    options.runStep ??
    ((orgId: string, jobId: string, stepOptions: RunAiJobStepOptions) =>
      runAiJobStep(options.firestore, orgId, jobId, stepOptions))

  const due = await listDue()
  const result: SweepAiJobsResult = {
    due: due.length,
    ran: 0,
    skipped: 0,
    remaining: 0,
    budgetExhausted: false,
  }
  for (let index = 0; index < due.length; index += 1) {
    const elapsed = now() - startedAt
    if (index > 0 && elapsed >= budgetMs) {
      result.budgetExhausted = true
      result.remaining = due.length - index
      break
    }
    const { orgId, jobId } = due[index]
    const left = Math.max(1_000, budgetMs - elapsed)
    try {
      const parked = await getAiJob(options.firestore, orgId, jobId)
      if (parked?.status === 'needs_input') {
        await transition(options.firestore, orgId, jobId, (current) =>
          current.status === 'needs_input'
            ? { status: 'queued', updatedAt: new Date(now()) }
            : null,
        )
      }
      const run = await runStep(orgId, jobId, {
        owner: options.owner,
        now: new Date(now()),
        signal: AbortSignal.timeout(left),
      })
      if (run.outcome === 'not-claimable') result.skipped += 1
      else result.ran += 1
    } catch (error) {
      // One job's fault is isolated, as the runner isolates one job's.
      console.error('ai job sweep step failed', { orgId, jobId, error })
      result.skipped += 1
    }
  }
  return result
}
