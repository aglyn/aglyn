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
  HOST_ACTION_STEP_LABELS,
} from '@aglyn/aglyn/app-utils/actions'
import { CONTACT_LIFECYCLE_STAGES, CRM_TASK_MAX_DUE_DAYS } from '@aglyn/aglyn/app-utils/crm'
import { HOST_EVENT_PAYLOAD_KEYS, type HostEventType } from '@aglyn/aglyn/app-utils/workflows'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import {
  aiAutomationDraft,
  aiAutomationDraftNote,
  type AiAutomationRecords,
} from '../model/ai-automation-draft'
import {
  aiActionOutline,
  aiActionRecordKinds,
  aiRunOutline,
  aiWorkflowExplanationText,
  aiWorkflowOutline,
  type AiRunRecord,
} from '../model/ai-automation-outline'
import type { AiJobOutput } from '../model/ai-jobs.types'
import {
  AI_AUTOMATION_NEED_LABELS,
  AI_AUTOMATION_RESOURCE,
  AI_AUTOMATION_STEP_NEEDS,
  AI_AUTOMATION_STEP_TYPES,
  AI_AUTOMATION_TRIGGER_NEEDS,
  AI_AUTOMATION_TRIGGERS,
  AI_AUTOMATION_UNSUPPORTED_COPY,
  AI_WORKFLOW_GONE_COPY,
  AI_WORKFLOW_NO_DRAFT_COPY,
  AI_WORKFLOW_NO_EXPLANATION_COPY,
  AI_WORKFLOW_NO_SITE_COPY,
  AI_WORKFLOW_RUN_GONE_COPY,
  AI_WORKFLOW_RUN_NOT_FAILED_COPY,
  AI_WORKFLOW_SAVE_FAILURE_COPY,
  AI_WORKFLOW_UNAVAILABLE_COPY,
  AI_WORKFLOWS_PLUGIN_ID,
  aiAutomationCapabilities,
  aiAutomationTriggerLabel,
  parseAiWorkflowJobInputs,
  type AiAutomationCapabilities,
  type AiAutomationStepType,
} from '../model/ai-workflow-job'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import {
  runValidatedGeneration,
  type AiCustomGenerationInput,
  type AiGenerationCheck,
} from '../runtime/ai-doctrine'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import {
  AI_AUTOMATION_TOOL_NAME,
  AI_WORKFLOW_EXPLANATION_TOOL_NAME,
  aiAutomationTool,
  aiWorkflowExplanationTool,
  readAiAutomationAnswer,
  readAiWorkflowExplanation,
  type AiAutomationAnswer,
  type AiWorkflowExplanation,
} from '../tools/ai-workflow-tool'
import { registerAiJobAdmission, type AiJobAdmission, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiJobStepBudget } from './ai-job-budget'
import { aiDoctrineReview, aiGenerationSpent, aiLimitReview, aiUnspentOutcome } from './ai-job-generation'
import {
  aiPluginDraftAdmissionRefusal,
  aiPluginDraftUnavailable,
  aiPluginDraftWriter,
  type AiPluginDraftWriterLookup,
} from './ai-job-plugin-drafts'
import { AI_JOB_BRIEF_MAX_CHARS, type AiJobStepOutcome, type AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'
import {
  readAiAutomationRecords,
  readAiWorkflowFunctions,
  readAiWorkflowRun,
  readAiWorkflowTarget,
} from './ai-workflow-records'

/**
 * The `workflow` step (AGL-2919): an automation drafted from a description,
 * or a saved automation explained.
 *
 * ## Drafting
 *
 * The model is shown the platform's automation vocabulary — every trigger with
 * the fields it carries, every step with the fields it takes — in a cached
 * block, and in the user turn what this workspace can run, the site's forms
 * and datasets by name, and the description. It answers through
 * `submit_automation`, and the answer is held to the vocabulary and to what
 * the workspace can run before anything is written.
 *
 * A record the description names — a list, a campaign, a workflow, a webhook,
 * a dataset, a form, a deal stage — is answered in the description's WORDS,
 * and looked up among the site's records in code, after the answer
 * (`model/ai-automation-draft.ts`). The model is never shown the site's lists,
 * campaigns, workflows, webhooks or pipelines. Words that name no record, or
 * more than one, are kept as a placeholder the person fills in.
 *
 * The automation is written through the workflows plugin's draft writer —
 * that plugin's stored shape, validator, role, plan and cap — keyed by the
 * job's id, and it is written OFF. A run cut off after the write finds its
 * draft and spends nothing.
 *
 * ## Explaining
 *
 * The model is shown an outline of the saved automation, and for a failed run
 * what the run history recorded about it (`model/ai-automation-outline.ts`):
 * never the stored documents, never an email address, never a run's event
 * payload. It answers through `submit_explanation`, which becomes a `text`
 * output. Nothing is changed.
 */

/** The longest an explanation or a draft's generation may take reading the site first. */
export const AI_WORKFLOW_RECORDS_READ_MS = 4_000

/**
 * The step's time (AGL-3035): its answer and its re-ask at the routing
 * table's `job.workflow` ceiling on the tier the step is served from. It sends
 * no site inventory block, so it makes no lookup; its own reads — the records
 * a draft is matched against, or the automation and run an explanation
 * reads — are the declared `AI_WORKFLOW_RECORDS_READ_MS`.
 */
export const AI_JOB_WORKFLOW_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.workflow'],
  maxTokens: AI_ROUTING_TABLE['job.workflow'].maxTokens,
  lookups: 0,
  ownReadsMs: AI_WORKFLOW_RECORDS_READ_MS,
})

/** The least time one workflow step needs before it starts. */
export const AI_JOB_WORKFLOW_STEP_MINIMUM_MS = AI_JOB_WORKFLOW_STEP_BUDGET.minimumMs

/** The routing table's answer for `job.workflow`. */
export function aiJobWorkflowModel(): string {
  return aiModelForStep('job.workflow')
}

/** How many forms and datasets the user turn lists, and how many fields a form. */
export const AI_WORKFLOW_FORMS_LISTED = 40
export const AI_WORKFLOW_FORM_FIELDS_LISTED = 20
export const AI_WORKFLOW_DATASETS_LISTED = 40

// ── The vocabulary, for the model ─────────────────────────────────────────

const STEP_USES: Readonly<Record<AiAutomationStepType, string>> = {
  sendEmail: 'emails the person the event is about. Fields: subject, body (plain text), toField',
  notifyAdmins: 'notifies the site’s admins in the console. Fields: title',
  enrollList: 'adds the person to an email list. Fields: list',
  assignCampaign: 'files the person under a campaign. Fields: campaign',
  runWorkflow: 'runs one of the site’s workflows. Fields: workflow',
  datasetAppend: 'saves the event as a new record in a dataset. Fields: dataset',
  updateDataset: 'updates the event’s record in a dataset. Fields: dataset',
  webhookPost: 'sends the event to one of the site’s outbound webhooks. Fields: webhook',
  siteAlert: 'shows the visitor who caused the event a short message. Fields: message, severity',
  wait: 'waits before the next step. Fields: minutes',
  waitForEvent: 'waits until something else happens to the same person, or gives up. Fields: event, minutes',
  exitFlow: 'ends the automation here; with a when it is a branch. Fields: none',
  setContactStage: 'sets the person’s lifecycle stage. Fields: stage',
  addContactTag: 'tags the person. Fields: tag',
  assignContactOwner: 'gives the person an owner. Fields: owner',
  createCrmTask: 'creates a follow-up task. Fields: title, taskKind, dueInDays',
  logCrmActivity: 'logs what happened on the person’s record. Fields: activityKind, body',
}

function triggerLine(event: HostEventType): string {
  const fields =
    event === 'formSubmission'
      ? 'formName (the form’s name, as the request lists it), path, and every field the form collects, by its field name'
      : (HOST_EVENT_PAYLOAD_KEYS[event] ?? []).join(', ') || 'none'
  const need = AI_AUTOMATION_TRIGGER_NEEDS[event]
  return `- ${event} (${aiAutomationTriggerLabel(event)}). Fields: ${fields}.${
    need ? ` Needs ${AI_AUTOMATION_NEED_LABELS[need]}.` : ''
  }`
}

function stepLine(type: AiAutomationStepType): string {
  const need = AI_AUTOMATION_STEP_NEEDS[type]
  return `- ${type} (${HOST_ACTION_STEP_LABELS[type]}) ${STEP_USES[type]}.${
    need ? ` Needs ${AI_AUTOMATION_NEED_LABELS[need]}.` : ''
  }`
}

/**
 * The drafting instructions, byte-identical on every request so they cache.
 * Built from the platform's own trigger and step catalogs, so the vocabulary
 * the model is shown is the vocabulary the answer is held to.
 */
export const AI_JOB_WORKFLOW_DRAFT_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      `You turn a description into one automation for the Actions page of a website builder: something that happens on the site (the trigger), the conditions it must meet, and the steps that run, in order. Answer by calling ${AI_AUTOMATION_TOOL_NAME} exactly once. A reply in prose cannot be used.`,
      '',
      'Use only these triggers and steps. Each step lists the fields it takes; every other field of that step is null.',
      '',
      'Triggers, with the fields their conditions can read:',
      ...AI_AUTOMATION_TRIGGERS.map(triggerLine),
      '',
      'Steps:',
      ...AI_AUTOMATION_STEP_TYPES.map(stepLine),
      '',
      'Rules:',
      '- Name a list, campaign, workflow, webhook or dataset in the description’s own words, such as "newsletter". The platform finds the site’s record by those words. Never write an id for one.',
      '- A form is named by the id or the name the request lists: formId on contactCreated, formName on formSubmission. A form the description names that the request does not list is written in the description’s words.',
      '- A deal stage in a condition on stageId or previousStageId is written as the stage’s name.',
      `- A lifecycle stage is one of: ${CONTACT_LIFECYCLE_STAGES.join(', ')}. A new lead is the stage lead.`,
      `- The trigger holds at most ${ACTION_MAX_CONDITIONS} conditions; combinator is and unless the description means any of them. A step's when is one condition of its own, over the same fields. After waitForEvent, when on the field "${FLOW_TIMED_OUT_FIELD}" with notEmpty means the wait ran out of time.`,
      `- At most ${ACTION_MAX_STEPS} steps. minutes are whole minutes, at most ${FLOW_WAIT_MAX_MINUTES}; dueInDays is from 0 to ${CRM_TASK_MAX_DUE_DAYS}; a tag is at most ${CONTACT_TAG_MAX_LENGTH} characters.`,
      '- An owner is "round robin", or the teammate’s email address when the description gives one. A teammate named without an address goes in notes.',
      '- Write an email’s subject and body, and any title or message, in the site’s voice and the language of the description. Where the description lacks a fact such as a phone number, an address or a price, write a short description of it in square brackets instead of inventing it.',
      '- A trigger or a step the request says this workspace cannot use is never used. When the description needs one, or needs something no trigger or step here does, answer with unsupported set, no steps, and trigger event formSubmission with no conditions.',
      '- notes holds what the person must decide that the automation cannot hold, in at most three short sentences; empty when there is nothing.',
      '- The automation is drafted switched off, and a person reviews it and switches it on. Never ask to turn it on or to run it.',
    ].join('\n'),
    cacheBreakpoint: true,
  },
]

/** The explaining instructions, byte-identical on every request so they cache. */
export const AI_JOB_WORKFLOW_EXPLAIN_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      `You explain an automation on a website builder to the person who owns the site, in plain words for someone who does not write code. You are shown the automation as it is set up — what starts it, its conditions and its steps in order — and, when you are asked why a run failed, what the run history recorded about that run. Answer by calling ${AI_WORKFLOW_EXPLANATION_TOOL_NAME} exactly once.`,
      '',
      '- summary: in one or two sentences, what the automation does; or, for a failed run, the most likely reason it failed.',
      '- points: what happens, step by step, in the order it happens; or, for a failed run, what the run did and where it went wrong. One sentence each.',
      '- suggestions: what the person can check or change — a list, campaign or workflow the site no longer has, a condition that can never match, a placeholder nobody has filled in, a step the plan does not include. For a failed run, how to fix it. Empty when there is nothing to suggest.',
      '',
      'Rules:',
      '- Explain only what you are shown. Never guess at settings, records or history you were not given, and never say you changed anything: you change nothing.',
      '- Name triggers and steps the way you are shown them, not by internal names.',
      '- A value in square brackets is a placeholder nobody has filled in yet.',
      '- Personal details were removed from what you are shown, and are written as [email address] or a named teammate. Never ask for them.',
      '- Write plain text, with no markdown and no HTML.',
    ].join('\n'),
    cacheBreakpoint: true,
  },
]

// ── The user turns ────────────────────────────────────────────────────────

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}

/** What a draft is asked from: the workspace's reach, the site's forms and datasets, and the brief. */
export function aiJobWorkflowDraftPrompt(input: {
  brief: string
  capabilities: AiAutomationCapabilities
  records: Pick<AiAutomationRecords, 'forms' | 'datasets'>
}): string {
  const { crm, webhooks, bookings } = input.capabilities
  const forms = input.records.forms.slice(0, AI_WORKFLOW_FORMS_LISTED)
  const datasets = input.records.datasets.slice(0, AI_WORKFLOW_DATASETS_LISTED)
  return [
    `This workspace can use: the CRM — ${yesNo(crm)}; webhooks — ${yesNo(webhooks)}; bookings — ${yesNo(bookings)}.`,
    'Forms on this site (id · name · fields):',
    ...(forms.length
      ? forms.map(
          (form) =>
            `- ${form.id} · ${form.name} · ${form.fields.slice(0, AI_WORKFLOW_FORM_FIELDS_LISTED).join(', ') || 'no fields'}`,
        )
      : ['- none']),
    'Datasets on this site (name):',
    ...(datasets.length ? datasets.map((dataset) => `- ${dataset.name}`) : ['- none']),
    `Brief: ${input.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`,
  ].join('\n')
}

/** What an explanation is asked from: the mode, the outlines, and the member's question. */
export function aiJobWorkflowExplainPrompt(input: {
  brief: string
  mode: 'explain' | 'diagnose'
  outline: string
  run: string | null
}): string {
  return [
    input.mode === 'diagnose'
      ? 'Asked: why a run of this automation failed.'
      : 'Asked: what this automation does.',
    input.outline,
    ...(input.run ? [input.run] : []),
    `Question: ${input.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`,
  ].join('\n\n')
}

/** The routing row's thinking and effort, as a generation input spells them. */
function routedEffort(): Pick<AiCustomGenerationInput<unknown>, 'thinking' | 'effort'> {
  const row = AI_ROUTING_TABLE['job.workflow']
  return {
    ...(row.thinking ? { thinking: row.thinking } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
  }
}

/** The draft generation as the doctrine's loop runs it; the eval harness records one through this same call. */
export function aiJobWorkflowDraftGeneration(request: {
  brief: string
  capabilities: AiAutomationCapabilities
  records: Pick<AiAutomationRecords, 'forms' | 'datasets'>
  model: string
  signal?: AbortSignal
}): AiCustomGenerationInput<AiAutomationAnswer> {
  const check: AiGenerationCheck<AiAutomationAnswer> = (answer) =>
    readAiAutomationAnswer(answer, request.capabilities)
  return {
    step: 'job.workflow',
    model: request.model,
    instructions: AI_JOB_WORKFLOW_DRAFT_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiJobWorkflowDraftPrompt(request) }],
    tool: aiAutomationTool(),
    maxTokens: AI_JOB_WORKFLOW_STEP_BUDGET.maxTokens(request.model),
    ...routedEffort(),
    ...(request.signal ? { signal: request.signal } : {}),
    check,
  }
}

/** The explanation generation as the doctrine's loop runs it. */
export function aiJobWorkflowExplainGeneration(request: {
  brief: string
  mode: 'explain' | 'diagnose'
  outline: string
  run: string | null
  model: string
  signal?: AbortSignal
}): AiCustomGenerationInput<AiWorkflowExplanation> {
  return {
    step: 'job.workflow',
    model: request.model,
    instructions: AI_JOB_WORKFLOW_EXPLAIN_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiJobWorkflowExplainPrompt(request) }],
    tool: aiWorkflowExplanationTool(),
    maxTokens: AI_JOB_WORKFLOW_STEP_BUDGET.maxTokens(request.model),
    ...routedEffort(),
    ...(request.signal ? { signal: request.signal } : {}),
    check: readAiWorkflowExplanation,
  }
}

// ── The runner ────────────────────────────────────────────────────────────

export interface AiJobWorkflowStepDeps {
  /** How the automation draft writer is found; the core's registry otherwise. */
  writerFor?: AiPluginDraftWriterLookup
  readRecords?: typeof readAiAutomationRecords
  readTarget?: typeof readAiWorkflowTarget
  readRun?: typeof readAiWorkflowRun
  readFunctions?: typeof readAiWorkflowFunctions
}

/** A job label: the automation's name in quotes, cut to a line. */
function quotedName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  return `“${clean.length > 60 ? `${clean.slice(0, 60)}…` : clean}”`
}

export function createAiJobWorkflowStep(deps: AiJobWorkflowStepDeps = {}): AiJobStepRunner {
  const writerFor = deps.writerFor ?? aiPluginDraftWriter
  const readRecords = deps.readRecords ?? readAiAutomationRecords
  const readTarget = deps.readTarget ?? readAiWorkflowTarget
  const readRun = deps.readRun ?? readAiWorkflowRun
  const readFunctions = deps.readFunctions ?? readAiWorkflowFunctions
  return async ({ job, now, signal, firestore, org, modelFor }): Promise<AiJobStepOutcome> => {
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.workflow') ?? aiJobWorkflowModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const inputs = parseAiWorkflowJobInputs(job.inputs)
    if (typeof inputs === 'string') return unspent(inputs)
    const hostId = job.hostId
    if (!hostId) return unspent(AI_WORKFLOW_NO_SITE_COPY)
    // The door checks the caller's membership of the org the job is metered
    // against; the site is checked against that org here, before anything
    // about it is read into a prompt.
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists || host.get('orgId') !== job.orgId) return unspent(AI_WORKFLOW_NO_SITE_COPY)
    const subdomain = host.get('subdomain')
    const hostSubdomain = typeof subdomain === 'string' && subdomain ? subdomain : null
    const orgData = (org ?? (await firestore.collection('orgs').doc(job.orgId).get()).data() ?? null) as Record<
      string,
      unknown
    > | null
    const capabilities = aiAutomationCapabilities(orgData)

    if (inputs.mode === 'draft') {
      const writer = writerFor(AI_AUTOMATION_RESOURCE)
      if (!writer) return unspent(AI_WORKFLOW_UNAVAILABLE_COPY)
      const place = { hostId, hostSubdomain }
      // What an earlier run of this same job already wrote.
      const written = await writer.read({ hostId, id: job.$id })
      if (written) {
        return aiUnspentOutcome(model, {
          outputs: [draftOutput(written.id, written.name, place, 'It is off until you switch it on.')],
        })
      }
      const context = { orgId: job.orgId, hostId, uid: job.createdBy, org: orgData, now }
      const refusal = await writer.refusal(context)
      if (refusal) {
        return refusal.status === 403
          ? aiUnspentOutcome(model, { review: aiLimitReview(refusal.error) })
          : unspent(refusal.error)
      }
      const records = await readRecords(firestore, { orgId: job.orgId, hostId, crm: capabilities.crm })
      const generation = await runValidatedGeneration(
        'workflow',
        aiJobWorkflowDraftGeneration({
          brief: job.brief,
          capabilities,
          records,
          model,
          ...(signal ? { signal } : {}),
        }),
      )
      const spent = { ...aiGenerationSpent(generation), ...(generation.effort ? { effort: generation.effort } : {}) }
      if (generation.status === 'refused') return { ...spent, refused: true }
      if (generation.status === 'needs_input') return { ...spent, review: aiDoctrineReview(generation) }
      const answer = generation.value
      if (answer.unsupported) return { ...spent, failure: AI_AUTOMATION_UNSUPPORTED_COPY[answer.unsupported] }
      if (!answer.steps.length) return { ...spent, failure: AI_WORKFLOW_NO_DRAFT_COPY }
      const draft = aiAutomationDraft(answer, records)
      const write = await writer.write({
        ...context,
        id: job.$id,
        name: draft.action.name,
        content: { action: draft.action },
      })
      if (write.ok === false) {
        return write.status === 403
          ? { ...spent, review: aiLimitReview(write.error) }
          : { ...spent, failure: AI_WORKFLOW_SAVE_FAILURE_COPY }
      }
      return {
        ...spent,
        outputs: [draftOutput(write.id, write.name, place, aiAutomationDraftNote(draft, answer.notes))],
      }
    }

    const target = await readTarget(firestore, { hostId, type: inputs.targetType, id: inputs.targetId })
    if (!target) return unspent(AI_WORKFLOW_GONE_COPY)
    let run: AiRunRecord | null = null
    if (inputs.mode === 'diagnose') {
      const read = await readRun(firestore, { hostId, targetId: inputs.targetId, runId: inputs.runId })
      if (read.ok === false) {
        return unspent(read.reason === 'gone' ? AI_WORKFLOW_RUN_GONE_COPY : AI_WORKFLOW_RUN_NOT_FAILED_COPY)
      }
      run = read.run
    }
    // Only the kinds of record the automation's steps name are read, to say
    // whether each still exists.
    const outline =
      target.type === 'action'
        ? aiActionOutline(
            target.action,
            await readRecords(firestore, {
              orgId: job.orgId,
              hostId,
              crm: false,
              only: aiActionRecordKinds(target.action),
            }),
          )
        : aiWorkflowOutline(target.workflow, await readFunctions(firestore, hostId))
    const generation = await runValidatedGeneration(
      'workflow',
      aiJobWorkflowExplainGeneration({
        brief: job.brief,
        mode: inputs.mode,
        outline,
        run: run ? aiRunOutline(run) : null,
        model,
        ...(signal ? { signal } : {}),
      }),
    )
    const spent = { ...aiGenerationSpent(generation), ...(generation.effort ? { effort: generation.effort } : {}) }
    if (generation.status === 'refused') return { ...spent, refused: true }
    if (generation.status === 'needs_input') return { ...spent, failure: AI_WORKFLOW_NO_EXPLANATION_COPY }
    const output: AiJobOutput = {
      resource: 'text',
      // An explanation has no document of its own; the id names what it is
      // within the job, as a text output's `draft` does.
      id: inputs.mode === 'diagnose' ? 'diagnosis' : 'explanation',
      hostId,
      hostSubdomain,
      label:
        inputs.mode === 'diagnose'
          ? `Why a run of ${quotedName(target.name)} failed`
          : `How ${quotedName(target.name)} works`,
      text: aiWorkflowExplanationText(generation.value, inputs.mode),
    }
    return { ...spent, outputs: [output] }
  }
}

function draftOutput(
  id: string,
  name: string,
  place: { hostId: string; hostSubdomain: string | null },
  note: string,
): AiJobOutput {
  return {
    resource: 'workflow',
    id,
    versionId: null,
    hostId: place.hostId,
    hostSubdomain: place.hostSubdomain,
    label: name,
    note,
  }
}

export const runAiJobWorkflowStep = createAiJobWorkflowStep()

// ── Admission ─────────────────────────────────────────────────────────────

/** Whether the workflows plugin runs on this site: switched on, and past its release flag. */
async function workflowsPluginRefusal(
  context: Parameters<AiJobAdmission>[0],
  hostId: string,
): Promise<AiJobAdmissionRefusal | null> {
  const host = (await context.firestore.collection('hosts').doc(hostId).get()).data() ?? null
  const org = context.org as { enabledPlugins?: string[] } | null
  const released = await filterEnabledPluginsByReleaseFlags([AI_WORKFLOWS_PLUGIN_ID], {
    orgId: context.orgId,
    authorization: null,
  })
  return released.includes(AI_WORKFLOWS_PLUGIN_ID) && isHostPluginEnabled(org, host, AI_WORKFLOWS_PLUGIN_ID)
    ? null
    : { status: 403, error: aiPluginDraftUnavailable('Automation') }
}

export interface AiWorkflowJobAdmissionDeps {
  readTarget?: typeof readAiWorkflowTarget
  readRun?: typeof readAiWorkflowRun
  writerFor?: AiPluginDraftWriterLookup
}

/**
 * A workflow job is admitted for a site of its org with the Automation plugin
 * on. A draft also needs the draft writer and the member's room and role in
 * its own words; an explanation needs the automation it names to exist, and
 * a run's explanation a failed run of it.
 */
export function createAiWorkflowJobAdmission(deps: AiWorkflowJobAdmissionDeps = {}): AiJobAdmission {
  const readTarget = deps.readTarget ?? readAiWorkflowTarget
  const readRun = deps.readRun ?? readAiWorkflowRun
  return async (context) => {
    const inputs = parseAiWorkflowJobInputs(context.inputs)
    if (typeof inputs === 'string') return { status: 400, error: inputs }
    if (inputs.mode === 'draft') {
      return aiPluginDraftAdmissionRefusal(context, {
        kind: 'workflow',
        drafts: [{ resource: AI_AUTOMATION_RESOURCE, pluginId: AI_WORKFLOWS_PLUGIN_ID, label: 'Automation' }],
        ...(deps.writerFor ? { writerFor: deps.writerFor } : {}),
      })
    }
    const hostId = context.hostId
    if (!hostId) return { status: 400, error: 'Open the site the automation is on before asking about it' }
    const owner = await resolveOrgIdForHost(hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    const plugin = await workflowsPluginRefusal(context, hostId)
    if (plugin) return plugin
    const target = await readTarget(context.firestore, { hostId, type: inputs.targetType, id: inputs.targetId })
    if (!target) return { status: 404, error: AI_WORKFLOW_GONE_COPY }
    if (inputs.mode === 'diagnose') {
      const run = await readRun(context.firestore, { hostId, targetId: inputs.targetId, runId: inputs.runId })
      if (run.ok === false) {
        return run.reason === 'gone'
          ? { status: 404, error: AI_WORKFLOW_RUN_GONE_COPY }
          : { status: 400, error: AI_WORKFLOW_RUN_NOT_FAILED_COPY }
      }
    }
    return null
  }
}

export const aiWorkflowJobAdmission = createAiWorkflowJobAdmission()

/** Registers the workflow step and the check a workflow job passes before it is created or resumed. */
export function registerAiWorkflowJob(): void {
  registerAiJobStep('workflow', runAiJobWorkflowStep, { minimumMs: AI_JOB_WORKFLOW_STEP_MINIMUM_MS })
  registerAiJobAdmission('workflow', aiWorkflowJobAdmission)
}
