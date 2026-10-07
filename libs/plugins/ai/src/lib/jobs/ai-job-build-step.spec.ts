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
import { aiBuildUnitJob, createAiJobBuildStep } from './ai-job-build-step'
import { aiBuildInitialLedger, aiBuildUnits } from '../model/ai-build-job'

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
})
