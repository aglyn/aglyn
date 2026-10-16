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
 * The `page-meet-the-crew` golden case, replayed through the REAL page step
 * (AGL-3827): plan, section passes, section check, doctrine, settle, draft
 * writer and the last pass. Only the provider is faked. The live golden check
 * of 2026-10-15 built this page with its testimonials' quote and name left as
 * `{{1}}` and `{{2}}`; its customer-words pass answers here with the shape it
 * recorded (`controls[0]` of the case), and the saved page never shows one.
 *
 *  - The recorded shape is refused, the re-ask names the placeholders, and the
 *    page stores the answer to the re-ask.
 *  - A third testimonial that shows only placeholders, beside the two real
 *    ones, is taken out in code, with no re-ask and nothing invented.
 *  - A listing the SEO step writes with a placeholder keeps the plan's.
 *
 * No live model call: every answer is the case's own or derived from it.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import { readAiEvalCase } from '../runtime/ai-eval'
import type { generateSeoFields } from '../runtime/seo-fields'
import { aiPageCheckContext } from './ai-job-page-sections'
import { createAiJobPageStep } from './ai-job-page-step'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const CASE_FILE = 'tools/ai-eval/cases/page/meet-the-crew.json'
const crew = readAiEvalCase(JSON.parse(readFileSync(join(REPO_ROOT, CASE_FILE), 'utf8')), CASE_FILE)
const inventory = crew.inventory as AiSiteInventory
const NOW = new Date('2026-10-15T22:00:00.000Z')
const HOST = inventory.hostId
const SCREEN_ID = 'crewPage001'
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

type RawNode = { componentId: string; props?: Record<string, unknown>; nodes?: string[] }
type RawTree = { rootId: string; nodes: Record<string, RawNode> }

/** The authored answer's page, and the shape the live check recorded. */
const authored = (crew.candidates[0].answer as { tree: RawTree }).tree
const recorded = (crew.controls[0].answer as { tree: RawTree }).tree

/** One section of a page tree as a pass answers it: the document wrapper holding that section. */
function sectionAnswer(page: RawTree, sectionId: string): RawTree {
  const nodes: Record<string, RawNode> = { root: { componentId: 'div', nodes: [sectionId] } }
  const stack = [sectionId]
  while (stack.length) {
    const id = stack.pop() as string
    nodes[id] = page.nodes[id]
    stack.push(...(page.nodes[id].nodes ?? []))
  }
  return { rootId: 'root', nodes }
}

/** A provider answer carrying one section. */
const submitted = (answer: RawTree) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: 'submit_section', input: { tree: JSON.stringify(answer) } }],
  usage: ZERO_USAGE,
  estCostUsd: 0,
  stopReason: 'tool_use',
})

// ── Firestore double, as the page evals keep it ──────────────────────────

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined),
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

function setAt(data: Record<string, unknown>, dotted: string, value: unknown) {
  const keys = dotted.split('.')
  let cursor = data
  for (const key of keys.slice(0, -1)) {
    cursor[key] = { ...((cursor[key] as Record<string, unknown>) ?? {}) }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = []
    const result = await fn({
      get: async (target: DocTarget | QueryTarget) => (target.kind === 'query' ? target.get() : snapshotOf(target.path)),
      create: (ref: DocTarget, data: Record<string, unknown>) =>
        writes.push(() => {
          if (mockDocs.has(ref.path)) throw new Error(`6 ALREADY_EXISTS: ${ref.path}`)
          mockDocs.set(ref.path, data)
        }),
      update: (ref: DocTarget, patch: Record<string, unknown>) =>
        writes.push(() => {
          const next = { ...(mockDocs.get(ref.path) ?? {}) }
          for (const [key, value] of Object.entries(patch)) setAt(next, key, value)
          mockDocs.set(ref.path, next)
        }),
    })
    for (const write of writes) write()
    return result
  },
} as unknown as FirebaseFirestore.Firestore

// ── The replay ───────────────────────────────────────────────────────────

interface Replay {
  /** Each section pass's provider requests, in order. */
  requests: Array<{ messages: Array<{ role: string; content: unknown }> }[]>
  outcome: Awaited<ReturnType<ReturnType<typeof createAiJobPageStep>>>
  screen: Record<string, unknown>
  page: Record<string, RawNode>
}

/**
 * Every pass of the case's page job: each section pass answered by the
 * provider answers given for it, in order, then the last pass, whose listing
 * the SEO step answers with `seo`.
 */
async function replay(passes: RawTree[][], seo: { title: string; description: string }): Promise<Replay> {
  mockDocs.clear()
  mockOwners.clear()
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(inventory)
  mockOwners.set(HOST, 'org-1')
  mockDocs.set(`hosts/${HOST}`, {
    subdomain: 'harbor',
    displayName: 'Harbor Roofing',
    screens: Object.fromEntries(inventory.screens.map((row) => [row.id, row.slug])),
  })
  mockDocs.set('orgs/org-1', STARTER_ORG)
  const seoFields = jest.fn(async () => ({
    status: 'ok' as const,
    value: seo,
    attempts: 1,
    usage: ZERO_USAGE,
    estCostUsd: 0,
    model: 'seo-model',
    stopReason: 'tool_use',
  }))
  const step = createAiJobPageStep({ seoFields: seoFields as unknown as typeof generateSeoFields })
  const confirmed = crew.candidates[0].plan as AiBuildPlan
  const plan: AiJobPlan = {
    ...confirmed,
    status: 'confirmed',
    labels: Object.fromEntries(
      [...inventory.components, ...inventory.layouts, ...inventory.forms, ...inventory.screens].map((row) => [row.id, row.name]),
    ),
    proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
    confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
    confirmedBy: 'uid-1',
  }
  const job = {
    $id: 'job-meet-the-crew',
    orgId: 'org-1',
    hostId: HOST,
    kind: 'page',
    status: 'running',
    brief: crew.brief,
    inputs: { pageType: 'about' },
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 0 },
      { name: 'generate', status: 'running', creditsSpent: 0, draftIds: { screen: SCREEN_ID } },
    ],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan,
    review: null,
  } as unknown as AiJob
  const run = () => step({ job, stepIndex: 1, now: NOW, firestore })

  const requests: Replay['requests'] = []
  for (const [pass, answers] of passes.entries()) {
    const before = mockRunAiRequest.mock.calls.length
    for (const answer of answers) mockRunAiRequest.mockResolvedValueOnce(submitted(answer))
    const outcome = await run()
    expect([`pass ${pass + 1}`, outcome.continue, outcome.review, outcome.failure]).toEqual([
      `pass ${pass + 1}`,
      true,
      undefined,
      undefined,
    ])
    requests.push(mockRunAiRequest.mock.calls.slice(before).map(([request]) => request))
  }
  const outcome = await run()
  const screen = mockDocs.get(`hosts/${HOST}/screens/${SCREEN_ID}`) ?? {}
  const version = mockDocs.get(`hosts/${HOST}/screens/${SCREEN_ID}/versions/${screen['versionId']}`)
  return { requests, outcome, screen, page: (decodeStoredNodes(version?.['nodes']) ?? {}) as Record<string, RawNode> }
}

const LISTING = {
  title: 'Meet the Harbor Roofing crew',
  description: 'The roofers behind Harbor Roofing: who they are, how long they have worked in Harbor County, and what customers say.',
}

/** The stored page holds every rule and shows no placeholder. */
function expectCleanPage(page: Record<string, RawNode>): void {
  expect(JSON.stringify(page)).not.toMatch(/\{\{|\[\[/)
  const report = validateAiDoctrineTree(
    { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: page as never },
    'page',
    aiPageCheckContext(inventory),
  )
  expect(report.violations).toEqual([])
}

/** The testimonials the stored page places, as their quote and name. */
function storedQuotes(page: Record<string, RawNode>): Array<Record<string, unknown>> {
  return Object.values(page)
    .filter((node) => node.componentId === 'reusableInstance')
    .map((node) => node.props?.['propValues'] as Record<string, unknown>)
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('page-meet-the-crew, replayed through the page step (AGL-3827)', () => {
  const intro = sectionAnswer(authored, 'intro')
  const promise = sectionAnswer(authored, 'promise')
  const words = sectionAnswer(authored, 'words')

  it('refuses the recorded {{1}}/{{2}} testimonials into the re-ask, and stores the answer to it', async () => {
    const live = sectionAnswer(recorded, 'words')
    expect(JSON.stringify(live)).toContain('"quote":"{{1}}"')
    const result = await replay([[intro], [promise], [live, words]], LISTING)

    // The customer-words pass asked twice; the re-ask names what was refused.
    expect(result.requests.map((pass) => pass.length)).toEqual([1, 1, 2])
    const reask = JSON.stringify(result.requests[2][1].messages)
    expect(reask).toContain('uses {{1}} and {{2}} and sits in no item with')

    expect(result.outcome.review).toBeUndefined()
    expect(result.outcome.failure).toBeUndefined()
    expect(storedQuotes(result.page)).toEqual([
      { quote: 'They found the leak two other companies missed.', name: 'Dana, Harbor Point' },
      { quote: 'On time, tidy, and the photos made the invoice easy to trust.', name: 'Luis, Old Mill Road' },
    ])
    expectCleanPage(result.page)
    expect(result.screen['seo']).toEqual(LISTING)
  })

  it('takes out a third testimonial of only placeholders beside the two real ones, with no re-ask', async () => {
    const three = structuredClone(words)
    three.nodes['words-row'].nodes = ['cell-dana', 'cell-luis', 'cell-next']
    three.nodes['cell-next'] = { componentId: 'muiGrid', props: { size: 'xs:12 md:6' }, nodes: ['quote-next'] }
    three.nodes['quote-next'] = {
      componentId: 'reusableInstance',
      props: { refId: 'cmp-testimonial', propValues: { quote: '[[Customer quote]]', name: '<Your name>' } },
    }
    const result = await replay([[intro], [promise], [three]], LISTING)

    expect(result.requests.map((pass) => pass.length)).toEqual([1, 1, 1])
    expect(result.outcome.review).toBeUndefined()
    expect(storedQuotes(result.page)).toHaveLength(2)
    expectCleanPage(result.page)
  })

  it('keeps the plan’s listing where the written one shows a placeholder', async () => {
    const result = await replay([[intro], [promise], [words]], {
      title: 'Meet {{1}} | Harbor Roofing',
      description: 'The roofers behind <Your business name>.',
    })
    expect(result.screen['seo']).toEqual({ title: LISTING.title, description: LISTING.description })
  })
})
