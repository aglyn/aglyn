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
 * THE CANONICAL REQUEST, planned by the REAL model (AGL-3616). Its offline
 * twin, `ai-build-canonical-request.spec.ts`, feeds an authored plan; this one
 * sends the founder's words through the real plan step of a `build` job —
 * the real prompt, provider, re-ask and plan rules — on a paid workspace's
 * site that already has a layout and a home page, with the booking-service
 * and product operations on, and holds the plan it keeps to what the request
 * asks: the layout reused, a contact form, a booking service placed on a
 * page, and an about page.
 *
 * It calls the provider and costs real money (a few cents a run), so it runs
 * only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, under the
 * replay cache and, for a round, `AGLYN_LIVE_AI_BATCH=1`. See the ladder in
 * `ai-job-site-plan-live.spec.ts`.
 */

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  ...jest.requireActual('./ai-jobs'),
  registerAiJobPlanStep: jest.fn(),
}))

import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import {
  aiBuildOrder,
  aiBuildPlanShapeRefusal,
  aiBuildUnits,
  type AiBuildOps,
} from '../model/ai-build-job'
import { isAiPlanNewRef } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { createAiJobPlanStep } from './ai-job-plan-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const NOW = new Date()

/** The founder's words, 2026-10-06. */
const CANONICAL_REQUEST =
  'create a few new pages and add forms for bookings and contact form and then an about page'

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-live'),
  layouts: [{ id: 'lay-site', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false }],
}

/**
 * The booking-service and product operations as their owners register them
 * (bookings' and commerce's `*-ai-capability.ts`), restated here because one
 * plugin's spec never imports another plugin. Only what the planner reads.
 */
const OWNER_CAPABILITIES: PluginAiCapability[] = [
  {
    op: 'booking-service',
    noun: 'booking service',
    where: 'Bookings → Services',
    intents: [
      'a service visitors can book online, with its length, weekly hours and price — set up as a draft to activate',
      'a way for visitors to book an appointment, consultation or estimate visit',
    ],
    argsSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What the service is called on the booking widget, e.g. "Free estimate visit".', maxLength: 80 },
        durationMinutes: { type: 'integer', description: 'How long one booking takes, in minutes.', minimum: 5, maximum: 480 },
        description: { type: 'string', description: 'One or two sentences on what the visitor is booking.', maxLength: 500 },
        days: {
          type: 'array',
          description: 'The weekdays it can be booked on.',
          items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
          maxItems: 7,
        },
        opensAt: { type: 'string', description: 'When bookable hours start on those days, 24-hour "HH:MM", e.g. "09:00".', maxLength: 5 },
        closesAt: { type: 'string', description: 'When bookable hours end on those days, 24-hour "HH:MM", e.g. "17:00".', maxLength: 5 },
        timezone: { type: 'string', description: 'The IANA time zone the hours are in, e.g. "America/Chicago".', maxLength: 64 },
        priceDisplay: {
          type: 'string',
          description: 'How the price is stated: "fixed", "varies", "estimate" or "contact". Use "fixed" only when the request states the price; otherwise "contact".',
          enum: ['fixed', 'varies', 'estimate', 'contact'],
        },
      },
      required: ['name', 'durationMinutes', 'days', 'opensAt', 'closesAt', 'timezone'],
      additionalProperties: false,
    },
    maxPerPlan: 5,
    freeAllowed: false,
    feature: 'bookings',
    quota: 'servicesPerHost',
    draftResource: 'booking-service',
    estimateCredits: () => 0,
    degrade: 'omit',
    pageBlocks: ['booking'],
  },
  {
    op: 'product',
    noun: 'product',
    where: 'Products → Catalog, as a draft',
    intents: ['products to sell, with a description, tags and options — created as drafts for you to price, photograph and activate'],
    argsSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The product name a shopper reads.', maxLength: 120 },
        description: { type: 'string', description: 'What the product is, in a short paragraph.', maxLength: 1200 },
      },
      required: ['name'],
      additionalProperties: false,
    },
    maxPerPlan: 12,
    freeAllowed: false,
    feature: 'commerce',
    draftResource: 'product',
    estimateCredits: () => 0,
    degrade: 'omit',
  },
]

const OPS: AiBuildOps = new Map<string, PluginAiCapability>(
  [...AI_OWNED_CAPABILITIES, ...OWNER_CAPABILITIES].map((one) => [one.op, one] as const),
)

const ORG = { plan: 'business' as const, billingStatus: 'active', ownerUid: 'owner-1' }

function buildJob(): AiJob {
  return {
    $id: 'job-live-canonical',
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

const describeLive = LIVE ? describe : describe.skip

describeLive('the canonical request, planned by the real model (AGL-3616)', () => {
  jest.setTimeout(15 * 60_000)

  it('keeps one plan that reuses the layout and makes the contact form, a booking service and an about page', async () => {
    const outcome = (await createAiJobPlanStep({
      readInventory: async () => INVENTORY,
      findPlansByKey: null,
      readCapabilities: async () => null,
      readOps: async () => OPS,
      admissionRefusal: async () => null,
    })({
      job: buildJob(),
      stepIndex: 0,
      now: NOW,
      firestore: aiEvalMemoryFirestore({}).firestore,
      org: ORG,
    } as never)) as unknown as Record<string, unknown>
    const plan = (outcome['plan'] ?? null) as AiJobPlan | null
    const review = outcome['review'] as { reason?: string; findings?: Array<{ code: string; message: string }> } | undefined
    const units = plan ? aiBuildUnits(plan) : []
    const order = (plan ? aiBuildOrder(units) ?? [] : []).map((unit) => unit.slot)
    const service = plan?.items?.find((item) => item.op === 'booking-service') ?? null
    const servicePage = service
      ? units.find((unit) => unit.screen?.sections.some((section) => section.uses.some((ref) => isAiPlanNewRef(ref) && ref.slice(4).trim().toLowerCase() === service.name.toLowerCase())))
      : undefined
    const form = plan?.create.find((creation) => creation.kind === 'form') ?? null
    const result = {
      planned: Boolean(plan) && (!review || review.reason === 'plan'),
      refused: outcome['refused'] === true,
      findings: (review?.findings ?? []).map((finding) => `${finding.code}: ${finding.message}`),
      shape: plan ? aiBuildPlanShapeRefusal(plan, { ops: OPS }) : 'no plan',
      layoutReused:
        Boolean(plan?.reuse.some((entry) => entry.id === 'lay-site')) ||
        Boolean(plan?.screens.length && plan.screens.every((screen) => screen.layout === 'lay-site')),
      layoutCreated: Boolean(plan?.create.some((creation) => creation.kind === 'layout')),
      form: form?.name ?? null,
      service: service ? { name: service.name, args: service.args } : null,
      servicePlacedBefore: Boolean(service && servicePage && order.indexOf(service.slot) < order.indexOf(servicePage.slot)),
      pages: plan?.screens.map((screen) => `${screen.title} ${screen.slug}`) ?? [],
      about: Boolean(plan?.screens.some((screen) => /about/i.test(`${screen.title} ${screen.slug}`))),
      estCostUsd: Number(outcome['estCostUsd'] ?? 0),
    }
    console.log(JSON.stringify({ run: aiLiveRunLedger(), result, plan }, null, 1))
    expect(result).toMatchObject({
      planned: true,
      refused: false,
      shape: null,
      layoutReused: true,
      layoutCreated: false,
      servicePlacedBefore: true,
      about: true,
    })
    expect(result.form).not.toBeNull()
    expect(result.pages.length).toBeGreaterThanOrEqual(3)
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
