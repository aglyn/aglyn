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
 * THE CANONICAL REQUEST, end to end and offline (AGL-3616).
 *
 * The founder's example — "create a few new pages and add forms for bookings
 * and contact form and then an about page" — as a recorded eval case: an
 * AUTHORED plan answer (written by hand to the quality the plan step is held
 * to; never a live run) goes through the REAL plan step, doctrine loop and
 * validators, and the plan it keeps goes through the REAL build step, pass by
 * pass, with fake runners and a fake booking-service writer standing in for
 * the model and the bookings plugin. What it holds:
 *
 * - one plan: the site's layout reused, a contact form created, a booking
 *   service drafted, and three pages — booking, contact, about;
 * - order: the form and the service before the pages that place them;
 * - each page is told what to place, and the about page places nothing;
 * - one failure does not fail the rest: a service the writer refuses leaves
 *   the booking page built without its Booking block, and everything else
 *   delivered — the partial-success rule.
 *
 * The live counterpart (`AGLYN_LIVE_AI=1`, the founder's go only) is listed
 * in docs/AI_JOBS.md with its cost.
 */

const mockRunAiRequest = jest.fn()
const mockReadInventory = jest.fn()

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
  resolveOrgIdForHost: async (hostId: string) => (hostId === 'host-1' ? 'org-1' : null),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: string[]) => ids,
}))

import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  aiBuildCreditEstimate,
  aiBuildOrder,
  aiBuildPlanShapeRefusal,
  aiBuildUnits,
  type AiBuildOps,
} from '../model/ai-build-job'
import { AI_BUILD_PLAN_TOOL } from '../model/ai-build-plan'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import type { AiJob, AiJobItemLedger, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { createAiJobBuildStep } from './ai-job-build-step'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import { aiPageSectionNodeId } from './ai-job-page-sections'
import { createAiJobPlanStep } from './ai-job-plan-step'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }),
} as unknown as FirebaseFirestore.Firestore

/** The founder's words, 2026-10-06. */
const CANONICAL_REQUEST =
  'create a few new pages and add forms for bookings and contact form and then an about page'

/** A small groomer's site with a home page in its own layout. */
const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  layouts: [{ id: 'lay-site', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false }],
}

/** The bookings plugin's capability, as its contract registers it (never imported: one plugin's spec does not import another). */
const BOOKING_SERVICE: PluginAiCapability = {
  op: 'booking-service',
  noun: 'booking service',
  where: 'Bookings → Services',
  intents: ['a way for visitors to book an appointment, consultation or estimate visit'],
  argsSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Its name on the booking widget.', maxLength: 80 },
      durationMinutes: { type: 'integer', description: 'Minutes one booking takes.', minimum: 5, maximum: 480 },
      days: { type: 'array', description: 'Weekdays.', items: { type: 'string' }, maxItems: 7 },
      opensAt: { type: 'string', description: 'HH:MM', maxLength: 5 },
      closesAt: { type: 'string', description: 'HH:MM', maxLength: 5 },
      timezone: { type: 'string', description: 'IANA zone', maxLength: 64 },
      priceDisplay: { type: 'string', description: 'How the price reads.', enum: ['fixed', 'varies', 'estimate', 'contact'] },
    },
    required: ['name', 'durationMinutes', 'days', 'opensAt', 'closesAt', 'timezone'],
    additionalProperties: false,
  },
  maxPerPlan: 5,
  freeAllowed: false,
  feature: 'bookings',
  draftResource: 'booking-service',
  estimateCredits: () => 0,
  degrade: 'omit',
  pageBlocks: ['booking'],
  draftContent: (item) => ({ ...item.args, status: 'draft' }),
}

const OPS: AiBuildOps = new Map<string, PluginAiCapability>([
  ...AI_OWNED_CAPABILITIES.map((one) => [one.op, one] as const),
  [BOOKING_SERVICE.op, BOOKING_SERVICE],
])

const screen = (title: string, slug: string, sections: Array<{ name: string; uses: string[] }>) => ({
  title,
  slug,
  layout: 'lay-site',
  template: null,
  record: null,
  duplicateOf: null,
  nav: true,
  seoTitle: `${title} | Pawsome Grooming`,
  seoDescription: `${title} at Pawsome Grooming, the dog groomer in Austin.`,
  sections: sections.map((section) => ({ ...section, items: 0 })),
})

/**
 * THE RECORDED ANSWER: authored, as a plan of the quality the step is held
 * to. Items' arguments travel as one JSON string, as the tool asks.
 */
const AUTHORED_PLAN = {
  reuse: [{ kind: 'layout', id: 'lay-site', purpose: 'the site’s header and footer, on every new page' }],
  create: [
    {
      kind: 'form',
      name: 'Contact',
      why: 'The request asks for a contact form.',
      duplicateOf: null,
      fields: ['name', 'email', 'message'],
    },
  ],
  items: [
    {
      op: 'booking-service',
      name: 'Grooming appointment',
      why: 'The request asks for bookings: a service visitors can book.',
      dependsOn: [],
      degrade: 'omit',
      args: JSON.stringify({
        name: 'Grooming appointment',
        durationMinutes: 60,
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        opensAt: '09:00',
        closesAt: '17:00',
        timezone: 'America/Chicago',
        priceDisplay: 'contact',
      }),
    },
  ],
  screens: [
    screen('Book', '/book', [
      { name: 'what a grooming visit includes', uses: [] },
      { name: 'booking', uses: ['new:Grooming appointment'] },
    ]),
    screen('Contact', '/contact', [
      { name: 'where to find us', uses: [] },
      { name: 'contact form', uses: ['new:Contact'] },
    ]),
    screen('About', '/about', [
      { name: 'story', uses: [] },
      { name: 'team', uses: [] },
      { name: 'call to action', uses: [] },
    ]),
  ],
}

const USAGE = { inputTokens: 6_000, outputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 }

function job(overrides: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'build-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'build',
    status: 'running',
    brief: CANONICAL_REQUEST,
    inputs: {},
    steps: [
      { name: 'plan', status: 'running', creditsSpent: 0 },
      { name: 'generate', status: 'pending', creditsSpent: 0 },
    ],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    ...overrides,
  } as AiJob
}

/** Plans the canonical request through the real plan step, from the recorded answer. */
async function planned(): Promise<AiJobPlan> {
  // Every ask gets the recorded answer, so a re-ask is counted rather than crashing.
  mockRunAiRequest.mockResolvedValue({
    kind: 'completion',
    text: '',
    toolUse: [{ name: AI_BUILD_PLAN_TOOL.name, input: AUTHORED_PLAN }],
    usage: USAGE,
    estCostUsd: 0.03,
    stopReason: 'tool_use',
  })
  const outcome = await createAiJobPlanStep({
    findPlansByKey: async () => [],
    readCapabilities: async () => null,
    readOps: async () => OPS,
  })({ job: job(), stepIndex: 0, now: NOW, firestore })
  if (!outcome.plan) throw new Error(`the recorded plan was not kept: ${JSON.stringify(outcome.review ?? outcome.failure)}`)
  return { ...(outcome.plan as AiJobPlan), status: 'confirmed', confirmedAt: NOW as never, confirmedBy: 'uid-1' }
}

/** A runner that builds whatever unit it is handed, and records the job it was handed. */
function runner(seen: AiJob[]): AiJobStepRunner {
  return async ({ job: handed }) => {
    seen.push(handed)
    const resource = handed.kind === 'form' ? 'form' : 'screen'
    return {
      outputs: [{ resource, id: handed.$id, hostId: 'host-1', label: handed.$id } as AiJobOutput],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0.02,
      model: 'm',
      stopReason: 'end_turn',
    } satisfies AiJobStepOutcome
  }
}

function serviceWriter(refuse: boolean): { impl: PluginResourceDraftWriter; written: string[] } {
  const written: string[] = []
  return {
    written,
    impl: {
      refusal: async () => null,
      check: () => ({ ok: true, facts: {} }),
      read: async () => null,
      write: async (request) => {
        if (refuse) return { ok: false, status: 400, error: 'Those hours do not read.' }
        written.push(request.name)
        return { ok: true, replayed: false, id: request.id, name: request.name, versionId: null, facts: {} }
      },
    },
  }
}

/** Every pass of the build, the ledger kept as the machine keeps it, until nothing is left. */
async function built(plan: AiJobPlan, refuseService = false) {
  const seen: AiJob[] = []
  const writer = serviceWriter(refuseService)
  const step = createAiJobBuildStep({
    runnerFor: ((kind: string) => (kind === 'page' || kind === 'form' ? runner(seen) : null)) as never,
    writerFor: (resource) => (resource === 'booking-service' ? writer.impl : null),
    opsFor: async () => OPS,
    pluginAdmission: async () => null,
    admissionFor: async () => null,
    readNodes: (async (_firestore: unknown, input: { id: string }) => ({
      versionId: 'v1',
      nodes: Object.fromEntries([0, 1, 2].map((index) => [aiPageSectionNodeId(input.id, index), {}])),
    })) as never,
  })
  let current = job({ plan, steps: [{ name: 'plan', status: 'done', creditsSpent: 2 }, { name: 'generate', status: 'running', creditsSpent: 0 }] })
  const order: string[] = []
  for (let pass = 0; pass < 20; pass++) {
    const outcome = await step({ job: current, stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' as const } })
    const ledger: AiJobItemLedger[] = (outcome.items ?? current.items ?? []).map((row) =>
      outcome.item && row.slot === outcome.item.slot
        ? { ...row, status: outcome.item.status, outputs: outcome.item.outputs ?? [], note: outcome.item.note ?? null, degradedBy: outcome.item.degradedBy } as AiJobItemLedger
        : row,
    )
    if (outcome.item) order.push(outcome.item.slot)
    current = { ...current, items: ledger, outputs: [...(current.outputs ?? []), ...outcome.outputs] }
    if (!outcome.continue) break
  }
  return { ledger: current.items ?? [], order, seen, written: writer.written }
}

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
})

describe('the canonical request, planned (AGL-3616)', () => {
  it('keeps one plan: the layout reused, a contact form, a booking service and three pages', async () => {
    const plan = await planned()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(plan.reuse).toEqual([expect.objectContaining({ kind: 'layout', id: 'lay-site' })])
    expect(plan.create.map((one) => [one.kind, one.name])).toEqual([['form', 'Contact']])
    expect(plan.items?.map((one) => [one.op, one.name, one.args['durationMinutes']])).toEqual([
      ['booking-service', 'Grooming appointment', 60],
    ])
    expect(plan.screens.map((one) => one.slug)).toEqual(['/book', '/contact', '/about'])
    // Every page renders inside the site's own layout: none is created.
    expect(plan.screens.every((one) => one.layout === 'lay-site')).toBe(true)
    expect(aiBuildPlanShapeRefusal(plan, { ops: OPS })).toBeNull()
  })

  it('orders what a page places before the page, and prices only what runs a model', async () => {
    const plan = await planned()
    const order = (aiBuildOrder(aiBuildUnits(plan)) ?? []).map((unit) => unit.label)
    expect(order.indexOf('Contact')).toBeLessThan(order.lastIndexOf('Contact'))
    expect(order.indexOf('Grooming appointment')).toBeLessThan(order.indexOf('Book'))
    // The form is one pass; each page its sections and its listing; the service is written without a model.
    expect(aiBuildCreditEstimate(plan, { ops: OPS })).toBe(50 * (1 + 3 + 3 + 4))
  })

  it('is refused on a Free workspace with the sentence the plan card shows: three pages, then the booking service', async () => {
    const plan = await planned()
    expect(aiBuildPlanShapeRefusal(plan, { ops: OPS, freeTaste: true })).toBe(
      "This plan builds 3 pages, and a Free workspace's build makes at most 2. Paid plans can build more.",
    )
    const twoPages = { ...plan, screens: plan.screens.slice(0, 2) }
    expect(aiBuildPlanShapeRefusal(twoPages, { ops: OPS, freeTaste: true })).toMatch(
      /A Free workspace cannot have a booking service made/,
    )
  })
})

describe('the canonical request, built (AGL-3616)', () => {
  it('delivers every part, and tells each page what to place', async () => {
    const { ledger, seen, written } = await built(await planned())
    expect(ledger.map((row) => [row.label, row.status])).toEqual([
      ['Contact', 'succeeded'],
      ['Grooming appointment', 'succeeded'],
      ['Book', 'succeeded'],
      ['Contact', 'succeeded'],
      ['About', 'succeeded'],
    ])
    expect(written).toEqual(['Grooming appointment'])
    const brief = (title: string) => seen.find((one) => one.kind === 'page' && one.brief.includes(`“${title}”`))?.brief ?? ''
    expect(brief('Book')).toContain('place the booking block for the booking service “Grooming appointment”')
    expect(brief('About')).not.toMatch(/place the/)
    // The contact page is handed the form the build made, by its id.
    const contact = seen.find((one) => one.kind === 'page' && one.brief.includes('“Contact”, at /contact'))
    const formId = ledger[0].outputs[0]
    expect(contact?.plan?.screens[0].sections[1].uses).toEqual([formId])
  })

  it('a refused service leaves the booking page built without its block, and the rest delivered', async () => {
    const { ledger, seen } = await built(await planned(), true)
    expect(ledger.map((row) => [row.label, row.status])).toEqual([
      ['Contact', 'succeeded'],
      ['Grooming appointment', 'failed'],
      ['Book', 'degraded'],
      ['Contact', 'succeeded'],
      ['About', 'succeeded'],
    ])
    expect(ledger[2].note).toBe('Built without the booking block: the booking service “Grooming appointment” could not be created.')
    const book = seen.find((one) => one.kind === 'page' && one.brief.includes('“Book”'))
    expect(book?.brief).toContain('without the booking service “Grooming appointment” and without the booking block')
    expect(book?.plan?.screens[0].sections[1].uses).toEqual([])
  })
})
