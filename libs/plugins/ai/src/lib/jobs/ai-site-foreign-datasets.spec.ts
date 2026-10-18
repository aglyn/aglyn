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
 * A site start never shows another site's records (AGL-3912). Replayed from
 * two production guided starts of 2026-10-17 whose plans reused datasets
 * deleted test sites had filled: a gym published a photographer's wedding
 * packages and a strength studio's coaches, and a photographer another
 * photographer's gallery, with broken photos.
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
      catalog.AI_MODEL_CATALOG.find((entry: { tier: string }) => entry.tier === catalog.AI_STEP_TIERS[kind])?.id,
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
import { AI_BUILD_PLAN_RECORDS_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import { aiPlanCapabilitiesForJob, type AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiDoctrinePlanCheck } from '../runtime/ai-doctrine'
import { AI_TYPED_LIST_MIN_ITEMS } from '../runtime/ai-doctrine-validators'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { AI_JOB_PLAN_SCOPES, aiSitePlanCapabilities, createAiJobPlanStep } from './ai-job-plan-step'
import {
  aiSettleSiteForeignDatasets,
  aiSiteDatasetIsThisSites,
  aiSiteInventoryWithRecordCounts,
  aiSiteReusedDatasetListings,
} from './ai-job-site-datasets'
import {
  AI_FOREIGN_DATASETS_INVENTORY as DATASETS,
  AI_IRONWOOD_SITE,
  AI_IRONWOOD_SITE_PLAN as IRONWOOD,
  AI_SILVER_FIR_SITE,
  AI_SILVER_FIR_SITE_PLAN as SILVER_FIR,
} from './fixtures/ai-site-foreign-datasets-recording'

const NOW = new Date('2026-10-17T05:30:00.000Z')
const PAID_ORG: Partial<AglynOrgBilling> = { plan: 'business' }

/** A new site's inventory as a site start's plan reads it: the workspace's datasets, counted, nothing of its own. */
const siteInventory = (hostId: string): AiSiteInventory => ({
  ...emptyAiSiteInventory(hostId),
  datasets: DATASETS.map((row) => (aiSiteDatasetIsThisSites(row) ? row : { ...row, foreign: true as const })),
})

function job(kind: AiJob['kind'], hostId: string, brief: string): AiJob {
  return {
    $id: `job-${kind}`,
    orgId: 'org-1',
    hostId,
    kind,
    status: 'running',
    brief,
    inputs: kind === 'site' ? { businessType: 'a local gym', pages: 4, submissions: 'inbox', welcomeEmail: false } : {},
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

const PAID: AiPlanCapabilities = aiPlanCapabilitiesFrom(PAID_ORG, { layout: [], template: [] })
const SITE_PAID = aiSitePlanCapabilities(
  job('site', AI_IRONWOOD_SITE, 'A gym.'),
  aiPlanCapabilitiesForJob(PAID, AI_JOB_PLAN_SCOPES.site ?? null),
) as AiPlanCapabilities
const NO_DATASETS: AiPlanCapabilities = {
  ...SITE_PAID,
  create: { ...SITE_PAID.create, dataset: { allowed: false, left: 0, reason: 'datasets are not on this plan' } },
}

const reusedIds = (plan: AiBuildPlan) => plan.reuse.map((entry) => entry.id)
const datasets = (plan: AiBuildPlan) => plan.create.filter((entry) => entry.kind === 'dataset')
const usesOf = (plan: AiBuildPlan, section: string) =>
  plan.screens.flatMap((screen) => screen.sections).find((one) => one.name === section)?.uses

const toolAnswer = (input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: AI_BUILD_PLAN_RECORDS_TOOL.name, input }],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  estCostUsd: 0,
  stopReason: 'tool_use',
})

describe('whose records a site start may show (AGL-3912)', () => {
  it('is an empty dataset, one made for this site alone, or one this site serves record pages for', () => {
    expect(aiSiteDatasetIsThisSites({ records: 0 })).toBe(true)
    expect(aiSiteDatasetIsThisSites({ records: 4, siteOnly: true })).toBe(true)
    expect(aiSiteDatasetIsThisSites({ records: 4, recordBase: 'coaches' })).toBe(true)
    // The workspace's, holding records: written for something else.
    expect(aiSiteDatasetIsThisSites({ records: 4 })).toBe(false)
    // Records that could not be counted are not known to be this site's.
    expect(aiSiteDatasetIsThisSites({})).toBe(false)
  })
})

describe('ironwood-barbell-gym’s plan (job YUICpDdidL)', () => {
  const settled = aiSettleSiteForeignDatasets(IRONWOOD, siteInventory(AI_IRONWOOD_SITE), SITE_PAID)

  it('makes again, with the same fields, each dataset another site filled', () => {
    expect(datasets(settled).map((entry) => [entry.name, entry.fields, entry.why])).toEqual([
      ['Session packages', ['Name', 'Type', 'Description', 'Duration', 'Includes'], 'Lists session packages on Services and Home'],
      // Its photo is searched for this site, never copied: the field comes back with the photos.
      ['Coaches', ['Name', 'Role', 'Specialty', 'Bio', 'Certifications'], 'Lists coaches on About'],
      ['Gym FAQs', ['Question', 'Answer', 'Category'], 'Lists gym FAQs on Contact'],
    ])
    expect(reusedIds(settled)).toEqual(['uKk5agxIcM', 'theme'])
  })

  it('points every section that listed one at the dataset made for this site', () => {
    expect(usesOf(settled, 'What we offer')).toEqual(['new:Session packages'])
    expect(usesOf(settled, 'Session packages list')).toEqual(['new:Session packages'])
    expect(usesOf(settled, 'Meet the coaches')).toEqual(['new:Coaches'])
    expect(usesOf(settled, 'Coaches')).toEqual(['new:Coaches'])
    expect(usesOf(settled, 'Frequently asked questions')).toEqual(['new:Gym FAQs'])
    // Nothing of the old ids is left for a page to list.
    expect(JSON.stringify(settled.screens)).not.toMatch(/4DCiNNbwjK|BvgMhWY9Nz|BAdfabo_W9/)
    expect(aiSiteReusedDatasetListings({ plan: { ...settled, labels: {} }, screens: settled.screens.map((screen, index) => ({ ...screen, id: `s${index}` })), listed: [] })).toEqual([])
  })

  it('keeps reusing the empty dataset its form writes to, which is the same list on any site', () => {
    expect(settled.create.find((entry) => entry.kind === 'form')?.writesTo).toBe('uKk5agxIcM')
  })

  it('passes the plan check, settled before the rules read it', () => {
    const result = aiDoctrinePlanCheck(siteInventory(AI_IRONWOOD_SITE), null, SITE_PAID, (plan) =>
      aiSettleSiteForeignDatasets(plan, siteInventory(AI_IRONWOOD_SITE), SITE_PAID),
    )(IRONWOOD as never)
    const plan = result.value as AiBuildPlan
    expect(datasets(plan).map((entry) => entry.name)).toEqual(['Session packages', 'Coaches', 'Gym FAQs'])
    expect(reusedIds(plan)).toEqual(['uKk5agxIcM', 'theme'])
    // Not held against it as a duplicate of the other site's dataset of that name.
    expect(result.violations.map((violation) => violation.code)).not.toContain('plan-duplicates-existing')
    expect(result.violations.filter((violation) => /dataset|reuse/i.test(`${violation.code} ${violation.message}`))).toEqual([])
  })

  it('where the workspace may make no dataset, writes those lists out on the page instead of refusing', () => {
    const free = aiSettleSiteForeignDatasets(IRONWOOD, siteInventory(AI_IRONWOOD_SITE), NO_DATASETS)
    expect(datasets(free)).toEqual([])
    expect(reusedIds(free)).toEqual(['uKk5agxIcM', 'theme'])
    const coaches = free.screens.flatMap((screen) => screen.sections).find((one) => one.name === 'Meet the coaches')
    expect(coaches).toEqual({ name: 'Meet the coaches', uses: [], items: 4 })
    const faqs = free.screens.flatMap((screen) => screen.sections).find((one) => one.name === 'Frequently asked questions')
    expect(faqs?.uses).toEqual([])
    expect(faqs?.items).toBeLessThan(AI_TYPED_LIST_MIN_ITEMS)
  })

  it('is kept by the plan step, the records counted once, with one request and no refusal', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValue(toolAnswer(IRONWOOD))
    const counted: string[] = []
    const held = new Map(DATASETS.map((row) => [row.id, row.records ?? 0]))
    const outcome = await createAiJobPlanStep({
      // The reader as production returns it: no counts until the step asks.
      readInventory: async () => ({ ...siteInventory(AI_IRONWOOD_SITE), datasets: DATASETS.map(({ records: _records, ...row }) => row) }),
      findPlansByKey: null,
      readCapabilities: async () => PAID,
      admissionRefusal: async () => null,
      readSiteContext: null,
      readSiteEvents: null,
      countDatasetRecords: async ({ id }) => {
        counted.push(id)
        return held.get(id) ?? null
      },
    })({ job: job('site', AI_IRONWOOD_SITE, 'A 4-page website for a local barbell gym.'), stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org: PAID_ORG })
    expect(counted.sort()).toEqual(DATASETS.map((row) => row.id).sort())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(outcome.failure).toBeUndefined()
    const plan = outcome.plan as AiBuildPlan
    expect(reusedIds(plan)).toEqual(['uKk5agxIcM', 'theme'])
    expect(datasets(plan).map((entry) => entry.name)).toEqual(['Session packages', 'Coaches', 'Gym FAQs'])
  })
})

describe('silver-fir-film-portrait’s plan (job 0XoEWZteOn)', () => {
  const settled = aiSettleSiteForeignDatasets(SILVER_FIR, siteInventory(AI_SILVER_FIR_SITE), SITE_PAID)

  it('makes its gallery its own, beside the two datasets it already made, and keeps its empty inquiries', () => {
    expect(datasets(settled).map((entry) => [entry.name, entry.fields])).toEqual([
      ['Photography packages', ['Name', 'Type', 'Description', 'Duration', 'Includes']],
      ['Photography FAQs', ['Question', 'Answer', 'Category']],
      ['Gallery sessions', ['Title', 'Category', 'Location', 'Description', 'Camera type']],
    ])
    expect(usesOf(settled, 'Selected work gallery')).toEqual(['new:Gallery sessions'])
    expect(usesOf(settled, 'Gallery by category')).toEqual(['new:Gallery sessions'])
    expect(reusedIds(settled)).toEqual(['v96W19iBEM', 'theme'])
    expect(settled.create.find((entry) => entry.kind === 'form')?.writesTo).toBe('v96W19iBEM')
  })

  it('names a dataset the plan already makes by that name, rather than making a second', () => {
    const named = {
      ...SILVER_FIR,
      create: [...SILVER_FIR.create, { kind: 'dataset' as const, name: 'Gallery sessions', why: 'The work', duplicateOf: null, fields: ['Title'] }],
    }
    const again = aiSettleSiteForeignDatasets(named, siteInventory(AI_SILVER_FIR_SITE), SITE_PAID)
    expect(datasets(again).filter((entry) => entry.name === 'Gallery sessions')).toHaveLength(1)
    expect(usesOf(again, 'Selected work gallery')).toEqual(['new:Gallery sessions'])
  })
})

describe('what a site start does not settle', () => {
  it('leaves a plan that reuses only empty datasets as it was', () => {
    const empty = { ...IRONWOOD, reuse: IRONWOOD.reuse.filter((entry) => ['uKk5agxIcM', 'theme'].includes(entry.id)) }
    expect(aiSettleSiteForeignDatasets(empty, siteInventory(AI_IRONWOOD_SITE), SITE_PAID)).toBe(empty)
  })

  it('makes again a form’s dataset another site filled, the form writing to the one made', () => {
    const filled = siteInventory(AI_IRONWOOD_SITE)
    filled.datasets = filled.datasets.map((row) => (row.id === 'uKk5agxIcM' ? { ...row, records: 3, foreign: true as const } : row))
    const settled = aiSettleSiteForeignDatasets(IRONWOOD, filled, SITE_PAID)
    expect(settled.create.find((entry) => entry.kind === 'form')?.writesTo).toBe('new:Gym contact leads')
    expect(datasets(settled).map((entry) => entry.name)).toContain('Gym contact leads')
    // Where none may be made, the form sends its submissions to the Inbox only.
    const free = aiSettleSiteForeignDatasets(IRONWOOD, filled, NO_DATASETS)
    expect(free.create.find((entry) => entry.kind === 'form')).not.toHaveProperty('writesTo')
  })

  it('keeps an Assist change reusing what the site lists: only a site start’s plan is settled', async () => {
    const page: AiBuildPlan = {
      reuse: [{ kind: 'dataset', id: 'BvgMhWY9Nz', purpose: 'Lists the coaches' }],
      create: [],
      screens: [
        {
          title: 'Coaches',
          slug: '/coaches',
          layout: null,
          template: null,
          duplicateOf: null,
          nav: true,
          seoTitle: 'Coaches',
          seoDescription: 'Meet the coaches.',
          record: null,
          sections: [{ name: 'Coaches', uses: ['BvgMhWY9Nz'], items: 4 }],
        },
      ],
    }
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValue(toolAnswer(page))
    const countDatasetRecords = jest.fn(async () => 4)
    const outcome = await createAiJobPlanStep({
      readInventory: async () => siteInventory(AI_IRONWOOD_SITE),
      findPlansByKey: null,
      readCapabilities: async () => PAID,
      admissionRefusal: async () => null,
      readSiteContext: null,
      readSiteEvents: null,
      countDatasetRecords,
    })({ job: job('page', AI_IRONWOOD_SITE, 'Add a page listing our coaches.'), stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org: PAID_ORG })
    expect(countDatasetRecords).not.toHaveBeenCalled()
    expect(reusedIds(outcome.plan as AiBuildPlan)).toContain('BvgMhWY9Nz')
    expect(datasets(outcome.plan as AiBuildPlan)).toEqual([])
  })
})

describe('counting a site start’s datasets (AGL-3912)', () => {
  it('counts each dataset the site sees, and leaves out a count that fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const inventory = { ...emptyAiSiteInventory('h'), datasets: DATASETS.slice(0, 2).map(({ records: _records, ...row }) => row) }
    const counted = await aiSiteInventoryWithRecordCounts(inventory, 'org-1', async ({ id }) => {
      if (id === 'BvgMhWY9Nz') throw new Error('unavailable')
      return 5
    })
    // Both read as another site's: one holds records, the other could not be counted.
    expect(counted?.datasets.map((row) => [row.id, row.records, row.foreign])).toEqual([
      ['4DCiNNbwjK', 5, true],
      ['BvgMhWY9Nz', undefined, true],
    ])
    const empty = await aiSiteInventoryWithRecordCounts(inventory, 'org-1', async () => 0)
    expect(empty?.datasets.map((row) => [row.records, row.foreign])).toEqual([
      [0, undefined],
      [0, undefined],
    ])
    expect(await aiSiteInventoryWithRecordCounts(null, 'org-1', async () => 1)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
