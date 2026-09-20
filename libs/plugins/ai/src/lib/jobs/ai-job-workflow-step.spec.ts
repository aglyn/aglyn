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

/**
 * The workflow step (AGL-2919). Its promises, each held against the request
 * the provider would receive:
 *
 *  - A DRAFT is built only from the platform's triggers and steps, and only
 *    from those the workspace can run. It is written OFF through the owning
 *    plugin's writer. Every list, campaign, workflow, webhook, form and deal
 *    stage it names is the site's record by id, or a placeholder — and the
 *    names of the site's lists, campaigns, workflows, webhooks and stages
 *    never reach the model.
 *  - An EXPLANATION reads the automation and its failed run as outlines: no
 *    email address, and never a run's event payload.
 *  - Nothing is written, run or switched on by an explanation, and a draft is
 *    never run.
 */

const mockRunAiRequest = jest.fn()
const mockOwners = new Map<string, string>()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: readonly string[]) => [...ids],
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { validateHostAction, type HostAction } from '@aglyn/aglyn/app-utils/actions'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftRecord,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiAutomationRecords } from '../model/ai-automation-draft'
import type { AiJob } from '../model/ai-jobs.types'
import {
  AI_AUTOMATION_RESOURCE,
  AI_AUTOMATION_STEP_TYPES,
  AI_AUTOMATION_UNSUPPORTED_COPY,
  AI_WORKFLOW_GONE_COPY,
  AI_WORKFLOW_NO_SITE_COPY,
  AI_WORKFLOW_RUN_GONE_COPY,
  AI_WORKFLOW_RUN_NOT_FAILED_COPY,
  AI_WORKFLOW_UNAVAILABLE_COPY,
} from '../model/ai-workflow-job'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import { AI_AUTOMATION_ANSWER_MAX_CHARS, aiAutomationTool, readAiAutomationAnswer } from '../tools/ai-workflow-tool'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_WORKFLOW_DRAFT_INSTRUCTIONS,
  AI_JOB_WORKFLOW_STEP_BUDGET,
  AI_JOB_WORKFLOW_STEP_MINIMUM_MS,
  aiWorkflowJobAdmission,
  createAiJobWorkflowStep,
  createAiWorkflowJobAdmission,
  registerAiWorkflowJob,
  runAiJobWorkflowStep,
} from './ai-job-workflow-step'
import { registerAiJobStep } from './ai-jobs'
import type { AiWorkflowRunRead, AiWorkflowTarget } from './ai-workflow-records'

const NOW = new Date('2026-09-16T20:00:00.000Z')
const USAGE = { inputTokens: 900, outputTokens: 700, cacheReadTokens: 4_000, cacheWriteTokens: 0 }
/** Pro: the actions builder and the CRM, and no webhooks. */
const PRO = { plan: 'pro', billingStatus: 'active', enabledPlugins: ['workflows'] }
const PRO_WITHOUT_CRM = { ...PRO, entitlements: { features: { crm: false } } }

// ── Sentinels: what must never reach the model ───────────────────────────

const RECORDS: AiAutomationRecords = {
  forms: [{ id: 'form-news', name: 'Newsletter sign-up', fields: ['email', 'firstName'] }],
  datasets: [{ id: 'ds-leads', name: 'Leads' }],
  lists: [
    { id: 'list-news', name: 'Newsletter zzlist' },
    { id: 'list-vip', name: 'VIP customers zzvip' },
  ],
  campaigns: [{ id: 'cmp-spring', name: 'Spring push zzcampaign' }],
  workflows: [{ id: 'wf-quote', name: 'Quote calculator zzworkflow' }],
  webhooks: [{ id: 'hook-zap', name: 'Zapier zzwebhook' }],
  stages: [{ id: 'proposal-sent', name: 'Proposal sent zzstage' }],
}
const NEVER_SENT = ['zzlist', 'zzvip', 'zzcampaign', 'zzworkflow', 'zzwebhook', 'zzstage']
const CONTACT_EMAIL = 'zzjane@example.test'
const TEAMMATE_EMAIL = 'zzrep@example.test'
const PAYLOAD_SENTINEL = 'zzpayload-visitor-typed-this'

// ── Firestore double: the site and the org the step reads ────────────────

const docs = new Map<string, Record<string, unknown>>()

function snapshotOf(path: string) {
  const data = docs.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({ get: async () => snapshotOf(`${name}/${id}`) }),
  }),
} as unknown as FirebaseFirestore.Firestore

// ── The automation writer, as the workflows plugin registers one ─────────

let drafts: Array<{ id: string; name: string; action: HostAction }> = []
let refusal: { status: 403; error: string } | null = null

const record = (draft: { id: string; name: string }): PluginDraftRecord => ({
  id: draft.id,
  name: draft.name,
  versionId: null,
  facts: {},
})

const automationWriter: PluginResourceDraftWriter = {
  refusal: async () => refusal,
  check: (content) => {
    const problem = validateHostAction(content['action'] as HostAction)
    return problem ? { ok: false, problems: [problem] } : { ok: true, facts: {} }
  },
  read: async ({ id }) => {
    const draft = drafts.find((one) => one.id === id)
    return draft ? record(draft) : null
  },
  write: async (request) => {
    const existing = drafts.find((one) => one.id === request.id)
    if (existing) return { ok: true, replayed: true, ...record(existing) }
    const action = request.content['action'] as HostAction
    const problem = validateHostAction(action)
    if (problem) return { ok: false, status: 400, error: problem }
    const draft = { id: request.id, name: request.name, action }
    drafts.push(draft)
    return { ok: true, replayed: false, ...record(draft) }
  },
}

beforeAll(() => {
  registerPluginResourceDraftWriter(AI_AUTOMATION_RESOURCE, automationWriter, { pluginId: 'workflows' })
})

// ── Fixtures ─────────────────────────────────────────────────────────────

/** A step as `submit_automation` carries one: its type, its `when` list and its own fields. */
const step = (type: string, fields: Record<string, unknown> = {}) => {
  const { when = [], ...rest } = fields
  return { when, action: { type, ...rest } }
}

/** The issue's own description, answered the way a good answer is. */
const EXAMPLE = {
  name: 'Welcome newsletter sign-ups',
  trigger: {
    event: 'formSubmission',
    conditions: [{ field: 'formName', op: 'equals', value: 'newsletter sign-up' }],
    combinator: 'and',
  },
  steps: [
    step('enrollList', { list: 'newsletter' }),
    step('setContactStage', { stage: 'lead' }),
    step('sendEmail', {
      subject: 'Welcome, and thanks for signing up',
      body: 'Thanks for joining our newsletter. Call us on [your phone number] with any question.',
    }),
  ],
  notes: [],
  unsupported: null,
}

function completion(input: unknown, name = 'submit_automation') {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name, input }],
    usage: USAGE,
    estCostUsd: 0.012,
    stopReason: 'tool_use',
  }
}

/** The id the job recorded for its automation when it was created (AGL-3079). */
const WORKFLOW_ID = 'drftAutomn'

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'workflow',
    status: 'running',
    brief:
      'When a form is submitted, add the contact to the newsletter list, create a CRM lead and send a welcome email',
    inputs: {},
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0, draftIds: { workflow: WORKFLOW_ID } }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: null,
    review: null,
    ...patch,
  } as AiJob
}

const SAVED_ACTION: HostAction = {
  name: 'Welcome a new lead',
  trigger: {
    event: 'contactCreated',
    conditions: [{ field: 'email', op: 'equals', value: CONTACT_EMAIL }],
    combinator: 'and',
  },
  steps: [
    { type: 'assignContactOwner', ownerEmail: TEAMMATE_EMAIL },
    { type: 'enrollList', listId: 'list-gone', listName: 'Old list' },
    {
      type: 'sendEmail',
      subject: 'Thanks for getting in touch',
      body: `We have your message. Write to ${TEAMMATE_EMAIL} any time.`,
    },
    { type: 'showHtml', html: '<p>zzselector-html</p>' },
  ],
  enabled: true,
}

let target: AiWorkflowTarget | null = null
let runRead: AiWorkflowRunRead = { ok: false, reason: 'gone' }
const readRecords = jest.fn(async () => RECORDS)
const readTarget = jest.fn(async () => target)
const readRun = jest.fn(async () => runRead)
const readFunctions = jest.fn(async () => [{ id: 'fn-1', name: 'calculateShipping' }])

const runStep = (patch: Partial<AiJob> = {}, org: object = PRO) =>
  createAiJobWorkflowStep({ readRecords, readTarget, readRun, readFunctions })({
    job: job(patch),
    stepIndex: 0,
    now: NOW,
    firestore,
    org,
  } as never)

const sentToModel = () => JSON.stringify(mockRunAiRequest.mock.calls)

beforeEach(() => {
  mockRunAiRequest.mockReset()
  readRecords.mockClear()
  readTarget.mockClear()
  readRun.mockClear()
  mockOwners.clear()
  docs.clear()
  drafts = []
  refusal = null
  target = null
  runRead = { ok: false, reason: 'gone' }
  mockOwners.set('host-1', 'org-1')
  docs.set('hosts/host-1', { orgId: 'org-1', subdomain: 'brightside', enabledPlugins: ['workflows'] })
  docs.set('orgs/org-1', PRO)
})

describe('registration', () => {
  it('registers the workflow runner with the least time its generation needs, and its admission', () => {
    registerAiWorkflowJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('workflow', runAiJobWorkflowStep, {
      minimumMs: AI_JOB_WORKFLOW_STEP_MINIMUM_MS,
    })
    expect(AI_JOB_WORKFLOW_STEP_MINIMUM_MS).toBe(AI_JOB_WORKFLOW_STEP_BUDGET.minimumMs)
  })
})

describe('drafting an automation', () => {
  it('drafts the description as an automation that is OFF, with the list found and the missing fact left as a placeholder', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(EXAMPLE))
    const outcome = await runStep()
    expect(outcome.failure).toBeUndefined()
    expect(outcome.review).toBeUndefined()
    expect(drafts).toHaveLength(1)
    const { action } = drafts[0]
    expect(drafts[0].id).toBe(WORKFLOW_ID)
    expect(action.enabled).toBe(false)
    expect(action.trigger).toEqual({
      event: 'formSubmission',
      conditions: [{ field: 'formName', op: 'equals', value: 'Newsletter sign-up' }],
      combinator: 'and',
    })
    expect(action.steps).toEqual([
      { type: 'enrollList', listId: 'list-news', listName: 'Newsletter zzlist' },
      { type: 'setContactStage', lifecycleStage: 'lead' },
      {
        type: 'sendEmail',
        subject: 'Welcome, and thanks for signing up',
        body: 'Thanks for joining our newsletter. Call us on [your phone number] with any question.',
      },
    ])
    expect(validateHostAction(action)).toBeNull()
    expect(outcome.outputs).toEqual([
      {
        resource: 'workflow',
        id: WORKFLOW_ID,
        versionId: null,
        hostId: 'host-1',
        hostSubdomain: 'brightside',
        label: 'Welcome newsletter sign-ups',
        note:
          'It is off until you switch it on. Fill in its placeholder first — Step 3: the text (“your phone number”).',
      },
    ])
    expect(outcome.usage).toEqual(USAGE)
  })

  it('shows the model the platform’s vocabulary, the workspace’s reach, its forms and datasets, and the brief', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(EXAMPLE))
    await runStep()
    const [request] = mockRunAiRequest.mock.calls[0]
    const system = request.system.map((block: { text: string }) => block.text).join('\n')
    expect(system).toContain(AI_JOB_WORKFLOW_DRAFT_INSTRUCTIONS[0].text)
    expect(request.tools.map((tool: { name: string }) => tool.name)).toEqual(['submit_automation'])
    const user = request.messages[0].content
    expect(user).toContain('the CRM — yes; webhooks — no; bookings — yes')
    expect(user).toContain('form-news · Newsletter sign-up · email, firstName')
    expect(user).toContain('- Leads')
    expect(user).toContain('Brief: When a form is submitted')
    // The cached prefix is the platform's, never this site's.
    expect(system).not.toContain('Newsletter sign-up')
  })

  it('lists each step with the fields its variant of the tool carries, in order, and no other', () => {
    const lines = AI_JOB_WORKFLOW_DRAFT_INSTRUCTIONS[0].text.split('\n')
    const properties = aiAutomationTool().inputSchema['properties'] as Record<
      string,
      { items: { properties: { action: { anyOf?: unknown[] } } } }
    >
    const variants = (properties['steps'].items.properties.action.anyOf ?? []) as Array<{
      properties: Record<string, { enum?: string[] }>
    }>
    expect(variants.length).toBeGreaterThan(0)
    let listedTypes = 0
    for (const variant of variants) {
      const carried = Object.keys(variant.properties).filter((key) => key !== 'type')
      for (const type of variant.properties['type'].enum ?? []) {
        const line = lines.find((row) => row.startsWith(`- ${type} (`)) ?? ''
        const listed = (line.split('Fields: ')[1] ?? '').split('.')[0].replace(/\s*\([^)]*\)/g, '')
        expect([type, listed === 'none' ? [] : listed.split(', ')]).toEqual([type, carried])
        listedTypes += 1
      }
    }
    // Every step type the tool offers has a line of its own.
    expect(listedTypes).toBe(AI_AUTOMATION_STEP_TYPES.length)
  })

  it('never shows the model the site’s lists, campaigns, workflows, webhooks or pipeline stages', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      completion({
        ...EXAMPLE,
        steps: [
          ...EXAMPLE.steps,
          step('assignCampaign', { campaign: 'spring push' }),
          step('runWorkflow', { workflow: 'quote calculator' }),
        ],
      }),
    )
    await runStep()
    const sent = sentToModel()
    for (const sentinel of NEVER_SENT) expect([sentinel, sent.includes(sentinel)]).toEqual([sentinel, false])
    // …and yet each was found, by the words of the answer.
    expect(drafts[0].action.steps.slice(3)).toEqual([
      { type: 'assignCampaign', campaignId: 'cmp-spring', campaignName: 'Spring push zzcampaign' },
      { type: 'runWorkflow', workflowId: 'wf-quote', workflowName: 'Quote calculator zzworkflow' },
    ])
  })

  it('leaves a record the words name none of, or more than one of, as a placeholder the person picks', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      completion({
        ...EXAMPLE,
        trigger: { event: 'formSubmission', conditions: [{ field: 'formName', op: 'equals', value: 'booking request' }], combinator: 'and' },
        steps: [step('enrollList', { list: 'customers' }), step('assignCampaign', { campaign: 'winter sale' })],
      }),
    )
    const lists = [...RECORDS.lists, { id: 'list-lapsed', name: 'Lapsed customers zzlapsed' }]
    readRecords.mockResolvedValueOnce({ ...RECORDS, lists })
    const outcome = await runStep()
    const { action } = drafts[0]
    expect(action.trigger.conditions).toEqual([{ field: 'formName', op: 'equals', value: '[booking request]' }])
    // "customers" fits two lists equally, so it names neither.
    expect(action.steps).toEqual([
      { type: 'enrollList', listName: '[customers]' },
      { type: 'assignCampaign', campaignName: '[winter sale]' },
    ])
    expect(outcome.outputs[0].note).toBe(
      'It is off until you switch it on. Fill in its 3 placeholders first — The trigger: a condition value (“booking request”); Step 1: the list (“customers”); Step 2: the campaign (“winter sale”).',
    )
  })

  it('finds a deal stage by its name for a condition on the stage', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      completion({
        name: 'Follow up proposals',
        trigger: {
          event: 'dealStageChanged',
          conditions: [{ field: 'stageId', op: 'equals', value: 'proposal sent' }],
          combinator: 'and',
        },
        steps: [step('createCrmTask', { title: 'Follow up the proposal', taskKind: 'call', dueInDays: 3 })],
        notes: [],
        unsupported: null,
      }),
    )
    await runStep()
    expect(drafts[0].action.trigger.conditions).toEqual([{ field: 'stageId', op: 'equals', value: 'proposal-sent' }])
  })

  it('re-asks an answer that uses a step the workspace cannot run, naming it, and drafts the answer that does not', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(completion({ ...EXAMPLE, steps: [...EXAMPLE.steps, step('webhookPost', { webhook: 'zapier' })] }))
      .mockResolvedValueOnce(completion(EXAMPLE))
    const outcome = await runStep()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const reask = mockRunAiRequest.mock.calls[1][0].messages.at(-1).content
    expect(reask).toContain('Step 4 (Send a webhook (Business)) needs webhooks, which this workspace does not have.')
    expect(drafts[0].action.steps.map((one) => one.type)).toEqual(['enrollList', 'setContactStage', 'sendEmail'])
    expect(outcome.usage.outputTokens).toBe(USAGE.outputTokens * 2)
  })

  it('says why nothing was drafted when the description needs what the plan lacks, in its own fixed words', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      completion({ ...EXAMPLE, steps: [], unsupported: 'needs-crm' }),
    )
    const outcome = await runStep({}, PRO_WITHOUT_CRM)
    expect(outcome.failure).toBe(AI_AUTOMATION_UNSUPPORTED_COPY['needs-crm'])
    expect(drafts).toEqual([])
  })

  it('re-asks an answer that claims the CRM is missing on a workspace that has it', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(completion({ ...EXAMPLE, steps: [], unsupported: 'needs-crm' }))
      .mockResolvedValueOnce(completion(EXAMPLE))
    await runStep()
    expect(mockRunAiRequest.mock.calls[1][0].messages.at(-1).content).toContain(
      'This workspace has the CRM: build the automation with it.',
    )
    expect(drafts).toHaveLength(1)
  })

  it('finds the draft an earlier run of the same job wrote, and spends nothing', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(EXAMPLE))
    await runStep()
    mockRunAiRequest.mockClear()
    const again = await runStep()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(again.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(again.outputs.map((output) => [output.resource, output.id])).toEqual([['workflow', WORKFLOW_ID]])
    expect(drafts).toHaveLength(1)
  })

  it('stops for the person when the site has no room, before the model is asked', async () => {
    refusal = { status: 403, error: 'interactions and actions are capped at 500 per site' }
    const outcome = await runStep()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.review).toEqual({
      reason: 'limit',
      message: 'interactions and actions are capped at 500 per site',
      findings: [],
    })
  })

  it('fails without spending on a site whose Automation plugin writes no drafts, or a site of another org', async () => {
    const noWriter = await createAiJobWorkflowStep({ writerFor: () => null, readRecords })({
      job: job(),
      stepIndex: 0,
      now: NOW,
      firestore,
      org: PRO,
    } as never)
    expect(noWriter.failure).toBe(AI_WORKFLOW_UNAVAILABLE_COPY)
    docs.set('hosts/host-1', { orgId: 'org-2' })
    expect((await runStep()).failure).toBe(AI_WORKFLOW_NO_SITE_COPY)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})

const EXPLANATION = {
  summary: 'When a contact is created, this gives them an owner, adds them to a list and thanks them by email.',
  points: ['It starts when a contact is created.', 'It assigns a named teammate as the owner.'],
  suggestions: ['The list it names is no longer on the site: pick another.'],
}

describe('explaining an automation', () => {
  it('sends an outline with no email address and no on-page code, and answers in plain text', async () => {
    target = { type: 'action', id: 'act-1', name: SAVED_ACTION.name, action: SAVED_ACTION }
    mockRunAiRequest.mockResolvedValueOnce(completion(EXPLANATION, 'submit_explanation'))
    const outcome = await runStep({ inputs: { mode: 'explain', targetType: 'action', targetId: 'act-1' } })
    const sent = sentToModel()
    expect(sent).not.toContain(CONTACT_EMAIL)
    expect(sent).not.toContain(TEAMMATE_EMAIL)
    expect(sent).not.toContain('zzselector-html')
    const user = mockRunAiRequest.mock.calls[0][0].messages[0].content
    expect(user).toContain('Assign the contact an owner: a named teammate.')
    expect(user).toContain('Enroll in a list: "Old list" — the site has none by that name.')
    expect(user).toContain('email equals "[email address]"')
    expect(user).toContain('Show custom HTML: runs in the visitor’s browser on the page.')
    // Only the kinds of record its steps name are read, to say whether each still exists.
    expect(readRecords).toHaveBeenCalledWith(firestore, { orgId: 'org-1', hostId: 'host-1', crm: false, only: ['lists'] })
    expect(outcome.outputs).toEqual([
      {
        resource: 'text',
        id: 'explanation',
        hostId: 'host-1',
        hostSubdomain: 'brightside',
        label: 'How “Welcome a new lead” works',
        text:
          'When a contact is created, this gives them an owner, adds them to a list and thanks them by email.\n\n' +
          'What it does:\n1. It starts when a contact is created.\n2. It assigns a named teammate as the owner.\n\n' +
          'Worth checking:\n- The list it names is no longer on the site: pick another.',
      },
    ])
    expect(drafts).toEqual([])
  })

  it('explains why a failed run failed from what the run recorded, never its payload', async () => {
    target = { type: 'action', id: 'act-1', name: SAVED_ACTION.name, action: SAVED_ACTION }
    runRead = {
      ok: true,
      run: {
        result: 'failed',
        trigger: 'contactCreated',
        summary: 'assigned owner',
        action: `Action ran on contactCreated with errors: unknown list "Old list"; no contact for ${CONTACT_EMAIL}`,
        createdAt: new Date('2026-09-16T14:02:00.000Z'),
        payload: { note: PAYLOAD_SENTINEL },
      } as never,
    }
    mockRunAiRequest.mockResolvedValueOnce(completion(EXPLANATION, 'submit_explanation'))
    const outcome = await runStep({
      inputs: { mode: 'diagnose', targetType: 'action', targetId: 'act-1', runId: 'run-9' },
    })
    const sent = sentToModel()
    expect(sent).not.toContain(PAYLOAD_SENTINEL)
    expect(sent).not.toContain(CONTACT_EMAIL)
    const user = mockRunAiRequest.mock.calls[0][0].messages[0].content
    expect(user).toContain('The run that failed: on Contact created, 2026-09-16 14:02 UTC.')
    expect(user).toContain('- unknown list "Old list"')
    expect(user).toContain('- no contact for [email address]')
    expect(outcome.outputs[0]).toEqual(
      expect.objectContaining({ id: 'diagnosis', label: 'Why a run of “Welcome a new lead” failed' }),
    )
    expect(outcome.outputs[0].text).toContain('What happened:')
    expect(outcome.outputs[0].text).toContain('How to fix it:')
  })

  it('explains a workflow of function calls, saying which of its functions the site still has', async () => {
    target = {
      type: 'workflow',
      id: 'wf-1',
      name: 'Shipping quote',
      workflow: {
        name: 'Shipping quote',
        trigger: { event: 'formSubmission', filter: 'path == "/quote"' },
        steps: [{ functionName: 'calculateShipping', args: ['weight', 'distance'], resultName: 'cost' }],
        returnValue: 'cost',
      },
    }
    mockRunAiRequest.mockResolvedValueOnce(completion(EXPLANATION, 'submit_explanation'))
    await runStep({ inputs: { mode: 'explain', targetType: 'workflow', targetId: 'wf-1' } })
    const user = mockRunAiRequest.mock.calls[0][0].messages[0].content
    expect(user).toContain('Workflow: "Shipping quote" — a workflow, a list of function calls.')
    expect(user).toContain('1. Runs the function "calculateShipping" — the site has it, given "weight", "distance"')
  })

  it('fails without spending for an automation that is gone, a run that is gone, and a run that did not fail', async () => {
    expect((await runStep({ inputs: { mode: 'explain', targetType: 'action', targetId: 'act-9' } })).failure).toBe(
      AI_WORKFLOW_GONE_COPY,
    )
    target = { type: 'action', id: 'act-1', name: SAVED_ACTION.name, action: SAVED_ACTION }
    const diagnose = { inputs: { mode: 'diagnose', targetType: 'action', targetId: 'act-1', runId: 'run-9' } }
    expect((await runStep(diagnose)).failure).toBe(AI_WORKFLOW_RUN_GONE_COPY)
    runRead = { ok: false, reason: 'not-failed' }
    expect((await runStep(diagnose)).failure).toBe(AI_WORKFLOW_RUN_NOT_FAILED_COPY)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})

describe('what a workflow job needs before it exists', () => {
  const ask = (inputs: Record<string, unknown>, patch: Record<string, unknown> = {}) =>
    createAiWorkflowJobAdmission({ readTarget, readRun })({
      firestore,
      orgId: 'org-1',
      hostId: 'host-1',
      inputs,
      org: PRO,
      uid: 'uid-1',
      ...patch,
    } as never)

  it('admits a draft on a site of its org with the Automation plugin on, and refuses inputs it cannot read', async () => {
    registerAiWorkflowJob()
    expect(
      await aiJobAdmissionRefusal('workflow', {
        firestore,
        orgId: 'org-1',
        hostId: 'host-1',
        inputs: {},
        org: PRO,
        uid: 'uid-1',
      }),
    ).toBeNull()
    expect(await ask({ mode: 'publish' })).toEqual({
      status: 400,
      error: 'inputs.mode must be draft, explain or diagnose',
    })
    expect(await ask({ mode: 'explain' })).toEqual({ status: 400, error: 'Pick the automation to explain' })
  })

  it('refuses a draft in the words of the writer, and on a site whose Automation plugin is off', async () => {
    refusal = { status: 403, error: 'Automations are not included on this workspace’s plan. Upgrade in Billing to build them.' }
    expect(await aiWorkflowJobAdmission({ firestore, orgId: 'org-1', hostId: 'host-1', inputs: {}, org: PRO, uid: 'uid-1' } as never)).toEqual({
      status: 403,
      error: 'Automations are not included on this workspace’s plan. Upgrade in Billing to build them.',
    })
    refusal = null
    docs.set('hosts/host-1', { orgId: 'org-1', disabledPlugins: ['workflows'] })
    expect(await ask({})).toEqual({ status: 403, error: 'Turn on Automation for this site before starting the job.' })
  })

  it('admits an explanation only of an automation the site has, and a run’s only of a failed run of it', async () => {
    const explain = { mode: 'explain', targetType: 'action', targetId: 'act-1' }
    expect(await ask(explain)).toEqual({ status: 404, error: AI_WORKFLOW_GONE_COPY })
    target = { type: 'action', id: 'act-1', name: SAVED_ACTION.name, action: SAVED_ACTION }
    expect(await ask(explain)).toBeNull()
    const diagnose = { ...explain, mode: 'diagnose', runId: 'run-9' }
    expect(await ask(diagnose)).toEqual({ status: 404, error: AI_WORKFLOW_RUN_GONE_COPY })
    runRead = { ok: false, reason: 'not-failed' }
    expect(await ask(diagnose)).toEqual({ status: 400, error: AI_WORKFLOW_RUN_NOT_FAILED_COPY })
    runRead = { ok: true, run: { result: 'failed' } }
    expect(await ask(diagnose)).toBeNull()
  })

  it('refuses to explain on a site of another org, or where the Automation plugin is off', async () => {
    target = { type: 'action', id: 'act-1', name: SAVED_ACTION.name, action: SAVED_ACTION }
    const explain = { mode: 'explain', targetType: 'action', targetId: 'act-1' }
    mockOwners.set('host-1', 'org-2')
    expect(await ask(explain)).toEqual({ status: 404, error: 'Unknown site' })
    mockOwners.set('host-1', 'org-1')
    docs.set('hosts/host-1', { orgId: 'org-1', disabledPlugins: ['workflows'] })
    expect(await ask(explain)).toEqual({ status: 403, error: 'Turn on Automation for this site before starting the job.' })
  })
})

describe('a measured budget', () => {
  /** An answer written out to exactly `chars` characters: two emails whose bodies take up the rest. */
  function answerOf(chars: number) {
    const emails = (first: string, second: string) => ({
      ...EXAMPLE,
      steps: [
        step('sendEmail', { subject: 'Welcome', body: first }),
        step('sendEmail', { subject: 'Still with us?', body: second }),
      ],
    })
    const rest = chars - JSON.stringify(emails('', '')).length
    return emails('x'.repeat(Math.ceil(rest / 2)), 'x'.repeat(Math.floor(rest / 2)))
  }

  it('accepts an answer up to the most characters it may be written out in, and re-asks a longer one', () => {
    const largest = answerOf(AI_AUTOMATION_ANSWER_MAX_CHARS)
    expect(JSON.stringify(largest)).toHaveLength(AI_AUTOMATION_ANSWER_MAX_CHARS)
    expect(readAiAutomationAnswer(largest, { crm: true, webhooks: true, bookings: true }).violations).toEqual([])
    const longer = readAiAutomationAnswer(answerOf(AI_AUTOMATION_ANSWER_MAX_CHARS + 1), {
      crm: true,
      webhooks: true,
      bookings: true,
    })
    expect(longer.value).toBeNull()
    expect(longer.violations.map((violation) => violation.code)).toEqual(['automation-too-long'])
  })

  it('fits the largest answer with as much again to think in, at the ceiling the served tier asks inside the step’s least time', () => {
    // JSON runs well over three characters a token; three errs toward more tokens.
    const tokens = Math.ceil(AI_AUTOMATION_ANSWER_MAX_CHARS / 3)
    expect(tokens * 2).toBeLessThanOrEqual(AI_ROUTING_TABLE['job.workflow'].maxTokens)
    expect(tokens * 2).toBeLessThanOrEqual(AI_JOB_WORKFLOW_STEP_BUDGET.maxTokens(aiModelForStep('job.workflow')))
  })

  it('holds a ten-step automation with two emails of a paragraph or two each', () => {
    const paragraphs = 'We are glad you are here. '.repeat(27)
    const ten = {
      ...EXAMPLE,
      steps: [
        step('enrollList', { list: 'newsletter' }),
        step('setContactStage', { stage: 'lead' }),
        step('sendEmail', { subject: 'Welcome, and thanks for signing up', body: paragraphs, toField: 'email' }),
        step('wait', { minutes: 4320 }),
        step('sendEmail', { subject: 'A few things you might like', body: paragraphs, toField: 'email' }),
        step('waitForEvent', { event: 'formSubmission', minutes: 10080 }),
        step('exitFlow', { when: [{ field: '_waitTimedOut', op: 'notEmpty', value: '' }] }),
        step('createCrmTask', { title: 'Call the new lead', taskKind: 'call', dueInDays: 2 }),
        step('addContactTag', { tag: 'newsletter' }),
        step('notifyAdmins', { title: 'A new lead joined the newsletter' }),
      ],
      notes: ['Pick the teammate who calls new leads.'],
    }
    expect(paragraphs.length).toBeGreaterThan(700)
    // Each step carries when it runs and an action of only its own fields, so
    // the whole comes to about 2,500 — well inside the 6,000 an answer may be.
    expect(JSON.stringify(ten).length).toBeLessThan(2_600)
    expect(JSON.stringify(ten).length).toBeLessThan(AI_AUTOMATION_ANSWER_MAX_CHARS)
    const read = readAiAutomationAnswer(ten, { crm: true, webhooks: false, bookings: false })
    expect(read.violations).toEqual([])
    expect(read.value?.steps).toHaveLength(10)
  })
})
