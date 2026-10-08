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
 * The logic step (AGL-3603). Its promises, each held against the request the
 * provider would receive:
 *
 *  - A function or a variable is PROPOSED, never written: it rides on a
 *    `logic` output for the editor to open, after the grammar, the names and
 *    a first run have passed; an answer that fails is re-asked, naming why.
 *    The one exception is a new function a confirmed build asked for, which
 *    is written through the logic plugin's `function` writer (AGL-3616).
 *  - A change or an explanation reads the saved function by id on the job's
 *    own site, as an outline of its definition.
 *  - A site of another org, a site with Logic off, or a function that is gone
 *    spends nothing.
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
}))

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: readonly string[]) => [...ids],
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import type { HostFunction } from '@aglyn/aglyn/app-utils/functions'
import type { AiJob } from '../model/ai-jobs.types'
import {
  AI_LOGIC_FUNCTION_UNAVAILABLE_COPY,
  AI_LOGIC_FUNCTION_WRITTEN_NOTE,
  AI_LOGIC_GONE_COPY,
  AI_LOGIC_NO_FUNCTION_COPY,
  AI_LOGIC_NO_SITE_COPY,
  AI_LOGIC_UNAVAILABLE_COPY,
} from '../model/ai-logic-job'
import { AI_ROUTING_TABLE } from '../providers/routing'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_LOGIC_STEP_BUDGET,
  AI_JOB_LOGIC_STEP_MINIMUM_MS,
  createAiJobLogicStep,
  createAiLogicJobAdmission,
  registerAiLogicJob,
  runAiJobLogicStep,
} from './ai-job-logic-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-06T20:00:00.000Z')
const USAGE = { inputTokens: 700, outputTokens: 600, cacheReadTokens: 1_500, cacheWriteTokens: 0 }
const PRO = { plan: 'pro', billingStatus: 'active', enabledPlugins: ['logic'] }

const docs = new Map<string, Record<string, unknown>>()
const snapshotOf = (path: string) => {
  const data = docs.get(path)
  return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}
const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({ get: async () => snapshotOf(`${name}/${id}`) }),
  }),
} as unknown as FirebaseFirestore.Firestore

const RECORDS = {
  variables: [
    { name: 'free_shipping_over', type: 'number' as const, value: '75' },
    { name: 'flat_rate', type: 'number' as const, value: '6' },
  ],
  functions: ['priceWithTax'],
}
const SAVED: HostFunction = {
  name: 'shippingQuote',
  parameters: [{ name: 'order_total', type: 'number', required: true }],
  variables: [{ name: 'quote', type: 'number' }],
  operations: [
    {
      if: { left: 'order_total', comparator: '>=', right: 'free_shipping_over' },
      then: [{ set: 'quote', expression: '0' }],
      otherwise: [{ set: 'quote', expression: 'flat_rate' }],
    },
  ],
  returnValue: 'quote',
}

const ANSWER = {
  name: 'shippingQuote',
  parameters: [{ name: 'order_total', type: 'number', required: true, label: 'Order total', defaultValue: '' }],
  locals: [{ name: 'quote', type: 'number' }],
  operations: [
    {
      if: { left: 'order_total', comparator: '>=', right: 'free_shipping_over' },
      then: [{ set: 'quote', expression: '0' }],
      otherwise: [{ set: 'quote', expression: 'flat_rate + 2' }],
    },
  ],
  returnValue: 'quote',
}

function completion(input: unknown, name = 'submit_function') {
  return { kind: 'completion', text: '', toolUse: [{ name, input }], usage: USAGE, estCostUsd: 0.01, stopReason: 'tool_use' }
}

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'logic',
    status: 'running',
    brief: 'A shipping quote: free over the threshold, otherwise the flat rate plus 2.',
    inputs: {},
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 20,
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

let saved: HostFunction | null = null
const readRecords = jest.fn(async () => RECORDS)
const readFunction = jest.fn(async () => saved)
const runStep = (patch: Partial<AiJob> = {}) =>
  createAiJobLogicStep({ readRecords, readFunction })({ job: job(patch), stepIndex: 0, now: NOW, firestore, org: PRO } as never)
const userTurn = (call = 0) => mockRunAiRequest.mock.calls[call][0].messages[0].content as string

beforeEach(() => {
  mockRunAiRequest.mockReset()
  readRecords.mockClear()
  readFunction.mockClear()
  mockOwners.clear()
  docs.clear()
  saved = null
  mockOwners.set('host-1', 'org-1')
  docs.set('hosts/host-1', { orgId: 'org-1', subdomain: 'brightside', enabledPlugins: ['logic'] })
})

describe('registration', () => {
  it('registers the logic runner with the least time its generation needs', () => {
    registerAiLogicJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('logic', runAiJobLogicStep, { minimumMs: AI_JOB_LOGIC_STEP_MINIMUM_MS })
    expect(AI_JOB_LOGIC_STEP_MINIMUM_MS).toBe(AI_JOB_LOGIC_STEP_BUDGET.minimumMs)
  })
})

describe('proposing a function', () => {
  it('proposes a function that passed the grammar, the names and a first run, writing nothing', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep()
    expect(outcome.failure).toBeUndefined()
    expect(outcome.outputs).toEqual([
      expect.objectContaining({
        resource: 'logic',
        id: 'function',
        hostId: 'host-1',
        hostSubdomain: 'brightside',
        label: 'shippingQuote',
        proposal: {
          kind: 'function',
          functionId: null,
          definition: {
            name: 'shippingQuote',
            parameters: [{ name: 'order_total', type: 'number', required: true, label: 'Order total' }],
            variables: [{ name: 'quote', type: 'number' }],
            operations: ANSWER.operations,
            returnValue: 'quote',
          },
        },
      }),
    ])
    const user = userTurn()
    expect(user).toContain('- free_shipping_over (number) = 75')
    expect(user).toContain('Function names already on the site: priceWithTax')
    expect(user).toContain('Request: A shipping quote')
  })

  it('re-asks an answer reading a name the site does not have, naming it, and keeps the one that does not', async () => {
    const wrong = {
      ...ANSWER,
      operations: [{ ...ANSWER.operations[0], if: { ...ANSWER.operations[0].if, right: 'shipping_threshold' } }],
    }
    mockRunAiRequest.mockResolvedValueOnce(completion(wrong)).mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(mockRunAiRequest.mock.calls[1][0].messages)).toContain('shipping_threshold')
    expect(outcome.outputs[0].resource).toBe('logic')
  })

  it('fails, having spent, when the re-ask breaks the grammar too', async () => {
    const broken = { ...ANSWER, operations: [{ ...ANSWER.operations[0], then: [{ set: 'quote', expression: '(1' }] }] }
    mockRunAiRequest.mockResolvedValue(completion(broken))
    const outcome = await runStep()
    expect(outcome.failure).toBe(AI_LOGIC_NO_FUNCTION_COPY)
    expect(outcome.usage).not.toEqual(AI_JOB_ZERO_USAGE)
  })

  it('changes a saved function, shown as an outline, keeping its own name free', async () => {
    saved = SAVED
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep({ inputs: { mode: 'function', functionId: 'fn-1' } })
    expect(readFunction).toHaveBeenCalledWith(firestore, { hostId: 'host-1', id: 'fn-1' })
    expect(userTurn()).toContain('Asked: the saved function below, changed as the request says.')
    expect(userTurn()).toContain('1. If order_total >= free_shipping_over: quote = 0. Otherwise: quote = flat_rate.')
    expect(outcome.outputs[0]).toEqual(
      expect.objectContaining({ id: 'fn-1', proposal: expect.objectContaining({ functionId: 'fn-1' }) }),
    )
  })
})

describe('proposing a variable, and explaining a function', () => {
  it('proposes a variable in its type’s stored form', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      completion({ name: 'plan_prices', type: 'dictionary', value: '{"pro":49}' }, 'submit_variable'),
    )
    const outcome = await runStep({ inputs: { mode: 'variable' } })
    expect(outcome.outputs[0]).toEqual(
      expect.objectContaining({
        resource: 'logic',
        proposal: { kind: 'variable', variable: { name: 'plan_prices', type: 'dictionary', value: '{"pro":49}' } },
      }),
    )
  })

  it('explains a saved function in plain text', async () => {
    saved = SAVED
    mockRunAiRequest.mockResolvedValueOnce(
      completion({ summary: 'It quotes shipping.', points: ['It is given the order total.'], suggestions: [] }, 'submit_explanation'),
    )
    const outcome = await runStep({ inputs: { mode: 'explain', functionId: 'fn-1' } })
    expect(outcome.outputs).toEqual([
      expect.objectContaining({
        resource: 'text',
        label: 'How shippingQuote works',
        text: 'It quotes shipping.\n\nWhat it does:\n1. It is given the order total.',
      }),
    ])
  })

  it('fails without spending for a function that is gone or a site of another org', async () => {
    expect((await runStep({ inputs: { mode: 'explain', functionId: 'fn-9' } })).failure).toBe(AI_LOGIC_GONE_COPY)
    docs.set('hosts/host-1', { orgId: 'org-2' })
    expect((await runStep()).failure).toBe(AI_LOGIC_NO_SITE_COPY)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})

describe('writing a function a build asked for (AGL-3616)', () => {
  const written = { id: 'item-7', name: 'shippingQuote', versionId: null, facts: { operations: 1 } }
  const writer = {
    check: jest.fn(() => ({ ok: true as const, facts: {} })),
    refusal: jest.fn(async (): Promise<{ status: 403 | 404; error: string } | null> => null),
    read: jest.fn(async (): Promise<typeof written | null> => null),
    write: jest.fn(async (request: { id: string; name: string }): Promise<Record<string, unknown>> => ({
      ok: true,
      replayed: false,
      ...written,
      id: request.id,
      name: request.name,
    })),
  }
  const writerFor = jest.fn((resource: string) => (resource === 'function' ? writer : null))
  /** The job a build derives for its `function` item: named by the item's id, carrying its origin. */
  const unit = (patch: Partial<AiJob> = {}) => job({ $id: 'item-7', inputs: { originJobId: 'build-1' }, steps: [], ...patch })
  const runUnit = (patch: Partial<AiJob> = {}, lookup: (resource: string) => unknown = writerFor) =>
    createAiJobLogicStep({ readRecords, readFunction, writerFor: lookup as never })({
      job: unit(patch),
      stepIndex: 0,
      now: NOW,
      firestore,
      org: PRO,
    } as never)

  beforeEach(() => {
    for (const fn of Object.values(writer)) fn.mockClear()
    writerFor.mockClear()
  })

  it('writes the checked function through the logic plugin’s writer, under the unit’s id, for the ledger', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runUnit()
    expect(outcome.failure).toBeUndefined()
    expect(writerFor).toHaveBeenCalledWith('function')
    // Asked before the model ran.
    expect(writer.refusal.mock.invocationCallOrder[0]).toBeLessThan(mockRunAiRequest.mock.invocationCallOrder[0])
    expect(writer.refusal).toHaveBeenCalledWith({ orgId: 'org-1', hostId: 'host-1', uid: 'uid-1', org: PRO, now: NOW })
    const definition = {
      name: 'shippingQuote',
      parameters: [{ name: 'order_total', type: 'number', required: true, label: 'Order total' }],
      variables: [{ name: 'quote', type: 'number' }],
      operations: ANSWER.operations,
      returnValue: 'quote',
    }
    expect(writer.check).toHaveBeenCalledWith(definition, { hostId: 'host-1' })
    expect(writer.write).toHaveBeenCalledWith({
      orgId: 'org-1',
      hostId: 'host-1',
      uid: 'uid-1',
      org: PRO,
      now: NOW,
      id: 'item-7',
      name: 'shippingQuote',
      content: definition,
    })
    expect(outcome.outputs).toEqual([
      {
        resource: 'draft',
        id: 'item-7',
        versionId: null,
        hostId: 'host-1',
        hostSubdomain: 'brightside',
        label: 'shippingQuote',
        draftResource: 'function',
        note: AI_LOGIC_FUNCTION_WRITTEN_NOTE,
      },
    ])
    expect(outcome.usage).not.toEqual(AI_JOB_ZERO_USAGE)
  })

  it('reports the function an earlier run wrote, without spending', async () => {
    writer.read.mockResolvedValueOnce(written)
    const outcome = await runUnit()
    expect(writer.read).toHaveBeenCalledWith({ hostId: 'host-1', id: 'item-7' })
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.outputs).toEqual([expect.objectContaining({ resource: 'draft', id: 'item-7', draftResource: 'function' })])
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(writer.write).not.toHaveBeenCalled()
  })

  it('asks a person, without spending, when the plan has no room for another function', async () => {
    writer.refusal.mockResolvedValueOnce({ status: 403, error: 'Your plan includes 1 function — upgrade in Billing for more' })
    const outcome = await runUnit()
    expect(outcome.review).toEqual({
      reason: 'limit',
      message: 'Your plan includes 1 function — upgrade in Billing for more',
      findings: [],
    })
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('fails without spending where no plugin writes functions', async () => {
    const outcome = await runUnit({}, jest.fn(() => null))
    expect(outcome.failure).toBe(AI_LOGIC_FUNCTION_UNAVAILABLE_COPY)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('fails, having spent, with the writer’s own sentence when the name was taken meanwhile', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    writer.write.mockResolvedValueOnce({ ok: false, status: 409, error: 'This site already has a function named shippingQuote.' })
    const outcome = await runUnit()
    expect(outcome.failure).toBe('This site already has a function named shippingQuote.')
    expect(outcome.usage).not.toEqual(AI_JOB_ZERO_USAGE)
  })

  it('does not write what the owner’s check refuses', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    writer.check.mockReturnValueOnce({ ok: false, problems: ['A function has at most 20 parameters'] } as never)
    const outcome = await runUnit()
    expect(outcome.failure).toBe('A function has at most 20 parameters')
    expect(writer.write).not.toHaveBeenCalled()
  })

  it('still only proposes for a job a person started, and for a change to a saved function', async () => {
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const started = await createAiJobLogicStep({ readRecords, readFunction, writerFor: writerFor as never })({
      job: job(),
      stepIndex: 0,
      now: NOW,
      firestore,
      org: PRO,
    } as never)
    expect(started.outputs[0].resource).toBe('logic')
    saved = SAVED
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const change = await runUnit({ inputs: { originJobId: 'build-1', mode: 'function', functionId: 'fn-1' } })
    expect(change.outputs[0].resource).toBe('logic')
    expect(writerFor).not.toHaveBeenCalled()
  })
})

describe('what a logic job needs before it exists', () => {
  const ask = (inputs: Record<string, unknown>) =>
    createAiLogicJobAdmission({ readFunction })({ firestore, orgId: 'org-1', hostId: 'host-1', inputs, org: PRO, uid: 'uid-1' } as never)

  it('admits a job on a site of its org with Logic on, and a change only of a function the site has', async () => {
    expect(await ask({})).toBeNull()
    expect(await ask({ mode: 'explain', functionId: 'fn-1' })).toEqual({ status: 404, error: AI_LOGIC_GONE_COPY })
    saved = SAVED
    expect(await ask({ mode: 'explain', functionId: 'fn-1' })).toBeNull()
    expect(await ask({ mode: 'publish' })).toEqual({ status: 400, error: 'inputs.mode must be function, variable or explain' })
  })

  it('refuses a site of another org, and a site with Logic off', async () => {
    mockOwners.set('host-1', 'org-2')
    expect(await ask({})).toEqual({ status: 404, error: 'Unknown site' })
    mockOwners.set('host-1', 'org-1')
    docs.set('hosts/host-1', { orgId: 'org-1', disabledPlugins: ['logic'] })
    expect(await ask({})).toEqual({ status: 403, error: AI_LOGIC_UNAVAILABLE_COPY })
  })
})

describe('a measured budget', () => {
  it('fits a function of eight operations with as much again to think in', () => {
    const operation = { ...ANSWER.operations[0] }
    const eight = JSON.stringify({ ...ANSWER, operations: Array.from({ length: 8 }, () => operation) })
    expect(Math.ceil(eight.length / 3) * 2).toBeLessThanOrEqual(AI_ROUTING_TABLE['job.logic'].maxTokens)
  })
})
