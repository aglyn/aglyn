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
 * A build's pages planned "from a copy of" a page the site has (AGL-3832),
 * through the REAL build step and the REAL page step: written-page gate,
 * draft writer, layout-language check and compiler. Only the provider, the
 * inventory reader, the duplicate module, the listing generator, the stock
 * photos, the component's and the menu's runners and the bookings writer are
 * stand-ins, and Firestore is a double that honors transactions.
 *
 * The plan is the confirmed plan of build job `N1wPrdvh01` (Copper Kettle
 * Catering, production, 2026-10-15) as stored: About "from a copy of Our
 * Story", Contact "from a copy of Contact", Book a tasting from nothing, a
 * Page hero component, a Tasting consultation booking service and a menu
 * item adding the three pages. Production failed About and Contact with "The
 * page was not written from its plan.", 0 credits each: the page step copied
 * the source and generated nothing, the copy held the source's sections under
 * the source's ids, and the gate (AGL-3596) refused it — leaving "About" and
 * "Contact 2" behind as orphan screens, and the menu skipped for want of
 * About. What is held here:
 *
 *  - every page is generated from its plan into the job's own draft, and no
 *    copy is ever minted, so the gate passes and nothing is left behind;
 *  - a page planned from a copy is shown the words of the page it starts
 *    from, and the fresh page is shown none;
 *  - a page that still fails leaves the menu built with the pages that were
 *    made, and the menu is never handed an entry for the failed one.
 */

const mockRunAiRequest = jest.fn()
const mockReadInventory = jest.fn()
const mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))
jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'claude-sonnet-5',
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
jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  __esModule: true,
  duplicateResource: jest.fn(),
}))

import { encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import { AI_LAYOUT_PAGE_TOOL } from '../layout-language/ai-layout-language'
import type { AiBuildOps } from '../model/ai-build-job'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import type { AiJob, AiJobItemLedger, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import type { generateSeoFields } from '../runtime/seo-fields'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { createAiJobBuildStep } from './ai-job-build-step'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import { readAiDraftNodes } from './ai-job-drafts'
import { aiPageSectionNodeId } from './ai-job-page-sections'
import { AI_LAYOUT_START_PAGE_MAX_CHARS, aiLayoutStartPageLines } from './ai-job-page-language'
import { aiPageStartPage, createAiJobPageStep } from './ai-job-page-step'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'

const NOW = new Date('2026-10-15T18:58:00.000Z')
const USAGE = { inputTokens: 6_000, outputTokens: 1_200, cacheReadTokens: 0, cacheWriteTokens: 0 }

// ── Firestore double ─────────────────────────────────────────────────────

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), data)
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
  return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, where: () => query, get: query.get }
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
      set: (ref: DocTarget, data: Record<string, unknown>) => writes.push(() => mockDocs.set(ref.path, data)),
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

// ── The site, as it stood when the build ran ─────────────────────────────

const LAYOUT = 'V75WbkxbIR'
const FORM = '1DcKW7DEwd'
const OUR_STORY = '_NI9jNkoBd'
const CONTACT = 'mtMXNnNLvS'
const HERO = 'SU5IrkF11P'

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  layouts: [{ id: LAYOUT, name: 'Site layout', parentId: null }],
  screens: [
    { id: 'ugb5MGNC_2', name: 'Home', slug: '/', layoutId: LAYOUT, template: false },
    { id: OUR_STORY, name: 'Our Story', slug: 'our-story', layoutId: LAYOUT, template: false },
    { id: CONTACT, name: 'Contact', slug: 'contact', layoutId: LAYOUT, template: false },
  ],
  forms: [{ id: FORM, name: 'Catering inquiry form', fields: ['name', 'email', 'event date', 'guest count', 'message'] }],
  // The component the build makes first, as the inventory reads once it is made.
  components: [{ id: HERO, name: 'Page hero', props: { heading: 'string', intro: 'string' } }],
}

/** A published page of the site, whose words a page planned from its copy is shown. */
function sitePage(id: string, name: string, slug: string, words: string[]) {
  const nodes: Record<string, unknown> = {
    [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: words.map((_, index) => `${id}-w${index}`) },
  }
  words.forEach((text, index) => {
    nodes[`${id}-w${index}`] = { componentId: 'muiTypography', props: { variant: index ? 'body1' : 'h1', children: text } }
  })
  mockDocs.set(`hosts/host-1/screens/${id}`, { displayName: name, slug, versionId: `v-${id}`, deletedAt: null, layoutId: LAYOUT })
  mockDocs.set(`hosts/host-1/screens/${id}/versions/v-${id}`, { nodes: Buffer.from(encodeStoredNodes(nodes as never) as Uint8Array), layoutId: LAYOUT })
}

// ── The confirmed plan of job N1wPrdvh01, as stored ──────────────────────

const section = (name: string, uses: string[] = []) => ({ name, uses, items: 0 })

const PLAN = {
  status: 'confirmed',
  proposedAt: NOW,
  confirmedAt: NOW,
  confirmedBy: 'uid-1',
  labels: { [FORM]: 'Catering inquiry form', [OUR_STORY]: 'Our Story', [LAYOUT]: 'Site layout', [CONTACT]: 'Contact' },
  reuse: [
    { kind: 'layout', id: LAYOUT, purpose: 'Shared site layout with header and footer for all three pages' },
    { kind: 'form', id: FORM, purpose: 'Catering inquiry form placed on the Contact page' },
    { kind: 'screen', id: OUR_STORY, purpose: 'Nearest page to the About page; duplicated as its starting point' },
    { kind: 'screen', id: CONTACT, purpose: 'Nearest page to the Contact page; duplicated as its starting point' },
    { kind: 'theme', id: 'theme', purpose: 'Palette tokens, typography and spacing for all pages' },
  ],
  create: [
    {
      kind: 'component',
      name: 'Page hero',
      why: 'The same heading-and-intro hero opens all three new pages.',
      duplicateOf: null,
      fields: ['heading:string', 'intro:string'],
      id: HERO,
    },
  ],
  items: [
    {
      slot: 'i0',
      op: 'booking-service',
      name: 'Tasting consultation',
      why: 'The brief asks for a bookable tasting or consultation.',
      dependsOn: [],
      degrade: 'omit',
      args: {
        name: 'Tasting consultation',
        durationMinutes: 45,
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        opensAt: '09:00',
        closesAt: '17:00',
        timezone: 'America/Chicago',
        priceDisplay: 'contact',
      },
      id: 'TGZ_Yy0faN',
      credits: 0,
    },
    {
      slot: 'i1',
      op: 'navigation',
      name: 'Add new pages to header and footer',
      why: 'The new pages go in both menus.',
      dependsOn: ['new:Tasting consultation'],
      degrade: 'omit',
      args: {
        menu: 'both',
        layout: LAYOUT,
        add: ['About => new:About', 'Contact us => new:Contact', 'Book a tasting => new:Book a tasting'],
      },
      id: 'wgCW51bYQ1',
      credits: 0,
    },
  ],
  screens: [
    {
      title: 'About',
      slug: '/about',
      layout: LAYOUT,
      template: null,
      duplicateOf: OUR_STORY,
      nav: true,
      seoTitle: 'About Copper Kettle Catering | Austin Barbecue & Tex-Mex',
      seoDescription: 'Meet the family-run Austin caterer behind Copper Kettle Catering.',
      sections: [
        section('hero with page h1 and intro', ['new:Page hero']),
        section('our story: a family-run Austin kitchen'),
        section('what we serve: Texas barbecue and Tex-Mex'),
        section('who we cater for: weddings, office lunches, parties'),
        section('call to action to get in touch or book a tasting'),
      ],
      record: null,
      id: 'nB5I_Bn9Ec',
    },
    {
      title: 'Contact',
      slug: '/get-in-touch',
      layout: LAYOUT,
      template: null,
      duplicateOf: CONTACT,
      nav: true,
      seoTitle: 'Contact Copper Kettle Catering | Austin Catering Inquiries',
      seoDescription: 'Ask Copper Kettle Catering about your wedding, office lunch or party in Austin.',
      sections: [section('hero with page h1 and intro', ['new:Page hero']), section('catering inquiry form', [FORM]), section('contact details')],
      record: null,
      id: 'mguBcLwShP',
    },
    {
      title: 'Book a tasting',
      slug: '/book-a-tasting',
      layout: LAYOUT,
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Book a Tasting or Consultation | Copper Kettle Catering',
      seoDescription: 'Book an online consultation or tasting with Copper Kettle Catering.',
      sections: [section('hero with page h1 and intro', ['new:Page hero']), section('what to expect from a tasting or consultation')],
      record: null,
      id: '9NUpj-49Um',
    },
  ],
} as unknown as AiJobPlan

// ── The stand-ins ─────────────────────────────────────────────────────────

/** The bookings plugin's capability, as its contract registers it (never imported: one plugin's spec does not import another). */
const BOOKING_SERVICE: PluginAiCapability = {
  op: 'booking-service',
  noun: 'booking service',
  where: 'Bookings → Services',
  intents: ['a way for visitors to book an appointment, consultation or estimate visit'],
  argsSchema: { type: 'object', properties: {}, additionalProperties: false },
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

const SERVICE_WRITER: PluginResourceDraftWriter = {
  refusal: async () => null,
  check: () => ({ ok: true, facts: {} }),
  read: async () => null,
  write: async (request) => ({ ok: true, replayed: false, id: request.id, name: request.name, versionId: null, facts: {} }),
}

const block = (kind: string, text = '', extra: Record<string, unknown> = {}) => ({
  kind,
  col: -1,
  text,
  to: '',
  style: 'none',
  icon: '',
  items: [],
  ...extra,
})
const hero = (heading: string, intro: string) => ({
  band: 'soft',
  cols: [],
  align: 'start',
  blocks: [
    block('heading', heading, { style: 'large' }),
    block('component', '', {
      to: HERO,
      items: [
        { title: 'heading', text: heading, to: '', icon: '' },
        { title: 'intro', text: intro, to: '', icon: '' },
      ],
    }),
  ],
})
const plain = (heading: string, text: string, extra: Array<ReturnType<typeof block>> = []) => ({
  band: 'plain',
  cols: [],
  align: 'start',
  blocks: [block('heading', heading), block('text', text), ...extra],
})

/** Each page's one answer, in the layout language, as a model gives it. */
const ANSWERS: Record<string, unknown> = {
  About: {
    sections: [
      hero('About Copper Kettle Catering', 'A family-run Austin kitchen cooking Texas barbecue and Tex-Mex.'),
      plain('Our story', 'The Alvarez family opened Copper Kettle in 2009 with one smoker and a food truck.'),
      plain('What we serve', 'Brisket, smoked chicken, street tacos and handmade tortillas.'),
      plain('Who we cater for', 'Weddings, office lunches and backyard parties across Austin.'),
      plain('Plan your event', 'Tell us about your date and guest count.', [block('button', 'Book a tasting', { to: 'page:9NUpj-49Um', style: 'primary' })]),
    ],
  },
  Contact: {
    sections: [
      hero('Get in touch', 'Tell us about your event and we will reply within a day.'),
      plain('Send us your event details', 'The more we know, the better the menu we can suggest.', [block('form', '', { to: FORM })]),
      plain('Contact details', 'Call or email us, or visit the kitchen in East Austin.'),
    ],
  },
  'Book a tasting': {
    sections: [
      hero('Book a tasting', 'Taste the menu before your big day.'),
      plain('What to expect', 'A 45-minute sit-down with our chef, with five dishes to try.'),
    ],
  },
}

/** The page whose answer the provider refuses this time, if any. */
let refusedPage: string | null = null

function answerFor(request: { messages?: Array<{ content: unknown }> }) {
  const content = String(request.messages?.[0]?.content ?? '')
  const title = /^Page: "([^"]+)"/.exec(content)?.[1] ?? ''
  if (title === refusedPage) {
    return { kind: 'completion', text: '', toolUse: [], usage: USAGE, estCostUsd: 0.05, stopReason: 'refusal' }
  }
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name: AI_LAYOUT_PAGE_TOOL.name, input: ANSWERS[title] }],
    usage: USAGE,
    estCostUsd: 0.05,
    stopReason: 'tool_use',
  }
}

const duplicate = jest.fn() as unknown as jest.MockedFunction<typeof duplicateResource>
const seoFields = jest.fn() as unknown as jest.MockedFunction<typeof generateSeoFields>

/** The component the plan creates, written as the component step reports it. */
const componentRunner: AiJobStepRunner = async () =>
  ({
    outputs: [{ resource: 'reusableComponent', id: HERO, hostId: 'host-1', label: 'Page hero' } as AiJobOutput],
    usage: AI_JOB_ZERO_USAGE,
    estCostUsd: 0.02,
    model: 'm',
    stopReason: 'end_turn',
  }) satisfies AiJobStepOutcome

function job(): AiJob {
  return {
    $id: 'N1wPrdvh01',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'build',
    status: 'running',
    brief: 'Create a few new pages and add forms for bookings and a contact form, and then an about page',
    inputs: {},
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 4 },
      { name: 'generate', status: 'running', creditsSpent: 0 },
    ],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: PLAN,
    review: null,
  } as unknown as AiJob
}

/** Every pass of the build, the ledger kept as the machine keeps it, until nothing is left. */
async function built() {
  const menus: AiJob[] = []
  const navigationRunner: AiJobStepRunner = async ({ job: handed }) => {
    menus.push(handed)
    return {
      outputs: [{ resource: 'layout', id: LAYOUT, versionId: 'v-menu', hostId: 'host-1', label: 'Site layout' } as AiJobOutput],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
      model: 'm',
      stopReason: 'end_turn',
    }
  }
  const page = createAiJobPageStep({ seoFields, duplicate, stockPhotos: () => null })
  const step = createAiJobBuildStep({
    runnerFor: ((kind: string) =>
      kind === 'page' ? page : kind === 'component' ? componentRunner : kind === 'navigation' ? navigationRunner : null) as never,
    writerFor: (resource) => (resource === 'booking-service' ? SERVICE_WRITER : null),
    opsFor: async () => OPS,
    pluginAdmission: async () => null,
    admissionFor: async () => null,
  })
  let current = job()
  for (let pass = 0; pass < 30; pass++) {
    const outcome = await step({ job: current, stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' as const } })
    const ledger: AiJobItemLedger[] = (outcome.items ?? current.items ?? []).map((row) =>
      outcome.item && row.slot === outcome.item.slot
        ? ({ ...row, status: outcome.item.status, outputs: outcome.item.outputs ?? [], note: outcome.item.note ?? null, failure: outcome.item.failure ?? null, degradedBy: outcome.item.degradedBy } as AiJobItemLedger)
        : row,
    )
    current = { ...current, items: ledger, outputs: [...(current.outputs ?? []), ...outcome.outputs] }
    if (!outcome.continue) break
  }
  const prompts = mockRunAiRequest.mock.calls.map(([request]) => String(request.messages?.[0]?.content ?? ''))
  return { current, ledger: current.items ?? [], menus, prompts }
}

beforeEach(() => {
  mockRunAiRequest.mockReset().mockImplementation(async (request) => answerFor(request))
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
  // Core's duplicate, as production ran it: the source's screen and nodes,
  // byte for byte, under an id core mints and a "copy" address.
  duplicate.mockReset().mockImplementation((async (_kind: string, input: { sourceId: string; name: string }) => {
    const id = `copy-${input.sourceId}`
    const source = mockDocs.get(`hosts/host-1/screens/${input.sourceId}`) ?? {}
    mockDocs.set(`hosts/host-1/screens/${id}`, { ...source, displayName: input.name, slug: `${source['slug']}-copy` })
    mockDocs.set(`hosts/host-1/screens/${id}/versions/${source['versionId']}`, {
      ...mockDocs.get(`hosts/host-1/screens/${input.sourceId}/versions/${source['versionId']}`),
    })
    return { ok: true, id, versionId: source['versionId'], name: input.name }
  }) as never)
  seoFields.mockReset().mockResolvedValue({ status: 'refused', attempts: 1, usage: AI_JOB_ZERO_USAGE, effort: null, estCostUsd: 0, model: 'm', stopReason: 'end_turn' } as never)
  mockDocs.clear()
  refusedPage = null
  mockDocs.set('hosts/host-1', {
    subdomain: 'copper-kettle-catering',
    displayName: 'Copper Kettle Catering',
    memberRoles: { 'uid-1': 'owner' },
    screens: { ugb5MGNC_2: '/', [OUR_STORY]: 'our-story', [CONTACT]: 'contact' },
  })
  mockDocs.set('orgs/org-1', { plan: 'pro', billingStatus: 'active' })
  sitePage(OUR_STORY, 'Our Story', 'our-story', ['Our Story', 'The Alvarez family started Copper Kettle Catering in East Austin in 2009.'])
  sitePage(CONTACT, 'Contact', 'contact', ['Contact', 'Call us at (512) 555-0142 or write to hello@copperkettle.example.'])
})

describe('a build’s pages planned from a copy (AGL-3832)', () => {
  it('builds every page from its plan into its own draft, and mints no copy', async () => {
    const { ledger } = await built()
    // Production: p0 and p1 failed, "The page was not written from its plan.", and i1 was skipped.
    expect(ledger.map((row) => [row.slot, row.status, row.failure?.message ?? null])).toEqual([
      ['c0', 'succeeded', null],
      ['i0', 'succeeded', null],
      ['i1', 'succeeded', null],
      ['p0', 'succeeded', null],
      ['p1', 'succeeded', null],
      ['p2', 'succeeded', null],
    ])
    // No orphan "About" or "Contact 2": nothing was ever copied.
    expect(duplicate).not.toHaveBeenCalled()
    // Each page is the draft the job named, at its planned address, holding
    // its plan's sections under its own ids.
    for (const screen of PLAN.screens) {
      expect(ledger.find((one) => one.label === screen.title)?.outputs).toEqual([screen.id])
      expect(mockDocs.get(`hosts/host-1/screens/${screen.id}`)?.['slug']).toBe(screen.slug.slice(1))
      const stored = await readAiDraftNodes(firestore, { kind: 'screen', hostId: 'host-1', id: screen.id as string })
      screen.sections.forEach((_, index) => expect(stored?.nodes).toHaveProperty([aiPageSectionNodeId(screen.id as string, index)]))
    }
    // The site already has a page called Contact, so the plan's second one is
    // numbered, as any draft named like a live page is.
    expect(PLAN.screens.map((screen) => mockDocs.get(`hosts/host-1/screens/${screen.id}`)?.['displayName'])).toEqual([
      'About',
      'Contact 2',
      'Book a tasting',
    ])
  })

  it('shows a page planned from a copy the words of the page it starts from, and the fresh page none', async () => {
    const { prompts } = await built()
    const promptOf = (title: string) => prompts.find((one) => one.startsWith(`Page: "${title}"`)) ?? ''
    expect(promptOf('About')).toContain(`This page starts from the site's page "Our Story"`)
    expect(promptOf('About')).toContain('The Alvarez family started Copper Kettle Catering in East Austin in 2009.')
    expect(promptOf('Contact')).toContain(`This page starts from the site's page "Contact"`)
    expect(promptOf('Contact')).toContain('(512) 555-0142')
    expect(promptOf('Book a tasting')).not.toContain('This page starts from')
  })

  it('a page that still fails leaves the menu built with the pages that were made', async () => {
    refusedPage = 'About'
    const { ledger, menus } = await built()
    const row = (slot: string) => ledger.find((one) => one.slot === slot)
    expect(row('p0')?.status).toBe('failed')
    expect(row('p1')?.status).toBe('succeeded')
    expect(row('p2')?.status).toBe('succeeded')
    expect(row('i1')).toMatchObject({
      status: 'degraded',
      degradedBy: ['p0'],
      note: 'Built without the page “About”: it could not be created.',
    })
    // The menu is handed the pages that were made, and no entry for the one that was not.
    expect(menus).toHaveLength(1)
    expect(menus[0].inputs?.['add']).toEqual(['Contact us => new:Contact', 'Book a tasting => new:Book a tasting'])
    expect(duplicate).not.toHaveBeenCalled()
  })
})

describe('the page a planned page starts from (AGL-3832)', () => {
  it('is read off the site by its words, and never off the starter home page, an entry template or a page it does not have', async () => {
    const inventory = {
      screens: [
        ...INVENTORY.screens,
        { id: 'scr-starter', name: 'Home', slug: '/', layoutId: LAYOUT, template: false, replaceable: true as const },
        { id: 'scr-post', name: 'Blog — Entry Template', slug: 'blog-post', layoutId: LAYOUT, template: true },
      ],
    }
    sitePage('scr-starter', 'Home', '/', ['Welcome', 'Your new site starts here.'])
    sitePage('scr-post', 'Blog — Entry Template', 'blog-post', ['{{item.title}}'])
    expect(await aiPageStartPage(firestore, { hostId: 'host-1', screen: { duplicateOf: OUR_STORY }, inventory })).toEqual({
      label: 'Our Story',
      text: expect.stringContaining('The Alvarez family started Copper Kettle Catering'),
    })
    for (const duplicateOf of [null, 'scr-starter', 'scr-post', 'scr-gone']) {
      expect(await aiPageStartPage(firestore, { hostId: 'host-1', screen: { duplicateOf }, inventory })).toBeNull()
    }
    // A page whose words cannot be read is built from its plan alone.
    const unreadable = jest.fn().mockRejectedValue(new Error('unavailable'))
    expect(await aiPageStartPage(firestore, { hostId: 'host-1', screen: { duplicateOf: OUR_STORY }, inventory }, unreadable)).toBeNull()
  })

  it('shows at most its first few thousand characters, and nothing for a page with no words', () => {
    const [line, text] = aiLayoutStartPageLines({ label: 'Our Story', text: 'Brisket. '.repeat(1_000) })
    expect(line).toBe(
      `This page starts from the site's page "Our Story": keep its facts, names and details wherever a section below covers them, and design every section anew. Its text:`,
    )
    expect(text.length).toBeLessThanOrEqual(AI_LAYOUT_START_PAGE_MAX_CHARS + 2)
    expect(text.endsWith(' …')).toBe(true)
    expect(aiLayoutStartPageLines({ label: 'Our Story', text: '  ' })).toEqual([])
    expect(aiLayoutStartPageLines(null)).toEqual([])
  })
})
