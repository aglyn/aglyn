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
  AI_BUILD_PLAN_TOOL,
  isAiPlanNewRef,
  type AiBuildPlan,
} from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { runValidatedGeneration } from '../runtime/ai-doctrine'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import { AI_JOB_BRIEF_MAX_CHARS, type AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobPlanStep } from './ai-jobs'

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
      'Refer to inventory records by id and to what the plan creates as new:<name>. Plan only what the brief asks for: a component, layout, form or email job plans no screens unless the brief asks for pages.',
  },
]

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

export interface AiJobPlanStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
}

export function createAiJobPlanStep(deps: AiJobPlanStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  return async ({ job, now, signal, firestore, modelFor }) => {
    const inventory = job.hostId
      ? await readInventory(job.orgId, job.hostId, { firestore })
      : null
    // The model switch's answer for this job (AGL-2942): the creator's pick
    // where the plan, the org restriction and the allotment allowlists allow
    // it, and Auto held to those same lists otherwise. Without a resolver the
    // doctrine asks the routing table itself.
    const model = modelFor?.('job.plan')
    const result = await runValidatedGeneration('plan', {
      step: 'job.plan',
      ...(model ? { model } : {}),
      instructions: AI_JOB_PLAN_INSTRUCTIONS,
      inventory,
      messages: [{ role: 'user', content: aiJobPlanPrompt(job) }],
      tool: AI_BUILD_PLAN_TOOL,
      thinking: 'adaptive',
      ...(signal ? { signal } : {}),
    })
    const spent = {
      outputs: [],
      usage: result.usage,
      estCostUsd: result.estCostUsd,
      model: result.model,
      stopReason: result.stopReason,
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
    }
    return {
      ...spent,
      plan,
      review: { reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] },
    }
  }
}

export const runAiJobPlanStep = createAiJobPlanStep()

registerAiJobPlanStep(runAiJobPlanStep)
