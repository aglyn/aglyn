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
  ACTION_MAX_CONDITIONS,
  ACTION_MAX_STEPS,
  CONTACT_TAG_MAX_LENGTH,
  FLOW_TIMED_OUT_FIELD,
  FLOW_WAIT_MAX_MINUTES,
  FLOW_WAIT_MIN_MINUTES,
  HOST_ACTION_STEP_LABELS,
  TRIGGER_COMBINATORS,
  TRIGGER_CONDITION_OPS,
  type TriggerCombinator,
  type TriggerConditionOp,
} from '@aglyn/aglyn/app-utils/actions'
import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  CRM_ACTIVITY_KINDS,
  CRM_TASK_KINDS,
  CRM_TASK_MAX_DUE_DAYS,
  type ContactLifecycleStage,
  type CrmActivityKind,
  type CrmTaskKind,
} from '@aglyn/aglyn/app-utils/crm'
import {
  HOST_EVENT_PAYLOAD_KEYS,
  HOST_EVENT_TYPES,
  type HostEventType,
} from '@aglyn/aglyn/app-utils/workflows'
import {
  AI_AUTOMATION_NEED_LABELS,
  AI_AUTOMATION_STEP_NEEDS,
  AI_AUTOMATION_STEP_TYPES,
  AI_AUTOMATION_TRIGGER_NEEDS,
  AI_AUTOMATION_UNSUPPORTED,
  AI_AUTOMATION_UNSUPPORTED_NEED,
  aiAutomationTriggerLabel,
  type AiAutomationCapabilities,
  type AiAutomationStepType,
  type AiAutomationUnsupported,
} from '../model/ai-workflow-job'
import type { AiTool } from '../providers/contract'
import type { AiGenerationCheckResult } from '../runtime/ai-doctrine'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import { HOSTILE_TEXT } from '../runtime/ai-node-tree'

/**
 * The two tools a `workflow` job answers through (AGL-2919).
 *
 * `submit_automation` carries one automation in the Actions editor's own
 * vocabulary — a trigger from the host events, conditions over the fields the
 * trigger carries, and steps from the automation step types — with every
 * record it names written as WORDS. The step resolves those words against the
 * site after the answer, so the model is never shown the site's lists,
 * campaigns, workflows, webhooks or pipeline stages, and never writes an id it
 * could only have invented.
 *
 * `submit_explanation` carries a plain-words account of one automation, or of
 * why one of its runs failed.
 *
 * Both schemas are strict: every object forbids extra keys and requires every
 * key it has, and nothing in either is a `null`. Where a step may go without
 * something, the absence is an empty list or an empty string: a step that
 * always runs has an empty `when`, a notEmpty condition compares against
 * nothing, and an answer that builds an automation leaves `unsupported`
 * empty. Bounds a strict schema cannot state are stated in the descriptions
 * and held by the readers below, whose refusals name the field so the one
 * re-ask can fix it.
 *
 * A provider that constrains decoding compiles every strict schema of a
 * request into a grammar, and refuses one whose grammar grows past its size
 * (`AiToolSchemaLimits`). So the steps' union carries as little repetition as
 * a grammar can be made to hold:
 *
 *  - a step is its guard and its action, `{ when, action }`, so the condition
 *    is compiled once for the whole union instead of once per variant;
 *  - a variant serves every step type that carries the same fields, named for
 *    what they hold: the six steps that name a record share `reference`, and
 *    the three that carry one line share `text`;
 *  - every field stays required and every vocabulary stays an enum, so the
 *    model is still decoded into the Actions editor's words.
 *
 * Ten variants carry all seventeen step types, and the reader below maps the
 * shared fields back onto the step's own key.
 */

export const AI_AUTOMATION_TOOL_NAME = 'submit_automation'
export const AI_WORKFLOW_EXPLANATION_TOOL_NAME = 'submit_explanation'

/** The longest automation name the Actions editor stores. */
export const AI_AUTOMATION_NAME_MAX_CHARS = 60
/** The longest subject the executor sends. */
export const AI_AUTOMATION_SUBJECT_MAX_CHARS = 200
/** The longest email text the executor sends. */
export const AI_AUTOMATION_BODY_MAX_CHARS = 5_000
/** The longest title, message or record name a step carries. */
export const AI_AUTOMATION_TEXT_MAX_CHARS = 300
/** The longest words naming a record. */
export const AI_AUTOMATION_REFERENCE_MAX_CHARS = 100
/** The longest condition value. */
export const AI_AUTOMATION_VALUE_MAX_CHARS = 200
/** The most notes an answer keeps, and the longest. */
export const AI_AUTOMATION_NOTES_MAX = 3
export const AI_AUTOMATION_NOTE_MAX_CHARS = 300
/**
 * The longest a whole answer may be, written out as JSON: what the routing
 * ceiling for `job.workflow` holds at three characters a token with as much
 * again to think in (`ai-job-workflow-step.spec.ts` measures it). Ten steps
 * with two emails of a paragraph or two each come to about 2,400, each step
 * carrying only its own fields.
 */
export const AI_AUTOMATION_ANSWER_MAX_CHARS = 6_000

/** The explanation's bounds. */
export const AI_WORKFLOW_SUMMARY_MAX_CHARS = 400
export const AI_WORKFLOW_POINTS_MAX = 8
export const AI_WORKFLOW_SUGGESTIONS_MAX = 4
export const AI_WORKFLOW_LINE_MAX_CHARS = 300

const SEVERITIES = ['info', 'success', 'warning', 'error'] as const
type Severity = (typeof SEVERITIES)[number]

type Schema = Record<string, unknown>

/**
 * What the schema defines once and refers to where it is used: a condition,
 * which the trigger and every step's guard share, and the guard itself.
 */
const DEFINITIONS: Schema = {
  condition: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'op', 'value'],
    properties: {
      field: {
        type: 'string',
        description: 'The field of the event the condition reads, as the trigger lists its fields.',
      },
      op: { type: 'string', enum: [...TRIGGER_CONDITION_OPS] },
      value: {
        type: 'string',
        description: 'What equals or contains compares against; empty for notEmpty.',
      },
    },
  },
  event: {
    type: 'string',
    enum: [...HOST_EVENT_TYPES],
    description: 'One of the things that happen on a site.',
  },
  // A list rather than a condition or `null`: a step goes without one by an
  // empty list, which costs no union.
  when: {
    type: 'array',
    description: 'At most one condition: the step runs only when it holds. Empty when the step always runs.',
    items: { $ref: '#/$defs/condition' },
  },
}

/** The steps that name one of the site's records, which they all name the same way. */
const REFERENCE_STEPS = [
  'enrollList',
  'assignCampaign',
  'runWorkflow',
  'datasetAppend',
  'updateDataset',
  'webhookPost',
] as const satisfies readonly AiAutomationStepType[]

/** The steps whose only field is the one line they carry. */
const TEXT_STEPS = [
  'notifyAdmins',
  'addContactTag',
  'assignContactOwner',
] as const satisfies readonly AiAutomationStepType[]

/** The key each `reference` step fills in the answer the reader gives back. */
const REFERENCE_KEY = {
  enrollList: 'list',
  assignCampaign: 'campaign',
  runWorkflow: 'workflow',
  datasetAppend: 'dataset',
  updateDataset: 'dataset',
  webhookPost: 'webhook',
} as const satisfies Readonly<Record<(typeof REFERENCE_STEPS)[number], keyof AiAutomationAnswerStep>>

/**
 * The key each step's one line fills in the answer the reader gives back. Six
 * step types carry one line between them, so the schema asks for all six
 * under `text` and the reader puts each back where the automation keeps it.
 */
const TEXT_KEY = {
  notifyAdmins: 'title',
  addContactTag: 'tag',
  assignContactOwner: 'owner',
  siteAlert: 'message',
  createCrmTask: 'title',
  logCrmActivity: 'body',
} as const satisfies Readonly<Partial<Record<AiAutomationStepType, keyof AiAutomationAnswerStep>>>

const minutes = (what: string): Schema => ({
  type: 'integer',
  description: `${what}, in whole minutes from ${FLOW_WAIT_MIN_MINUTES} to ${FLOW_WAIT_MAX_MINUTES}; an hour is 60 and a day 1440.`,
})

/**
 * One variant of the steps' union: the step types it serves, and the fields
 * every one of them carries, each required and never nullable. A type belongs
 * to exactly one variant, so the type a step names settles which fields it
 * writes.
 */
function stepVariant(
  types: readonly AiAutomationStepType[],
  fields: Readonly<Record<string, Schema>>,
): Schema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', ...Object.keys(fields)],
    properties: { type: { type: 'string', enum: [...types] }, ...fields },
  }
}

/** Every step type an automation may carry, grouped by the fields it needs. */
export const AI_AUTOMATION_STEP_VARIANTS: readonly Schema[] = [
  stepVariant([...REFERENCE_STEPS], {
    reference: {
      type: 'string',
      description:
        'The record the step acts on — the email list, campaign, workflow, dataset or outbound webhook — in the words of the description, such as "newsletter". Never an id.',
    },
  }),
  stepVariant([...TEXT_STEPS], {
    text: {
      type: 'string',
      description: `The one line the step carries: for notifyAdmins what the admins read, for addContactTag the tag (at most ${CONTACT_TAG_MAX_LENGTH} characters), and for assignContactOwner "round robin" or the teammate’s email address the description gives.`,
    },
  }),
  stepVariant(['sendEmail'], {
    subject: { type: 'string', description: 'The subject line.' },
    body: { type: 'string', description: 'The email, as plain text.' },
    toField: {
      type: 'string',
      description: 'The event field holding the address: "email" unless the description names another.',
    },
  }),
  stepVariant(['siteAlert'], {
    text: { type: 'string', description: 'What the visitor reads.' },
    severity: { type: 'string', enum: [...SEVERITIES] },
  }),
  stepVariant(['wait'], { minutes: minutes('How long to wait') }),
  stepVariant(['waitForEvent'], {
    event: { $ref: '#/$defs/event' },
    minutes: minutes('When to give up'),
  }),
  stepVariant(['exitFlow'], {}),
  stepVariant(['setContactStage'], { stage: { type: 'string', enum: [...CONTACT_LIFECYCLE_STAGES] } }),
  stepVariant(['createCrmTask'], {
    text: { type: 'string', description: 'The task.' },
    taskKind: { type: 'string', enum: [...CRM_TASK_KINDS] },
    dueInDays: {
      type: 'integer',
      description: `Days from the run, 0 for today, at most ${CRM_TASK_MAX_DUE_DAYS}.`,
    },
  }),
  stepVariant(['logCrmActivity'], {
    activityKind: { type: 'string', enum: [...CRM_ACTIVITY_KINDS] },
    text: { type: 'string', description: 'What happened.' },
  }),
]

/** The automation tool. The same bytes on every request, so it sits inside the cached prefix. */
export function aiAutomationTool(): AiTool {
  return {
    name: AI_AUTOMATION_TOOL_NAME,
    description: `Submit one automation: its trigger, the conditions on it, and its steps in order. Written out, the whole automation is at most ${AI_AUTOMATION_ANSWER_MAX_CHARS} characters, so keep its emails short.`,
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'trigger', 'steps', 'notes', 'unsupported'],
      properties: {
        name: {
          type: 'string',
          description: `A short name for the automation, at most ${AI_AUTOMATION_NAME_MAX_CHARS} characters.`,
        },
        trigger: {
          type: 'object',
          additionalProperties: false,
          required: ['event', 'conditions', 'combinator'],
          properties: {
            event: { $ref: '#/$defs/event' },
            conditions: {
              type: 'array',
              description: `What the event must meet: at most ${ACTION_MAX_CONDITIONS} conditions, empty when it runs every time.`,
              items: { $ref: '#/$defs/condition' },
            },
            combinator: { type: 'string', enum: [...TRIGGER_COMBINATORS] },
          },
        },
        steps: {
          type: 'array',
          description: `The steps in order, at most ${ACTION_MAX_STEPS}. Each is when it runs and what it does, and the action carries only the fields its type takes. Empty only with unsupported.`,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['when', 'action'],
            properties: {
              when: { $ref: '#/$defs/when' },
              action: { anyOf: AI_AUTOMATION_STEP_VARIANTS },
            },
          },
        },
        notes: {
          type: 'array',
          description: `What the person must decide that the automation cannot hold; at most ${AI_AUTOMATION_NOTES_MAX} short sentences.`,
          items: { type: 'string' },
        },
        unsupported: {
          type: 'string',
          enum: ['', ...AI_AUTOMATION_UNSUPPORTED],
          description: 'Why no automation can be built from this description; empty when one is built.',
        },
      },
      $defs: DEFINITIONS,
    },
  }
}

/** The explanation tool. */
export function aiWorkflowExplanationTool(): AiTool {
  return {
    name: AI_WORKFLOW_EXPLANATION_TOOL_NAME,
    description: 'Submit the explanation, in plain words for someone who does not write code.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'points', 'suggestions'],
      properties: {
        summary: {
          type: 'string',
          description: `One or two sentences, at most ${AI_WORKFLOW_SUMMARY_MAX_CHARS} characters.`,
        },
        points: {
          type: 'array',
          description: `At most ${AI_WORKFLOW_POINTS_MAX}, one sentence each.`,
          items: { type: 'string' },
        },
        suggestions: {
          type: 'array',
          description: `At most ${AI_WORKFLOW_SUGGESTIONS_MAX}, one sentence each; empty when there is nothing to suggest.`,
          items: { type: 'string' },
        },
      },
    },
  }
}

// ── Reading an automation ─────────────────────────────────────────────────

export interface AiAutomationCondition {
  field: string
  op: TriggerConditionOp
  /** `null` for `notEmpty`. */
  value: string | null
}

/** One step as the reader gives it back, every field the step does not use `null`. */
export interface AiAutomationAnswerStep {
  type: AiAutomationStepType
  when: AiAutomationCondition | null
  list: string | null
  campaign: string | null
  workflow: string | null
  webhook: string | null
  dataset: string | null
  subject: string | null
  body: string | null
  toField: string | null
  title: string | null
  message: string | null
  severity: Severity | null
  minutes: number | null
  event: HostEventType | null
  stage: ContactLifecycleStage | null
  tag: string | null
  owner: string | null
  taskKind: CrmTaskKind | null
  dueInDays: number | null
  activityKind: CrmActivityKind | null
}

export interface AiAutomationAnswer {
  name: string
  trigger: {
    event: HostEventType
    conditions: AiAutomationCondition[]
    combinator: TriggerCombinator
  }
  steps: AiAutomationAnswerStep[]
  notes: string[]
  unsupported: AiAutomationUnsupported | null
}

/** The codes that say an answer could not be read as an automation at all. */
export const AI_AUTOMATION_UNREADABLE_CODES: readonly string[] = [
  'automation-shape',
  'automation-trigger',
  'automation-step-type',
]

/** The codes that say an answer is larger than an automation may be. */
export const AI_AUTOMATION_OVERSIZE_CODES: readonly string[] = [
  'automation-too-many-steps',
  'automation-too-many-conditions',
  'automation-too-long',
]

/** The address field a step reads when it names none. */
const DEFAULT_TO_FIELD = 'email'
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROUND_ROBIN = /^\s*round[\s-]*robin\s*$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string trimmed to one space between words, or `null` for none. */
function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[ \t]+/g, ' ').trim()
  return clean ? clean : null
}

/** The fields a trigger's conditions and its steps' guards may read. */
function fieldsFor(event: HostEventType): readonly string[] | null {
  // A form submission carries every field the form collects, which no fixed
  // list names, so any field name is readable on it.
  if (event === 'formSubmission') return null
  const keys = HOST_EVENT_PAYLOAD_KEYS[event]
  return keys?.length ? keys : null
}

interface Reader {
  violations: AiDoctrineViolation[]
  offending: Array<[string, unknown]>
}

function refuse(
  reader: Reader,
  code: string,
  message: string,
  path: string,
  value: unknown,
): void {
  reader.violations.push({ rule: null, code, message, paths: [path] })
  if (reader.offending.length < 6) reader.offending.push([path, value])
}

function readCondition(
  reader: Reader,
  raw: unknown,
  path: string,
  event: HostEventType,
  guard: boolean,
): AiAutomationCondition | null {
  if (!isRecord(raw)) {
    refuse(reader, 'automation-shape', 'A condition is not an object with a field, an op and a value.', path, raw)
    return null
  }
  const field = textOf(raw['field'])
  const op = raw['op']
  if (!field || !FIELD_NAME.test(field)) {
    refuse(reader, 'automation-condition', 'Name the event field the condition reads.', path, raw)
    return null
  }
  if (!(TRIGGER_CONDITION_OPS as readonly unknown[]).includes(op)) {
    refuse(reader, 'automation-condition', `The condition on "${field}" needs equals, contains or notEmpty.`, path, raw)
    return null
  }
  if (event === 'formSubmission' && field === 'formId') {
    refuse(
      reader,
      'automation-condition',
      'A form submission names its form by formName, the form’s name as the site lists it.',
      path,
      raw,
    )
    return null
  }
  // A step's guard may also read whether the wait before it ran out of time.
  const readable = fieldsFor(event)
  if (readable && !readable.includes(field) && !(guard && field === FLOW_TIMED_OUT_FIELD)) {
    refuse(
      reader,
      'automation-condition',
      `The trigger "${aiAutomationTriggerLabel(event)}" does not carry "${field}". It carries: ${readable.join(', ')}.`,
      path,
      raw,
    )
    return null
  }
  const value = textOf(raw['value'])
  if (op !== 'notEmpty' && !value) {
    refuse(reader, 'automation-condition', `The condition on "${field}" needs the value it compares against.`, path, raw)
    return null
  }
  if (value && value.length > AI_AUTOMATION_VALUE_MAX_CHARS) {
    refuse(reader, 'automation-too-long', `The value the condition on "${field}" compares against is too long.`, path, raw)
    return null
  }
  if (field === 'lifecycleStage' || field === 'previousStage') {
    const stage = value ? lifecycleStageOf(value) : null
    if (op !== 'notEmpty' && !stage) {
      refuse(
        reader,
        'automation-condition',
        `A lifecycle stage is one of: ${CONTACT_LIFECYCLE_STAGES.join(', ')}.`,
        path,
        raw,
      )
      return null
    }
    return { field, op: op as TriggerConditionOp, value: op === 'notEmpty' ? null : stage }
  }
  return { field, op: op as TriggerConditionOp, value: op === 'notEmpty' ? null : value }
}

/** A lifecycle stage by its id or its label, case aside. */
export function lifecycleStageOf(value: string): ContactLifecycleStage | null {
  const wanted = value.trim().toLowerCase()
  return (
    CONTACT_LIFECYCLE_STAGES.find(
      (stage) => stage === wanted || CONTACT_LIFECYCLE_STAGE_LABELS[stage].toLowerCase() === wanted,
    ) ?? null
  )
}

function requireText(
  reader: Reader,
  step: Record<string, unknown>,
  key: string,
  max: number,
  path: string,
  what: string,
): string | null {
  const value = textOf(step[key])
  if (!value) {
    refuse(reader, 'automation-step-field', `${what} needs ${key}.`, path, step)
    return null
  }
  if (value.length > max) {
    refuse(reader, 'automation-too-long', `${what}: ${key} is longer than ${max} characters.`, path, step)
    return null
  }
  if (HOSTILE_TEXT.test(value)) {
    refuse(reader, 'automation-markup', `${what}: write ${key} as plain text, with no HTML or script.`, path, step)
    return null
  }
  return value
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function readStep(
  reader: Reader,
  raw: unknown,
  index: number,
  event: HostEventType,
  capabilities: AiAutomationCapabilities,
): AiAutomationAnswerStep | null {
  const path = `steps[${index}]`
  if (!isRecord(raw)) {
    refuse(reader, 'automation-shape', `Step ${index + 1} is not an object.`, path, raw)
    return null
  }
  // A step is its guard and its action: `{ when, action }`. An answer that
  // writes the action's own fields beside `when` reads the same, so a model
  // that flattens the step does not spend the one re-ask.
  const action = raw['action']
  const fields: Record<string, unknown> = isRecord(action) ? { ...action, when: raw['when'] } : raw
  const type = fields['type']
  if (!(AI_AUTOMATION_STEP_TYPES as readonly unknown[]).includes(type)) {
    refuse(
      reader,
      'automation-step-type',
      `Step ${index + 1} is not one of the steps offered: ${AI_AUTOMATION_STEP_TYPES.join(', ')}.`,
      path,
      fields,
    )
    return null
  }
  const stepType = type as AiAutomationStepType
  const what = `Step ${index + 1} (${HOST_ACTION_STEP_LABELS[stepType]})`
  const need = AI_AUTOMATION_STEP_NEEDS[stepType]
  if (need && !capabilities[need]) {
    refuse(
      reader,
      'automation-plan',
      `${what} needs ${AI_AUTOMATION_NEED_LABELS[need]}, which this workspace does not have. Leave it out, or answer with unsupported "needs-${need}".`,
      path,
      fields,
    )
    return null
  }
  const before = reader.violations.length
  const step: AiAutomationAnswerStep = {
    type: stepType,
    when: null,
    list: null,
    campaign: null,
    workflow: null,
    webhook: null,
    dataset: null,
    subject: null,
    body: null,
    toField: null,
    title: null,
    message: null,
    severity: null,
    minutes: null,
    event: null,
    stage: null,
    tag: null,
    owner: null,
    taskKind: null,
    dueInDays: null,
    activityKind: null,
  }
  // A step's `when` is a list of at most one condition; a lone condition, or
  // none, reads as the list it stands for.
  const when = fields['when']
  const guards = Array.isArray(when) ? when : when === null || when === undefined ? [] : [when]
  if (guards.length > 1) {
    refuse(reader, 'automation-condition', `${what}: when holds one condition at most.`, `${path}.when`, when)
  } else if (guards.length === 1) {
    step.when = readCondition(reader, guards[0], `${path}.when`, event, true)
  }
  // The six steps that name a record share `reference`, and the three that
  // carry one line share `text`; an answer that writes the step's own key
  // instead — `list`, `tag`, `owner` — reads the same.
  const shared = (key: 'reference' | 'text', own: keyof AiAutomationAnswerStep): unknown =>
    fields[key] ?? fields[own]
  const own = TEXT_KEY[stepType as keyof typeof TEXT_KEY]
  const text: Record<string, unknown> = own ? { text: shared('text', own) } : fields
  switch (stepType) {
    case 'sendEmail': {
      step.subject = requireText(reader, fields, 'subject', AI_AUTOMATION_SUBJECT_MAX_CHARS, path, what)
      step.body = requireText(reader, fields, 'body', AI_AUTOMATION_BODY_MAX_CHARS, path, what)
      const toField = textOf(fields['toField'])
      if (toField && !FIELD_NAME.test(toField)) {
        refuse(reader, 'automation-step-field', `${what}: toField names the event field holding the address.`, path, fields)
      } else {
        step.toField = toField && toField !== DEFAULT_TO_FIELD ? toField : null
      }
      break
    }
    case 'notifyAdmins':
      step.title = requireText(reader, text, 'text', AI_AUTOMATION_SUBJECT_MAX_CHARS, path, what)
      break
    case 'enrollList':
    case 'assignCampaign':
    case 'runWorkflow':
    case 'webhookPost':
    case 'datasetAppend':
    case 'updateDataset':
      step[REFERENCE_KEY[stepType]] = requireText(
        reader,
        { reference: shared('reference', REFERENCE_KEY[stepType]) },
        'reference',
        AI_AUTOMATION_REFERENCE_MAX_CHARS,
        path,
        what,
      )
      break
    case 'siteAlert': {
      step.message = requireText(reader, text, 'text', AI_AUTOMATION_TEXT_MAX_CHARS, path, what)
      const severity = fields['severity']
      step.severity = (SEVERITIES as readonly unknown[]).includes(severity) ? (severity as Severity) : 'info'
      break
    }
    case 'wait':
    case 'waitForEvent': {
      const minutes = wholeNumber(fields['minutes'])
      if (minutes === null || minutes < FLOW_WAIT_MIN_MINUTES || minutes > FLOW_WAIT_MAX_MINUTES) {
        refuse(
          reader,
          'automation-step-field',
          `${what} needs minutes, a whole number from ${FLOW_WAIT_MIN_MINUTES} to ${FLOW_WAIT_MAX_MINUTES}.`,
          path,
          fields,
        )
      } else {
        step.minutes = minutes
      }
      if (stepType === 'waitForEvent') {
        const waited = fields['event']
        if (!(HOST_EVENT_TYPES as readonly unknown[]).includes(waited)) {
          refuse(reader, 'automation-step-field', `${what} needs the event it waits for.`, path, fields)
        } else {
          step.event = waited as HostEventType
        }
      }
      break
    }
    case 'exitFlow':
      break
    case 'setContactStage': {
      const stage = fields['stage']
      if (!(CONTACT_LIFECYCLE_STAGES as readonly unknown[]).includes(stage)) {
        refuse(reader, 'automation-step-field', `${what} needs the lifecycle stage to set.`, path, fields)
      } else {
        step.stage = stage as ContactLifecycleStage
      }
      break
    }
    case 'addContactTag':
      step.tag = requireText(reader, text, 'text', CONTACT_TAG_MAX_LENGTH, path, what)
      break
    case 'assignContactOwner': {
      const owner = textOf(text['text'])
      if (!owner || !(ROUND_ROBIN.test(owner) || EMAIL_ADDRESS.test(owner))) {
        refuse(
          reader,
          'automation-owner',
          `${what}: give the owner as "round robin", or as the teammate’s email address the description gives. A teammate named without one goes in notes, not in a step.`,
          path,
          fields,
        )
      } else {
        step.owner = ROUND_ROBIN.test(owner) ? 'round robin' : owner
      }
      break
    }
    case 'createCrmTask': {
      step.title = requireText(reader, text, 'text', AI_AUTOMATION_SUBJECT_MAX_CHARS, path, what)
      const kind = fields['taskKind']
      const due = wholeNumber(fields['dueInDays'])
      if (!(CRM_TASK_KINDS as readonly unknown[]).includes(kind)) {
        refuse(reader, 'automation-step-field', `${what} needs taskKind.`, path, fields)
      } else {
        step.taskKind = kind as CrmTaskKind
      }
      if (due === null || due < 0 || due > CRM_TASK_MAX_DUE_DAYS) {
        refuse(reader, 'automation-step-field', `${what} needs dueInDays, from 0 to ${CRM_TASK_MAX_DUE_DAYS}.`, path, fields)
      } else {
        step.dueInDays = due
      }
      break
    }
    case 'logCrmActivity': {
      const kind = fields['activityKind']
      if (!(CRM_ACTIVITY_KINDS as readonly unknown[]).includes(kind)) {
        refuse(reader, 'automation-step-field', `${what} needs activityKind.`, path, fields)
      } else {
        step.activityKind = kind as CrmActivityKind
      }
      step.body = requireText(reader, text, 'text', AI_AUTOMATION_TEXT_MAX_CHARS, path, what)
      break
    }
  }
  return reader.violations.length === before ? step : null
}

/**
 * The automation tool's answer read and held to the vocabulary and to what
 * this workspace can run — the check the doctrine's loop runs on each answer,
 * beside rule 13. `value` is the automation when nothing is refused.
 */
export function readAiAutomationAnswer(
  answer: Record<string, unknown>,
  capabilities: AiAutomationCapabilities,
): AiGenerationCheckResult<AiAutomationAnswer> {
  const reader: Reader = { violations: [], offending: [] }
  const done = (value: AiAutomationAnswer | null): AiGenerationCheckResult<AiAutomationAnswer> => ({
    value: reader.violations.length ? null : value,
    violations: reader.violations,
    ...(reader.offending.length ? { offending: Object.fromEntries(reader.offending) } : {}),
  })
  const notes = (Array.isArray(answer['notes']) ? answer['notes'] : [])
    .map(textOf)
    .filter((note): note is string => note !== null && !HOSTILE_TEXT.test(note))
    .slice(0, AI_AUTOMATION_NOTES_MAX)
    .map((note) => note.slice(0, AI_AUTOMATION_NOTE_MAX_CHARS))
  const name = (textOf(answer['name']) ?? '').slice(0, AI_AUTOMATION_NAME_MAX_CHARS)
  const written = JSON.stringify(answer).length
  if (written > AI_AUTOMATION_ANSWER_MAX_CHARS) {
    refuse(
      reader,
      'automation-too-long',
      `Written out, the automation is ${written} characters, over the ${AI_AUTOMATION_ANSWER_MAX_CHARS} it may be. Shorten its emails and messages, or use fewer steps.`,
      'steps',
      written,
    )
    return done(null)
  }

  // An answer that builds an automation leaves `unsupported` empty, which the
  // schema states as an empty string rather than a `null`.
  const unsupported = answer['unsupported']
  if (unsupported !== null && unsupported !== undefined && unsupported !== '') {
    if (!(AI_AUTOMATION_UNSUPPORTED as readonly unknown[]).includes(unsupported)) {
      refuse(reader, 'automation-shape', 'unsupported is empty, or one of the reasons offered.', 'unsupported', unsupported)
      return done(null)
    }
    const need = AI_AUTOMATION_UNSUPPORTED_NEED[unsupported as AiAutomationUnsupported]
    if (need && capabilities[need]) {
      refuse(
        reader,
        'automation-unsupported',
        `This workspace has ${AI_AUTOMATION_NEED_LABELS[need]}: build the automation with it.`,
        'unsupported',
        unsupported,
      )
      return done(null)
    }
    return done({
      name,
      trigger: { event: HOST_EVENT_TYPES[0], conditions: [], combinator: 'and' },
      steps: [],
      notes,
      unsupported: unsupported as AiAutomationUnsupported,
    })
  }

  const trigger = answer['trigger']
  const steps = answer['steps']
  if (!isRecord(trigger) || !Array.isArray(steps)) {
    refuse(reader, 'automation-shape', 'The answer has no trigger and steps.', 'trigger', trigger)
    return done(null)
  }
  const event = trigger['event']
  if (!(HOST_EVENT_TYPES as readonly unknown[]).includes(event)) {
    refuse(reader, 'automation-trigger', 'The trigger is not one of the events offered.', 'trigger.event', event)
    return done(null)
  }
  const hostEvent = event as HostEventType
  const need = AI_AUTOMATION_TRIGGER_NEEDS[hostEvent]
  if (need && !capabilities[need]) {
    refuse(
      reader,
      'automation-plan',
      `The trigger "${aiAutomationTriggerLabel(hostEvent)}" needs ${AI_AUTOMATION_NEED_LABELS[need]}, which this workspace does not have. Pick another trigger, or answer with unsupported "needs-${need}".`,
      'trigger.event',
      event,
    )
    return done(null)
  }
  const rawConditions = Array.isArray(trigger['conditions']) ? trigger['conditions'] : []
  if (rawConditions.length > ACTION_MAX_CONDITIONS) {
    refuse(
      reader,
      'automation-too-many-conditions',
      `A trigger holds at most ${ACTION_MAX_CONDITIONS} conditions.`,
      'trigger.conditions',
      rawConditions.length,
    )
  }
  const conditions = rawConditions
    .slice(0, ACTION_MAX_CONDITIONS)
    .map((raw, index) => readCondition(reader, raw, `trigger.conditions[${index}]`, hostEvent, false))
    .filter((condition): condition is AiAutomationCondition => condition !== null)
  const combinator = (TRIGGER_COMBINATORS as readonly unknown[]).includes(trigger['combinator'])
    ? (trigger['combinator'] as TriggerCombinator)
    : 'and'

  if (!steps.length) {
    refuse(reader, 'automation-shape', 'An automation has at least one step; answer unsupported when none fits.', 'steps', steps)
  }
  if (steps.length > ACTION_MAX_STEPS) {
    refuse(reader, 'automation-too-many-steps', `An automation holds at most ${ACTION_MAX_STEPS} steps.`, 'steps', steps.length)
  }
  const read = steps
    .slice(0, ACTION_MAX_STEPS)
    .map((raw, index) => readStep(reader, raw, index, hostEvent, capabilities))
    .filter((step): step is AiAutomationAnswerStep => step !== null)

  return done({
    name,
    trigger: { event: hostEvent, conditions, combinator },
    steps: read,
    notes,
    unsupported: null,
  })
}

// ── Reading an explanation ────────────────────────────────────────────────

export interface AiWorkflowExplanation {
  summary: string
  points: string[]
  suggestions: string[]
}

/** Whether a line carries an email address, which nothing an explanation was shown holds. */
const CARRIES_ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/

function lines(value: unknown, max: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map(textOf)
    .filter((line): line is string => line !== null)
    .slice(0, max)
    .map((line) => line.slice(0, AI_WORKFLOW_LINE_MAX_CHARS))
}

/**
 * The explanation tool's answer: a summary, and at most so many points and
 * suggestions, each cut to a line. Refused when it has no summary, or carries
 * markup or an address — plain words for a person, about a record whose
 * personal details were removed before the model saw it.
 */
export function readAiWorkflowExplanation(
  answer: Record<string, unknown>,
): AiGenerationCheckResult<AiWorkflowExplanation> {
  const summary = (textOf(answer['summary']) ?? '').slice(0, AI_WORKFLOW_SUMMARY_MAX_CHARS)
  const value: AiWorkflowExplanation = {
    summary,
    points: lines(answer['points'], AI_WORKFLOW_POINTS_MAX),
    suggestions: lines(answer['suggestions'], AI_WORKFLOW_SUGGESTIONS_MAX),
  }
  const violations: AiDoctrineViolation[] = []
  if (!summary) {
    violations.push({ rule: null, code: 'explanation-shape', message: 'The explanation has no summary.' })
  }
  const all = [value.summary, ...value.points, ...value.suggestions]
  if (all.some((line) => HOSTILE_TEXT.test(line))) {
    violations.push({
      rule: null,
      code: 'explanation-markup',
      message: 'Write the explanation as plain text, with no HTML or script.',
    })
  }
  if (all.some((line) => CARRIES_ADDRESS.test(line))) {
    violations.push({
      rule: null,
      code: 'explanation-address',
      message: 'The explanation names an email address. Describe the person or the teammate instead.',
    })
  }
  return { value: violations.length ? null : value, violations }
}
