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
 * The build step (AGL-3616) pass by pass, with fake runners and a fake
 * writer: what each unit is handed, how another plugin's draft is written
 * through its own writer and check, and when a build publishes. The machine
 * that records each pass is `ai-jobs.spec.ts`'s.
 */

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => (hostId === 'host-1' ? 'org-1' : null),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: string[]) => ids,
}))
jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import type { AiBuildOps } from '../model/ai-build-job'
import type { AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob, AiJobItemLedger, AiJobPlan } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import { aiPageSectionNodeId } from './ai-job-page-sections'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { aiBuildUnitJob, createAiBuildJobAdmission, createAiJobBuildStep } from './ai-job-build-step'
import { aiBuildCreditRange, aiBuildFirstPagePlan, aiBuildInitialLedger, aiBuildUnits } from '../model/ai-build-job'
import { AI_CREDITS_CONFIRM_CODE, aiCreditsPromptText } from '../model/ai-credit-estimate'
import { aiFreeCreditsNoneLeftText } from '../model/ai-site-job'
import { registerAiJobStep } from './ai-jobs'
import { aiBuildBuiltRefs } from './ai-build-unit-outcome'
import { aiLayoutListingsOf } from '../layout-language/ai-layout-listings'

const NOW = new Date('2026-10-06T12:00:00.000Z')

const SERVICE: PluginAiCapability = {
  op: 'booking-service',
  noun: 'booking service',
  where: 'Bookings → Services',
  intents: ['a service people can book'],
  argsSchema: {
    type: 'object',
    properties: {
      durationMinutes: { type: 'integer', description: 'Length', minimum: 5, maximum: 480 },
    },
    required: ['durationMinutes'],
    additionalProperties: false,
  },
  maxPerPlan: 3,
  freeAllowed: false,
  draftResource: 'bookingService',
  estimateCredits: () => 0,
  degrade: 'omit',
  pageBlocks: ['Booking'],
  draftContent: (item) => ({ name: item.name, durationMinutes: item.args['durationMinutes'], status: 'draft' }),
}

const OPS: AiBuildOps = new Map<string, PluginAiCapability>([
  ...AI_OWNED_CAPABILITIES.map((one) => [one.op, one] as const),
  [SERVICE.op, SERVICE],
])

function writer(overrides: Partial<PluginResourceDraftWriter> = {}) {
  const written: Array<Record<string, unknown>> = []
  const impl: PluginResourceDraftWriter = {
    refusal: async () => null,
    check: (content) =>
      typeof content['durationMinutes'] === 'number' ? { ok: true, facts: {} } : { ok: false, problems: ['A service needs a length'] },
    read: async () => null,
    write: async (request) => {
      written.push({ id: request.id, name: request.name, content: request.content })
      return { ok: true, replayed: false, id: request.id, name: request.name, versionId: null, facts: {} }
    },
    ...overrides,
  }
  return { impl, written }
}

function plan(): AiJobPlan {
  const base: AiBuildPlan = {
    reuse: [],
    create: [],
    screens: [
      {
        title: 'Book',
        slug: '/book',
        layout: null,
        template: null,
        duplicateOf: null,
        nav: true,
        seoTitle: 'Book',
        seoDescription: 'Book a time',
        sections: [{ name: 'booking', uses: ['new:Consult'], items: 0 }],
        record: null,
        id: 'page-1',
      },
    ],
    items: [
      { slot: 'i0', op: 'booking-service', name: 'Consult', why: 'People book a consult.', dependsOn: [], degrade: 'omit', args: { durationMinutes: 30 }, id: 'svc-1' },
    ],
  }
  return { ...base, status: 'confirmed', labels: {}, proposedAt: NOW as never, confirmedAt: NOW as never, confirmedBy: 'uid-1' }
}

function job(overrides: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'build-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'build',
    status: 'running',
    brief: 'A booking page for consults.',
    inputs: {},
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    plan: plan(),
    ...overrides,
  }
}

const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }),
} as unknown as FirebaseFirestore.Firestore

function pageRunner(seen: AiJob[]): AiJobStepRunner {
  return async ({ job: handed }) => {
    seen.push(handed)
    return {
      outputs: [{ resource: 'screen', id: handed.$id, hostId: 'host-1', label: 'Book' }],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0.01,
      model: 'm',
      stopReason: 'end_turn',
    } satisfies AiJobStepOutcome
  }
}

const readNodes = async (_firestore: unknown, input: { id: string }) => ({
  versionId: 'v1',
  nodes: { [aiPageSectionNodeId(input.id, 0)]: {} } as never,
})

function step(deps: { writer: PluginResourceDraftWriter; seen: AiJob[]; publish?: jest.Mock; refuse?: string }) {
  return createAiJobBuildStep({
    runnerFor: ((kind: string) => (kind === 'page' ? pageRunner(deps.seen) : null)) as never,
    writerFor: (resource) => (resource === 'bookingService' ? deps.writer : null),
    opsFor: async () => OPS,
    pluginAdmission: async () => (deps.refuse ? { status: 403, error: deps.refuse } : null),
    readNodes: readNodes as never,
    ...(deps.publish ? { publish: deps.publish } : {}),
  })
}

const context = (handed: AiJob) => ({ job: handed, stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' as const } })

describe('the build step (AGL-3616)', () => {
  it('starts the ledger, writes another plugin’s draft through its own writer, and goes on', async () => {
    const { impl, written } = writer()
    const seen: AiJob[] = []
    const outcome = await step({ writer: impl, seen })(context(job()))
    expect(outcome.items?.map((row) => [row.slot, row.status])).toEqual([
      ['i0', 'pending'],
      ['p0', 'pending'],
    ])
    expect(written).toEqual([{ id: 'svc-1', name: 'Consult', content: { name: 'Consult', durationMinutes: 30, status: 'draft' } }])
    expect(outcome).toMatchObject({
      continue: true,
      estCostUsd: 0,
      item: { slot: 'i0', status: 'succeeded', outputs: ['svc-1'] },
      outputs: [{ resource: 'draft', id: 'svc-1', draftResource: 'bookingService', note: 'A draft, in Bookings → Services.' }],
    })
  })

  it('tells the page to place the Booking block for the service it built', async () => {
    const { impl } = writer()
    const seen: AiJob[] = []
    const items: AiJobItemLedger[] = aiBuildInitialLedger(aiBuildUnits(plan())).map((row) =>
      row.slot === 'i0' ? { ...row, status: 'succeeded', outputs: ['svc-1'] } : row,
    )
    const outcome = await step({ writer: impl, seen })(context(job({ items })))
    expect(seen[0].brief).toContain('In the “booking” section, place the Booking block for the booking service “Consult”.')
    // The item's reference is not a record the page step can place.
    expect(seen[0].plan?.screens[0]?.sections[0]?.uses).toEqual([])
    expect(outcome.continue).toBeUndefined()
    expect(outcome).toMatchObject({ item: { slot: 'p0', status: 'succeeded' } })
  })

  it('an owner’s check that refuses the content fails the item on our side; a refusal skips it', async () => {
    const { impl } = writer({ check: () => ({ ok: false, problems: ['A service needs a length'] }) })
    const outcome = await step({ writer: impl, seen: [] })(context(job()))
    expect(outcome.item).toMatchObject({ status: 'failed', failure: { ours: true, reason: 'step-failure', message: 'A service needs a length' } })
    const skipped = await step({ writer: writer().impl, seen: [], refuse: 'Bookings needs the Pro plan.' })(context(job()))
    expect(skipped.item).toMatchObject({ status: 'skipped', note: 'Not built: Bookings needs the Pro plan.' })
  })

  it('a page whose service failed is built without the Booking block, and says so', async () => {
    const seen: AiJob[] = []
    const items = aiBuildInitialLedger(aiBuildUnits(plan())).map((row) =>
      row.slot === 'i0' ? { ...row, status: 'failed' as const } : row,
    )
    const outcome = await step({ writer: writer().impl, seen })(context(job({ items })))
    expect(seen[0].brief).toContain('without the Booking block')
    expect(outcome.item).toMatchObject({ status: 'degraded', degradedBy: ['i0'], note: expect.stringContaining('Booking block') })
  })

  it('publishes its pages only when the request asked and the member confirmed it', async () => {
    const items = aiBuildInitialLedger(aiBuildUnits(plan())).map((row) =>
      row.slot === 'i0' ? { ...row, status: 'succeeded' as const, outputs: ['svc-1'] } : row,
    )
    const publish = jest.fn(async () => ({ liveUrl: null, published: [], drafts: [] }))
    await step({ writer: writer().impl, seen: [], publish })(context(job({ items, inputs: { publish: true } })))
    expect(publish).not.toHaveBeenCalled()
    await step({ writer: writer().impl, seen: [], publish })(
      context(job({ items, inputs: { publish: true, publishConfirmed: true } })),
    )
    expect(publish).toHaveBeenCalledWith(firestore, expect.objectContaining({ outputs: [expect.objectContaining({ id: 'page-1' })] }))
  })

  it('hands a template item its arguments as inputs and its own creation to build', () => {
    const templatePlan: AiJobPlan = {
      ...plan(),
      screens: [],
      items: [{ slot: 'i0', op: 'template', name: 'Post', why: 'Blog posts.', dependsOn: [], degrade: 'omit', args: { subject: 'entry', collectionId: 'blog' }, id: 'tpl-1' }],
    }
    const units = aiBuildUnits(templatePlan)
    const derived = aiBuildUnitJob(job({ plan: templatePlan, inputs: { publish: true } }), units[0], {
      kind: 'template',
      units,
      ledger: aiBuildInitialLedger(units),
      ops: OPS,
    })
    expect(derived).toMatchObject({
      $id: 'tpl-1',
      kind: 'template',
      inputs: { subject: 'entry', collectionId: 'blog', originJobId: 'build-1' },
      plan: { create: [{ kind: 'template', name: 'Post', id: 'tpl-1' }], screens: [] },
    })
    expect(derived.inputs['publish']).toBeUndefined()
  })

  const editPlan = (): AiJobPlan => ({
    ...plan(),
    screens: [],
    items: [
      {
        slot: 'i0',
        op: 'edit',
        name: 'Shorter hero',
        why: 'The home page hero is too tall.',
        dependsOn: [],
        degrade: 'omit',
        args: { target: 'home', targetKind: 'screen' },
        id: 'edit-1',
      },
    ],
  })

  it('hands an edit item its target as inputs, named by its item, with no plan to build', () => {
    const units = aiBuildUnits(editPlan())
    const derived = aiBuildUnitJob(job({ plan: editPlan() }), units[0], {
      kind: 'edit',
      units,
      ledger: aiBuildInitialLedger(units),
      ops: OPS,
    })
    expect(derived).toMatchObject({
      $id: 'edit-1',
      kind: 'edit',
      inputs: { target: 'home', targetKind: 'screen', originJobId: 'build-1' },
      plan: null,
    })
    expect(derived.brief).toContain('Build the page change “Shorter hero”: The home page hero is too tall.')
  })

  it('runs an edit item through the edit runner after its admission, and skips it with the admission’s words', async () => {
    const seen: AiJob[] = []
    const editRunner: AiJobStepRunner = async ({ job: handed }) => {
      seen.push(handed)
      return {
        outputs: [{ resource: 'screen', id: 'home', versionId: handed.$id, hostId: 'host-1', label: 'Home' }],
        usage: AI_JOB_ZERO_USAGE,
        estCostUsd: 0.02,
        model: 'm',
        stopReason: 'tool_use',
      }
    }
    const build = (refusal: string | null) =>
      createAiJobBuildStep({
        runnerFor: ((kind: string) => (kind === 'edit' ? editRunner : null)) as never,
        opsFor: async () => OPS,
        admissionFor: async (kind) => (kind === 'edit' && refusal ? { status: 403, error: refusal } : null),
      })
    const built = await build(null)(context(job({ plan: editPlan() })))
    expect(seen.map((handed) => [handed.$id, handed.kind])).toEqual([['edit-1', 'edit']])
    expect(built.item).toMatchObject({ slot: 'i0', status: 'succeeded', outputs: ['home'] })
    expect(built.outputs[0]).toMatchObject({ resource: 'screen', id: 'home', versionId: 'edit-1' })
    const refused = await build('Version history requires a Pro plan — see Billing to upgrade')(context(job({ plan: editPlan() })))
    expect(seen).toHaveLength(1)
    expect(refused.item).toMatchObject({
      slot: 'i0',
      status: 'skipped',
      note: 'Not built: Version history requires a Pro plan — see Billing to upgrade',
    })
  })
})

describe('a Free build is admitted on its measured p90, and asks before it starts past what is left (AGL-3722)', () => {
  // The StillWing brief that was refused at 600-odd credits with 164 left: a
  // home of six sections and a quote page of three, one layout, one form.
  const section = (name: string, uses: string[] = []) => ({ name, uses, items: 0 })
  const screen = (title: string, slug: string, sections: ReturnType<typeof section>[], id: string) => ({
    title,
    slug,
    layout: 'new:Frame',
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: title,
    seoDescription: title,
    sections,
    record: null,
    id,
  })
  const STILLWING: AiJobPlan = {
    reuse: [],
    create: [
      { kind: 'layout', name: 'Frame', why: 'shared header and footer', duplicateOf: null, fields: [], id: 'layout-1' },
      { kind: 'form', name: 'Quote', why: 'quote requests', duplicateOf: null, fields: [], id: 'form-1' },
    ],
    screens: [
      screen('Home', '/', ['hero', 'services', 'process', 'work', 'reviews', 'cta'].map((name) => section(name)), 'page-1'),
      screen('Get a quote', '/quote', [section('intro'), section('form', ['new:Quote']), section('faq')], 'page-2'),
    ],
    status: 'proposed',
    labels: {},
    proposedAt: NOW as never,
    confirmedAt: null,
    confirmedBy: null,
  }
  const reads: string[] = []
  const admission = (left: number) =>
    createAiBuildJobAdmission({
      opsFor: async () => OPS,
      now: () => NOW,
      freeCreditsLeft: async (_firestore, input) => {
        reads.push(input.orgId)
        return { left, total: 300, resetsOn: '2026-11-01' }
      },
    })
  const ask = (left: number, extra: Record<string, unknown> = {}) =>
    admission(left)({
      firestore,
      orgId: 'org-1',
      hostId: 'host-1',
      inputs: {},
      org: { plan: 'free' },
      plan: STILLWING,
      ...extra,
    })

  beforeAll(() => registerAiJobStep('page', pageRunner([])))
  beforeEach(() => {
    reads.length = 0
  })

  it('quotes it at its measured figures: about 141 (p90 229, up to 650), each page as a page written on its own', () => {
    // Home 6 sections 16 + 6×6 = 52 (p90 30 + 6×12 = 102), quote 3 sections
    // 34 (66), a build's own layout 26 (30) and the form 29 (31).
    expect(aiBuildCreditRange(STILLWING, { ops: OPS })).toEqual({ likely: 141, p90: 229, ceiling: 650 })
  })

  it('admits it with no prompt when its p90 fits', async () => {
    await expect(ask(240)).resolves.toBeNull()
    await expect(ask(229)).resolves.toBeNull()
    expect(reads).toEqual(['org-1', 'org-1'])
  })

  it('answers past what is left with the prompt (no start), the home page first and what is left', async () => {
    const refused = await ask(100)
    const home = aiBuildFirstPagePlan(STILLWING)!
    expect(home.screens.map((one) => one.title)).toEqual(['Home'])
    expect(home.create.map((one) => one.name)).toEqual(['Frame'])
    const prompt = {
      likely: 141,
      p90: 229,
      ceiling: 650,
      left: 100,
      resetsOn: '2026-11-01',
      smaller: { label: 'Build the home page first', ...aiBuildCreditRange(home, { ops: OPS }) },
    }
    expect(refused).toEqual({ status: 409, error: aiCreditsPromptText(prompt, 'build'), code: AI_CREDITS_CONFIRM_CODE, credits: prompt })
    expect(refused?.error).toBe(
      'This build is about 141 credits (up to 650). You have 100 left, so it will build as much as it can and pause when ' +
        'your credits run out. You can upgrade or resume when they renew on November 1.',
    )
  })

  it('admits it on the go-ahead and tells the door what was confirmed; the smaller first build fits on its own', async () => {
    const confirmed: unknown[] = []
    await expect(ask(100, { creditsConfirmed: true, onCreditsConfirmed: (one: unknown) => confirmed.push(one) })).resolves.toBeNull()
    expect(confirmed).toEqual([expect.objectContaining({ likely: 141, p90: 229, left: 100 })])
    // The home page and its layout: 78, p90 132.
    await expect(ask(140, { plan: aiBuildFirstPagePlan(STILLWING) })).resolves.toBeNull()
  })

  it('refuses only when nothing is left, and never reads a paid workspace', async () => {
    await expect(ask(0, { creditsConfirmed: true })).resolves.toEqual({ status: 429, error: aiFreeCreditsNoneLeftText('2026-11-01') })
    reads.length = 0
    await expect(ask(0, { org: { plan: 'pro' } })).resolves.toBeNull()
    expect(reads).toEqual([])
  })
})

describe('a build’s datasets (AGL-3616)', () => {
  /** The data plugin's operation, as it registers it: a draft its own writer makes. */
  const DATASET: PluginAiCapability = {
    op: 'dataset',
    noun: 'dataset',
    where: 'Data',
    intents: ['a menu, a team, services'],
    argsSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name' }, fields: { type: 'array', description: 'Fields', items: { type: 'string' } } },
      required: ['name', 'fields'],
      additionalProperties: false,
    },
    maxPerPlan: 3,
    freeAllowed: false,
    feature: 'dataStore',
    draftResource: 'dataset',
    estimateCredits: () => 0,
    degrade: 'omit',
  }
  const menuPlan = (): AiJobPlan => ({
    ...plan(),
    screens: [
      { ...plan().screens[0], title: 'Menu', slug: '/menu', sections: [{ name: 'The menu', uses: ['new:Menu'], items: 12 }], id: 'page-menu' },
      { ...plan().screens[0], title: 'Dish', slug: '/dish', nav: false, sections: [{ name: 'Dish', uses: [], items: 0 }], record: { dataset: 'new:Menu', base: 'menu' }, id: 'page-dish' },
    ],
    items: [{ slot: 'i0', op: 'dataset', name: 'Menu', why: 'The dishes.', dependsOn: [], degrade: 'omit', args: { name: 'Menu', fields: ['Dish'] }, id: 'ds-menu' }],
  })

  it('names the dataset item a page lists, and the one a record template shows, by the id its writer gave it', () => {
    const units = aiBuildUnits(menuPlan())
    const ledger = aiBuildInitialLedger(units).map((row) => (row.slot === 'i0' ? { ...row, status: 'succeeded' as const, outputs: ['ds-menu'] } : row))
    const outputs = [{ resource: 'draft' as const, draftResource: 'dataset', id: 'ds-menu', hostId: 'host-1', label: 'Menu' }]
    expect(aiBuildBuiltRefs(units, ledger, outputs).get('menu')).toEqual({ id: 'ds-menu', label: 'Menu', kind: 'dataset' })
    const ops: AiBuildOps = new Map([...OPS, ['dataset', DATASET]])
    const page = units.find((unit) => unit.slot === 'p0') as (typeof units)[number]
    const derived = aiBuildUnitJob(job({ plan: menuPlan(), outputs }), page, { kind: 'page', units, ledger, ops })
    expect(derived.plan?.screens[0].sections[0].uses).toEqual(['ds-menu'])
    expect(aiLayoutListingsOf(derived.inputs)).toEqual([
      expect.objectContaining({ kind: 'records', datasetId: 'ds-menu', name: 'Menu', placements: [{ screenId: 'page-menu', section: 0, role: 'index' }] }),
    ])
    const template = aiBuildUnitJob(job({ plan: menuPlan(), outputs }), units.find((unit) => unit.slot === 'p1') as (typeof units)[number], {
      kind: 'page',
      units,
      ledger,
      ops,
    })
    expect(template.plan?.screens[0].record).toEqual({ dataset: 'ds-menu', base: 'menu' })
  })

  it('lists nothing for a dataset item that was not made', () => {
    const units = aiBuildUnits(menuPlan())
    const ledger = aiBuildInitialLedger(units).map((row) => (row.slot === 'i0' ? { ...row, status: 'failed' as const } : row))
    const page = units.find((unit) => unit.slot === 'p0') as (typeof units)[number]
    const derived = aiBuildUnitJob(job({ plan: menuPlan() }), page, { kind: 'page', units, ledger, ops: OPS })
    expect(aiLayoutListingsOf(derived.inputs)).toEqual([])
  })
})
