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

import type { AiBuildPlanCreate, AiBuildPlanCreateKind } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput, AiJobPlan, AiJobReview } from '../model/ai-jobs.types'
import type { AiGenerationSpend } from '../runtime/ai-doctrine'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import type { AssistTokenUsage } from '../usage/assist-usage'
import { AI_JOB_BRIEF_MAX_CHARS, type AiJobStepOutcome } from './ai-job-text-step'

/**
 * What the generation steps share (AGL-2909): reading the plan a member
 * confirmed, stating it to the model as references, and turning what a
 * generation spent or refused into the outcome the machine records.
 *
 * A generation step runs after its job's plan step, once a member confirmed
 * the plan, so the plan is part of what it executes: the records it reuses,
 * and the creation it builds. The plan travels as references — ids, names,
 * reasons — never as a document (AGL-2937).
 */

export const AI_JOB_ZERO_USAGE: AssistTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** The job's plan once a member confirmed it; `null` before that, or for a job that never planned. */
export function aiConfirmedPlan(job: Pick<AiJob, 'plan'>): AiJobPlan | null {
  return job.plan?.status === 'confirmed' ? job.plan : null
}

/** The creation of one kind the plan names; the first when it names several. */
export function aiPlanCreation(
  plan: AiJobPlan | null,
  kind: AiBuildPlanCreateKind,
): AiBuildPlanCreate | null {
  return plan?.create.find((entry) => entry.kind === kind) ?? null
}

/** A plan reference as the model reads it: the id with the name it was planned under. */
function referenceOf(plan: AiJobPlan, ref: string): string {
  const label = plan.labels?.[ref]
  return label ? `${ref} ("${label}")` : ref
}

/** The user turn's opening: the brief, cut at the ceiling every job step keeps. */
export function aiJobBriefLine(job: Pick<AiJob, 'brief'>): string {
  return `Brief: ${job.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`
}

/** The confirmed plan as reference lines; none when there is no confirmed plan. */
export function aiPlanReferenceLines(plan: AiJobPlan | null): string[] {
  if (!plan) return []
  const lines = ['Confirmed plan:']
  for (const entry of plan.reuse) {
    lines.push(`- reuse the ${entry.kind} ${referenceOf(plan, entry.id)}: ${entry.purpose}`)
  }
  for (const entry of plan.create) {
    const from = entry.duplicateOf ? `, from a copy of ${referenceOf(plan, entry.duplicateOf)}` : ''
    const fields = entry.fields.length ? ` Fields: ${entry.fields.join(', ')}.` : ''
    lines.push(`- create the ${entry.kind} "${entry.name}"${from}: ${entry.why}${fields}`)
  }
  for (const screen of plan.screens) {
    const sections = screen.sections.map((section) => section.name).join(', ')
    lines.push(`- the screen "${screen.title}" at ${screen.slug}${sections ? `: ${sections}` : ''}`)
  }
  return lines.length > 1 ? lines : []
}

/** What a generation spent, as the step's outcome carries it for the meter. */
export function aiGenerationSpent(
  spend: AiGenerationSpend,
): Pick<AiJobStepOutcome, 'outputs' | 'usage' | 'estCostUsd' | 'model' | 'stopReason'> {
  return {
    outputs: [],
    usage: spend.usage,
    estCostUsd: spend.estCostUsd,
    model: spend.model,
    stopReason: spend.stopReason,
  }
}

/** The review a generation stops its job for when the re-ask still broke a rule. */
export function aiDoctrineReview(result: {
  message: string
  violations: readonly AiDoctrineViolation[]
}): AiJobReview {
  return {
    reason: 'doctrine',
    message: result.message,
    findings: result.violations.map(({ rule, code, message }) => ({ rule, code, message })),
  }
}

/** The review a step stops its job for when the site cannot take the draft. */
export function aiLimitReview(message: string): AiJobReview {
  return { reason: 'limit', message, findings: [] }
}

/**
 * An outcome that reached no model: a draft an earlier run already wrote, a
 * copy the plan asked for, or a person asked before anything was spent.
 */
export function aiUnspentOutcome(
  model: string,
  rest: { outputs?: AiJobOutput[]; review?: AiJobReview } = {},
): AiJobStepOutcome {
  return {
    outputs: rest.outputs ?? [],
    usage: AI_JOB_ZERO_USAGE,
    estCostUsd: 0,
    model,
    stopReason: null,
    ...(rest.review ? { review: rest.review } : {}),
  }
}

/** Node ids as the MODEL wrote them, from the minted ids a check reads. */
export function aiModelNodeIds(
  ids: readonly string[],
  sourceIds: Readonly<Record<string, string>>,
): string[] {
  return ids.map((id) => sourceIds[id] ?? id)
}
