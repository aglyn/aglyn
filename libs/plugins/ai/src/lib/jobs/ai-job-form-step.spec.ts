/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * The form step (AGL-2913), against the REAL doctrine loop, validators, form
 * contract, consent reader, draft writer and plan arithmetic: only the
 * provider (at the runtime's `runAiRequest` seam), the routing table's answer,
 * the inventory reader, the host index, the duplicate module and the
 * machine's registry are stubbed, and Firestore is a double that honors
 * transactions and records every path it is asked to read.
 *
 *  - THE GOLDENS. Recorded answers (`fixtures/ai-job-form-goldens.json`), never
 *    a live provider: each is held by the doctrine, written as the draft the
 *    Forms page's Create writes, passes `checkFormContract` as stored and as a
 *    publish unwraps it, and records consent when its box is ticked and only
 *    then.
 *  - WHAT IT SENDS. No email list, contact, CRM record or submission is read
 *    or sent, though the double holds each.
 *  - NOTHING PROMOTED OR PLACED. One form document is written, with no
 *    version, and nothing else names it.
 *  - THE BUDGET. No extended thinking, an answer ceiling no higher than the
 *    other generation steps', and every golden — and any form the output
 *    budget admits — under it with room for the re-ask.
 */

const mockRunAiRequest = jest.fn()
const mockReadInventory = jest.fn()
const mockDocs = new Map<string, Record<string, unknown>>()
const mockOwners = new Map<string, string>()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

// The reader needs the Admin SDK; its own spec drives it.
jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: (...args: unknown[]) => mockReadInventory(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))

// The duplicate module needs the Admin SDK; its own spec drives it, and each
// test here hands the step a double.
jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  __esModule: true,
  duplicateResource: jest.fn(),
}))

// The machine is not under test here — only that the step registers with it.
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canvasTreeToDefinition } from '@aglyn/aglyn/app-utils/definition-canvas-tree'
import { checkFormContract } from '@aglyn/aglyn/app-utils/form-contract'
import {
  formFieldDeclsFromNodes,
  MARKETING_CONSENT_FORM_FIELD,
  normalizeFormSlug,
  readFormDeclaredConsent,
} from '@aglyn/aglyn/app-utils/forms'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_DOCTRINE_SYSTEM_BLOCK } from '../runtime/ai-doctrine'
import { AI_OUTPUT_BUDGETS } from '../runtime/ai-palette'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_DRAFT_ENTITLEMENT_REFUSAL, AI_DRAFT_FIELDS } from './ai-job-drafts'
import {
  AI_FORM_CONSENT_NODE_ID,
  AI_JOB_FORM_INSTRUCTIONS,
  AI_JOB_FORM_MAX_TOKENS,
  AI_JOB_FORM_TOOL,
  aiFormOutputNote,
  aiJobFormPrompt,
  createAiJobFormStep,
  parseAiFormAnswer,
  runAiJobFormStep,
  registerAiFormJob,
  AI_JOB_FORM_STEP_BUDGET,
  AI_JOB_FORM_STEP_MINIMUM_MS,
} from './ai-job-form-step'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import { AI_JOB_LAYOUT_MAX_TOKENS } from './ai-job-layout-step'
import { registerAiJobStep } from './ai-jobs'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'

const NOW = new Date('2026-09-15T22:00:00.000Z')
/** A workspace with no plan resolves as Free, which has no forms. */
const FREE_ORG = {}
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const USAGE = { inputTokens: 2_400, outputTokens: 700, cacheReadTokens: 4_000, cacheWriteTokens: 0 }

interface Golden {
  brief: string
  name: string
  answer: { tree: { rootId: string; nodes: Record<string, unknown> }; routing: unknown; cannotCollect: unknown }
}

/** Recorded answers, read as they are stored: a golden is data, never a call. */
const GOLDENS = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ai-job-form-goldens.json'), 'utf8'),
) as Record<string, Golden>

// ── Firestore double ─────────────────────────────────────────────────────

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      data,
    )
}

function snapshotOf(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? valueAt(data, field) : undefined),
  }
}

type DocTarget = { kind: 'doc'; path: string }
type QueryTarget = { kind: 'query'; get: () => Promise<{ docs: Array<ReturnType<typeof snapshotOf>> }> }

/** Every document or collection path the step asked to read, in order. */
let reads: string[] = []
/** The paths the double committed, in the order it committed them. */
let commits: string[] = []

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => {
      reads.push(path)
      return snapshotOf(path)
    },
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const query: QueryTarget = {
    kind: 'query',
    get: async () => {
      reads.push(path)
      return {
        docs: [...mockDocs.keys()]
          .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .sort()
          .map(snapshotOf),
      }
    },
  }
  return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, get: query.get }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await fn({
      get: async (target: DocTarget | QueryTarget) => {
        if (target.kind === 'query') return target.get()
        reads.push(target.path)
        return snapshotOf(target.path)
      },
      create: (ref: DocTarget, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (mockDocs.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      mockDocs.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

// ── Fixtures ─────────────────────────────────────────────────────────────

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  forms: [{ id: 'frm-contact', name: 'Contact', fields: ['name', 'email', 'message'] }],
}

/** The plan a member confirmed for a golden: create that form, and nothing else. */
function planFor(golden: Golden): AiJobPlan {
  return {
    reuse: [],
    create: [
      {
        kind: 'form',
        name: golden.name,
        why: 'The site has no form for this yet.',
        duplicateOf: null,
        fields: [],
      },
    ],
    screens: [],
    status: 'confirmed',
    labels: {},
    proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
    confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
    confirmedBy: 'uid-1',
  }
}

/** The id the job recorded for its form when it was created (AGL-3079). */
const FORM_ID = 'drftFormId'

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'form',
    status: 'running',
    brief: GOLDENS['roofingQuote'].brief,
    inputs: {},
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 3 },
      { name: 'generate', status: 'running', creditsSpent: 0, draftIds: { form: FORM_ID } },
    ],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 3,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: planFor(GOLDENS['roofingQuote']),
    review: null,
    ...patch,
  } as AiJob
}

/** A golden's answer as the provider hands it back: the tree as JSON text, as the strict tool carries it. */
function completion(answer: Golden['answer'], patch: Record<string, unknown> = {}) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [
      {
        name: 'submit_form',
        input: { ...answer, tree: JSON.stringify(answer.tree), ...patch },
      },
    ],
    usage: USAGE,
    estCostUsd: 0.01,
    stopReason: 'tool_use',
  }
}

const context = (patch: Partial<AiJob> = {}) => ({ job: job(patch), stepIndex: 1, now: NOW, firestore })

/** The job for one golden: its brief and the plan that creates its form. */
const goldenJob = (key: string) => ({ brief: GOLDENS[key].brief, plan: planFor(GOLDENS[key]) })

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
  mockDocs.clear()
  mockOwners.clear()
  reads = []
  commits = []
  mockOwners.set('host-1', 'org-1')
  mockDocs.set('hosts/host-1', { subdomain: 'acme' })
  mockDocs.set('orgs/org-1', STARTER_ORG)
})

// ── The goldens ──────────────────────────────────────────────────────────

/** What each golden must come out as. */
const EXPECTED: Record<
  string,
  { fields: string[]; consent: boolean; routing: Record<string, unknown> | undefined; note: string | null }
> = {
  roofingQuote: {
    fields: [
      'fullName',
      'email',
      'phone',
      'propertyAddress',
      'roofType',
      'service',
      'damageDescription',
      'marketingConsent',
    ],
    consent: true,
    routing: { lead: true },
    note:
      'Each submission with an email address also files a lead in CRM → Leads; you can switch that off on the form’s page. ' +
      'Forms cannot collect photo upload yet, so this form leaves it out.',
  },
  newsletterSignup: {
    // The subscribe box the model drew gives way to the platform's own.
    fields: ['firstName', 'email', 'marketingConsent'],
    consent: true,
    routing: undefined,
    note:
      'Submissions arrive in the Inbox. To add the people who tick "Marketing emails" to your "Monthly Roundup" list, add an action on form submissions in Automation that enrolls them.',
  },
  clinicSurvey: {
    fields: ['satisfaction', 'visitFrequency', 'improvements', 'comments'],
    consent: false,
    routing: undefined,
    note: null,
  },
}

describe.each(Object.keys(EXPECTED))('the %s golden', (key) => {
  const golden = GOLDENS[key]
  const expected = EXPECTED[key]

  it('is held by the doctrine and the form contract, and written as the draft the Forms page’s Create writes', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(golden.answer))
    const outcome = await createAiJobFormStep()(context(goldenJob(key)))

    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(outcome.review).toBeUndefined()
    expect(outcome.outputs).toEqual([
      {
        resource: 'form',
        id: FORM_ID,
        versionId: null,
        hostId: 'host-1',
        hostSubdomain: 'acme',
        label: golden.name,
        load: expect.objectContaining({ pageBytes: 0, embeds: 0 }),
        ...(expected.note ? { note: expected.note } : {}),
      },
    ])
    expect(commits).toEqual([`hosts/host-1/forms/${FORM_ID}`])

    const stored = mockDocs.get(`hosts/host-1/forms/${FORM_ID}`) ?? {}
    const stamps = ['createdAt', 'updatedAt', 'createdBy']
    for (const field of Object.keys(stored).filter((name) => !stamps.includes(name))) {
      expect([field, AI_DRAFT_FIELDS.form.includes(field)]).toEqual([field, true])
    }
    expect(stored).toMatchObject({
      displayName: golden.name,
      slug: normalizeFormSlug(golden.name),
      rootId: CANVAS_ROOT_ELEMENT_ID,
      createdBy: 'uid-1',
    })
    expect(stored).not.toHaveProperty('versionId')
    expect(stored['routing']).toEqual(expected.routing)

    // The design, canvas-shaped, with the form bound to the new form's id.
    const nodes = decodeStoredNodes<Record<string, any>>(stored['nodes']) ?? {}
    const [formNodeId] = nodes[CANVAS_ROOT_ELEMENT_ID].nodes as string[]
    expect(nodes[formNodeId]).toMatchObject({
      componentId: 'form',
      parentId: CANVAS_ROOT_ELEMENT_ID,
      props: { formId: FORM_ID, formName: golden.name },
    })

    // The declaration is the design's own, so the two agree.
    expect(stored['fields']).toEqual(formFieldDeclsFromNodes(nodes, formNodeId))
    expect((stored['fields'] as Array<{ fieldName: string }>).map((field) => field.fieldName)).toEqual(
      expected.fields,
    )
    expect(checkFormContract({ form: stored as never, formId: FORM_ID, nodes, formNodeId })).toEqual([])
    // A publish unwraps the canvas root before it checks; the unwrapped design passes too.
    const definition = canvasTreeToDefinition(nodes)
    expect(definition.ambiguousRoot).toBe(false)
    expect(
      checkFormContract({
        form: stored as never,
        formId: FORM_ID,
        nodes: definition.nodes,
        formNodeId: definition.rootId,
      }),
    ).toEqual([])

    if (expected.consent) {
      expect(stored['consentFieldName']).toBe(MARKETING_CONSENT_FORM_FIELD.fieldName)
      expect(nodes[AI_FORM_CONSENT_NODE_ID]).toMatchObject({
        componentId: 'formField',
        parentId: formNodeId,
        props: { ...MARKETING_CONSENT_FORM_FIELD },
      })
      const declared = {
        consentFieldName: String(stored['consentFieldName']),
        fields: stored['fields'] as never,
      }
      // Ticked, the box posts its option's text, which the submit route reads as consent.
      expect(
        readFormDeclaredConsent(declared, {
          email: 'visitor@example.com',
          [MARKETING_CONSENT_FORM_FIELD.fieldName]: MARKETING_CONSENT_FORM_FIELD.options,
        }),
      ).toBe(true)
      expect(readFormDeclaredConsent(declared, { email: 'visitor@example.com' })).toBe(false)
      // No box the model drew under a consent name survives beside it.
      const consentLike = Object.values(nodes).filter((node) =>
        ['subscribe', 'newsletterOptIn', 'emailOptIn'].includes(String(node?.props?.fieldName)),
      )
      expect(consentLike).toEqual([])
    } else {
      expect(stored).not.toHaveProperty('consentFieldName')
      expect(nodes[AI_FORM_CONSENT_NODE_ID]).toBeUndefined()
    }
  })
})

// ── The step ─────────────────────────────────────────────────────────────

describe('the form step', () => {
  it('registers the form runner, with the admission the create and resume doors ask', async () => {
    registerAiFormJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('form', runAiJobFormStep, {
      minimumMs: AI_JOB_FORM_STEP_MINIMUM_MS,
    })
    const ask = (hostId: string | null, org: object) =>
      aiJobAdmissionRefusal('form', { firestore, orgId: 'org-1', hostId, inputs: {}, org })
    expect(await ask(null, STARTER_ORG)).toEqual({
      status: 400,
      error: 'Open the site the form is for before starting the job',
    })
    expect(await ask('host-1', FREE_ORG)).toEqual({ status: 403, error: AI_DRAFT_ENTITLEMENT_REFUSAL })
    expect(await ask('host-1', STARTER_ORG)).toBeNull()
  })

  it('asks under the doctrine with the form tool, no extended thinking and the form’s answer ceiling', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['roofingQuote'].answer))
    await createAiJobFormStep()(context())
    expect(mockReadInventory).toHaveBeenCalledWith('org-1', 'host-1', { firestore })
    const [request] = mockRunAiRequest.mock.calls[0]
    expect(request).toMatchObject({
      model: 'routed-model',
      tools: [AI_JOB_FORM_TOOL, aiInventoryLookupTool()],
      maxTokens: AI_JOB_FORM_STEP_BUDGET.maxTokens('routed-model'),
      thinking: 'off',
      stream: false,
      messages: [
        {
          role: 'user',
          content: aiJobFormPrompt(job(), planFor(GOLDENS['roofingQuote']), 'Roof quote request'),
        },
      ],
    })
    expect(request.system).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      AI_JOB_FORM_INSTRUCTIONS[0],
      { text: AI_PALETTE_CATALOG.form, cacheBreakpoint: true },
      expect.objectContaining({ volatile: true }),
    ])
    expect(() => validateAiSystemBlocks(request.system)).not.toThrow()
  })

  it('runs on the model the switch resolves for the job, and reports it', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['roofingQuote'].answer))
    const modelFor = jest.fn((kind: string) => (kind === 'job.form' ? 'picked-model' : undefined))
    const outcome = await createAiJobFormStep()({ ...context(), modelFor })
    expect(modelFor).toHaveBeenCalledWith('job.form')
    expect(mockRunAiRequest.mock.calls[0][0].model).toBe('picked-model')
    expect(outcome.model).toBe('picked-model')
  })

  it('asks once more with the contract named, then stops for review, when a lead meets a form with no email field', async () => {
    const lead = completion(GOLDENS['clinicSurvey'].answer, { routing: { kind: 'lead', list: null } })
    mockRunAiRequest.mockResolvedValueOnce(lead).mockResolvedValueOnce(lead)
    const outcome = await createAiJobFormStep()(context(goldenJob('clinicSurvey')))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const reask = mockRunAiRequest.mock.calls[1][0].messages[2].content as string
    expect(reask).toContain('Rule 3')
    expect(reask).toContain('no email field')
    // The form is named by the id the model wrote for it.
    expect(reask).toContain('nodes survey')
    expect(outcome.outputs).toEqual([])
    expect(outcome.usage.inputTokens).toBe(USAGE.inputTokens * 2)
    expect(outcome.review).toEqual({
      reason: 'doctrine',
      message: expect.stringContaining('Rule 3'),
      findings: [{ rule: 3, code: 'lead-routing-has-no-email-field', message: expect.any(String), nodeIds: ['survey'] }],
      // The form, and each field under it by the names of what it sets, never a label (AGL-3078).
      outline: [
        expect.objectContaining({ id: 'survey', depth: 0, componentId: 'form', children: Array(4).fill('formField') }),
        ...['satisfaction', 'frequency', 'improve', 'comments'].map((id) =>
          expect.objectContaining({ id, depth: 1, componentId: 'formField', props: expect.arrayContaining(['fieldName', 'label', 'fieldType']) }),
        ),
      ],
    })
    expect(commits).toEqual([])
  })

  it('keeps the answer to its re-ask when that answer mends what the first one broke', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(
        completion(GOLDENS['clinicSurvey'].answer, { routing: { kind: 'list', list: null } }),
      )
      .mockResolvedValueOnce(completion(GOLDENS['clinicSurvey'].answer))
    const outcome = await createAiJobFormStep()(context(goldenJob('clinicSurvey')))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(mockRunAiRequest.mock.calls[1][0].messages[2].content).toContain('asks for no email address')
    expect(outcome.review).toBeUndefined()
    expect(commits).toEqual([`hosts/host-1/forms/${FORM_ID}`])
  })

  it('reports a declined brief as refused, and writes nothing', async () => {
    mockRunAiRequest.mockResolvedValueOnce({
      kind: 'refusal',
      text: '',
      usage: USAGE,
      estCostUsd: 0.001,
      stopReason: 'refusal',
    })
    const outcome = await createAiJobFormStep()(context())
    expect(outcome).toMatchObject({ refused: true, outputs: [], estCostUsd: 0.001 })
    expect(commits).toEqual([])
  })

  it('stops for the member, spending nothing, when the site’s plan has no forms', async () => {
    mockDocs.set('orgs/org-1', FREE_ORG)
    const outcome = await createAiJobFormStep()(context())
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      outputs: [],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
      model: 'routed-model',
      stopReason: null,
      review: { reason: 'limit', message: AI_DRAFT_ENTITLEMENT_REFUSAL, findings: [] },
    })
  })

  it('stops for the member, with its spend recorded, when the last form was taken while it generated', async () => {
    mockDocs.set('orgs/org-1', { ...STARTER_ORG, entitlements: { formsPerHost: 1 } })
    mockRunAiRequest.mockImplementationOnce(async () => {
      mockDocs.set('hosts/host-1/forms/frm-meanwhile', { displayName: 'Made meanwhile' })
      return completion(GOLDENS['roofingQuote'].answer)
    })
    const outcome = await createAiJobFormStep()(context())
    expect(outcome).toMatchObject({
      outputs: [],
      usage: USAGE,
      estCostUsd: 0.01,
      review: { reason: 'limit', message: 'Your plan includes 1 forms — upgrade in Billing for more' },
    })
    expect(commits).toEqual([])
  })

  it('adds the facts in square brackets the form shows after what the member decides (AGL-3056)', async () => {
    const golden = GOLDENS['newsletterSignup']
    const answer = structuredClone(golden.answer) as Golden['answer'] & { tree: { nodes: Record<string, { props?: Record<string, unknown> }> } }
    answer.tree.nodes['signup'].props = { ...answer.tree.nodes['signup'].props, successMessage: 'Thanks. Your first issue arrives on [send day].' }
    mockRunAiRequest.mockResolvedValueOnce(completion(answer))
    const outcome = await createAiJobFormStep()(context(goldenJob('newsletterSignup')))
    expect(outcome.outputs[0]?.note).toBe(
      `${EXPECTED['newsletterSignup'].note} Before you publish, replace the facts in square brackets, which the brief did not give: [send day].`,
    )
  })

  it('reports the draft an earlier run wrote, without asking the model again', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['roofingQuote'].answer))
    await createAiJobFormStep()(context())
    const again = await createAiJobFormStep()(context())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(again.outputs).toEqual([
      {
        resource: 'form',
        id: FORM_ID,
        versionId: null,
        hostId: 'host-1',
        hostSubdomain: 'acme',
        label: 'Roof quote request',
      },
    ])
    expect(again).toMatchObject({ usage: AI_JOB_ZERO_USAGE, estCostUsd: 0 })
    expect(commits).toEqual([`hosts/host-1/forms/${FORM_ID}`])
  })

  it('copies the form a confirmed plan starts from through the duplicate module, and generates nothing', async () => {
    const base = planFor(GOLDENS['roofingQuote'])
    const plan: AiJobPlan = { ...base, create: [{ ...base.create[0], duplicateOf: 'frm-contact' }] }
    const duplicate = jest
      .fn()
      .mockResolvedValue({ ok: true, id: 'frm-copy', versionId: 'v-copy', name: 'Roof quote request' })
    const outcome = await createAiJobFormStep({
      duplicate: duplicate as unknown as typeof duplicateResource,
    })(context({ plan }))
    expect(duplicate).toHaveBeenCalledWith('form', {
      orgId: 'org-1',
      hostId: 'host-1',
      sourceId: 'frm-contact',
      name: 'Roof quote request',
      uid: 'uid-1',
      org: STARTER_ORG,
    })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      outputs: [
        {
          resource: 'form',
          id: 'frm-copy',
          versionId: 'v-copy',
          hostId: 'host-1',
          hostSubdomain: 'acme',
          label: 'Roof quote request',
        },
      ],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
      model: 'routed-model',
      stopReason: null,
    })
  })
})

describe('what the form step sends', () => {
  const SENTINELS = [
    'Spring Promo Subscribers',
    'dana.lead@example.com',
    'Okonkwo Holdings',
    'the porch ceiling leaks when it rains',
  ]

  it('sends the brief, the plan and the site inventory, and reads no list, contact, CRM record or submission', async () => {
    mockDocs.set('orgs/org-1/lists/list-1', { name: SENTINELS[0] })
    mockDocs.set('orgs/org-1/lists/list-1/members/member-1', { email: SENTINELS[1] })
    mockDocs.set('orgs/org-1/contacts/contact-1', { email: SENTINELS[1], company: SENTINELS[2] })
    mockDocs.set('orgs/org-1/deals/deal-1', { name: SENTINELS[2] })
    mockDocs.set('orgs/org-1/companies/company-1', { name: SENTINELS[2] })
    mockDocs.set('hosts/host-1/leads/lead-1', { email: SENTINELS[1] })
    mockDocs.set('hosts/host-1/formSubmissions/submission-1', { fields: { message: SENTINELS[3] } })
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['newsletterSignup'].answer))

    const outcome = await createAiJobFormStep()(context(goldenJob('newsletterSignup')))
    expect(outcome.outputs).toHaveLength(1)

    const sent = JSON.stringify(mockRunAiRequest.mock.calls)
    for (const sentinel of SENTINELS) {
      expect([sentinel, sent.includes(sentinel)]).toEqual([sentinel, false])
    }
    // The list the brief names travels only as the brief's own words.
    expect(sent).toContain('Monthly Roundup')
    expect([...new Set(reads)].sort()).toEqual(
      ['hosts/host-1', 'hosts/host-1/forms', `hosts/host-1/forms/${FORM_ID}`, 'orgs/org-1'].sort(),
    )
  })
})

describe('nothing is promoted or placed', () => {
  it('writes one form document, with no version, and changes and names nothing else', async () => {
    mockDocs.set('hosts/host-1', { subdomain: 'acme', screens: { 'scr-home': '/' } })
    mockDocs.set('hosts/host-1/screens/scr-home', { displayName: 'Home', versionId: 'v-home' })
    mockDocs.set('hosts/host-1/forms/frm-contact', { displayName: 'Contact', versionId: 'v-contact' })
    mockDocs.set('hosts/host-1/components/cmp-hero', { displayName: 'Hero', versionId: 'v-hero' })
    mockDocs.set('hosts/host-1/layouts/lay-site', { displayName: 'Site layout', versionId: 'v-site' })
    const before = new Map([...mockDocs].map(([path, data]) => [path, JSON.stringify(data)]))
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['roofingQuote'].answer))

    await createAiJobFormStep()(context())

    expect(commits).toEqual([`hosts/host-1/forms/${FORM_ID}`])
    for (const [path, data] of before) {
      expect([path, JSON.stringify(mockDocs.get(path))]).toEqual([path, data])
    }
    for (const [path, data] of mockDocs) {
      if (path === `hosts/host-1/forms/${FORM_ID}`) continue
      expect([path, JSON.stringify(data).includes(FORM_ID)]).toEqual([path, false])
    }
    expect(mockDocs.get(`hosts/host-1/forms/${FORM_ID}`)).not.toHaveProperty('versionId')
  })
})

describe('the form step’s budget', () => {
  it('runs without extended thinking, under an answer ceiling no higher than the other generation steps’', async () => {
    expect(AI_JOB_FORM_MAX_TOKENS).toBeLessThanOrEqual(AI_JOB_LAYOUT_MAX_TOKENS)
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['clinicSurvey'].answer))
    await createAiJobFormStep()(context(goldenJob('clinicSurvey')))
    expect(mockRunAiRequest.mock.calls[0][0]).toMatchObject({
      thinking: 'off',
      maxTokens: AI_JOB_FORM_STEP_BUDGET.maxTokens('routed-model'),
    })
  })

  it('fits each golden, and any form the output budget admits, under that ceiling with room for the re-ask', () => {
    /** The doctrine's own estimate: characters over four. */
    const tokens = (characters: number) => Math.ceil(characters / 4)
    let charactersPerStoredByte = 0
    for (const golden of Object.values(GOLDENS)) {
      // The answer as the model writes it: the tree as JSON text inside the tool's JSON.
      const answer = JSON.stringify({ ...golden.answer, tree: JSON.stringify(golden.answer.tree) })
      expect(tokens(answer.length)).toBeLessThanOrEqual(AI_JOB_FORM_MAX_TOKENS / 2)
      const storedBytes = encodeStoredNodes(golden.answer.tree.nodes as never)?.byteLength ?? 0
      expect(storedBytes).toBeGreaterThan(0)
      charactersPerStoredByte = Math.max(charactersPerStoredByte, answer.length / storedBytes)
    }
    // The largest form the doctrine admits, written at the wordiest ratio a golden shows.
    expect(tokens(AI_OUTPUT_BUDGETS.form.bytes * charactersPerStoredByte)).toBeLessThanOrEqual(
      AI_JOB_FORM_MAX_TOKENS,
    )
  })
})

describe('parseAiFormAnswer', () => {
  it('reads an unknown routing as the Inbox, a list name only for a list, and at most three short gaps', () => {
    expect(parseAiFormAnswer({})).toEqual({ routing: { kind: 'inbox', list: null }, cannotCollect: [] })
    expect(parseAiFormAnswer({ routing: { kind: 'mailing', list: 'VIPs' } }).routing).toEqual({
      kind: 'inbox',
      list: null,
    })
    expect(parseAiFormAnswer({ routing: { kind: 'lead', list: 'VIPs' } }).routing).toEqual({
      kind: 'lead',
      list: null,
    })
    expect(parseAiFormAnswer({ routing: { kind: 'list', list: '  Monthly   Roundup ' } }).routing).toEqual({
      kind: 'list',
      list: 'Monthly Roundup',
    })
    expect(
      parseAiFormAnswer({
        cannotCollect: ['photo upload', 'Photo upload', '', 7, 'signature', 'payment', 'video'],
      }).cannotCollect,
    ).toEqual(['photo upload', 'signature', 'payment'])
  })
})

describe('aiFormOutputNote', () => {
  it('says nothing for a form that routes to the Inbox and collects all it was asked for', () => {
    expect(aiFormOutputNote(parseAiFormAnswer({ routing: { kind: 'inbox', list: null } }))).toBeNull()
  })

  it('names a list only when the brief did, and joins several gaps in one sentence', () => {
    expect(aiFormOutputNote(parseAiFormAnswer({ routing: { kind: 'list', list: null } }))).toBe(
      'Submissions arrive in the Inbox. To add the people who tick "Marketing emails" to an email list, add an action on form submissions in Automation that enrolls them.',
    )
    expect(aiFormOutputNote(parseAiFormAnswer({ cannotCollect: ['photo upload', 'signature', 'payment'] }))).toBe(
      'Forms cannot collect photo upload, signature and payment yet, so this form leaves them out.',
    )
  })
})

describe('aiJobFormPrompt', () => {
  it('names the form, states the brief, and gives the confirmed plan as references', () => {
    expect(aiJobFormPrompt(job(), planFor(GOLDENS['roofingQuote']), 'Roof quote request')).toBe(
      [
        'Form name: Roof quote request',
        `Brief: ${GOLDENS['roofingQuote'].brief}`,
        'Confirmed plan:',
        '- create the form "Roof quote request": The site has no form for this yet.',
      ].join('\n'),
    )
    expect(aiJobFormPrompt(job(), null, 'New form')).toBe(
      `Form name: New form\nBrief: ${GOLDENS['roofingQuote'].brief}`,
    )
  })

  it('names who fills it in and where its submissions go, where the person was asked (AGL-2918)', () => {
    expect(
      aiJobFormPrompt(job(), null, 'New form', {
        audience: 'homeowners with a roof over fifteen years old',
        submissions: 'lead',
      }),
    ).toBe(
      [
        'Form name: New form',
        'The people who fill it in: homeowners with a roof over fifteen years old',
        'Where its submissions go: the Inbox, and each one with an email address is a sales lead — routing.kind is lead',
        `Brief: ${GOLDENS['roofingQuote'].brief}`,
      ].join('\n'),
    )
  })

  it('says neither for a form job nobody asked, and adds no blank line saying so', () => {
    const asked = aiJobFormPrompt(job(), null, 'New form', { audience: '  ', submissions: null })
    expect(asked).toBe(aiJobFormPrompt(job(), null, 'New form'))
    expect(asked).not.toContain('\n\n')
  })
})

/*
 * Where submissions go (AGL-2918). The guided start asks; whether a message
 * is a note to read or a lead to chase is a fact about a business, so the
 * answer BINDS the routing the form is written with instead of joining the
 * evidence the model weighs.
 */
describe('the person’s answer about where submissions go', () => {
  it('replaces the routing the model proposed, in both directions', () => {
    const proposed = { routing: { kind: 'lead', list: null } }
    expect(parseAiFormAnswer(proposed, { submissions: 'inbox' }).routing).toEqual({
      kind: 'inbox',
      list: null,
    })
    expect(parseAiFormAnswer({ routing: { kind: 'inbox', list: null } }, { submissions: 'lead' }).routing).toEqual({
      kind: 'lead',
      list: null,
    })
  })

  it('leaves the model’s proposal standing where nobody was asked', () => {
    // Every job created before the question existed, and the agency batch,
    // which does not ask it.
    for (const decisions of [undefined, { submissions: null }] as const) {
      expect(parseAiFormAnswer({ routing: { kind: 'lead', list: null } }, decisions).routing).toEqual({
        kind: 'lead',
        list: null,
      })
    }
  })

  it('writes the stored routing from the answer, not from what the model said', async () => {
    // The golden routes to leads. The person said the Inbox, so the stored
    // form has no lead routing and says nothing about CRM.
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['roofingQuote'].answer))
    const outcome = await createAiJobFormStep()(
      context({ ...goldenJob('roofingQuote'), inputs: { submissions: 'inbox' } }),
    )
    expect(mockDocs.get(`hosts/host-1/forms/${FORM_ID}`)?.['routing']).toBeUndefined()
    expect(outcome.outputs[0]?.note ?? '').not.toContain('CRM')
  })

  it('files leads where the person asked for them, on a golden that proposed none', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['newsletterSignup'].answer))
    const outcome = await createAiJobFormStep()(
      context({ ...goldenJob('newsletterSignup'), inputs: { submissions: 'lead' } }),
    )
    expect(outcome.review).toBeUndefined()
    expect(mockDocs.get(`hosts/host-1/forms/${FORM_ID}`)?.['routing']).toEqual({ lead: true })
    expect(outcome.outputs[0]?.note ?? '').toContain('files a lead in CRM → Leads')
  })

  it('tells the model where they go, so it does not spend its answer on a routing that will be replaced', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(GOLDENS['roofingQuote'].answer))
    await createAiJobFormStep()(
      context({
        ...goldenJob('roofingQuote'),
        inputs: { submissions: 'inbox', audience: 'homeowners with an older roof' },
      }),
    )
    const turn = mockRunAiRequest.mock.calls[0][0].messages[0].content as string
    expect(turn).toContain('Where its submissions go: the Inbox, to be read')
    expect(turn).toContain('The people who fill it in: homeowners with an older roof')
  })

  it('asks again with the contract named when the person’s lead meets a form with no email field', async () => {
    // The clinic survey asks for no address. The person chose leads, so the
    // contract's own rule is what tells the model to add one — the decision
    // reaches the design through the check, not around it.
    const survey = completion(GOLDENS['clinicSurvey'].answer)
    mockRunAiRequest.mockResolvedValueOnce(survey).mockResolvedValueOnce(survey)
    const outcome = await createAiJobFormStep()(
      context({ ...goldenJob('clinicSurvey'), inputs: { submissions: 'lead' } }),
    )
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(mockRunAiRequest.mock.calls[1][0].messages[2].content).toContain('no email field')
    expect(outcome.review?.reason).toBe('doctrine')
    expect(commits).toEqual([])
  })
})
