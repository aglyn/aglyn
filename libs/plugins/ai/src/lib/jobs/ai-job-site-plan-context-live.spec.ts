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

/**
 * A guided start's plan from the REAL model, with the site's business profile
 * in the prompt (AGL-3661). The sibling `ai-job-site-plan-live.spec.ts` plans
 * on a site with no profile; this one hands the plan step the profile a
 * guided start leaves behind and holds what the profile is for:
 *
 *  - the plan names the business by the profile's name;
 *  - every email address and phone number in the plan is one the profile
 *    gave — half the briefs give none, and a plan that prints one anyway
 *    invented it.
 *
 * It calls the provider and costs real money, so it runs only when asked:
 * `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, under the eval launcher for
 * replay, once on Free and once with `AGLYN_LIVE_AI_ORG_PLAN=business`. The
 * ids are built from the briefs, so an unchanged prompt replays for nothing.
 */

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import { resolveBusinessProfile } from '@aglyn/aglyn/app-utils/business-profile'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { AiJob } from '../model/ai-jobs.types'
import type { AiSiteContextInput } from '../model/ai-site-context'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { createAiJobPlanStep } from './ai-job-plan-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const NOW = new Date()
const ORG_PLAN = process.env['AGLYN_LIVE_AI_ORG_PLAN'] === 'business' ? 'business' : 'free'
const PAGES = ORG_PLAN === 'business' ? 5 : 2
const ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: ORG_PLAN, ownerUid: 'owner-1' }

interface Brief {
  businessName: string
  businessType: string
  audience: string
  starter: string
  services: string[]
  contact: { email: string; telephone: string } | null
}

/** Three sites whose owner entered contact details, and three whose owner did not. */
const BRIEFS: readonly Brief[] = [
  {
    businessName: 'Hillside Dog Grooming',
    businessType: 'a neighborhood dog groomer in Austin that takes grooming appointments',
    audience: 'local dog owners who want a regular groom',
    starter: 'business',
    services: ['Full groom', 'Bath and brush', 'Nail trim'],
    contact: { email: 'hello@hillside-grooming.test', telephone: '+1-512-555-0142' },
  },
  {
    businessName: 'Maple Street Dental',
    businessType: 'a family dental practice',
    audience: 'parents booking check-ups for their kids',
    starter: 'business',
    services: ['Check-ups', 'Cleanings', 'Fillings'],
    contact: null,
  },
  {
    businessName: 'Summit Roofing',
    businessType: 'a roofing contractor',
    audience: 'homeowners after a storm',
    starter: 'business',
    services: ['Storm damage repair', 'Roof replacement', 'Free inspections'],
    contact: { email: 'office@summit-roofing.test', telephone: '+1-303-555-0187' },
  },
  {
    businessName: 'Still Point Yoga',
    businessType: 'a yoga studio with drop-in classes',
    audience: 'beginners nervous about their first class',
    starter: 'landing',
    services: ['Drop-in classes', 'Beginner series'],
    contact: null,
  },
  {
    businessName: 'Crumb & Co',
    businessType: 'a bakery that sells cakes to order',
    audience: 'people planning a birthday',
    starter: 'shop-physical',
    services: ['Custom cakes', 'Cupcakes'],
    contact: { email: 'orders@crumbandco.test', telephone: '+1-918-555-0110' },
  },
  {
    businessName: 'Ledgerly Books',
    businessType: 'a freelance bookkeeper',
    audience: 'small business owners behind on their books',
    starter: 'business',
    services: ['Monthly bookkeeping', 'Catch-up bookkeeping'],
    contact: null,
  },
]

function siteJob(brief: Brief, index: number): AiJob {
  const { businessName, businessType, audience, starter } = brief
  return {
    $id: `job-live-context-${index}`,
    orgId: 'org-live',
    hostId: `host-live-context-${index}`,
    kind: 'site',
    status: 'running',
    brief: `A ${PAGES}-page website for ${businessType}.`,
    inputs: { pages: PAGES, welcomeEmail: false, submissions: 'inbox', businessName, businessType, audience, starter },
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

/** The context a guided start leaves: the start's answers, and the site's own settings. */
function siteContext(brief: Brief): AiSiteContextInput {
  return {
    profile: resolveBusinessProfile({
      host: {
        displayName: brief.businessName,
        seo: brief.contact ? { entity: { name: brief.businessName, ...brief.contact } as never } : null,
      },
      site: {
        whatYouDo: brief.businessType,
        services: brief.services,
        audience: brief.audience,
        sources: { whatYouDo: 'start', services: 'start', audience: 'start' },
      },
    }),
    preferences: [],
  }
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE = /\+?\d[\d\s().-]{8,}\d/g
const digits = (value: string) => value.replace(/\D/g, '')

/** Every email and phone number in the plan that the profile did not give. */
function inventedContacts(plan: unknown, brief: Brief): string[] {
  const text = JSON.stringify(plan ?? null)
  const emails = (text.match(EMAIL) ?? []).filter((email) => email.toLowerCase() !== brief.contact?.email)
  const phones = (text.match(PHONE) ?? []).filter(
    (phone) => digits(phone).length >= 10 && digits(phone) !== digits(brief.contact?.telephone ?? ''),
  )
  return [...emails, ...phones]
}

const describeLive = LIVE ? describe : describe.skip

describeLive("a guided start's plan from the real model, with the site's business profile", () => {
  jest.setTimeout(10 * 60_000)

  it(`names the business and invents no contact detail, on a ${ORG_PLAN} workspace`, async () => {
    const capabilities = aiPlanCapabilitiesFrom(ORG, { layout: [], template: [] })
    const results = await Promise.all(
      BRIEFS.map(async (brief, index) => {
        const outcome = (await createAiJobPlanStep({
          readInventory: async () => emptyAiSiteInventory(`host-live-context-${index}`),
          findPlansByKey: null,
          readCapabilities: async () => capabilities,
          readSiteContext: async () => siteContext(brief),
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
          brief: brief.businessName,
          contactGiven: Boolean(brief.contact),
          planned: Boolean(outcome['plan']) && (!review || review.reason === 'plan'),
          refused: outcome['uncredited'] === true || outcome['refused'] === true,
          named: JSON.stringify(outcome['plan'] ?? null).includes(brief.businessName),
          invented: inventedContacts(outcome['plan'], brief),
          findings: (review?.findings ?? []).map((finding) => `${finding.code}: ${finding.message}`),
          estCostUsd: Number(outcome['estCostUsd'] ?? 0),
        }
      }),
    )
    console.log(JSON.stringify({ run: aiLiveRunLedger(), orgPlan: ORG_PLAN, results }, null, 1))
    expect(results.filter((result) => !result.planned || result.refused)).toEqual([])
    expect(results.filter((result) => !result.named).map((result) => result.brief)).toEqual([])
    expect(results.filter((result) => result.invented.length)).toEqual([])
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
