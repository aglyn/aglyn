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
 * The component step (AGL-2908), against the REAL doctrine loop, palette
 * validator, binding checks, draft writer and plan arithmetic: only the
 * provider (at the runtime's `runAiRequest` seam), the routing table's answer,
 * the inventory reader, the host index, the duplicate module and the
 * machine's registry are stubbed, and Firestore is a double that honors
 * transactions.
 *
 * The model's answers are the goldens beside this spec (`goldens/`), read
 * from disk: no spec here reaches a provider. So a component the step keeps
 * is one the doctrine and the binding rules held, a component it stops on is
 * one they refused twice, and a draft it writes is the document the create
 * route would have written — and nothing else.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { ReusableComponentProp } from '@aglyn/aglyn/foundation/definitions/platform.types'
import type { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_STEP_NOMINAL_USAGE } from '../providers/model-choice'
import { AI_DOCTRINE_SYSTEM_BLOCK, type AiValidatedTree } from '../runtime/ai-doctrine'
import { validateAiNodeTree } from '../runtime/ai-node-tree'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import { aiComponentTool } from '../tools/ai-component-tool'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import {
  AI_JOB_COMPONENT_INSTRUCTIONS,
  AI_JOB_COMPONENT_MAX_TOKENS,
  aiComponentBindingViolations,
  aiJobComponentPrompt,
  createAiJobComponentStep,
  runAiJobComponentStep,
  registerAiComponentJob,
  AI_JOB_COMPONENT_STEP_BUDGET,
  AI_JOB_COMPONENT_STEP_MINIMUM_MS,
} from './ai-job-component-step'
import { AI_DRAFT_ENTITLEMENT_REFUSAL } from './ai-job-drafts'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import { registerAiJobStep } from './ai-jobs'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'

const NOW = new Date('2026-09-15T20:00:00.000Z')
const FREE_ORG = {}
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const USAGE = { inputTokens: 3_000, outputTokens: 900, cacheReadTokens: 6_000, cacheWriteTokens: 0 }

interface Golden {
  brief: string
  name: string
  answer: { tree: TreeInput; props: Array<Record<string, unknown>> }
  stored: Array<Record<string, unknown>>
}

interface TreeInput {
  rootId: string
  nodes: Record<string, { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[] }>
}

const golden = (name: string): Golden =>
  JSON.parse(readFileSync(join(__dirname, 'goldens', `${name}.json`), 'utf8')) as Golden

const TESTIMONIAL = golden('component-testimonial-card')

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
    { id: 'scr-contact', name: 'Contact', slug: 'contact', layoutId: null, template: false },
  ],
  components: [{ id: 'cmp-avatar', name: 'Avatar', props: { picture: 'image', caption: 'text' } }],
}

const PLAN: AiJobPlan = {
  reuse: [],
  create: [
    {
      kind: 'component',
      name: 'Testimonial card',
      why: 'The site has no testimonial block yet.',
      duplicateOf: null,
      fields: ['quote:richText', 'name:text', 'role:text', 'photo:image'],
    },
  ],
  screens: [],
  status: 'confirmed',
  labels: {},
  proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
  confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
  confirmedBy: 'uid-1',
}

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'component',
    status: 'running',
    brief: TESTIMONIAL.brief,
    inputs: {},
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

/** The tool input a model answers with: the tree as JSON text, the props beside it. */
function toolInput(tree: TreeInput, props: ReadonlyArray<Record<string, unknown>>) {
  return { tree: JSON.stringify(tree), props }
}

function componentAnswer(tree: TreeInput, props: ReadonlyArray<Record<string, unknown>>) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name: 'submit_component', input: toolInput(tree, props) }],
    usage: USAGE,
    estCostUsd: 0.02,
    stopReason: 'tool_use',
  }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const context = (patch: Partial<AiJob> = {}) => ({ job: job(patch), stepIndex: 1, now: NOW, firestore })

type StoredNode = { componentId: string; props?: Record<string, unknown> }

function storedNodes(path: string): StoredNode[] {
  const stored = mockDocs.get(path) ?? {}
  return Object.values(decodeStoredNodes(stored['nodes']) as unknown as Record<string, StoredNode>)
}

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

describe('the component step', () => {
  it('registers the component runner, with the admission the create and resume doors ask', async () => {
    registerAiComponentJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('component', runAiJobComponentStep, {
      minimumMs: AI_JOB_COMPONENT_STEP_MINIMUM_MS,
    })
    const ask = (hostId: string | null, org: object) =>
      aiJobAdmissionRefusal('component', { firestore, orgId: 'org-1', hostId, inputs: {}, org })
    expect(await ask(null, STARTER_ORG)).toEqual({
      status: 400,
      error: 'Open the site the component is for before starting the job',
    })
    expect(await ask('host-1', STARTER_ORG)).toBeNull()
    expect(await ask('host-1', FREE_ORG)).toEqual({ status: 403, error: AI_DRAFT_ENTITLEMENT_REFUSAL })
  })

  it('builds the issue’s testimonial card under the doctrine: typed properties, bound in the tree, as a draft nothing places', async () => {
    mockRunAiRequest.mockResolvedValueOnce(componentAnswer(TESTIMONIAL.answer.tree, TESTIMONIAL.answer.props))
    const outcome = await createAiJobComponentStep()(context())
    expect(mockReadInventory).toHaveBeenCalledWith('org-1', 'host-1', { firestore })
    expect(outcome).toEqual({
      outputs: [
        {
          resource: 'reusableComponent',
          id: 'job-1',
          versionId: null,
          hostId: 'host-1',
          hostSubdomain: 'acme',
          label: 'Testimonial card',
          load: expect.objectContaining({ pageBytes: 0 }),
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
      tools: [aiComponentTool(), aiInventoryLookupTool()],
      maxTokens: AI_JOB_COMPONENT_STEP_BUDGET.maxTokens('routed-model'),
      thinking: 'off',
      stream: false,
      messages: [{ role: 'user', content: aiJobComponentPrompt(job(), PLAN, 'Testimonial card') }],
    })
    expect(request.system).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      AI_JOB_COMPONENT_INSTRUCTIONS[0],
      { text: AI_PALETTE_CATALOG.component, cacheBreakpoint: true },
      expect.objectContaining({ volatile: true }),
    ])
    expect(() => validateAiSystemBlocks(request.system)).not.toThrow()

    // One document, the component, holding its tree and the properties as the dialog stores them.
    expect(commits).toEqual(['hosts/host-1/components/job-1'])
    expect(mockDocs.get('hosts/host-1/components/job-1')).toMatchObject({
      displayName: 'Testimonial card',
      rootId: CANVAS_ROOT_ELEMENT_ID,
      props: TESTIMONIAL.stored,
      createdBy: 'uid-1',
    })
    const nodes = storedNodes('hosts/host-1/components/job-1')
    expect(nodes.find((node) => node.componentId === 'image')?.props).toMatchObject({
      src: '{{prop.photo}}',
      alt: 'Portrait of {{prop.name}}',
      hideIf: '{{prop.hidePhoto}}',
    })
    expect(
      nodes.filter((node) => node.componentId === 'muiTypography').map((node) => node.props?.['children']),
    ).toEqual(['{{prop.quote}}', '{{prop.name}}', '{{prop.role}}'])
  })

  it('runs on the model the switch resolves for the job, and reports it', async () => {
    mockRunAiRequest.mockResolvedValueOnce(componentAnswer(TESTIMONIAL.answer.tree, TESTIMONIAL.answer.props))
    const modelFor = jest.fn((kind: string) => (kind === 'job.component' ? 'picked-model' : undefined))
    const outcome = await createAiJobComponentStep()({ ...context(), modelFor })
    expect(modelFor).toHaveBeenCalledWith('job.component')
    expect(mockRunAiRequest.mock.calls[0][0].model).toBe('picked-model')
    expect(outcome.model).toBe('picked-model')
  })

  it('asks once more, then stops for review, when a property is bound where its kind cannot show and another is bound nowhere', async () => {
    const tree = clone(TESTIMONIAL.answer.tree)
    tree.nodes['quote'].props = { ...tree.nodes['quote'].props, children: '{{prop.photo}}' }
    const props = [
      ...TESTIMONIAL.answer.props,
      { name: 'badge', type: 'text', label: 'Badge', description: '', defaultValue: '[Badge]', options: [] },
    ]
    mockRunAiRequest
      .mockResolvedValueOnce(componentAnswer(tree, props))
      .mockResolvedValueOnce(componentAnswer(tree, props))
    const outcome = await createAiJobComponentStep()(context())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const reask = mockRunAiRequest.mock.calls[1][0].messages[2].content as string
    expect(reask).toContain('Rule 1')
    expect(reask).toContain('{{prop.photo}} is an Image property bound to the Typography’s children')
    // The offending element is named by the id the model wrote.
    expect(reask).toContain('(nodes quote)')
    expect(outcome.outputs).toEqual([])
    expect(outcome.usage.inputTokens).toBe(6_000)
    expect(outcome.review).toEqual({
      reason: 'doctrine',
      message: expect.stringContaining('Rule 1'),
      findings: [
        { rule: 1, code: 'binding-field', message: expect.stringContaining('{{prop.photo}}') },
        { rule: 1, code: 'prop-unbound', message: expect.stringContaining('{{prop.quote}}, {{prop.badge}}') },
      ],
    })
    expect(commits).toEqual([])
  })

  it('keeps the plan’s word: the properties it lists for the component, and the components it reuses', async () => {
    const plan: AiJobPlan = {
      ...PLAN,
      reuse: [{ kind: 'component', id: 'cmp-avatar', purpose: 'the portrait' }],
      labels: { 'cmp-avatar': 'Avatar' },
      create: [{ ...PLAN.create[0], fields: [...PLAN.create[0].fields, 'rating:number'] }],
    }
    mockRunAiRequest
      .mockResolvedValueOnce(componentAnswer(TESTIMONIAL.answer.tree, TESTIMONIAL.answer.props))
      .mockResolvedValueOnce(componentAnswer(TESTIMONIAL.answer.tree, TESTIMONIAL.answer.props))
    const outcome = await createAiJobComponentStep()(context({ plan }))
    expect(outcome.review?.findings).toEqual([
      { rule: 7, code: 'plan-reuse-not-placed', message: expect.stringContaining('"Avatar"') },
      { rule: 7, code: 'plan-prop-missing', message: expect.stringContaining('"rating"') },
    ])
    expect(commits).toEqual([])
  })

  it('refuses filler for a default and a picture linked from another website', async () => {
    const props = clone(TESTIMONIAL.answer.props).map((prop) =>
      prop['name'] === 'quote'
        ? { ...prop, defaultValue: 'Lorem ipsum dolor sit amet' }
        : prop['name'] === 'photo'
          ? { ...prop, defaultValue: 'https://images.example.com/portrait.jpg' }
          : prop,
    )
    mockRunAiRequest
      .mockResolvedValueOnce(componentAnswer(TESTIMONIAL.answer.tree, props))
      .mockResolvedValueOnce(componentAnswer(TESTIMONIAL.answer.tree, props))
    const outcome = await createAiJobComponentStep()(context())
    expect(outcome.review?.findings.map((finding) => [finding.rule, finding.code])).toEqual([
      [9, 'prop-default'],
      [14, 'filler-copy'],
    ])
    expect(commits).toEqual([])
  })

  it('reports a declined brief as refused, and writes nothing', async () => {
    mockRunAiRequest.mockResolvedValueOnce({
      kind: 'refusal',
      text: '',
      usage: USAGE,
      estCostUsd: 0.001,
      stopReason: 'refusal',
    })
    const outcome = await createAiJobComponentStep()(context())
    expect(outcome).toMatchObject({ refused: true, outputs: [], estCostUsd: 0.001 })
    expect(commits).toEqual([])
  })

  it('stops for the member, spending nothing, when the plan does not include reusable components', async () => {
    mockDocs.set('orgs/org-1', FREE_ORG)
    const outcome = await createAiJobComponentStep()(context())
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      outputs: [],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
      model: 'routed-model',
      stopReason: null,
      review: { reason: 'limit', message: AI_DRAFT_ENTITLEMENT_REFUSAL, findings: [] },
    })
  })

  it('reports the component an earlier run wrote, without asking the model again', async () => {
    mockRunAiRequest.mockResolvedValueOnce(componentAnswer(TESTIMONIAL.answer.tree, TESTIMONIAL.answer.props))
    await createAiJobComponentStep()(context())
    const again = await createAiJobComponentStep()(context())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(again.outputs).toEqual([
      {
        resource: 'reusableComponent',
        id: 'job-1',
        versionId: null,
        hostId: 'host-1',
        hostSubdomain: 'acme',
        label: 'Testimonial card',
      },
    ])
    expect(again).toMatchObject({ usage: AI_JOB_ZERO_USAGE, estCostUsd: 0 })
    expect(commits).toHaveLength(1)
  })

  it('copies the component the plan starts from through the duplicate module, and generates nothing', async () => {
    const plan: AiJobPlan = { ...PLAN, create: [{ ...PLAN.create[0], duplicateOf: 'cmp-avatar' }] }
    const duplicate = jest
      .fn()
      .mockResolvedValue({ ok: true, id: 'cmp-copy', versionId: 'v-copy', name: 'Testimonial card' })
    const outcome = await createAiJobComponentStep({
      duplicate: duplicate as unknown as typeof duplicateResource,
    })(context({ plan }))
    expect(duplicate).toHaveBeenCalledWith('component', {
      orgId: 'org-1',
      hostId: 'host-1',
      sourceId: 'cmp-avatar',
      name: 'Testimonial card',
      uid: 'uid-1',
      org: STARTER_ORG,
    })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.outputs).toEqual([
      {
        resource: 'reusableComponent',
        id: 'cmp-copy',
        versionId: 'v-copy',
        hostId: 'host-1',
        hostSubdomain: 'acme',
        label: 'Testimonial card',
      },
    ])
  })
})

describe('the component’s bindings (AGL-2871)', () => {
  /** A tree as the doctrine admits it for a component, with its model ids kept. */
  function admitted(tree: TreeInput): AiValidatedTree {
    const result = validateAiNodeTree(tree, 'component', {
      definesComponent: true,
      screenIds: INVENTORY.screens.map((screen) => screen.id),
      componentIds: INVENTORY.components.map((component) => component.id),
      componentProps: Object.fromEntries(
        INVENTORY.components.map((component) => [component.id, component.props]),
      ),
    })
    if (result.ok === false) throw new Error(result.error)
    return { ...result, score: {} as AiValidatedTree['score'], load: null }
  }

  const CTA: TreeInput = {
    rootId: 'root',
    nodes: {
      root: { componentId: 'div', nodes: ['cta'] },
      cta: {
        componentId: 'muiButton',
        props: {
          children: '{{prop.label}}',
          variant: '{{prop.style}}',
          fullWidth: '{{prop.wide}}',
          screenId: '{{prop.link}}',
        },
      },
    },
  }
  const CTA_PROPS: ReusableComponentProp[] = [
    { name: 'label', type: 'text', label: 'Label', defaultValue: 'Get a quote' },
    {
      name: 'style',
      type: 'choice',
      label: 'Style',
      defaultValue: 'contained',
      options: [{ value: 'contained', label: 'Filled' }, { value: 'outlined', label: 'Outlined' }],
    },
    { name: 'wide', type: 'boolean', label: 'Full width', defaultValue: false },
    { name: 'link', type: 'href', label: 'Link', defaultValue: 'scr-contact' },
  ]

  it('keeps a switch, a dropdown and a screen picker bound whole to the kinds the Attributes panel offers each', () => {
    const tree = admitted(CTA)
    expect(Object.values(tree.nodes).find((node) => node.componentId === 'muiButton')?.props).toMatchObject(
      CTA.nodes['cta'].props as Record<string, unknown>,
    )
    expect(aiComponentBindingViolations(tree, [...CTA_PROPS], INVENTORY)).toEqual([])
  })

  it('refuses copy in a switch, and a choice whose answers the dropdown does not list', () => {
    const cta = clone(CTA)
    cta.nodes['cta'].props = { ...cta.nodes['cta'].props, fullWidth: '{{prop.label}}' }
    const props = CTA_PROPS.map((prop) =>
      prop.name === 'style'
        ? { ...prop, options: [...(prop.options ?? []), { value: 'fancy', label: 'Fancy' }] }
        : prop,
    )
    const violations = aiComponentBindingViolations(admitted(cta), props, INVENTORY)
    expect(violations.map((violation) => violation.code)).toEqual(['binding-field', 'binding-answers', 'prop-unbound'])
    expect(violations[0].message).toContain('{{prop.label}} is a Text property bound to the Button’s fullWidth')
    expect(violations[0].nodeIds).toEqual(['cta'])
    expect(violations[1].message).toContain('"fancy"')
    // The switch that lost its binding leaves the Yes / no bound nowhere.
    expect(violations[2].message).toContain('{{prop.wide}}')
  })

  it('drops a token that is not the whole value of a field that is not copy, leaving its property bound nowhere', () => {
    const cta = clone(CTA)
    cta.nodes['cta'].props = { ...cta.nodes['cta'].props, variant: 'Style {{prop.style}}' }
    const tree = admitted(cta)
    expect(Object.values(tree.nodes).find((node) => node.componentId === 'muiButton')?.props).not.toHaveProperty(
      'variant',
    )
    expect(aiComponentBindingViolations(tree, [...CTA_PROPS], INVENTORY).map((violation) => violation.code)).toEqual([
      'prop-unbound',
    ])
  })

  it('names a token the component does not declare', () => {
    const violations = aiComponentBindingViolations(admitted(CTA), CTA_PROPS.slice(0, 3), INVENTORY)
    expect(violations).toEqual([
      expect.objectContaining({ rule: 1, code: 'prop-undeclared', nodeIds: ['cta'] }),
    ])
    expect(violations[0].message).toContain('{{prop.link}}')
    // A property the reading refused is reported there, not again here.
    expect(aiComponentBindingViolations(admitted(CTA), CTA_PROPS.slice(0, 3), INVENTORY, ['link'])).toEqual([])
  })

  it('switches an optional part off with a Hide … Yes / no that defaults to No, and never the whole component', () => {
    const props = TESTIMONIAL.stored.map((prop) => ({ ...prop }))
    const tree = admitted(TESTIMONIAL.answer.tree)
    expect(aiComponentBindingViolations(tree, props as never, INVENTORY)).toEqual([])

    const shown = props.map((prop) => (prop['name'] === 'hidePhoto' ? { ...prop, label: 'Show photo' } : prop))
    expect(aiComponentBindingViolations(tree, shown as never, INVENTORY).map((violation) => violation.code)).toEqual([
      'hide-label',
    ])
    const hiddenByDefault = props.map((prop) =>
      prop['name'] === 'hidePhoto' ? { ...prop, defaultValue: true } : prop,
    )
    expect(
      aiComponentBindingViolations(tree, hiddenByDefault as never, INVENTORY).map((violation) => violation.code),
    ).toEqual(['hide-label'])

    const wholeCard = clone(TESTIMONIAL.answer.tree)
    wholeCard.nodes['card'].props = { ...wholeCard.nodes['card'].props, hideIf: '{{prop.hidePhoto}}' }
    delete wholeCard.nodes['photo'].props?.['hideIf']
    expect(
      aiComponentBindingViolations(admitted(wholeCard), props as never, INVENTORY).map((violation) => violation.code),
    ).toEqual(['hide-whole-component'])
  })

  it('refuses a default longer than the field it fills whole', () => {
    const props = CTA_PROPS.map((prop) =>
      prop.name === 'label' ? { ...prop, defaultValue: 'Book a free consultation with our design team today' } : prop,
    )
    const violations = aiComponentBindingViolations(admitted(CTA), props, INVENTORY)
    expect(violations.map((violation) => violation.code)).toEqual(['prop-default-too-long'])
    expect(violations[0].message).toContain('(40 characters)')
  })

  it('hands a property on to a component it places only as the kind that component declares', () => {
    const tree: TreeInput = {
      rootId: 'root',
      nodes: {
        root: { componentId: 'div', nodes: ['avatar'] },
        avatar: {
          componentId: 'reusableInstance',
          props: { refId: 'cmp-avatar', propValues: { picture: '{{prop.photo}}', caption: 'Photo: {{prop.name}}' } },
        },
      },
    }
    const props: ReusableComponentProp[] = [
      { name: 'photo', type: 'image', label: 'Photo' },
      { name: 'name', type: 'text', label: 'Name', defaultValue: '[Customer name]' },
    ]
    expect(aiComponentBindingViolations(admitted(tree), props, INVENTORY)).toEqual([])
    const crossed = clone(tree)
    crossed.nodes['avatar'].props = { refId: 'cmp-avatar', propValues: { picture: '{{prop.name}}', caption: '{{prop.photo}}' } }
    const violations = aiComponentBindingViolations(admitted(crossed), props, INVENTORY)
    expect(violations.map((violation) => violation.code)).toEqual(['binding-field'])
    expect(violations[0].nodeIds).toEqual(['avatar'])
  })
})

describe('aiJobComponentPrompt', () => {
  it('names the component, states the brief, and gives the confirmed plan as references', () => {
    expect(aiJobComponentPrompt(job(), PLAN, 'Testimonial card')).toBe(
      [
        'Component name: Testimonial card',
        `Brief: ${TESTIMONIAL.brief}`,
        'Confirmed plan:',
        '- create the component "Testimonial card": The site has no testimonial block yet. Fields: quote:richText, name:text, role:text, photo:image.',
      ].join('\n'),
    )
    expect(aiJobComponentPrompt(job(), null, 'Component')).toBe(`Component name: Component\nBrief: ${TESTIMONIAL.brief}`)
  })
})

describe('the component step’s fit, measured', () => {
  /**
   * What the budget is held against, stated because no spec reaches a
   * provider to measure it: a conservative floor for the balanced tier's
   * streaming rate, and a wait before an answer's first token.
   */
  const OUTPUT_TOKENS_PER_SECOND = 50
  const SECONDS_BEFORE_FIRST_TOKEN = 3
  /** Prose at four characters a token, the catalog's own estimate; JSON packs denser. */
  const promptTokens = (text: string) => Math.ceil(text.length / 4)
  const answerTokens = (text: string) => Math.ceil(text.length / 3)
  const sweepBudgetMs = Number(
    /export const AI_JOB_SWEEP_BUDGET_MS = ([\d_]+)/
      .exec(readFileSync(join(__dirname, 'ai-job-budget.ts'), 'utf8'))?.[1]
      .replace(/_/g, ''),
  )

  it('fits the answer and its one re-ask inside the beat’s budget for one step, at the size the golden measures', async () => {
    mockRunAiRequest.mockResolvedValueOnce(componentAnswer(TESTIMONIAL.answer.tree, TESTIMONIAL.answer.props))
    await createAiJobComponentStep()(context())
    const [request] = mockRunAiRequest.mock.calls[0]
    const cached = promptTokens(
      (request.system as Array<{ text: string; volatile?: boolean }>)
        .filter((block) => !block.volatile)
        .map((block) => block.text)
        .join('') + JSON.stringify(request.tools),
    )
    const answer = answerTokens(JSON.stringify(toolInput(TESTIMONIAL.answer.tree, TESTIMONIAL.answer.props)))
    expect(sweepBudgetMs).toBe(280_000)
    // The answer and the re-ask's answer, each after its wait, inside one step's share of the beat.
    expect(2 * (SECONDS_BEFORE_FIRST_TOKEN + answer / OUTPUT_TOKENS_PER_SECOND) * 1_000).toBeLessThan(sweepBudgetMs)
    // The ceiling is far above a real answer, so it cuts only a runaway, which the doctrine re-asks as too long.
    expect(answer * 4).toBeLessThan(AI_JOB_COMPONENT_MAX_TOKENS)
    expect(request).toMatchObject({ thinking: 'off', maxTokens: AI_JOB_COMPONENT_STEP_BUDGET.maxTokens('routed-model') })
    // The model switch prices a typical request from the nominal row: within a quarter of what this one measures.
    const nominal = AI_STEP_NOMINAL_USAGE['job.component']
    expect(Math.abs(nominal.cacheReadTokens - cached) / cached).toBeLessThan(0.25)
    expect(Math.abs(nominal.outputTokens - answer) / answer).toBeLessThan(0.25)
  })
})
