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
 * A tracking change with no pixel ID waits for it (AGL-3978), offline: an
 * AUTHORED plan answer — "add my Meta pixel", planned with no id, as the live
 * eval planned it (AGL-3751) — goes through the REAL plan step and the REAL
 * build admission. The plan is kept and the step asks for the id as a field
 * naming the provider, instead of ending the job with the question. A plan
 * that names the id never asks, and one that names no tag at all still ends
 * with the question, since it has no field to fill.
 */

const mockRunAiRequest = jest.fn()

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
jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: async () => ({ ...jest.requireActual('../model/ai-site-inventory').emptyAiSiteInventory('host-1') }),
}))

import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { aiBuildPlanInputFields, type AiBuildOps } from '../model/ai-build-job'
import { AI_BUILD_PLAN_TOOL } from '../model/ai-build-plan'
import { aiJobInputKey, aiJobInputProblems, aiPlanWithInput } from '../model/ai-job-input'
import type { AiJob, AiJobInputRequest, AiJobPlan } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { createAiBuildJobAdmission } from './ai-job-build-step'
import { createAiJobPlanStep } from './ai-job-plan-step'
import { AI_TRACKING_WHICH_COPY, aiTrackingInputFields, aiTrackingMissingInput } from './ai-job-tracking-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-19T12:00:00.000Z')
const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }),
} as unknown as FirebaseFirestore.Firestore

const OPS: AiBuildOps = new Map<string, PluginAiCapability>(AI_OWNED_CAPABILITIES.map((one) => [one.op, one] as const))

const META_ASK = 'What’s your Meta pixel ID? It’s the number (8–20 digits) shown for your pixel in Meta Events Manager.'

const tracking = (args: Record<string, unknown>, name = 'Meta pixel') => ({
  reuse: [],
  create: [],
  screens: [],
  items: [
    {
      op: 'tracking',
      name,
      why: 'The request asks to add tracking to the site.',
      dependsOn: [],
      degrade: 'omit',
      args: JSON.stringify(args),
    },
  ],
})

function job(): AiJob {
  return {
    $id: 'build-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'build',
    status: 'running',
    brief: 'add my Meta pixel',
    inputs: {},
    steps: [
      { name: 'plan', status: 'running', creditsSpent: 0 },
      { name: 'generate', status: 'pending', creditsSpent: 0 },
    ],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
  } as AiJob
}

/** Plans the request through the real plan step and the build's real admission, from the authored answer. */
async function plan(answer: Record<string, unknown>) {
  mockRunAiRequest.mockResolvedValue({
    kind: 'completion',
    text: '',
    toolUse: [{ name: AI_BUILD_PLAN_TOOL.name, input: answer }],
    usage: { inputTokens: 4_000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0.02,
    stopReason: 'tool_use',
  })
  const admission = createAiBuildJobAdmission({ opsFor: async () => OPS, ownerOf: async () => 'org-1' })
  return createAiJobPlanStep({
    findPlansByKey: async () => [],
    readCapabilities: async () => null,
    readOps: async () => OPS,
    readSiteContext: null,
    readFreeCredits: null,
    readSiteEvents: null,
    admissionRefusal: (_kind, context) => admission(context),
  })({ job: job(), stepIndex: 0, now: NOW, firestore })
}

beforeAll(() => {
  // The build's admission needs a page runner registered, as every build does.
  registerAiJobStep('page', async () => {
    throw new Error('no page is built here')
  })
})
beforeEach(() => mockRunAiRequest.mockReset())

describe('a tracking change with no pixel ID waits for it (AGL-3978)', () => {
  it('keeps the plan and asks for the Meta pixel ID as a field: nothing fails', async () => {
    const outcome = await plan(tracking({}))
    expect(outcome.failure).toBeUndefined()
    expect(outcome.plan?.items).toEqual([expect.objectContaining({ op: 'tracking', name: 'Meta pixel', args: {} })])
    expect(outcome.review).toMatchObject({ reason: 'plan' })
    expect(outcome.input).toEqual({
      message: META_ASK,
      fields: [{ item: 'Meta pixel', arg: 'metaPixel', label: 'Meta pixel ID', shape: '8–20 digits', pattern: '^[0-9]{8,20}$' }],
    })
  })

  it('never pauses a plan that names the id', async () => {
    const outcome = await plan(tracking({ metaPixel: '123456789012345' }))
    expect(outcome.failure).toBeUndefined()
    expect(outcome.input).toBeUndefined()
    expect(outcome.review).toMatchObject({ reason: 'plan' })
    expect(outcome.plan?.items?.[0].args).toEqual({ metaPixel: '123456789012345' })
  })

  it('asks for the provider an id of the wrong shape was meant for, naming why it was not one', async () => {
    const outcome = await plan(tracking({ googleAnalytics: 'UA-1234' }, 'Analytics'))
    expect(outcome.input?.message).toContain('“UA-1234” is not an ID for Google Analytics')
    expect(outcome.input?.fields).toEqual([expect.objectContaining({ arg: 'googleAnalytics', label: 'Google Analytics measurement ID', shape: 'G-XXXXXXXXXX' })])
  })

  it('still ends with the question when the item names no tag, so there is no field to fill', async () => {
    const outcome = await plan({ ...tracking({}, 'Tracking'), items: [{ ...tracking({}).items[0], name: 'Tracking', why: 'Set up tracking.' }] })
    expect(outcome.input).toBeUndefined()
    expect(outcome.failure).toBe(AI_TRACKING_WHICH_COPY)
  })
})

describe('the fields and the answer (AGL-3978)', () => {
  const request: AiJobInputRequest = {
    message: META_ASK,
    fields: [{ item: 'Meta pixel', arg: 'metaPixel', label: 'Meta pixel ID', shape: '8–20 digits', pattern: '^[0-9]{8,20}$' }],
  }
  const key = aiJobInputKey(request.fields[0])

  it('is the tracking capability’s field per tag it asks about, and none once it can be built', () => {
    expect(OPS.get('tracking')?.inputFields).toBe(aiTrackingInputFields)
    expect(aiTrackingInputFields({ name: 'Connect GA and the Meta pixel', args: {} }).map((field) => field.label)).toEqual([
      'Google Analytics measurement ID',
      'Meta pixel ID',
    ])
    expect(aiTrackingInputFields({ name: 'Meta pixel', args: { metaPixel: '123456789012345' } })).toEqual([])
    expect(aiTrackingMissingInput({ name: 'Meta pixel', args: {} })).toBe(META_ASK)
  })

  it('reads a plan’s fields only where every asking item has some', () => {
    const items = (one: Record<string, unknown>[]) =>
      ({ reuse: [], create: [], screens: [], items: one }) as unknown as AiJobPlan
    const item = (name: string, why = '') => ({ slot: 'i0', op: 'tracking', name, why, dependsOn: [], degrade: 'omit', args: {} })
    expect(aiBuildPlanInputFields(items([item('Meta pixel')]), OPS)).toEqual(request.fields)
    expect(aiBuildPlanInputFields(items([item('Tracking', 'Set up tracking.')]), OPS)).toEqual([])
    expect(aiBuildPlanInputFields(items([item('Meta pixel')]), null)).toEqual([])
  })

  it('holds each answer to its pattern, in the card’s words, and writes a good one to the item', () => {
    expect(aiJobInputProblems(request, {})).toEqual({ [key]: 'Enter your Meta pixel ID. It looks like 8–20 digits.' })
    expect(aiJobInputProblems(request, { [key]: 'fb-123' })).toEqual({
      [key]: '“fb-123” is not a Meta pixel ID, which looks like 8–20 digits.',
    })
    expect(aiJobInputProblems(request, { [key]: ' 123456789012345 ' })).toEqual({})
    const plan = {
      reuse: [],
      create: [],
      screens: [],
      items: [{ slot: 'i0', op: 'tracking', name: 'Meta pixel', why: '', dependsOn: [], degrade: 'omit' as const, args: {} }],
    }
    expect(aiPlanWithInput(plan, request, { [key]: ' 123456789012345 ' }).items?.[0].args).toEqual({ metaPixel: '123456789012345' })
  })
})
