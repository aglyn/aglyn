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
  checkFormContract,
  formFieldsCanYieldAnEmail,
} from '@aglyn/aglyn/app-utils/form-contract'
import {
  collectFormFieldNodeIds,
  FORM_COMPONENT_ID,
  FORM_FIELD_COMPONENT_ID,
  FORM_ID_PROP,
  formFieldDeclsFromNodes,
  isMarketingConsentFieldName,
  MARKETING_CONSENT_FORM_FIELD,
  type FormFieldDecl,
  type FormRouting,
} from '@aglyn/aglyn/app-utils/forms'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { NodeType, type NodesMap } from '@aglyn/aglyn/types/nodes'
import { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { aiModelForStep } from '../providers/routing'
import {
  AI_GENERATION_MAX_TOKENS,
  aiDoctrineTreeTool,
  runValidatedGeneration,
  type AiValidatedTree,
} from '../runtime/ai-doctrine'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import type { AiSystemBlock, AiTool } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
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
  aiPlanCreation,
  aiPlanReferenceLines,
  aiUnspentOutcome,
} from './ai-job-generation'
import type { AiJobStepRunner } from './ai-job-text-step'
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
 *    consent field (`MARKETING_CONSENT_FORM_FIELD`, the Forms editor preset's own
 *    props) in place of any consent-like field the model drew, named as its
 *    `consentFieldName`;
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
 * that copy, through the platform's duplicate module, and nothing generated.
 *
 * Like the other generation steps, it has the job beat's budget for one step,
 * its re-ask included, so it runs without extended thinking under the
 * doctrine's answer ceiling for a form.
 */

/** The longest answer a form may run to: the doctrine's ceiling for the form kind. */
export const AI_JOB_FORM_MAX_TOKENS = AI_GENERATION_MAX_TOKENS.form

/** A form's name when the plan names none. */
export const AI_JOB_FORM_DEFAULT_NAME = 'New form'

/** Where a proposal routes a form's submissions. */
export const AI_FORM_ROUTING_KINDS = ['inbox', 'list', 'lead'] as const

export type AiFormRoutingKind = (typeof AI_FORM_ROUTING_KINDS)[number]

/** The most things a note says the brief asked for and a form cannot collect. */
export const AI_FORM_CANNOT_COLLECT_MAX = 3

const CANNOT_COLLECT_MAX_CHARS = 60
const LIST_NAME_MAX_CHARS = 80

/** The node id the platform's consent field takes in a generated design. */
export const AI_FORM_CONSENT_NODE_ID = 'marketingConsentField'

/** The form step's own instructions, cached after the doctrine. */
export const AI_JOB_FORM_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      'You build one form for a website: the fields a visitor fills in and the button that sends them. Answer with submit_form: the whole form as one flat node map, how its submissions are routed, and what the brief asks for that a form cannot collect.',
      'The root is one Form (form) holding its Form Fields (formField) in the order a visitor fills them in. Give the form a submitLabel and a successMessage in the site’s voice.',
      'Every field has a fieldName that is unique in the form and says what it holds in camelCase, such as fullName, email, phone or roofType; a label a visitor reads; and required only when the form cannot do its job without it. Use fieldType email for an email address, textarea for a description, select or radio with options for one choice, checkbox with options for several, and rating for a score. Put each option on its own line and never put a comma inside an option, because a comma starts a new one.',
      'A form collects text, choices and ratings only. When the brief asks for something else, such as a file or photo upload, a signature or a payment, leave it out and name it in cannotCollect.',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oneLine(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

/** An answer's routing and gaps: an unknown kind is the Inbox, and the rest is trimmed and capped. */
export function parseAiFormAnswer(answer: Record<string, unknown>): AiFormAnswer {
  const routing = isRecord(answer['routing']) ? answer['routing'] : {}
  const kind = (AI_FORM_ROUTING_KINDS as readonly unknown[]).includes(routing['kind'])
    ? (routing['kind'] as AiFormRoutingKind)
    : 'inbox'
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
}

/**
 * The draft a validated design and its answer make: the form node bound to
 * `formId` and captioned `name`, no dataset binding, the platform's consent
 * field when the fields can yield an email address, the canvas root above,
 * and the declaration read off the result. Pure; the input tree is not
 * changed.
 */
export function aiFormDraft(
  tree: Pick<AiValidatedTree, 'rootId' | 'nodes'>,
  answer: Record<string, unknown>,
  identity: { formId: string; name: string },
): AiFormDraft {
  const parsed = parseAiFormAnswer(answer)
  const formNodeId = tree.rootId
  const nodes: NodesMap = {}
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id] = {
      ...node,
      props: { ...(node.props ?? {}) },
      nodes: Array.isArray(node.nodes) ? [...(node.nodes as string[])] : [],
    }
  }
  const form = nodes[formNodeId]
  let consentFieldName: string | null = null
  if (form?.componentId === FORM_COMPONENT_ID) {
    const props = form.props as Record<string, unknown>
    // A dataset binding decides where every submission is also written; it
    // stays the person's choice, made on the Form element.
    delete props['datasetId']
    delete props['datasetName']
    props[FORM_ID_PROP] = identity.formId
    props['formName'] = identity.name

    for (const id of collectFormFieldNodeIds(nodes as never, formNodeId)) {
      const fieldName = (nodes[id]?.props as Record<string, unknown> | undefined)?.['fieldName']
      if (!isMarketingConsentFieldName(fieldName)) continue
      const parent = nodes[String(nodes[id]?.parentId ?? '')]
      if (parent && Array.isArray(parent.nodes)) {
        parent.nodes = (parent.nodes as string[]).filter((child) => child !== id)
      }
      delete nodes[id]
    }
    if (formFieldsCanYieldAnEmail(formFieldDeclsFromNodes(nodes as never, formNodeId))) {
      nodes[AI_FORM_CONSENT_NODE_ID] = {
        $id: AI_FORM_CONSENT_NODE_ID,
        type: NodeType.NODE,
        componentId: FORM_FIELD_COMPONENT_ID,
        pluginId: AI_PALETTE[FORM_FIELD_COMPONENT_ID]?.pluginId,
        parentId: formNodeId,
        nodes: [],
        props: { ...MARKETING_CONSENT_FORM_FIELD },
      } as NodesMap[string]
      form.nodes = [...(form.nodes as string[]), AI_FORM_CONSENT_NODE_ID]
      consentFieldName = MARKETING_CONSENT_FORM_FIELD.fieldName
    }
    form.parentId = CANVAS_ROOT_ELEMENT_ID
  }
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
export function aiFormDraftCheck(identity: { formId: string; name: string }): {
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
      `Submissions arrive in the Inbox. To add the people who tick "${MARKETING_CONSENT_FORM_FIELD.label}" to ${list}, add an action on form submissions in Automation that enrolls them.`,
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

/** The form job as the generation's user turn: the name, the brief, the confirmed plan. */
export function aiJobFormPrompt(
  job: Pick<AiJob, 'brief'>,
  plan: AiJobPlan | null,
  name: string,
): string {
  return [`Form name: ${name}`, aiJobBriefLine(job), ...aiPlanReferenceLines(plan)].join('\n')
}

/** A form job is admitted for a site of the job's own org whose plan has forms, with a form to spare. */
export const aiFormJobAdmission: AiJobAdmission = (context) =>
  aiDraftAdmissionRefusal(context.firestore, {
    orgId: context.orgId,
    hostId: context.hostId,
    kind: 'form',
    org: context.org,
  })

export interface AiJobFormStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The platform's duplicate module, for a plan that starts from a copy. */
  duplicate?: typeof duplicateResource
}

export function createAiJobFormStep(deps: AiJobFormStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const duplicate = deps.duplicate ?? duplicateResource
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

    // A run cut off after its draft was written reports that draft.
    const written = await readAiDraft(firestore, { kind: 'form', hostId, id: job.$id })
    if (written) return aiUnspentOutcome(model, { outputs: [output(written)] })

    const [inventory, orgSnapshot] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      firestore.collection('orgs').doc(job.orgId).get(),
    ])
    const org = (orgSnapshot.data() ?? null) as Partial<AglynOrgBilling> | null
    const plan = aiConfirmedPlan(job)
    const creation = aiPlanCreation(plan, 'form')
    const name = creation?.name || AI_JOB_FORM_DEFAULT_NAME

    // The plan starts from a copy of a form the site has (rule 15): the copy
    // is the draft, and nothing is generated. A source gone since the plan
    // was made is built from the brief instead.
    if (creation?.duplicateOf && inventory.forms.some((form) => form.id === creation.duplicateOf)) {
      const copy = await duplicate('form', {
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
          outputs: [output({ id: copy.id, versionId: copy.versionId, name: copy.name, hostSubdomain })],
        })
      }
      if (copy.ok === false && copy.status === 403) {
        return aiUnspentOutcome(model, { review: aiLimitReview(copy.error) })
      }
    }

    const allowance = await aiDraftAllowanceRefusal(firestore, { kind: 'form', hostId, org })
    if (allowance) return aiUnspentOutcome(model, { review: aiLimitReview(allowance) })

    const check = aiFormDraftCheck({ formId: job.$id, name })
    const result = await runValidatedGeneration('form', {
      step: 'job.form',
      model,
      instructions: AI_JOB_FORM_INSTRUCTIONS,
      inventory,
      messages: [{ role: 'user', content: aiJobFormPrompt(job, plan, name) }],
      tool: AI_JOB_FORM_TOOL,
      maxTokens: AI_JOB_FORM_MAX_TOKENS,
      thinking: 'off',
      extend: check.extend,
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }

    const draft = check.draftFor(result.value)
    if (!draft) throw new Error('a form the doctrine admitted has no draft from its check')
    const write = await writeAiDraft(firestore, {
      kind: 'form',
      hostId,
      id: job.$id,
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
      return { ...spent, review: aiLimitReview(write.error) }
    }
    return {
      ...spent,
      outputs: [output(write, { load: result.value.load, note: aiFormOutputNote(draft.answer) })],
    }
  }
}

export const runAiJobFormStep = createAiJobFormStep()

/** Registers the form step and the check a form job passes before it is created or resumed. */
export function registerAiFormJob(): void {
  registerAiJobStep('form', runAiJobFormStep)
  registerAiJobAdmission('form', aiFormJobAdmission)
}
