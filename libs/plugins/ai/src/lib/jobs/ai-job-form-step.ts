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

import { throwIfAiJobCanceled } from './ai-job-cancel'
import {
  checkFormContract,
  formFieldsCanYieldAnEmail,
} from '@aglyn/aglyn/app-utils/form-contract'
import {
  collectFormFieldNodeIds,
  FORM_COMPONENT_ID,
  FORM_ID_PROP,
  FORM_INPUT_ELEMENT_IDS,
  formFieldDeclsFromNodes,
  formInputName,
  formNodeIdIn,
  isMarketingConsentFieldName,
  MARKETING_CONSENT_FORM_FIELD,
  type FormDocument,
  type FormFieldDecl,
  type FormRouting,
} from '@aglyn/aglyn/app-utils/forms'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { NodeType, type NodesMap } from '@aglyn/aglyn/types/nodes'
import { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobOutput, AiJobPlan, AiJobReview } from '../model/ai-jobs.types'
import { aiSiteSubmissions, aiSiteWords, type AiSiteSubmissions } from '../model/ai-site-job'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import {
  aiDoctrineTreeTool,
  runValidatedGeneration,
  type AiValidatedTree,
} from '../runtime/ai-doctrine'
import { aiBracketedFacts, type AiDoctrineTree, type AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import { aiHasPlaceholderToken } from '../runtime/ai-placeholder-tokens'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import type { AiSystemBlock, AiTool } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import {
  AI_FORM_DATASET_MADE_INPUT,
  aiBindFormToDataset,
  aiFormDatasetNote,
  aiFormDatasetPromptLine,
  aiReadFormDataset,
  type AiFormDataset,
  type AiFormDatasetBinding,
  type AiFormDatasetReadDeps,
} from './ai-job-form-dataset'
import { aiJobPlanCreationsRefusal } from './ai-job-plan-creations'
import { aiJobDraftId } from './ai-job-draft-ids'
import {
  aiDraftAdmissionRefusal,
  aiDraftAllowanceRefusal,
  aiSiteSubdomain,
  readAiDraft,
  readAiDraftBandTakenSince,
  writeAiDraft,
  type AiDraftRecord,
} from './ai-job-drafts'
import { AI_FORM_REUSED_NOTE, aiSiblingJobForm } from './ai-job-form-reuse'
import {
  aiBracketedFactsNote,
  aiConfirmedPlan,
  aiDoctrineReview,
  aiGenerationSpent,
  aiJobBriefLine,
  aiLimitReview,
  aiModelNodeIds,
  aiPlanCreation,
  aiPlanReferenceLines,
  aiUnspentOutcome,
} from './ai-job-generation'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { aiJobStepBudget } from './ai-job-budget'
import { registerAiJobStep } from './ai-jobs'

/**
 * The form step (AGL-2913): the generation step of a `form` job, run once a
 * member confirmed the job's plan.
 *
 * A form is two halves that must agree for its submissions to arrive: the
 * DESIGN a visitor fills in (`rootId`, `nodes`) and the DECLARATION the submit
 * route reads (`fields`, `consentFieldName`, `routing`). `checkFormContract`
 * is the rule that holds them together when a form is published. So the model
 * writes only the design, through `runValidatedGeneration('form', …)`, and
 * everything else is derived from it with the functions the publish paths
 * use:
 *
 *  - `fields` is `formFieldDeclsFromNodes` over the design;
 *  - a form that can yield an email address gets the platform's marketing
 *    consent field (`aiFormConsentNodes`: a Choice Label holding one Checkbox,
 *    worded as the Forms editor preset's option) in place of any consent-like
 *    field the model drew, named as its `consentFieldName`;
 *  - `routing` is `{ lead: true }` when the answer proposes a lead, and
 *    nothing otherwise. The stored routing has no place for an email list,
 *    so a list proposal leaves the form on the Inbox and says, in the output's
 *    `note`, how to enroll the people who tick consent — naming a list only
 *    when the brief named one. The step reads no list, contact, CRM record or
 *    submission, and sends none.
 *
 * The design is then stamped the way the Forms page's Create stamps one — the
 * form node bound to the new form's id, a canvas root above it — and
 * `checkFormContract` runs on it through `extend`, beside the doctrine's own
 * checks, so a design the contract would refuse at publish is asked for again
 * with the violation named.
 *
 * The form lands as a new draft (`ai-job-drafts.ts`) that no page places and
 * nothing promotes. A plan that starts from a copy of a form the site has gets
 * that copy, through the platform's duplicate module, and nothing generated —
 * and because that path reaches no model, `extend` never runs on it, so the
 * step asks `checkFormContract` of the stored copy itself before it reports
 * one (AGL-3024). A copy still bound to the form it was copied from is a
 * failure, never an output.
 *
 * A site that holds every form its plan includes refuses the draft
 * (AGL-3765). A form the step builds for a page (a unit of a page job, a
 * guided start or a build) then places the form another AI job made on the
 * site moments before (`ai-job-form-reuse.ts`), as two jobs started from one
 * brief race to. Failing that, a site that still had room when the plan was
 * confirmed stops the job on our side, its credits given back; one that was
 * already full is the workspace's limit, for the member to change.
 *
 * Like the other generation steps, it runs on the job beat, never at an inline
 * door: it registers the least time its lookup rounds, its answer and its
 * re-ask need (AGL-3035), and runs without extended thinking under the routing
 * table's ceiling for a form, which is the doctrine's own.
 */

/**
 * The longest answer a form may run to: the routing table's `job.form`
 * ceiling, which holds the largest form the output budget admits
 * (`ai-job-form-step.spec.ts` measures it) and is the doctrine's ceiling for
 * the form kind.
 */
export const AI_JOB_FORM_MAX_TOKENS = AI_ROUTING_TABLE['job.form'].maxTokens

/**
 * The form step's time (AGL-3035, AGL-3036): its two inventory-lookup rounds,
 * its answer and its re-ask at that ceiling on the tier `job.form` is served
 * from, fitted to what a beat can give a step.
 */
export const AI_JOB_FORM_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.form'],
  maxTokens: AI_JOB_FORM_MAX_TOKENS,
})

/** The least time one form step needs before it starts. */
export const AI_JOB_FORM_STEP_MINIMUM_MS = AI_JOB_FORM_STEP_BUDGET.minimumMs

/** A form's name when the plan names none. */
export const AI_JOB_FORM_DEFAULT_NAME = 'New form'

/** Where a proposal routes a form's submissions. */
export const AI_FORM_ROUTING_KINDS = ['inbox', 'list', 'lead'] as const

export type AiFormRoutingKind = (typeof AI_FORM_ROUTING_KINDS)[number]

/** The most things a note says the brief asked for and a form cannot collect. */
export const AI_FORM_CANNOT_COLLECT_MAX = 3

const CANNOT_COLLECT_MAX_CHARS = 60
const LIST_NAME_MAX_CHARS = 80

/**
 * The node id the platform's consent field takes in a generated design: the
 * Choice Label that holds its Checkbox.
 */
export const AI_FORM_CONSENT_NODE_ID = 'marketingConsentField'

/** The node id of the consent field's Checkbox, inside {@link AI_FORM_CONSENT_NODE_ID}. */
export const AI_FORM_CONSENT_CHECKBOX_NODE_ID = 'marketingConsentCheckbox'

/** The name the consent Checkbox submits under, and the form's `consentFieldName`. */
export const AI_FORM_CONSENT_FIELD_NAME = MARKETING_CONSENT_FORM_FIELD.fieldName

/** What a ticked consent Checkbox posts: an affirmative value `isConsentCheckboxTicked` reads as the tick. */
export const AI_FORM_CONSENT_VALUE = 'Yes'

/**
 * The platform's marketing consent field as MUI's separate elements: a Choice
 * Label whose words say what the person agrees to — the Forms editor preset's
 * own option text — holding one unticked, unrequired Checkbox named
 * `marketingConsent`. Ids are fixed, so a re-asked design gets the same nodes.
 */
export function aiFormConsentNodes(formNodeId: string): NodesMap[string][] {
  const { choiceLabel, checkbox } = FORM_INPUT_ELEMENT_IDS
  return [
    {
      $id: AI_FORM_CONSENT_NODE_ID,
      type: NodeType.NODE,
      componentId: choiceLabel,
      pluginId: AI_PALETTE[choiceLabel]?.pluginId,
      parentId: formNodeId,
      nodes: [AI_FORM_CONSENT_CHECKBOX_NODE_ID],
      props: { label: MARKETING_CONSENT_FORM_FIELD.options },
    } as NodesMap[string],
    {
      $id: AI_FORM_CONSENT_CHECKBOX_NODE_ID,
      type: NodeType.NODE,
      componentId: checkbox,
      pluginId: AI_PALETTE[checkbox]?.pluginId,
      parentId: AI_FORM_CONSENT_NODE_ID,
      nodes: [],
      props: { name: AI_FORM_CONSENT_FIELD_NAME, value: AI_FORM_CONSENT_VALUE },
    } as NodesMap[string],
  ]
}

/**
 * The node to remove for a consent input the model drew: the input itself,
 * or the Choice Label and Form Control around it when they frame nothing but
 * consent — so no empty label or orphaned Form Label is left behind. The
 * all-in-one Form Field of an older design is its own frame.
 */
function consentWrapperId(nodes: NodesMap, inputId: string, formNodeId: string): string {
  const framing = new Set<string>([FORM_INPUT_ELEMENT_IDS.choiceLabel, FORM_INPUT_ELEMENT_IDS.formControl])
  let outer = inputId
  let parentId = String(nodes[inputId]?.parentId ?? '')
  while (parentId && parentId !== formNodeId) {
    const parent = nodes[parentId]
    if (!parent || !framing.has(String(parent.componentId))) break
    const answers = collectFormFieldNodeIds(nodes as never, parentId)
    if (!answers.every((id) => isMarketingConsentFieldName(formInputName(nodes[id] as never)))) break
    outer = parentId
    parentId = String(parent.parentId ?? '')
  }
  return outer
}

/** Removes a node and everything under it, and its id from its parent's children. */
function removeSubtree(nodes: NodesMap, id: string): void {
  const parent = nodes[String(nodes[id]?.parentId ?? '')]
  if (parent && Array.isArray(parent.nodes)) {
    parent.nodes = (parent.nodes as string[]).filter((child) => child !== id)
  }
  const stack = [id]
  while (stack.length) {
    const next = stack.pop() as string
    const node = nodes[next]
    if (!node) continue
    if (Array.isArray(node.nodes)) stack.push(...(node.nodes as string[]))
    delete nodes[next]
  }
}

/** The form step's own instructions, cached after the doctrine. */
export const AI_JOB_FORM_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      'You build one form for a website: the fields a visitor fills in and the button that sends them. Answer with submit_form: the whole form as one flat node map, how its submissions are routed, and what the brief asks for that a form cannot collect.',
      'The root is one Form (form) holding its fields in the order a visitor fills them in. Each piece of a field is its own element: a field is a Form Control (muiFormControl) holding a Form Label (muiFormLabel) whose text a visitor reads, then the answer, then optionally Helper Text (muiFormHelperText). Give the form a submitLabel and a successMessage in the site’s voice. The Form draws its own button, so a Button (muiButton) with type submit is optional.',
      'The answer is an Input (muiInput) to type in: type email for an email address, tel for a phone number, multiline true for a description; a Select (muiSelect) holding one Select Option (muiSelectOption) per choice, or a Radio Group (muiRadioGroup) holding one Choice Label (muiFormControlLabel) per choice, each holding a Radio (muiRadio) whose value is the choice, for one choice; a Choice Label holding a Checkbox (muiCheckbox) per choice, the Checkboxes sharing one name, for several; a Rating (muiRating) for a score; a Date Picker (muiDatePicker) for a day, such as a preferred date; and a Time Picker (muiTimePicker) for a time of day. A single yes-or-no tick is a Choice Label holding one Checkbox, outside any Form Control.',
      'A placeholder is optional: a short example of an answer, in the words a visitor would type. Never a note in square brackets such as [Phone number], and none where the label already says what to type.',
      'Every Input, Select, Radio Group, Checkbox, Rating, Date Picker and Time Picker has a name that is unique in the form, apart from Checkboxes of one question, and says what it holds in camelCase, such as fullName, email, phone or roofType; and required only when the form cannot do its job without it.',
      'A form collects text, choices, ratings, dates and times only. When the brief asks for something else, such as a file or photo upload, a signature or a payment, leave it out and name it in cannotCollect.',
      'Never draw a marketing consent, newsletter or subscribe checkbox: when the form asks for an email address, the platform adds its own.',
      'routing.kind is inbox when submissions only need to be read, lead when each one is a sales lead to follow up, and list when the people who send it should join an email list. routing.list is the list’s name only when the brief names one, and null otherwise.',
    ].join('\n'),
  },
]

const TREE_TOOL = aiDoctrineTreeTool('form')

/**
 * The doctrine's form tree tool, with the two things a design cannot say: the
 * routing it proposes and what the brief asked for that no field can collect.
 * Structured fields only, so the step writes every sentence a person reads.
 */
export const AI_JOB_FORM_TOOL: AiTool = {
  name: TREE_TOOL.name,
  description:
    'Submit the form as one flat node map, how its submissions are routed, and what the brief asks for that a form cannot collect.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['tree', 'routing', 'cannotCollect'],
    properties: {
      tree: (TREE_TOOL.inputSchema['properties'] as Record<string, unknown>)['tree'],
      routing: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'list'],
        properties: {
          kind: {
            type: 'string',
            enum: [...AI_FORM_ROUTING_KINDS],
            description:
              'inbox: submissions are read in the Inbox. lead: each submission with an email address is a sales lead. list: the people who send it should join an email list.',
          },
          list: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'The email list the brief names, as it names it; null when it names none.',
          },
        },
      },
      cannotCollect: {
        type: 'array',
        items: { type: 'string' },
        description:
          'What the brief asks the form to collect that its field types cannot, a few words each, such as "photo upload"; empty when there is nothing.',
      },
    },
  },
}

/** The routing and the gaps an answer proposes, read defensively. */
export interface AiFormAnswer {
  routing: { kind: AiFormRoutingKind; list: string | null }
  cannotCollect: string[]
}

/**
 * What the person already decided about this form, where they were asked
 * (AGL-2918).
 *
 * Only the guided start asks, so only a scaffold's form unit carries one.
 * Whether a submission is a note to read or a lead to chase is a fact about
 * how a business runs, not something readable off a brief, so an answer here
 * BINDS the routing instead of joining the evidence the model weighs: a
 * person who said "the Inbox" and got a form filing leads would have been
 * asked a question for nothing.
 */
export interface AiFormDecisions {
  /** Where submissions go; `null` where nobody was asked. */
  submissions: AiSiteSubmissions | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oneLine(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

/**
 * An answer's routing and gaps: an unknown kind is the Inbox, and the rest is
 * trimmed and capped. Where the person was asked where submissions go, their
 * answer replaces the model's proposal — the whole of the difference a
 * question makes.
 */
export function parseAiFormAnswer(
  answer: Record<string, unknown>,
  decisions: AiFormDecisions = { submissions: null },
): AiFormAnswer {
  const routing = isRecord(answer['routing']) ? answer['routing'] : {}
  const proposed = (AI_FORM_ROUTING_KINDS as readonly unknown[]).includes(routing['kind'])
    ? (routing['kind'] as AiFormRoutingKind)
    : 'inbox'
  const kind: AiFormRoutingKind = decisions.submissions ?? proposed
  const list = typeof routing['list'] === 'string' ? oneLine(routing['list'], LIST_NAME_MAX_CHARS) : ''
  const seen = new Set<string>()
  const cannotCollect: string[] = []
  for (const entry of Array.isArray(answer['cannotCollect']) ? answer['cannotCollect'] : []) {
    if (typeof entry !== 'string') continue
    const text = oneLine(entry, CANNOT_COLLECT_MAX_CHARS)
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    cannotCollect.push(text)
    if (cannotCollect.length === AI_FORM_CANNOT_COLLECT_MAX) break
  }
  return { routing: { kind, list: kind === 'list' && list ? list : null }, cannotCollect }
}

/** A generated form as its draft is written: the stamped design and what it declares. */
export interface AiFormDraft {
  /** The design as the Forms page's Create stores one: a canvas root above the bound form. */
  nodes: NodesMap
  rootId: string
  formNodeId: string
  fields: FormFieldDecl[]
  consentFieldName: string | null
  routing: FormRouting | null
  answer: AiFormAnswer
  /** The dataset its submissions are also written to, and what was bound (AGL-3616). */
  dataset?: { dataset: AiFormDataset; binding: AiFormDatasetBinding }
}

/** Text in square brackets: the marker a page's copy leaves for a fact the brief never gave (rule 14). */
const BRACKETED = /\[[^[\]\n]{1,80}\]/

/**
 * Whether a field's placeholder is a template's marker rather than a hint
 * (AGL-3942). A placeholder is the hint a visitor reads in an empty field,
 * never a fact the owner fills in: the beta.267 Copper Hollow Film &
 * Portrait contact form showed "[Phone number]" in its phone field, the
 * marker the site context asks copy to leave for a missing fact, and the
 * draft's note then asked the owner to replace it.
 */
export function aiFormPlaceholderIsMarker(placeholder: string): boolean {
  return BRACKETED.test(placeholder) || aiHasPlaceholderToken(placeholder)
}

/**
 * The props of a form's elements a visitor never reads (AGL-3988): a field's
 * name, an answer's value, an accessible name, the dataset's and the form's
 * own names. A marker in one is nothing the owner can find on the page, so
 * the draft's note never names it.
 */
const UNREAD_FORM_PROPS: readonly string[] = ['name', 'fieldName', 'ariaLabel', 'value', 'datasetName', 'formName']

/**
 * What a draft's note says the owner fills in before the form is published
 * (AGL-3056, AGL-3988): the facts in square brackets a visitor reads — a
 * label, a choice, a helper line, the button — and, said apart, those in the
 * message shown once a visitor sends it, which is on no page. The beta.270
 * Sugar Hollow form's note asked the owner to "replace the facts in square
 * brackets… [number]", and nothing on the site showed one. A marker in a
 * prop no visitor reads is never named. `null` when there is nothing to fill.
 */
export function aiFormBracketedFactsNote(
  tree: { rootId: string; nodes: NodesMap },
  inventory: Parameters<typeof aiBracketedFactsNote>[0]['inventory'],
): string | null {
  const read: Record<string, Record<string, unknown>> = {}
  const after: string[] = []
  for (const [id, node] of Object.entries(tree.nodes as unknown as Record<string, Record<string, unknown>>)) {
    const props = { ...((node['props'] as Record<string, unknown> | undefined) ?? {}) }
    for (const name of UNREAD_FORM_PROPS) delete props[name]
    if (typeof props['successMessage'] === 'string') {
      after.push(props['successMessage'] as string)
      delete props['successMessage']
    }
    read[id] = { ...node, props }
  }
  const shown = aiBracketedFactsNote({
    tree: { rootId: tree.rootId, nodes: read as unknown as AiDoctrineTree['nodes'] },
    inventory,
  })
  const listed = new Set((shown ?? '').toLowerCase().match(/\[[^\]]+\]/g) ?? [])
  const later = aiBracketedFacts(after).filter((fact) => !listed.has(fact.toLowerCase()))
  const message = later.length
    ? `The message a visitor sees after sending the form, the Form's Success message, holds ${later.length === 1 ? later[0] : `${later.slice(0, -1).join(', ')} and ${later[later.length - 1]}`}: replace ${later.length === 1 ? 'it' : 'them'} before you publish.`
    : null
  return [shown, message].filter(Boolean).join(' ') || null
}

/** Whether a choice of a list is a marker, which no visitor can pick as their answer (AGL-3988). */
const isMarkerChoice = (text: string) => BRACKETED.test(text) || aiHasPlaceholderToken(text)

/**
 * The draft a validated design and its answer make: the form node bound to
 * `formId` and captioned `name`, the platform's consent field when the
 * fields can yield an email address, the canvas root above, and the
 * declaration read off the result. A dataset binding is made only where the
 * plan said the form writes to one this step may bind (`identity.dataset`,
 * AGL-3616); any the model drew is dropped. Pure; the input tree is not
 * changed.
 */
export function aiFormDraft(
  tree: Pick<AiValidatedTree, 'rootId' | 'nodes'>,
  answer: Record<string, unknown>,
  identity: { formId: string; name: string; decisions?: AiFormDecisions; dataset?: AiFormDataset | null },
): AiFormDraft {
  const parsed = parseAiFormAnswer(answer, identity.decisions ?? { submissions: null })
  const formNodeId = tree.rootId
  const nodes: NodesMap = {}
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id] = {
      ...node,
      props: { ...(node.props ?? {}) },
      nodes: Array.isArray(node.nodes) ? [...(node.nodes as string[])] : [],
    }
    // A field's hint that is a marker shows nothing a visitor can use: its label says what to type.
    const props = nodes[id]?.props as Record<string, unknown>
    const placeholder = props['placeholder']
    if (typeof placeholder === 'string' && aiFormPlaceholderIsMarker(placeholder)) delete props['placeholder']
    // Nor is a choice that is a marker one a visitor can pick (AGL-3988).
    const options = props['options']
    if (typeof options === 'string' && isMarkerChoice(options)) {
      const kept = options.split(/\s*[;\n]\s*/).filter((choice) => choice && !isMarkerChoice(choice))
      props['options'] = kept.join('; ')
    }
  }
  // A list's option that is a marker goes, as its placeholder would (AGL-3988).
  for (const [id, node] of Object.entries(nodes)) {
    const label = (node?.props as Record<string, unknown> | undefined)?.['children']
    if (node?.componentId !== 'muiSelectOption' || typeof label !== 'string' || !isMarkerChoice(label)) continue
    for (const parent of Object.values(nodes)) {
      if (Array.isArray(parent?.nodes) && (parent.nodes as string[]).includes(id)) parent.nodes = (parent.nodes as string[]).filter((child) => child !== id)
    }
    delete nodes[id]
  }
  const form = nodes[formNodeId]
  let consentFieldName: string | null = null
  if (form?.componentId === FORM_COMPONENT_ID) {
    const props = form.props as Record<string, unknown>
    // A dataset binding decides where every submission is also written: the
    // plan's to say (AGL-3616), bound below, never the model's to draw.
    delete props['datasetId']
    delete props['datasetName']
    props[FORM_ID_PROP] = identity.formId
    props['formName'] = identity.name

    for (const id of collectFormFieldNodeIds(nodes as never, formNodeId)) {
      if (!nodes[id] || !isMarketingConsentFieldName(formInputName(nodes[id] as never))) continue
      removeSubtree(nodes, consentWrapperId(nodes, id, formNodeId))
    }
    if (formFieldsCanYieldAnEmail(formFieldDeclsFromNodes(nodes as never, formNodeId))) {
      for (const node of aiFormConsentNodes(formNodeId)) nodes[node.$id as string] = node
      form.nodes = [...(form.nodes as string[]), AI_FORM_CONSENT_NODE_ID]
      consentFieldName = AI_FORM_CONSENT_FIELD_NAME
    }
    form.parentId = CANVAS_ROOT_ELEMENT_ID
  }
  // The dataset the plan says the form writes to (AGL-3616), bound as the
  // Form element binds one.
  const dataset =
    identity.dataset && form?.componentId === FORM_COMPONENT_ID
      ? { dataset: identity.dataset, binding: aiBindFormToDataset(nodes, formNodeId, identity.dataset) }
      : undefined
  nodes[CANVAS_ROOT_ELEMENT_ID] = {
    $id: CANVAS_ROOT_ELEMENT_ID,
    componentId: 'div',
    nodes: [formNodeId],
  } as NodesMap[string]
  return {
    nodes,
    rootId: CANVAS_ROOT_ELEMENT_ID,
    formNodeId,
    fields: formFieldDeclsFromNodes(nodes as never, formNodeId),
    consentFieldName,
    routing: parsed.routing.kind === 'lead' ? { lead: true } : null,
    answer: parsed,
    ...(dataset ? { dataset } : {}),
  }
}

/**
 * What a draft would break once published, as building-rule violations
 * (rule 3: a form is built with its fields, validation, consent and routing
 * together): the form contract's findings, a form with no field, and a list
 * proposal on a form that asks for no email address. Offending nodes are
 * named by the ids the model wrote.
 */
export function aiFormDraftViolations(
  draft: AiFormDraft,
  formId: string,
  sourceIds: Readonly<Record<string, string>>,
): AiDoctrineViolation[] {
  const violations: AiDoctrineViolation[] = checkFormContract({
    form: {
      ...(draft.routing ? { routing: draft.routing } : {}),
      ...(draft.consentFieldName ? { consentFieldName: draft.consentFieldName } : {}),
    },
    formId,
    nodes: draft.nodes as never,
    formNodeId: draft.formNodeId,
  }).map((violation) => ({
    rule: 3 as const,
    code: violation.code,
    message: violation.message,
    ...(violation.nodeId ? { nodeIds: aiModelNodeIds([violation.nodeId], sourceIds) } : {}),
  }))
  if (!draft.fields.length) {
    violations.push({
      rule: 3,
      code: 'form-has-no-fields',
      message:
        'This form has no named fields, so a visitor has nothing to fill in. Draw the fields the brief asks for.',
    })
  }
  if (draft.answer.routing.kind === 'list' && !formFieldsCanYieldAnEmail(draft.fields)) {
    violations.push({
      rule: 3,
      code: 'list-routing-has-no-email-field',
      message:
        'This form proposes adding the people who send it to an email list, and it asks for no email address. Add an email field, or route its submissions to the Inbox.',
      paths: ['routing.kind'],
    })
  }
  return violations
}

/**
 * The door's check for `extend`, and the draft each admitted tree made: the
 * tree a generation returns is the object its last check saw, so the step
 * writes exactly the draft the contract passed.
 */
export function aiFormDraftCheck(identity: {
  formId: string
  name: string
  decisions?: AiFormDecisions
  dataset?: AiFormDataset | null
}): {
  extend: (tree: AiValidatedTree, answer: Record<string, unknown>) => AiDoctrineViolation[]
  draftFor: (tree: AiValidatedTree) => AiFormDraft | undefined
} {
  const drafts = new WeakMap<AiValidatedTree, AiFormDraft>()
  return {
    extend: (tree, answer) => {
      const draft = aiFormDraft(tree, answer, identity)
      drafts.set(tree, draft)
      return aiFormDraftViolations(draft, identity.formId, tree.sourceIds)
    },
    draftFor: (tree) => drafts.get(tree),
  }
}

/**
 * What a job says when the copy it asked for came back naming the form it
 * was copied FROM (AGL-3024). The contract's own sentence follows it and
 * names the consequence; this one names what to do about it.
 */
export const AI_FORM_COPY_UNBOUND_FAILURE =
  'The copy of that form did not take on an identity of its own, so it is on ' +
  'the site and not safe to collect with — delete it in Forms and try again.'

/**
 * Whether the copy the platform just wrote is bound to ITSELF, asked of the
 * document rather than of the answer — `null` when it is, and the sentence a
 * person reads when it is not.
 *
 * ## Why a step that generated nothing still has something to check
 *
 * A "creates X from a copy of Y" plan reaches no model: the copy IS the
 * output, so there is no answer for the doctrine to refuse and `extend`
 * never runs. That left the one thing a copy can get wrong unasked. A form's
 * design names its own form inside itself, and a copy that kept the source's
 * name files every submission under the source — the console's form page
 * banners exactly this, and the job reported Done beside it.
 *
 * So the check is `checkFormContract`, the SAME function the console's
 * banner and the promotion route ask, run here on the stored copy. Not a
 * second predicate shaped like it: a copy this one passed and that one
 * refused would be a form the job called finished and the console called
 * broken, which is the state this exists to make impossible.
 *
 * Narrowed to `form-id-unbound`, and only that, because it is the one
 * violation duplication CAUSES. Every other code the contract can report —
 * an unnamed field, a consent field the design lost — the copy inherited
 * from a form the site already has and the member chose to copy; refusing
 * those would be refusing to copy a form they can already see.
 */
export async function aiFormCopyUnboundFailure(
  firestore: FirebaseFirestore.Firestore,
  copy: { hostId: string; formId: string },
): Promise<string | null> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(copy.hostId)
    .collection('forms')
    .doc(copy.formId)
    .get()
  const form = (snapshot.data() ?? null) as Partial<FormDocument> | null
  const nodes = decodeStoredNodes(form?.nodes)
  const unbound = checkFormContract({
    form,
    formId: copy.formId,
    nodes: nodes as never,
    formNodeId: formNodeIdIn(nodes as never),
  }).find((violation) => violation.code === 'form-id-unbound')
  return unbound ? `${AI_FORM_COPY_UNBOUND_FAILURE} ${unbound.message}` : null
}

/**
 * The fields the confirmed plan gives the form, against the form a COPY
 * actually produced (AGL-3024); `null` when the copy keeps the plan, or when
 * the plan promised no field to keep.
 *
 * The fourth kind to need this, after the layout, the page and the component.
 * `aiFormCopyUnboundFailure` above already refuses the one violation
 * duplication CAUSES; this refuses the one duplication HIDES — a plan reading
 * "start from the consultation form and add a case-type question" getting the
 * consultation form and nothing else, reported as built.
 *
 * A field the plan names is matched on its name alone: a copy that collects
 * the answer under a different label is still collecting it, and this check
 * has no way to tell a renamed field from a missing one without guessing.
 */
export async function aiCopiedFormReview(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; formId: string; name: string; plan: AiJobPlan | null },
): Promise<AiJobReview | null> {
  const promised = (aiPlanCreation(input.plan, 'form')?.fields ?? [])
    .map((field) => field.split(':')[0]?.trim().toLowerCase())
    .filter((field): field is string => Boolean(field))
  if (!promised.length) return null
  const snapshot = await firestore
    .collection('hosts')
    .doc(input.hostId)
    .collection('forms')
    .doc(input.formId)
    .get()
  if (!snapshot.exists) {
    return {
      reason: 'doctrine',
      message: `"${input.name}" was copied from the form the plan names, and this job could not read the copy back to check it collects what the plan gives it. Open the form and check it before you put it on a page.`,
      findings: [],
    }
  }
  const fields = (snapshot.get('fields') ?? []) as unknown[]
  const collected = new Set(
    fields
      .map((field) =>
        field && typeof field === 'object'
          ? String((field as Record<string, unknown>)['fieldName'] ?? (field as Record<string, unknown>)['name'] ?? '')
          : '',
      )
      .filter(Boolean)
      .map((name) => name.toLowerCase()),
  )
  const missing = promised.filter((name) => !collected.has(name))
  if (!missing.length) return null
  const one = missing.length === 1
  return aiDoctrineReview({
    message: `"${input.name}" is a copy of the form the plan names, and a copy is all it is: the plan gives it ${
      one ? 'a field' : 'fields'
    } the copy does not collect.`,
    violations: [
      {
        rule: null,
        code: 'plan-fields-missing',
        message: `The confirmed plan says this form collects ${missing.join(', ')}, and the copy collects ${
          collected.size ? [...collected].join(', ') : 'nothing'
        }. Add ${one ? 'it' : 'each of them'}, or the copy is the form it was copied from.`,
      },
    ],
  })
}

/**
 * What the form a short copy would have started from collects, as the build
 * that replaces the copy is told it (AGL-3143 §14): every field it asks for,
 * so the build keeps them beside what the plan adds. Empty when the form
 * cannot be read.
 */
export async function aiFormSourceLines(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; id: string; name: string },
): Promise<string[]> {
  const snapshot = await firestore.collection('hosts').doc(input.hostId).collection('forms').doc(input.id).get()
  const fields = snapshot.exists ? ((snapshot.get('fields') ?? []) as unknown[]) : []
  const asked = fields.flatMap((field) => {
    if (!field || typeof field !== 'object') return []
    const row = field as Record<string, unknown>
    const name = String(row['fieldName'] ?? row['name'] ?? '').trim()
    if (!name) return []
    const fieldType = row['fieldType'] ?? row['type']
    const type = typeof fieldType === 'string' ? ` (${fieldType}${row['required'] ? ', required' : ''})` : ''
    return [`${name}${type}`]
  })
  if (!asked.length) return []
  return [
    `The plan starts from a copy of the form "${input.name}", which lacks part of what the plan gives it. Build from it: it collects ${asked.join(', ')}. Keep each of those, and add what the plan adds.`,
  ]
}

function listOf(items: readonly string[]): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * What the person decides next, in words the step writes itself: a lead
 * routing to keep or switch off, the list a proposal could not store, and what
 * the brief asked for that a form cannot collect. `null` when there is none.
 */
export function aiFormOutputNote(answer: AiFormAnswer): string | null {
  const sentences: string[] = []
  if (answer.routing.kind === 'lead') {
    sentences.push(
      'Each submission with an email address also files a lead in CRM → Leads; you can switch that off on the form’s page.',
    )
  }
  if (answer.routing.kind === 'list') {
    const list = answer.routing.list ? `your "${answer.routing.list}" list` : 'an email list'
    sentences.push(
      `Submissions arrive in the Inbox. To add the people who tick "${MARKETING_CONSENT_FORM_FIELD.options}" to ${list}, add an action on form submissions in Automation that enrolls them.`,
    )
  }
  if (answer.cannotCollect.length) {
    sentences.push(
      `Forms cannot collect ${listOf(answer.cannotCollect)} yet, so this form leaves ${
        answer.cannotCollect.length === 1 ? 'it' : 'them'
      } out.`,
    )
  }
  return sentences.length ? sentences.join(' ') : null
}

/**
 * The form job as the generation's user turn: the name, who fills the form
 * in, the brief, and the confirmed plan.
 *
 * Who the form is for (AGL-2918) is the answer a contact form's FIELDS turn
 * on — a trades business asks where the work is, a practice asks what the
 * appointment is about — and it is not something a brief about a whole site
 * says in a place the form can find. It rides here, in the turn, because it
 * is one site's own words.
 *
 * Where submissions go rides here too, and it is NOT a hint: the step binds
 * the routing to it whatever the model answers. It is stated so the model
 * does not spend its answer proposing something that will be replaced, and
 * so a form told its submissions are leads asks for the address that makes
 * one.
 */
export function aiJobFormPrompt(
  job: Pick<AiJob, 'brief'>,
  plan: AiJobPlan | null,
  name: string,
  context: { audience?: string; submissions?: AiSiteSubmissions | null } = {},
): string {
  const audience = (context.audience ?? '').trim()
  return [
    `Form name: ${name}`,
    audience ? `The people who fill it in: ${audience}` : '',
    context.submissions ? `Where its submissions go: ${SUBMISSION_WORDS[context.submissions]}` : '',
    aiJobBriefLine(job),
    ...aiPlanReferenceLines(plan),
  ]
    .filter(Boolean)
    .join('\n')
}

/** What each decided routing is, said to the model the way the tool says it. */
const SUBMISSION_WORDS: Record<AiSiteSubmissions, string> = {
  inbox: 'the Inbox, to be read — routing.kind is inbox',
  lead: 'the Inbox, and each one with an email address is a sales lead — routing.kind is lead',
}

/**
 * A form job is admitted for a site of the job's own org whose plan has
 * forms, with a form to spare, and confirmed only for a plan that creates
 * nothing but the form: a form places nothing another job builds
 * (AGL-3143 §15).
 */
export const aiFormJobAdmission: AiJobAdmission = (context) =>
  aiDraftAdmissionRefusal(context.firestore, {
    orgId: context.orgId,
    hostId: context.hostId,
    kind: 'form',
    org: context.org,
    ownCheck: (hostId) => aiJobPlanCreationsRefusal('form', context, hostId),
  })

/**
 * What a form step says when the site's last form was taken after its plan
 * was confirmed (AGL-3765): by another build running beside it, or by a
 * member. The failure is ours, so what the job spent is given back.
 */
export const AI_FORM_BAND_TAKEN_COPY =
  'Another build on this site used the last form your plan includes while this one was running, so this one stopped. Describe it again to build it with the form the site has now.'

export interface AiJobFormStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The platform's duplicate module, for a plan that starts from a copy. */
  duplicate?: typeof duplicateResource
  /** The data plugin's writer lookup the form's dataset is read through (AGL-3616); specs hand in a fake. */
  datasetWriterFor?: AiFormDatasetReadDeps['writerFor']
  /** The form another build just made that a refused unit places (AGL-3765); specs hand in a fake. */
  siblingForm?: typeof aiSiblingJobForm
}

export function createAiJobFormStep(deps: AiJobFormStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const duplicate = deps.duplicate ?? duplicateResource
  const siblingForm = deps.siblingForm ?? aiSiblingJobForm
  return async ({ job, now, signal, firestore, modelFor }) => {
    const hostId = job.hostId
    if (!hostId) throw new Error('a form job names no site, and its admission refuses one')
    const output = (
      draft: AiDraftRecord,
      extra: { load?: AiLoadEstimate | null; note?: string | null } = {},
    ): AiJobOutput => ({
      resource: 'form',
      id: draft.id,
      versionId: draft.versionId,
      hostId,
      hostSubdomain: draft.hostSubdomain,
      label: draft.name,
      ...(extra.load ? { load: extra.load } : {}),
      ...(extra.note ? { note: extra.note } : {}),
    })
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.form') ?? aiModelForStep('job.form')

    // A run cut off after its draft was written reports that draft, found by the id the job recorded.
    const draftId = aiJobDraftId(job, 'form')
    const written = await readAiDraft(firestore, { kind: 'form', hostId, id: draftId })
    if (written) return aiUnspentOutcome(model, { outputs: [output(written)] })

    const [inventory, orgSnapshot] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      firestore.collection('orgs').doc(job.orgId).get(),
    ])
    const org = (orgSnapshot.data() ?? null) as Partial<AglynOrgBilling> | null
    const plan = aiConfirmedPlan(job)
    const creation = aiPlanCreation(plan, 'form')
    const name = creation?.name || AI_JOB_FORM_DEFAULT_NAME
    // The site holds every form its plan includes (AGL-3765). A unit places a
    // form another build on this site just made, as its page would place any
    // form the site has. Otherwise a site that had room when the plan was
    // confirmed and was filled since stopped this job on our side, given
    // back; one that was already full is the workspace's limit to change. A
    // lookup that fails leaves the refusal as it was.
    const refused = async (
      refusal: string,
      spent: Pick<AiJobStepOutcome, 'outputs' | 'usage' | 'estCostUsd' | 'model' | 'stopReason'>,
    ): Promise<AiJobStepOutcome> => {
      const lookup = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await read()
        } catch (error) {
          console.error('ai form step: band refusal lookup failed', { jobId: job.$id, hostId, error })
          return fallback
        }
      }
      const reused = await lookup(() => siblingForm(firestore, { job, now }), null)
      if (reused) return { ...spent, outputs: [output(reused, { note: AI_FORM_REUSED_NOTE })] }
      const taken = await lookup(
        () => readAiDraftBandTakenSince(firestore, { kind: 'form', hostId, org, since: plan?.confirmedAt }),
        false,
      )
      if (taken) return { ...spent, failure: AI_FORM_BAND_TAKEN_COPY }
      return { ...spent, review: aiLimitReview(refusal) }
    }

    // The plan starts from a copy of a form the site has (rule 15): the copy
    // is the draft, and nothing is generated. A source gone since the plan
    // was made is built from the brief instead, and one that does not collect
    // a field the plan gives the form is built from the plan, told what the
    // source collects (AGL-3143 §14): copying it could only end in the review
    // below. A source this step cannot read still copies.
    const source = creation?.duplicateOf
      ? inventory.forms.find((form) => form.id === creation.duplicateOf)
      : undefined
    const sourceReview = source
      ? await aiCopiedFormReview(firestore, { hostId, formId: source.id, name: source.name, plan })
      : null
    const sourceShort = Boolean(sourceReview?.findings.length)
    const sourceLines =
      source && sourceShort ? await aiFormSourceLines(firestore, { hostId, id: source.id, name: source.name }) : []
    if (creation?.duplicateOf && source && !sourceShort) {
      const copy = await duplicate('form', {
        orgId: job.orgId,
        hostId,
        sourceId: creation.duplicateOf,
        name,
        uid: job.createdBy,
        org: org as Record<string, unknown> | null,
        // The same claim the page step makes (AGL-3024): a copy core mints is
        // written under core's own id, never `draftId`, so a step that runs
        // again — a pass resumed, a run cut off after the copy — would mint a
        // second. The job's recorded id makes core replay the one it made.
        attemptKey: draftId,
      })
      if (copy.ok) {
        // The copy is the whole output, so the contract is asked of it here
        // or nowhere: a copy still bound to its source is not a form this
        // job may report as built (AGL-3024).
        const unbound = await aiFormCopyUnboundFailure(firestore, { hostId, formId: copy.id })
        if (unbound) return { ...aiUnspentOutcome(model), failure: unbound }
        const hostSubdomain = await aiSiteSubdomain(firestore, hostId)
        // And the one duplication hides: what the plan promised of the copy,
        // read back (AGL-3024). This branch generates nothing, so nothing
        // else can answer for it.
        const review = await aiCopiedFormReview(firestore, {
          hostId,
          formId: copy.id,
          name: copy.name,
          plan,
        })
        if (review) return aiUnspentOutcome(model, { review })
        return aiUnspentOutcome(model, {
          outputs: [output({ id: copy.id, versionId: copy.versionId, name: copy.name, hostSubdomain })],
        })
      }
      if (copy.ok === false && copy.status === 403) {
        return refused(copy.error, aiUnspentOutcome(model))
      }
    }

    const allowance = await aiDraftAllowanceRefusal(firestore, { kind: 'form', hostId, org })
    if (allowance) return refused(allowance, aiUnspentOutcome(model))

    // What the person answered about this form, where they were asked
    // (AGL-2918): a scaffold's form unit carries the guided start's inputs.
    const decisions: AiFormDecisions = { submissions: aiSiteSubmissions(job.inputs) }
    const { audience } = aiSiteWords(job.inputs)
    // The dataset the plan says the form writes to (AGL-3616), where this
    // workspace may bind one; otherwise the form is the form it always was.
    const dataset = await aiReadFormDataset(
      {
        hostId,
        id: creation?.writesTo,
        org,
        inventory,
        madeId: job.inputs?.[AI_FORM_DATASET_MADE_INPUT],
      },
      deps.datasetWriterFor ? { writerFor: deps.datasetWriterFor } : {},
    )
    const check = aiFormDraftCheck({ formId: draftId, name, decisions, dataset })
    const result = await runValidatedGeneration('form', {
      step: 'job.form',
      model,
      instructions: AI_JOB_FORM_INSTRUCTIONS,
      inventory,
      messages: [
        {
          role: 'user',
          content: [
            aiJobFormPrompt(job, plan, name, {
              audience,
              submissions: decisions.submissions,
            }),
            ...sourceLines,
            ...(dataset ? [aiFormDatasetPromptLine(dataset)] : []),
          ].join('\n'),
        },
      ],
      tool: AI_JOB_FORM_TOOL,
      maxTokens: AI_JOB_FORM_STEP_BUDGET.maxTokens(model),
      thinking: 'off',
      extend: check.extend,
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }

    const draft = check.draftFor(result.value)
    if (!draft) throw new Error('a form the doctrine admitted has no draft from its check')
    // Never written once the job is canceled (AGL-3616).
    throwIfAiJobCanceled(signal)
    const write = await writeAiDraft(firestore, {
      kind: 'form',
      hostId,
      id: draftId,
      uid: job.createdBy,
      org,
      name,
      nodes: draft.nodes,
      form: {
        rootId: draft.rootId,
        formNodeId: draft.formNodeId,
        fields: draft.fields,
        consentFieldName: draft.consentFieldName,
        routing: draft.routing,
      },
      now,
    })
    if (write.ok === false) {
      if (write.status === 404) throw new Error(`site ${hostId} vanished while its form was generated`)
      return refused(write.error, spent)
    }
    // What the person decides next, then the facts the brief did not give (AGL-3056).
    const note = [
      aiFormOutputNote(draft.answer),
      draft.dataset ? aiFormDatasetNote(draft.dataset.dataset, draft.dataset.binding) : null,
      // Read off the draft as written, so a marker it never shows is never listed (AGL-3988).
      aiFormBracketedFactsNote({ rootId: draft.rootId, nodes: draft.nodes }, inventory),
    ]
      .filter(Boolean)
      .join(' ')
    return {
      ...spent,
      outputs: [output(write, { load: result.value.load, note })],
    }
  }
}

export const runAiJobFormStep = createAiJobFormStep()

/** Registers the form step and the check a form job passes before it is created or resumed. */
export function registerAiFormJob(): void {
  registerAiJobStep('form', runAiJobFormStep, { minimumMs: AI_JOB_FORM_STEP_MINIMUM_MS })
  registerAiJobAdmission('form', aiFormJobAdmission)
}
