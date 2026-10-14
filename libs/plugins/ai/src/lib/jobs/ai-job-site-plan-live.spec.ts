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
 * rules — on a site as provisioning creates it (AGL-3497: its header and
 * footer layout and its untouched starter home), and holds every brief to a
 * plan the rules keep.
 *
 * It calls the provider and costs real money (about 19 credits a brief), so
 * it runs only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set.
 * Run it before promoting a change to the site job, its prompt or its rules.
 *
 * THE CHEAP VERIFICATION LADDER (AGL-3660; docs/AI_JOBS.md, "Verifying a
 * prompt change"). Climb it in order and stop at the first rung that can
 * see the mistake:
 *
 *   1. unit tests — the step's own spec on golden answers, and
 *      `runtime/ai-prompt-cache.spec.ts` for the cached bytes: free;
 *   2. replay — this spec again: under the launcher every request whose
 *      bytes were answered before is replayed from `.cache/ai-replay` for
 *      nothing, and only a CHANGED prompt goes to the provider;
 *   3. one live run per plan (Free, then `AGLYN_LIVE_AI_ORG_PLAN=business`)
 *      for the prompts you changed — read `run.live` in the table: 0 means
 *      nothing new was asked and the run proves nothing;
 *   4. the full live sweep, only before landing: `AGLYN_AI_REPLAY=refresh`
 *      asks every request again, and `AGLYN_LIVE_AI_BATCH=1` sends the round
 *      as one Message Batch at half price (minutes, not seconds).
 */

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
/**
 * Each plan answer the step reads, by brief (AGL-3660): the home's section
 * count and what the step's own checks found in it — so a run says how often
 * the first answer passed and how often the thin-home re-ask fired. A
 * pass-through: the real doctrine runs, only its `extend` is observed.
 */
const mockAnswers = new Map<string, Array<{ home: number | null; codes: string[] }>>()
/** What each brief's plan generation came to: its model calls and how it ended. */
const mockGenerations = new Map<string, { attempts: number; status: string; violations: string[] }>()
jest.mock('../runtime/ai-doctrine', () => {
  const actual = jest.requireActual('../runtime/ai-doctrine')
  return {
    ...actual,
    runValidatedGeneration: (kind: string, input: Record<string, unknown>) => {
      const extend = input['extend'] as ((plan: { screens: Array<{ slug: string; sections: unknown[] }> }, answer: unknown) => Array<{ code: string }>) | undefined
      if (kind !== 'plan' || !extend) return actual.runValidatedGeneration(kind, input)
      const messages = input['messages'] as Array<{ content: unknown }>
      const key = String(messages[0]?.content ?? '')
      const answers: Array<{ home: number | null; codes: string[] }> = []
      mockAnswers.set(key, answers)
      return actual.runValidatedGeneration(kind, {
        ...input,
        extend: (plan: { screens: Array<{ slug: string; sections: unknown[] }> }, answer: unknown) => {
          const found = extend(plan, answer)
          const home = plan.screens.find((screen) => ['/', ''].includes(screen.slug.trim()))
          answers.push({ home: home ? home.sections.length : null, codes: found.map((violation) => violation.code) })
          return found
        },
      }).then((result: { attempts: number; status: string; violations?: Array<{ code: string }> }) => {
        mockGenerations.set(key, {
          attempts: result.attempts,
          status: result.status,
          violations: (result.violations ?? []).map((violation) => violation.code),
        })
        return result
      })
    },
  }
})
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiSitePlanIsHome } from '../model/ai-site-job'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { createAiJobPlanStep } from './ai-job-plan-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const NOW = new Date()
/**
 * The workspace the plans are made on: Free, as a guided start makes most of
 * them, or a paid one with `AGLYN_LIVE_AI_ORG_PLAN=business` (AGL-3660) — a
 * Free site plans on the fast tier, so only a paid one exercises the balanced
 * default's plan.
 */
const ORG_PLAN = process.env['AGLYN_LIVE_AI_ORG_PLAN'] === 'business' ? 'business' : 'free'
/** The pages the guided start asks for: Free's most, or a paid start's default of five. */
const PAGES = ORG_PLAN === 'business' ? 5 : 2
const ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: ORG_PLAN, ownerUid: 'owner-1' }

/**
 * Briefs as people answer the guided start: a business, who it is for, a look,
 * two pages — and the site's own name, which the create door adds (AGL-3596).
 */
const BRIEFS: ReadonlyArray<{ businessName: string; businessType: string; audience: string; starter: string; siteKind?: string }> = [
  // The beta.237 store start Zach judged "not a store front" (AGL-3676): its
  // plan is settled into a storefront, which the table reports below.
  { businessName: 'Willow Wick Candles', businessType: 'a small-batch candle shop selling hand-poured soy candles online', audience: 'people who buy candles for themselves and as gifts', starter: 'shop-physical', siteKind: 'store' },
  { businessName: 'Hillside Dog Grooming', businessType: 'a neighborhood dog groomer in Austin that takes grooming appointments', audience: 'local dog owners who want a regular groom', starter: 'business' },
  { businessName: 'Maple Street Dental', businessType: 'a family dental practice', audience: 'parents booking check-ups for their kids', starter: 'business' },
  { businessName: 'Ana Ruiz Photography', businessType: 'a wedding photographer', audience: 'engaged couples comparing photographers', starter: 'portfolio' },
  { businessName: 'Summit Roofing', businessType: 'a roofing contractor', audience: 'homeowners after a storm', starter: 'business' },
  { businessName: 'Still Point Yoga', businessType: 'a yoga studio with drop-in classes', audience: 'beginners nervous about their first class', starter: 'landing' },
  { businessName: 'Crumb & Co', businessType: 'a bakery that sells cakes to order', audience: 'people planning a birthday', starter: 'shop-physical' },
  { businessName: 'Eastside Food Bank', businessType: 'a nonprofit food bank', audience: 'volunteers and donors', starter: 'business' },
  { businessName: 'Ledgerly Books', businessType: 'a freelance bookkeeper', audience: 'small business owners behind on their books', starter: 'business' },
  { businessName: 'Gleam Mobile Detailing', businessType: 'a mobile car detailing service', audience: 'busy commuters', starter: 'landing' },
  { businessName: 'Fretwork Lessons', businessType: 'a guitar teacher', audience: 'adults who always wanted to learn', starter: 'business' },
]

function siteJob(inputs: Record<string, unknown>, index: number): AiJob {
  return {
    $id: `job-live-${index}`,
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'site',
    status: 'running',
    brief: `A ${PAGES}-page website for ${String(inputs['businessType'])}.`,
    inputs: { pages: PAGES, welcomeEmail: false, submissions: 'inbox', ...inputs },
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

/** A site as provisioning leaves it (AGL-3497): its layout and its untouched starter home. */
const PROVISIONED: AiSiteInventory = {
  ...emptyAiSiteInventory('host-live'),
  layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scrStarter', name: 'Home', slug: '/', layoutId: 'laySite', template: false, replaceable: true }],
}

const describeLive = LIVE ? describe : describe.skip

describeLive("a guided start's plan from the real model", () => {
  jest.setTimeout(10 * 60_000)

  it(`keeps the plan rules for every brief, on a ${ORG_PLAN} workspace’s provisioned site`, async () => {
    const capabilities = aiPlanCapabilitiesFrom(ORG, {
      layout: PROVISIONED.layouts.map((row) => ({ id: row.id, kind: undefined, sourceType: undefined, deletedAt: undefined })),
      template: [],
    })
    const results = await Promise.all(
      BRIEFS.map(async (brief, index) => {
        const outcome = (await createAiJobPlanStep({
          readInventory: async () => PROVISIONED,
          findPlansByKey: null,
          readCapabilities: async () => capabilities,
          admissionRefusal: async () => null,
        })({
          job: siteJob(brief, index),
          stepIndex: 0,
          now: NOW,
          firestore: aiEvalMemoryFirestore({}).firestore,
          org: ORG,
        })) as unknown as Record<string, unknown>
        const review = outcome['review'] as { reason?: string; findings?: Array<{ code: string; message: string }> } | undefined
        return {
          brief: brief.businessType,
          planned: Boolean(outcome['plan']) && (!review || review.reason === 'plan'),
          refused: outcome['uncredited'] === true || outcome['refused'] === true,
          findings: (review?.findings ?? []).map((finding) => `${finding.code}: ${finding.message}`),
          estCostUsd: Number(outcome['estCostUsd'] ?? 0),
          // Reported, not held: whether the plan's own words carry the name (AGL-3596).
          named: JSON.stringify(outcome['plan'] ?? null).includes(brief.businessName),
          // Reported, not held: how many sections the home at / was planned with (AGL-3660).
          home:
            (outcome['plan'] as AiJobPlan | undefined)?.screens.find((screen) => aiSitePlanIsHome(screen))?.sections
              .length ?? null,
          // Reported, not held: a store's pages as its plan was kept, settled into a storefront (AGL-3676).
          ...(brief.siteKind === 'store'
            ? {
                storefront: ((outcome['plan'] as AiJobPlan | undefined)?.screens ?? []).map(
                  (screen) => `${screen.slug}: ${screen.sections.map((section) => section.name).join(' | ')}`,
                ),
              }
            : {}),
          // Every answer the step read: its home's sections and what the step's checks found.
          answers: [...mockAnswers.entries()].find(([turn]) => turn.includes(brief.businessType))?.[1] ?? [],
          generation: [...mockGenerations.entries()].find(([turn]) => turn.includes(brief.businessType))?.[1] ?? null,
        }
      }),
    )
    // The whole table, every run, so a red run shows every brief's outcome.
    // Live against replayed (AGL-3660): a run with live 0 asked nothing new.
    console.log(JSON.stringify({ run: aiLiveRunLedger(), orgPlan: ORG_PLAN, results }, null, 1))
    expect(results.filter((result) => !result.planned || result.refused)).toEqual([])
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
