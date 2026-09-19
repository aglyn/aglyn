/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * The `products` step (AGL-2916), against a fixture store in a Firestore double
 * that logs every read and every write, with the provider faked at the
 * runtime's `runAiRequest` seam and the photo read at its own seams.
 *
 * What it proves: what each target sends — the photo as a picture part, only to
 * a model that reads pictures, and only when it is the store's own asset —
 * what comes back as a proposal, that a bulk job works through its products a
 * pass at a time and passes over one it cannot write, that every answer is held
 * to the storefront claim rules, that each pass registers the time its target
 * needs, and that the step WRITES NOTHING.
 */

type Doc = Record<string, unknown>

let mockDocs = new Map<string, Doc>()
const mockReads: string[] = []
const mockWrites: string[] = []
const mockRunAiRequest = jest.fn()
const mockOwners = new Map<string, string>()
const mockReleased = jest.fn(async (ids: readonly string[]) => [...ids])

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: (ids: readonly string[]) => mockReleased(ids),
}))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
  registerAiJobStepPasses: jest.fn(),
}))

import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import {
  AI_CATALOG_DESCRIPTION_MAX_CHARS,
  AI_CATALOG_PHOTO_MAX_CHARS,
  AI_CATALOG_TAGS_MAX,
  AI_PRODUCT_DESCRIPTION_MAX_CHARS,
  AI_PRODUCT_TAGS_MAX,
  AI_PRODUCTS_BULK_MAX,
  aiProductsJobInputs,
  aiProductsProposalOf,
  type AiCatalogProposal,
  type AiCategoriesProposal,
  type AiProductCopyProposal,
  type AiProductFacts,
} from '../model/ai-products'
import { AI_STEP_TIERS } from '../providers/catalog'
import { aiDoctrineSystemBlock } from '../runtime/ai-doctrine'
import {
  AI_CATALOG_INSTRUCTIONS,
  AI_CATALOG_MAX_TOKENS,
  AI_CATEGORIES_INSTRUCTIONS,
  AI_PRODUCT_CATEGORIES_MAX_TOKENS,
  AI_PRODUCT_COPY_INSTRUCTIONS,
  AI_PRODUCT_COPY_MAX_TOKENS,
} from '../runtime/ai-products-generation'
import {
  AI_CATALOG_TOOL_NAME,
  AI_CATEGORIES_TOOL_NAME,
  AI_PRODUCT_COPY_TOOL_NAME,
} from '../tools/ai-products-tool'
import { AI_JOB_STEP_MAX_MINIMUM_MS, aiGenerationWorstCaseOnTierMs } from './ai-job-budget'
import {
  AI_JOB_CATALOG_BUDGET,
  AI_JOB_CATEGORIES_BUDGET,
  AI_JOB_PRODUCT_COPY_BUDGET,
  AI_PRODUCTS_COMMERCE_OFF_COPY,
  AI_PRODUCTS_GONE_COPY,
  AI_PRODUCTS_NOT_ENTITLED_COPY,
  AI_PRODUCTS_SITE_READ_MS,
  AI_PRODUCTS_UNKNOWN_SITE_COPY,
  aiProductsJobAdmission,
  aiProductsRunMinimumMs,
  createAiJobProductsStep,
  registerAiProductsJob,
} from './ai-job-products-step'
import { AI_PRODUCT_IMAGE_READ_MS } from './ai-product-image'
import { registerAiJobStep, registerAiJobStepPasses } from './ai-jobs'

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ?? {})[field],
  }
}

function mockRef(path: string): any {
  const write = async () => {
    mockWrites.push(path)
  }
  return {
    id: path.split('/').pop(),
    path,
    collection: (name: string) => mockCollection(`${path}/${name}`),
    get: async () => {
      mockReads.push(path)
      return mockSnapshot(path)
    },
    set: write,
    update: write,
    create: write,
    delete: write,
  }
}

function mockQuery(prefix: string, max = Infinity): any {
  return {
    select: () => mockQuery(prefix, max),
    where: () => mockQuery(prefix, max),
    orderBy: () => mockQuery(prefix, max),
    limit: (count: number) => mockQuery(prefix, count),
    get: async () => {
      mockReads.push(prefix)
      const docs = [...mockDocs.keys()]
        .filter((path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
        .slice(0, max)
        .map(mockSnapshot)
      return { docs, empty: docs.length === 0 }
    },
  }
}

function mockCollection(prefix: string): any {
  return {
    ...mockQuery(prefix),
    doc: (id: string) => mockRef(`${prefix}/${id}`),
    add: async () => {
      mockWrites.push(prefix)
    },
  }
}

const firestore = {
  collection: (name: string) => mockCollection(name),
  runTransaction: async () => {
    throw new Error('the products step takes no transaction')
  },
  batch: () => {
    throw new Error('the products step writes no batch')
  },
} as unknown as FirebaseFirestore.Firestore

const ORG = 'org-1'
const HOST = 'host-1'
const NOW = new Date('2026-09-16T12:00:00.000Z')
const USAGE = { inputTokens: 1_400, outputTokens: 420, cacheReadTokens: 2_300, cacheWriteTokens: 0 }
/** Four bytes of a JPEG's start, as the encoder hands them back. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

function seed() {
  mockDocs = new Map<string, Doc>([
    [`hosts/${HOST}`, { orgId: ORG, displayName: 'Acme Lamps', subdomain: 'acme' }],
    [`hosts/${HOST}/productCategories/cat-lighting`, { name: 'Lighting' }],
    [`hosts/${HOST}/productCategories/cat-office`, { name: 'Home office' }],
    [
      `hosts/${HOST}/products/lamp`,
      {
        name: 'Brass desk lamp',
        type: 'physical',
        status: 'active',
        description: 'Adjustable brass desk lamp with a dimmable LED bulb.',
        tags: ['lighting'],
        options: [{ name: 'finish', values: ['Brass', 'Black'] }],
        mediaUrls: [`media:${HOST}/lamp-photo`],
        variants: [{ id: 'v1', priceUsd: 40, inventory: 3 }],
        seo: { title: 'Desk lamp' },
      },
    ],
    [
      `hosts/${HOST}/products/shade`,
      {
        name: 'Linen lamp shade',
        type: 'physical',
        status: 'draft',
        description: 'A drum shade in natural linen.',
        variants: [{ id: 'v1', priceUsd: 18 }],
      },
    ],
  ])
  mockOwners.clear()
  mockOwners.set(HOST, ORG)
}

const LAMP: AiProductFacts = {
  id: 'lamp',
  name: 'Brass desk lamp',
  type: 'physical',
  text: 'Adjustable brass desk lamp with a dimmable LED bulb.',
  tags: ['lighting'],
  categoryIds: [],
  options: [{ name: 'finish', values: ['Brass', 'Black'] }],
  imageUrl: `media:${HOST}/lamp-photo`,
  seoTitle: 'Desk lamp',
  seoDescription: '',
}

function job(inputs: Record<string, string>, patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: ORG,
    hostId: HOST,
    kind: 'products',
    status: 'running',
    brief: 'Write the copy for our products.',
    inputs,
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    ...patch,
  } as unknown as AiJob
}

const COPY = {
  description: 'An adjustable brass desk lamp with a dimmable LED bulb.\n\nChoose brass or black. Brightness: [lumens].',
  seoTitle: 'Adjustable brass desk lamp',
  seoDescription: 'A brass desk lamp with a dimmable LED bulb, in brass or black.',
  tags: ['desk lamp', 'brass'],
  categoryIds: ['cat-lighting'],
  optionNames: ['Finish'],
}

function answering(name: string, input: Doc) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name, input }],
    usage: USAGE,
    estCostUsd: 0.012,
    stopReason: 'tool_use',
  }
}

const readBytes = jest.fn(async () => ({ buffer: Buffer.from('original'), contentType: 'image/png' }))
const encode = jest.fn(async () => JPEG)
const step = createAiJobProductsStep({ image: { readBytes, encode } })
const run = (subject: AiJob, runner = step) =>
  runner({ job: subject, stepIndex: 0, now: NOW, firestore, modelFor: () => 'claude-sonnet-5' })

beforeEach(() => {
  seed()
  mockReads.length = 0
  mockWrites.length = 0
  mockRunAiRequest.mockReset()
  readBytes.mockClear()
  encode.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  expect(mockWrites).toEqual([])
  jest.restoreAllMocks()
})

describe('one product’s copy', () => {
  it('shows the model the product, the site’s categories and its photo, and proposes the copy', async () => {
    mockRunAiRequest.mockResolvedValue(answering(AI_PRODUCT_COPY_TOOL_NAME, COPY))
    const outcome = await run(job(aiProductsJobInputs({ target: 'product', product: LAMP })))

    const request = mockRunAiRequest.mock.calls[0][0]
    expect(request.model).toBe('claude-sonnet-5')
    // The doctrine's cached block, then the copy rules, cached after it.
    expect(request.system[0]).toBe(aiDoctrineSystemBlock('documents'))
    expect(request.system[1]).toEqual(AI_PRODUCT_COPY_INSTRUCTIONS[0])
    expect(request.tools.map((tool: { name: string }) => tool.name)).toEqual([AI_PRODUCT_COPY_TOOL_NAME])
    expect(request.maxTokens).toBe(AI_JOB_PRODUCT_COPY_BUDGET.maxTokens('claude-sonnet-5'))
    expect(request.thinking).toBe('off')
    // The photo rides first, as a JPEG part, and the product's facts after it.
    const [photo, text] = request.messages[0].content
    expect(photo).toEqual({ type: 'image', mediaType: 'image/jpeg', data: JPEG.toString('base64') })
    expect(text.type).toBe('text')
    expect(text.text).toContain('Store: Acme Lamps')
    expect(text.text).toContain('Product: Brass desk lamp')
    expect(text.text).toContain('- finish: Brass, Black')
    expect(text.text).toContain('- cat-office: Home office')
    expect(text.text).toContain('Photo: attached')
    // No price, stock or other product reaches the prompt.
    expect(JSON.stringify(request.messages)).not.toMatch(/priceUsd|inventory|Linen lamp shade|"40"/)
    expect(readBytes).toHaveBeenCalledWith(firestore, expect.objectContaining({ mediaId: 'lamp-photo' }), HOST)

    expect(outcome).toMatchObject({ usage: USAGE, estCostUsd: 0.012, model: 'claude-sonnet-5' })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.continue).toBeUndefined()
    const [output] = outcome.outputs as AiJobOutput[]
    expect(output).toMatchObject({
      resource: 'product',
      id: 'copy:lamp',
      hostId: HOST,
      hostSubdomain: 'acme',
      label: 'Product copy · Brass desk lamp',
    })
    expect(aiProductsProposalOf(output)).toEqual({
      kind: 'copy',
      product: { id: 'lamp', name: 'Brass desk lamp' },
      values: COPY,
      categories: [{ id: 'cat-lighting', name: 'Lighting' }],
      optionNamesBefore: ['finish'],
      gaps: ['lumens'],
      photo: 'read',
      skipped: null,
      notes: [],
    } satisfies AiProductCopyProposal)
  })

  it('sends no photo to a model that does not read pictures, and says so', async () => {
    mockRunAiRequest.mockResolvedValue(answering(AI_PRODUCT_COPY_TOOL_NAME, COPY))
    const blind = createAiJobProductsStep({ image: { readBytes, encode }, readsImages: () => false })
    const outcome = await run(job(aiProductsJobInputs({ target: 'product', product: LAMP })), blind)
    const request = mockRunAiRequest.mock.calls[0][0]
    expect(typeof request.messages[0].content).toBe('string')
    expect(request.messages[0].content).toContain('Photo: none')
    expect(readBytes).not.toHaveBeenCalled()
    const proposal = aiProductsProposalOf((outcome.outputs as AiJobOutput[])[0]) as AiProductCopyProposal
    expect(proposal.photo).toBe('model')
    expect(proposal.notes).toEqual([expect.stringContaining('does not read pictures')])
  })

  it('reads nothing for a photo that is a link, or another site’s asset', async () => {
    mockRunAiRequest.mockResolvedValue(answering(AI_PRODUCT_COPY_TOOL_NAME, COPY))
    for (const imageUrl of ['https://cdn.example/lamp.jpg', 'media:host-2/lamp-photo']) {
      const outcome = await run(job(aiProductsJobInputs({ target: 'product', product: { ...LAMP, imageUrl } })))
      const proposal = aiProductsProposalOf((outcome.outputs as AiJobOutput[])[0]) as AiProductCopyProposal
      expect([imageUrl, proposal.photo]).toEqual([imageUrl, 'not-in-library'])
    }
    expect(readBytes).not.toHaveBeenCalled()
    expect(encode).not.toHaveBeenCalled()
  })

  it('writes the copy from the product’s words when its photo cannot be read', async () => {
    mockRunAiRequest.mockResolvedValue(answering(AI_PRODUCT_COPY_TOOL_NAME, COPY))
    readBytes.mockResolvedValueOnce(null as never)
    const outcome = await run(job(aiProductsJobInputs({ target: 'product', product: LAMP })))
    expect(mockRunAiRequest.mock.calls[0][0].messages[0].content).toContain('Photo: none')
    const proposal = aiProductsProposalOf((outcome.outputs as AiJobOutput[])[0]) as AiProductCopyProposal
    expect(proposal.photo).toBe('unreadable')
  })

  it('re-asks once for a claim, and fails with the rule’s sentence when the second answer makes one too', async () => {
    const claiming = { ...COPY, description: 'A brass desk lamp that prevents headaches.' }
    mockRunAiRequest.mockResolvedValue(answering(AI_PRODUCT_COPY_TOOL_NAME, claiming))
    const outcome = await run(job(aiProductsJobInputs({ target: 'product', product: LAMP })))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const reask = mockRunAiRequest.mock.calls[1][0].messages[2].content as string
    expect(reask).toContain('health claim')
    expect(reask).toContain('"prevents headaches"')
    expect(outcome.outputs).toEqual([])
    expect(outcome.failure).toMatch(/health claim/)
    // Both answers spent tokens, and the machine meters them.
    expect(outcome.usage).toEqual({
      inputTokens: USAGE.inputTokens * 2,
      outputTokens: USAGE.outputTokens * 2,
      cacheReadTokens: USAGE.cacheReadTokens * 2,
      cacheWriteTokens: 0,
    })
  })

  it('refuses a site of another org before anything is read or asked', async () => {
    mockDocs.set(`hosts/${HOST}`, { orgId: 'org-2', displayName: 'Elsewhere' })
    const outcome = await run(job(aiProductsJobInputs({ target: 'product', product: LAMP })))
    expect(outcome).toMatchObject({ outputs: [], failure: AI_PRODUCTS_UNKNOWN_SITE_COPY, estCostUsd: 0 })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(mockReads).toEqual([`hosts/${HOST}`])
  })
})

describe('a bulk job, a product at a time', () => {
  const bulk = (outputs: AiJobOutput[] = []) =>
    job(aiProductsJobInputs({ target: 'bulk', productIds: ['lamp', 'gone', 'shade'] }), { outputs })

  it('writes the first product’s copy from its document, and asks to continue', async () => {
    mockRunAiRequest.mockResolvedValue(answering(AI_PRODUCT_COPY_TOOL_NAME, COPY))
    const outcome = await run(bulk())
    expect(mockReads).toContain(`hosts/${HOST}/products/lamp`)
    const text = mockRunAiRequest.mock.calls[0][0].messages[0].content[1].text as string
    expect(text).toContain('Product: Brass desk lamp')
    expect(text).toContain('Current search title: Desk lamp')
    expect(outcome.continue).toBe(true)
    expect((outcome.outputs as AiJobOutput[]).map((output) => output.id)).toEqual(['copy:lamp'])
  })

  it('passes over a product that is gone, spending nothing, and goes on to the next', async () => {
    const first = { resource: 'product', id: 'copy:lamp', hostId: HOST, label: 'x', proposal: { kind: 'copy' } } as AiJobOutput
    const outcome = await run(bulk([first]))
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ estCostUsd: 0, continue: true })
    const proposal = aiProductsProposalOf((outcome.outputs as AiJobOutput[])[0]) as AiProductCopyProposal
    expect(proposal).toMatchObject({ product: { id: 'gone' }, values: null, skipped: AI_PRODUCTS_GONE_COPY })
  })

  it('reports a product whose copy the rules could not hold, meters it, and stops after the last', async () => {
    const claiming = { ...COPY, optionNames: [], tags: ['award-winning'] }
    mockRunAiRequest.mockResolvedValue(answering(AI_PRODUCT_COPY_TOOL_NAME, claiming))
    const done = ['copy:lamp', 'copy:gone'].map(
      (id) => ({ resource: 'product', id, hostId: HOST, label: id, proposal: { kind: 'copy' } }) as AiJobOutput,
    )
    const outcome = await run(bulk(done))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome.failure).toBeUndefined()
    expect(outcome.refused).toBeUndefined()
    expect(outcome.continue).toBe(false)
    expect(outcome.estCostUsd).toBeGreaterThan(0)
    const proposal = aiProductsProposalOf((outcome.outputs as AiJobOutput[])[0]) as AiProductCopyProposal
    expect(proposal.values).toBeNull()
    expect(proposal.skipped).toMatch(/certification, award or endorsement/)
  })

  it('does nothing once every product has its copy', async () => {
    const done = ['copy:lamp', 'copy:gone', 'copy:shade'].map(
      (id) => ({ resource: 'product', id, hostId: HOST, label: id, proposal: { kind: 'copy' } }) as AiJobOutput,
    )
    const outcome = await run(bulk(done))
    expect(outcome).toMatchObject({ outputs: [], estCostUsd: 0 })
    expect(outcome.continue).toBeUndefined()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})

describe('a store’s first products, and its categories and discounts, from a brief', () => {
  const PRODUCT: AiCatalogProposal['products'][number] = {
    name: 'Wild mint soy candle',
    type: 'physical',
    description: 'A hand-poured soy candle scented with wild mint.\n\nBurn time: [hours].',
    tags: ['soy candle'],
    options: [{ name: 'Size', values: ['8 oz jar', '16 oz jar'] }],
    seoTitle: 'Wild mint soy candle',
    seoDescription: 'A hand-poured soy candle scented with wild mint.',
    photo: 'The candle lit on a wooden table.',
  }

  it('proposes products with no price and no picture', async () => {
    mockRunAiRequest.mockResolvedValue(answering(AI_CATALOG_TOOL_NAME, { products: [PRODUCT] }))
    const outcome = await run(
      job(aiProductsJobInputs({ target: 'catalog' }), { brief: 'A candle studio: wild mint soy candles in 8 oz and 16 oz jars.' }),
    )
    const request = mockRunAiRequest.mock.calls[0][0]
    expect(request.system[1]).toEqual(AI_CATALOG_INSTRUCTIONS[0])
    expect(request.maxTokens).toBe(AI_JOB_CATALOG_BUDGET.maxTokens('claude-sonnet-5'))
    expect(request.messages[0].content).toContain('Brief:\nA candle studio')
    expect(outcome.outputs).toEqual([
      expect.objectContaining({ id: 'catalog', label: 'Proposed products · 1', hostSubdomain: 'acme' }),
    ])
    expect(aiProductsProposalOf((outcome.outputs as AiJobOutput[])[0])).toEqual({
      kind: 'catalog',
      products: [PRODUCT],
      notes: [],
    } satisfies AiCatalogProposal)
  })

  it('holds a catalog to a price nobody gave, and types a decline as a refusal', async () => {
    mockRunAiRequest.mockResolvedValue(
      answering(AI_CATALOG_TOOL_NAME, { products: [{ ...PRODUCT, description: 'Only $28 a jar.' }] }),
    )
    const priced = await run(job(aiProductsJobInputs({ target: 'catalog' })))
    expect(priced.failure).toMatch(/price/)
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValue({ kind: 'refusal', text: '', usage: USAGE, estCostUsd: 0.01, stopReason: 'refusal' })
    const declined = await run(job(aiProductsJobInputs({ target: 'catalog' })))
    expect(declined).toMatchObject({ refused: true, outputs: [] })
  })

  it('tells the model the categories the store has, and proposes the rest with discounts', async () => {
    const answer = {
      categories: [{ name: 'Lamp shades', why: 'Shades are bought apart from lamps.' }],
      discounts: [
        { name: 'Welcome code', code: 'welcome10', kind: 'percent', value: 10, minimumOrderUsd: 0, why: 'A reason to place a first order.' },
        { name: 'Free shipping', code: '', kind: 'free_shipping', value: 0, minimumOrderUsd: 75, why: 'Rewards larger orders.' },
      ],
    }
    mockRunAiRequest.mockResolvedValue(answering(AI_CATEGORIES_TOOL_NAME, answer))
    const outcome = await run(job(aiProductsJobInputs({ target: 'categories' }), { brief: 'Lamps and shades; a welcome code and free shipping over $75.' }))
    const request = mockRunAiRequest.mock.calls[0][0]
    expect(request.system[1]).toEqual(AI_CATEGORIES_INSTRUCTIONS[0])
    expect(request.maxTokens).toBe(AI_JOB_CATEGORIES_BUDGET.maxTokens('claude-sonnet-5'))
    expect(request.messages[0].content).toContain('Categories the store already has: Home office, Lighting')
    expect(aiProductsProposalOf((outcome.outputs as AiJobOutput[])[0])).toEqual({
      kind: 'categories',
      categories: answer.categories,
      discounts: [
        { name: 'Welcome code', code: 'WELCOME10', kind: 'percent', valuePct: 10, valueCents: null, minSubtotalCents: null, why: 'A reason to place a first order.' },
        { name: 'Free shipping', code: null, kind: 'free_shipping', valuePct: null, valueCents: null, minSubtotalCents: 7_500, why: 'Rewards larger orders.' },
      ],
      notes: [],
    } satisfies AiCategoriesProposal)
  })
})

describe('the time each pass needs (AGL-3035)', () => {
  const TIER = AI_STEP_TIERS['job.products']
  const shape = (ceiling: number, ownReadsMs: number) =>
    aiGenerationWorstCaseOnTierMs({ tier: TIER, maxTokens: ceiling, attempts: 2, lookups: 0, ownReadsMs })

  it('plans each target at its own ceiling, and registers the least of them', () => {
    const BALANCED = 'claude-sonnet-5'
    expect(AI_JOB_PRODUCT_COPY_BUDGET.minimumMs).toBe(shape(AI_PRODUCT_COPY_MAX_TOKENS, AI_PRODUCT_IMAGE_READ_MS))
    expect(AI_JOB_CATEGORIES_BUDGET.minimumMs).toBe(shape(AI_PRODUCT_CATEGORIES_MAX_TOKENS, AI_PRODUCTS_SITE_READ_MS))
    // A catalog asks the most of the routing ceiling a beat can start.
    const catalog = AI_JOB_CATALOG_BUDGET.maxTokens(BALANCED)
    expect(catalog).toBeLessThanOrEqual(AI_CATALOG_MAX_TOKENS)
    expect(AI_JOB_CATALOG_BUDGET.minimumMs).toBe(shape(catalog, AI_PRODUCTS_SITE_READ_MS))
    expect(AI_JOB_CATALOG_BUDGET.minimumMs).toBeLessThanOrEqual(AI_JOB_STEP_MAX_MINIMUM_MS)
    expect(shape(catalog + 1, AI_PRODUCTS_SITE_READ_MS)).toBeGreaterThan(AI_JOB_STEP_MAX_MINIMUM_MS)

    expect(aiProductsRunMinimumMs({ inputs: { target: 'catalog' } })).toBe(AI_JOB_CATALOG_BUDGET.minimumMs)
    expect(aiProductsRunMinimumMs({ inputs: { target: 'categories' } })).toBe(AI_JOB_CATEGORIES_BUDGET.minimumMs)
    expect(aiProductsRunMinimumMs({ inputs: { target: 'bulk', productIds: 'a,b' } })).toBe(AI_JOB_PRODUCT_COPY_BUDGET.minimumMs)

    registerAiProductsJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('products', expect.any(Function), {
      minimumMs: AI_JOB_PRODUCT_COPY_BUDGET.minimumMs,
      minimumMsFor: aiProductsRunMinimumMs,
    })
    expect(registerAiJobStepPasses).toHaveBeenCalledWith('products', AI_PRODUCTS_BULK_MAX)
  })

  it('fits the largest answer each tool accepts inside the ceiling it is asked on its served tier, at three characters a token', () => {
    const text = (length: number) => 'x'.repeat(length)
    const served = (budget: typeof AI_JOB_PRODUCT_COPY_BUDGET) => budget.maxTokens('claude-sonnet-5')
    const tokens = (answer: unknown) => Math.ceil(JSON.stringify(answer).length / 3)
    const copy = {
      description: text(AI_PRODUCT_DESCRIPTION_MAX_CHARS),
      seoTitle: text(60),
      seoDescription: text(155),
      tags: Array.from({ length: AI_PRODUCT_TAGS_MAX }, () => text(30)),
      categoryIds: Array.from({ length: 3 }, () => text(64)),
      optionNames: Array.from({ length: 3 }, () => text(30)),
    }
    const product = {
      name: text(120),
      type: 'physical',
      description: text(AI_CATALOG_DESCRIPTION_MAX_CHARS),
      tags: Array.from({ length: AI_CATALOG_TAGS_MAX }, () => text(30)),
      options: Array.from({ length: 2 }, () => ({ name: text(30), values: Array.from({ length: 6 }, () => text(30)) })),
      seoTitle: text(60),
      seoDescription: text(155),
      photo: text(AI_CATALOG_PHOTO_MAX_CHARS),
    }
    const categories = {
      categories: Array.from({ length: 12 }, () => ({ name: text(60), why: text(200) })),
      discounts: Array.from({ length: 5 }, () => ({
        name: text(60),
        code: text(20),
        kind: 'free_shipping',
        value: 1_000,
        minimumOrderUsd: 10_000,
        why: text(200),
      })),
    }
    expect(served(AI_JOB_PRODUCT_COPY_BUDGET)).toBe(AI_PRODUCT_COPY_MAX_TOKENS)
    expect(tokens(copy)).toBeLessThanOrEqual(served(AI_JOB_PRODUCT_COPY_BUDGET))
    expect(tokens({ products: Array.from({ length: 12 }, () => product) })).toBeLessThanOrEqual(
      served(AI_JOB_CATALOG_BUDGET),
    )
    expect(served(AI_JOB_CATEGORIES_BUDGET)).toBe(AI_PRODUCT_CATEGORIES_MAX_TOKENS)
    expect(tokens(categories)).toBeLessThanOrEqual(served(AI_JOB_CATEGORIES_BUDGET))
  })
})

describe('who may start a products job', () => {
  const context = (patch: Partial<Parameters<typeof aiProductsJobAdmission>[0]> = {}) => ({
    firestore,
    orgId: ORG,
    hostId: HOST,
    inputs: aiProductsJobInputs({ target: 'catalog' }),
    org: { plan: 'pro', enabledPlugins: ['commerce'] },
    uid: 'uid-1',
    ...patch,
  })

  it('admits a store of the job’s own org whose plan sells and has Commerce on', async () => {
    await expect(aiProductsJobAdmission(context())).resolves.toBeNull()
  })

  it('refuses inputs it cannot run, a missing site, another org’s site, a plan that does not sell, and Commerce off', async () => {
    await expect(aiProductsJobAdmission(context({ inputs: { target: 'nothing' } }))).resolves.toMatchObject({ status: 400 })
    await expect(aiProductsJobAdmission(context({ hostId: null }))).resolves.toMatchObject({ status: 400 })
    mockOwners.set(HOST, 'org-2')
    await expect(aiProductsJobAdmission(context())).resolves.toEqual({ status: 404, error: AI_PRODUCTS_UNKNOWN_SITE_COPY })
    mockOwners.set(HOST, ORG)
    await expect(aiProductsJobAdmission(context({ org: { plan: 'free', enabledPlugins: ['commerce'] } }))).resolves.toEqual({
      status: 403,
      error: AI_PRODUCTS_NOT_ENTITLED_COPY,
    })
    mockDocs.set(`hosts/${HOST}`, { orgId: ORG, disabledPlugins: ['commerce'] })
    await expect(aiProductsJobAdmission(context())).resolves.toEqual({ status: 403, error: AI_PRODUCTS_COMMERCE_OFF_COPY })
    mockDocs.set(`hosts/${HOST}`, { orgId: ORG })
    mockReleased.mockResolvedValueOnce([])
    await expect(aiProductsJobAdmission(context())).resolves.toEqual({ status: 403, error: AI_PRODUCTS_COMMERCE_OFF_COPY })
  })
})
