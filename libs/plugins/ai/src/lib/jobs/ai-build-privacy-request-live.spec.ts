/**
 * @jest-environment node
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
 * PRIVACY REQUESTS, planned by the REAL model (AGL-4033). The offline spec,
 * `ai-job-privacy-step.spec.ts`, feeds authored arguments; this one sends a
 * person's words through the real plan step of a `build` job — the real
 * prompt, provider, re-ask and plan rules — on a site with a home and a
 * pricing page, and holds the plan it keeps to the one `privacy` item each
 * request asks for, with no page built and no password anywhere.
 *
 * It calls the provider and costs real money (a few cents a request), so it
 * runs only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, under
 * the replay cache and, for a round, `AGLYN_LIVE_AI_BATCH=1`. See the ladder
 * in `ai-job-site-plan-live.spec.ts`.
 */

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  ...jest.requireActual('./ai-jobs'),
  registerAiJobPlanStep: jest.fn(),
}))

import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { aiBuildPlanShapeRefusal, type AiBuildOps } from '../model/ai-build-job'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { aiUnrestrictedPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { aiLiveTimeoutMs } from '../runtime/ai-dev-env'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { createAiJobPlanStep } from './ai-job-plan-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
// A fixed day (AGL-3781), so the replay cache can answer an unchanged prompt.
const NOW = new Date('2026-10-24T12:00:00Z')

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-live'),
  layouts: [{ id: 'lay-site', name: 'Site layout', parentId: null }],
  screens: [
    { id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false },
    { id: 'scr-pricing', name: 'Pricing', slug: '/pricing', layoutId: 'lay-site', template: false },
  ],
}

const OPS: AiBuildOps = new Map<string, PluginAiCapability>(AI_OWNED_CAPABILITIES.map((one) => [one.op, one] as const))

const ORG = { plan: 'business' as const, billingStatus: 'active', ownerUid: 'owner-1' }

/** Each request, and the privacy arguments its plan must carry. */
const REQUESTS: readonly { brief: string; expect: Record<string, unknown> }[] = [
  { brief: 'make my site private until we launch next month', expect: { maintenance: true } },
  { brief: 'hide my website from google for now', expect: { discourageSearchEngines: true } },
  { brief: 'make the pricing page members only', expect: { membersPages: ['scr-pricing'] } },
]

function buildJob(brief: string): AiJob {
  return {
    $id: 'job-live-privacy',
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'build',
    status: 'running',
    brief,
    inputs: {},
    steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 0,
    createdBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

const describeLive = LIVE ? describe : describe.skip

describeLive('privacy requests, planned by the real model (AGL-4033)', () => {
  jest.setTimeout(aiLiveTimeoutMs(15 * 60_000))

  it.each(REQUESTS)('plans one privacy item for “$brief”, and nothing else', async ({ brief, expect: args }) => {
    const outcome = (await createAiJobPlanStep({
      readInventory: async () => INVENTORY,
      findPlansByKey: null,
      readCapabilities: async () => aiUnrestrictedPlanCapabilities(),
      readOps: async () => OPS,
      admissionRefusal: async () => null,
    })({
      job: buildJob(brief),
      stepIndex: 0,
      now: NOW,
      firestore: aiEvalMemoryFirestore({}).firestore,
      org: ORG,
    } as never)) as unknown as Record<string, unknown>
    const plan = (outcome['plan'] ?? null) as AiJobPlan | null
    const review = outcome['review'] as { reason?: string; findings?: Array<{ code: string; message: string }> } | undefined
    const privacy = plan?.items?.filter((item) => item.op === 'privacy') ?? []
    const result = {
      planned: Boolean(plan) && (!review || review.reason === 'plan'),
      refused: outcome['refused'] === true,
      findings: (review?.findings ?? []).map((finding) => `${finding.code}: ${finding.message}`),
      shape: plan ? aiBuildPlanShapeRefusal(plan, { ops: OPS }) : 'no plan',
      privacyItems: privacy.length,
      args: privacy[0]?.args ?? null,
      otherItems: (plan?.items ?? []).filter((item) => item.op !== 'privacy').map((item) => item.op),
      pages: plan?.screens.length ?? 0,
      created: plan?.create.map((creation) => creation.kind) ?? [],
      mentionsPassword: /password/i.test(JSON.stringify(privacy)),
      estCostUsd: Number(outcome['estCostUsd'] ?? 0),
    }
    console.log(JSON.stringify({ run: aiLiveRunLedger(), result }, null, 1))
    expect(result).toMatchObject({ planned: true, refused: false, shape: null, privacyItems: 1, otherItems: [], pages: 0, created: [], mentionsPassword: false })
    expect(result.args).toMatchObject(args)
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
