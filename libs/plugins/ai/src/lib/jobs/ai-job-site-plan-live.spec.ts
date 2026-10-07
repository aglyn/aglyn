/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * A guided start's plan, made by the REAL model (2026-10-07). Every other
 * plan spec feeds a hand-written answer, which is how three production starts
 * in a row failed on plans no spec had seen: an empty nav region, then a
 * layout whose regions came as one string. This one sends each brief below
 * through the real plan step — the real prompt, provider, re-ask and plan
 * rules — on a Free workspace's empty site, as production creates it, and
 * holds every brief to a plan the rules keep.
 *
 * It calls the provider and costs real money (about 19 credits a brief), so
 * it runs only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set.
 * Run it before promoting a change to the site job, its prompt or its rules.
 */

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { AiJob } from '../model/ai-jobs.types'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { createAiJobPlanStep } from './ai-job-plan-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const NOW = new Date()
const FREE_ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: 'free', ownerUid: 'owner-1' }

/** Briefs as people answer the guided start: a business, who it is for, a look, two pages. */
const BRIEFS: ReadonlyArray<{ businessType: string; audience: string; starter: string }> = [
  { businessType: 'a neighborhood dog groomer in Austin that takes grooming appointments', audience: 'local dog owners who want a regular groom', starter: 'business' },
  { businessType: 'a family dental practice', audience: 'parents booking check-ups for their kids', starter: 'business' },
  { businessType: 'a wedding photographer', audience: 'engaged couples comparing photographers', starter: 'portfolio' },
  { businessType: 'a roofing contractor', audience: 'homeowners after a storm', starter: 'business' },
  { businessType: 'a yoga studio with drop-in classes', audience: 'beginners nervous about their first class', starter: 'landing' },
  { businessType: 'a bakery that sells cakes to order', audience: 'people planning a birthday', starter: 'shop-physical' },
  { businessType: 'a nonprofit food bank', audience: 'volunteers and donors', starter: 'business' },
  { businessType: 'a freelance bookkeeper', audience: 'small business owners behind on their books', starter: 'business' },
  { businessType: 'a mobile car detailing service', audience: 'busy commuters', starter: 'landing' },
  { businessType: 'a guitar teacher', audience: 'adults who always wanted to learn', starter: 'business' },
]

function siteJob(inputs: Record<string, unknown>, index: number): AiJob {
  return {
    $id: `job-live-${index}`,
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'site',
    status: 'running',
    brief: `A 2-page website for ${String(inputs['businessType'])}.`,
    inputs: { pages: 2, welcomeEmail: false, submissions: 'inbox', ...inputs },
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

const describeLive = LIVE ? describe : describe.skip

describeLive("a guided start's plan from the real model", () => {
  jest.setTimeout(10 * 60_000)

  it('keeps the plan rules for every brief, on a Free workspace’s empty site', async () => {
    const capabilities = aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] })
    const results = await Promise.all(
      BRIEFS.map(async (brief, index) => {
        const outcome = (await createAiJobPlanStep({
          readInventory: async () => emptyAiSiteInventory('host-live'),
          findPlansByKey: null,
          readCapabilities: async () => capabilities,
          admissionRefusal: async () => null,
        })({
          job: siteJob(brief, index),
          stepIndex: 0,
          now: NOW,
          firestore: aiEvalMemoryFirestore({}).firestore,
          org: FREE_ORG,
        })) as unknown as Record<string, unknown>
        const review = outcome['review'] as { reason?: string; findings?: Array<{ code: string; message: string }> } | undefined
        return {
          brief: brief.businessType,
          planned: Boolean(outcome['plan']) && (!review || review.reason === 'plan'),
          refused: outcome['uncredited'] === true || outcome['refused'] === true,
          findings: (review?.findings ?? []).map((finding) => `${finding.code}: ${finding.message}`),
          estCostUsd: Number(outcome['estCostUsd'] ?? 0),
        }
      }),
    )
    // The whole table, every run, so a red run shows every brief's outcome.
    console.log(JSON.stringify(results, null, 1))
    expect(results.filter((result) => !result.planned || result.refused)).toEqual([])
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
