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
 * A workspace's automation drafted by AI (AGL-3603). Its promises, each held
 * against the request the provider would receive:
 *
 *  - no site is named, and the model is told the org automation's narrower
 *    vocabulary — and an answer using anything else is re-asked;
 *  - its records are the workspace's, matched after the answer, and their
 *    names never reach the model;
 *  - nothing is written: the automation rides on an `orgAutomation` output as
 *    a proposal, and no draft writer is asked to write;
 *  - admission asks for no site, the plugin that keeps automations on for the
 *    workspace, and the plan's actions builder.
 */

const mockRunAiRequest = jest.fn()
const mockReleased = jest.fn(async (ids: readonly string[]) => [...ids])

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => 'org-1',
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: (ids: readonly string[]) => mockReleased(ids),
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import {
  registerPluginResourceDraftWriter,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiAutomationRecords } from '../model/ai-automation-draft'
import type { AiJob } from '../model/ai-jobs.types'
import {
  AI_AUTOMATION_RESOURCE,
  AI_ORG_AUTOMATION_NO_VOCABULARY_COPY,
  AI_ORG_AUTOMATION_PLAN_COPY,
  AI_ORG_AUTOMATION_RESOURCE,
  AI_ORG_AUTOMATION_UNAVAILABLE_COPY,
  aiOrgAutomationInputs,
  parseAiWorkflowJobInputs,
  readAiOrgAutomationProposal,
} from '../model/ai-workflow-job'
import {
  AI_ORG_AUTOMATION_UNSUPPORTED_COPY,
  createAiJobWorkflowStep,
  createAiWorkflowJobAdmission,
} from './ai-job-workflow-step'

const NOW = new Date('2026-10-07T15:00:00.000Z')
const USAGE = { inputTokens: 900, outputTokens: 700, cacheReadTokens: 4_000, cacheWriteTokens: 0 }
const PRO = { plan: 'pro', billingStatus: 'active', enabledPlugins: ['workflows'] }
const FREE = { plan: 'free', billingStatus: 'active', enabledPlugins: ['workflows'] }

/** What the Org automations section says an org automation may use. */
const VOCABULARY = {
  triggers: ['formSubmission', 'lead', 'booking', 'contactCreated'],
  steps: ['sendEmail', 'enrollList', 'addContactTag', 'setContactStage', 'wait'],
}

const RECORDS: AiAutomationRecords = {
  forms: [],
  datasets: [],
  lists: [{ id: 'list-news', name: 'Newsletter zzlist' }],
  campaigns: [],
  workflows: [],
  webhooks: [],
  stages: [],
}

const writes: unknown[] = []
const writer: PluginResourceDraftWriter = {
  refusal: async () => null,
  check: () => ({ ok: true, facts: {} }),
  read: async () => null,
  write: async (request) => {
    writes.push(request)
    return { ok: false, status: 400, error: 'never asked' }
  },
}

beforeAll(() => {
  registerPluginResourceDraftWriter(AI_AUTOMATION_RESOURCE, writer, { pluginId: 'workflows' })
})

const step = (type: string, fields: Record<string, unknown> = {}) => ({ when: [], action: { type, ...fields } })

const ANSWER = {
  name: 'Welcome every booking',
  trigger: { event: 'booking', conditions: [], combinator: 'and' },
  steps: [
    step('enrollList', { list: 'newsletter' }),
    step('addContactTag', { text: 'booked' }),
    step('sendEmail', { subject: 'See you soon', body: 'Thanks for booking. Call [your phone number] to change it.' }),
  ],
  notes: [],
  unsupported: null,
}

function completion(input: unknown) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name: 'submit_automation', input }],
    usage: USAGE,
    estCostUsd: 0.012,
    stopReason: 'tool_use',
  }
}

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: null,
    kind: 'workflow',
    status: 'running',
    brief: 'When someone books on any of our sites, add them to the newsletter, tag them booked and send a welcome',
    inputs: aiOrgAutomationInputs(VOCABULARY),
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
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

const readOrgRecords = jest.fn(async () => RECORDS)
const readRecords = jest.fn(async () => RECORDS)
const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => PRO, get: () => undefined }) }) }),
} as unknown as FirebaseFirestore.Firestore

const runStep = (patch: Partial<AiJob> = {}, org: object = PRO) =>
  createAiJobWorkflowStep({ readRecords, readOrgRecords })({
    job: job(patch),
    stepIndex: 0,
    now: NOW,
    firestore,
    org,
  } as never)

const sentToModel = () => JSON.stringify(mockRunAiRequest.mock.calls)

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReleased.mockClear()
  readOrgRecords.mockClear()
  readRecords.mockClear()
  writes.length = 0
})

describe('the inputs', () => {
  it('keeps only the triggers and steps the drafting vocabulary also has', () => {
    const inputs = parseAiWorkflowJobInputs({
      mode: 'draft',
      scope: 'org',
      triggers: 'booking, nonsense',
      steps: 'sendEmail,showHtml,runJs',
    })
    expect(inputs).toEqual({ mode: 'draft', scope: 'org', triggers: ['booking'], steps: ['sendEmail'] })
  })

  it('refuses an org draft whose zone named nothing it can use', () => {
    expect(parseAiWorkflowJobInputs({ mode: 'draft', scope: 'org', triggers: 'nonsense', steps: 'sendEmail' })).toBe(
      AI_ORG_AUTOMATION_NO_VOCABULARY_COPY,
    )
  })
})

describe('drafting a workspace’s automation', () => {
  it('proposes the automation without writing it, from the workspace’s records', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep()
    expect(outcome.failure).toBeUndefined()
    expect(writes).toEqual([])
    expect(readRecords).not.toHaveBeenCalled()
    expect(readOrgRecords).toHaveBeenCalledWith(firestore, { orgId: 'org-1', crm: true })
    expect(outcome.outputs).toHaveLength(1)
    const [output] = outcome.outputs ?? []
    expect(output).toMatchObject({ resource: AI_ORG_AUTOMATION_RESOURCE, hostId: null, label: 'Welcome every booking' })
    expect(output.note).toMatch(/switched off, where you choose the sites/)
    expect(readAiOrgAutomationProposal(output.proposal)).toEqual({
      name: 'Welcome every booking',
      trigger: { event: 'booking' },
      steps: [
        { type: 'enrollList', listId: 'list-news', listName: 'Newsletter zzlist' },
        { type: 'addContactTag', tag: 'booked' },
        { type: 'sendEmail', subject: 'See you soon', body: 'Thanks for booking. Call [your phone number] to change it.' },
      ],
    })
    // The vocabulary is stated; the workspace's list names are not.
    expect(sentToModel()).toContain('belongs to the workspace')
    expect(sentToModel()).toContain('Triggers: formSubmission, lead, booking, contactCreated.')
    expect(sentToModel()).toContain('Steps: sendEmail, enrollList, wait, setContactStage, addContactTag.')
    expect(sentToModel()).not.toContain('zzlist')
  })

  it('re-asks an answer that uses a step an org automation cannot hold', async () => {
    const offSite = { ...ANSWER, steps: [...ANSWER.steps, step('siteAlert', { text: 'Thanks!', severity: 'success' })] }
    mockRunAiRequest.mockResolvedValueOnce(completion(offSite)).mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(mockRunAiRequest.mock.calls[1])).toContain('An org automation uses only these steps')
    expect(outcome.outputs?.[0]?.resource).toBe(AI_ORG_AUTOMATION_RESOURCE)
  })

  it('says to build it on the site when only one site’s steps would do', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      completion({ ...ANSWER, steps: [], trigger: { event: 'formSubmission', conditions: [], combinator: 'and' }, unsupported: 'no-step' }),
    )
    const outcome = await runStep()
    expect(outcome.failure).toBe(AI_ORG_AUTOMATION_UNSUPPORTED_COPY)
    expect(writes).toEqual([])
  })

  it('asks the model nothing on a plan without the actions builder', async () => {
    const outcome = await runStep({}, FREE)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.review?.message).toBe(AI_ORG_AUTOMATION_PLAN_COPY)
  })
})

describe('admission', () => {
  const admit = (patch: { hostId?: string | null; org?: object; inputs?: Record<string, unknown> } = {}) =>
    createAiWorkflowJobAdmission()({
      firestore,
      orgId: 'org-1',
      hostId: patch.hostId ?? null,
      inputs: patch.inputs ?? aiOrgAutomationInputs(VOCABULARY),
      org: patch.org ?? PRO,
      uid: 'uid-1',
    } as never)

  it('admits a workspace with Automation on and the actions builder, with no site', async () => {
    expect(await admit()).toBeNull()
  })

  it('refuses a site, a workspace without Automation, and a plan without the actions builder', async () => {
    expect(await admit({ hostId: 'host-1' })).toMatchObject({ status: 400 })
    expect(await admit({ org: { ...PRO, enabledPlugins: [] } })).toEqual({
      status: 403,
      error: AI_ORG_AUTOMATION_UNAVAILABLE_COPY,
    })
    expect(await admit({ org: FREE })).toEqual({ status: 403, error: AI_ORG_AUTOMATION_PLAN_COPY })
  })
})
