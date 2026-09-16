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
 * The template step (AGL-2909), against the REAL doctrine loop, validators,
 * starter examples, draft writer and plan arithmetic: only the provider (at
 * the runtime's `runAiRequest` seam), the routing table's answer, the
 * inventory reader, the host index, the duplicate module and the machine's
 * registry are stubbed, and Firestore is a double that honors transactions.
 *
 *  - BOUND, NOT TYPED. A template keeps the subject's tokens: a heading bound
 *    to the title and an image whose `src` is a token — which the palette
 *    validator admits only because this door names the token — reach the
 *    stored draft intact.
 *  - THE PAGE'S OWN TOKENS. A token the page does not fill, a typed title or
 *    another subject's block is refused, re-asked once, and stops the job.
 *  - INERT. The template lands in the library bound to nothing.
 */

const mockRunAiRequest = jest.fn()
const mockReadInventory = jest.fn()
const mockDocs = new Map<string, Record<string, unknown>>()
const mockOwners = new Map<string, string>()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: (...args: unknown[]) => mockReadInventory(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))

jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  __esModule: true,
  duplicateResource: jest.fn(),
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import type { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_TEMPLATE_SUBJECT_DEFINITIONS } from '../model/ai-template-subjects'
import { AI_DOCTRINE_SYSTEM_BLOCK, aiDoctrineTreeTool } from '../runtime/ai-doctrine'
import { AI_DOCTRINE_RULES } from '../runtime/ai-doctrine-validators'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import { aiTemplateExamplesSystemBlock } from '../runtime/ai-template-examples'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_TEMPLATE_INSTRUCTIONS,
  AI_JOB_TEMPLATE_MAX_TOKENS,
  aiJobTemplatePrompt,
  aiTemplateDraftName,
  aiTemplateDraftSlug,
  createAiJobTemplateStep,
  runAiJobTemplateStep,
  registerAiTemplateJob,
} from './ai-job-template-step'
import { registerAiJobStep } from './ai-jobs'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'

const NOW = new Date('2026-09-15T20:00:00.000Z')
const FREE_ORG = {}
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const USAGE = { inputTokens: 2_500, outputTokens: 700, cacheReadTokens: 7_000, cacheWriteTokens: 0 }

// ── Firestore double ─────────────────────────────────────────────────────

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      data,
    )
}

function snapshotOf(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? valueAt(data, field) : undefined),
  }
}

type DocTarget = { kind: 'doc'; path: string }
type QueryTarget = { kind: 'query'; get: () => Promise<{ docs: Array<ReturnType<typeof snapshotOf>> }> }

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const query: QueryTarget = {
    kind: 'query',
    get: async () => ({
      docs: [...mockDocs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .map(snapshotOf),
    }),
  }
  return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, get: query.get }
}

let commits: string[] = []

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await fn({
      get: async (target: DocTarget | QueryTarget) =>
        target.kind === 'query' ? target.get() : snapshotOf(target.path),
      create: (ref: DocTarget, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (mockDocs.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      mockDocs.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

// ── Fixtures ─────────────────────────────────────────────────────────────

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  collections: [{ id: 'col-blog', name: 'Blog', slug: 'blog' }],
}

const PLAN: AiJobPlan = {
  reuse: [{ kind: 'collection', id: 'col-blog', purpose: 'the entries the page renders' }],
  create: [
    {
      kind: 'template',
      name: 'Blog post page',
      why: 'The blog renders with the built-in article.',
      duplicateOf: null,
      fields: [],
    },
  ],
  screens: [],
  status: 'confirmed',
  labels: { 'col-blog': 'Blog' },
  proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
  confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
  confirmedBy: 'uid-1',
}

/** An entry page: its title and cover bound, the entry blocks placed. */
const ENTRY_TREE = {
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['band'] },
    band: {
      componentId: 'muiContainer',
      props: { maxWidth: 'md' },
      sx: { paddingTop: 8, paddingBottom: 8 },
      nodes: ['stack'],
    },
    stack: { componentId: 'muiStack', props: { spacing: 3 }, nodes: ['title', 'meta', 'cover', 'body', 'related'] },
    title: { componentId: 'muiTypography', props: { variant: 'h2', component: 'h1', children: '{{entry.title}}' } },
    meta: { componentId: 'collectionEntryMeta' },
    cover: {
      componentId: 'image',
      props: { src: '{{entry.coverImage}}', alt: 'Cover picture for {{entry.title}}' },
    },
    body: { componentId: 'collectionEntryBody' },
    related: { componentId: 'collectionRelated', props: { heading: 'Keep reading' } },
  },
}

/** A product page with a typed title, a token no product page fills, and an entry block. */
const MISBOUND_PRODUCT_TREE = {
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['band'] },
    band: {
      componentId: 'muiContainer',
      props: { maxWidth: 'lg' },
      sx: { paddingTop: 6, paddingBottom: 6 },
      nodes: ['stack'],
    },
    stack: { componentId: 'muiStack', props: { spacing: 2 }, nodes: ['title', 'sku', 'body'] },
    title: { componentId: 'muiTypography', props: { variant: 'h2', component: 'h1', children: 'Our finest roof tile' } },
    sku: { componentId: 'muiTypography', props: { variant: 'body2', children: 'Item {{product.sku}}' } },
    body: { componentId: 'collectionEntryBody' },
  },
}

/** An author page: the profile block and a heading bound to the name. */
const AUTHOR_TREE = {
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['band'] },
    band: {
      componentId: 'muiContainer',
      props: { maxWidth: 'md' },
      sx: { paddingTop: 8, paddingBottom: 8 },
      nodes: ['stack'],
    },
    stack: { componentId: 'muiStack', props: { spacing: 2 }, nodes: ['title', 'profile'] },
    title: { componentId: 'muiTypography', props: { variant: 'h3', component: 'h1', children: 'Writing by {{author.name}}' } },
    profile: { componentId: 'contentAuthorProfile' },
  },
}

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'template',
    status: 'running',
    brief: 'An article page for the blog: title, byline, cover, the post, then related posts.',
    inputs: { subject: 'entry', collectionId: 'col-blog' },
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 3 },
      { name: 'generate', status: 'running', creditsSpent: 0 },
    ],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 3,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: PLAN,
    review: null,
    ...patch,
  } as AiJob
}

function treeAnswer(tree: unknown) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name: 'submit_template', input: { tree: JSON.stringify(tree) } }],
    usage: USAGE,
    estCostUsd: 0.015,
    stopReason: 'tool_use',
  }
}

const context = (patch: Partial<AiJob> = {}) => ({ job: job(patch), stepIndex: 1, now: NOW, firestore })

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
  mockDocs.clear()
  mockOwners.clear()
  commits = []
  mockOwners.set('host-1', 'org-1')
  mockDocs.set('hosts/host-1', { subdomain: 'acme' })
  mockDocs.set('hosts/host-1/collections/col-blog', { kind: 'content', displayName: 'Blog', slug: 'blog' })
  mockDocs.set('hosts/host-1/collections/col-shop', { kind: 'catalog', name: 'Shop', slug: 'shop' })
  mockDocs.set('orgs/org-1', STARTER_ORG)
})

describe('the template step', () => {
  it('registers the template runner, with an admission that reads what the page is for', async () => {
    registerAiTemplateJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('template', runAiJobTemplateStep)
    const ask = (inputs: Record<string, unknown>, org: object = STARTER_ORG, hostId: string | null = 'host-1') =>
      aiJobAdmissionRefusal('template', { firestore, orgId: 'org-1', hostId, inputs, org })
    expect(await ask({})).toEqual({ status: 400, error: expect.stringContaining('inputs.subject') })
    expect(await ask({ subject: 'entry' })).toEqual({
      status: 400,
      error: expect.stringContaining('inputs.collectionId'),
    })
    expect(await ask({ subject: 'product' }, STARTER_ORG, null)).toEqual({
      status: 400,
      error: 'Open the site the template is for before starting the job',
    })
    expect(await ask({ subject: 'entry', collectionId: 'col-missing' })).toEqual({
      status: 404,
      error: 'That content collection is not on this site',
    })
    // A commerce catalog shares the collections store and has no entry pages.
    expect(await ask({ subject: 'entry', collectionId: 'col-shop' })).toEqual({
      status: 404,
      error: 'That content collection is not on this site',
    })
    for (let index = 0; index < 10; index += 1) {
      mockDocs.set(`hosts/host-1/templates/own-${index}`, { displayName: `Own ${index}`, source: { type: 'authored' } })
    }
    expect(await ask({ subject: 'author' }, FREE_ORG)).toEqual({
      status: 403,
      error: 'Your plan includes 10 templates — upgrade in Billing for more',
    })
    expect(await ask({ subject: 'entry', collectionId: 'col-blog' })).toBeNull()
  })

  it('builds an entry page with its tokens bound, from the starter examples, as an inert library draft', async () => {
    mockRunAiRequest.mockResolvedValueOnce(treeAnswer(ENTRY_TREE))
    const outcome = await createAiJobTemplateStep()(context())
    expect(outcome).toEqual({
      outputs: [
        {
          resource: 'template',
          id: 'job-1',
          versionId: null,
          hostId: 'host-1',
          hostSubdomain: 'acme',
          label: 'Blog post page',
          load: expect.objectContaining({ documentBytes: expect.any(Number) }),
        },
      ],
      usage: USAGE,
      estCostUsd: 0.015,
      model: 'routed-model',
      stopReason: 'tool_use',
    })

    const [request] = mockRunAiRequest.mock.calls[0]
    const definition = AI_TEMPLATE_SUBJECT_DEFINITIONS.entry
    const collection = { id: 'col-blog', name: 'Blog', slug: 'blog' }
    expect(request).toMatchObject({
      model: 'routed-model',
      tools: [aiDoctrineTreeTool('template'), aiInventoryLookupTool()],
      maxTokens: AI_JOB_TEMPLATE_MAX_TOKENS,
      thinking: 'off',
      messages: [
        {
          role: 'user',
          content: aiJobTemplatePrompt(job(), definition, collection, PLAN, 'Blog post page'),
        },
      ],
    })
    expect(request.system).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      AI_JOB_TEMPLATE_INSTRUCTIONS[0],
      aiTemplateExamplesSystemBlock(),
      { text: AI_PALETTE_CATALOG.screen, cacheBreakpoint: true },
      expect.objectContaining({ volatile: true }),
    ])
    expect(() => validateAiSystemBlocks(request.system)).not.toThrow()
    const prompt = request.messages[0].content as string
    expect(prompt).toContain('The page is for a collection entry of the "Blog" collection (/blog).')
    expect(prompt).toContain('Title token: {{entry.title}}')
    expect(prompt).toContain('{{entry.coverImage}}')

    expect(commits).toEqual(['hosts/host-1/templates/job-1'])
    const template = mockDocs.get('hosts/host-1/templates/job-1') ?? {}
    expect(template).toMatchObject({
      kind: 'page',
      displayName: 'Blog post page',
      slug: 'blog-entry-template',
      source: { type: 'authored' },
    })
    // The tokens reach the stored tree intact: the title, and the cover the palette admits only for this door.
    const nodes = Object.values(decodeStoredNodes<Record<string, { componentId: string; props?: Record<string, unknown> }>>(template['nodes']) ?? {})
    expect(nodes.find((node) => node.componentId === 'image')?.props).toMatchObject({
      src: '{{entry.coverImage}}',
      alt: 'Cover picture for {{entry.title}}',
    })
    expect(nodes.find((node) => node.componentId === 'muiTypography')?.props?.['children']).toBe('{{entry.title}}')
  })

  it('asks once more, then stops for review, when the page is typed where it should be bound', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(treeAnswer(MISBOUND_PRODUCT_TREE))
      .mockResolvedValueOnce(treeAnswer(MISBOUND_PRODUCT_TREE))
    const outcome = await createAiJobTemplateStep()(
      context({ inputs: { subject: 'product' }, plan: null }),
    )
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const reask = mockRunAiRequest.mock.calls[1][0].messages[2].content as string
    expect(reask).toContain(`Rule 8 (${AI_DOCTRINE_RULES[8]})`)
    expect(outcome.outputs).toEqual([])
    expect(outcome.review).toEqual({
      reason: 'doctrine',
      message: expect.stringContaining('Rule 8'),
      findings: [
        { rule: 8, code: 'unknown-binding', message: expect.stringContaining('{{product.sku}}') },
        { rule: 8, code: 'typed-title', message: expect.stringContaining('{{product.name}}') },
        { rule: 8, code: 'foreign-block', message: expect.stringContaining('a collection entry’s page') },
      ],
    })
    expect(commits).toEqual([])
  })

  it('builds an author page under its own name and address', async () => {
    mockRunAiRequest.mockResolvedValueOnce(treeAnswer(AUTHOR_TREE))
    const outcome = await createAiJobTemplateStep()(context({ inputs: { subject: 'author' }, plan: null }))
    expect(outcome.review).toBeUndefined()
    expect(outcome.outputs).toEqual([
      expect.objectContaining({ resource: 'template', label: 'Author page template' }),
    ])
    expect(mockDocs.get('hosts/host-1/templates/job-1')).toMatchObject({
      displayName: 'Author page template',
      slug: 'author-page-template',
    })
    expect(mockRunAiRequest.mock.calls[0][0].messages[0].content).toContain('The page is for an author.')
  })

  it('stops for the member, spending nothing, when the site has no template to spare', async () => {
    mockDocs.set('orgs/org-1', FREE_ORG)
    for (let index = 0; index < 10; index += 1) {
      mockDocs.set(`hosts/host-1/templates/own-${index}`, { displayName: `Own ${index}`, source: { type: 'authored' } })
    }
    const outcome = await createAiJobTemplateStep()(context())
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      outputs: [],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
      model: 'routed-model',
      stopReason: null,
      review: {
        reason: 'limit',
        message: 'Your plan includes 10 templates — upgrade in Billing for more',
        findings: [],
      },
    })
  })

  it('copies the template a confirmed plan starts from, and generates nothing', async () => {
    mockReadInventory.mockResolvedValue({
      ...INVENTORY,
      templates: [{ id: 'tpl-post', name: 'Blog post', kind: 'page' }],
    })
    const plan: AiJobPlan = { ...PLAN, create: [{ ...PLAN.create[0], duplicateOf: 'tpl-post' }] }
    const duplicate = jest.fn().mockResolvedValue({ ok: true, id: 'tpl-copy', versionId: null, name: 'Blog post page' })
    const outcome = await createAiJobTemplateStep({
      duplicate: duplicate as unknown as typeof duplicateResource,
    })(context({ plan }))
    expect(duplicate).toHaveBeenCalledWith('template', expect.objectContaining({ sourceId: 'tpl-post', name: 'Blog post page' }))
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.outputs).toEqual([
      { resource: 'template', id: 'tpl-copy', versionId: null, hostId: 'host-1', hostSubdomain: 'acme', label: 'Blog post page' },
    ])
    expect(commits).toEqual([])
  })
})

describe('the template’s name and address', () => {
  it('takes the plan’s name, else the collection’s or the subject’s, and offers a -template address', () => {
    const entry = AI_TEMPLATE_SUBJECT_DEFINITIONS.entry
    const blog = { id: 'col-blog', name: 'Blog', slug: 'blog' }
    expect(aiTemplateDraftName(entry, blog, 'Post page')).toBe('Post page')
    expect(aiTemplateDraftName(entry, blog, null)).toBe('Blog entry template')
    expect(aiTemplateDraftName(AI_TEMPLATE_SUBJECT_DEFINITIONS.product, null, '')).toBe('Product page template')
    expect(aiTemplateDraftSlug(entry, blog)).toBe('blog-entry-template')
    expect(aiTemplateDraftSlug(entry, { ...blog, slug: '' })).toBe('col-blog-entry-template')
    expect(aiTemplateDraftSlug(AI_TEMPLATE_SUBJECT_DEFINITIONS.product, null)).toBe('product-page-template')
  })
})
