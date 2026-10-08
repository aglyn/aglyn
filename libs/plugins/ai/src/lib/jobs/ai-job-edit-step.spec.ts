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
 * The edit step (AGL-3616). Its promises, each held against what the
 * provider would receive and what the store holds after:
 *
 *  - A change lands where no visitor sees it: a new version beside the one
 *    it started from on a plan with version history, which becomes the
 *    page's current version only when the page is not published; in place
 *    only on a version no visitor reaches, without it. Anything else is a
 *    plan limit, refused before anything is spent.
 *  - The model is shown the stored document as the edit rung's outline and
 *    answers through the rung's tool; an answer naming what is not there is
 *    re-asked, and what survives lands through the canvas's own guards.
 *  - What a job cannot save — a published page's search fields — is left
 *    out and named.
 *  - One version per job: a run asked again spends nothing.
 */

const mockRunAiRequest = jest.fn()
const mockOwners = new Map<string, string>()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AiJob } from '../model/ai-jobs.types'
import {
  AI_EDIT_EMAIL_COPY,
  AI_EDIT_GONE_COPY,
  AI_EDIT_NEEDS_VERSIONING_COPY,
  AI_EDIT_NO_SITE_COPY,
  AI_EDIT_NOTHING_COPY,
  AI_EDIT_SEO_LEFT_OUT,
  AI_EDIT_STALE_COPY,
  AI_EDIT_TARGET_KIND_COPY,
  AI_EDIT_TARGET_REQUIRED_COPY,
  AI_EDIT_VERSION_ID_COPY,
  aiEditJobOutline,
  aiEditVersionName,
  parseAiEditJobInputs,
} from '../model/ai-edit-job'
import { ASSIST_EDIT_CONTEXT_MAX_NODES, ASSIST_EDIT_TOOL_NAME } from '../model/assist-edit'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE } from '../providers/routing'
import { ASSIST_EDIT_MAX_OUTPUT_TOKENS } from '../server/assist-edit'
import { AI_JOB_INLINE_BUDGET_MS, aiGenerationWorstCaseOnTierMs } from './ai-job-budget'
import {
  AI_EDIT_READS_MS,
  AI_JOB_EDIT_RULES,
  AI_JOB_EDIT_STEP_BUDGET,
  AI_JOB_EDIT_STEP_MINIMUM_MS,
  aiEditJobAdmission,
  aiEditPlacement,
  aiJobEditModel,
  createAiEditJobAdmission,
  createAiJobEditStep,
  registerAiEditJob,
  runAiJobEditStep,
} from './ai-job-edit-step'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import { registerAiJobStep } from './ai-jobs'
import { registerAiJobAdmission, aiJobAdmissionFor } from './ai-job-admission'

const NOW = new Date('2026-10-07T20:00:00.000Z')
const USAGE = { inputTokens: 2_400, outputTokens: 700, cacheReadTokens: 5_970, cacheWriteTokens: 0 }
const PRO = { plan: 'pro', billingStatus: 'active' }
const STARTER = { plan: 'starter', billingStatus: 'active' }

// ── A store the step's reads and its transaction run against ─────────────

const docs = new Map<string, Record<string, unknown>>()

function fieldOf(data: Record<string, unknown> | undefined, field: string): unknown {
  return field.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), data)
}

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').at(-1) as string,
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => fieldOf(data, field),
  }
}

function refOf(path: string): any {
  return {
    path,
    id: path.split('/').at(-1),
    get: async () => snapshotOf(path),
    collection: (name: string) => collectionOf(`${path}/${name}`),
  }
}

function collectionOf(path: string) {
  return { doc: (id: string) => refOf(`${path}/${id}`) }
}

function patched(data: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data }
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.')
    let at: Record<string, unknown> = next
    parts.slice(0, -1).forEach((part) => {
      at[part] = { ...((at[part] as Record<string, unknown>) ?? {}) }
      at = at[part] as Record<string, unknown>
    })
    at[parts.at(-1) as string] = value
  }
  return next
}

const firestore = {
  collection: (name: string) => collectionOf(name),
  runTransaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = []
    const tx = {
      get: async (ref: { path: string }) => snapshotOf(ref.path),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        if (docs.has(ref.path)) throw new Error(`ALREADY_EXISTS ${ref.path}`)
        writes.push(() => docs.set(ref.path, data))
      },
      update: (ref: { path: string }, patch: Record<string, unknown>) => {
        const current = docs.get(ref.path)
        if (!current) throw new Error(`NOT_FOUND ${ref.path}`)
        writes.push(() => docs.set(ref.path, patched(docs.get(ref.path) as Record<string, unknown>, patch)))
      },
    }
    const result = await run(tx)
    for (const write of writes) write()
    return result
  },
} as unknown as FirebaseFirestore.Firestore

// ── The site ──────────────────────────────────────────────────────────────

const ROOT = CANVAS_ROOT_ELEMENT_ID

const PAGE_NODES = {
  [ROOT]: { $id: ROOT, componentId: 'div', parentId: ROOT, props: {}, nodes: ['hero', 'services'] },
  hero: { $id: 'hero', componentId: 'section', parentId: ROOT, name: 'Hero', props: { element: 'section' }, sx: { py: 16 }, nodes: ['heroStack'] },
  heroStack: { $id: 'heroStack', componentId: 'muiStack', parentId: 'hero', props: { spacing: 3 }, nodes: ['heroTitle', 'heroCta'] },
  heroTitle: {
    $id: 'heroTitle',
    componentId: 'muiTypography',
    parentId: 'heroStack',
    props: { variant: 'h1', children: 'Brightside Plumbing: friendly, fast, fairly priced plumbing repairs for every home in the valley' },
    nodes: [],
  },
  heroCta: { $id: 'heroCta', componentId: 'muiButton', parentId: 'heroStack', props: { children: 'Book a visit' }, nodes: [] },
  services: { $id: 'services', componentId: 'section', parentId: ROOT, props: { element: 'section' }, nodes: ['servicesTitle'] },
  servicesTitle: { $id: 'servicesTitle', componentId: 'muiTypography', parentId: 'services', props: { variant: 'h2', children: 'What we fix' }, nodes: [] },
}

const packed = (nodes: Record<string, unknown>) => Buffer.from(encodeStoredNodes(nodes) as Uint8Array)
const stored = (path: string) => decodeStoredNodes<Record<string, Record<string, any>>>(docs.get(path)?.['nodes']) as Record<string, Record<string, any>>

const HOST = 'hosts/host-1'
const SCREEN = `${HOST}/screens/home`
const LAYOUT = `${HOST}/layouts/frame`

function seed(options: { routed?: boolean; layout?: boolean } = {}) {
  docs.set(HOST, { orgId: 'org-1', subdomain: 'brightside', screens: options.routed === false ? {} : { home: '/' } })
  docs.set(SCREEN, { displayName: 'Home', versionId: 'v-live', slug: '/' })
  docs.set(`${SCREEN}/versions/v-live`, {
    screenId: 'home',
    hostId: 'host-1',
    displayName: 'Initial version',
    layoutId: 'frame',
    nodes: packed(PAGE_NODES),
    createdBy: 'uid-0',
  })
  docs.set(`${SCREEN}/versions/v-older`, {
    screenId: 'home',
    hostId: 'host-1',
    displayName: 'An older try',
    nodes: packed(PAGE_NODES),
  })
  if (options.layout) {
    docs.set(LAYOUT, { displayName: 'Site frame', versionId: 'lv-live' })
    docs.set(`${LAYOUT}/versions/lv-live`, { layoutId: 'frame', hostId: 'host-1', displayName: 'Initial version', nodes: packed(PAGE_NODES) })
  }
}

// ── The model's answers ───────────────────────────────────────────────────

const BLANK = { parentId: '', index: -1, props: [], sx: [], nodes: [], name: '', seo: [], interaction: { event: '', everyTime: false, steps: [] } }
const SHORTER_TITLE = { ...BLANK, op: 'updateProps', nodeId: 'heroTitle', props: [{ name: 'children', value: 'Friendly, fast plumbing for the valley' }] }
const LESS_PADDING = { ...BLANK, op: 'updateSx', nodeId: 'hero', sx: [{ key: 'py', value: '8', breakpoint: '' }] }
const SEO = { ...BLANK, op: 'setSeo', seo: [{ field: 'title', value: 'Brightside Plumbing — fast, friendly plumbers' }] }
const UNKNOWN = { ...BLANK, op: 'updateProps', nodeId: 'heroHeadline', props: [{ name: 'children', value: 'Hi' }] }
const ANSWER = { summary: 'Shorter hero headline and less padding', ops: [SHORTER_TITLE, LESS_PADDING] }

function completion(input: unknown) {
  return { kind: 'completion', text: '', toolUse: [{ name: ASSIST_EDIT_TOOL_NAME, input }], usage: USAGE, estCostUsd: 0.03, stopReason: 'tool_use' }
}

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'edit',
    status: 'running',
    brief: "Make the home page's hero shorter.",
    inputs: { target: 'home' },
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 20,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: null,
    review: null,
    ...patch,
  } as AiJob
}

const runStep = (patch: Partial<AiJob> = {}, org: object = PRO) =>
  createAiJobEditStep()({ job: job(patch), stepIndex: 0, now: NOW, firestore, org } as never)

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockOwners.clear()
  docs.clear()
  mockOwners.set('host-1', 'org-1')
})

// ── The model ─────────────────────────────────────────────────────────────

describe('the inputs', () => {
  it('reads a target, a kind and a version, and names what is wrong', () => {
    expect(parseAiEditJobInputs({ target: 'home' })).toEqual({ target: 'home', targetKind: null, versionId: null })
    expect(parseAiEditJobInputs({ target: 'frame', targetKind: 'layout', versionId: 'lv-1' })).toEqual({
      target: 'frame',
      targetKind: 'layout',
      versionId: 'lv-1',
    })
    expect(parseAiEditJobInputs({})).toBe(AI_EDIT_TARGET_REQUIRED_COPY)
    expect(parseAiEditJobInputs({ target: '../x' })).toBe(AI_EDIT_TARGET_REQUIRED_COPY)
    expect(parseAiEditJobInputs({ target: 'home', targetKind: 'component' })).toBe(AI_EDIT_TARGET_KIND_COPY)
    expect(parseAiEditJobInputs({ target: 'home', versionId: 'a/b' })).toBe(AI_EDIT_VERSION_ID_COPY)
  })

  it('names a version by the change, cut to the versions route’s label', () => {
    expect(aiEditVersionName('  Shorter   hero ')).toBe('AI edit: Shorter hero')
    expect(aiEditVersionName('')).toBe('AI edit')
    expect(aiEditVersionName('x'.repeat(400))).toHaveLength(200)
  })

  it('outlines the stored document breadth first, every element after its parent, to the rung’s cap', () => {
    const outline = aiEditJobOutline(PAGE_NODES)
    expect(outline?.nodes.map((node) => node['id'])).toEqual([ROOT, 'hero', 'services', 'heroStack', 'servicesTitle', 'heroTitle', 'heroCta'])
    expect(outline?.nodes[0]).toMatchObject({ parentId: null, childCount: 2 })
    expect(outline?.total).toBe(7)
    const wide: Record<string, unknown> = { [ROOT]: { componentId: 'div', nodes: Array.from({ length: 90 }, (_, i) => `n${i}`) } }
    for (let i = 0; i < 90; i += 1) wide[`n${i}`] = { componentId: 'muiBox', nodes: [] }
    const capped = aiEditJobOutline(wide)
    expect([capped?.nodes.length, capped?.total]).toEqual([ASSIST_EDIT_CONTEXT_MAX_NODES, 91])
    expect(aiEditJobOutline({})).toBeNull()
  })

  it('places a change where no visitor sees it, or refuses', () => {
    const place = (versioning: boolean, served: boolean, sourceIsPointer: boolean, sourceScheduled = false) =>
      aiEditPlacement({ versioning, served, sourceIsPointer, sourceScheduled })
    expect(place(true, true, true)).toBe('new-beside')
    expect(place(true, false, true)).toBe('new-current')
    expect(place(true, false, false)).toBe('new-beside')
    expect(place(false, true, true)).toBe('refused')
    expect(place(false, false, true)).toBe('in-place')
    expect(place(false, true, false)).toBe('in-place')
    expect(place(false, true, false, true)).toBe('refused')
  })
})

// ── The time it registers ────────────────────────────────────────────────

describe('registration and time', () => {
  it('registers the runner with the least time its generation needs, and its admission', () => {
    registerAiEditJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('edit', runAiJobEditStep, { minimumMs: AI_JOB_EDIT_STEP_MINIMUM_MS })
    expect(aiJobAdmissionFor('edit')).toBe(aiEditJobAdmission)
    registerAiJobAdmission('edit', null)
  })

  it('asks the rung’s ceiling with half as much again to think in, whole on its tier, and needs a beat rather than an inline door', () => {
    expect(AI_ROUTING_TABLE['job.edit'].maxTokens).toBe(1.5 * ASSIST_EDIT_MAX_OUTPUT_TOKENS)
    expect(AI_JOB_EDIT_STEP_BUDGET.maxTokens(aiJobEditModel())).toBe(AI_ROUTING_TABLE['job.edit'].maxTokens)
    const tier = AI_STEP_TIERS['job.edit']
    expect(AI_JOB_EDIT_STEP_MINIMUM_MS).toBe(
      aiGenerationWorstCaseOnTierMs({ tier, maxTokens: AI_ROUTING_TABLE['job.edit'].maxTokens, lookups: 0, ownReadsMs: AI_EDIT_READS_MS }),
    )
    expect(AI_JOB_EDIT_STEP_BUDGET.minimumMs).toBe(AI_JOB_EDIT_STEP_MINIMUM_MS)
    expect(AI_JOB_EDIT_STEP_MINIMUM_MS).toBeGreaterThan(AI_JOB_INLINE_BUDGET_MS)
  })
})

// ── Where the change lands ───────────────────────────────────────────────

describe('a plan with version history', () => {
  it('writes a published page’s change into a new version beside the live one, which stays current', async () => {
    seed()
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep()
    expect(outcome.failure).toBeUndefined()
    const written = docs.get(`${SCREEN}/versions/job-1`) as Record<string, unknown>
    expect(written).toMatchObject({
      screenId: 'home',
      hostId: 'host-1',
      layoutId: 'frame',
      displayName: 'AI edit: Shorter hero headline and less padding',
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
      aiJobId: 'job-1',
    })
    const nodes = stored(`${SCREEN}/versions/job-1`)
    expect(nodes['heroTitle'].props).toEqual({ variant: 'h1', children: 'Friendly, fast plumbing for the valley' })
    expect(nodes['hero'].sx).toEqual({ py: 8 })
    // Everything the request did not ask about is as it was.
    expect(nodes['servicesTitle'].props).toEqual(PAGE_NODES.servicesTitle.props)
    expect(nodes['heroCta'].props).toEqual(PAGE_NODES.heroCta.props)
    // The live version and the pointer are untouched.
    expect(stored(`${SCREEN}/versions/v-live`)['heroTitle'].props.children).toBe(PAGE_NODES.heroTitle.props.children)
    expect(docs.get(SCREEN)?.['versionId']).toBe('v-live')
    expect(outcome.outputs).toEqual([
      {
        resource: 'screen',
        id: 'home',
        versionId: 'job-1',
        hostId: 'host-1',
        hostSubdomain: 'brightside',
        label: 'Home',
        note: expect.stringContaining('beside the one it started from. Nothing visitors see has changed'),
      },
    ])
    expect(outcome.usage).toEqual(USAGE)
  })

  it('asks through the rung’s tool, with the job’s rules and the stored document as the outline', async () => {
    seed()
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    await runStep()
    const request = mockRunAiRequest.mock.calls[0][0]
    expect(request.tools.map((tool: { name: string }) => tool.name)).toEqual([ASSIST_EDIT_TOOL_NAME])
    expect(request.system.map((block: { text: string }) => block.text)).toContain(AI_JOB_EDIT_RULES.text)
    const user = request.messages[0].content as string
    expect(user).toContain('"id":"heroTitle"')
    expect(user).toContain('Nothing is selected.')
    expect(user).toContain("Request: Make the home page's hero shorter.")
    expect(request.maxTokens).toBe(AI_JOB_EDIT_STEP_BUDGET.maxTokens(request.model))
  })

  it('makes an unpublished page’s new version its current one', async () => {
    seed({ routed: false })
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep()
    expect(docs.get(SCREEN)).toMatchObject({ versionId: 'job-1', updatedAt: NOW })
    expect(outcome.outputs[0]).toMatchObject({ versionId: 'job-1', note: expect.stringContaining('now this page’s current one') })
  })

  it('never moves a layout’s current version', async () => {
    seed({ layout: true })
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep({ inputs: { target: 'frame', targetKind: 'layout' } })
    expect(docs.get(`${LAYOUT}/versions/job-1`)).toMatchObject({ layoutId: 'frame', displayName: expect.stringMatching(/^AI edit: /) })
    expect(docs.get(LAYOUT)?.['versionId']).toBe('lv-live')
    expect(outcome.outputs[0]).toMatchObject({ resource: 'layout', id: 'frame', versionId: 'job-1', label: 'Site frame' })
  })

  it('spends nothing when a run of the job already wrote its version', async () => {
    seed()
    docs.set(`${SCREEN}/versions/job-1`, { screenId: 'home', nodes: packed(PAGE_NODES) })
    const outcome = await runStep()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.outputs[0]).toMatchObject({ resource: 'screen', id: 'home', versionId: 'job-1' })
  })
})

describe('a plan without version history', () => {
  it('refuses a version visitors see as a plan limit, before anything is spent', async () => {
    seed()
    const outcome = await runStep({}, STARTER)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.review).toEqual({ reason: 'limit', message: AI_EDIT_NEEDS_VERSIONING_COPY, findings: [] })
    expect([...docs.keys()].filter((path) => path.includes('job-1'))).toEqual([])
  })

  it('changes an unpublished page’s version in place, stamped so a run asked again finds it', async () => {
    seed({ routed: false })
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep({}, STARTER)
    expect(docs.has(`${SCREEN}/versions/job-1`)).toBe(false)
    expect(docs.get(`${SCREEN}/versions/v-live`)).toMatchObject({ updatedAt: NOW, aiEditJobId: 'job-1', displayName: 'Initial version' })
    expect(stored(`${SCREEN}/versions/v-live`)['heroTitle'].props.children).toBe('Friendly, fast plumbing for the valley')
    expect(outcome.outputs[0]).toMatchObject({ versionId: 'v-live', note: expect.stringContaining('which no visitor sees') })
    mockRunAiRequest.mockReset()
    const again = await runStep({}, STARTER)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(again.outputs[0]).toMatchObject({ versionId: 'v-live' })
  })

  it('changes a version that is not the live one in place, and refuses one a schedule will publish', async () => {
    seed()
    mockRunAiRequest.mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep({ inputs: { target: 'home', versionId: 'v-older' } }, STARTER)
    expect(outcome.outputs[0]).toMatchObject({ versionId: 'v-older' })
    expect(docs.get(SCREEN)?.['versionId']).toBe('v-live')
    docs.set(SCREEN, { ...docs.get(SCREEN), publishSchedule: { versionId: 'v-older', status: 'pending', publishAt: NOW } })
    mockRunAiRequest.mockReset()
    const scheduled = await runStep({ $id: 'job-2', inputs: { target: 'home', versionId: 'v-older' } }, STARTER)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(scheduled.review?.message).toBe(AI_EDIT_NEEDS_VERSIONING_COPY)
  })
})

// ── What the model answered ──────────────────────────────────────────────

describe('the answer', () => {
  it('re-asks an answer naming an element the page does not have, and keeps the one that does not', async () => {
    seed()
    mockRunAiRequest.mockResolvedValueOnce(completion({ summary: 'x', ops: [UNKNOWN] })).mockResolvedValueOnce(completion(ANSWER))
    const outcome = await runStep()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(mockRunAiRequest.mock.calls[1][0].messages)).toContain('names an element that is not on the canvas described')
    expect(outcome.outputs[0]).toMatchObject({ versionId: 'job-1' })
    expect(stored(`${SCREEN}/versions/job-1`)['hero'].sx).toEqual({ py: 8 })
  })

  it('keeps what survived a re-ask that still left a change out, and says what it left out', async () => {
    seed()
    mockRunAiRequest.mockResolvedValue(completion({ summary: 'Shorter headline', ops: [SHORTER_TITLE, UNKNOWN] }))
    const outcome = await runStep()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome.failure).toBeUndefined()
    expect(stored(`${SCREEN}/versions/job-1`)['heroTitle'].props.children).toBe('Friendly, fast plumbing for the valley')
    expect(outcome.outputs[0].note).toContain('Left out: change 2: names an element that is not on the canvas described.')
  })

  it('fails, having spent, when no change survived the re-ask either', async () => {
    seed()
    mockRunAiRequest.mockResolvedValue(completion({ summary: 'x', ops: [UNKNOWN] }))
    const outcome = await runStep()
    expect(outcome.failure).toBe(AI_EDIT_NOTHING_COPY)
    expect(outcome.usage).not.toEqual(AI_JOB_ZERO_USAGE)
    expect(docs.has(`${SCREEN}/versions/job-1`)).toBe(false)
  })

  it('leaves a published page’s search fields out, naming them, and writes an unpublished page’s', async () => {
    seed()
    mockRunAiRequest.mockResolvedValueOnce(completion({ summary: 'Shorter headline', ops: [SHORTER_TITLE, SEO] }))
    const live = await runStep()
    expect(live.outputs[0].note).toContain(`Left out: ${AI_EDIT_SEO_LEFT_OUT}.`)
    expect(docs.get(SCREEN)?.['seo']).toBeUndefined()

    docs.clear()
    seed({ routed: false })
    mockRunAiRequest.mockResolvedValueOnce(completion({ summary: 'Shorter headline', ops: [SHORTER_TITLE, SEO] }))
    const draft = await runStep()
    expect(draft.outputs[0].note).not.toContain('Left out')
    expect(docs.get(SCREEN)).toMatchObject({ seo: { title: 'Brightside Plumbing — fast, friendly plumbers' }, versionId: 'job-1' })
  })

  it('saves nothing when the page changed under the answer, as the editor refuses a stale proposal', async () => {
    seed()
    mockRunAiRequest.mockImplementationOnce(async () => {
      // A member swapped the headline for a button while the model answered.
      docs.set(`${SCREEN}/versions/v-live`, {
        ...docs.get(`${SCREEN}/versions/v-live`),
        nodes: packed({ ...PAGE_NODES, heroTitle: { ...PAGE_NODES.heroTitle, componentId: 'muiButton' } }),
      })
      return completion(ANSWER)
    })
    const outcome = await runStep()
    expect(outcome.failure).toBe(AI_EDIT_STALE_COPY)
    expect(docs.has(`${SCREEN}/versions/job-1`)).toBe(false)
  })

  it('declines with the model, having spent', async () => {
    seed()
    mockRunAiRequest.mockResolvedValueOnce({ kind: 'refusal', text: '', toolUse: [], usage: USAGE, estCostUsd: 0.01, stopReason: 'refusal' })
    const outcome = await runStep()
    expect(outcome.refused).toBe(true)
  })
})

describe('what it refuses before anything is spent', () => {
  it.each([
    ['a site of another org', () => docs.set(HOST, { orgId: 'org-2' }), {}, AI_EDIT_NO_SITE_COPY],
    ['a deleted page', () => docs.set(SCREEN, { ...docs.get(SCREEN), deletedAt: NOW }), {}, AI_EDIT_GONE_COPY],
    ['an email design', () => docs.set(SCREEN, { ...docs.get(SCREEN), kind: 'email' }), {}, AI_EDIT_EMAIL_COPY],
    ['a page that is not there', () => undefined, { inputs: { target: 'nope' } }, AI_EDIT_GONE_COPY],
    ['no target', () => undefined, { inputs: {} }, AI_EDIT_TARGET_REQUIRED_COPY],
  ] as const)('%s', async (_name, arrange, patch, copy) => {
    seed()
    arrange()
    const outcome = await runStep(patch as Partial<AiJob>)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect([outcome.failure, outcome.usage]).toEqual([copy, AI_JOB_ZERO_USAGE])
  })
})

// ── Admission ─────────────────────────────────────────────────────────────

describe('admission', () => {
  const admit = (inputs: Record<string, unknown>, org: object = PRO, hostId: string | null = 'host-1') =>
    createAiEditJobAdmission()({ firestore, orgId: 'org-1', hostId, inputs, org })

  it('admits a page of the org’s site where the change has somewhere no visitor sees', async () => {
    seed()
    await expect(admit({ target: 'home' })).resolves.toBeNull()
    await expect(admit({ target: 'home', versionId: 'v-older' }, STARTER)).resolves.toBeNull()
  })

  it('refuses in the plan’s words, and what is not there or not the org’s', async () => {
    seed()
    await expect(admit({ target: 'home' }, STARTER)).resolves.toEqual({ status: 403, error: AI_EDIT_NEEDS_VERSIONING_COPY })
    await expect(admit({})).resolves.toEqual({ status: 400, error: AI_EDIT_TARGET_REQUIRED_COPY })
    await expect(admit({ target: 'home' }, PRO, null)).resolves.toEqual({ status: 400, error: AI_EDIT_NO_SITE_COPY })
    await expect(admit({ target: 'nope' })).resolves.toEqual({ status: 404, error: AI_EDIT_GONE_COPY })
    mockOwners.set('host-1', 'org-2')
    await expect(admit({ target: 'home' })).resolves.toEqual({ status: 404, error: 'Unknown site' })
  })
})
