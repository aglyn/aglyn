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
 * A site start's datasets (AGL-3616): the unit that designs one and hands it
 * to the data plugin's writer, the gate it asks before its first pass, what
 * the plan step is told, and the listings the pages built after it get.
 * The model and the writer are fakes; everything else is the real code.
 */

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiBuildPlanCreate } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import type { generateAiDataset } from '../runtime/ai-dataset-generation'
import type { AiJobStepContext } from './ai-job-text-step'
import {
  AI_SITE_DATASET_INPUT,
  AI_SITE_DATASET_NOT_WRITTEN_COPY,
  AI_SITE_DATASETS_MAX,
  aiSiteDatasetBriefLines,
  aiSiteDatasetInputOf,
  aiSiteDatasetListings,
  aiSiteDatasetNote,
  aiSiteDatasetRefusal,
  aiSitePlanDatasetCapability,
  aiSitePlanDatasets,
  aiSiteRecordTemplateOf,
  createAiSiteDatasetRunner,
} from './ai-job-site-datasets'

const NOW = new Date('2026-10-10T12:00:00.000Z')

const MENU: AiBuildPlanCreate = {
  kind: 'dataset',
  name: 'Menu',
  why: 'the dishes the menu page and the home list',
  duplicateOf: null,
  fields: ['Dish', 'Description', 'Course'],
  id: 'drftMenu01',
}

const screen = (title: string, slug: string, sections: AiJobPlan['screens'][number]['sections'], extra: Record<string, unknown> = {}) =>
  ({ title, slug, layout: null, template: null, duplicateOf: null, nav: true, seoTitle: title, seoDescription: title, sections, record: null, ...extra }) as AiJobPlan['screens'][number]

const SCREENS = [
  screen('Home', '/', [{ name: 'hero', uses: [], items: 0 }, { name: 'From the menu', uses: ['new:Menu'], items: 3 }], { id: 'pHome' }),
  screen('Menu', '/menu', [{ name: 'Menu intro', uses: [], items: 0 }, { name: 'The whole menu', uses: ['new:menu'], items: 12 }], { id: 'pMenu' }),
  screen('Dish', '/menu-dish', [{ name: 'Dish detail', uses: [], items: 0 }], { id: 'pDish', nav: false, record: { dataset: 'new:Menu', base: 'menu' } }),
]

/** The derived job the scaffold hands a dataset unit. */
function unitJob(overrides: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'drftMenu01',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'text',
    status: 'running',
    brief: 'A trattoria in Bologna serving wood-fired pizza and fresh pasta.',
    inputs: { [AI_SITE_DATASET_INPUT]: aiSiteDatasetInputOf(MENU, SCREENS) },
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    plan: { reuse: [], create: [MENU], screens: [], status: 'confirmed', labels: {} } as unknown as AiJobPlan,
    ...overrides,
  }
}

const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ get: (field: string) => (field === 'subdomain' ? 'trattoria' : undefined) }) }) }),
} as unknown as FirebaseFirestore.Firestore

const context = (job: AiJob): AiJobStepContext => ({ job, stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' } as never })

const SPEND = {
  attempts: 1,
  usage: { inputTokens: 900, outputTokens: 700, cacheReadTokens: 0, cacheWriteTokens: 0 },
  estCostUsd: 0.01,
  model: 'routed-model',
  stopReason: 'tool_use',
  effort: null,
}

const DESIGNED = {
  fields: [
    { name: 'Dish', type: 'text' as const },
    { name: 'Description', type: 'text' as const },
    { name: 'Course', type: 'text' as const },
    { name: 'Vegetarian', type: 'boolean' as const },
  ],
  records: [
    ['Margherita', 'Tomato, fior di latte and basil from the wood oven.', 'Pizza', 'yes'],
    ['Tagliatelle al ragù', 'Fresh egg pasta with a slow-cooked Bolognese ragù.', 'Pasta', 'no'],
    ['Tiramisù', 'Mascarpone, espresso and cocoa.', 'Dessert', 'yes'],
  ],
}

function fakeWriter(overrides: Partial<PluginResourceDraftWriter> = {}) {
  const writes: Array<Parameters<PluginResourceDraftWriter['write']>[0]> = []
  const writer: PluginResourceDraftWriter = {
    refusal: async () => null,
    check: () => ({ ok: true, facts: {} }),
    read: async () => null,
    write: async (request) => {
      writes.push(request)
      return {
        ok: true,
        replayed: false,
        id: request.id,
        name: request.name,
        versionId: null,
        facts: {
          fields: [
            { id: 'dish', name: 'Dish', type: 'text' },
            { id: 'description', name: 'Description', type: 'text' },
            { id: 'course', name: 'Course', type: 'text' },
            { id: 'vegetarian', name: 'Vegetarian', type: 'bool' },
            { id: 'slug', name: 'Page address', type: 'text' },
          ],
          records: 3,
          addressField: 'slug',
        },
      }
    },
    ...overrides,
  }
  return { writer, writes, writerFor: () => ({ pluginId: 'data', writer }) }
}

const generated = (value = DESIGNED) =>
  jest.fn(async () => ({ ...SPEND, status: 'ok' as const, value })) as unknown as typeof generateAiDataset

describe('what a site plan’s dataset is', () => {
  it('reads the plan’s datasets, at most a start’s few, and where each is listed', () => {
    const many = Array.from({ length: AI_SITE_DATASETS_MAX + 2 }, (_, index) => ({ ...MENU, name: `List ${index}` }))
    expect(aiSitePlanDatasets({ create: [{ ...MENU, kind: 'form' }, ...many] })).toHaveLength(AI_SITE_DATASETS_MAX)
    expect(aiSiteDatasetInputOf(MENU, SCREENS)).toEqual({
      shownIn: ['Home › From the menu (3 items)', 'Menu › The whole menu (12 items)'],
      recordPages: true,
    })
    expect(aiSiteRecordTemplateOf(SCREENS[2])).toBe('Menu')
    expect(aiSiteRecordTemplateOf(SCREENS[0])).toBeNull()
  })
})

describe('the dataset unit', () => {
  it('designs the dataset from the brief and has the data plugin write it under the creation’s id', async () => {
    const generate = generated()
    const { writes, writerFor } = fakeWriter()
    const outcome = await createAiSiteDatasetRunner({ generate, writerFor })(context(unitJob()))
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Menu',
        fields: ['Dish', 'Description', 'Course'],
        shownIn: ['Home › From the menu (3 items)', 'Menu › The whole menu (12 items)'],
        recordPages: true,
        model: 'routed-model',
      }),
    )
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ orgId: 'org-1', hostId: 'host-1', uid: 'uid-1', id: 'drftMenu01', name: 'Menu' })
    expect(writes[0].content).toEqual({
      name: 'Menu',
      fields: DESIGNED.fields,
      records: [
        { Dish: 'Margherita', Description: 'Tomato, fior di latte and basil from the wood oven.', Course: 'Pizza', Vegetarian: 'yes' },
        { Dish: 'Tagliatelle al ragù', Description: 'Fresh egg pasta with a slow-cooked Bolognese ragù.', Course: 'Pasta', Vegetarian: 'no' },
        { Dish: 'Tiramisù', Description: 'Mascarpone, espresso and cocoa.', Course: 'Dessert', Vegetarian: 'yes' },
      ],
      // A record page shows each dish at an address made from its name.
      pageAddressFrom: 'Dish',
    })
    expect(outcome.usage).toEqual(SPEND.usage)
    expect(outcome.outputs).toEqual([
      expect.objectContaining({
        resource: 'draft',
        draftResource: 'dataset',
        id: 'drftMenu01',
        hostSubdomain: 'trattoria',
        label: 'Menu',
        note: aiSiteDatasetNote(3),
        proposal: expect.objectContaining({ recordNames: ['Margherita', 'Tagliatelle al ragù', 'Tiramisù'], addressField: 'slug' }),
      }),
    ])
  })

  it('reports the dataset it already wrote, spending nothing, when its pass runs again', async () => {
    const generate = generated()
    const { writerFor, writes } = fakeWriter({
      read: async ({ id }) => ({ id, name: 'Menu', versionId: null, facts: { fields: [{ id: 'dish', name: 'Dish', type: 'text' }], addressField: null } }),
    })
    const outcome = await createAiSiteDatasetRunner({ generate, writerFor })(context(unitJob()))
    expect(generate).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
    expect(outcome.outputs.map((output) => output.id)).toEqual(['drftMenu01'])
    expect(outcome.estCostUsd).toBe(0)
  })

  it('fails on our side where the data plugin refuses what we made, and leaves an allowance to the workspace', async () => {
    const refusedByModel = fakeWriter({ check: () => ({ ok: false, problems: ['Record 1: Vegetarian must be true or false'] }) })
    const ours = await createAiSiteDatasetRunner({ generate: generated(), writerFor: refusedByModel.writerFor })(context(unitJob()))
    expect(ours.failure).toBe(AI_SITE_DATASET_NOT_WRITTEN_COPY)
    expect(refusedByModel.writes).toHaveLength(0)
    const full = fakeWriter({ write: async () => ({ ok: false, status: 403, error: 'Dataset limit reached (2) — upgrade in Billing' }) })
    const limit = await createAiSiteDatasetRunner({ generate: generated(), writerFor: full.writerFor })(context(unitJob()))
    expect(limit.review).toEqual({ reason: 'limit', message: 'Dataset limit reached (2) — upgrade in Billing', findings: [] })
  })

  it('passes a model’s refusal and a broken answer on as the step’s own', async () => {
    const refused = jest.fn(async () => ({ ...SPEND, status: 'refused' as const })) as unknown as typeof generateAiDataset
    expect((await createAiSiteDatasetRunner({ generate: refused, writerFor: fakeWriter().writerFor })(context(unitJob()))).refused).toBe(true)
    const broken = jest.fn(async () => ({ ...SPEND, status: 'needs_input' as const, violations: [], message: 'It could not be designed.' })) as unknown as typeof generateAiDataset
    expect((await createAiSiteDatasetRunner({ generate: broken, writerFor: fakeWriter().writerFor })(context(unitJob()))).failure).toBe('It could not be designed.')
  })

  it('writes nothing where the data plugin is not loaded', async () => {
    const outcome = await createAiSiteDatasetRunner({ generate: generated(), writerFor: () => null })(context(unitJob()))
    expect(outcome.failure).toBe('Datasets are not available on this site.')
    expect(outcome.estCostUsd).toBe(0)
  })
})

describe('whether a site start may create datasets here', () => {
  const ask = { firestore, org: { plan: 'pro' } as never, now: NOW, job: { orgId: 'org-1', hostId: 'host-1', createdBy: 'uid-1' } }

  it('asks the data plugin, in its own words, whether this member may make one now', async () => {
    const admission = jest.fn(async () => ({ status: 403 as const, error: 'Turn on Data for this site before starting the job.' }))
    expect(await aiSiteDatasetRefusal(ask, { admission, writerFor: fakeWriter().writerFor })).toBe('Turn on Data for this site before starting the job.')
    expect(admission).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', hostId: 'host-1', uid: 'uid-1' }),
      expect.objectContaining({ kind: 'site', drafts: [{ resource: 'dataset', label: 'Data' }] }),
    )
    expect(await aiSiteDatasetRefusal(ask, { admission: async () => null, writerFor: fakeWriter().writerFor })).toBeNull()
  })

  it('tells a paid plan it may create a start’s few, Starter its two, and a refused one why not', async () => {
    const pro = aiPlanCapabilitiesFrom({ plan: 'pro' } as never)
    expect((await aiSitePlanDatasetCapability(pro, ask, { admission: async () => null })).create.dataset).toEqual({
      allowed: true,
      left: AI_SITE_DATASETS_MAX,
      reason: null,
    })
    const starter = aiPlanCapabilitiesFrom({ plan: 'starter' } as never)
    expect((await aiSitePlanDatasetCapability(starter, { ...ask, org: { plan: 'starter' } as never }, { admission: async () => null })).create.dataset.left).toBe(2)
    const refused = await aiSitePlanDatasetCapability(pro, ask, {
      admission: async () => ({ status: 403, error: 'Datasets are not available for this workspace yet' }),
    })
    expect(refused.create.dataset).toEqual({
      allowed: false,
      left: 0,
      reason: 'datasets cannot be created here: Datasets are not available for this workspace yet',
    })
  })

  it('asks nothing of a Free workspace, whose plan includes no datasets', async () => {
    const admission = jest.fn()
    const free = aiPlanCapabilitiesFrom({ plan: 'free' } as never)
    expect(await aiSitePlanDatasetCapability(free, ask, { admission })).toBe(free)
    expect(admission).not.toHaveBeenCalled()
  })
})

describe('what the pages built after a dataset are told', () => {
  const written: AiJobOutput = {
    resource: 'draft',
    draftResource: 'dataset',
    id: 'drftMenu01',
    hostId: 'host-1',
    label: 'Menu',
    proposal: {
      fields: [
        { id: 'dish', name: 'Dish', type: 'text' },
        { id: 'description', name: 'Description', type: 'text' },
        { id: 'slug', name: 'Page address', type: 'text' },
      ],
      recordNames: ['Margherita', 'Tiramisù'],
      addressField: 'slug',
    },
  }

  it('lists the dataset in every section that names it, featured on the home, all of it on its own page', () => {
    const listings = aiSiteDatasetListings({
      outputs: [written],
      datasets: [MENU],
      screens: SCREENS,
      delivered: new Map([['menu', 'drftMenu01']]),
    })
    expect(listings).toEqual([
      {
        id: 'listing:records:drftMenu01',
        kind: 'records',
        name: 'Menu',
        records: ['Margherita', 'Tiramisù'],
        datasetId: 'drftMenu01',
        // The page address is the record page's, never a card's words.
        fields: [
          { id: 'dish', name: 'Dish', type: 'text' },
          { id: 'description', name: 'Description', type: 'text' },
        ],
        placements: [
          { screenId: 'pHome', section: 1, role: 'featured' },
          { screenId: 'pMenu', section: 1, role: 'index' },
        ],
      },
    ])
  })

  it('lists nothing for a dataset not made, so its sections write the items out', () => {
    expect(aiSiteDatasetListings({ outputs: [], datasets: [MENU], screens: SCREENS, delivered: new Map() })).toEqual([])
  })

  it('names the records a page may name', () => {
    expect(aiSiteDatasetBriefLines([written])).toEqual([
      'This site\'s dataset “Menu” holds: “Margherita”, “Tiramisù”. Where a page names one, name it as written; never name one that is not in this list.',
    ])
  })
})
