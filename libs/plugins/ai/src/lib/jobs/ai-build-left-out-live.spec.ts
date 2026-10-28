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
 * A BUILD THAT CANNOT MAKE A PAGE IT IS ASKED FOR SAYS SO (AGL-4087), planned
 * by the REAL model. On 2026-10-28 a Free workspace's build was asked for a
 * home and a "review helper" page that writes a review draft from a
 * customer's choices and copies it for them. Its plan held the home alone,
 * kept two sections sending visitors to the helper, and said nothing, so the
 * member confirmed a plan that had quietly dropped half the request. This
 * request has the same shape in other words, on a Free site with nothing on
 * it yet: the plan either builds the second page or names it in `leftOut`,
 * and a page it leaves out is one no section sends visitors to.
 *
 * It calls the provider and costs real money (a few cents a run), so it runs
 * only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, under the
 * replay cache and, for a round, `AGLYN_LIVE_AI_BATCH=1`. See the ladder in
 * `ai-job-site-plan-live.spec.ts`.
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
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { aiLiveTimeoutMs } from '../runtime/ai-dev-env'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { createAiJobPlanStep } from './ai-job-plan-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
// A fixed day (AGL-3781), so each run sends the same bytes and the replay cache answers it.
const NOW = new Date('2026-10-28T12:00:00Z')

/** The 2026-10-28 request's shape, in other words and for a made-up business. */
const REQUEST =
  'Phone-first site for Tapwell Cards, which sells tap-to-review cards for local shops. Clean white look with a deep teal accent, rounded cards. ' +
  'Pages: (1) Home: what the cards are and how they work, with a button to the review helper. ' +
  '(2) Review helper page: shows the shop name and a logo spot; the customer picks a few answers (what they came in for, how it went, would they recommend us); ' +
  'the page turns those answers into a review draft from fixed sentence templates, shows it in a box they can edit, and a Copy & Continue button copies it and opens our Google review link ([Google Review URL]). ' +
  'Tell customers to check the draft and post their own review. Never invent experiences, never post for them, never send unhappy customers anywhere but Google. ' +
  'Shared header with the shop name, and a footer.\n' +
  'Asked from the console page: Site dashboard — the home page for one site in this workspace.'

/** A Free workspace, as production reads one with no paid plan. */
const ORG = { ownerUid: 'owner-1' }

/** The operations a Free build may plan, as the gate leaves them. */
const OPS: AiBuildOps = new Map<string, PluginAiCapability>(
  AI_OWNED_CAPABILITIES.filter((one) => one.freeAllowed).map((one) => [one.op, one] as const),
)

function buildJob(): AiJob {
  return {
    $id: 'job-live-left-out',
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'build',
    status: 'running',
    brief: REQUEST,
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

describeLive('a request with a page the build cannot make, planned by the real model (AGL-4087)', () => {
  jest.setTimeout(aiLiveTimeoutMs(15 * 60_000))

  it('builds the helper page or names it in leftOut, and sends no visitor to a page it leaves out', async () => {
    const outcome = (await createAiJobPlanStep({
      readInventory: async () => emptyAiSiteInventory('host-live'),
      findPlansByKey: null,
      // No paid plan: the Free taste, its 2 pages and its one form a site.
      readCapabilities: async () => aiPlanCapabilitiesFrom(null),
      readOps: async () => OPS,
      admissionRefusal: async () => null,
    })({
      job: buildJob(),
      stepIndex: 0,
      now: NOW,
      firestore: aiEvalMemoryFirestore({}).firestore,
      org: ORG,
    } as never)) as unknown as Record<string, unknown>
    const plan = (outcome['plan'] ?? null) as AiJobPlan | null
    const review = outcome['review'] as { reason?: string; findings?: Array<{ code: string; message: string }> } | undefined
    const helper = /review helper|review draft/i
    const helperPage = Boolean(plan?.screens.some((screen) => helper.test(`${screen.title} ${screen.slug}`)))
    const result = {
      planned: Boolean(plan) && (!review || review.reason === 'plan'),
      findings: (review?.findings ?? []).map((finding) => `${finding.code}: ${finding.message}`),
      shape: plan ? aiBuildPlanShapeRefusal(plan, { freeTaste: true, ops: OPS }) : 'no plan',
      pages: plan?.screens.map((screen) => `${screen.title} ${screen.slug}`) ?? [],
      helperPage,
      leftOut: plan?.leftOut ?? [],
      // A section sending visitors to a helper the plan does not build.
      deadEnds: helperPage
        ? []
        : (plan?.screens ?? []).flatMap((screen) => screen.sections.map((section) => section.name)).filter((name) => helper.test(name)),
      estCostUsd: Number(outcome['estCostUsd'] ?? 0),
    }
    console.log(JSON.stringify({ run: aiLiveRunLedger(), result, plan }, null, 1))
    expect(result).toMatchObject({ planned: true, shape: null, deadEnds: [] })
    expect(result.helperPage || result.leftOut.some((entry) => helper.test(entry.asked))).toBe(true)
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
