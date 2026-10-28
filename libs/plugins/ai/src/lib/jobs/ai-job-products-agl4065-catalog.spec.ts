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
 * A STORE'S FIRST PRODUCTS, WHEN ITS BRIEF NAMES ONLY KINDS (AGL-4065). The
 * 2026-10-25 Berm & Bolt Moto Parts start listed "OEM Dirt Bike Parts
 * Order", "OEM ATV Parts Order", "Aftermarket Dirt Bike Part", "Dirt Bike
 * Tire", "ATV Tire" and "Riding Gear Item", each at a suggested price, from a
 * brief that named kinds of part and no product. A store whose brief names
 * only kinds still starts with products at suggested prices, as before, but
 * each is a SAMPLE of one of those kinds, named as a plain item of it and
 * marked for the owner to replace; and no catalog names a product after a
 * kind with "Item" or "Order" after it.
 *
 * Replayed offline: the real catalog generation with a fake provider
 * answering the recorded names, the site start's products unit with a fake
 * catalog and a fake writer. No model is asked.
 */

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'test-model',
}))

import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import * as Products from '../model/ai-products'
import { AI_PRODUCTS_OUTPUT_IDS, type AiCatalogProposal } from '../model/ai-products'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import type { AiCompletion, AiProvider, AiProviderRequest, AiResult } from '../providers/contract'
import { generateAiCatalog } from '../runtime/ai-products-generation'
import * as SiteContent from './ai-job-site-content'
import { aiSiteJobUnits, aiSiteUnitJob } from './ai-job-site-step'
import type { AiJobStepContext, AiJobStepOutcome } from './ai-job-text-step'
import {
  BERM_BOLT_BRIEF,
  BERM_BOLT_CATALOG_ANSWER,
  BERM_BOLT_FORM,
  BERM_BOLT_INPUTS,
  BERM_BOLT_SAMPLE_ANSWER,
  BERM_BOLT_SCREENS,
} from './fixtures/ai-site-agl4065-datasets'

const { AI_SITE_PRODUCT_NOTE, createAiSiteProductsRunner } = SiteContent
/** The functions this lane adds, read off the module so today's code fails each test rather than the file. */
const added = SiteContent as unknown as Record<string, unknown>

/** The Willow Wick candle brief the live plan eval runs (`ai-job-site-plan-live.spec.ts`): it names its products. */
const WILLOW_WICK_INPUTS = {
  businessName: 'Willow Wick Candles',
  businessType: 'a small-batch candle shop selling hand-poured soy candles online',
  audience: 'people who buy candles for themselves and as gifts',
  starter: 'shop-physical',
  siteKind: 'store',
}

const NOW = new Date('2026-10-25T06:05:00.000Z')

function answer(input: object): AiCompletion {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name: 'propose_catalog', input: input as Record<string, unknown> }],
    usage: { inputTokens: 1_200, outputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0.01,
    stopReason: 'tool_use',
  }
}

function provider(answers: AiResult[]): { fake: AiProvider; requests: AiProviderRequest[] } {
  const requests: AiProviderRequest[] = []
  const fake: AiProvider = {
    id: 'fake',
    label: 'Fake',
    apiKeyEnv: 'FAKE_AI_KEY',
    endpointHost: 'ai.test',
    readApiKey: () => 'key',
    models: () => [],
    complete: async (request) => {
      requests.push(request)
      const next = answers.shift()
      if (!next) throw new Error('no answer armed')
      return next
    },
    stream: async () => {
      throw new Error('a catalog never streams')
    },
  }
  return { fake, requests }
}

const turns = (request: AiProviderRequest) =>
  request.messages.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content))).join('\n')

/** The site start's Berm & Bolt job, with its plan confirmed. */
function siteJob(inputs: Record<string, unknown> = BERM_BOLT_INPUTS, brief = BERM_BOLT_BRIEF): AiJob {
  return {
    $id: 'job-berm',
    orgId: 'org-test',
    hostId: 'host-test',
    kind: 'site',
    status: 'running',
    brief,
    inputs,
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-test',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    plan: { reuse: [], create: [BERM_BOLT_FORM], screens: BERM_BOLT_SCREENS, status: 'confirmed', labels: {}, language: 'en' } as unknown as AiJobPlan,
  }
}

/** The job the site start hands its products unit. */
function productsUnitJob(job: AiJob): AiJob {
  const units = aiSiteJobUnits(job.plan as AiJobPlan, { content: 'products' })
  const unit = units.find((one) => one.kind === 'products')
  if (!unit) throw new Error('a paid store owes its products unit')
  return aiSiteUnitJob(job, unit, new Map())
}

function fakeWriter() {
  const writes: Array<Parameters<PluginResourceDraftWriter['write']>[0]> = []
  const writer: PluginResourceDraftWriter = {
    refusal: async () => null,
    check: () => ({ ok: true, facts: {} }),
    read: async () => null,
    write: async (request) => {
      writes.push(request)
      return { ok: true, replayed: false, id: request.id, name: request.name, versionId: null, facts: {} }
    },
  }
  return { writes, writerFor: () => ({ pluginId: 'commerce', writer }) }
}

/** A catalog runner that answers with these products, as the `products` step's catalog does. */
const catalogOf = (products: AiCatalogProposal['products']) =>
  jest.fn(async (): Promise<AiJobStepOutcome> => ({
    outputs: [
      {
        resource: 'product',
        id: AI_PRODUCTS_OUTPUT_IDS.catalog,
        hostId: 'host-test',
        hostSubdomain: 'berm-bolt-moto-parts',
        label: `Proposed products · ${products.length}`,
        proposal: { kind: 'catalog', products, notes: [] } as unknown as Record<string, unknown>,
      } as AiJobOutput,
    ],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0.01,
    model: 'test-model',
    stopReason: 'tool_use',
  }))

const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ exists: true, get: () => undefined }) }) }),
} as unknown as FirebaseFirestore.Firestore

const context = (job: AiJob): AiJobStepContext => ({ job, stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' } as never })

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a catalog answered with kinds for names (AGL-4065)', () => {
  it('is re-asked once, naming each product a shopper would not buy', async () => {
    const { fake, requests } = provider([answer(BERM_BOLT_CATALOG_ANSWER), answer(BERM_BOLT_SAMPLE_ANSWER)])
    const result = await generateAiCatalog({ store: 'Berm & Bolt Moto Parts', brief: BERM_BOLT_BRIEF, model: 'test-model', maxTokens: 4_000, provider: fake })
    expect(requests).toHaveLength(2)
    const reask = turns(requests[1] as AiProviderRequest)
    expect(reask).toContain('Name real products a shopper would buy, never a category with “Item” or “Order” after it')
    for (const name of ['OEM Dirt Bike Parts Order', 'OEM ATV Parts Order', 'Aftermarket Dirt Bike Part', 'Riding Gear Item']) {
      expect(reask).toContain(name)
    }
    expect(result.status === 'ok' && result.value.map((product) => product.name)).toEqual(['Dirt bike brake pads', 'Knobby dirt bike tire', 'Motocross helmet'])
  })

  it('keeps a plain item of a kind, and never names a brand or a model the brief does not', () => {
    const problem = (Products as unknown as Record<string, unknown>)['aiCatalogNameProblem'] as (name: string, brief: string) => string | null
    expect(typeof problem).toBe('function')
    expect(['Dirt Bike Tire', 'ATV Tire', 'Knobby dirt bike tire', 'Motocross helmet', 'Hand-poured soy candle'].map((name) => problem(name, BERM_BOLT_BRIEF))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
    expect(problem('Riding Gear Item', BERM_BOLT_BRIEF)).not.toBeNull()
    expect(problem('OEM ATV Parts Order', BERM_BOLT_BRIEF)).not.toBeNull()
    expect(problem('Aftermarket Dirt Bike Part', BERM_BOLT_BRIEF)).not.toBeNull()
    expect(problem('Honda CRF450R air filter', BERM_BOLT_BRIEF)).not.toBeNull()
    expect(problem('Honda CRF450R air filter', `${BERM_BOLT_BRIEF} We stock Honda CRF450R parts.`)).toBeNull()
  })
})

describe('whether a store’s brief names its products (AGL-4065)', () => {
  it('reads Berm & Bolt’s as kinds of part, and Willow Wick’s as candles it sells', () => {
    const names = added['aiSiteBriefNamesProducts'] as (inputs: Record<string, unknown>) => boolean
    const kinds = added['aiSiteSampleProductKinds'] as (inputs: Record<string, unknown>) => string[] | null
    expect(typeof names).toBe('function')
    expect(names(BERM_BOLT_INPUTS)).toBe(false)
    expect(names(WILLOW_WICK_INPUTS)).toBe(true)
    // The kinds a sample is made of: what the shop sells, never its services.
    expect(kinds(BERM_BOLT_INPUTS)).toEqual(['OEM and aftermarket parts', 'tires', 'riding gear'])
    expect(kinds(WILLOW_WICK_INPUTS)).toBeNull()
  })
})

describe('the site start’s products unit (AGL-4065, sample products)', () => {
  it('asks a kinds-only store for a sample of each kind, named as a plain item of it', () => {
    const job = productsUnitJob(siteJob())
    expect(job.brief).toContain("Propose between 3 and 6 products: the store's first ones.")
    expect(job.brief).toContain(
      'The brief names kinds of product and no product, so each is a sample of one of these kinds, which the owner replaces with their own: OEM and aftermarket parts; tires; riding gear.',
    )
    // A store whose brief names its products is asked as it always was.
    const willow = productsUnitJob(siteJob(WILLOW_WICK_INPUTS, 'A 5-page website for a small-batch candle shop selling hand-poured soy candles online.'))
    expect(willow.brief).toContain("Propose between 3 and 6 products: the store's first ones.")
    expect(willow.brief).not.toContain('sample')
  })

  it('writes each of a kinds-only store’s products as a sample, at its suggested price, and says so', async () => {
    const { writes, writerFor } = fakeWriter()
    const run = createAiSiteProductsRunner({
      catalog: catalogOf(BERM_BOLT_SAMPLE_ANSWER.products as unknown as AiCatalogProposal['products']),
      writerFor,
      photos: async ({ names }) => names.map(() => null),
    })
    const outcome = await run(context(productsUnitJob(siteJob())))
    expect(writes.map((write) => write.name)).toEqual(['Dirt bike brake pads', 'Knobby dirt bike tire', 'Motocross helmet'])
    for (const write of writes) expect(write.content).toMatchObject({ sample: true, comingSoon: true })
    expect(writes.map((write) => (write.content as { priceUsd?: number }).priceUsd)).toEqual([35, 95, 180])
    expect(outcome.outputs.map((output) => output.note)).toEqual(
      writes.map(() => 'A sample made from the kinds of product you named, at a suggested price. Replace it with your own product in Products.'),
    )
  })

  it('writes a store’s named products as before: no sample mark', async () => {
    const { writes, writerFor } = fakeWriter()
    const run = createAiSiteProductsRunner({
      catalog: catalogOf(BERM_BOLT_SAMPLE_ANSWER.products as unknown as AiCatalogProposal['products']),
      writerFor,
      photos: async ({ names }) => names.map(() => null),
    })
    const outcome = await run(context(productsUnitJob(siteJob(WILLOW_WICK_INPUTS, 'A 5-page website for a small-batch candle shop selling hand-poured soy candles online.'))))
    for (const write of writes) expect(write.content).not.toHaveProperty('sample')
    expect(outcome.outputs.every((output) => output.note === AI_SITE_PRODUCT_NOTE)).toBe(true)
  })
})
