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
 * The layout step (AGL-2909), against the REAL doctrine loop, validators,
 * draft writer and plan arithmetic: only the provider (at the runtime's
 * `runAiRequest` seam), the routing table's answer, the inventory reader, the
 * host index, the duplicate module and the machine's registry are stubbed,
 * and Firestore is a double that honors transactions.
 *
 * So a layout the step keeps is one the doctrine held, a layout it stops on
 * is one the doctrine or the door refused twice, and a draft it writes is the
 * document the create route would have written — and nothing else.
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
}))

// The duplicate module needs the Admin SDK; its own spec drives it, and each
// test here hands the step a double.
jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  __esModule: true,
  duplicateResource: jest.fn(),
}))

// The machine is not under test here — only that the step registers with it.
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import type { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_DOCTRINE_SYSTEM_BLOCK, aiDoctrineTreeTool } from '../runtime/ai-doctrine'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_DRAFT_VERSION_NAME } from './ai-job-drafts'
import { AI_COPY_SOURCE_MAX_CHARS, AI_JOB_ZERO_USAGE, aiCopySourceLines } from './ai-job-generation'
import {
  AI_JOB_LAYOUT_INSTRUCTIONS,
  aiJobLayoutPrompt,
  createAiJobLayoutStep,
  runAiJobLayoutStep,
  registerAiLayoutJob,
  AI_JOB_LAYOUT_STEP_BUDGET,
  AI_JOB_LAYOUT_STEP_MINIMUM_MS,
} from './ai-job-layout-step'
import { registerAiJobStep } from './ai-jobs'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'

const NOW = new Date('2026-09-15T20:00:00.000Z')
const FREE_ORG = {}
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const USAGE = { inputTokens: 3_000, outputTokens: 900, cacheReadTokens: 6_000, cacheWriteTokens: 0 }
const LIMIT = 'Your plan includes 1 shared layouts — upgrade in Billing for more'

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
  screens: [
    { id: 'scr-home', name: 'Home', slug: '/', layoutId: null, template: false },
    { id: 'scr-about', name: 'About', slug: 'about', layoutId: null, template: false },
  ],
}

const NAV_INVENTORY: AiSiteInventory = {
  ...INVENTORY,
  components: [{ id: 'cmp-nav', name: 'Main navigation', props: {} }],
}

const PLAN: AiJobPlan = {
  reuse: [],
  create: [
    {
      kind: 'layout',
      name: 'Main layout',
      why: 'The site has no layout yet.',
      duplicateOf: null,
      fields: [],
    },
  ],
  screens: [],
  status: 'confirmed',
  labels: {},
  proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
  confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
  confirmedBy: 'uid-1',
}

/** A header of screen links, the slot, a footer: what a model answers with. */
const LAYOUT_TREE = {
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['header', 'slot', 'footer'] },
    header: { componentId: 'muiAppBar', props: { position: 'static', color: 'default' }, nodes: ['bar'] },
    bar: { componentId: 'muiToolbar', nodes: ['brand', 'home', 'about'] },
    brand: { componentId: 'muiTypography', props: { variant: 'h6', component: 'p', children: 'Acme Roofing' } },
    home: { componentId: 'muiScreenLink', props: { screenId: 'scr-home', children: 'Home' } },
    about: { componentId: 'muiScreenLink', props: { screenId: 'scr-about', children: 'About' } },
    slot: { componentId: 'layoutSlot' },
    footer: { componentId: 'section', props: { element: 'footer' }, nodes: ['tagline'] },
    tagline: {
      componentId: 'muiTypography',
      props: { variant: 'body2', children: 'Family-run roofers in Springfield since 1998.' },
    },
  },
}

/** The layout's nodes without the ones named, for a variant that writes its own. */
const layoutNodesWithout = (...ids: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(LAYOUT_TREE.nodes).filter(([id]) => !ids.includes(id)))

/** The same layout with the site's navigation component placed instead of its links. */
const NAV_TREE = {
  rootId: 'root',
  nodes: {
    ...layoutNodesWithout('home', 'about'),
    bar: { componentId: 'muiToolbar', nodes: ['brand', 'nav'] },
    nav: { componentId: 'reusableInstance', props: { refId: 'cmp-nav' } },
  },
}

/** The id the job recorded for its layout when it was created (AGL-3079). */
const LAYOUT_ID = 'drftLayout'

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'layout',
    status: 'running',
    brief: 'A header with Home and About, and a footer with our tagline.',
    inputs: {},
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 3 },
      { name: 'generate', status: 'running', creditsSpent: 0, draftIds: { layout: LAYOUT_ID } },
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
    toolUse: [{ name: 'submit_layout', input: { tree: JSON.stringify(tree) } }],
    usage: USAGE,
    estCostUsd: 0.02,
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
  mockDocs.set('orgs/org-1', STARTER_ORG)
})

describe('the layout step', () => {
  it('registers the layout runner, with the admission the create and resume doors ask', async () => {
    registerAiLayoutJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('layout', runAiJobLayoutStep, {
      minimumMs: AI_JOB_LAYOUT_STEP_MINIMUM_MS,
      // A pass that builds a creation of its plan first needs that step's time (AGL-3143 §15).
      minimumMsFor: expect.any(Function),
    })
    const ask = (hostId: string | null, org: object) =>
      aiJobAdmissionRefusal('layout', { firestore, orgId: 'org-1', hostId, inputs: {}, org })
    expect(await ask(null, STARTER_ORG)).toEqual({
      status: 400,
      error: 'Open the site the layout is for before starting the job',
    })
    expect(await ask('host-1', STARTER_ORG)).toBeNull()
    mockDocs.set('hosts/host-1/layouts/lay-a', { displayName: 'A' })
    expect(await ask('host-1', FREE_ORG)).toEqual({ status: 403, error: LIMIT })
  })

  it('builds the confirmed plan’s layout under the doctrine, as a draft nothing uses, and links it', async () => {
    mockRunAiRequest.mockResolvedValueOnce(treeAnswer(LAYOUT_TREE))
    const outcome = await createAiJobLayoutStep()(context())
    expect(mockReadInventory).toHaveBeenCalledWith('org-1', 'host-1', { firestore })
    expect(outcome).toEqual({
      outputs: [
        {
          resource: 'layout',
          id: LAYOUT_ID,
          versionId: expect.any(String),
          hostId: 'host-1',
          hostSubdomain: 'acme',
          label: 'Main layout',
          load: expect.objectContaining({ pageBytes: 0, embeds: 0 }),
        },
      ],
      usage: USAGE,
      estCostUsd: 0.02,
      model: 'routed-model',
      stopReason: 'tool_use',
    })

    const [request] = mockRunAiRequest.mock.calls[0]
    expect(request).toMatchObject({
      model: 'routed-model',
      tools: [aiDoctrineTreeTool('layout'), aiInventoryLookupTool()],
      // The routing ceiling, as much of it as fits the step's least time on
      // the model the job runs.
      maxTokens: AI_JOB_LAYOUT_STEP_BUDGET.maxTokens('routed-model'),
      thinking: 'off',
      stream: false,
      messages: [{ role: 'user', content: aiJobLayoutPrompt(job(), PLAN, 'Main layout') }],
    })
    expect(request.system).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      AI_JOB_LAYOUT_INSTRUCTIONS[0],
      { text: AI_PALETTE_CATALOG.layout, cacheBreakpoint: true },
      expect.objectContaining({ volatile: true }),
    ])
    expect(() => validateAiSystemBlocks(request.system)).not.toThrow()

    const versionId = outcome.outputs[0].versionId
    expect([...commits].sort()).toEqual(
      [`hosts/host-1/layouts/${LAYOUT_ID}`, `hosts/host-1/layouts/${LAYOUT_ID}/versions/${versionId}`].sort(),
    )
    expect(mockDocs.get(`hosts/host-1/layouts/${LAYOUT_ID}`)).toMatchObject({
      displayName: 'Main layout',
      versionId,
      createdBy: 'uid-1',
    })
    expect(mockDocs.get(`hosts/host-1/layouts/${LAYOUT_ID}/versions/${versionId}`)).toMatchObject({
      layoutId: LAYOUT_ID,
      displayName: AI_DRAFT_VERSION_NAME,
    })
  })

  it('re-asks the live footer: a link drawn in the band’s own color, sent home for a purpose the site has no screen for, and lists the facts to fill (AGL-3056)', async () => {
    // The Harborline layout's footer: a primary band, the facts the brief never gave, and a consultation link with nowhere to go.
    const footer = (link: Record<string, unknown> | null) => ({
      rootId: 'root',
      nodes: {
        ...layoutNodesWithout('tagline'),
        footer: {
          componentId: 'section',
          props: { element: 'footer' },
          sx: { backgroundColor: 'primary.main', color: 'background.paper', py: 6 },
          nodes: ['address', 'phone', 'hours', ...(link ? ['consult'] : [])],
        },
        address: { componentId: 'muiTypography', props: { variant: 'body2', children: '[Office address]' } },
        phone: { componentId: 'muiTypography', props: { variant: 'body2', children: '[Office phone number]' } },
        hours: { componentId: 'muiTypography', props: { variant: 'body2', children: 'Open [Office hours]' } },
        ...(link ? { consult: { componentId: 'muiScreenLink', props: { children: 'Request a Consultation', ...link } } } : {}),
      },
    })
    mockRunAiRequest
      .mockResolvedValueOnce(treeAnswer(footer({ screenId: 'scr-home' })))
      .mockResolvedValueOnce(treeAnswer(footer(null)))
    const outcome = await createAiJobLayoutStep()(context())

    const reask = mockRunAiRequest.mock.calls[1][0].messages[2].content as string
    expect(reask).toContain(
      '- Rule 5 (Colors, spacing and type come from the theme): A link or button on a primary.main band draws its words in the theme\'s primary color, the band\'s own, so they cannot be read. Give it "color": "inherit" under a band whose sx color is primary.contrastText, or set its own sx color to primary.contrastText. (nodes consult)',
    )
    expect(reask).toContain(
      '- Rule 10 (Navigation and SEO travel with a page): "Request a Consultation" links the home page, which does not do what its words say. Link the page that does, or leave the link out when the site has none. (nodes consult)',
    )
    expect(outcome.review).toBeUndefined()
    expect(outcome.outputs).toEqual([
      expect.objectContaining({
        resource: 'layout',
        note: 'Before you publish, replace the facts in square brackets, which the brief did not give: [Office address], [Office phone number] and [Office hours].',
      }),
    ])
  })

  it('runs on the model the switch resolves for the job, and reports it', async () => {
    mockRunAiRequest.mockResolvedValueOnce(treeAnswer(LAYOUT_TREE))
    const modelFor = jest.fn((kind: string) => (kind === 'job.layout' ? 'picked-model' : undefined))
    const outcome = await createAiJobLayoutStep()({ ...context(), modelFor })
    expect(modelFor).toHaveBeenCalledWith('job.layout')
    expect(mockRunAiRequest.mock.calls[0][0].model).toBe('picked-model')
    expect(outcome.model).toBe('picked-model')
  })

  it('asks once more, then stops for review, when it rebuilds navigation the site keeps and skips what the plan reuses', async () => {
    mockReadInventory.mockResolvedValue(NAV_INVENTORY)
    const plan: AiJobPlan = {
      ...PLAN,
      reuse: [{ kind: 'component', id: 'cmp-nav', purpose: 'the header navigation' }],
      labels: { 'cmp-nav': 'Main navigation' },
    }
    mockRunAiRequest
      .mockResolvedValueOnce(treeAnswer(LAYOUT_TREE))
      .mockResolvedValueOnce(treeAnswer(LAYOUT_TREE))
    const outcome = await createAiJobLayoutStep()(context({ plan }))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const reask = mockRunAiRequest.mock.calls[1][0].messages[2].content as string
    expect(reask).toContain('Rule 7')
    expect(reask).toContain('Rule 1')
    // The offending links are named by the ids the model wrote.
    expect(reask).toContain('nodes home, about')
    expect(outcome.outputs).toEqual([])
    expect(outcome.usage.inputTokens).toBe(6_000)
    expect(outcome.estCostUsd).toBe(0.04)
    expect(outcome.review).toEqual({
      reason: 'doctrine',
      message: expect.stringContaining('Rule 7'),
      findings: [
        { rule: 7, code: 'plan-reuse-not-placed', message: expect.stringContaining('"Main navigation"') },
        {
          rule: 1,
          code: 'navigation-rebuilt',
          message: expect.stringContaining('"Main navigation"'),
          nodeIds: ['home', 'about'],
        },
      ],
      outline: ['home', 'about'].map((id) => ({
        id,
        depth: 0,
        componentId: 'muiScreenLink',
        props: ['screenId', 'children'],
        children: [],
      })),
    })
    expect(commits).toEqual([])
  })

  describe('a site scaffold’s layout, built before its pages (AGL-3596)', () => {
    /** The production plan: a layout of header, nav and footer, two pages it builds next. */
    const SITE_PLAN: AiJobPlan = {
      ...PLAN,
      create: [{ ...PLAN.create[0], name: 'Dog Grooming Layout', fields: ['header', 'nav', 'footer'] }],
    }
    const SITE_PAGES = [
      { id: 'pgHome01', label: 'Home', slug: '/' },
      { id: 'pgContact1', label: 'Contact', slug: 'contact' },
    ]
    /** What the model answered on 2026-10-06, twice: a nav region with nothing in it. */
    const EMPTY_NAV_TREE = {
      rootId: 'root',
      nodes: {
        root: { componentId: 'div', nodes: ['header', 'slot', 'footer'] },
        header: { componentId: 'muiAppBar', props: { position: 'static', color: 'default' }, nodes: ['bar'] },
        bar: { componentId: 'muiToolbar', nodes: ['brand', 'navRegion'] },
        brand: { componentId: 'muiTypography', props: { variant: 'h6', component: 'p', children: 'Hillside Dog Grooming' } },
        navRegion: { componentId: 'section', props: { element: 'nav', ariaLabel: 'Main navigation' } },
        slot: { componentId: 'layoutSlot' },
        footer: { componentId: 'section', props: { element: 'footer' }, nodes: ['tagline'] },
        tagline: { componentId: 'muiTypography', props: { variant: 'body2', children: 'Calm, gentle grooming in Hillside.' } },
      },
    }
    const siteLayoutJob = (inputs: Record<string, unknown>) => ({
      plan: SITE_PLAN,
      inputs: { originJobId: 'job-site', ...inputs },
    })
    const storedNodes = (id: string) => {
      const layout = mockDocs.get(`hosts/host-1/layouts/${id}`) as { versionId: string }
      const version = mockDocs.get(`hosts/host-1/layouts/${id}/versions/${layout.versionId}`) as { nodes: unknown }
      return decodeStoredNodes<Record<string, unknown>>(version.nodes as never)
    }

    it('writes the header’s links to the planned pages into the nav the model left empty, and keeps it', async () => {
      mockRunAiRequest.mockResolvedValue(treeAnswer(EMPTY_NAV_TREE))
      const outcome = await createAiJobLayoutStep()(context(siteLayoutJob({ sitePages: SITE_PAGES })))
      expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
      expect(outcome.review).toBeUndefined()
      expect(outcome.outputs).toHaveLength(1)
      const written = JSON.stringify(storedNodes(LAYOUT_ID))
      expect(written).toContain('pgHome01')
      expect(written).toContain('pgContact1')
      // The model is told the platform writes the navigation, and to leave nothing empty for it.
      const prompt = mockRunAiRequest.mock.calls[0][0].messages[0].content as string
      expect(prompt).toContain('Home (/), Contact (/contact)')
      expect(prompt).toContain('leave no empty element')
    })

    it('adds a nav row to the Toolbar Content when the model built none, so the plan’s nav region is built', async () => {
      const withoutNav = {
        ...EMPTY_NAV_TREE,
        nodes: {
          ...Object.fromEntries(Object.entries(EMPTY_NAV_TREE.nodes).filter(([id]) => id !== 'navRegion')),
          bar: { componentId: 'muiToolbar', nodes: ['brand'] },
        },
      }
      mockRunAiRequest.mockResolvedValue(treeAnswer(withoutNav))
      const outcome = await createAiJobLayoutStep()(context(siteLayoutJob({ sitePages: SITE_PAGES })))
      expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
      expect(outcome.review).toBeUndefined()
      expect(JSON.stringify(storedNodes(LAYOUT_ID))).toContain('pgContact1')
    })

    it('still refuses an empty nav in a layout no scaffold fills: rule 16 is not relaxed', async () => {
      mockRunAiRequest.mockResolvedValue(treeAnswer(EMPTY_NAV_TREE))
      const outcome = await createAiJobLayoutStep()(context({ plan: SITE_PLAN }))
      expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
      expect(outcome.review).toMatchObject({
        reason: 'doctrine',
        findings: [expect.objectContaining({ rule: 16, code: 'empty-container', nodeIds: ['navRegion'] })],
      })
    })
  })

  it('keeps a layout that places the site’s navigation component in its header', async () => {
    mockReadInventory.mockResolvedValue(NAV_INVENTORY)
    mockRunAiRequest.mockResolvedValueOnce(treeAnswer(NAV_TREE))
    const outcome = await createAiJobLayoutStep()(context())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(outcome.review).toBeUndefined()
    expect(outcome.outputs).toHaveLength(1)
  })

  it('reports a declined brief as refused, and writes nothing', async () => {
    mockRunAiRequest.mockResolvedValueOnce({
      kind: 'refusal',
      text: '',
      usage: USAGE,
      estCostUsd: 0.001,
      stopReason: 'refusal',
    })
    const outcome = await createAiJobLayoutStep()(context())
    expect(outcome).toMatchObject({ refused: true, outputs: [], estCostUsd: 0.001 })
    expect(commits).toEqual([])
  })

  it('stops for the member, spending nothing, when the site has no shared layout to spare', async () => {
    mockDocs.set('orgs/org-1', FREE_ORG)
    mockDocs.set('hosts/host-1/layouts/lay-a', { displayName: 'A' })
    const outcome = await createAiJobLayoutStep()(context())
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      outputs: [],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
      model: 'routed-model',
      stopReason: null,
      review: { reason: 'limit', message: LIMIT, findings: [] },
    })
  })

  it('stops for the member, with its spend recorded, when the last layout was taken while it generated', async () => {
    mockDocs.set('orgs/org-1', FREE_ORG)
    mockRunAiRequest.mockImplementationOnce(async () => {
      mockDocs.set('hosts/host-1/layouts/lay-meanwhile', { displayName: 'Made meanwhile' })
      return treeAnswer(LAYOUT_TREE)
    })
    const outcome = await createAiJobLayoutStep()(context())
    expect(outcome).toMatchObject({
      outputs: [],
      usage: USAGE,
      estCostUsd: 0.02,
      review: { reason: 'limit', message: LIMIT },
    })
    expect(commits).toEqual([])
  })

  it('reports the draft an earlier run wrote, without asking the model again', async () => {
    mockRunAiRequest.mockResolvedValueOnce(treeAnswer(LAYOUT_TREE))
    const first = await createAiJobLayoutStep()(context())
    const again = await createAiJobLayoutStep()(context())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(again.outputs).toEqual([
      {
        resource: 'layout',
        id: LAYOUT_ID,
        versionId: first.outputs[0].versionId,
        hostId: 'host-1',
        hostSubdomain: 'acme',
        label: 'Main layout',
      },
    ])
    expect(again).toMatchObject({ usage: AI_JOB_ZERO_USAGE, estCostUsd: 0 })
    expect(commits).toHaveLength(2)
  })

  it('names a job whose step records no id by the job itself, and finds that draft again (AGL-3079)', async () => {
    const unrecorded = { steps: [{ name: 'generate', status: 'running' as const, creditsSpent: 0 }] }
    mockRunAiRequest.mockResolvedValueOnce(treeAnswer(LAYOUT_TREE))
    const first = await createAiJobLayoutStep()(context(unrecorded))
    const again = await createAiJobLayoutStep()(context(unrecorded))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect([first.outputs[0].id, again.outputs[0].id]).toEqual(['job-1', 'job-1'])
    expect(mockDocs.has('hosts/host-1/layouts/job-1')).toBe(true)
    expect(mockDocs.has(`hosts/host-1/layouts/${LAYOUT_ID}`)).toBe(false)
  })

  describe('a plan that starts from a copy', () => {
    const inventory: AiSiteInventory = {
      ...INVENTORY,
      layouts: [{ id: 'lay-site', name: 'Site layout', parentId: null }],
    }
    const plan: AiJobPlan = { ...PLAN, create: [{ ...PLAN.create[0], duplicateOf: 'lay-site' }] }

    it('copies the layout it starts from through the duplicate module, and generates nothing', async () => {
      mockReadInventory.mockResolvedValue(inventory)
      const duplicate = jest
        .fn()
        .mockResolvedValue({ ok: true, id: 'lay-copy', versionId: 'v-copy', name: 'Main layout' })
      const outcome = await createAiJobLayoutStep({
        duplicate: duplicate as unknown as typeof duplicateResource,
      })(context({ plan }))
      expect(duplicate).toHaveBeenCalledWith('layout', {
        orgId: 'org-1',
        hostId: 'host-1',
        sourceId: 'lay-site',
        name: 'Main layout',
        uid: 'uid-1',
        org: STARTER_ORG,
        // The claim that makes a second pass replay this copy (AGL-3024).
        attemptKey: LAYOUT_ID,
      })
      expect(mockRunAiRequest).not.toHaveBeenCalled()
      expect(outcome).toEqual({
        outputs: [
          {
            resource: 'layout',
            id: 'lay-copy',
            versionId: 'v-copy',
            hostId: 'host-1',
            hostSubdomain: 'acme',
            label: 'Main layout',
          },
        ],
        usage: AI_JOB_ZERO_USAGE,
        estCostUsd: 0,
        model: 'routed-model',
        stopReason: null,
      })
    })

    // The measured shape on beta.139: a plan reading "from a copy of the base
    // layout, adding a sidebar region" got the base layout, "sidebar" nowhere
    // in it, and the job reported Done. This branch generates nothing, so the
    // copy itself is what answers for the plan (AGL-3024).
    describe('a copy against the regions the plan gives the layout (AGL-3024)', () => {
      const withSidebar: AiJobPlan = {
        ...plan,
        create: [{ ...plan.create[0], fields: ['header', 'sidebar', 'main', 'footer'] }],
      }
      const duplicateInto = (nodes: Record<string, unknown>) => {
        mockDocs.set('hosts/host-1/layouts/lay-copy', { displayName: 'Main layout', versionId: 'v-copy' })
        mockDocs.set('hosts/host-1/layouts/lay-copy/versions/v-copy', { nodes })
        return jest
          .fn()
          .mockResolvedValue({ ok: true, id: 'lay-copy', versionId: 'v-copy', name: 'Main layout' })
      }
      /** The base layout's shape: an App Bar, the slot, a footer — and no aside. */
      const BASE = {
        [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: ['bar', 'slot', 'foot'] },
        bar: { componentId: 'muiAppBar', nodes: [] },
        slot: { componentId: 'layoutSlot' },
        foot: { componentId: 'section', props: { element: 'footer' }, nodes: [] },
      }

      it('stops for a person rather than reporting a copy that lacks a region the plan named', async () => {
        mockReadInventory.mockResolvedValue(inventory)
        const outcome = await createAiJobLayoutStep({
          duplicate: duplicateInto(BASE) as unknown as typeof duplicateResource,
        })(context({ plan: withSidebar }))
        expect(mockRunAiRequest).not.toHaveBeenCalled()
        expect(outcome.outputs).toEqual([])
        expect(outcome.review?.reason).toBe('doctrine')
        expect(outcome.review?.findings.map((finding) => finding.code)).toEqual(['plan-region-missing'])
        expect(outcome.review?.message).toContain('"sidebar"')
      })

      it('reports the copy once it carries every region the plan named', async () => {
        mockReadInventory.mockResolvedValue(inventory)
        const outcome = await createAiJobLayoutStep({
          duplicate: duplicateInto({
            ...BASE,
            [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: ['bar', 'rail', 'slot', 'foot'] },
            rail: { componentId: 'section', props: { element: 'aside' }, nodes: [] },
          }) as unknown as typeof duplicateResource,
        })(context({ plan: withSidebar }))
        expect(outcome.review).toBeUndefined()
        expect(outcome.outputs).toEqual([expect.objectContaining({ resource: 'layout', id: 'lay-copy' })])
      })

      it('stops for a person when the copy cannot be read back at all', async () => {
        mockReadInventory.mockResolvedValue(inventory)
        const duplicate = jest
          .fn()
          .mockResolvedValue({ ok: true, id: 'lay-vanished', versionId: 'v-copy', name: 'Main layout' })
        const outcome = await createAiJobLayoutStep({
          duplicate: duplicate as unknown as typeof duplicateResource,
        })(context({ plan: withSidebar }))
        expect(outcome.outputs).toEqual([])
        expect(outcome.review).toEqual({
          reason: 'doctrine',
          message:
            '"Main layout" was copied from the layout the plan names, and this job could not read the copy back to check it has the regions the plan gives it. Open the layout and check it before you put a page in it.',
          findings: [],
        })
      })
    })

    // The measured shape on 2026-09-22 (job Pq3pgvMH0D): a plan to copy the
    // interior layout and add a nav and a sidebar could only end in review,
    // because the copy branch generates nothing (AGL-3143 §14).
    describe('a source that cannot keep the plan (AGL-3143 §14)', () => {
      /** `harborline-interior-layout` (3iYZisdPyW) as stored, its links pointed at this site's pages. */
      const INTERIOR = {
        [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: ['bar', 'slot', 'foot'] },
        bar: { componentId: 'muiAppBar', props: { position: 'sticky', color: 'default' }, nodes: ['tools'] },
        tools: { componentId: 'muiToolbar', nodes: ['brand', 'links'] },
        brand: { componentId: 'muiTypography', props: { children: 'Harborline Law', variant: 'h6', component: 'div' } },
        links: { componentId: 'muiStack', props: { direction: 'row', alignItems: 'center' }, nodes: ['home'] },
        home: { componentId: 'muiScreenLink', props: { children: 'Home', screenId: 'scr-home', renderAs: 'link' } },
        slot: { componentId: 'layoutSlot', props: { component: 'main' } },
        foot: { componentId: 'section', props: { element: 'footer' }, nodes: ['frame'] },
        frame: { componentId: 'muiContainer', props: { maxWidth: 'lg' }, nodes: ['column'] },
        column: { componentId: 'muiStack', props: { direction: 'column' }, nodes: ['firm', 'hours'] },
        firm: { componentId: 'muiTypography', props: { children: 'Harborline Law', variant: 'h6', component: 'p' } },
        hours: { componentId: 'muiTypography', props: { children: '[Office hours]', variant: 'body2', component: 'p' } },
      }
      /** The same layout with the nav and the sidebar the plan adds. */
      const BUILT = {
        rootId: 'root',
        nodes: {
          root: { componentId: 'div', nodes: ['bar', 'slot', 'rail', 'foot'] },
          bar: { componentId: 'muiAppBar', props: { position: 'sticky', color: 'default' }, nodes: ['tools'] },
          tools: { componentId: 'muiToolbar', nodes: ['brand', 'nav'] },
          brand: { componentId: 'muiTypography', props: { children: 'Harborline Law', variant: 'h6', component: 'p' } },
          nav: { componentId: 'section', props: { element: 'nav', ariaLabel: 'Main' }, nodes: ['home', 'about'] },
          home: { componentId: 'muiScreenLink', props: { children: 'Home', screenId: 'scr-home' } },
          about: { componentId: 'muiScreenLink', props: { children: 'About', screenId: 'scr-about' } },
          slot: { componentId: 'layoutSlot', props: { component: 'main' } },
          rail: { componentId: 'section', props: { element: 'aside', ariaLabel: 'Related reading' }, nodes: ['related'] },
          related: { componentId: 'muiTypography', props: { children: 'Related reading', variant: 'body2' } },
          foot: { componentId: 'section', props: { element: 'footer' }, nodes: ['firm', 'hours'] },
          firm: { componentId: 'muiTypography', props: { children: 'Harborline Law', variant: 'body2' } },
          hours: { componentId: 'muiTypography', props: { children: '[Office hours]', variant: 'body2' } },
        },
      }
      const withNavAndSidebar: AiJobPlan = {
        ...plan,
        create: [{ ...plan.create[0], fields: ['header', 'nav', 'main', 'sidebar', 'footer'] }],
      }
      const storeSource = (nodes: Record<string, unknown>) => {
        mockDocs.set('hosts/host-1/layouts/lay-site', { displayName: 'Site layout', versionId: 'v-site' })
        mockDocs.set('hosts/host-1/layouts/lay-site/versions/v-site', { nodes })
      }

      it('builds from the source rather than copy it into a certain refusal', async () => {
        mockReadInventory.mockResolvedValue(inventory)
        mockDocs.set('orgs/org-1', { plan: 'pro', billingStatus: 'active' })
        storeSource(INTERIOR)
        const duplicate = jest.fn()
        mockRunAiRequest.mockResolvedValueOnce(treeAnswer(BUILT))
        const outcome = await createAiJobLayoutStep({
          duplicate: duplicate as unknown as typeof duplicateResource,
        })(context({ plan: withNavAndSidebar }))
        // Before, this copied the source and stopped for review with
        // plan-region-missing, every time, with nothing a member could do.
        expect(duplicate).not.toHaveBeenCalled()
        expect(outcome.review).toBeUndefined()
        expect(outcome.outputs).toEqual([expect.objectContaining({ resource: 'layout', id: LAYOUT_ID })])
        // The build is shown the source, so the firm's header and footer carry over.
        const [request] = mockRunAiRequest.mock.calls[0]
        const content = String(request.messages[0].content)
        expect(content).toContain('The plan starts from a copy of the layout "Site layout"')
        expect(content).toContain('"[Office hours]"')
      })

      it('still copies a source that keeps the plan, spending nothing', async () => {
        mockReadInventory.mockResolvedValue(inventory)
        storeSource({
          ...INTERIOR,
          [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: ['bar', 'slot', 'rail', 'foot'] },
          links: { componentId: 'section', props: { element: 'nav' }, nodes: ['home'] },
          rail: { componentId: 'section', props: { element: 'aside' }, nodes: [] },
        })
        const duplicate = jest.fn().mockResolvedValue({ ok: false, status: 403, error: LIMIT })
        await createAiJobLayoutStep({
          duplicate: duplicate as unknown as typeof duplicateResource,
        })(context({ plan: withNavAndSidebar }))
        expect(duplicate).toHaveBeenCalledTimes(1)
        expect(mockRunAiRequest).not.toHaveBeenCalled()
      })
    })

    it('stops for the member when the copy meets the band, and builds from the brief when the source is gone', async () => {
      mockReadInventory.mockResolvedValue(inventory)
      const refused = jest.fn().mockResolvedValue({ ok: false, status: 403, error: LIMIT })
      const stopped = await createAiJobLayoutStep({
        duplicate: refused as unknown as typeof duplicateResource,
      })(context({ plan }))
      expect(stopped.review).toEqual({ reason: 'limit', message: LIMIT, findings: [] })
      expect(mockRunAiRequest).not.toHaveBeenCalled()

      const gone = jest.fn().mockResolvedValue({ ok: false, status: 404, error: 'Unknown layout' })
      mockRunAiRequest.mockResolvedValueOnce(treeAnswer(LAYOUT_TREE))
      const built = await createAiJobLayoutStep({
        duplicate: gone as unknown as typeof duplicateResource,
      })(context({ plan }))
      expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
      expect(built.outputs).toEqual([expect.objectContaining({ resource: 'layout', id: LAYOUT_ID })])
    })
  })
})

describe('aiCopySourceLines (AGL-3143 §14)', () => {
  it('shows a short source whole, and nothing it cannot show whole', () => {
    const root = { [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: ['slot'], hidden: false }, slot: { componentId: 'layoutSlot' } }
    const [line, tree] = aiCopySourceLines('layout', 'Base', root)
    expect(line).toContain('copy of the layout "Base"')
    // Only what the tool takes: the stored node's other keys are not the model's.
    expect(JSON.parse(tree)).toEqual({
      rootId: CANVAS_ROOT_ELEMENT_ID,
      nodes: { [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: ['slot'] }, slot: { componentId: 'layoutSlot' } },
    })
    expect(aiCopySourceLines('layout', 'Base', null)).toEqual([])
    expect(aiCopySourceLines('layout', 'Base', { slot: { componentId: 'layoutSlot' } })).toEqual([])
    const big = { ...root, note: { componentId: 'muiTypography', props: { children: 'x'.repeat(AI_COPY_SOURCE_MAX_CHARS) } } }
    expect(aiCopySourceLines('layout', 'Base', big)).toEqual([])
  })
})

describe('aiJobLayoutPrompt', () => {
  it('names the layout, states the brief, and gives the confirmed plan as references', () => {
    const plan: AiJobPlan = {
      ...PLAN,
      reuse: [{ kind: 'component', id: 'cmp-nav', purpose: 'the header navigation' }],
      labels: { 'cmp-nav': 'Main navigation' },
    }
    expect(aiJobLayoutPrompt(job(), plan, 'Main layout')).toBe(
      [
        'Layout name: Main layout',
        'Brief: A header with Home and About, and a footer with our tagline.',
        'Confirmed plan:',
        '- reuse the component cmp-nav ("Main navigation"): the header navigation',
        '- create the layout "Main layout": The site has no layout yet.',
      ].join('\n'),
    )
    expect(aiJobLayoutPrompt(job(), null, 'Site layout')).toBe(
      'Layout name: Site layout\nBrief: A header with Home and About, and a footer with our tagline.',
    )
  })
})
