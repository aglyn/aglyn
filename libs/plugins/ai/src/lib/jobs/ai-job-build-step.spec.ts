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
import {
  AI_BUILD_THEME_PROPOSAL_NOTE,
  aiBuildBusinessWords,
  aiBuildItemOutputNote,
  aiBuildJobRunMinimumMs,
  aiBuildStoreLinksToPublish,
  aiBuildUnitJob,
  createAiBuildJobAdmission,
  createAiJobBuildStep,
} from './ai-job-build-step'
import type { ResolvedBusinessProfile } from '@aglyn/aglyn/app-utils/business-profile'
import { AI_JOB_PAGE_STEP_MINIMUM_MS } from './ai-job-page-budget'
import { AI_JOB_THEME_STEP_MINIMUM_MS } from './ai-job-theme-budget'
import { AI_BUILD_MADE_INPUT, AI_BUILD_NEEDS_INPUT_CODE, aiBuildCreditRange, aiBuildFirstPagePlan, aiBuildInitialLedger, aiBuildUnits } from '../model/ai-build-job'
import { AI_CREDITS_CONFIRM_CODE, aiCreditsPromptText } from '../model/ai-credit-estimate'
import { aiFreeCreditsNoneLeftText } from '../model/ai-site-job'
import { registerAiJobStep } from './ai-jobs'
import { aiBuildBuiltRefs } from './ai-build-unit-outcome'
import { aiLayoutListingsOf } from '../layout-language/ai-layout-listings'
import { AI_LAYOUT_SITE_MOTION_INPUT, aiLayoutMotionSiteOf } from './ai-job-page-language'

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

  it('reports an item whose resource has no draft state as live, not as a draft (AGL-3745)', async () => {
    const live: PluginAiCapability = { ...SERVICE, live: true, where: 'Redirects' }
    const outcome = await createAiJobBuildStep({
      runnerFor: (() => null) as never,
      writerFor: (resource) => (resource === 'bookingService' ? writer().impl : null),
      opsFor: async () => new Map([...OPS, [live.op, live]]),
      pluginAdmission: async () => null,
      readNodes: readNodes as never,
    })(context(job()))
    expect(outcome).toMatchObject({
      item: { slot: 'i0', status: 'succeeded' },
      outputs: [{ resource: 'draft', id: 'svc-1', note: 'Live now, in Redirects.' }],
    })
  })

  it('reports an item a live writer kept as a draft as a draft, saying why (AGL-3755)', async () => {
    const live: PluginAiCapability = { ...SERVICE, live: true, where: 'Events' }
    const kept = writer({
      write: async (request) => ({
        ok: true,
        replayed: false,
        id: request.id,
        name: request.name,
        versionId: null,
        facts: { status: 'draft' },
        live: false,
        notice: 'Kept as a draft: publishing takes the editor role.',
      }),
    })
    const outcome = await createAiJobBuildStep({
      runnerFor: (() => null) as never,
      writerFor: (resource) => (resource === 'bookingService' ? kept.impl : null),
      opsFor: async () => new Map([...OPS, [live.op, live]]),
      pluginAdmission: async () => null,
      readNodes: readNodes as never,
    })(context(job()))
    expect(outcome).toMatchObject({
      outputs: [{ note: 'A draft, in Events. Kept as a draft: publishing takes the editor role.' }],
    })
  })

  it('names the output note from the capability alone when the writer says nothing (AGL-3755)', () => {
    expect(aiBuildItemOutputNote({ where: 'Events', live: true })).toBe('Live now, in Events.')
    expect(aiBuildItemOutputNote({ where: 'Events', live: true }, { live: true })).toBe('Live now, in Events.')
    expect(aiBuildItemOutputNote({ where: 'Notes' })).toBe('A draft, in Notes.')
  })

  it('hands a page built on an existing site that site’s stored motion, and nothing where it stored none (AGL-3949)', async () => {
    const items: AiJobItemLedger[] = aiBuildInitialLedger(aiBuildUnits(plan())).map((row) =>
      row.slot === 'i0' ? { ...row, status: 'succeeded', outputs: ['svc-1'] } : row,
    )
    const hostWith = (data: Record<string, unknown>) =>
      ({ collection: () => ({ doc: () => ({ get: async () => ({ data: () => data }) }) }) }) as unknown as FirebaseFirestore.Firestore
    const siteStyle = { v: 1, kind: 'photography', base: 'starter', seed: 4242, hue: 20, accent: 200, headerAlign: 'start', rhythm: 'calm', motion: 'sides' }
    const seen: AiJob[] = []
    await step({ writer: writer().impl, seen })({ ...context(job({ items })), firestore: hostWith({ siteStyle }) })
    expect(seen[0].inputs[AI_LAYOUT_SITE_MOTION_INPUT]).toEqual({ kind: 'photography', seed: 4242, motion: 'sides' })
    // Only the motion travels: the page's prompt is told no look it was not told before.
    expect(seen[0].inputs['siteStyle']).toBeUndefined()
    expect(aiLayoutMotionSiteOf(seen[0], '/book')).toEqual({ kind: 'photography', seed: 4242, motion: 'sides' })

    const bare: AiJob[] = []
    await step({ writer: writer().impl, seen: bare })(context(job({ items })))
    expect(bare[0].inputs[AI_LAYOUT_SITE_MOTION_INPUT]).toBeUndefined()
  })

  it('hands the stored motion only to what moves: pages, layouts and templates (AGL-3949)', () => {
    const units = aiBuildUnits(editPlan())
    const siteMotion = { kind: 'photography', seed: 7, motion: 'rise' as const }
    const edit = aiBuildUnitJob(job({ plan: editPlan() }), units[0], { kind: 'edit', units, ledger: aiBuildInitialLedger(units), ops: OPS, siteMotion })
    expect(edit.inputs[AI_LAYOUT_SITE_MOTION_INPUT]).toBeUndefined()
    for (const kind of ['page', 'layout', 'template'] as const) {
      const derived = aiBuildUnitJob(job({ plan: editPlan() }), units[0], { kind, units, ledger: aiBuildInitialLedger(units), ops: OPS, siteMotion })
      expect(derived.inputs[AI_LAYOUT_SITE_MOTION_INPUT]).toEqual(siteMotion)
    }
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

  /*
   * Try again on a build (the AGL-3730 fix, for a build): a build that had
   * published once skipped the publish, so a page Try again rebuilt stayed a
   * draft. Its last pass puts the pages the retry built live, only those, as
   * a retry, merged into what the first publish put live.
   */
  it('publishes the pages Try again built, only those, as a retry, merged into the first publish', async () => {
    const items = aiBuildInitialLedger(aiBuildUnits(plan())).map((row) =>
      row.slot === 'i0'
        ? { ...row, status: 'succeeded' as const, outputs: ['svc-1'] }
        : { ...row, status: 'succeeded' as const, attempt: 2, outputs: ['page-1'] },
    )
    const outputs = [{ resource: 'screen' as const, id: 'page-1', hostId: 'host-1', label: 'Book' }]
    const first = {
      liveUrl: 'https://hillside.aglyn.app/',
      published: [{ id: 'page-0', label: 'Home', path: '/' }],
      drafts: [{ id: 'page-1', label: 'Book', reason: 'It could not be published just now. Publish it from Pages.' }],
    }
    const retried = { liveUrl: 'https://hillside.aglyn.app/', published: [{ id: 'page-1', label: 'Book', path: '/book' }], drafts: [] }
    const publish = jest.fn(async () => retried)
    const outcome = await step({ writer: writer().impl, seen: [], publish })(
      context(job({ items, outputs, sitePublish: first, inputs: { publish: true, publishConfirmed: true } })),
    )
    expect(publish).toHaveBeenCalledTimes(1)
    const [, input] = publish.mock.calls[0] as unknown as [unknown, { outputs: Array<{ id: string }>; retry?: boolean }]
    expect(input.outputs.map((page) => page.id)).toEqual(['page-1'])
    expect(input.retry).toBe(true)
    expect(outcome.sitePublish).toEqual({
      liveUrl: 'https://hillside.aglyn.app/',
      published: [...first.published, ...retried.published],
      drafts: [],
    })
    // Every page it built already live: nothing is published again.
    publish.mockClear()
    await step({ writer: writer().impl, seen: [], publish })(
      context(job({ items, outputs, sitePublish: { ...first, published: retried.published }, inputs: { publish: true, publishConfirmed: true } })),
    )
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes a retry as the first publish when the first put nothing live', async () => {
    const items = aiBuildInitialLedger(aiBuildUnits(plan())).map((row) =>
      row.slot === 'i0' ? { ...row, status: 'succeeded' as const, outputs: ['svc-1'] } : { ...row, status: 'succeeded' as const, outputs: ['page-1'] },
    )
    const outputs = [{ resource: 'screen' as const, id: 'page-1', hostId: 'host-1', label: 'Book' }]
    const none = { liveUrl: null, published: [], drafts: [{ id: 'page-1', label: 'Book', reason: 'It could not be published just now. Publish it from Pages.' }] }
    const live = { liveUrl: 'https://hillside.aglyn.app/', published: [{ id: 'page-1', label: 'Book', path: '/book' }], drafts: [] }
    const publish = jest.fn(async () => live)
    const outcome = await step({ writer: writer().impl, seen: [], publish })(
      context(job({ items, outputs, sitePublish: none, inputs: { publish: true, publishConfirmed: true } })),
    )
    const [, input] = publish.mock.calls[0] as unknown as [unknown, { retry?: boolean }]
    expect(input.retry).toBeUndefined()
    expect(outcome.sitePublish).toEqual(live)
  })

  it('puts the newest store links draft live: a retried store drafts them again', () => {
    const draft = (versionId: string) => ({
      resource: 'layout' as const,
      id: 'layout-1',
      hostId: 'host-1',
      versionId,
      label: 'Header',
      proposal: { storeLinks: 'draft', links: {}, screenPaths: {} },
    })
    expect(aiBuildStoreLinksToPublish([draft('v-first'), draft('v-retry')])?.versionId).toBe('v-retry')
    expect(aiBuildStoreLinksToPublish([])).toBeNull()
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

  it('hands a menu item the pages this build made, built before it, to link as new:<title> (AGL-3728)', () => {
    const navPlan: AiJobPlan = {
      ...plan(),
      items: [
        { slot: 'i0', op: 'navigation', name: 'Menu', why: 'Link the booking page.', dependsOn: [], degrade: 'omit', args: { add: ['Book => new:Book'] }, id: 'nav-1' },
      ],
    }
    const units = aiBuildUnits(navPlan)
    const menu = units.find((unit) => unit.slot === 'i0') as (typeof units)[number]
    expect(menu.deps).toEqual(['p0'])
    const page = units.find((unit) => unit.slot === 'p0') as (typeof units)[number]
    const ledger = aiBuildInitialLedger(units).map((row) => (row.slot === 'p0' ? { ...row, status: 'succeeded' as const, outputs: [page.screen?.id as string] } : row))
    const derived = aiBuildUnitJob(job({ plan: navPlan }), menu, { kind: 'navigation', units, ledger, ops: OPS })
    expect(derived).toMatchObject({ $id: 'nav-1', kind: 'navigation', plan: null, inputs: { add: ['Book => new:Book'] } })
    expect(derived.inputs[AI_BUILD_MADE_INPUT]).toEqual({ pages: [{ title: 'Book', id: page.screen?.id }], layouts: [] })
    // A page that was not built is not handed on.
    const unbuilt = aiBuildUnitJob(job({ plan: navPlan }), menu, { kind: 'navigation', units, ledger: aiBuildInitialLedger(units), ops: OPS })
    expect(unbuilt.inputs[AI_BUILD_MADE_INPUT]).toBeUndefined()
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

  it('quotes it at its measured figures: about 137 (p90 225, up to 650), each page as a page written on its own', () => {
    // Home 6 sections 14 + 6×6 = 50 (p90 28 + 6×12 = 100), quote 3 sections
    // 32 (64), a build's own layout 26 (30) and the form 29 (31), each page's
    // listing on the fast tier at Haiku 5.5's billed rate (AGL-3781).
    expect(aiBuildCreditRange(STILLWING, { ops: OPS })).toEqual({ likely: 137, p90: 225, ceiling: 650 })
  })

  it('admits it with no prompt when its p90 fits', async () => {
    await expect(ask(240)).resolves.toBeNull()
    await expect(ask(225)).resolves.toBeNull()
    expect(reads).toEqual(['org-1', 'org-1'])
  })

  it('answers past what is left with the prompt (no start), the home page first and what is left', async () => {
    const refused = await ask(100)
    const home = aiBuildFirstPagePlan(STILLWING)!
    expect(home.screens.map((one) => one.title)).toEqual(['Home'])
    expect(home.create.map((one) => one.name)).toEqual(['Frame'])
    const prompt = {
      likely: 137,
      p90: 225,
      ceiling: 650,
      left: 100,
      resetsOn: '2026-11-01',
      smaller: { label: 'Build the home page first', ...aiBuildCreditRange(home, { ops: OPS }) },
    }
    expect(refused).toEqual({ status: 409, error: aiCreditsPromptText(prompt, 'build'), code: AI_CREDITS_CONFIRM_CODE, credits: prompt })
    expect(refused?.error).toBe(
      'This build is about 137 credits (up to 650). You have 100 left, so it will build as much as it can and pause when ' +
        'your credits run out. You can upgrade or resume when they renew on November 1.',
    )
  })

  it('admits it on the go-ahead and tells the door what was confirmed; the smaller first build fits on its own', async () => {
    const confirmed: unknown[] = []
    await expect(ask(100, { creditsConfirmed: true, onCreditsConfirmed: (one: unknown) => confirmed.push(one) })).resolves.toBeNull()
    expect(confirmed).toEqual([expect.objectContaining({ likely: 137, p90: 225, left: 100 })])
    // The home page and its layout: 76, p90 130.
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

  it('lists the events it wrote by the Event List where a page names them, and asks the page to place no block for them (AGL-3755)', () => {
    const EVENT: PluginAiCapability = { ...DATASET, op: 'event', noun: 'event', where: 'Events', draftResource: 'event', live: true, pageBlocks: ['eventList'] }
    const eventsPlan = (): AiJobPlan => ({
      ...plan(),
      screens: [
        { ...plan().screens[0], title: 'Events', slug: '/events', sections: [{ name: 'Upcoming events', uses: ['new:Jazz Oct 16', 'new:Jazz Oct 23'], items: 0 }], id: 'page-events' },
      ],
      items: [
        { slot: 'i0', op: 'event', name: 'Jazz Oct 16', why: '', dependsOn: [], degrade: 'omit', args: {}, id: 'ev-16' },
        { slot: 'i1', op: 'event', name: 'Jazz Oct 23', why: '', dependsOn: [], degrade: 'omit', args: {}, id: 'ev-23' },
      ],
    })
    const units = aiBuildUnits(eventsPlan())
    // The second event failed: the list still shows the first.
    const ledger = aiBuildInitialLedger(units).map((row) =>
      row.slot === 'i0' ? { ...row, status: 'succeeded' as const, outputs: ['ev-16'] } : row.slot === 'i1' ? { ...row, status: 'failed' as const } : row,
    )
    const ops: AiBuildOps = new Map([...OPS, ['event', EVENT]])
    const page = units.find((unit) => unit.screen) as (typeof units)[number]
    const derived = aiBuildUnitJob(job({ plan: eventsPlan() }), page, { kind: 'page', units, ledger, ops })
    expect(aiLayoutListingsOf(derived.inputs)).toEqual([
      { id: 'listing:events', kind: 'events', name: 'the events', records: ['Jazz Oct 16'], placements: [{ screenId: 'page-events', section: 0, role: 'index' }] },
    ])
    expect(derived.brief).not.toContain('eventList')
    expect(derived.plan?.screens[0].sections[0].uses).toEqual([])
  })

  /*
   * AGL-3747: a build that lists one of the site's own datasets placed no
   * listing for it, so its cards could never link the record pages the site
   * already serves for it.
   */
  it('lists a dataset the site already has where a page places it, its fields and record pages left to the inventory (AGL-3747)', () => {
    const reusePlan = (): AiJobPlan => ({
      ...plan(),
      labels: { ...(plan().labels ?? {}), 'ds-team': 'Team' },
      reuse: [...plan().reuse, { kind: 'dataset', id: 'ds-team', purpose: 'The people.' }],
      screens: [{ ...plan().screens[0], title: 'About', slug: '/about', sections: [{ name: 'Our people', uses: ['ds-team'], items: 6 }], id: 'page-about' }],
    })
    const units = aiBuildUnits(reusePlan())
    const page = units.find((unit) => unit.slot === 'p0') as (typeof units)[number]
    const derived = aiBuildUnitJob(job({ plan: reusePlan() }), page, { kind: 'page', units, ledger: aiBuildInitialLedger(units), ops: OPS })
    const [listing, ...rest] = aiLayoutListingsOf(derived.inputs)
    expect(rest).toEqual([])
    expect(listing).toMatchObject({ kind: 'records', datasetId: 'ds-team', name: 'Team', fields: [], placements: [{ screenId: 'page-about', section: 0, role: 'index' }] })
    // The plan makes no record template for it: the base is the site's own, read when the page is designed.
    expect(listing).not.toHaveProperty('recordBase')
  })

  it('lists nothing for a dataset item that was not made', () => {
    const units = aiBuildUnits(menuPlan())
    const ledger = aiBuildInitialLedger(units).map((row) => (row.slot === 'i0' ? { ...row, status: 'failed' as const } : row))
    const page = units.find((unit) => unit.slot === 'p0') as (typeof units)[number]
    const derived = aiBuildUnitJob(job({ plan: menuPlan() }), page, { kind: 'page', units, ledger, ops: OPS })
    expect(aiLayoutListingsOf(derived.inputs)).toEqual([])
  })
})

describe('a build’s form that writes to a dataset (AGL-3616)', () => {
  const DATASET_OP: PluginAiCapability = {
    op: 'dataset',
    noun: 'dataset',
    where: 'Data',
    intents: ['a list of like things'],
    argsSchema: { type: 'object', properties: {}, additionalProperties: true } as never,
    maxPerPlan: 3,
    freeAllowed: false,
    feature: 'dataStore',
    draftResource: 'dataset',
    estimateCredits: () => 0,
    degrade: 'omit',
  }
  const ops: AiBuildOps = new Map([...OPS, ['dataset', DATASET_OP]])
  const rsvpPlan = (writesTo: string): AiJobPlan => ({
    ...plan(),
    create: [{ kind: 'form', name: 'RSVP', why: 'Guests say they are coming.', duplicateOf: null, fields: ['fullName', 'guests'], writesTo, id: 'frm-rsvp' }],
    screens: [{ ...plan().screens[0], title: 'RSVP', slug: '/rsvp', sections: [{ name: 'rsvp', uses: ['new:RSVP'], items: 0 }], id: 'page-rsvp' }],
    items: [{ slot: 'i0', op: 'dataset', name: 'Attendees', why: 'Each RSVP kept.', dependsOn: [], degrade: 'omit', args: { name: 'Attendees', fields: ['Full name', 'Guests'] }, id: 'ds-att' }],
  })

  it('builds the dataset item before the form that writes to it', () => {
    const units = aiBuildUnits(rsvpPlan('new:Attendees'))
    expect(units.find((unit) => unit.slot === 'c0')?.deps).toEqual(['i0'])
  })

  it('hands the form the dataset the build made, by id, or one the site has', () => {
    const units = aiBuildUnits(rsvpPlan('new:Attendees'))
    const ledger = aiBuildInitialLedger(units).map((row) => (row.slot === 'i0' ? { ...row, status: 'succeeded' as const, outputs: ['ds-att'] } : row))
    const outputs = [{ resource: 'draft' as const, draftResource: 'dataset', id: 'ds-att', hostId: 'host-1', label: 'Attendees' }]
    const form = units.find((unit) => unit.slot === 'c0') as (typeof units)[number]
    const derived = aiBuildUnitJob(job({ plan: rsvpPlan('new:Attendees'), outputs }), form, { kind: 'form', units, ledger, ops })
    expect(derived.plan?.create).toEqual([expect.objectContaining({ kind: 'form', writesTo: 'ds-att' })])
    expect(derived.inputs['formDatasetMade']).toBe('ds-att')
    // A dataset the site already has is named as it is, and is no dataset this build made.
    const existing = aiBuildUnits(rsvpPlan('dsGuests'))
    const onSite = aiBuildUnitJob(job({ plan: rsvpPlan('dsGuests') }), existing[0], { kind: 'form', units: existing, ledger: aiBuildInitialLedger(existing), ops })
    expect(onSite.plan?.create[0]?.writesTo).toBe('dsGuests')
    expect(onSite.inputs['formDatasetMade']).toBeUndefined()
  })

  it('builds the form without the binding where its dataset item failed, and says so', async () => {
    const units = aiBuildUnits(rsvpPlan('new:Attendees'))
    const items = aiBuildInitialLedger(units).map((row) => (row.slot === 'i0' ? { ...row, status: 'failed' as const } : row))
    const seen: AiJob[] = []
    const formRunner: AiJobStepRunner = async ({ job: handed }) => {
      seen.push(handed)
      return { outputs: [{ resource: 'form', id: 'frm-rsvp', hostId: 'host-1', label: 'RSVP' }], usage: AI_JOB_ZERO_USAGE, estCostUsd: 0, model: 'm', stopReason: 'end_turn' }
    }
    const outcome = await createAiJobBuildStep({
      runnerFor: ((kind: string) => (kind === 'form' ? formRunner : kind === 'page' ? pageRunner([]) : null)) as never,
      writerFor: () => null,
      opsFor: async () => ops,
      admissionFor: async () => null,
      readNodes: readNodes as never,
    })(context(job({ plan: rsvpPlan('new:Attendees'), items })))
    expect(outcome.item).toMatchObject({
      slot: 'c0',
      status: 'degraded',
      degradedBy: ['i0'],
      note: 'Its submissions arrive in the Inbox only: the dataset “Attendees” could not be created.',
    })
    expect(seen[0].plan?.create[0]?.writesTo).toBeNull()
  })
})

describe('aiBuildItemOutputNote (AGL-3746)', () => {
  it('calls a writer’s item a draft unless its capability saves it live', () => {
    expect(aiBuildItemOutputNote({ where: 'Bookings → Services' })).toBe('A draft, in Bookings → Services.')
    expect(aiBuildItemOutputNote({ where: 'CRM → Deals → Pipelines', live: true })).toBe(
      'Live now, in CRM → Deals → Pipelines.',
    )
  })
})

describe('a build whose plan leaves out what only the person can give asks for it (AGL-3751)', () => {
  // The live eval's "add my Meta pixel": the planner kept a tracking change
  // with no id. Kept, it would build nothing; it must ask instead.
  const trackingPlan = (args: Record<string, unknown>, name = 'Meta pixel'): AiJobPlan => ({
    reuse: [],
    create: [],
    screens: [],
    items: [{ slot: 'i0', op: 'tracking', name, why: 'The person wants their Meta pixel on the site.', dependsOn: [], degrade: 'omit', args: args as never }],
    status: 'proposed',
    labels: {},
    proposedAt: NOW as never,
    confirmedAt: null,
    confirmedBy: null,
  })
  const ask = (plan: AiJobPlan) =>
    createAiBuildJobAdmission({ opsFor: async () => OPS, now: () => NOW, ownerOf: async () => 'org-1' })({
      firestore,
      orgId: 'org-1',
      hostId: 'host-1',
      inputs: {},
      org: { plan: 'business', billingStatus: 'active' },
      plan,
    })

  beforeAll(() => registerAiJobStep('page', pageRunner([])))

  it('refuses the plan with the question, naming the tag, before anything is built — coded so the plan step waits for it (AGL-3978)', async () => {
    await expect(ask(trackingPlan({}))).resolves.toEqual({
      status: 400,
      error: 'What’s your Meta pixel ID? It’s the number (8–20 digits) shown for your pixel in Meta Events Manager.',
      code: AI_BUILD_NEEDS_INPUT_CODE,
    })
  })

  it('says why an id given was not one, and asks again', async () => {
    const refused = await ask(trackingPlan({ googleAnalytics: 'my analytics' }, 'Analytics'))
    expect(refused?.error).toBe(
      '“my analytics” is not an ID for Google Analytics, which looks like G-XXXXXXXXXX. What’s your Google Analytics measurement ID? It looks like G-XXXXXXXXXX.',
    )
  })

  it('admits a tracking change that sets or removes something', async () => {
    await expect(ask(trackingPlan({ metaPixel: '123456789012345' }))).resolves.toBeNull()
    await expect(ask(trackingPlan({ remove: ['metaPixel'] }))).resolves.toBeNull()
  })
})

// AGL-4077: a build's theme change is the theme runner's proposal, applied in Setup → Theme.
describe('a build’s theme change', () => {
  const themePlan = (as: 'item' | 'creation' = 'item'): AiJobPlan => ({
    ...plan(),
    screens: [],
    ...(as === 'item'
      ? {
          items: [
            { slot: 'i0', op: 'theme', name: 'Warmer look', why: 'The request asks for a warmer look.', dependsOn: [], degrade: 'omit', args: {}, id: 'theme-1' },
          ],
        }
      : {
          items: [],
          create: [{ kind: 'theme-change', name: 'Warmer look', why: 'The request asks for a warmer look.', duplicateOf: null, fields: [], id: 'theme-1' }],
        }),
  })
  const brief = 'Add an about page, and give it a warmer look.'

  it.each(['item', 'creation'] as const)('is handed to the theme runner as a change to the theme the site has (%s)', (as) => {
    const units = aiBuildUnits(themePlan(as))
    const derived = aiBuildUnitJob(job({ plan: themePlan(as), brief, inputs: { publish: true } }), units[0], {
      kind: 'theme',
      units,
      ledger: aiBuildInitialLedger(units),
      ops: OPS,
    })
    expect(derived).toMatchObject({ $id: 'theme-1', kind: 'theme', plan: null, inputs: { mode: 'modify', originJobId: 'build-1' } })
    expect(derived.inputs['publish']).toBeUndefined()
    expect(derived.brief).toBe(`${brief}\nBuild the theme change “Warmer look”: The request asks for a warmer look.`)
  })

  it('runs the theme runner, keeps its proposal as the item’s output, and names where to apply it', async () => {
    const seen: AiJob[] = []
    const themeRunner: AiJobStepRunner = async ({ job: handed }) => {
      seen.push(handed)
      return {
        outputs: [{ resource: 'theme', id: 'proposal', hostId: 'host-1', hostSubdomain: 'shop', label: 'Theme proposal · 2 changes', proposal: { summary: 'Warmer accents.' } }],
        usage: AI_JOB_ZERO_USAGE,
        estCostUsd: 0.02,
        model: 'm',
        stopReason: 'tool_use',
      }
    }
    const outcome = await createAiJobBuildStep({
      runnerFor: ((kind: string) => (kind === 'theme' ? themeRunner : null)) as never,
      opsFor: async () => OPS,
      admissionFor: async () => null,
    })(context(job({ plan: themePlan(), brief })))
    expect(seen.map((handed) => [handed.$id, handed.kind, handed.inputs['mode']])).toEqual([['theme-1', 'theme', 'modify']])
    expect(outcome.item).toMatchObject({ slot: 'i0', status: 'succeeded', outputs: ['proposal'], note: AI_BUILD_THEME_PROPOSAL_NOTE })
    expect(outcome.outputs).toEqual([
      expect.objectContaining({ resource: 'theme', id: 'proposal', hostSubdomain: 'shop', note: AI_BUILD_THEME_PROPOSAL_NOTE }),
    ])
    expect(AI_BUILD_THEME_PROPOSAL_NOTE).toBe('A proposal, in Setup → Theme. Nothing on the site changes until you apply it there and save.')
  })

  it('gives its next pass the theme step’s time, not a page’s', () => {
    expect(AI_JOB_THEME_STEP_MINIMUM_MS).not.toBe(AI_JOB_PAGE_STEP_MINIMUM_MS)
    expect(aiBuildJobRunMinimumMs(job({ plan: themePlan() }))).toBe(AI_JOB_THEME_STEP_MINIMUM_MS)
    expect(aiBuildJobRunMinimumMs(job({ plan: themePlan('creation') }))).toBe(AI_JOB_THEME_STEP_MINIMUM_MS)
  })
})

// AGL-4077: a build's pages search photos with the site's business words.
describe('a build’s business words, from the site’s business profile', () => {
  const field = <T,>(value: T) => ({ value, origin: 'site' as const })
  const profile = (patch: Partial<ResolvedBusinessProfile> = {}): ResolvedBusinessProfile => ({
    name: field('Juniper Clay'),
    whatYouDo: field('Handmade stoneware and pottery classes'),
    services: null,
    serviceArea: null,
    audience: field('Home cooks and gift buyers'),
    tone: null,
    toneNotes: null,
    businessType: 'Store',
    contact: { email: null, phone: null, address: null, hours: null },
    profiles: [],
    logo: null,
    ...patch,
  }) as ResolvedBusinessProfile

  it('reads what the business does, its name and who it is for', () => {
    expect(aiBuildBusinessWords(profile())).toEqual({
      businessType: 'Handmade stoneware and pottery classes',
      businessName: 'Juniper Clay',
      audience: 'Home cooks and gift buyers',
    })
    // No "what you do": the schema.org type, as words.
    expect(aiBuildBusinessWords(profile({ whatYouDo: null, name: null, audience: null, businessType: 'HomeAndConstructionBusiness' }))).toEqual({
      businessType: 'home and construction business',
    })
    // Clamped at a word to what a site start's own answer holds.
    const long = aiBuildBusinessWords(profile({ whatYouDo: field(`${'Handmade stoneware '.repeat(10)}and more`) }))
    expect(long.businessType?.length).toBeLessThanOrEqual(120)
    expect(long.businessType?.endsWith('stoneware')).toBe(true)
    expect(aiBuildBusinessWords(null)).toEqual({})
  })

  it('hands a page the words where the build has none, never over its own', () => {
    const units = aiBuildUnits(plan())
    const page = units.find((unit) => unit.slot === 'p0') as (typeof units)[number]
    const business = aiBuildBusinessWords(profile())
    const handed = aiBuildUnitJob(job(), page, { kind: 'page', units, ledger: aiBuildInitialLedger(units), ops: OPS, business })
    expect(handed.inputs).toMatchObject(business)
    const own = aiBuildUnitJob(job({ inputs: { businessType: 'a pottery studio' } }), page, {
      kind: 'page',
      units,
      ledger: aiBuildInitialLedger(units),
      ops: OPS,
      business,
    })
    expect(own.inputs['businessType']).toBe('a pottery studio')
    expect(own.inputs['businessName']).toBeUndefined()
    expect(own.inputs['audience']).toBeUndefined()
  })

  it('hands them to no layout, whose header names the site by its token, and to no item, whose inputs are its arguments', () => {
    const business = aiBuildBusinessWords(profile())
    const layoutPlan: AiJobPlan = {
      ...plan(),
      create: [{ kind: 'layout', name: 'Site frame', why: 'A header and footer.', duplicateOf: null, fields: ['header', 'footer'], id: 'lay-1' }],
      items: [],
      screens: [],
    }
    const layoutUnits = aiBuildUnits(layoutPlan)
    const layout = aiBuildUnitJob(job({ plan: layoutPlan }), layoutUnits[0], {
      kind: 'layout',
      units: layoutUnits,
      ledger: aiBuildInitialLedger(layoutUnits),
      ops: OPS,
      business,
    })
    expect(layout.inputs['businessName']).toBeUndefined()
    expect(layout.inputs['businessType']).toBeUndefined()
    const settingsPlan: AiJobPlan = {
      ...plan(),
      screens: [],
      items: [{ slot: 'i0', op: 'settings', name: 'Phone', why: 'Add the phone.', dependsOn: [], degrade: 'omit', args: { telephone: '+1 555 0100' }, id: 'set-1' }],
    }
    const units = aiBuildUnits(settingsPlan)
    const handed = aiBuildUnitJob(job({ plan: settingsPlan }), units[0], {
      kind: 'settings',
      units,
      ledger: aiBuildInitialLedger(units),
      ops: OPS,
      business,
    })
    expect(handed.inputs['businessName']).toBeUndefined()
    expect(handed.inputs['telephone']).toBe('+1 555 0100')
  })

  it('reads the profile for a pass whose build says nothing of the business, and only then', async () => {
    const seen: AiJob[] = []
    const reads: Array<{ orgId: string; hostId: string | null | undefined }> = []
    const readSiteContext = async (_firestore: unknown, input: { orgId: string; hostId: string | null | undefined }) => {
      reads.push({ orgId: input.orgId, hostId: input.hostId })
      return { profile: profile() }
    }
    const build = createAiJobBuildStep({
      runnerFor: ((kind: string) => (kind === 'page' ? pageRunner(seen) : null)) as never,
      opsFor: async () => OPS,
      readNodes: readNodes as never,
      readSiteContext: readSiteContext as never,
    })
    const pagePlan: AiJobPlan = { ...plan(), items: [], screens: [{ ...plan().screens[0], sections: [{ name: 'hero', uses: [], items: 0 }] }] }
    await build(context(job({ plan: pagePlan })))
    expect(reads).toEqual([{ orgId: 'org-1', hostId: 'host-1' }])
    expect(seen[0].inputs).toMatchObject({
      businessType: 'Handmade stoneware and pottery classes',
      businessName: 'Juniper Clay',
      audience: 'Home cooks and gift buyers',
    })
    await build(context(job({ plan: pagePlan, inputs: { businessType: 'a pottery studio' } })))
    expect(reads).toHaveLength(1)
    expect(seen[1].inputs['businessType']).toBe('a pottery studio')
  })
})
