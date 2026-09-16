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
  COMPONENT_PROP_NAME_PATTERN,
  NODE_HIDE_IF_PROP,
  NODE_HIDE_UNLESS_PROP,
  REUSABLE_INSTANCE_COMPONENT_ID,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
} from '@aglyn/aglyn/app-utils/reusable-component-keys'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type {
  ReusableComponentProp,
  ReusableComponentPropType,
} from '@aglyn/aglyn/foundation/definitions/platform.types'
import {
  REUSABLE_PROP_KINDS,
  reusablePropValueShape,
} from '@aglyn/aglyn/foundation/definitions/property-kinds'
import { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import {
  AI_COMPONENT_COPY_KINDS,
  aiComponentPropBindsToField,
  aiComponentPropNamesIn,
  aiComponentUnofferedAnswers,
  isAiComponentPropToken,
} from '../runtime/ai-component-bindings'
import { runValidatedGeneration, type AiValidatedTree } from '../runtime/ai-doctrine'
import {
  detectOffVoiceCopy,
  walkTree,
  type AiDoctrineNode,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { AI_INSTANCE_REF_PROP } from '../runtime/ai-node-tree'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import {
  AI_COMPONENT_TOOL_NAME,
  aiComponentPropKindWords,
  aiComponentTool,
  readAiComponentProps,
} from '../tools/ai-component-tool'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import {
  aiDraftAdmissionRefusal,
  aiDraftAllowanceRefusal,
  aiSiteSubdomain,
  readAiDraft,
  writeAiDraft,
  type AiDraftRecord,
} from './ai-job-drafts'
import {
  aiConfirmedPlan,
  aiDoctrineReview,
  aiGenerationSpent,
  aiJobBriefLine,
  aiLimitReview,
  aiModelNodeIds,
  aiPlacedComponentIds,
  aiPlanCreation,
  aiPlanReferenceLines,
  aiPlanReuseViolations,
  aiUnspentOutcome,
} from './ai-job-generation'
import type { AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The component step (AGL-2908): the generation step of a `component` job,
 * run once a member confirmed the job's plan.
 *
 * It builds ONE reusable component from the brief — its tree, and the typed
 * properties each page that places it fills in — through
 * `runValidatedGeneration('component', …)`, so every building rule holds on
 * the tree before it is kept. The tree binds each property with
 * `{{prop.<name>}}`; the palette validator keeps those tokens as written
 * (`definesComponent`), and the step's own check, through `extend`, holds
 * each binding to what the Properties dialog and the Attributes panel allow:
 *
 * - every token names a property the component declares, and every declared
 *   property is bound, so no field a page sets changes nothing;
 * - a property binds only to a field that holds its kind of value
 *   (`runtime/ai-component-bindings.ts`): a switch takes a Yes / no, a
 *   dropdown a Choice whose answers it lists, a screen picker a Link
 *   (AGL-2871);
 * - an optional part is switched off by a Yes / no labeled `Hide …` that
 *   defaults to No, bound to `hideIf` on that part and never on the whole
 *   component;
 * - a default is what the component shows until a page sets it, in the
 *   site's voice (rule 14), and fits the field it fills;
 * - what the confirmed plan names is there: the components it reuses, and
 *   the properties it lists for this component (rule 7).
 *
 * The component lands as a new draft (`ai-job-drafts.ts`) that no page
 * places, and gets its first version when a member opens it, as every
 * component created outside the besigner does. A plan that starts from a copy
 * of a component the site has gets that copy, through the platform's
 * duplicate module, and nothing generated.
 *
 * A generation step has the job beat's budget for one step, its re-ask
 * included, so it runs without extended thinking and under the answer
 * ceiling the layout and template steps keep. The step's spec measures the
 * request and the answer against that budget.
 */

/** The longest answer a component may run to; the tree is held to the component budget either way. */
export const AI_JOB_COMPONENT_MAX_TOKENS = AI_ROUTING_TABLE['job.component'].maxTokens

/** A component's name when the plan names none. */
export const AI_JOB_COMPONENT_DEFAULT_NAME = 'Component'

/** The label a Yes / no that hides a part opens with, so a page reads what it does. */
const HIDE_LABEL = /^Hide\b/

/** The kinds of a placed component's property that copy fills as text. */
const COPY_FIELD_KINDS: ReadonlySet<string> = new Set(['text', 'richText'])

/** The component step's own instructions, cached after the doctrine and before the catalog. */
export const AI_JOB_COMPONENT_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      `You build one reusable component for a website: a block the site places on many pages, each placement filling in its own values. Answer with ${AI_COMPONENT_TOOL_NAME}: the component’s tree as one flat node map, and the properties it declares.`,
      'The root is the document wrapper holding the component. A component is placed inside pages: it carries no main landmark and at most one h1, and its colors, spacing and type come from the theme.',
      'Every value that should differ from one placement to the next is a property, bound in the tree with its token {{prop.<name>}}. Declare every property the tree binds, and bind every property you declare.',
      `Property kinds, as type (the name a page reads): ${aiComponentPropKindWords()}.`,
      'A property binds only to a field that holds its kind of value:',
      '- text, richText and number: copy, such as a Typography’s text, an Image’s alt or a Button’s label, as the whole value or inside a sentence.',
      '- image: an Image’s src, as the whole value.',
      '- href: a screenId or an href, as the whole value.',
      '- boolean: a switch setting such as a Button’s fullWidth, or hideIf on the part it hides, as the whole value.',
      '- choice: a setting with fixed options such as a Button’s variant, as the whole value, with every answer’s value one that setting lists.',
      'An optional part, such as a photo, a badge or a second button, gets a boolean property labeled "Hide <the part>" whose default is "false", and the part’s own element carries "hideIf": "{{prop.<name>}}". Never hide the whole component.',
      'A default is what the component shows until a page sets it: copy in the site’s voice from the brief, with a fact the brief does not give in square brackets; for href a screen id from the site inventory, or ""; for image "", for an upload; for choice one of its answers’ values.',
    ].join('\n'),
  },
]

/** The component job as the generation's user turn: the name, the brief, the confirmed plan. */
export function aiJobComponentPrompt(
  job: Pick<AiJob, 'brief'>,
  plan: AiJobPlan | null,
  name: string,
): string {
  return [`Component name: ${name}`, aiJobBriefLine(job), ...aiPlanReferenceLines(plan)].join('\n')
}

/** The property names the confirmed plan lists for its component, from its `name:type` fields. */
export function aiPlannedComponentProps(plan: AiJobPlan | null): string[] {
  const names = (aiPlanCreation(plan, 'component')?.fields ?? [])
    .map((field) => field.split(':')[0]?.trim() ?? '')
    .filter((name) => COMPONENT_PROP_NAME_PATTERN.test(name))
  return [...new Set(names)]
}

interface BindingFinding {
  id: string
  name: string
}

/** A property's kind as a sentence names one: "an Image", "a Yes / no". */
function aKind(type: string | undefined): string {
  const label =
    REUSABLE_PROP_KINDS[(type ?? 'text') as ReusableComponentPropType]?.label ??
    REUSABLE_PROP_KINDS.text.label
  return `${/^[AEIOU]/i.test(label) ? 'an' : 'a'} ${label}`
}

function fieldPhrase(componentId: string, field: string): string {
  return `the ${AI_PALETTE[componentId]?.displayName ?? componentId}’s ${field}`
}

const tokenOf = (name: string): string => `{{prop.${name}}}`

/**
 * Whether a property handed on to a placed component fits the property it
 * fills there: copy into copy, whole or inside a sentence; a picture or a
 * link only into its own kind, whole; any other kind into one whose value has
 * its shape.
 */
function handsOnTo(prop: ReusableComponentProp, placedType: string, whole: boolean): boolean {
  const type = prop.type ?? 'text'
  if (AI_COMPONENT_COPY_KINDS.has(type) && COPY_FIELD_KINDS.has(placedType)) return true
  if (!whole) return false
  if ([type, placedType].some((kind) => kind === 'image' || kind === 'href')) return type === placedType
  return (
    reusablePropValueShape(prop) ===
    reusablePropValueShape({ type: placedType as ReusableComponentPropType })
  )
}

/**
 * The component door's check of its bindings, on a tree the doctrine admitted
 * and the properties the same answer declared: every token names a declared
 * property on a field of its kind, every property is bound, a part is hidden
 * by a `Hide …` Yes / no that defaults to No, and a default fits the field it
 * fills. `refused` names properties the answer declared and the reading
 * refused, which are reported there and not again here.
 */
export function aiComponentBindingViolations(
  tree: Pick<AiValidatedTree, 'rootId' | 'nodes' | 'sourceIds'>,
  props: readonly ReusableComponentProp[],
  inventory: AiSiteInventory | null,
  refused: readonly string[] = [],
): AiDoctrineViolation[] {
  const declared = new Map(props.map((prop) => [prop.name, prop]))
  const skipped = new Set(refused)
  const placedProps = new Map(
    (inventory?.components ?? []).map((component) => [component.id, component.props]),
  )
  const nodes = tree.nodes as unknown as Record<string, AiDoctrineNode>
  // The whole component: its root, and the one element a document wrapper holds.
  const whole = new Set([tree.rootId])
  const root = nodes[tree.rootId]
  if (root?.componentId === 'div' && root.nodes?.length === 1) whole.add(root.nodes[0])

  const bound = new Set<string>()
  const undeclared: BindingFinding[] = []
  const unfit: Array<BindingFinding & { at: string }> = []
  const unoffered: Array<BindingFinding & { at: string; values: string[] }> = []
  const tooLong: Array<BindingFinding & { at: string; limit: number }> = []
  const hidesWhole: BindingFinding[] = []
  const hideForm: BindingFinding[] = []
  const named = (id: string, name: string): ReusableComponentProp | null => {
    const prop = declared.get(name)
    if (prop) {
      bound.add(name)
      return prop
    }
    if (!skipped.has(name)) undeclared.push({ id, name })
    return null
  }

  for (const { id, node } of walkTree({ rootId: tree.rootId, nodes })) {
    const entry = AI_PALETTE[node.componentId]
    for (const [field, value] of Object.entries(node.props ?? {})) {
      const placement = isAiComponentPropToken(value) ? 'whole' : 'inside'
      for (const name of aiComponentPropNamesIn(value)) {
        const prop = named(id, name)
        if (!prop) continue
        if (!aiComponentPropBindsToField(prop, entry, field, placement)) {
          unfit.push({ id, name, at: fieldPhrase(node.componentId, field) })
          continue
        }
        if (field === NODE_HIDE_IF_PROP || field === NODE_HIDE_UNLESS_PROP) {
          if (whole.has(id)) hidesWhole.push({ id, name })
          if (
            field === NODE_HIDE_IF_PROP &&
            (!HIDE_LABEL.test(prop.label ?? '') || prop.defaultValue === true)
          ) {
            hideForm.push({ id, name })
          }
          continue
        }
        const values = aiComponentUnofferedAnswers(prop, entry, field)
        if (values.length) unoffered.push({ id, name, at: fieldPhrase(node.componentId, field), values })
        const limit = entry?.textLimits[field]
        if (
          placement === 'whole' &&
          limit !== undefined &&
          typeof prop.defaultValue === 'string' &&
          prop.defaultValue.length > limit
        ) {
          tooLong.push({ id, name, at: fieldPhrase(node.componentId, field), limit })
        }
      }
    }
    // A property handed on to a component this one places.
    const refId = node.props?.[AI_INSTANCE_REF_PROP]
    const handed = node.props?.[REUSABLE_INSTANCE_PROP_VALUES_KEY]
    if (
      node.componentId !== REUSABLE_INSTANCE_COMPONENT_ID ||
      typeof refId !== 'string' ||
      !handed ||
      typeof handed !== 'object' ||
      Array.isArray(handed)
    ) {
      continue
    }
    const types = placedProps.get(refId) ?? {}
    for (const [field, value] of Object.entries(handed as Record<string, unknown>)) {
      const wholeValue = isAiComponentPropToken(value)
      for (const name of aiComponentPropNamesIn(value)) {
        const prop = named(id, name)
        if (prop && !handsOnTo(prop, types[field] ?? 'text', wholeValue)) {
          unfit.push({ id, name, at: `the placed component’s ${field}` })
        }
      }
    }
  }

  const at = (list: ReadonlyArray<{ id: string }>): string[] =>
    aiModelNodeIds([...new Set(list.map((entry) => entry.id))], tree.sourceIds)
  const violations: AiDoctrineViolation[] = []
  if (undeclared.length) {
    const tokens = [...new Set(undeclared.map((entry) => tokenOf(entry.name)))]
    violations.push({
      rule: 1,
      code: 'prop-undeclared',
      message: `The tree binds ${tokens.slice(0, 3).join(', ')}, which the component does not declare. Declare every property the tree binds.`,
      nodeIds: at(undeclared),
    })
  }
  if (unfit.length) {
    const [first] = unfit
    violations.push({
      rule: 1,
      code: 'binding-field',
      message: `${tokenOf(first.name)} is ${aKind(declared.get(first.name)?.type)} property bound to ${first.at}, which does not take one. Bind each property only to a field that holds its kind of value.`,
      nodeIds: at(unfit),
    })
  }
  if (unoffered.length) {
    const [first] = unoffered
    violations.push({
      rule: 1,
      code: 'binding-answers',
      message: `${tokenOf(first.name)} offers ${first.values.map((value) => `"${value}"`).join(', ')}, which ${first.at} does not list. Give a Choice only answers whose values the field lists.`,
      nodeIds: at(unoffered),
    })
  }
  if (tooLong.length) {
    const [first] = tooLong
    violations.push({
      rule: 1,
      code: 'prop-default-too-long',
      message: `The default of ${tokenOf(first.name)} is longer than ${first.at} holds (${first.limit} characters). Shorten it.`,
      nodeIds: at(tooLong),
    })
  }
  if (hidesWhole.length) {
    violations.push({
      rule: 1,
      code: 'hide-whole-component',
      message:
        'The whole component is hidden by one of its own properties, so a page could place it and show nothing. Put hideIf on the optional part instead.',
      nodeIds: at(hidesWhole),
    })
  }
  if (hideForm.length) {
    const tokens = [...new Set(hideForm.map((entry) => tokenOf(entry.name)))]
    violations.push({
      rule: 1,
      code: 'hide-label',
      message: `${tokens.join(', ')} ${tokens.length === 1 ? 'hides a part, so it is' : 'hide parts, so each is'} a Yes / no labeled "Hide …" whose default is false: the part shows until a page hides it.`,
      nodeIds: at(hideForm),
    })
  }
  const unbound = props.filter((prop) => !bound.has(prop.name))
  if (unbound.length) {
    const one = unbound.length === 1
    violations.push({
      rule: 1,
      code: 'prop-unbound',
      message: `The component declares ${unbound
        .slice(0, 3)
        .map((prop) => tokenOf(prop.name))
        .join(', ')} and binds ${one ? 'it' : 'them'} nowhere, so a page that sets ${one ? 'it' : 'them'} changes nothing. Bind every property you declare.`,
    })
  }
  return violations
}

/** Rule 7: the properties the confirmed plan lists for the component are declared. */
export function aiPlannedPropViolations(
  plan: AiJobPlan | null,
  props: readonly Pick<ReusableComponentProp, 'name'>[],
): AiDoctrineViolation[] {
  const declared = new Set(props.map((prop) => prop.name))
  const missing = aiPlannedComponentProps(plan).filter((name) => !declared.has(name))
  if (!missing.length) return []
  const one = missing.length === 1
  return [
    {
      rule: 7,
      code: 'plan-prop-missing',
      message: `The confirmed plan lists the ${one ? 'property' : 'properties'} ${missing
        .map((name) => `"${name}"`)
        .join(', ')}, and the component does not declare ${one ? 'it' : 'them'}. Declare every property the plan lists.`,
    },
  ]
}

/** Rule 14 on the copy a component shows until a page sets it. */
function defaultCopyViolations(props: readonly ReusableComponentProp[]): AiDoctrineViolation[] {
  return detectOffVoiceCopy(
    props.flatMap((prop, index) =>
      (prop.type === 'text' || prop.type === 'richText') && typeof prop.defaultValue === 'string'
        ? [{ at: `props[${index}].defaultValue`, text: prop.defaultValue }]
        : [],
    ),
  )
}

/**
 * Every check the component door adds to the doctrine's, on a tree it
 * admitted and the answer the tree came in. `onProps` receives the properties
 * that answer declared, so the step keeps the declaration of the answer the
 * loop keeps — the last one it checked.
 */
export function aiComponentCheck(input: {
  inventory: AiSiteInventory | null
  plan: AiJobPlan | null
  onProps: (props: ReusableComponentProp[]) => void
}): (tree: AiValidatedTree, answer: Record<string, unknown>) => AiDoctrineViolation[] {
  const screenIds = new Set((input.inventory?.screens ?? []).map((screen) => screen.id))
  return (tree, answer) => {
    const reading = readAiComponentProps(answer, { screenIds })
    input.onProps(reading.props)
    return [
      ...reading.violations,
      ...aiComponentBindingViolations(tree, reading.props, input.inventory, reading.refused),
      ...defaultCopyViolations(reading.props),
      ...aiPlanReuseViolations(input.inventory, input.plan, aiPlacedComponentIds(tree), 'component'),
      ...aiPlannedPropViolations(input.plan, [
        ...reading.props,
        ...reading.refused.map((name) => ({ name })),
      ]),
    ]
  }
}

/** A component job is admitted for a site of the job's own org whose plan includes reusable components. */
export const aiComponentJobAdmission: AiJobAdmission = (context) =>
  aiDraftAdmissionRefusal(context.firestore, {
    orgId: context.orgId,
    hostId: context.hostId,
    kind: 'component',
    org: context.org,
  })

export interface AiJobComponentStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The platform's duplicate module, for a plan that starts from a copy. */
  duplicate?: typeof duplicateResource
}

export function createAiJobComponentStep(deps: AiJobComponentStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const duplicate = deps.duplicate ?? duplicateResource
  return async ({ job, now, signal, firestore, modelFor }) => {
    const hostId = job.hostId
    if (!hostId) throw new Error('a component job names no site, and its admission refuses one')
    const output = (draft: AiDraftRecord, load?: AiLoadEstimate | null): AiJobOutput => ({
      resource: 'reusableComponent',
      id: draft.id,
      versionId: draft.versionId,
      hostId,
      hostSubdomain: draft.hostSubdomain,
      label: draft.name,
      ...(load ? { load } : {}),
    })
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.component') ?? aiModelForStep('job.component')

    // A run cut off after its draft was written reports that draft.
    const written = await readAiDraft(firestore, { kind: 'component', hostId, id: job.$id })
    if (written) return aiUnspentOutcome(model, { outputs: [output(written)] })

    const [inventory, orgSnapshot] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      firestore.collection('orgs').doc(job.orgId).get(),
    ])
    const org = (orgSnapshot.data() ?? null) as Partial<AglynOrgBilling> | null
    const plan = aiConfirmedPlan(job)
    const creation = aiPlanCreation(plan, 'component')
    const name = creation?.name || AI_JOB_COMPONENT_DEFAULT_NAME

    // The plan starts from a copy of a component the site has (rule 15): the
    // copy is the draft, and nothing is generated. A source gone since the
    // plan was made is built from the brief instead.
    if (
      creation?.duplicateOf &&
      inventory.components.some((component) => component.id === creation.duplicateOf)
    ) {
      const copy = await duplicate('component', {
        orgId: job.orgId,
        hostId,
        sourceId: creation.duplicateOf,
        name,
        uid: job.createdBy,
        org: org as Record<string, unknown> | null,
      })
      if (copy.ok) {
        const hostSubdomain = await aiSiteSubdomain(firestore, hostId)
        return aiUnspentOutcome(model, {
          outputs: [
            output({ id: copy.id, versionId: copy.versionId ?? null, name: copy.name, hostSubdomain }),
          ],
        })
      }
      if (copy.ok === false && copy.status === 403) {
        return aiUnspentOutcome(model, { review: aiLimitReview(copy.error) })
      }
    }

    const allowance = await aiDraftAllowanceRefusal(firestore, { kind: 'component', hostId, org })
    if (allowance) return aiUnspentOutcome(model, { review: aiLimitReview(allowance) })

    let props: ReusableComponentProp[] = []
    const result = await runValidatedGeneration('component', {
      step: 'job.component',
      model,
      instructions: AI_JOB_COMPONENT_INSTRUCTIONS,
      inventory,
      messages: [{ role: 'user', content: aiJobComponentPrompt(job, plan, name) }],
      tool: aiComponentTool(),
      maxTokens: AI_JOB_COMPONENT_MAX_TOKENS,
      ...(AI_ROUTING_TABLE['job.component'].thinking
        ? { thinking: AI_ROUTING_TABLE['job.component'].thinking }
        : {}),
      ...(AI_ROUTING_TABLE['job.component'].effort
        ? { effort: AI_ROUTING_TABLE['job.component'].effort }
        : {}),
      context: { definesComponent: true },
      extend: aiComponentCheck({
        inventory,
        plan,
        onProps: (declared) => {
          props = declared
        },
      }),
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }

    const draft = await writeAiDraft(firestore, {
      kind: 'component',
      hostId,
      id: job.$id,
      uid: job.createdBy,
      org,
      name,
      nodes: result.value.nodes,
      rootId: result.value.rootId,
      props,
      now,
    })
    if (draft.ok === false) {
      if (draft.status === 404) throw new Error(`site ${hostId} vanished while its component was generated`)
      return { ...spent, review: aiLimitReview(draft.error) }
    }
    return { ...spent, outputs: [output(draft, result.value.load)] }
  }
}

export const runAiJobComponentStep = createAiJobComponentStep()

registerAiJobStep('component', runAiJobComponentStep)
registerAiJobAdmission('component', aiComponentJobAdmission)
