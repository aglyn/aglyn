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
 * The email step (AGL-2912), against the REAL doctrine loop, validators and
 * email renderer: only the provider (at the runtime's `runAiRequest` seam),
 * the routing table's answer, the inventory reader, the host index, the
 * release flags and the machine's registry are stubbed, and the resource
 * draft writers are fakes whose `check` renders the design the way the email
 * plugin's own writer does.
 *
 * So an email the step keeps is one the doctrine held AND one that renders,
 * and the drafts it writes are the documents the owning plugins would have
 * written — and nothing else.
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

// The reader needs the Admin SDK; its own spec drives it.
jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: (...args: unknown[]) => mockReadInventory(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
  orgDataCollectionForHost: jest.fn(),
}))

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: readonly string[]) => [...ids],
}))

// The machine is not under test here — only that the step registers with it.
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PluginDraftRecord,
  PluginDraftRefusal,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { renderEmailHtml } from '@aglyn/shared-util-email/email-render'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiJob } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_GENERATION_MAX_TOKENS } from '../runtime/ai-doctrine'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { AI_JOB_LAYOUT_MAX_TOKENS } from './ai-job-layout-step'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_EMAIL_DESIGN_RESOURCE,
  AI_EMAIL_PREHEADER_MAX_CHARS,
  AI_EMAIL_SITE_URL_TOKEN,
  AI_EMAIL_VARIANTS,
  AI_JOB_EMAIL_MAX_TOKENS,
  aiJobEmailPrompt,
  createAiJobEmailStep,
  runAiJobEmailStep,
  registerAiEmailJob,
  AI_JOB_EMAIL_STEP_BUDGETS,
  AI_JOB_EMAIL_STEP_MINIMUM_MS,
} from './ai-job-email-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-09-15T20:00:00.000Z')
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const USAGE = { inputTokens: 3_000, outputTokens: 900, cacheReadTokens: 6_000, cacheWriteTokens: 0 }

const GOLDENS = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ai-job-email-goldens.json'), 'utf8'),
) as Record<string, any>

// ── Sentinels: what must never reach the model ───────────────────────────
//
// Each is distinctive enough that a substring search over every request the
// step made is a real proof rather than a coincidence.

const LIST_NAME = 'Autumn regulars zzlist'
const CONTACT_EMAIL = 'zzcontact@example.test'
const CONTACT_NAME = 'Zzperson Marchetti'
const PRODUCT_NAME = 'Rye loaf'
const PRODUCT_PRICE = '7.25'
const CRM_NOTE = 'zzdeal closed last March'
const SEND_STATS = '4821'

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

function childKeys(path: string): string[] {
  return [...mockDocs.keys()]
    .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
    .sort()
}

function queryRef(path: string): Record<string, unknown> {
  const query: Record<string, unknown> = {
    where: () => query,
    select: () => query,
    limit: () => query,
    get: async () => ({ docs: childKeys(path).map(snapshotOf) }),
  }
  return query
}

function docRef(path: string): Record<string, unknown> {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  return { path, doc: (id: string) => docRef(`${path}/${id}`), ...queryRef(path) }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
} as unknown as FirebaseFirestore.Firestore

// ── The design writer, as the email plugin registers it ──────────────────

interface FakeDesign {
  id: string
  name: string
  content: Record<string, unknown>
}

let designs: FakeDesign[] = []
let designRefusal: PluginDraftRefusal | null = null

function designRecord(design: FakeDesign): PluginDraftRecord {
  const content = design.content
  return {
    id: design.id,
    name: design.name,
    versionId: `ver-${design.id}`,
    facts: {
      subject: content['subject'],
      preheader: content['preheader'],
      subjectVariants: content['subjectVariants'],
      preheaderVariants: content['preheaderVariants'],
    },
  }
}

/** The renderer the email plugin's own writer checks a design with. */
function renders(content: Readonly<Record<string, unknown>>): { html: string; text: string } {
  return renderEmailHtml({
    nodes: content['nodes'] as NodesMap as never,
    rootId: CANVAS_ROOT_ELEMENT_ID,
    subject: String(content['subject'] ?? ''),
    preheader: String(content['preheader'] ?? ''),
    // The design carries no hand-written HTML, so nothing reaches the policy.
    sanitize: (html: string) => html,
  })
}

const designWriter: PluginResourceDraftWriter = {
  refusal: async () => designRefusal,
  check: (content) => {
    const nodes = content['nodes'] as NodesMap | undefined
    const problems: string[] = []
    if (!nodes || !Object.keys(nodes).length) problems.push('The design has no blocks')
    let text = ''
    if (nodes) {
      try {
        text = renders(content).text
      } catch (error) {
        problems.push(`The design does not render: ${(error as Error).message}`)
      }
    }
    return problems.length
      ? { ok: false, problems }
      : { ok: true, facts: { messageText: text, blocks: Object.keys(nodes ?? {}).length } }
  },
  read: async ({ id }) => {
    const design = designs.find((one) => one.id === id)
    return design ? designRecord(design) : null
  },
  write: async (request) => {
    const existing = designs.find((one) => one.id === request.id)
    if (existing) return { ok: true, replayed: true, ...designRecord(existing) }
    const design = { id: request.id, name: request.name, content: { ...request.content } }
    designs.push(design)
    return { ok: true, replayed: false, ...designRecord(design) }
  },
}

const writerFor = (resource: string) =>
  resource === AI_EMAIL_DESIGN_RESOURCE ? designWriter : null

// ── Fixtures ─────────────────────────────────────────────────────────────

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  screens: [
    { id: 'scr-home', name: 'Home', slug: '/', layoutId: null, template: false },
    { id: 'scr-menu', name: 'Menu', slug: 'menu', layoutId: null, template: false },
  ],
}

/** The id the job recorded for its design when it was created (AGL-3079). */
const DESIGN_ID = 'drftEmailD'

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'email',
    status: 'running',
    brief: GOLDENS['welcome'].brief,
    inputs: { emailType: 'welcome' },
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 3 },
      { name: 'generate', status: 'running', creditsSpent: 0, draftIds: { email: DESIGN_ID } },
    ],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 3,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: null,
    review: null,
    ...patch,
  } as AiJob
}

function emailAnswer(golden: { tree: unknown; subjects: string[]; preheaders: string[] }) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [
      {
        name: 'submit_email',
        input: {
          tree: JSON.stringify(golden.tree),
          subjects: golden.subjects,
          preheaders: golden.preheaders,
        },
      },
    ],
    usage: USAGE,
    estCostUsd: 0.02,
    stopReason: 'tool_use',
  }
}

const context = (patch: Partial<AiJob> = {}) => ({
  job: job(patch),
  stepIndex: 1,
  now: NOW,
  firestore,
})

const run = (patch: Partial<AiJob> = {}) =>
  createAiJobEmailStep({ readInventory: mockReadInventory as never, writerFor })(context(patch) as never)

/** Everything the step sent the provider, as one searchable string. */
const sentToModel = () => JSON.stringify(mockRunAiRequest.mock.calls)

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
  mockDocs.clear()
  mockOwners.clear()
  designs = []
  designRefusal = null
  mockOwners.set('host-1', 'org-1')
  mockDocs.set('hosts/host-1', { subdomain: 'brightside' })
  mockDocs.set('orgs/org-1', STARTER_ORG)
  // Product records the step may read and must never send.
  mockDocs.set('hosts/host-1/products/prod-rye', { name: PRODUCT_NAME, price: PRODUCT_PRICE })
  mockDocs.set('hosts/host-1/products/prod-bun', { name: 'Brown butter bun', price: '3.50' })
})

describe('the email step', () => {
  it('registers the email runner, with the admission the doors ask', async () => {
    registerAiEmailJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('email', runAiJobEmailStep, {
      minimumMs: AI_JOB_EMAIL_STEP_MINIMUM_MS,
    })
    const ask = (hostId: string | null) =>
      aiJobAdmissionRefusal('email', {
        firestore,
        orgId: 'org-1',
        hostId,
        inputs: {},
        org: { ...STARTER_ORG, enabledPlugins: ['email'] },
        uid: 'uid-1',
      })
    expect(await ask(null)).toEqual({
      status: 400,
      error: 'Open the site the email is for before starting the job',
    })
    expect(await ask('host-2')).toEqual({ status: 404, error: 'Unknown site' })
  })

  it.each(['welcome', 'newsletter', 'launch'])(
    'builds the %s golden as a draft design, with three subjects and three preheaders',
    async (name) => {
      const golden = GOLDENS[name]
      mockRunAiRequest.mockResolvedValueOnce(emailAnswer(golden))
      const outcome = await run({ brief: golden.brief, inputs: { emailType: golden.emailType } })
      expect(outcome.failure).toBeUndefined()
      expect(outcome.review).toBeUndefined()
      expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
      expect(outcome.outputs).toHaveLength(1)
      expect(outcome.outputs[0]).toMatchObject({
        resource: 'emailScreen',
        id: DESIGN_ID,
        hostId: 'host-1',
        hostSubdomain: 'brightside',
      })
      const [design] = designs
      expect(design.content['subjectVariants']).toHaveLength(AI_EMAIL_VARIANTS)
      expect(design.content['preheaderVariants']).toHaveLength(AI_EMAIL_VARIANTS)
      expect(design.content['subject']).toBe(golden.subjects[0])
      expect(design.content['preheader']).toBe(golden.preheaders[0])
    },
  )

  it('completes a link to one of the site’s pages with the site address token', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['welcome']))
    await run()
    const nodes = designs[0].content['nodes'] as Record<string, { props?: Record<string, unknown> }>
    const hrefs = Object.values(nodes)
      .map((node) => node.props?.['href'])
      .filter((href): href is string => typeof href === 'string')
    expect(hrefs).toContain(`${AI_EMAIL_SITE_URL_TOKEN}/menu`)
  })

  it('re-asks once with the violation, and keeps the answer that holds', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(
        emailAnswer({ ...GOLDENS['welcome'], tree: GOLDENS['controls']['unlinkedButton'].tree }),
      )
      .mockResolvedValueOnce(emailAnswer(GOLDENS['welcome']))
    const outcome = await run()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome.outputs).toHaveLength(1)
    expect(sentToModel()).toContain('links nowhere')
  })

  it.each([
    ['looseBlock', 'outside every Email section'],
    ['unlinkedButton', 'links nowhere'],
    ['foreignToken', 'may not use'],
    ['productBlock', 'remove the Email product blocks'],
  ])('refuses the %s control twice and stops for a person', async (name, reason) => {
    const tree = GOLDENS['controls'][name].tree
    mockRunAiRequest
      .mockResolvedValueOnce(emailAnswer({ ...GOLDENS['welcome'], tree }))
      .mockResolvedValueOnce(emailAnswer({ ...GOLDENS['welcome'], tree }))
    const outcome = await run()
    expect(outcome.review?.reason).toBe('doctrine')
    expect(JSON.stringify(outcome.review?.findings)).toContain(reason)
    expect(designs).toHaveLength(0)
    expect(sentToModel()).toContain(reason)
  })

  it('refuses hand-written HTML, which the email palette does not carry', async () => {
    const tree = GOLDENS['controls']['handWrittenHtml'].tree
    mockRunAiRequest
      .mockResolvedValueOnce(emailAnswer({ ...GOLDENS['welcome'], tree }))
      .mockResolvedValueOnce(emailAnswer({ ...GOLDENS['welcome'], tree }))
    const outcome = await run()
    expect(outcome.review?.reason).toBe('doctrine')
    expect(designs).toHaveLength(0)
    expect(AI_PALETTE_CATALOG['email']).not.toContain('emailHtml')
    expect(AI_PALETTE_CATALOG['email']).not.toContain('emailRichtext')
  })

  it.each(['twoSubjects', 'repeatedSubjects', 'tokenInSubject'])(
    'refuses the %s copy control',
    async (name) => {
      const control = GOLDENS['copyControls'][name]
      const answer = { ...GOLDENS['welcome'], subjects: control.subjects, preheaders: control.preheaders }
      mockRunAiRequest
        .mockResolvedValueOnce(emailAnswer(answer))
        .mockResolvedValueOnce(emailAnswer(answer))
      const outcome = await run()
      expect(outcome.review?.reason).toBe('doctrine')
      expect(designs).toHaveLength(0)
    },
  )

  it('reports the design an earlier run wrote, and spends nothing', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['welcome']))
    await run()
    mockRunAiRequest.mockClear()
    const again = await run()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(again.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(again.estCostUsd).toBe(0)
    expect(again.outputs).toHaveLength(1)
    expect(designs).toHaveLength(1)
    // Found under the id the job recorded, which the first run wrote it under (AGL-3079).
    expect([designs[0].id, again.outputs[0].id]).toEqual([DESIGN_ID, DESIGN_ID])
  })

  it('stops for a person when the site has no room, and spends nothing', async () => {
    designRefusal = { status: 403, error: 'This site has all the screens its plan allows' }
    const outcome = await run()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.review).toEqual({
      reason: 'limit',
      message: 'This site has all the screens its plan allows',
      findings: [],
    })
  })
})

describe('what an email job sends the model', () => {
  it('binds products by id AFTER the answer, and sends only how many to place', async () => {
    const golden = GOLDENS['launch']
    const withCard = {
      ...golden.tree,
      nodes: {
        ...golden.tree.nodes,
        detail: { ...golden.tree.nodes['detail'], nodes: ['card', 'scarcity', 'spacer', 'small'] },
        card: { componentId: 'emailProduct', props: { buttonLabel: 'Buy one' } },
      },
    }
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer({ ...golden, tree: withCard }))
    // The member picked the product; the brief never names it.
    const outcome = await run({
      brief: 'Announce the box, and show the one thing we are proudest of.',
      inputs: { emailType: 'launch', productIds: 'prod-rye' },
    })
    expect(outcome.outputs).toHaveLength(1)
    // The doctrine mints its own ids, so the card is found by what it is.
    const nodes = designs[0].content['nodes'] as Record<
      string,
      { componentId?: string; props?: Record<string, unknown> }
    >
    const cards = Object.values(nodes).filter((node) => node.componentId === 'emailProduct')
    expect(cards).toHaveLength(1)
    expect(cards[0].props?.['productId']).toBe('prod-rye')
    // The model was told a count and nothing else about the product.
    expect(sentToModel()).toContain('Products bound to this email: 1')
    expect(sentToModel()).not.toContain(PRODUCT_NAME)
    expect(sentToModel()).not.toContain(PRODUCT_PRICE)
    expect(sentToModel()).not.toContain('prod-rye')
  })

  it('sends no list, contact, CRM record, product record or engagement figure', async () => {
    mockDocs.set('hosts/host-1/products/prod-rye', {
      name: PRODUCT_NAME,
      price: PRODUCT_PRICE,
      note: CRM_NOTE,
    })
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['welcome']))
    await run({
      brief: `A welcome email for the ${LIST_NAME}. Keep it short.`,
      inputs: { emailType: 'welcome' },
    })
    const sent = sentToModel()
    for (const secret of [CONTACT_EMAIL, CONTACT_NAME, CRM_NOTE, PRODUCT_NAME, PRODUCT_PRICE, SEND_STATS]) {
      expect(sent).not.toContain(secret)
    }
    // The brief itself is sent as written, and it is allowed to name a list.
    expect(sent).toContain(LIST_NAME)
  })

  it('never names a list, a contact or a send in its own instructions or prompt', () => {
    const prompt = aiJobEmailPrompt(
      { brief: 'Anything at all.', inputs: {} },
      null,
      'Email name: Test',
      0,
    )
    expect(prompt).not.toMatch(/list|contact|recipient|subscriber/i)
  })
})

describe('the email step’s budget', () => {
  it('asks for no thinking, under a ceiling tighter than a layout’s', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['welcome']))
    await run()
    const [request] = mockRunAiRequest.mock.calls[0]
    expect(request.thinking).toBe('off')
    expect(request.maxTokens).toBe(AI_JOB_EMAIL_STEP_BUDGETS['job.email'].maxTokens('routed-model'))
    expect(AI_JOB_EMAIL_MAX_TOKENS).toBeLessThanOrEqual(AI_JOB_LAYOUT_MAX_TOKENS)
    expect(AI_JOB_EMAIL_MAX_TOKENS).toBeLessThan(AI_GENERATION_MAX_TOKENS.email)
  })

  it('fits every golden answer in half the ceiling, so one answer and its re-ask fit', () => {
    for (const name of ['welcome', 'newsletter', 'launch']) {
      const golden = GOLDENS[name]
      const answer = JSON.stringify({
        tree: JSON.stringify(golden.tree),
        subjects: golden.subjects,
        preheaders: golden.preheaders,
      })
      // Three characters a token errs high for a tokenizer that splits finer.
      expect(answer.length / 3).toBeLessThanOrEqual(AI_JOB_EMAIL_MAX_TOKENS / 2)
    }
  })

  it('keeps the preheader within what the send route stores', () => {
    // The send route reads `headerSafe(req.body?.preheader, 200)`; a generated
    // preheader longer than that would be cut by the send, not by the design.
    expect(AI_EMAIL_PREHEADER_MAX_CHARS).toBe(200)
  })
})
