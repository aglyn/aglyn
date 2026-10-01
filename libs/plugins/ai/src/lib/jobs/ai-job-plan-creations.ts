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

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { AI_BUILD_PLAN_CREATION_NOUNS, type AiBuildPlanCreateKind } from '../model/ai-build-plan'
import { AI_JOB_CREATE_KINDS, AI_JOB_CREATE_NOUNS, aiJobOtherCreations } from '../model/ai-job-creations'
import type { AiJob, AiJobKind, AiJobPlan } from '../model/ai-jobs.types'
import { aiPageCreationRefusal } from '../model/ai-page-job'
import { aiPlanCapabilitiesForJob, aiPlanUncreatable } from '../model/ai-plan-capabilities'
import type { AiStepKind } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import type { AiJobAdmissionContext, AiJobAdmissionRefusal } from './ai-job-admission'
import { readAiPlanCapabilities } from './ai-job-drafts'
import { aiConfirmedPlan, aiUnspentOutcome } from './ai-job-generation'
import {
  aiCreationUnit,
  aiRunJobUnit,
  aiSiteBuiltRefs,
  aiSitePendingUnits,
  aiSiteResolvedRef,
  aiSiteUnitJob,
  type AiSiteUnit,
} from './ai-job-site-step'
import type { AiJobStepRunner } from './ai-job-text-step'
import { aiJobStepRunMinimumMs, aiJobStepRunnerFor } from './ai-jobs'

/**
 * A template, layout or component job builds the rest of its plan before its
 * own record (AGL-3143 §15), through the machinery a page job builds its
 * creations with (AGL-3031): one creation a pass, handed to the step that
 * builds that kind under a job derived from this one, where the job stands
 * read from its outputs. Once every creation is built, the kind's own step
 * runs on the plan with each `new:<name>` resolved to the record that was
 * built and listed among what the plan reuses — so the template's reuse check
 * holds it to placing the component its plan created, exactly as it holds it
 * to one the site always had.
 *
 * What each kind builds is `AI_JOB_CREATE_KINDS`; a form or an email design
 * places nothing another job builds, so its plan is only held to that list.
 */

/** A creation the plan names that this deployment has no step to build. */
export const AI_JOB_CREATION_UNAVAILABLE_COPY =
  'This needs something that cannot be built here yet. Describe it again.'

/** A creation that finished without reporting what it built; the job's own record cannot place it. */
export const AI_JOB_CREATION_EMPTY_COPY = 'Part of this could not be built. Describe it again.'

/** The order a page job builds creations in: a form before the component that may place it. */
const UNIT_ORDER: readonly AiBuildPlanCreateKind[] = ['form', 'component']

/**
 * The units the creations a job of `kind` builds before its own record are
 * built as, in build order, each addressed by its place in the plan so a unit
 * run again finds its own draft.
 */
export function aiJobCreationUnits(kind: AiJobKind, plan: Pick<AiJobPlan, 'create'>): AiSiteUnit[] {
  const others = aiJobOtherCreations(kind, plan)
  return UNIT_ORDER.flatMap((order) =>
    others.flatMap(({ creation, index }) => {
      if (creation.kind !== order) return []
      const unit = aiCreationUnit(creation, `c${index}`)
      return unit ? [unit] : []
    }),
  )
}

/**
 * The job a unit is derived from. A unit places none of the components the
 * plan reuses: those are the job's own record's to place, and a card told to
 * place them would be refused for leaving them out.
 */
function forUnits(job: AiJob, plan: AiJobPlan): AiJob {
  return { ...job, plan: { ...plan, reuse: plan.reuse.filter((entry) => entry.kind !== 'component') } }
}

/**
 * The job the kind's own step builds its record under once every creation is
 * built: the plan's own creation alone, from a copy resolved to what was
 * built, and every built record reused, with the reason the plan gave for it.
 */
export function aiJobWithBuiltCreations(job: AiJob, kind: AiJobKind, units: readonly AiSiteUnit[]): AiJob {
  const plan = job.plan as AiJobPlan
  const built = aiSiteBuiltRefs(units, job.outputs ?? [])
  const labels = { ...(plan.labels ?? {}) }
  const reuse = [...plan.reuse]
  for (const unit of units) {
    const record = unit.creation ? built.get(unit.creation.name.toLowerCase()) : undefined
    if (!record || !unit.creation) continue
    labels[record.id] = record.label
    reuse.push({ kind: record.kind, id: record.id, purpose: `made for this plan: ${unit.creation.why}` })
  }
  const own = plan.create.find((entry) => entry.kind === kind)
  return {
    ...job,
    plan: {
      ...plan,
      labels,
      reuse,
      create: own ? [{ ...own, duplicateOf: aiSiteResolvedRef(own.duplicateOf, built) }] : [],
    },
  }
}

export interface AiJobPlanCreationsDeps {
  /** The runners a plan's creations are built by; the registry's otherwise. */
  runnerFor?: typeof aiJobStepRunnerFor
}

/**
 * The kind's own runner, building the plan's other creations first: one a
 * pass while any is unbuilt, then the kind's own record on the plan they
 * resolve. A plan with nothing else to build runs the kind's own step as it
 * always ran.
 */
export function aiBuildingPlanCreations(
  kind: AiJobKind,
  step: AiStepKind,
  runner: AiJobStepRunner,
  deps: AiJobPlanCreationsDeps = {},
): AiJobStepRunner {
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  return async (context) => {
    const { job } = context
    const plan = aiConfirmedPlan(job)
    const units = plan ? aiJobCreationUnits(kind, plan) : []
    if (!plan || !units.length) return runner(context)
    const [unit] = aiSitePendingUnits(units, job.outputs ?? [])
    if (!unit) return runner({ ...context, job: aiJobWithBuiltCreations(job, kind, units) })
    const unitRunner = runnerFor(unit.jobKind)
    if (!unitRunner) {
      const model = context.modelFor?.(step) ?? aiModelForStep(step)
      return { ...aiUnspentOutcome(model), failure: AI_JOB_CREATION_UNAVAILABLE_COPY }
    }
    const pass = await aiRunJobUnit(
      { ...context, job: forUnits(job, plan) },
      { unit, units, runner: unitRunner, emptyCopy: AI_JOB_CREATION_EMPTY_COPY },
    )
    // A built creation is followed by the next, or by the job's own record.
    return pass.built ? { ...pass.outcome, continue: true } : pass.outcome
  }
}

/**
 * The least time this job's next pass needs (AGL-3035): a pass that builds a
 * creation needs what the step that builds it registers for the job derived
 * for it; the kind's own pass needs what the kind registered.
 */
export function aiPlanCreationsRunMinimumMs(kind: AiJobKind): (job: AiJob) => number {
  return (job) => {
    const plan = aiConfirmedPlan(job)
    if (!plan) return 0
    const units = aiJobCreationUnits(kind, plan)
    const outputs = job.outputs ?? []
    const [unit] = aiSitePendingUnits(units, outputs)
    if (!unit) return 0
    return aiJobStepRunMinimumMs(aiSiteUnitJob(forUnits(job, plan), unit, aiSiteBuiltRefs(units, outputs)))
  }
}

/**
 * Why a job of `kind` cannot build the creations its plan names, as the door
 * that confirms the plan answers; `null` when it can, or when there is no plan
 * yet. A creation the kind does not build, one this deployment has no step
 * for, and one the workspace may not make on this site now are each refused
 * before a credit is spent, the way a page job's door refuses them.
 */
export async function aiJobPlanCreationsRefusal(
  kind: AiJobKind,
  context: Pick<AiJobAdmissionContext, 'firestore' | 'org' | 'plan'>,
  hostId: string,
  deps: AiJobPlanCreationsDeps & { readCapabilities?: typeof readAiPlanCapabilities } = {},
): Promise<AiJobAdmissionRefusal | null> {
  const plan = context.plan
  const creates = AI_JOB_CREATE_KINDS[kind]
  if (!plan || !creates) return null
  // A plan creating only the job's own record is held by the draft allowance, as it always was.
  const own = plan.create.findIndex((entry) => entry.kind === kind)
  if (!plan.create.some((_, index) => index !== own)) return null
  const noun = AI_BUILD_PLAN_CREATION_NOUNS[kind as AiBuildPlanCreateKind]?.noun ?? kind
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  if (aiJobCreationUnits(kind, plan).some((unit) => !runnerFor(unit.jobKind))) {
    return { status: 400, error: AI_JOB_CREATION_UNAVAILABLE_COPY }
  }
  const readCapabilities = deps.readCapabilities ?? readAiPlanCapabilities
  const capabilities = aiPlanCapabilitiesForJob(
    await readCapabilities(context.firestore, {
      hostId,
      org: context.org as Partial<AglynOrgBilling> | null,
    }),
    { noun: AI_JOB_CREATE_NOUNS[kind] ?? `a ${kind} job`, creates },
  )
  const refusal = aiPageCreationRefusal(aiPlanUncreatable(plan, capabilities), noun)
  return refusal ? { status: 403, error: refusal } : null
}
