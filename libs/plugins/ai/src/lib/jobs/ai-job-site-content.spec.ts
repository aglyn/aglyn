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
 * A guided start's first posts and first products (AGL-3676), with the
 * generation, the writers and the catalog as doubles:
 *
 *  - WHICH PART a site gets: posts for a paid blog, products for a paid
 *    store, nothing on the Free taste or for any other kind;
 *  - THE POSTS: a blog that avoids the pages' addresses, one post a pass
 *    under its own id, bylined and covered, continuing while posts remain,
 *    and a refusal or a failure as the item's;
 *  - THE PRODUCTS: the catalog asked for 3 to 6, each written unpriced and
 *    photo-less, the allowance stopping the rest and saying so;
 *  - WHAT THE PAGES ARE TOLD, and the posts published with the site.
 */

jest.mock('@aglyn/tenant-data-admin/server/content-entry-drafts', () => ({
  __esModule: true,
  writeContentCollection: jest.fn(),
  writeContentEntryDraft: jest.fn(),
  publishContentEntries: jest.fn(),
}))

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_SITE_BLOG_NAME,
  AI_SITE_CONTENT_INPUT,
  AI_SITE_PRODUCTS,
  aiPublishSitePosts,
  aiSiteContentBriefLines,
  aiSiteContentPart,
  aiSiteContentRefusal,
  aiSiteProductsBriefLine,
  createAiSitePostsRunner,
  createAiSiteProductsRunner,
} from './ai-job-site-content'
import type { AiJobStepContext, AiJobStepOutcome } from './ai-job-text-step'

const NOW = new Date('2026-10-07T21:00:00.000Z')

const host = (data: Record<string, unknown> | null) => ({
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: data !== null, get: (field: string) => data?.[field] }),
    }),
  }),
})
const firestore = host({ subdomain: 'clay', displayName: 'Clay Notes', memberRoles: { 'uid-1': 'admin', 'uid-2': 'viewer' } }) as unknown as FirebaseFirestore.Firestore

function unitJob(input: Record<string, unknown> = {}, rest: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-site-posts',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'text',
    status: 'running',
    brief: 'A blog about wheel-thrown pottery for beginners.',
    inputs: { siteKind: 'blog', [AI_SITE_CONTENT_INPUT]: { written: [], total: 3, avoidSlugs: ['blog'], byline: 'Clay Notes', ...input } },
    steps: [],
    outputs: [],
    createdBy: 'uid-1',
    ...rest,
  } as unknown as AiJob
}

const context = (job: AiJob, org: Record<string, unknown> | null = { plan: 'pro' }): AiJobStepContext =>
  ({ job, stepIndex: 0, now: NOW, firestore, org }) as unknown as AiJobStepContext

const SPEND = { attempts: 1, usage: { ...AI_JOB_ZERO_USAGE, outputTokens: 700 }, estCostUsd: 0.01, model: 'routed-model', stopReason: 'tool_use', effort: null }
const POST = {
  title: 'Centering clay without the struggle',
  excerpt: 'The first skill on the wheel, broken into steps.',
  body: '## Start wet\n\nA paragraph about water.',
  seoDescription: 'How to center clay on the wheel, step by step.',
}

describe('which part a site gets', () => {
  it('writes a paid blog posts and a paid store products, and nothing on the Free taste or for another kind', () => {
    expect(aiSiteContentPart({ siteKind: 'blog' }, false)).toBe('posts')
    expect(aiSiteContentPart({ siteKind: 'store' }, false)).toBe('products')
    expect(aiSiteContentPart({ businessType: 'a small online shop selling candles' }, false)).toBe('products')
    expect(aiSiteContentPart({ siteKind: 'blog' }, true)).toBeNull()
    expect(aiSiteContentPart({ siteKind: 'store' }, true)).toBeNull()
    expect(aiSiteContentPart({ siteKind: 'restaurant' }, false)).toBeNull()
    expect(aiSiteContentPart(null, false)).toBeNull()
  })
})

describe('the first posts, one a pass', () => {
  const generate = jest.fn()
  const writeCollection = jest.fn()
  const writeEntry = jest.fn()
  const run = createAiSitePostsRunner({ generate, writeCollection, writeEntry })

  beforeEach(() => {
    generate.mockReset().mockResolvedValue({ status: 'ok', value: POST, ...SPEND })
    writeCollection.mockReset().mockResolvedValue({ ok: true, replayed: false, id: 'job-site-posts', slug: 'posts', displayName: AI_SITE_BLOG_NAME })
    writeEntry.mockReset().mockImplementation(async (_db, request) => ({ ok: true, replayed: false, id: request.id, slug: 'centering-clay', title: POST.title }))
  })

  it('makes the blog away from the pages’ addresses, writes the first post bylined and covered, and asks for the next', async () => {
    const outcome = await run(context(unitJob()))
    expect(writeCollection).toHaveBeenCalledWith(firestore, expect.objectContaining({
      hostId: 'host-1',
      uid: 'uid-1',
      id: 'job-site-posts',
      displayName: 'Blog',
      slugs: ['posts', 'journal', 'articles', 'writing', 'stories'],
    }))
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ earlierTitles: [], index: 1, total: 3, model: 'routed-model' }))
    const [, request] = writeEntry.mock.calls[0]
    expect(request).toMatchObject({ id: 'job-site-posts-0', collectionId: 'job-site-posts', uid: 'uid-1' })
    expect(request.content).toMatchObject({ ...POST, authorName: 'Clay Notes' })
    expect(request.content.coverImage).toMatch(/^\/_static\/starter\//)
    expect(request.content).not.toHaveProperty('status')
    expect(outcome.continue).toBe(true)
    expect(outcome.outputs).toEqual([
      expect.objectContaining({
        resource: 'entry',
        id: 'job-site-posts-0',
        hostSubdomain: 'clay',
        label: POST.title,
        proposal: { collectionId: 'job-site-posts', collectionSlug: 'posts', slug: 'centering-clay' },
      }),
    ])
    expect(outcome.usage).toEqual(SPEND.usage)
  })

  it('tells a later post what was written, and stops asking after the last', async () => {
    const written = [{ id: 'job-site-posts-0', title: 'One' }, { id: 'job-site-posts-1', title: 'Two' }]
    const outcome = await run(context(unitJob({ written })))
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ earlierTitles: ['One', 'Two'], index: 3 }))
    expect(writeEntry.mock.calls[0][1].id).toBe('job-site-posts-2')
    expect(outcome.continue).toBeUndefined()
  })

  it('bylines a post with the site’s name where the person gave none', async () => {
    await run(context(unitJob({ byline: '' })))
    expect(writeEntry.mock.calls[0][1].content.authorName).toBe('Clay Notes')
  })

  it('spends nothing where the blog cannot be made, and stops for the person', async () => {
    writeCollection.mockResolvedValue({ ok: false, status: 403, error: 'Editing requires the editor role' })
    const outcome = await run(context(unitJob()))
    expect(generate).not.toHaveBeenCalled()
    expect(outcome.review).toMatchObject({ reason: 'limit', message: 'Editing requires the editor role' })
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
  })

  it('carries a refusal and an answer the rules could not hold as the item’s, with their spend', async () => {
    generate.mockResolvedValueOnce({ status: 'refused', ...SPEND })
    expect(await run(context(unitJob()))).toMatchObject({ refused: true, usage: SPEND.usage })
    generate.mockResolvedValueOnce({ status: 'needs_input', message: 'The post broke a rule.', ...SPEND })
    expect(await run(context(unitJob()))).toMatchObject({ failure: 'The post broke a rule.' })
    expect(writeEntry).not.toHaveBeenCalled()
  })
})

describe('the first products, from the catalog', () => {
  const proposed = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      name: `Mug ${index + 1}`,
      type: 'physical',
      description: 'A wheel-thrown mug.',
      tags: ['mug'],
      options: [],
      seoTitle: `Mug ${index + 1}`,
      seoDescription: 'A mug.',
      photo: 'A mug on a table.',
    }))
  const catalogOutput = (count: number): AiJobOutput => ({
    resource: 'product',
    id: 'catalog',
    hostId: 'host-1',
    hostSubdomain: 'clay',
    label: `Proposed products · ${count}`,
    proposal: { kind: 'catalog', products: proposed(count), notes: [] },
  })
  const spent = (outputs: AiJobOutput[]): AiJobStepOutcome => ({ outputs, usage: SPEND.usage, estCostUsd: 0.02, model: 'routed-model', stopReason: 'tool_use' })
  const writes: Array<Record<string, unknown>> = []
  let room = Infinity
  const writer: PluginResourceDraftWriter = {
    refusal: async () => null,
    check: () => ({ ok: true, facts: {} }),
    read: async () => null,
    write: async (request) => {
      if (writes.length >= room) return { ok: false, status: 403, error: `Your plan includes ${room} products — upgrade in Billing for more` }
      writes.push(request as unknown as Record<string, unknown>)
      return { ok: true, replayed: false, id: request.id, name: request.name, versionId: null, facts: {} }
    },
  }
  const writerFor = () => ({ pluginId: 'commerce', writer })

  beforeEach(() => {
    writes.length = 0
    room = Infinity
  })

  it('asks the catalog for the store’s first products and writes at most six, unpriced and without a photo', async () => {
    const catalog = jest.fn(async (_context: AiJobStepContext) => spent([catalogOutput(8)]))
    const run = createAiSiteProductsRunner({ catalog, writerFor })
    const job = unitJob({}, { $id: 'job-site-products', kind: 'products', inputs: { siteKind: 'store', target: 'catalog' } })
    const outcome = await run(context(job))
    expect(catalog.mock.calls[0][0].job).toMatchObject({ kind: 'products', inputs: { target: 'catalog' } })
    expect(writes).toHaveLength(AI_SITE_PRODUCTS.max)
    expect(writes[0]).toMatchObject({ id: 'job-site-products-0', uid: 'uid-1', name: 'Mug 1' })
    for (const write of writes) {
      expect(write['content']).not.toHaveProperty('priceUsd')
      expect(write['content']).not.toHaveProperty('photo')
    }
    expect(outcome.outputs.map((output) => [output.resource, output.id, output.hostSubdomain])).toEqual(
      writes.map((write) => ['product', write['id'], 'clay']),
    )
    expect(outcome.outputs.every((output) => !output.proposal)).toBe(true)
    expect(outcome.usage).toEqual(SPEND.usage)
  })

  it('stops at the plan’s allowance and says so where the last one added is; none at all is the allowance’s review', async () => {
    room = 2
    const run = createAiSiteProductsRunner({ catalog: async () => spent([catalogOutput(4)]), writerFor })
    const outcome = await run(context(unitJob()))
    expect(outcome.outputs).toHaveLength(2)
    expect(outcome.outputs[1].note).toContain('2 of 4 added: Your plan includes 2 products')
    room = 0
    writes.length = 0
    const none = await run(context(unitJob()))
    expect(none.outputs).toEqual([])
    expect(none.review).toMatchObject({ reason: 'limit', message: expect.stringContaining('Your plan includes 0 products') })
  })

  it('passes the catalog’s own refusal or failure through, writing nothing', async () => {
    const run = createAiSiteProductsRunner({ catalog: async () => ({ ...spent([]), refused: true }), writerFor })
    expect(await run(context(unitJob()))).toMatchObject({ refused: true })
    expect(writes).toEqual([])
  })

  it('tells the catalog how many, in words its rules read as a count', () => {
    expect(aiSiteProductsBriefLine()).toBe("Propose between 3 and 6 products: the store's first ones.")
  })
})

describe('whether a part may be built here, before it spends', () => {
  const job = { orgId: 'org-1', hostId: 'host-1', createdBy: 'uid-1', inputs: {} }

  it('lets a member who may write the site have posts, and refuses one who may not', async () => {
    expect(await aiSiteContentRefusal('posts', { firestore, org: null, now: NOW, job })).toBeNull()
    expect(await aiSiteContentRefusal('posts', { firestore, org: null, now: NOW, job: { ...job, createdBy: 'uid-2' } })).toBe(
      'Editing requires the editor role',
    )
  })

  it('asks a products job’s own admission, then the writer’s room', async () => {
    const refusal = jest.fn(async () => null as null | { status: 403; error: string })
    const writerFor = () => ({ pluginId: 'commerce', writer: { refusal } as unknown as PluginResourceDraftWriter })
    const admissionFor = () => async () => ({ status: 403 as const, error: 'Your plan does not include selling products. See Billing.' })
    expect(await aiSiteContentRefusal('products', { firestore, org: { plan: 'starter' }, now: NOW, job }, { writerFor, admissionFor })).toBe(
      'Your plan does not include selling products. See Billing.',
    )
    expect(refusal).not.toHaveBeenCalled()
    refusal.mockResolvedValueOnce({ status: 403, error: 'Your plan includes 0 products — upgrade in Billing for more' })
    expect(await aiSiteContentRefusal('products', { firestore, org: { plan: 'pro' }, now: NOW, job }, { writerFor, admissionFor: () => async () => null })).toBe(
      'Your plan includes 0 products — upgrade in Billing for more',
    )
    expect(await aiSiteContentRefusal('products', { firestore, org: { plan: 'pro' }, now: NOW, job }, { writerFor: () => null, admissionFor: () => async () => null })).toBe(
      'Products are not available on this site.',
    )
  })
})

describe('what the pages are told, and the posts going live', () => {
  const post = (id: string, label: string, slug: string): AiJobOutput => ({
    resource: 'entry',
    id,
    hostId: 'host-1',
    label,
    proposal: { collectionId: 'c1', collectionSlug: 'blog', slug },
  })

  it('names the blog’s posts and the store’s products to a page, and nothing when there are none', () => {
    expect(aiSiteContentBriefLines([post('a', 'One', 'one'), post('b', 'Two', 'two')])).toEqual([
      'This site\'s blog at /blog has these posts: “One”, “Two”.',
      'Where a page features writing, feature these posts by their titles; never name a post that is not in this list.',
    ])
    const product: AiJobOutput = { resource: 'product', id: 'p', hostId: 'host-1', label: 'Mug' }
    const catalog: AiJobOutput = { ...product, id: 'catalog', proposal: { kind: 'catalog' } }
    expect(aiSiteContentBriefLines([product, catalog])).toEqual([
      'This store\'s products are: “Mug”.',
      'Where a page features products, feature these by their names; never name another product, and never state a price.',
    ])
    expect(aiSiteContentBriefLines([])).toEqual([])
  })

  it('publishes the posts and names the blog’s addresses for the cache, never throwing', async () => {
    const publish = jest.fn(async () => ({ published: ['a'], kept: [{ id: 'b', reason: 'no byline' }] }))
    const job = { $id: 'job', orgId: 'org-1', hostId: 'host-1', createdBy: 'uid-1' }
    const result = await aiPublishSitePosts(firestore, { job, outputs: [post('a', 'One', 'one'), post('b', 'Two', 'two')], now: NOW }, publish)
    expect(publish).toHaveBeenCalledWith(firestore, { hostId: 'host-1', collectionId: 'c1', uid: 'uid-1', ids: ['a', 'b'], now: NOW })
    expect(result).toEqual({ published: 1, kept: 1, paths: ['/blog', '/blog/one'] })
    expect(await aiPublishSitePosts(firestore, { job, outputs: [], now: NOW }, publish)).toBeNull()
    const thrown = jest.fn(async () => {
      throw new Error('down')
    })
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    expect(await aiPublishSitePosts(firestore, { job, outputs: [post('a', 'One', 'one')], now: NOW }, thrown)).toBeNull()
  })
})
