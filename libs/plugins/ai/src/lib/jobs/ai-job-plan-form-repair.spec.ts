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
 * A section that collects answers gets its form placed instead of failing
 * the build (AGL-3660). A production portfolio start (2026-10-09, beta.237)
 * failed at its plan on rule 3 alone — a "commission inquiry" section on the
 * Work page that placed none of the plan's forms — and the customer read
 * "Your site was not built". One section is settled, never a whole site lost.
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

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { AI_BUILD_PLAN_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import { aiPlanCapabilitiesForJob, type AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiDoctrinePlanCheck } from '../runtime/ai-doctrine'
import {
  AI_PLAN_SETTLED_FORM,
  aiSettlePlanForms,
  aiSettlePlanRefs,
  detectPlanInlineForms,
  validateAiBuildPlan,
} from '../runtime/ai-doctrine-validators'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import {
  AI_JOB_PLAN_SCOPES,
  AI_SITE_FORM_SENTENCE,
  aiJobPlanPrompt,
  aiSitePlanCapabilities,
  createAiJobPlanStep,
} from './ai-job-plan-step'
import { AI_CERAMICS_PORTFOLIO_SITE_PLAN as PLAN } from './fixtures/ai-ceramics-portfolio-site-plan'

const NOW = new Date('2026-10-09T23:48:00.000Z')
const PAID_ORG: Partial<AglynOrgBilling> = { plan: 'pro' }

/** A site as provisioning leaves it (AGL-3497): its layout and its untouched starter home. */
const NEW_SITE: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scrStarter', name: 'Home', slug: '/', layoutId: 'laySite', template: false, replaceable: true }],
}
const LAYOUT_ROWS = [{ id: 'laySite', kind: undefined, sourceType: undefined, deletedAt: undefined }]
const PAID: AiPlanCapabilities = aiPlanCapabilitiesFrom(PAID_ORG, { layout: LAYOUT_ROWS, template: [] })

function portfolioJob(): AiJob {
  return {
    $id: 'job-portfolio',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief:
      'A 5-page website for a portfolio for a ceramic artist who makes stoneware bowls, mugs and vases. Make it a portfolio site. Plan a page for each thing a visitor comes to do, and a contact form on the page that asks to be contacted.',
    inputs: {
      businessType: 'a portfolio for a ceramic artist who makes stoneware bowls, mugs and vases',
      starter: 'portfolio',
      siteKind: 'portfolio',
      pages: 5,
      businessName: 'Kiln Street Ceramics',
      submissions: 'inbox',
      welcomeEmail: false,
    },
    steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 120,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

/** What the plan step holds a paid site start to, as it derives it. */
const SITE_PAID = aiSitePlanCapabilities(
  portfolioJob(),
  aiPlanCapabilitiesForJob(PAID, AI_JOB_PLAN_SCOPES.site ?? null),
) as AiPlanCapabilities

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const toolAnswer = (input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: AI_BUILD_PLAN_TOOL.name, input }],
  usage: ZERO_USAGE,
  estCostUsd: 0,
  stopReason: 'tool_use',
})

const codes = (plan: AiBuildPlan, inventory: AiSiteInventory | null = NEW_SITE, capabilities: AiPlanCapabilities | null = SITE_PAID) =>
  validateAiBuildPlan(plan, inventory, null, capabilities).map((violation) => violation.code)

const checked = (plan: AiBuildPlan, inventory: AiSiteInventory | null = NEW_SITE, capabilities: AiPlanCapabilities | null = SITE_PAID) =>
  aiDoctrinePlanCheck(inventory, null, capabilities)(plan as never)

const withWork = (sections: AiBuildPlan['screens'][number]['sections'], plan: AiBuildPlan = PLAN): AiBuildPlan => ({
  ...plan,
  screens: plan.screens.map((screen, index) => (index === 1 ? { ...screen, sections } : screen)),
})

describe('the production portfolio plan (2026-10-09)', () => {
  it('as the model wrote it, breaks rule 3 alone, at the Work page’s inquiry section', () => {
    const found = validateAiBuildPlan(PLAN, NEW_SITE, null, SITE_PAID)
    expect(found.map(({ rule, code, paths }) => [rule, code, paths])).toEqual([
      [3, 'plan-form-not-placed', ['screens[1].sections[4]']],
    ])
    // The re-ask names the form to place, not only the rule.
    expect(found[0].detail).toBe("Put one of these in the section's uses: new:Contact form.")
  })

  it('passes the plan check with the plan’s own contact form placed there, and nothing else changed', () => {
    const result = checked(PLAN)
    expect(result.violations).toEqual([])
    const plan = result.value as AiBuildPlan
    expect(plan.screens[1].sections[4]).toEqual({ name: 'Commission inquiry', uses: ['new:Contact form'], items: 0 })
    // One form, placed twice: no second form is made.
    expect(plan.create).toEqual(PLAN.create)
    expect(plan.screens.map((screen) => screen.sections.map((section) => section.name))).toEqual(
      PLAN.screens.map((screen) => screen.sections.map((section) => section.name)),
    )
    expect(plan.screens[4]).toEqual(PLAN.screens[4])
  })

  it('is kept by the plan step on the first answer: the job goes on to its review, nothing refunded', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValue(toolAnswer(PLAN))
    const outcome = await createAiJobPlanStep({
      readInventory: async () => NEW_SITE,
      findPlansByKey: null,
      readCapabilities: async () => PAID,
      admissionRefusal: async () => null,
      readSiteContext: null,
    })({ job: portfolioJob(), stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org: PAID_ORG })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(outcome.uncredited).toBeUndefined()
    expect(outcome.review).toMatchObject({ reason: 'plan', findings: [] })
    expect(outcome.plan?.status).toBe('proposed')
    expect(outcome.plan?.screens[1].sections[4].uses).toEqual(['new:Contact form'])
  })

  it('tells the planner, on a site start’s own turn, that a section asking for something places the form', () => {
    const prompt = aiJobPlanPrompt(portfolioJob(), SITE_PAID, NEW_SITE)
    expect(prompt).toContain(AI_SITE_FORM_SENTENCE)
    // A site that has no form and may make none is told to plan none instead.
    const formless = { ...SITE_PAID, create: { ...SITE_PAID.create, form: { allowed: false, left: null, reason: 'no' } } }
    expect(aiJobPlanPrompt(portfolioJob(), formless, NEW_SITE)).not.toContain(AI_SITE_FORM_SENTENCE)
  })
})

describe('a section that collects answers with no form placed', () => {
  it('places the plan’s form when the model named it without its new: prefix', () => {
    const bare = withWork([...PLAN.screens[1].sections.slice(0, 4), { name: 'Commission inquiry', uses: ['Contact form'], items: 0 }])
    expect(aiSettlePlanRefs(bare, NEW_SITE).screens[1].sections[4].uses).toEqual(['new:Contact form'])
    expect(checked(bare).violations).toEqual([])
  })

  it('places the form whose name matches it best, when the plan makes several', () => {
    const plan: AiBuildPlan = {
      ...PLAN,
      create: [
        ...PLAN.create,
        { kind: 'form', name: 'Commission request', why: 'Commissions ask different questions.', duplicateOf: null, fields: ['name', 'email', 'piece', 'budget'] },
      ],
    }
    expect(aiSettlePlanForms(plan, NEW_SITE, SITE_PAID).screens[1].sections[4].uses).toEqual(['new:Commission request'])
  })

  it('plans the contact form and places it everywhere it is asked for, when the plan makes no form', () => {
    const formless: AiBuildPlan = {
      ...PLAN,
      create: [],
      screens: PLAN.screens.map((screen) => ({
        ...screen,
        sections: screen.sections.map((section) => ({ ...section, uses: [] })),
      })),
    }
    expect(codes(formless)).toEqual(['plan-form-not-placed'])
    const settled = aiSettlePlanForms(formless, NEW_SITE, SITE_PAID)
    expect(settled.create).toEqual([
      { kind: 'form', name: 'Contact form', why: AI_PLAN_SETTLED_FORM.why, duplicateOf: null, fields: ['name', 'email', 'message'] },
    ])
    expect(settled.screens[1].sections[4].uses).toEqual(['new:Contact form'])
    expect(settled.screens[4].sections[1].uses).toEqual(['new:Contact form'])
    expect(checked(formless).violations).toEqual([])
  })

  it('declares the form a section names but the plan never created, under the name it was given', () => {
    const undeclared: AiBuildPlan = {
      ...withWork([...PLAN.screens[1].sections.slice(0, 4), { name: 'Commission inquiry', uses: ['new:Commission form'], items: 0 }]),
      create: [],
      screens: withWork([...PLAN.screens[1].sections.slice(0, 4), { name: 'Commission inquiry', uses: ['new:Commission form'], items: 0 }]).screens.map(
        (screen, index) => (index === 4 ? { ...screen, sections: screen.sections.map((section) => ({ ...section, uses: [] })) } : screen),
      ),
    }
    const result = checked(undeclared)
    expect(result.violations).toEqual([])
    const plan = result.value as AiBuildPlan
    expect(plan.create.map((entry) => [entry.kind, entry.name])).toEqual([['form', 'Commission form']])
    expect(plan.screens[1].sections[4].uses).toEqual(['new:Commission form'])
    expect(plan.screens[4].sections[1].uses).toEqual(['new:Commission form'])
  })

  it('places the site’s best-matching form, where the job may create none', () => {
    const site: AiSiteInventory = {
      ...NEW_SITE,
      forms: [
        { id: 'frmNews', name: 'Newsletter sign-up', fields: ['email'] },
        { id: 'frmInquiry', name: 'Commission inquiry', fields: ['name', 'email', 'message'] },
      ] as AiSiteInventory['forms'],
    }
    const plan: AiBuildPlan = { ...PLAN, create: [], screens: PLAN.screens.slice(0, 2) }
    const free = { ...SITE_PAID, create: { ...SITE_PAID.create, form: { allowed: false, left: 0, reason: 'this site has no room for another' } } }
    const settled = aiSettlePlanForms(plan, site, free)
    expect(settled.create).toEqual([])
    expect(settled.screens[1].sections[4].uses).toEqual(['frmInquiry'])
    expect(detectPlanInlineForms(settled, site, free)).toEqual([])
  })

  it('asks nothing of a site that has no form and may make none', () => {
    const formless = { ...SITE_PAID, create: { ...SITE_PAID.create, form: { allowed: false, left: null, reason: 'no' } } }
    const plan: AiBuildPlan = { ...PLAN, create: [] }
    expect(aiSettlePlanForms(plan, NEW_SITE, formless)).toBe(plan)
  })

  it('leaves a plan that places every form it asks for untouched', () => {
    const placed = withWork([...PLAN.screens[1].sections.slice(0, 4), { name: 'Commission inquiry', uses: ['new:Contact form'], items: 0 }])
    expect(aiSettlePlanForms(placed, NEW_SITE, SITE_PAID)).toBe(placed)
  })
})
