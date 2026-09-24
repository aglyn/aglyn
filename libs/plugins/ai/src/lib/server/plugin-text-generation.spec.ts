/**
 * @jest-environment node
 */

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
 * This plugin as the workspace's text generator (AGL-3324): every rung the
 * generation doors climb, forced red once in order, and the green path
 * metered as a text job is. The platform helpers are mocked at their module
 * seams, as `ai-gate.spec.ts` mocks them; the provider is faked at
 * `runAiRequest`.
 */

const mockFlagOn = jest.fn()
const mockGetOrgForUser = jest.fn()
const mockHasPermission = jest.fn()
const mockFeatureLockdown = jest.fn()
const mockAiOffForSite = jest.fn()
const mockReserve = jest.fn()
const mockRelease = jest.fn()
const mockRecordCost = jest.fn()
const mockRunAiRequest = jest.fn()
const mockFirestore = { kind: 'firestore' }

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  getOrgForUser: (...args: unknown[]) => mockGetOrgForUser(...args),
  memberHasPermissionOnHost: (...args: unknown[]) => mockHasPermission(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForOrg: (...args: unknown[]) => mockFlagOn(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  __esModule: true,
  featureLockdownRefusal: (...args: unknown[]) => mockFeatureLockdown(...args),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements').checkEntitlement,
}))
jest.mock('../model/ai-site-switch', () => ({
  __esModule: true,
  AI_OFF_FOR_SITE_COPY: 'AI is switched off for this site.',
  isAiOffForSite: (...args: unknown[]) => mockAiOffForSite(...args),
}))
jest.mock('../usage/assist-usage', () => ({
  __esModule: true,
  reserveAssistMessage: (...args: unknown[]) => mockReserve(...args),
  releaseAssistMessage: (...args: unknown[]) => mockRelease(...args),
  recordAssistCost: (...args: unknown[]) => mockRecordCost(...args),
}))
jest.mock('../usage/ai-usage-by-user', () => ({
  __esModule: true,
  recordUserAiRefusal: () => undefined,
}))
jest.mock('../jobs/ai-jobs', () => ({
  __esModule: true,
  aiJobRefusalText: (_org: unknown, reservation: { refusedBy: string }) => `refused by ${reservation.refusedBy}`,
}))
jest.mock('../jobs/ai-job-text-step', () => ({
  __esModule: true,
  AI_JOB_TEXT_STEP_BUDGET: { maxTokens: () => 1_500 },
}))
jest.mock('../providers/model-choice', () => ({
  __esModule: true,
  resolveAiModelChoice: () => ({ model: 'test-model', auto: true, declined: null }),
}))
jest.mock('../providers/routing', () => ({
  __esModule: true,
  AI_ROUTING_TABLE: { 'job.text': { maxTokens: 1_500, effort: 'medium' } },
}))
jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  aiProviderReady: () => true,
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

import '../declarations'
import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { pluginTextGenerator, type PluginTextGenerationRequest } from '@aglyn/aglyn/plugin-manager/plugin-text-generation'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { AI_TEXT_GENERATION_ROUTE, createAiTextGenerator, registerAiTextGenerator } from './plugin-text-generation'

const ORG = 'org-1'
/** A Pro workspace with the AI add-on: `aiGenerative` is on. */
const ENTITLED_ORG = { plan: 'pro', billingStatus: 'active', seatAddons: { aiAddon: true } }
/** Pro without the add-on. */
const PLAIN_PRO_ORG = { plan: 'pro', billingStatus: 'active' }
const NOW = new Date('2026-09-24T15:00:00.000Z')
const RESERVED = {
  allowed: true,
  period: 'month',
  used: 1,
  limit: 1000,
  remaining: 999,
  dayKey: '2026-09-24',
  monthKey: '2026-09',
  refusedBy: null,
  budgetUsd: 40,
  free: null,
}
const USAGE = { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 }

const request = (overrides: Partial<PluginTextGenerationRequest> = {}): PluginTextGenerationRequest => ({
  orgId: ORG,
  hostId: 'host-1',
  uid: 'uid-rep',
  staff: false,
  org: ENTITLED_ORG,
  purpose: 'outreach-curate',
  system: 'You draft sales emails.',
  prompt: 'Recipient: Casey Morgan',
  maxTokens: 5_000,
  now: NOW,
  ...overrides,
})

const generator = () => createAiTextGenerator({ firestore: () => mockFirestore as never, now: () => NOW })

beforeEach(() => {
  jest.resetAllMocks()
  mockFlagOn.mockResolvedValue(true)
  mockGetOrgForUser.mockResolvedValue({ orgId: ORG, org: ENTITLED_ORG, member: { role: 'editor' } })
  mockHasPermission.mockResolvedValue(true)
  mockFeatureLockdown.mockResolvedValue(null)
  mockAiOffForSite.mockResolvedValue(false)
  mockReserve.mockResolvedValue(RESERVED)
  mockRelease.mockResolvedValue(undefined)
  mockRecordCost.mockResolvedValue('signal-1')
  mockRunAiRequest.mockResolvedValue({
    kind: 'completion',
    text: '  Hi Casey,\n\nSaw the second location.\n',
    toolUse: [],
    usage: USAGE,
    estCostUsd: 0.004,
    stopReason: 'end_turn',
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the green path', () => {
  it('asks the provider under the text route, and meters the answer on the purpose the caller named', async () => {
    const answer = await generator().generate(request())
    expect(answer).toEqual({
      ok: true,
      text: 'Hi Casey,\n\nSaw the second location.',
      model: 'test-model',
      usage: { inputTokens: 900, outputTokens: 120 },
    })
    expect(mockRunAiRequest).toHaveBeenCalledWith({
      model: 'test-model',
      system: [{ text: 'You draft sales emails.', cacheBreakpoint: true }],
      messages: [{ role: 'user', content: 'Recipient: Casey Morgan' }],
      // The caller's ceiling is capped at the route's own.
      maxTokens: 1_500,
      effort: 'medium',
      stream: false,
    })
    // Reserved on the member and the site, then recorded as a text job is.
    expect(mockReserve).toHaveBeenCalledWith(mockFirestore, ORG, true, NOW, ENTITLED_ORG, { uid: 'uid-rep', hostId: 'host-1' })
    expect(mockRecordCost).toHaveBeenCalledWith(
      mockFirestore,
      ORG,
      {
        route: AI_TEXT_GENERATION_ROUTE,
        hostId: 'host-1',
        model: 'test-model',
        tier: 'entitled',
        usage: USAGE,
        docsPaths: [],
        stopReason: 'end_turn',
        deflected: false,
        free: null,
        uid: 'uid-rep',
        kind: 'outreach-curate',
      },
      NOW,
    )
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it('keys a purpose the caller spelled loosely the way the ledger holds it', async () => {
    await generator().generate(request({ purpose: 'Outreach Curate' }))
    expect(mockRecordCost.mock.calls[0][2]).toMatchObject({ kind: 'outreach-curate' })
    await generator().generate(request({ purpose: 'notes' }))
    expect(mockRecordCost.mock.calls[1][2]).toMatchObject({ kind: 'plugin-notes' })
  })

  it('records a model that declined, and answers refused', async () => {
    mockRunAiRequest.mockResolvedValue({ kind: 'refusal', usage: USAGE, estCostUsd: 0.001, stopReason: 'refusal' })
    const answer = await generator().generate(request())
    expect(answer).toMatchObject({ ok: false, status: 422, reason: 'refused' })
    expect(mockRecordCost).toHaveBeenCalled()
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it('hands the reservation back when the provider was never reached, and meters nothing', async () => {
    mockRunAiRequest.mockRejectedValue(new Error('upstream 529'))
    const answer = await generator().generate(request())
    expect(answer).toMatchObject({ ok: false, status: 503, reason: 'failed' })
    expect(mockRelease).toHaveBeenCalledWith(mockFirestore, ORG, RESERVED)
    expect(mockRecordCost).not.toHaveBeenCalled()
  })
})

describe('the rungs, in order', () => {
  it('404 unavailable while the generative flag is off — nothing below is consulted; staff preview through', async () => {
    mockFlagOn.mockResolvedValue(false)
    expect(await generator().generate(request())).toMatchObject({ ok: false, status: 404, reason: 'unavailable' })
    expect(mockGetOrgForUser).not.toHaveBeenCalled()
    expect(mockReserve).not.toHaveBeenCalled()
    expect(await generator().generate(request({ staff: true }))).toMatchObject({ ok: true })
  })

  it('403 permission for a non-member, and for a role without ai.generate on the site named', async () => {
    mockGetOrgForUser.mockResolvedValue(null)
    expect(await generator().generate(request())).toMatchObject({ ok: false, status: 403, reason: 'permission' })
    mockGetOrgForUser.mockResolvedValue({ orgId: ORG, org: ENTITLED_ORG, member: { role: 'viewer' } })
    mockHasPermission.mockResolvedValue(false)
    expect(await generator().generate(request())).toMatchObject({ ok: false, status: 403, reason: 'permission' })
    expect(mockHasPermission).toHaveBeenCalledWith(ORG, 'host-1', { role: 'viewer' }, 'ai.generate')
    expect(mockReserve).not.toHaveBeenCalled()
  })

  it('403 entitlement on a plan without generation, before any switch or quota is disclosed', async () => {
    expect(await generator().generate(request({ org: PLAIN_PRO_ORG }))).toMatchObject({
      ok: false,
      status: 403,
      reason: 'entitlement',
    })
    expect(mockFeatureLockdown).not.toHaveBeenCalled()
    expect(mockReserve).not.toHaveBeenCalled()
  })

  it('off while the feature is paused, or the site switched AI off', async () => {
    mockFeatureLockdown.mockResolvedValue(Response.json({ error: 'AI generation is paused' }, { status: 423 }))
    expect(await generator().generate(request())).toEqual({ ok: false, status: 423, reason: 'off', error: 'AI generation is paused' })
    mockFeatureLockdown.mockResolvedValue(null)
    mockAiOffForSite.mockResolvedValue(true)
    expect(await generator().generate(request())).toMatchObject({ ok: false, reason: 'off', error: 'AI is switched off for this site.' })
    expect(mockReserve).not.toHaveBeenCalled()
  })

  it('quota when the reservation refuses, in the sentence every door gives, and fails closed when it cannot be taken', async () => {
    mockReserve.mockResolvedValue({ ...RESERVED, allowed: false, refusedBy: 'allotment' })
    expect(await generator().generate(request())).toEqual({
      ok: false,
      status: 429,
      reason: 'quota',
      error: 'refused by allotment',
    })
    mockReserve.mockResolvedValue({ ...RESERVED, allowed: false, refusedBy: 'cap' })
    expect(await generator().generate(request())).toMatchObject({ status: 402, reason: 'quota' })
    mockReserve.mockRejectedValue(new Error('firestore down'))
    expect(await generator().generate(request())).toMatchObject({ ok: false, status: 503, reason: 'failed' })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})

describe('the registration', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    setRegisteringPluginId(undefined)
  })

  it('is this plugin’s, on the core’s seam, and idempotent', () => {
    registerAiTextGenerator()
    registerAiTextGenerator()
    expect(pluginTextGenerator()?.pluginId).toBe('ai')
  })
})
