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
 * The `crm` step (AGL-2917), with the CRM's readers faked at the record-facts
 * seam and the provider faked at the runtime's `runAiRequest` seam. What it
 * proves: what each question sends — the CRM's facts and nothing the step read
 * itself — what comes back as a proposal, that the answer is kept apart from
 * the job and the job names only the question, that an unchanged record is
 * not asked twice, and that a refusal is the CRM's own sentence and spends
 * nothing.
 */

const mockRunAiRequest = jest.fn()
const mockHostOrgs = new Map<string, string>()
const mockReleased = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockHostOrgs.get(hostId) ?? null,
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: (...args: unknown[]) => mockReleased(...args),
}))

import type { PluginRecordFactsRead, PluginRecordFactsRequest } from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import {
  AI_CRM_LIMITS,
  aiCrmAnswerExpiry,
  aiCrmColumnsInput,
  readAiCrmProposal,
  type AiCrmAnswerRecord,
  type AiCrmRecordProposal,
} from '../model/ai-crm'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_STEP_TIERS, AI_MODEL_CATALOG } from '../providers/catalog'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import { aiDoctrineSystemBlock } from '../runtime/ai-doctrine'
import {
  AI_CRM_EMAIL_TOOL,
  AI_CRM_EMAIL_TOOL_NAME,
  AI_CRM_MAPPING_TOOL,
  AI_CRM_MAPPING_TOOL_NAME,
  AI_CRM_RECORD_TOOL_NAME,
  aiCrmRecordTool,
  aiCrmWritesPhoneNumber,
} from '../tools/ai-crm-tool'
import { AI_CRM_UNAVAILABLE_COPY, aiCrmAccessRefusal } from './ai-crm-access'
import { aiJobAdmissionFor } from './ai-job-admission'
import { AI_JOB_INLINE_BUDGET_MS, aiGenerationWorstCaseOnTierMs } from './ai-job-budget'
import {
  AI_CRM_EMAIL_INSTRUCTIONS,
  AI_CRM_FACTS_READS_MS,
  AI_CRM_KEEP_FAILURE_COPY,
  AI_CRM_MAPPING_INSTRUCTIONS,
  AI_JOB_CRM_STEP_BUDGET,
  aiCrmAdmissionRefusal,
  aiCrmRecordInstructions,
  aiReusableCrmRecord,
  createAiJobCrmStep,
  findAiCrmAnswersByKey,
  registerAiCrmJob,
  type AiCrmAnswerCandidate,
} from './ai-job-crm-step'
import { aiJobStepMinimumMs, aiJobStepRunnerFor } from './ai-jobs'

type Doc = Record<string, unknown>

const ORG = 'org-1'
const HOST = 'host-1'
const NOW = new Date('2026-09-16T15:00:00.000Z')
const USAGE = { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 }

const CONTACT_FACTS = {
  record: 'contact',
  name: 'Dana Whitfield',
  jobTitle: 'Facilities manager',
  company: 'Harbor Cold Storage',
  lifecycleStage: 'Opportunity',
  tags: ['commercial'],
  sources: ['Booking'],
  orders: 0,
  lastPurchase: null,
  since: '2026-07-02',
  lastEmailEngagement: '2026-09-09',
  notes: 'Owner approves budgets.',
  timeline: [{ on: '2026-09-09', kind: 'Email', direction: 'outbound', subject: 'Your quote', delivery: 'Opened' }],
  openTasks: [{ title: 'Send the revised quote', kind: 'Email', priority: 'high', due: '2026-09-18', overdue: false }],
  deals: [{ title: 'Loading dock membrane', stage: 'Proposal sent', status: 'open', amount: 'USD 18450.00', expectedClose: null }],
  // A field a reader might add one day: the step writes only the fields it names.
  unexpected: 'never sent',
}

const DEAL_FACTS = {
  record: 'deal',
  title: 'Gutters, 14 Elm Street',
  pipeline: 'Residential',
  stages: [
    { id: 'proposal-sent', name: 'Proposal sent', kind: 'open' },
    { id: 'negotiation', name: 'Negotiation', kind: 'open' },
    { id: 'won', name: 'Won', kind: 'won' },
  ],
  stageId: 'proposal-sent',
  stage: 'Proposal sent',
  status: 'open',
  amount: 'USD 3200.00',
  timeline: [{ on: '2026-09-12', kind: 'Call', text: 'Asked for a discount.' }],
  openTasks: [],
}

const IMPORT_FACTS = {
  record: 'import',
  collection: 'contacts',
  fields: [
    { key: 'email', label: 'Email (required)', type: 'email', required: true },
    { key: 'name', label: 'Name', type: 'text', required: false },
    { key: 'custom:renewal', label: 'Renewal', type: 'date', required: false },
  ],
}

const reads: PluginRecordFactsRequest[] = []
let facts: Record<string, Doc> = {}
let refusal: PluginRecordFactsRead | null = null

const reader = {
  read: async (request: PluginRecordFactsRequest): Promise<PluginRecordFactsRead> => {
    reads.push(request)
    return refusal ?? { ok: true, facts: facts[request.id] ?? { record: 'nothing' } }
  },
}
const readerFor = (resource: string) => (resource.startsWith('crm.') ? { pluginId: 'crm', reader } : null)

/** Every document written, by path. A site document reads as one with the CRM on. */
const writes: Array<{ path: string; data: Doc }> = []
let keepFails = false
const docAt = (path: string): unknown => ({
  collection: (name: string) => collectionAt(`${path}/${name}`),
  get: async () => ({ exists: true, data: () => ({ enabledPlugins: ['crm'] }) }),
  set: async (data: Doc) => {
    if (keepFails) throw new Error('unavailable')
    writes.push({ path, data })
  },
})
const collectionAt = (path: string): unknown => ({ doc: (id: string) => docAt(`${path}/${id}`) })
const firestore = { collection: (name: string) => collectionAt(name) } as unknown as FirebaseFirestore.Firestore

/** The answer a job kept, as written. */
const keptFor = (jobId = 'job-1') =>
  writes.find((write) => write.path === `orgs/${ORG}/aiCrmAnswers/${jobId}`)?.data as (AiCrmAnswerRecord & Doc) | undefined

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: ORG,
    hostId: HOST,
    kind: 'crm',
    status: 'running',
    brief: 'Summarize this contact',
    inputs: { task: 'record', record: 'contact', recordId: 'contact-1' },
    steps: [],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    ...patch,
  } as AiJob
}

const answer = (name: string, input: Doc) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name, input }],
  usage: USAGE,
  estCostUsd: 0.001,
  stopReason: 'tool_use',
})

function runStep(patch: Partial<AiJob> = {}, finder: ((orgId: string, key: string) => Promise<AiCrmAnswerCandidate[]>) | null = null) {
  const step = createAiJobCrmStep({ readerFor, findAnswersByKey: finder })
  return step({ job: job(patch), stepIndex: 0, now: NOW, firestore, org: { plan: 'pro' } as never })
}

const sent = () => mockRunAiRequest.mock.calls.map(([request]) => request as { system: Array<{ text: string }>; messages: Array<{ content: string }>; tools: Array<{ name: string }>; maxTokens: number })

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReleased.mockReset()
  mockReleased.mockResolvedValue(['crm'])
  mockHostOrgs.clear()
  mockHostOrgs.set(HOST, ORG)
  mockHostOrgs.set('host-9', 'org-9')
  reads.length = 0
  writes.length = 0
  keepFails = false
  refusal = null
  facts = { 'contact-1': CONTACT_FACTS, 'deal-1': DEAL_FACTS, contacts: IMPORT_FACTS }
})

describe('a record (AGL-2917)', () => {
  it('sends the CRM’s facts for the creator, with the field rules and no site inventory, and proposes a next step', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      answer(AI_CRM_RECORD_TOOL_NAME, {
        summary: 'Dana opened the quote on 2026-09-09. The Loading dock membrane deal is at Proposal sent.',
        nextStep: { title: 'Call Dana about budget approval', kind: 'call', priority: 'high', dueInDays: 2, reason: 'The owner approves budgets.' },
      }),
    )
    const outcome = await runStep()
    expect(reads).toEqual([
      { orgId: ORG, hostId: HOST, id: 'contact-1', uid: 'uid-1', org: { plan: 'pro' }, now: NOW },
    ])
    const [request] = sent()
    expect(request.system[0].text).toBe(aiDoctrineSystemBlock('fields').text)
    expect(request.system[1].text).toBe(aiCrmRecordInstructions('contact')[0].text)
    expect(request.system).toHaveLength(2)
    expect(request.tools.map((tool) => tool.name)).toEqual([AI_CRM_RECORD_TOOL_NAME])
    const prompt = request.messages[0].content
    expect(prompt).toContain('Contact: Dana Whitfield')
    expect(prompt).toContain('- 2026-09-09 Email (outbound, Opened): "Your quote"')
    expect(prompt).toContain('- Send the revised quote (Email, high priority, due 2026-09-18)')
    expect(prompt).toContain('- Loading dock membrane: Proposal sent, open, USD 18450.00')
    expect(prompt).not.toContain('never sent')
    expect(request.maxTokens).toBe(AI_JOB_CRM_STEP_BUDGET.maxTokens(aiModelForStep('job.crm')))
    expect(outcome.failure).toBeUndefined()
    expect(outcome.usage).toEqual(USAGE)
    // The job names the question and nothing of the answer: any member may read a job.
    expect(outcome.outputs).toEqual([
      {
        resource: 'crm',
        id: 'record:contact:contact-1',
        hostId: HOST,
        label: 'CRM summary',
        proposal: { kind: 'record', record: { kind: 'contact', id: 'contact-1' } },
      },
    ])
    expect(writes.map((write) => write.path)).toEqual([`orgs/${ORG}/aiCrmAnswers/job-1`])
    expect(keptFor()).toEqual({
      jobId: 'job-1',
      orgId: ORG,
      hostId: HOST,
      createdBy: 'uid-1',
      task: 'record',
      resource: 'crm.contact',
      recordId: 'contact-1',
      key: expect.stringMatching(/^[0-9a-f]{64}$/),
      proposal: {
        kind: 'record',
        record: { kind: 'contact', id: 'contact-1' },
        summary: 'Dana opened the quote on 2026-09-09. The Loading dock membrane deal is at Proposal sent.',
        nextStep: { title: 'Call Dana about budget approval', kind: 'call', priority: 'high', dueInDays: 2, reason: 'The owner approves budgets.' },
        stage: null,
        standing: null,
        asOf: '2026-09-16',
      },
      createdAt: NOW,
      expiresAt: aiCrmAnswerExpiry(NOW),
    })
  })

  it('re-asks a next step that repeats an open task, and keeps the answer that does not', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(
        answer(AI_CRM_RECORD_TOOL_NAME, {
          summary: 'Dana opened the quote.',
          nextStep: { title: 'Send the revised quote', kind: 'email', priority: 'high', dueInDays: 1, reason: 'Open.' },
        }),
      )
      .mockResolvedValueOnce(answer(AI_CRM_RECORD_TOOL_NAME, { summary: 'Dana opened the quote.', nextStep: null }))
    const outcome = await runStep()
    expect(sent()).toHaveLength(2)
    expect(sent()[1].messages.at(-1)?.content).toContain('repeats a task that is already open')
    expect(outcome.outputs).toHaveLength(1)
    expect(readAiCrmProposal(keptFor()?.proposal)).toMatchObject({ nextStep: null })
  })

  it('proposes an open stage for a deal, and holds a deal to the stages its pipeline lists', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(answer(AI_CRM_RECORD_TOOL_NAME, { summary: 'Marco asked for a discount.', nextStep: null, stage: { stageId: 'won', reason: 'Agreed.' } }))
      .mockResolvedValueOnce(
        answer(AI_CRM_RECORD_TOOL_NAME, { summary: 'Marco asked for a discount.', nextStep: null, stage: { stageId: 'negotiation', reason: 'He asked for a discount on 2026-09-12.' } }),
      )
    const outcome = await runStep({ inputs: { task: 'record', record: 'deal', recordId: 'deal-1' } })
    expect(sent()[0].messages[0].content).toContain('Stages in order: proposal-sent "Proposal sent" (open); negotiation "Negotiation" (open); won "Won" (won)')
    expect(sent()[1].messages.at(-1)?.content).toContain('Winning or losing a deal is the team’s call')
    expect(outcome.outputs[0]).toMatchObject({ id: 'record:deal:deal-1', proposal: { kind: 'record', record: { kind: 'deal', id: 'deal-1' } } })
    expect(keptFor()).toMatchObject({
      resource: 'crm.deal',
      recordId: 'deal-1',
      proposal: { stage: { stageId: 'negotiation', stageName: 'Negotiation', reason: 'He asked for a discount on 2026-09-12.' } },
    })
  })

  it('reuses an answer kept for the same request at no cost, keeps it again for the new job, and asks again when the facts moved', async () => {
    mockRunAiRequest.mockResolvedValue(answer(AI_CRM_RECORD_TOOL_NAME, { summary: 'Dana opened the quote.', nextStep: null }))
    await runStep({ $id: 'job-0' })
    const first = keptFor('job-0') as AiCrmAnswerRecord
    const candidates: AiCrmAnswerCandidate[] = [
      { jobId: 'job-0', hostId: HOST, task: 'record', key: first.key, createdAtMs: NOW.getTime() - 60_000, proposal: first.proposal },
    ]
    const asked: string[] = []
    const finder = async (orgId: string, key: string) => {
      asked.push(`${orgId}/${key}`)
      return candidates.filter((candidate) => candidate.key === key)
    }
    mockRunAiRequest.mockClear()
    const again = await runStep({ $id: 'job-2' }, finder)
    expect(asked).toEqual([`${ORG}/${first.key}`])
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(again).toMatchObject({ estCostUsd: 0, outputs: [{ id: 'record:contact:contact-1' }] })
    expect(keptFor('job-2')).toMatchObject({ key: first.key, proposal: { ...first.proposal, reusedFrom: 'job-0' } })

    facts['contact-1'] = { ...CONTACT_FACTS, notes: 'Owner approved the budget.' }
    await runStep({ $id: 'job-3' }, finder)
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(keptFor('job-3')?.key).not.toBe(first.key)
    expect((keptFor('job-3')?.proposal as AiCrmRecordProposal).reusedFrom).toBeUndefined()
  })

  it('reuses only a record answer kept on the same site for the same key, inside the window', () => {
    const proposal = { kind: 'record', record: { kind: 'contact', id: 'c' }, summary: 's', nextStep: null, stage: null, standing: null, asOf: '2026-09-16' } as const
    const base: AiCrmAnswerCandidate = { jobId: 'job-0', hostId: HOST, task: 'record', key: 'k', createdAtMs: NOW.getTime(), proposal }
    const context = { jobId: 'job-1', hostId: HOST, key: 'k', now: NOW }
    expect(aiReusableCrmRecord([base], context)?.jobId).toBe('job-0')
    expect(aiReusableCrmRecord([{ ...base, task: 'email' }], context)).toBeNull()
    expect(aiReusableCrmRecord([{ ...base, proposal: null }], context)).toBeNull()
    expect(aiReusableCrmRecord([{ ...base, hostId: null }], context)).toBeNull()
    expect(aiReusableCrmRecord([{ ...base, createdAtMs: NOW.getTime() - 15 * 86_400_000 }], context)).toBeNull()
    expect(aiReusableCrmRecord([base], { ...context, key: 'other' })).toBeNull()
    expect(aiReusableCrmRecord([base], { ...context, jobId: 'job-0' })).toBeNull()
    const newer = { ...base, jobId: 'job-5', createdAtMs: NOW.getTime() - 1_000 }
    const older = { ...base, jobId: 'job-4', createdAtMs: NOW.getTime() - 5_000 }
    expect(aiReusableCrmRecord([older, newer], context)?.jobId).toBe('job-5')
  })

  it('looks answers up by the request key, in the org’s kept answers only', async () => {
    const queries: string[] = []
    const store = {
      collection: (root: string) => ({
        doc: (orgId: string) => ({
          collection: (name: string) => ({
            where: (field: string, op: string, value: string) => ({
              limit: (count: number) => ({
                get: async () => {
                  queries.push(`${root}/${orgId}/${name} ${field} ${op} ${value} limit ${count}`)
                  return {
                    docs: [
                      {
                        id: 'job-0',
                        data: () => ({
                          hostId: HOST,
                          task: 'record',
                          key: 'k',
                          createdAt: { toMillis: () => 1_000 },
                          proposal: { kind: 'record', record: { kind: 'contact', id: 'c-1' }, summary: 'S' },
                        }),
                      },
                      { id: 'job-9', data: () => ({ task: 'mapping', proposal: { kind: 'invoice' } }) },
                    ],
                  }
                },
              }),
            }),
          }),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore
    expect(await findAiCrmAnswersByKey(ORG, 'k', store)).toEqual([
      { jobId: 'job-0', hostId: HOST, task: 'record', key: 'k', createdAtMs: 1_000, proposal: { kind: 'record', record: { kind: 'contact', id: 'c-1' }, summary: 'S' } },
      { jobId: 'job-9', hostId: null, task: 'mapping', key: null, createdAtMs: null, proposal: null },
    ])
    expect(queries).toEqual([`orgs/${ORG}/aiCrmAnswers key == k limit 20`])
    expect(await findAiCrmAnswersByKey(ORG, 'k')).toEqual([])
  })

  it('fails as spent, naming nothing on the job, when the answer cannot be kept', async () => {
    mockRunAiRequest.mockResolvedValueOnce(answer(AI_CRM_RECORD_TOOL_NAME, { summary: 'Dana opened the quote.', nextStep: null }))
    keepFails = true
    const outcome = await runStep()
    expect(outcome).toMatchObject({ failure: AI_CRM_KEEP_FAILURE_COPY, outputs: [], usage: USAGE })
    expect(writes).toEqual([])
  })

  it('fails in the CRM’s own words, spending nothing, when the reader refuses', async () => {
    refusal = { ok: false, status: 403, error: 'Reading CRM records requires the data.manage permission on this site' }
    const outcome = await runStep()
    expect(outcome).toMatchObject({ failure: refusal.error, estCostUsd: 0, outputs: [] })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})

describe('an email draft (AGL-2917)', () => {
  it('sends what the member asked, the merge fields the record can fill and the facts, and never sends anything', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      answer(AI_CRM_EMAIL_TOOL_NAME, {
        subject: 'Your loading dock quote',
        body: 'Hi {{contact.firstName}},\n\nFollowing up on the quote from 2026-09-09.\n\nThanks,\n{{sender.firstName}}',
      }),
    )
    const outcome = await runStep({ brief: 'Follow up on the quote', inputs: { task: 'email', record: 'contact', recordId: 'contact-1' } })
    const [request] = sent()
    expect(request.system[1].text).toBe(AI_CRM_EMAIL_INSTRUCTIONS[0].text)
    expect(request.messages[0].content).toContain('The team member asks: Follow up on the quote')
    expect(request.messages[0].content).toContain('{{contact.firstName}}')
    expect(request.messages[0].content).not.toContain('{{contact.email}}')
    expect(outcome.outputs).toEqual([
      {
        resource: 'crm',
        id: 'email:contact:contact-1',
        hostId: HOST,
        label: 'CRM email draft',
        proposal: { kind: 'email', record: { kind: 'contact', id: 'contact-1' } },
      },
    ])
    expect(keptFor()).toMatchObject({ task: 'email', resource: 'crm.contact', recordId: 'contact-1', key: null })
    expect(readAiCrmProposal(keptFor()?.proposal)).toEqual({
      kind: 'email',
      record: { kind: 'contact', id: 'contact-1' },
      subject: 'Your loading dock quote',
      body: 'Hi {{contact.firstName}},\n\nFollowing up on the quote from 2026-09-09.\n\nThanks,\n{{sender.firstName}}',
    })
  })

  it('refuses a company, which has nobody to write to', async () => {
    const outcome = await runStep({ inputs: { task: 'email', record: 'company', recordId: 'company-1' } })
    expect(outcome.failure).toBe('Open the CRM record this is about first')
    expect(reads).toEqual([])
  })

  it('tells a date from a phone number', () => {
    expect(aiCrmWritesPhoneNumber('We met on 2026-09-09 and 2026-09-12.')).toBe(false)
    expect(aiCrmWritesPhoneNumber('USD 18450.00')).toBe(false)
    expect(aiCrmWritesPhoneNumber('Call +1 (512) 555-0142.')).toBe(true)
  })
})

describe('an import’s columns (AGL-2917)', () => {
  const columns = [
    { header: 'E-mail', shape: 'email' as const },
    { header: 'Full name', shape: 'text' as const },
    { header: 'Renews', shape: 'date' as const },
  ]

  it('sends headers, shapes and the catalog by number, never a cell, and names each match', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      answer(AI_CRM_MAPPING_TOOL_NAME, { matches: [{ column: 2, field: 2 }, { column: 0, field: 0 }, { column: 1, field: 1 }] }),
    )
    const outcome = await runStep({
      brief: 'Match the columns',
      inputs: { task: 'mapping', collection: 'contacts', columns: aiCrmColumnsInput(columns) },
    })
    expect(reads).toMatchObject([{ id: 'contacts' }])
    const [request] = sent()
    expect(request.system[1].text).toBe(AI_CRM_MAPPING_INSTRUCTIONS[0].text)
    expect(request.messages[0].content).toBe(
      [
        'Import: contacts',
        'Fields (number: label, type):',
        '- 0: Email (required), email, required',
        '- 1: Name, text',
        '- 2: Renewal, date',
        'Columns (number: header, shape):',
        '- 0: E-mail, email',
        '- 1: Full name, text',
        '- 2: Renews, date',
      ].join('\n'),
    )
    expect(outcome.outputs).toEqual([
      {
        resource: 'crm',
        id: 'mapping:contacts',
        hostId: HOST,
        label: 'Import column matches',
        proposal: { kind: 'mapping', collection: 'contacts' },
      },
    ])
    expect(keptFor()).toMatchObject({ task: 'mapping', resource: 'crm.import', recordId: 'contacts', key: null })
    expect(readAiCrmProposal(keptFor()?.proposal)).toEqual({
      kind: 'mapping',
      collection: 'contacts',
      columns: 3,
      matches: [
        { column: 0, header: 'E-mail', field: 'email', label: 'Email (required)' },
        { column: 1, header: 'Full name', field: 'name', label: 'Name' },
        { column: 2, header: 'Renews', field: 'custom:renewal', label: 'Renewal' },
      ],
    })
  })
})

describe('the answer each tool accepts fits the routing ceiling, and each refusal is stated (AGL-2917)', () => {
  const chars = (value: unknown) => Math.ceil(JSON.stringify(value).length / 3)

  it('holds the largest record, email and mapping answers under the ceiling at three characters a token', () => {
    const ceiling = AI_ROUTING_TABLE['job.crm'].maxTokens
    const record = {
      summary: 'x'.repeat(AI_CRM_LIMITS.summary),
      nextStep: { title: 'x'.repeat(AI_CRM_LIMITS.taskTitle), kind: 'meeting', priority: 'normal', dueInDays: 30, reason: 'x'.repeat(AI_CRM_LIMITS.reason) },
      stage: { stageId: 'x'.repeat(40), reason: 'x'.repeat(AI_CRM_LIMITS.reason) },
    }
    const email = { subject: 'x'.repeat(AI_CRM_LIMITS.subject), body: `${'x'.repeat(98)}\n\n`.repeat(12).slice(0, AI_CRM_LIMITS.body) }
    const mapping = { matches: Array.from({ length: 60 }, (_, index) => ({ column: index, field: index })) }
    for (const [name, largest] of Object.entries({ record, email, mapping })) {
      expect([name, chars(largest) <= ceiling]).toEqual([name, true])
    }
  })

  it('registers a least time that fits an inline door, from the worst case at the ceiling on its tier', () => {
    registerAiCrmJob()
    expect(aiJobStepRunnerFor('crm')).not.toBeNull()
    expect(aiJobAdmissionFor('crm')).not.toBeNull()
    const tier = AI_STEP_TIERS['job.crm']
    const model = AI_MODEL_CATALOG.find((entry) => entry.tier === tier)?.id as string
    expect(AI_JOB_CRM_STEP_BUDGET.maxTokens(model)).toBe(AI_ROUTING_TABLE['job.crm'].maxTokens)
    expect(aiJobStepMinimumMs('crm', 'generate')).toBe(
      aiGenerationWorstCaseOnTierMs({ tier, maxTokens: AI_ROUTING_TABLE['job.crm'].maxTokens, lookups: 0, ownReadsMs: AI_CRM_FACTS_READS_MS }),
    )
    expect(aiJobStepMinimumMs('crm', 'generate')).toBeLessThanOrEqual(AI_JOB_INLINE_BUDGET_MS)
  })

  it('states in the request every rule its checks refuse an answer for', () => {
    const request = (blocks: Array<{ text: string }>, tool: unknown) =>
      [aiDoctrineSystemBlock('fields').text, ...blocks.map((block) => block.text), JSON.stringify(tool)].join('\n')
    const deal = request(aiCrmRecordInstructions('deal'), aiCrmRecordTool('deal'))
    const lead = request(aiCrmRecordInstructions('lead'), aiCrmRecordTool('lead'))
    const email = request(AI_CRM_EMAIL_INSTRUCTIONS, AI_CRM_EMAIL_TOOL)
    const mapping = request(AI_CRM_MAPPING_INSTRUCTIONS, AI_CRM_MAPPING_TOOL)
    const stated: Array<[string, string, string]> = [
      ['too-long', deal, `At most ${AI_CRM_LIMITS.summary} characters`],
      ['next-step-due', deal, `from 0 to ${AI_CRM_LIMITS.dueInDays}`],
      ['next-step-open', deal, 'null when an open task already covers it'],
      ['stage-unknown', deal, 'by its id in the facts'],
      ['stage-current', deal, 'other than the current one'],
      ['stage-closed', deal, 'always null for a deal that is won or lost'],
      ['stage-won-lost', deal, 'Never propose winning or losing a deal'],
      ['standing', lead, 'There is no lead score; never give one.'],
      ['subject-lines', email, 'One line.'],
      ['merge-field-unknown', email, 'Use no other merge field.'],
      ['contact-detail', email, 'Never write an email address or a phone number.'],
      ['markdown', email, 'no markdown'],
      ['column-unknown', mapping, 'Match a column only to a field the request lists'],
      ['field-twice', mapping, 'A field takes at most one column, and a column one field.'],
      ['shape-mismatch', mapping, 'A column’s shape must suit its field'],
      ['rule 13', mapping, '13. Drafts only.'],
    ]
    for (const [code, text, sentence] of stated) {
      expect([code, text.includes(sentence)]).toEqual([code, true])
    }
  })
})

describe('the admission (AGL-2917)', () => {
  const context = (patch: Record<string, unknown> = {}) =>
    ({
      firestore,
      orgId: ORG,
      hostId: HOST,
      inputs: { task: 'record', record: 'contact', recordId: 'contact-1' },
      org: { plan: 'pro', enabledPlugins: ['crm'] },
      uid: 'uid-1',
      ...patch,
    }) as Parameters<typeof aiCrmAdmissionRefusal>[0]
  const admit = (patch: Record<string, unknown> = {}, deps = {}) =>
    aiCrmAdmissionRefusal(context(patch), { readerFor, now: () => NOW, ...deps })

  it('admits a member the CRM’s reader admits, having asked it as that member', async () => {
    expect(await admit()).toBeNull()
    expect(reads).toMatchObject([{ orgId: ORG, hostId: HOST, id: 'contact-1', uid: 'uid-1' }])
    // The organization level asks the reader with no site.
    reads.length = 0
    expect(await admit({ hostId: null })).toBeNull()
    expect(reads).toMatchObject([{ hostId: null }])
  })

  it('refuses what the inputs lack, a site of another org, and the CRM switched off, unreleased or unregistered', async () => {
    expect(await admit({ inputs: { task: 'record', record: 'invoice', recordId: 'x' } })).toEqual({
      status: 400,
      error: 'Open the CRM record this is about first',
    })
    expect(await admit({ hostId: 'host-9' })).toEqual({ status: 404, error: 'Unknown site' })
    expect(await admit({ org: { plan: 'pro', enabledPlugins: ['mui'] }, hostId: null })).toEqual({
      status: 403,
      error: AI_CRM_UNAVAILABLE_COPY,
    })
    mockReleased.mockResolvedValueOnce([])
    expect(await admit()).toEqual({ status: 403, error: AI_CRM_UNAVAILABLE_COPY })
    expect(await admit({}, { readerFor: () => null })).toEqual({ status: 403, error: AI_CRM_UNAVAILABLE_COPY })
    expect(await admit({}, { readerFor: () => ({ pluginId: 'imposter', reader }) })).toEqual({
      status: 403,
      error: AI_CRM_UNAVAILABLE_COPY,
    })
    expect(reads).toEqual([])
  })

  it('refuses in the reader’s own words, and asks it nothing for a door that names no member', async () => {
    refusal = { ok: false, status: 404, error: 'This contact could not be found. It may have been deleted.' }
    expect(await admit()).toEqual({ status: 404, error: refusal.error })
    reads.length = 0
    expect(await admit({ uid: null })).toBeNull()
    expect(reads).toEqual([])
  })

  it('asks the reader for a verified staff caller as staff, which only the answer door does', async () => {
    const access = { firestore, orgId: ORG, hostId: HOST, resource: 'crm.contact', id: 'contact-1', org: { enabledPlugins: ['crm'] }, readerFor, now: NOW }
    expect(await aiCrmAccessRefusal({ ...access, uid: 'staff-1', staff: true })).toBeNull()
    expect(await aiCrmAccessRefusal({ ...access, uid: 'uid-1' })).toBeNull()
    expect(reads).toEqual([
      { orgId: ORG, hostId: HOST, id: 'contact-1', uid: 'staff-1', staff: true, org: { enabledPlugins: ['crm'] }, now: NOW },
      { orgId: ORG, hostId: HOST, id: 'contact-1', uid: 'uid-1', org: { enabledPlugins: ['crm'] }, now: NOW },
    ])
  })
})

afterEach(() => {
  // The only thing written anywhere is a kept answer, beside its job.
  expect(writes.filter((write) => !/^orgs\/org-1\/aiCrmAnswers\/job-\d+$/.test(write.path))).toEqual([])
})
