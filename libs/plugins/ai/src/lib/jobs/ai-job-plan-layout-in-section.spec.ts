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
 * A section that places the page's own layout has that layout taken out of
 * its uses instead of failing the start. The live site-plan eval of
 * 2026-10-15 (Free, claude-haiku-5-5) planned "a family dental practice" with
 * every page in the site's layout and that layout named again in each
 * section's uses; rule 2's `plan-layout-in-section` refused both attempts,
 * and the customer would have had no site.
 */

const mockRunAiRequest = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('../providers/routing', () => {
  const catalog = jest.requireActual('../providers/catalog')
  return {
    __esModule: true,
    ...jest.requireActual('../providers/routing'),
    aiModelForStep: (kind: string) =>
      catalog.AI_MODEL_CATALOG.find(
        (entry: { tier: string }) => entry.tier === catalog.AI_STEP_TIERS[kind],
      )?.id,
  }
})

jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: jest.fn(),
}))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  AI_BUILD_PLAN_TOOL,
  parseAiBuildPlan,
  type AiBuildPlan,
} from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import {
  aiPlanCapabilitiesForJob,
  type AiPlanCapabilities,
} from '../model/ai-plan-capabilities'
import {
  emptyAiSiteInventory,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import { aiDoctrinePlanCheck } from '../runtime/ai-doctrine'
import { validateAiBuildPlan } from '../runtime/ai-doctrine-validators'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import {
  AI_JOB_PLAN_SCOPES,
  aiSitePlanCapabilities,
  createAiJobPlanStep,
} from './ai-job-plan-step'
import { AI_DENTAL_SITE_PLAN_ANSWER as ANSWER } from './fixtures/ai-dental-site-plan-recording'

const NOW = new Date('2026-10-14T12:00:00Z')
const FREE_ORG: Partial<AglynOrgBilling> & { ownerUid: string } = {
  plan: 'free',
  ownerUid: 'owner-1',
}

/** A site as provisioning leaves it (AGL-3497): its layout and its untouched starter home. */
const PROVISIONED: AiSiteInventory = {
  ...emptyAiSiteInventory('host-live'),
  layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }],
  screens: [
    {
      id: 'scrStarter',
      name: 'Home',
      slug: '/',
      layoutId: 'laySite',
      template: false,
      replaceable: true,
    },
  ],
}
const FREE: AiPlanCapabilities = aiPlanCapabilitiesFrom(FREE_ORG, {
  layout: [
    {
      id: 'laySite',
      kind: undefined,
      sourceType: undefined,
      deletedAt: undefined,
    },
  ],
  template: [],
})

/** The eval's guided start, as `ai-job-site-plan-live.spec.ts` sends it on a Free workspace. */
function dentalJob(): AiJob {
  return {
    $id: 'job-live-2',
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'site',
    status: 'running',
    brief: 'A 2-page website for a family dental practice.',
    inputs: {
      pages: 2,
      welcomeEmail: false,
      submissions: 'inbox',
      businessName: 'Maple Street Dental',
      businessType: 'a family dental practice',
      audience: 'parents booking check-ups for their kids',
      starter: 'business',
    },
    steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 300,
    creditsSpent: 0,
    createdBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

/** What the plan step holds a Free site start to, as it derives it. */
const SITE_FREE = aiSitePlanCapabilities(
  dentalJob(),
  aiPlanCapabilitiesForJob(FREE, AI_JOB_PLAN_SCOPES.site ?? null),
) as AiPlanCapabilities

const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}
const toolAnswer = (input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: AI_BUILD_PLAN_TOOL.name, input }],
  usage: ZERO_USAGE,
  estCostUsd: 0,
  stopReason: 'tool_use',
})

function asWritten(): AiBuildPlan {
  const parsed = parseAiBuildPlan(ANSWER)
  if (parsed.ok === false) throw new Error(parsed.error)
  return parsed.plan
}

describe('the live dental plan (2026-10-15)', () => {
  it('as the model wrote it, breaks rule 2 alone: six sections place the page’s own layout', () => {
    const found = validateAiBuildPlan(asWritten(), PROVISIONED, null, SITE_FREE)
    expect(found.map(({ rule, code, paths }) => [rule, code, paths])).toEqual([
      [
        2,
        'plan-layout-in-section',
        [
          'screens[0].sections[0].uses[0]',
          'screens[0].sections[1].uses[0]',
          'screens[0].sections[2].uses[0]',
          'screens[0].sections[3].uses[0]',
          'screens[1].sections[0].uses[0]',
          'screens[1].sections[2].uses[0]',
        ],
      ],
    ])
  })

  it('passes the plan check with the layout taken out of those sections, and nothing else changed', () => {
    const written = asWritten()
    const result = aiDoctrinePlanCheck(
      PROVISIONED,
      null,
      SITE_FREE,
    )(ANSWER as never)
    expect(result.violations).toEqual([])
    const plan = result.value as AiBuildPlan
    expect(plan.screens.map((screen) => screen.layout)).toEqual([
      'laySite',
      'laySite',
    ])
    expect(
      plan.screens.map((screen) =>
        screen.sections.map((section) => section.uses),
      ),
    ).toEqual([
      [[], [], [], [], ['new:bookingForm']],
      [[], ['new:bookingForm'], []],
    ])
    expect(
      plan.screens.map((screen) =>
        screen.sections.map(({ name, items }) => [name, items]),
      ),
    ).toEqual(
      written.screens.map((screen) =>
        screen.sections.map(({ name, items }) => [name, items]),
      ),
    )
    expect(plan.reuse).toEqual(written.reuse)
    expect(plan.create).toEqual(written.create)
  })

  it('is kept by the plan step on the first answer: the job goes on to its review, nothing refunded', async () => {
    mockRunAiRequest.mockReset()
    // Both attempts of the live run gave this answer's shape.
    mockRunAiRequest.mockResolvedValue(toolAnswer(ANSWER))
    const outcome = await createAiJobPlanStep({
      readInventory: async () => PROVISIONED,
      findPlansByKey: null,
      readCapabilities: async () => FREE,
      admissionRefusal: async () => null,
      readSiteContext: null,
    })({
      job: dentalJob(),
      stepIndex: 0,
      now: NOW,
      firestore: aiEvalMemoryFirestore({}).firestore,
      org: FREE_ORG,
    })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(outcome.uncredited).toBeUndefined()
    expect(outcome.review).toMatchObject({ reason: 'plan', findings: [] })
    expect(outcome.plan?.status).toBe('proposed')
    expect(outcome.plan?.screens[0].sections[0].uses).toEqual([])
    expect(outcome.plan?.screens[1].sections[1].uses).toEqual([
      'new:bookingForm',
    ])
  })
})
