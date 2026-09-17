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
  REUSABLE_INSTANCE_COMPONENT_ID,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
} from '@aglyn/aglyn/app-utils/reusable-component-keys'
import type { AiBuildPlanCreate, AiBuildPlanCreateKind } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput, AiJobPlan, AiJobReview } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import type { AiGenerationSpend, AiValidatedTree } from '../runtime/ai-doctrine'
import {
  aiBracketedFacts,
  aiTreeCopy,
  walkTree,
  type AiDoctrineNode,
  type AiDoctrineTree,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { AI_INSTANCE_REF_PROP } from '../runtime/ai-node-tree'
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

/** The reusable components a tree places, by the id each instance names. */
export function aiPlacedComponentIds(tree: Pick<AiValidatedTree, 'rootId' | 'nodes'>): Set<string> {
  const placed = new Set<string>()
  const nodes = tree.nodes as unknown as Record<string, AiDoctrineNode>
  for (const { node } of walkTree({ rootId: tree.rootId, nodes })) {
    const ref = node.props?.[AI_INSTANCE_REF_PROP]
    if (node.componentId === REUSABLE_INSTANCE_COMPONENT_ID && typeof ref === 'string') {
      placed.add(ref)
    }
  }
  return placed
}

/**
 * Rule 7 on a generated tree: every component the confirmed plan reuses is
 * placed. `noun` names what the tree builds, in the finding.
 */
export function aiPlanReuseViolations(
  inventory: AiSiteInventory | null,
  plan: AiJobPlan | null,
  placed: ReadonlySet<string>,
  noun: string,
): AiDoctrineViolation[] {
  const names = new Map((inventory?.components ?? []).map((component) => [component.id, component.name]))
  const reused = [
    ...new Set(
      (plan?.reuse ?? []).filter((entry) => entry.kind === 'component').map((entry) => entry.id),
    ),
  ]
  const missing = reused.filter((id) => !placed.has(id))
  if (!missing.length) return []
  const listed = missing.map((id) => `"${names.get(id) ?? id}"`).join(', ')
  return [
    {
      rule: 7,
      code: 'plan-reuse-not-placed',
      message: `The confirmed plan reuses ${listed}, and the ${noun} does not place ${
        missing.length === 1 ? 'it' : 'them'
      }. Place every component the plan reuses.`,
    },
  ]
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

/** The most facts a note names before it counts the rest. */
const AI_NOTE_MAX_FACTS = 8

/** Facts as a sentence lists them: "a, b and c", the ones past the cap counted. */
function factList(facts: readonly string[]): string {
  const shown = facts.slice(0, AI_NOTE_MAX_FACTS)
  const items = facts.length > shown.length ? [...shown, `${facts.length - shown.length} more`] : shown
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * What a draft asks the member to fill in before it is published (AGL-3056),
 * in the words the job's output note shows: the facts in square brackets its
 * copy holds, which the brief did not give (rule 14), each once. A page's
 * placed components show their own defaults wherever the page sets no value
 * of its own, so a component whose defaults hold such facts is named once,
 * however often the page places it. `copy` is what the draft shows beside its
 * tree, such as a component's defaults. `null` when there is nothing to fill.
 */
export function aiBracketedFactsNote(input: {
  tree: AiDoctrineTree
  inventory: AiSiteInventory | null
  copy?: readonly string[]
}): string | null {
  const components = input.inventory?.components ?? []
  const componentProps = Object.fromEntries(components.map((component) => [component.id, component.props]))
  const facts = aiBracketedFacts([
    ...aiTreeCopy(input.tree, { componentProps }).map((sample) => sample.text),
    ...(input.copy ?? []),
  ])
  const listed = new Set(facts.map((fact) => fact.toLowerCase()))
  const byComponent = new Map<string, string[]>()
  for (const { node } of walkTree(input.tree)) {
    const component = components.find((row) => row.id === node.props?.[AI_INSTANCE_REF_PROP])
    if (node.componentId !== REUSABLE_INSTANCE_COMPONENT_ID || !component?.bracketedDefaults) continue
    const values = node.props?.[REUSABLE_INSTANCE_PROP_VALUES_KEY]
    const set = (name: string): boolean => {
      const value = values && typeof values === 'object' ? (values as Record<string, unknown>)[name] : undefined
      return value !== undefined && value !== null && String(value).trim() !== ''
    }
    const shown = byComponent.get(component.name) ?? []
    for (const [name, defaults] of Object.entries(component.bracketedDefaults)) {
      if (set(name)) continue
      for (const fact of defaults) {
        if (!listed.has(fact.toLowerCase()) && !shown.some((known) => known.toLowerCase() === fact.toLowerCase())) {
          shown.push(fact)
        }
      }
    }
    if (shown.length) byComponent.set(component.name, shown)
  }
  const sentences = [
    ...(facts.length
      ? [`Before you publish, replace the facts in square brackets, which the brief did not give: ${factList(facts)}.`]
      : []),
    ...[...byComponent.entries()].map(
      ([name, shown]) =>
        `The "${name}" component on this page shows ${factList(shown)} until you replace ${shown.length === 1 ? 'it' : 'them'}.`,
    ),
  ]
  return sentences.length ? sentences.join(' ') : null
}
