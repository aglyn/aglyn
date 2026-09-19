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
import type {
  AiJob,
  AiJobOutput,
  AiJobPlan,
  AiJobReview,
  AiJobReviewOutlineNode,
} from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { aiAnswerTree, type AiGenerationSpend, type AiValidatedTree } from '../runtime/ai-doctrine'
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

/** The most node ids, or plan paths, one finding keeps on its review (AGL-3078). */
export const AI_JOB_REVIEW_REFS_MAX = 24
/** The longest node id or plan path a review keeps, in characters. */
export const AI_JOB_REVIEW_REF_MAX_CHARS = 64
/** How far below a node a finding names its outline goes: the node, its children and theirs. */
export const AI_JOB_REVIEW_OUTLINE_MAX_DEPTH = 2
/** The most nodes a review outlines, across all its findings. */
export const AI_JOB_REVIEW_OUTLINE_MAX_NODES = 40
/** The most names an outlined node lists of its props, of its sx keys, or of its children. */
export const AI_JOB_REVIEW_OUTLINE_MAX_NAMES = 16
/** The most bytes a review's outline takes as JSON, whatever the counts above allow. */
export const AI_JOB_REVIEW_OUTLINE_MAX_BYTES = 4_096

/** A Grid's layout props, whose written values an outline keeps. */
const AI_JOB_REVIEW_GRID_PROPS = [
  'container',
  'size',
  'offset',
  'direction',
  'wrap',
  'spacing',
  'rowSpacing',
  'columnSpacing',
  'columns',
] as const

/** A node id or plan path a review keeps: no whitespace, slash or quote, so never copy or an address. */
const REVIEW_REF = /^[^\s/\\"'<>]+$/
/** An element id an outline names. */
const OUTLINE_ELEMENT = /^[\w.-]{1,64}$/
/** A prop or sx name an outline lists. */
const OUTLINE_NAME = /^[A-Za-z_$][\w$-]{0,39}$/
/** The longest layout value an outline keeps as written. */
const OUTLINE_VALUE_MAX_CHARS = 40
/**
 * The words a Grid's layout is written in, besides numbers: breakpoints, span
 * words, switch words, directions and wraps. Nothing else is kept, so no copy is.
 */
const OUTLINE_LAYOUT_WORDS = new Set([
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  'auto',
  'grow',
  'true',
  'false',
  'yes',
  'no',
  'on',
  'off',
  'row',
  'row-reverse',
  'column',
  'column-reverse',
  'wrap',
  'nowrap',
  'wrap-reverse',
])
/** A number a layout value is written in, with a CSS length unit where it has one. */
const OUTLINE_LAYOUT_NUMBER = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%)?$/i
/** What stands between the words of a layout value, as in `xs:12 md:4` or `{ xs: 12, md: 4 }`. */
const OUTLINE_LAYOUT_SEPARATORS = /[\s,:;=/{}()[\]"']+/
/** A binding token, which a component's Grid may carry for a layout value. */
const OUTLINE_BINDING = /^\{\{\s*[\w.-]+\s*\}\}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether text is a layout value: a binding token, or only layout words and numbers. */
function isLayoutText(value: string): boolean {
  if (value.length > OUTLINE_VALUE_MAX_CHARS) return false
  if (OUTLINE_BINDING.test(value.trim())) return true
  return value
    .split(OUTLINE_LAYOUT_SEPARATORS)
    .every((word) => word === '' || OUTLINE_LAYOUT_WORDS.has(word.toLowerCase()) || OUTLINE_LAYOUT_NUMBER.test(word))
}

/** An id or a path as a review keeps it: cut to its ceiling, and `?` for one it cannot show. */
function reviewRef(ref: string): string {
  const cut = ref.slice(0, AI_JOB_REVIEW_REF_MAX_CHARS)
  return REVIEW_REF.test(cut) ? cut : '?'
}

function reviewRefs(refs: readonly string[]): string[] {
  return refs.slice(0, AI_JOB_REVIEW_REFS_MAX).map(reviewRef)
}

/** A written layout value as an outline keeps it; text that is no layout value is kept as a marker. */
function outlineValue(value: unknown): string | number | boolean | null {
  if (value === null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return isLayoutText(value) ? value : '<text>'
  return Array.isArray(value) ? '<list>' : '<object>'
}

function childIdsOf(node: Record<string, unknown>): string[] {
  return Array.isArray(node['nodes']) ? node['nodes'].filter((child): child is string => typeof child === 'string') : []
}

function elementOf(node: unknown): string {
  const componentId = isRecord(node) ? node['componentId'] : undefined
  return typeof componentId === 'string' && OUTLINE_ELEMENT.test(componentId) ? componentId : '?'
}

/** One node of an outline: where it sits, what it is and the names of what it sets, never a copy value. */
function outlineNodeOf(
  id: string,
  depth: number,
  node: Record<string, unknown>,
  nodes: Readonly<Record<string, unknown>>,
): AiJobReviewOutlineNode {
  const props = isRecord(node['props']) ? node['props'] : {}
  const sx = isRecord(node['sx']) ? node['sx'] : isRecord(props['sx']) ? props['sx'] : {}
  const names = (keys: string[]) =>
    keys.filter((key) => OUTLINE_NAME.test(key)).slice(0, AI_JOB_REVIEW_OUTLINE_MAX_NAMES)
  const componentId = elementOf(node)
  const grid =
    componentId === 'muiGrid'
      ? Object.fromEntries(
          AI_JOB_REVIEW_GRID_PROPS.filter((name) => props[name] !== undefined).map((name) => [
            name,
            outlineValue(props[name]),
          ]),
        )
      : {}
  const sxNames = names(Object.keys(sx))
  return {
    id: reviewRef(id),
    depth,
    componentId,
    props: names(Object.keys(props).filter((key) => key !== 'sx')),
    ...(sxNames.length ? { sx: sxNames } : {}),
    ...(Object.keys(grid).length ? { grid } : {}),
    children: childIdsOf(node)
      .filter((child) => isRecord(nodes[child]))
      .slice(0, AI_JOB_REVIEW_OUTLINE_MAX_NAMES)
      .map((child) => elementOf(nodes[child])),
  }
}

/**
 * The parts of a refused answer its findings name, as a review keeps them
 * (AGL-3078): each node a finding names by id, with the nodes below it to
 * `AI_JOB_REVIEW_OUTLINE_MAX_DEPTH`, in document order and each once. A node
 * keeps its id, its element, the names of its props and sx keys and its
 * children's elements, and a Grid the values of its layout props as written;
 * no copy, and no address, is kept. The outline stops at
 * `AI_JOB_REVIEW_OUTLINE_MAX_NODES` nodes or `AI_JOB_REVIEW_OUTLINE_MAX_BYTES`
 * bytes, whichever comes first. An answer that is no node map, and findings
 * that name no node, outline nothing.
 */
export function aiDoctrineReviewOutline(
  answer: Record<string, unknown> | null | undefined,
  violations: readonly AiDoctrineViolation[],
): AiJobReviewOutlineNode[] {
  const outline: AiJobReviewOutlineNode[] = []
  const tree = answer ? aiAnswerTree(answer) : null
  const nodes = isRecord(tree) && isRecord(tree['nodes']) ? tree['nodes'] : null
  if (!nodes) return outline
  const encoder = new TextEncoder()
  const seen = new Set<string>()
  let bytes = 2
  // False once the outline is full, which ends the walk.
  const add = (id: string, depth: number): boolean => {
    const node = nodes[id]
    if (seen.has(id) || !isRecord(node)) return true
    seen.add(id)
    const entry = outlineNodeOf(id, depth, node, nodes)
    const size = encoder.encode(JSON.stringify(entry)).length + 1
    if (outline.length === AI_JOB_REVIEW_OUTLINE_MAX_NODES || bytes + size > AI_JOB_REVIEW_OUTLINE_MAX_BYTES) {
      return false
    }
    outline.push(entry)
    bytes += size
    return depth === AI_JOB_REVIEW_OUTLINE_MAX_DEPTH || childIdsOf(node).every((child) => add(child, depth + 1))
  }
  const named = violations.flatMap((violation) => (violation.nodeIds ?? []).slice(0, AI_JOB_REVIEW_REFS_MAX))
  for (const id of new Set(named)) {
    if (!add(id, 0)) break
  }
  return outline
}

/**
 * The review a generation stops its job for when the re-ask still broke a
 * rule: the sentence a person reads, each finding with the nodes or plan
 * entries it names, and an outline of those parts of the answer it was found
 * in (AGL-3078), so why a job stopped can be read back from the job once the
 * answer itself is gone.
 */
export function aiDoctrineReview(result: {
  message: string
  violations: readonly AiDoctrineViolation[]
  /** The refused answer, whose nodes the findings name by id; outlined, never kept. */
  answer?: Record<string, unknown> | null
}): AiJobReview {
  const outline = aiDoctrineReviewOutline(result.answer, result.violations)
  return {
    reason: 'doctrine',
    message: result.message,
    findings: result.violations.map(({ rule, code, message, nodeIds, paths }) => ({
      rule,
      code,
      message,
      ...(nodeIds?.length ? { nodeIds: reviewRefs(nodeIds) } : {}),
      ...(paths?.length ? { paths: reviewRefs(paths) } : {}),
    })),
    ...(outline.length ? { outline } : {}),
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
