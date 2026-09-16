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

import { createHash } from 'node:crypto'
import {
  AI_BUILD_PLAN_TOOL,
  isAiPlanNewRef,
  type AiBuildPlan,
} from '../model/ai-build-plan'
import type { AiJob, AiJobPlan, AiJobStatus } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { aiDoctrineSystemBlocks, runValidatedGeneration } from '../runtime/ai-doctrine'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import { AI_JOB_BRIEF_MAX_CHARS, type AiJobStepRunner } from './ai-job-text-step'
import { aiGenerationMaxTokensWithin, aiGenerationWorstCaseOnTierMs } from './ai-job-budget'
import { aiUnspentOutcome } from './ai-job-generation'
import { AI_JOBS_COLLECTION, registerAiJobPlanStep } from './ai-jobs'

/**
 * The plan step (AGL-2935): the first step of every job that builds site
 * structure. Before a node is generated, the model answers with a typed plan
 * — what the site already has that the job reuses, what it creates and why,
 * and the screens it builds from them — held to the doctrine's plan rules
 * against the site's inventory and re-asked once when it breaks one.
 *
 * A plan that passes is kept on the job, and the job stops for review: the
 * member reads what it will build before a credit is spent building it, and
 * confirms through the resume door. A plan that still breaks a rule on its
 * re-ask stops the job the same way, with the rules named. Either way the
 * step writes nothing itself; the machine records the plan, the spend and
 * the stop, as it records every step.
 */

/** The plan step's own instructions, cached after the doctrine. */
export const AI_JOB_PLAN_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text:
      'You plan what a website builder job will build, before anything is built. You are given the kind of job and the brief from the person who owns the site. ' +
      'Answer with submit_build_plan: what the site inventory already has that the job reuses, what it must create and why nothing listed will do, and each screen it builds with its layout, template, slug, search title, search description and sections from top to bottom. ' +
      'Refer to inventory records by id and to what the plan creates as new:<name>. Plan only what the brief asks for: a component, layout, template, form or email job plans no screens unless the brief asks for pages.',
  },
]

/**
 * The least time a plan needs before it starts (AGL-3026): its answer and its
 * re-ask at the routing table's ceiling for `job.plan`, on the tier that step
 * kind is served from, with the step's reads and writes, at the rates
 * `ai-job-budget.ts` assumes.
 *
 * Registered with the step, so an inline door never starts a plan. A plan
 * thinks before it answers and routinely runs past an inline door's budget,
 * and a provider call that budget cuts off is still generated and billed
 * upstream while the meter records nothing. The beat starts a plan only with
 * this much of its own budget left, and a spec holds it inside that budget.
 */
export const AI_JOB_PLAN_STEP_MINIMUM_MS = aiGenerationWorstCaseOnTierMs({
  tier: AI_STEP_TIERS['job.plan'],
  maxTokens: AI_ROUTING_TABLE['job.plan'].maxTokens,
})

/**
 * The plan's answer ceiling on the model a job runs: the routing table's, or
 * less on a slower tier, so that its worst case fits the least time the step
 * registered. A model the catalog does not know is planned at the slowest.
 */
export function aiJobPlanMaxTokens(model: string): number {
  return aiGenerationMaxTokensWithin({
    budgetMs: AI_JOB_PLAN_STEP_MINIMUM_MS,
    model,
    cap: AI_ROUTING_TABLE['job.plan'].maxTokens,
  })
}

/** What the member reads while a plan waits for them. */
export const AI_JOB_PLAN_REVIEW_COPY =
  'The plan is ready. Review what the job will reuse and create, then confirm it to build.'

/** The job as the plan step's user turn: its kind, its brief and its scalar inputs. */
export function aiJobPlanPrompt(job: Pick<AiJob, 'kind' | 'brief' | 'inputs'>): string {
  const lines = [`Job kind: ${job.kind}`, `Brief: ${job.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`]
  for (const [key, value] of Object.entries(job.inputs ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`)
    }
  }
  return lines.join('\n')
}

/**
 * The inventory names of every id the plan references, so the proposal reads
 * "the Services layout" rather than an id — kept on the plan because the
 * inventory is not read again when the member opens it.
 */
export function aiPlanLabels(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): Record<string, string> {
  const names = new Map<string, string>()
  for (const rows of [
    inventory?.components,
    inventory?.layouts,
    inventory?.templates,
    inventory?.forms,
    inventory?.datasets,
    inventory?.collections,
    inventory?.screens,
  ]) {
    for (const row of rows ?? []) names.set(row.id, row.name)
  }
  const refs = [
    ...plan.reuse.map((entry) => entry.id),
    ...plan.create.map((entry) => entry.duplicateOf),
    ...plan.screens.flatMap((screen) => [
      screen.layout,
      screen.template,
      screen.duplicateOf,
      ...screen.sections.flatMap((section) => section.uses),
    ]),
  ]
  const labels: Record<string, string> = {}
  for (const ref of refs) {
    if (!ref || isAiPlanNewRef(ref)) continue
    const name = names.get(ref)
    if (name) labels[ref] = name
  }
  return labels
}

/* ------------------------------------------------------------------------ *
 * Reusing an identical brief's plan
 * ------------------------------------------------------------------------ */

/**
 * How long a plan may be reused for (AGL-2937).
 *
 * The window is what makes reuse safe rather than merely cheap. The key
 * already covers everything the request said — the brief, the inputs, the
 * model and the prompt as rendered, site inventory included — so a plan is
 * reused only when nothing the model was shown has changed. What the key
 * cannot see is the world outside the request: a page published, a component
 * renamed after the inventory was read, a member who meant something
 * different the second time. Fifteen minutes is short enough that the answer
 * is still the one the site would give, and long enough to cover what reuse
 * is actually for — the same brief run twice in a sitting, a job resubmitted
 * after a refused reservation, two members starting the same work.
 */
export const AI_PLAN_REUSE_WINDOW_MS = 15 * 60 * 1_000

/** Jobs one lookup reads. More than one can share a key; the newest plan wins. */
export const AI_PLAN_REUSE_CANDIDATES = 5

/** A job whose plan might be reused, as the finder reports it. */
export interface AiJobPlanCandidate {
  jobId: string
  status: AiJobStatus
  plan: AiJobPlan
}

/**
 * The digest a plan is reused by: the whole request, never the answer.
 *
 * It hashes what the model was asked and what it was shown — the job's kind
 * and site, the user turn (which carries the trimmed brief and every scalar
 * input), the model that would answer, every rendered system block including
 * the site inventory, and the tool's schema. Two requests that hash the same
 * would have been sent the same bytes to the same model, so the second can
 * keep the first's answer.
 *
 * The version tag is the escape hatch: anything that changes what a key
 * MEANS, rather than what it covers, bumps it and strands every old key
 * harmlessly, since a key nothing matches simply asks the model.
 */
export function aiJobPlanKey(input: {
  job: Pick<AiJob, 'kind' | 'hostId'>
  prompt: string
  model: string
  system: readonly AiSystemBlock[]
}): string {
  const digest = createHash('sha256')
  for (const part of [
    'plan.v1',
    input.job.kind,
    input.job.hostId ?? '',
    input.model,
    input.prompt,
    ...input.system.map((block) => block.text),
    JSON.stringify(AI_BUILD_PLAN_TOOL),
  ]) {
    // Length-prefixed, so two different splits of the same characters cannot
    // collide by running into one another.
    digest.update(`${part.length}:${part}\u0000`)
  }
  return digest.digest('hex')
}

/** A job that could not have produced a reusable plan, whatever its key says. */
const UNREUSABLE: readonly AiJobStatus[] = ['canceled', 'failed']

function planMillis(plan: AiJobPlan): number | null {
  const at = plan.proposedAt as unknown
  if (at instanceof Date) return at.getTime()
  if (at && typeof (at as { toMillis?: unknown }).toMillis === 'function') {
    return (at as { toMillis(): number }).toMillis()
  }
  return null
}

/**
 * The newest plan worth reusing out of what the finder returned: another
 * job's, still proposed or already confirmed, on a job that was neither
 * canceled nor failed, proposed inside the window.
 *
 * A canceled or failed job is excluded even though its plan may be perfectly
 * good: those are the jobs a member walked away from, and handing their plan
 * to the next one would make a rejected answer look like a fresh one.
 */
export function aiReusablePlan(
  candidates: readonly AiJobPlanCandidate[],
  context: { jobId: string; now: Date },
): AiJobPlanCandidate | null {
  const floor = context.now.getTime() - AI_PLAN_REUSE_WINDOW_MS
  let best: AiJobPlanCandidate | null = null
  let bestAt = -1
  for (const candidate of candidates) {
    if (candidate.jobId === context.jobId) continue
    if (UNREUSABLE.includes(candidate.status)) continue
    if (candidate.plan.status !== 'proposed' && candidate.plan.status !== 'confirmed') continue
    const at = planMillis(candidate.plan)
    if (at === null || at < floor || at > context.now.getTime()) continue
    if (at > bestAt) {
      best = candidate
      bestAt = at
    }
  }
  return best
}

export type AiJobPlanFinder = (
  orgId: string,
  key: string,
  firestore?: FirebaseFirestore.Firestore,
) => Promise<AiJobPlanCandidate[]>

/**
 * The finder the step uses in production: an equality on `plan.key` inside
 * the org's own jobs.
 *
 * One equality on one field, with no ordering beside it, so Firestore's
 * automatic single-field index answers it and no composite index is deployed.
 * The window and the statuses are applied in memory instead, which is what
 * keeps it that way.
 */
export const findAiJobsByPlanKey: AiJobPlanFinder = async (orgId, key, firestore) => {
  if (!firestore) return []
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(AI_JOBS_COLLECTION)
    .where('plan.key', '==', key)
    .limit(AI_PLAN_REUSE_CANDIDATES)
    .get()
  return snapshot.docs.flatMap((doc) => {
    const data = doc.data() as { status?: AiJobStatus; plan?: AiJobPlan | null }
    return data.plan
      ? [{ jobId: doc.id, status: data.status ?? 'queued', plan: data.plan }]
      : []
  })
}

export interface AiJobPlanStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The reuse lookup; specs hand in a fake, and `null` turns reuse off. */
  findPlansByKey?: AiJobPlanFinder | null
}

export function createAiJobPlanStep(deps: AiJobPlanStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const findPlansByKey =
    deps.findPlansByKey === undefined ? findAiJobsByPlanKey : deps.findPlansByKey
  return async ({ job, now, signal, firestore, modelFor }) => {
    const inventory = job.hostId
      ? await readInventory(job.orgId, job.hostId, { firestore })
      : null
    // The model switch's answer for this job (AGL-2942): the creator's pick
    // where the plan, the org restriction and the allotment allowlists allow
    // it, and Auto held to those same lists otherwise. Without a resolver the
    // doctrine asks the routing table itself.
    const model = modelFor?.('job.plan')
    const route = AI_ROUTING_TABLE['job.plan']
    const prompt = aiJobPlanPrompt(job)

    // Reuse before asking (AGL-2937). The key covers the whole request, so a
    // hit is a request that would have been sent the same bytes to the same
    // model; the window covers what the key cannot see. A reused plan spends
    // nothing, so the machine's spent-nothing branch releases the reservation
    // and meters no credit, and the job still stops for the member to confirm
    // — this job's plan is proposed to this member, whatever the last one did
    // with theirs.
    const resolved = model ?? aiModelForStep('job.plan')
    const key = aiJobPlanKey({
      job,
      prompt,
      model: resolved,
      system: aiDoctrineSystemBlocks(inventory, { instructions: AI_JOB_PLAN_INSTRUCTIONS }),
    })
    const reused = findPlansByKey
      ? aiReusablePlan(await findPlansByKey(job.orgId, key, firestore), {
          jobId: job.$id,
          now,
        })
      : null
    if (reused) {
      const plan: AiJobPlan = {
        ...reused.plan,
        status: 'proposed',
        labels: aiPlanLabels(reused.plan, inventory),
        proposedAt: now as unknown as AiJobPlan['proposedAt'],
        confirmedAt: null,
        confirmedBy: null,
        key,
        reusedFrom: reused.jobId,
      }
      return {
        ...aiUnspentOutcome(resolved),
        plan,
        review: { reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] },
      }
    }

    const result = await runValidatedGeneration('plan', {
      step: 'job.plan',
      ...(model ? { model } : {}),
      instructions: AI_JOB_PLAN_INSTRUCTIONS,
      inventory,
      messages: [{ role: 'user', content: prompt }],
      tool: AI_BUILD_PLAN_TOOL,
      // The routing ceiling, lowered on a tier too slow to answer it and ask
      // again inside the least time the step registered.
      maxTokens: aiJobPlanMaxTokens(resolved),
      ...(route.thinking ? { thinking: route.thinking } : {}),
      ...(route.effort ? { effort: route.effort } : {}),
      ...(signal ? { signal } : {}),
    })
    const spent = {
      outputs: [],
      usage: result.usage,
      estCostUsd: result.estCostUsd,
      model: result.model,
      stopReason: result.stopReason,
      ...(result.effort ? { effort: result.effort } : {}),
    }
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') {
      return {
        ...spent,
        review: {
          reason: 'doctrine',
          message: result.message,
          findings: result.violations.map(({ rule, code, message }) => ({ rule, code, message })),
        },
      }
    }
    const plan: AiJobPlan = {
      ...result.value,
      status: 'proposed',
      labels: aiPlanLabels(result.value, inventory),
      // A Date the Admin SDK stores as a timestamp, like every instant the machine writes.
      proposedAt: now as unknown as AiJobPlan['proposedAt'],
      confirmedAt: null,
      confirmedBy: null,
      key,
    }
    return {
      ...spent,
      plan,
      review: { reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] },
    }
  }
}

export const runAiJobPlanStep = createAiJobPlanStep()

/**
 * Registers the plan step every planned kind runs first, with the least time
 * a plan needs; the plugin's console surface calls it.
 */
export function registerAiJobPlan(): void {
  registerAiJobPlanStep(runAiJobPlanStep, { minimumMs: AI_JOB_PLAN_STEP_MINIMUM_MS })
}
