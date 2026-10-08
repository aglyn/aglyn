/**
 * @jest-environment node
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
 * THE CANONICAL REQUEST'S LIVE ANSWERS, replayed offline (AGL-3616).
 *
 * `ai-build-canonical-request-live.spec.ts` sent the founder's request to the
 * real model on 2026-10-08 (claude-sonnet-5-5, the balanced tier) and the dev
 * replay cache kept both answers of that round. Both plans were good — a
 * booking service placed on /book, a contact form, /book, /contact and /about,
 * the layout reused — and the doctrine refused them:
 *
 *  - the first for its arguments: it wrote the booking days as "monday", as
 *    the operation's line named the argument only "days: array";
 *  - the re-ask under rule 1, `plan-repeated-items`: "What to expect", "Other
 *    ways to reach us" and "Our values" each repeat three items with no
 *    component. A build's pages are written in the layout language, whose
 *    compiler draws those items in their section itself.
 *
 * Here the recorded answers go back through the REAL plan step and doctrine,
 * with the provider mocked: no network, no key, no cost.
 */

const mockRunAiRequest = jest.fn()

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
jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))

import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { aiBuildPlanShapeRefusal, type AiBuildOps } from '../model/ai-build-job'
import { AI_BUILD_PLAN_TOOL, parseAiBuildPlan, type AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import {
  AI_PLAN_COMPILED_REPEATS_SENTENCE,
  aiPlanCapabilitiesForJob,
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
} from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { validateAiBuildPlan } from '../runtime/ai-doctrine-validators'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { AI_JOB_PLAN_SCOPES, aiSitePlanCapabilities, createAiJobPlanStep } from './ai-job-plan-step'

const NOW = new Date('2026-10-08T13:44:00.000Z')
const firestore = {} as FirebaseFirestore.Firestore

const CANONICAL_REQUEST =
  'create a few new pages and add forms for bookings and contact form and then an about page'

/** The live spec's site: a layout and a home page. */
const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-live'),
  layouts: [{ id: 'lay-site', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false }],
}

/** The booking-service operation as its owner registers it: only what the planner reads. */
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
      description: { type: 'string', description: 'What the visitor books.', maxLength: 500 },
      days: {
        type: 'array',
        description: 'The weekdays it can be booked on.',
        items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        maxItems: 7,
      },
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
}

const OPS: AiBuildOps = new Map<string, PluginAiCapability>([
  ...AI_OWNED_CAPABILITIES.map((one) => [one.op, one] as const),
  [BOOKING_SERVICE.op, BOOKING_SERVICE],
])

const screen = (title: string, slug: string, seoTitle: string, seoDescription: string, sections: Array<[string, string[], number]>) => ({
  title,
  slug,
  layout: 'lay-site',
  template: null,
  duplicateOf: null,
  nav: true,
  seoTitle,
  seoDescription,
  sections: sections.map(([name, uses, items]) => ({ name, uses, items })),
})

const CONTACT_FORM = {
  kind: 'form',
  name: 'Contact form',
  duplicateOf: null,
  fields: ['name', 'email', 'phone', 'subject', 'message', 'consent'],
}

/** Replay cache `cecb53d1…`, 13:44:39Z: the round's first answer, verbatim. */
const RECORDED_FIRST = {
  reuse: [{ kind: 'layout', id: 'lay-site', purpose: 'Shared header, navigation and footer for all three new pages' }],
  create: [{ ...CONTACT_FORM, why: 'The site has no saved form, and general enquiries are not handled by any other operation.' }],
  screens: [
    screen('Contact', '/contact', 'Contact us', 'Send us a question or request and we will reply by email. Find our contact details and what to expect after you get in touch.', [
      ['Contact intro (h1 and short welcome)', [], 0],
      ['Contact form', ['new:Contact form'], 1],
      ['Other ways to reach us: [phone], [email], [address]', [], 0],
    ]),
    screen('Book', '/book', 'Book an appointment', 'Choose a time that suits you and book a consultation online. See the length of each booking and the days and hours available.', [
      ['Booking intro (h1 and what to expect)', [], 0],
      ['Online booking', ['new:Consultation booking'], 1],
      ['Before your visit: preparation notes and cancellation info', [], 0],
    ]),
    screen('About', '/about', 'About us', 'Learn who we are, how we work and what we care about, and find out how to book a consultation or get in touch with the team.', [
      ['About hero (h1 and tagline)', [], 0],
      ['Our story', [], 0],
      ['How we work', [], 0],
      ['Call to action linking to Book and Contact pages', [], 2],
    ]),
  ],
  items: [
    {
      op: 'booking-service',
      name: 'Consultation booking',
      why: 'The brief asks for bookings, which the booking service handles rather than a form.',
      dependsOn: [],
      degrade: 'omit',
      args: '{"name":"Consultation","durationMinutes":30,"description":"A 30-minute consultation to talk through what you need and agree next steps. [Confirm service name and length.]","days":["monday","tuesday","wednesday","thursday","friday"],"opensAt":"09:00","closesAt":"17:00","timezone":"America/Chicago","priceDisplay":"contact"}',
    },
  ],
}

/** Replay cache `519981d7…`, 13:44:52Z: the re-ask's answer, verbatim. */
const RECORDED_REASK = {
  reuse: [
    { kind: 'layout', id: 'lay-site', purpose: 'Shared header, navigation and footer for all new pages' },
    { kind: 'screen', id: 'scr-home', purpose: 'Existing home page the new pages link back to; left unchanged' },
  ],
  create: [{ ...CONTACT_FORM, why: 'The site has no saved form, and the brief asks for a contact form for general enquiries.' }],
  screens: [
    screen('Book a consultation', '/book', 'Book a consultation', 'Choose a day and time that suits you and book a consultation online. Pick a slot, confirm your details and we will see you then.', [
      ['Booking intro with h1', [], 0],
      ['Online booking', ['new:Consultation booking'], 1],
      ['What to expect', [], 3],
    ]),
    screen('Contact', '/contact', 'Contact us', 'Send us a question or a request using the contact form. Tell us what you need and we will reply as soon as we can.', [
      ['Contact intro with h1', [], 0],
      ['Contact form', ['new:Contact form'], 1],
      ['Other ways to reach us', [], 3],
    ]),
    screen('About', '/about', 'About us', 'Learn who we are, what we believe in and how we work with our clients, and find out how to get in touch or book a consultation.', [
      ['About hero with h1', [], 0],
      ['Our story', [], 0],
      ['Our values', [], 3],
      ['Call to action to book or contact', [], 2],
    ]),
  ],
  items: [
    {
      op: 'booking-service',
      name: 'Consultation booking',
      why: 'The brief asks for bookings, which a booking service handles instead of a form.',
      dependsOn: [],
      degrade: 'omit',
      args: '{"name":"Consultation","durationMinutes":30,"description":"A one-to-one conversation to talk through what you need and agree the next steps.","days":["mon","tue","wed","thu","fri"],"opensAt":"09:00","closesAt":"17:00","timezone":"UTC","priceDisplay":"contact"}',
    },
  ],
}

/** A paid (business) workspace's capabilities, narrowed to a job kind as the plan step narrows them. */
function workspace(kind: AiJob['kind']): AiPlanCapabilities {
  return aiSitePlanCapabilities(
    { kind, inputs: {} },
    aiPlanCapabilitiesForJob(aiUnrestrictedPlanCapabilities(), AI_JOB_PLAN_SCOPES[kind]),
  ) as AiPlanCapabilities
}

function parsed(answer: unknown): AiBuildPlan {
  const result = parseAiBuildPlan(answer)
  if (!result.ok) throw new Error(`the recorded answer does not parse: ${JSON.stringify(result)}`)
  return result.plan
}

const codes = (plan: AiBuildPlan, capabilities: AiPlanCapabilities) =>
  validateAiBuildPlan(plan, INVENTORY, null, capabilities).map((violation) => violation.code)

function buildJob(): AiJob {
  return {
    $id: 'job-replay-canonical',
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'build',
    status: 'running',
    brief: CANONICAL_REQUEST,
    inputs: {},
    steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 0,
    createdBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

const answered = (input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: AI_BUILD_PLAN_TOOL.name, input }],
  usage: { inputTokens: 1_400, outputTokens: 1_500, cacheReadTokens: 4_683, cacheWriteTokens: 0 },
  estCostUsd: 0.03,
  stopReason: 'tool_use',
})

async function plan(answers: unknown[]) {
  mockRunAiRequest.mockReset()
  for (const answer of answers) mockRunAiRequest.mockResolvedValueOnce(answered(answer))
  const outcome = await createAiJobPlanStep({
    readInventory: async () => INVENTORY,
    findPlansByKey: null,
    readCapabilities: async () => aiUnrestrictedPlanCapabilities(),
    readOps: async () => OPS,
    admissionRefusal: async () => null,
    readSiteContext: null,
  })({ job: buildJob(), stepIndex: 0, now: NOW, firestore, org: { plan: 'business', billingStatus: 'active' } } as never)
  return outcome
}

describe("the canonical request's recorded live answers, replayed (AGL-3616)", () => {
  it("a build's plan is not asked for a component for a section's repeated items: its pages compile them", () => {
    const build = workspace('build')
    expect(build.repeatsCompiled).toBe(true)
    expect(codes(parsed(RECORDED_REASK), build)).toEqual([])
  })

  it('still holds a page job, whose page is written as a raw tree, to rule 1', () => {
    const page = workspace('page')
    expect(page.repeatsCompiled).toBeUndefined()
    expect(codes(parsed(RECORDED_REASK), page)).toContain('plan-repeated-items')
  })

  it('still asks a build for one component for a section two pages share', () => {
    const shared = parsed({
      ...RECORDED_REASK,
      screens: RECORDED_REASK.screens.map((one) => ({
        ...one,
        sections: [...one.sections, { name: 'Client testimonials', uses: [], items: 3 }],
      })),
    })
    const found = codes(shared, workspace('build'))
    expect(found).toContain('plan-section-across-screens')
    expect(found).not.toContain('plan-repeated-items')
  })

  it("refuses the first answer's full day names, which the operation's enum does not hold", () => {
    expect(aiBuildPlanShapeRefusal(parsed(RECORDED_FIRST), { ops: OPS })).toMatch(
      /"days" holds "monday", which is not one of mon, tue, wed, thu, fri, sat, sun/,
    )
    expect(aiBuildPlanShapeRefusal(parsed(RECORDED_REASK), { ops: OPS })).toBeNull()
  })

  it('keeps the re-ask answer through the real plan step, and tells the planner both fixes', async () => {
    const outcome = (await plan([RECORDED_FIRST, RECORDED_REASK])) as unknown as Record<string, unknown>
    const kept = outcome['plan'] as AiBuildPlan | undefined
    expect(outcome['review']).toMatchObject({ reason: 'plan' })
    expect(kept?.screens.map((one) => one.slug)).toEqual(['/book', '/contact', '/about'])
    expect(kept?.items?.map((item) => item.op)).toEqual(['booking-service'])
    // The first answer is re-asked for its days alone; the second is kept.
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const sent = JSON.stringify(mockRunAiRequest.mock.calls[0])
    expect(sent).toContain('days: array of mon|tue|wed|thu|fri|sat|sun')
    expect(sent).toContain(AI_PLAN_COMPILED_REPEATS_SENTENCE.replace(/"/g, '\\"'))
    const reask = JSON.stringify(mockRunAiRequest.mock.calls[1])
    expect(reask).toContain('monday')
    expect(reask).not.toContain('plan-repeated-items')
  })

  it('keeps the re-ask answer at once, asked first', async () => {
    const outcome = (await plan([RECORDED_REASK])) as unknown as Record<string, unknown>
    expect(outcome['plan']).toBeTruthy()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
  })
})
