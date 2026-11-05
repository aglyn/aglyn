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
 * Improve it, generative (AGL-4152), the site's plan and a redesign's pictures,
 * with no model and no picture made: the plan's tool, its prompt and what holds
 * it; the pass, its review and its fallback; the frame it draws; the design it
 * gives every page; what it is quoted at; the order a slot fills in; and the flag
 * off leaving every one of these as it was.
 */

const mockRunAiRequest = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => null,
  getOrgForUser: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__now__' },
}))

import { aiLayoutDesignChoices, aiLayoutPlannedChoicesOf } from '../layout-language/ai-layout-design'
import { aiLayoutSourceHeader, type AiLayoutFrameSource } from '../layout-language/ai-layout-frame-source'
import { aiCompileLayoutFrame } from '../layout-language/ai-layout-frame'
import { aiLayoutDropEmptyPictures, aiLayoutPictureSlots, aiResolveLayoutPictures, AI_LAYOUT_NO_PHOTO, type AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { AiLayoutTreeBuilder } from '../layout-language/ai-layout-tree'
import { AI_MEASURED_IMPORT_CREDITS, AI_MEASURED_PAID_SITE_CREDITS } from '../model/ai-credit-estimate'
import type { AiJob, AiJobItemLedger } from '../model/ai-jobs.types'
import {
  AI_SITE_IMPORT_GENERATED_PICTURES_PER_PAGE,
  AI_SITE_IMPORT_PROPOSED_NOT_WRITTEN,
  AI_SITE_IMPORT_PROPOSED_SLOT,
  aiSiteImportCreditRange,
  aiSiteImportHasRoomForPage,
  aiSiteImportNextWork,
  aiSiteImportPlanIn,
  aiSiteImportPlanRow,
  aiSiteImportPlanUpdate,
  aiSiteImportQuoteText,
  aiSiteImportRedesignOf,
  aiSiteImportWaveCreditRange,
  aiSiteImportWaveOwed,
  aiSiteImportWaveStamped,
  type AiSiteImportPage,
  type AiSiteImportPlan,
  type AiSiteImportState,
} from '../model/ai-site-import'
import {
  aiSiteImportAddedText,
  aiSiteImportPicturesText,
  aiSiteImportPlanFellBackText,
  aiSiteImportPlanViewOf,
  aiSiteImportWaveQuote,
  aiSiteImportWaveRows,
  aiSiteImportWhatsNew,
} from '../model/ai-site-import-view'
import { siteImportReplayDocument } from '../site-import/fixtures/site-import-fidelity-replay'
import { SITE_IMPORT_IMPROVE_ANSWERS } from '../site-import/fixtures/site-import-improve-answers'
import {
  aiSiteImportDesignInputs,
  aiSiteImportDocumentFor,
  aiSiteImportFrameJob,
  aiSiteImportFrameSource,
  aiSiteImportLogoHeight,
  aiSiteImportLogoHoldsName,
  aiSiteImportMenuPageIds,
  aiSiteImportPageJob,
  aiSiteImportRunMinimumMs,
  createAiJobImportStep,
  type AiSiteImportStepDeps,
} from './ai-job-import-step'
import { aiLayoutSiteBrandOf } from './ai-job-layout-language'
import { aiLayoutDesignOf, aiRunLayoutPage } from './ai-job-page-language'
import { aiSiteImportSectionNames } from './ai-site-import-compile'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, aiSiteImportDocumentOf, type AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportHonesty } from './ai-site-import-honesty'
import { aiSiteImportImproveDestinations, aiSiteImportImproveLedger, aiSiteImportImprovePrompt } from './ai-site-import-improve'
import {
  aiSiteImportGeneratedSlots,
  aiSiteImportPagePicturesOf,
  aiSiteImportPictureMaker,
  aiSiteImportPictureShape,
  aiSiteImportPictureSource,
  aiSiteImportPictureTally,
} from './ai-site-import-pictures'
import {
  AI_SITE_IMPORT_PLAN_BUDGET,
  AI_SITE_IMPORT_PLAN_TEXT,
  AI_SITE_IMPORT_PLAN_TOOL,
  aiRunSiteImportPlan,
  aiSiteImportPlanInstructions,
  aiSiteImportPlanPrompt,
  aiSiteImportPlanRead,
} from './ai-site-import-plan'

const NOW = new Date('2026-11-05T18:00:00.000Z')

const blocks = (title: string, line: string) => [
  { kind: 'heading' as const, level: 1 as const, text: title, region: 'main' as const },
  { kind: 'paragraph' as const, text: line, region: 'main' as const },
]

const page = (slot: string, path: string, title: string, line: string, rest: Partial<AiSiteImportPage> = {}): AiSiteImportPage => ({
  slot,
  url: `https://x.example${path}`,
  path,
  title,
  group: 'main',
  wave: 1,
  draftId: `d-${slot}`,
  slug: path === '/' ? '/' : path.slice(1),
  words: 120,
  images: 0,
  build: 'arranged',
  wording: 'improved',
  read: { at: 'x', title, text: line, sections: [title], images: [], blocks: blocks(title, line), words: 40, forms: [], layout: null },
  ...rest,
})

const FORM = { action: 'https://x.example/send', method: 'post', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }] }

const site = (patch: Partial<AiSiteImportState> = {}): AiSiteImportState =>
  ({
    domain: 'x.example',
    siteName: 'Larkspur Tax Studio',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: 'x',
    pageLimit: 25,
    existingPages: 0,
    found: 4,
    stoppedBy: null,
    groups: [],
    pages: [
      page('p0', '/', 'Home', 'Tax preparation and bookkeeping for small businesses.'),
      page('p1', '/services', 'Services', 'Tax preparation, planning and bookkeeping.'),
      page('p2', '/about', 'About', 'We help you keep more of what you earn.'),
      page('p3', '/contact', 'Contact', 'Write to us or call us.', { read: { at: 'x', title: 'Contact', text: '', sections: [], images: [], blocks: blocks('Contact', 'Write to us or call us.'), words: 6, forms: [FORM as never], layout: null } }),
      page('p4', '/privacy', 'Privacy policy', 'How we keep your details.', { wording: 'kept' }),
      page('p5', '/news/one', 'Our first note', 'A note.', { group: 'news', wave: 2, build: 'copied', wording: 'kept' }),
    ],
    waves: [
      { index: 1, label: 'Main pages', group: 'main', slots: ['p0', 'p1', 'p2', 'p3', 'p4'], frame: true, status: 'running', startedAt: 'x', finishedAt: null, finish: 'improve', wording: true, generative: true },
      { index: 2, label: 'News', group: 'news', slots: ['p5'], frame: false, status: 'waiting', startedAt: null, finishedAt: null },
    ],
    leftOut: [],
    leftOutCount: {},
    frame: { draftId: 'frameDraft' },
    finish: 'improve',
    wording: true,
    generative: true,
    home: {
      url: 'https://x.example/',
      title: 'Larkspur Tax Studio',
      description: 'Tax preparation for small businesses.',
      ogImage: null,
      siteName: 'Larkspur Tax Studio',
      brand: { kind: 'logo-and-name', text: 'Larkspur Tax Studio', logo: { url: 'https://x.example/logo.png', alt: 'Larkspur Tax Studio', type: 'image/png' } },
      facts: { lines: ['Call (555) 014-2200'], emails: ['hello@x.example'], phones: ['(555) 014-2200'], social: [], address: '12 Main Street' },
      nav: {
        items: [
          { label: 'Services', href: 'https://x.example/services', items: [] },
          { label: 'About', href: 'https://x.example/about', items: [] },
          { label: 'Contact', href: 'https://x.example/contact', items: [] },
        ],
        ctas: [],
        background: null,
      },
    },
    look: { at: 'x', theme: 'applied', colors: [], logo: { mediaId: 'm1', src: 'media:host/m1', width: 600, height: 150 }, seo: true, seed: 11, style: {} },
    ...patch,
  }) as unknown as AiSiteImportState

const answer = (patch: Record<string, unknown> = {}) => ({
  site: { what: 'Tax preparation and bookkeeping for small businesses.', audience: 'small businesses', kind: 'professional', voice: 'plain and calm' },
  nav: {
    groups: [
      { label: 'Services', pages: ['d-p1'] },
      { label: 'About', pages: ['d-p2'] },
      { label: 'Common questions', pages: ['new'] },
      { label: 'Contact', pages: ['d-p3'] },
    ],
    cta: { label: 'Start now', target: 'form' },
    footer: [
      { label: 'Company', pages: ['d-p1', 'd-p2'] },
      { label: 'Help', pages: ['d-p3', 'd-p4'] },
    ],
  },
  design: { hero: 'panel', group: 'ruled', rhythm: 'alternate', cta: 'band' },
  proposed: { title: 'Common questions', slug: 'common-questions', purpose: 'What people ask about tax preparation and bookkeeping.' },
  ...patch,
})

const scopeOf = (state: AiSiteImportState) => [
  state.siteName,
  'Tax preparation and bookkeeping for small businesses.',
  'small businesses',
  ...state.pages.map((entry) => entry.title),
  ...state.pages.flatMap((entry) => (entry.read?.blocks ?? []).map((block) => (block.kind === 'image' ? '' : block.text))),
  'plain calm common questions how to reach us',
]

const hold = (raw: unknown, state = site(), rest: Partial<Parameters<typeof aiSiteImportPlanRead>[1]> = {}) =>
  aiSiteImportPlanRead(raw, { state, scope: scopeOf(state), required: aiSiteImportMenuPageIds(state), roomForPage: true, ...rest })

const planOf = (state = site(), raw: unknown = answer()): AiSiteImportPlan => {
  const held = hold(raw, state)
  if (!held.plan) throw new Error(JSON.stringify(held.violations))
  return held.plan
}

const planned = (patch: Partial<AiSiteImportState> = {}) => {
  const state = site(patch)
  return aiSiteImportPlanIn(state, { index: 1 }, planOf(state), 'x', 'd-new')
}

const accepted = (patch: Partial<AiSiteImportState> = {}) => {
  const state = planned(patch)
  return { ...state, planAccepted: true as const }
}

describe('the plan’s tool and text', () => {
  it('is strict, and every field is always written', () => {
    expect(AI_SITE_IMPORT_PLAN_TOOL.name).toBe('submit_site_plan')
    expect(AI_SITE_IMPORT_PLAN_TOOL.strict).toBe(true)
    expect(AI_SITE_IMPORT_PLAN_TOOL.inputSchema).toMatchObject({ additionalProperties: false, required: ['site', 'nav', 'design', 'proposed'] })
  })

  it('caches its text, says what it may not invent, and names no site', () => {
    expect(aiSiteImportPlanInstructions().at(-1)).toMatchObject({ text: AI_SITE_IMPORT_PLAN_TEXT, cacheBreakpoint: true })
    expect(AI_SITE_IMPORT_PLAN_TEXT).toMatch(/Never write a name, number, price, date, testimonial, client, award, credential, address or guarantee/)
    expect(AI_SITE_IMPORT_PLAN_TEXT).not.toMatch(/Larkspur|squarespace|\.com\b/i)
  })

  it('fences the site’s words, marks what each page holds, and says whether a new page fits', () => {
    const state = site()
    const prompt = aiSiteImportPlanPrompt({ state, required: aiSiteImportMenuPageIds(state), roomForPage: true })
    expect(prompt).toContain('d-p3 | /contact | Contact | 6 words | in the menu, holds a form')
    expect(prompt).toContain('d-p4 | /privacy | Privacy policy | 40 words | a policy')
    expect(prompt).toContain('There is room for one new page.')
    expect(prompt).toContain('The site gives a phone number.')
    expect(prompt).toContain('untrusted')
    expect(aiSiteImportPlanPrompt({ state, required: [], roomForPage: false })).toContain('There is no room for a new page')
  })
})

describe('what holds a plan', () => {
  it('takes a real plan, and names the form’s page where the button goes to the form', () => {
    const { plan, violations } = hold(answer())
    expect(violations).toEqual([])
    expect(plan?.nav.primaryCta).toEqual({ label: 'Start now', target: 'form', page: 'd-p3' })
    expect(plan?.proposed).toMatchObject({ title: 'Common questions', slug: 'common-questions', on: true })
  })

  it.each([
    ['a menu entry that is no page', { nav: { ...answer().nav, groups: [{ label: 'Services', pages: ['d-nope'] }] } }, /is not a page of this site/],
    ['a page of the old menu left out', { nav: { ...answer().nav, groups: [{ label: 'Services', pages: ['d-p1'] }], footer: [{ label: 'Help', pages: ['d-p4'] }] } }, /in the old menu and nowhere in the new one/],
    ['the home page in the menu', { nav: { ...answer().nav, groups: [{ label: 'Home', pages: ['d-p0'] }, ...answer().nav.groups] } }, /the logo goes home/],
    ['more than six entries', { nav: { ...answer().nav, groups: Array.from({ length: 7 }, (_, at) => ({ label: `Entry ${'abcdefg'[at]}`, pages: ['d-p1', 'd-p2', 'd-p3'] })) } }, /at most 6/],
    ['a button to no page', { nav: { ...answer().nav, cta: { label: 'Go', target: 'd-nope' } } }, /is not a page of this site/],
    ['a page of the new one nowhere', { nav: { ...answer().nav, groups: [{ label: 'Services', pages: ['d-p1', 'd-p2', 'd-p3'] }] } }, /linked from nowhere/],
    ['the new page named with none proposed', { proposed: { title: '', slug: '', purpose: '' } }, /names the new page, and proposed is empty/],
    ['a slug already taken', { proposed: { title: 'Common questions', slug: 'about', purpose: 'What people ask.' } }, /is already a page of this site/],
    ['a slug that is no address', { proposed: { title: 'Common questions', slug: 'Common Questions', purpose: 'What people ask.' } }, /lowercase words and hyphens/],
    ['a title already a page', { proposed: { title: 'About', slug: 'about-us', purpose: 'Who we are.' } }, /is already a page of this site/],
    ['a design the tool does not list', { design: { hero: 'collage', group: 'ruled', rhythm: 'alternate', cta: 'band' } }, /each one of the values/],
    ['a kind the tool does not list', { site: { ...answer().site, kind: 'spaceship' } }, /site\.kind/],
  ])('refuses %s', (_, patch, message) => {
    const { plan, violations } = hold(answer(patch))
    expect(plan).toBeNull()
    expect(violations.map((violation) => violation.message).join(' ')).toMatch(message)
  })

  it('refuses a button to a form no page holds, and to a phone the site does not give', () => {
    const state = site({ pages: site().pages.map((entry) => ({ ...entry, read: entry.read ? { ...entry.read, forms: [] } : null })) })
    expect(hold(answer(), state).violations.map((violation) => violation.message).join(' ')).toMatch(/no page of this site holds a form/)
    const silent = site({ home: { ...site().home, facts: { ...site().home?.facts, phones: [] } } as never })
    expect(hold(answer({ nav: { ...answer().nav, cta: { label: 'Call us', target: 'phone' } } }), silent).violations.map((violation) => violation.message).join(' ')).toMatch(/gives no phone number/)
  })

  it('takes no new page where the plan’s count has no room', () => {
    const { plan, violations } = hold(answer(), site(), { roomForPage: false })
    expect(plan).toBeNull()
    expect(violations.map((violation) => violation.message).join(' ')).toMatch(/no room for a new page/)
  })

  it('holds every word to what the site says: a label, a line or a new page’s purpose', () => {
    for (const patch of [
      { site: { ...answer().site, what: 'Trusted by 900 clients since 1998.' } },
      { nav: { ...answer().nav, groups: [{ label: 'Our Award Winners', pages: ['d-p1', 'd-p2', 'd-p3', 'new'] }] } },
      { proposed: { title: 'Common questions', slug: 'common-questions', purpose: 'Our money-back guarantee, licensed and insured.' } },
    ]) {
      const { plan, violations } = hold(answer(patch))
      expect(plan).toBeNull()
      expect(violations.some((violation) => violation.code === 'improve-invented-fact')).toBe(true)
    }
  })
})

describe('the plan’s answer, asked', () => {
  const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const toolAnswer = (input: unknown) => ({ kind: 'completion', text: '', toolUse: [{ name: 'submit_site_plan', input }], usage: ZERO_USAGE, estCostUsd: 0, stopReason: 'tool_use' })

  beforeEach(() => mockRunAiRequest.mockReset())

  const ask = () => {
    const state = site()
    return aiRunSiteImportPlan({ state, scope: scopeOf(state), required: aiSiteImportMenuPageIds(state), roomForPage: true, model: 'claude-sonnet-5-5' })
  }

  it('re-asks once naming the line, and takes the mended answer', async () => {
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(answer({ site: { ...answer().site, what: 'Trusted by 900 clients.' } }))).mockResolvedValueOnce(toolAnswer(answer()))
    const result = await ask()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(result.status).toBe('ok')
    const request = mockRunAiRequest.mock.calls[1]?.[0] as { messages: Array<{ content: unknown }>; tools: Array<{ name: string }> }
    expect(request.tools.map((tool) => tool.name)).toEqual(['submit_site_plan'])
    expect(String(request.messages.at(-1)?.content)).toContain('Trusted by 900 clients.')
  })

  it('misses twice as no plan', async () => {
    mockRunAiRequest.mockResolvedValue(toolAnswer({ site: {}, nav: {}, design: {}, proposed: {} }))
    expect((await ask()).status).toBe('needs_input')
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
  })
})

/*------------------------------------------
 * The pass
 *-----------------------------------------*/

const importJob = (state: AiSiteImportState, items: AiJobItemLedger[]): AiJob =>
  ({
    $id: 'job1',
    orgId: 'org-pro',
    hostId: 'host-1',
    kind: 'import',
    status: 'running',
    brief: 'Bring in x.example',
    inputs: { domain: 'x.example' },
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    siteImport: state,
    items,
  }) as unknown as AiJob

const row = (slot: string, status: AiJobItemLedger['status'] = 'pending'): AiJobItemLedger => ({ slot, op: 'page', label: slot, status, attempt: 1, creditsSpent: 0, creditsRefunded: 0, outputs: [] })
const rows = (state: AiSiteImportState) => [row('frame'), ...state.pages.map((entry) => row(entry.slot))]

const stepDeps = (patch: Partial<AiSiteImportStepDeps> = {}): AiSiteImportStepDeps => ({
  runnerFor: (() => null) as never,
  ownership: async () => ({ current: true, method: 'dns', provenAt: 1, detail: 'x' }),
  rateLimit: async () => ({ allowed: true }),
  releaseFlagOn: async () => true,
  generativeFlagOn: async () => true,
  ingest: () => null,
  readRoom: async () => ({ limit: 25, used: 0 }),
  readSiteName: async () => 'Larkspur Tax Studio',
  pageWritten: async () => true,
  mintId: () => 'd-new',
  ...patch,
})

const pass = (deps: AiSiteImportStepDeps, state: AiSiteImportState, items = rows(state)) =>
  createAiJobImportStep(deps)({ job: importJob(state, items), stepIndex: 0, now: NOW, firestore: {} as never, org: { plan: 'pro' } as never })

const spend = { attempts: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }, estCostUsd: 0.05, model: 'm', stopReason: 'tool_use' as const }

describe('the plan’s pass', () => {
  it('runs once, after the first wave’s read and before its look; never for Keep my site, or with the flag off', () => {
    const state = site()
    expect(aiSiteImportNextWork(state, rows(state))).toMatchObject({ kind: 'plan' })
    expect(aiSiteImportNextWork({ ...state, plan: null }, rows(state))).toMatchObject({ kind: 'frame' })
    const shown = planned()
    expect(aiSiteImportNextWork(shown, rows(shown))).toMatchObject({ kind: 'plan-accepted' })
    const off = { ...state, waves: state.waves.map(({ generative: _generative, ...wave }) => wave) }
    expect(aiSiteImportNextWork(off, rows(off))).toMatchObject({ kind: 'frame' })
    // A later wave is never planned.
    const later = { ...state, waves: [{ ...state.waves[0], status: 'done' as const }, { ...state.waves[1], status: 'running' as const, startedAt: 'x', generative: true as const }] } as AiSiteImportState
    expect(aiSiteImportNextWork(later, rows(later))).not.toMatchObject({ kind: 'plan' })
  })

  it('holds a beat long enough for its answer and its one re-ask, and asks none for the owner’s say-so', () => {
    const state = site()
    expect(aiSiteImportRunMinimumMs(importJob(state, rows(state)))).toBe(AI_SITE_IMPORT_PLAN_BUDGET.minimumMs)
    const shown = planned()
    expect(aiSiteImportRunMinimumMs(importJob(shown, rows(shown)))).toBe(0)
  })

  it('stamps a generative wave under Improve it, with new copy or without, and never under Keep my site', () => {
    const base = site()
    const waiting = { ...base, waves: base.waves.map(({ generative: _generative, ...wave }) => wave) } as AiSiteImportState
    expect(aiSiteImportWaveStamped({ ...waiting, wording: false }, 1, { generative: true }).waves[0]?.generative).toBe(true)
    expect(aiSiteImportWaveStamped({ ...waiting, finish: 'keep', wording: false }, 1, { generative: true }).waves[0]?.generative).toBeUndefined()
    // New copy off: words kept, the page's own design answer, and no ledger.
    const off = aiSiteImportWaveStamped({ ...waiting, wording: false }, 1, { generative: true })
    expect(off.pages[1]?.wording).toBe('kept')
    expect(aiSiteImportDocumentFor(off, off.pages[1] as AiSiteImportPage)?.generative).toBeUndefined()
  })

  it('shows the plan and waits: the proposed page among the rows, nothing built, the plan’s spend on the pass', async () => {
    const plan = planOf()
    const runPlan = jest.fn(async () => ({ ...spend, status: 'ok' as const, value: plan }))
    const state = site()
    const outcome = await pass(stepDeps({ plan: runPlan as never }), state)
    expect(runPlan).toHaveBeenCalledWith(expect.objectContaining({ roomForPage: true, required: ['d-p1', 'd-p2', 'd-p3'] }))
    expect(outcome.review?.reason).toBe('wave')
    expect(outcome.estCostUsd).toBe(0.05)
    expect(outcome.continue).toBeUndefined()
    const next = outcome.siteImport as AiSiteImportState
    expect(next.plan?.proposed).toMatchObject({ draftId: 'd-new', on: true })
    expect(next.plan?.nav.groups.find((group) => group.label === 'Common questions')?.pages).toEqual(['d-new'])
    expect(next.pages.at(-1)).toMatchObject({ slot: AI_SITE_IMPORT_PROPOSED_SLOT, origin: 'proposed', slug: 'common-questions', wording: 'improved' })
    expect(next.waves[0]?.slots).toContain(AI_SITE_IMPORT_PROPOSED_SLOT)
    expect(outcome.items?.find((entry) => entry.slot === AI_SITE_IMPORT_PROPOSED_SLOT)).toMatchObject({ status: 'pending', op: 'page' })
  })

  it.each([
    ['misses twice', async () => ({ ...spend, status: 'needs_input' as const, violations: [], message: 'x' })],
    ['is refused', async () => ({ ...spend, status: 'refused' as const })],
    ['throws', async () => {
      throw new Error('no')
    }],
  ])('falls back to the import’s own frame and design and goes on, when it %s', async (_, runPlan) => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const outcome = await pass(stepDeps({ plan: runPlan as never }), site())
    const next = outcome.siteImport as AiSiteImportState
    expect(next.plan).toBeNull()
    expect(outcome.review).toBeUndefined()
    expect(outcome.continue).toBe(true)
    expect(aiSiteImportPlanFellBackText(next)).toMatch(/did not pass/)
    expect(aiSiteImportFrameSource(next, next.waves[0] as never)?.planned).toBeUndefined()
    expect(aiSiteImportDesignInputs(next, next.waves[0])).toEqual(aiSiteImportDesignInputs(site({ plan: null })))
    jest.restoreAllMocks()
  })

  it('asks for no new page with new copy off, or with no room', async () => {
    const runPlan = jest.fn(async () => ({ ...spend, status: 'refused' as const }))
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
    await pass(stepDeps({ plan: runPlan as never, readRoom: async () => ({ limit: 6, used: 0 }) }), site())
    expect(runPlan.mock.calls[0]).toEqual([expect.objectContaining({ roomForPage: false })])
    await pass(stepDeps({ plan: runPlan as never }), site({ wording: false }))
    expect(runPlan.mock.calls[1]).toEqual([expect.objectContaining({ roomForPage: false })])
    jest.restoreAllMocks()
    expect(aiSiteImportHasRoomForPage(site(), { limit: 7, used: 0 })).toBe(true)
    expect(aiSiteImportHasRoomForPage(site(), { limit: 6, used: 0 })).toBe(false)
    expect(aiSiteImportHasRoomForPage(site(), { limit: null, used: 99 })).toBe(true)
  })

  it('builds with its new page once the owner starts the build, and without it where they switched it off', async () => {
    const shown = planned()
    const items = aiSiteImportPlanRow(shown, rows(site()))
    const kept = await pass(stepDeps(), shown, items)
    expect(kept.continue).toBe(true)
    expect((kept.siteImport as AiSiteImportState).planAccepted).toBe(true)
    expect(kept.items?.some((entry) => entry.slot === AI_SITE_IMPORT_PROPOSED_SLOT)).toBe(true)

    const switched = { ...shown, plan: { ...shown.plan, proposed: { ...shown.plan?.proposed, on: false } } } as AiSiteImportState
    const gone = await pass(stepDeps(), switched, items)
    const state = gone.siteImport as AiSiteImportState
    expect(gone.items?.some((entry) => entry.slot === AI_SITE_IMPORT_PROPOSED_SLOT)).toBe(false)
    expect(state.pages.some((entry) => entry.slot === AI_SITE_IMPORT_PROPOSED_SLOT)).toBe(false)
    expect(state.waves[0]?.slots).not.toContain(AI_SITE_IMPORT_PROPOSED_SLOT)
    expect(state.plan?.nav.groups.map((group) => group.label)).toEqual(['Services', 'About', 'Contact'])
    expect(state.plan?.proposed?.on).toBe(false)
    expect(aiSiteImportFrameSource(state, state.waves[0] as never)?.nav.map((entry) => entry.label)).toEqual(['Services', 'About', 'Contact'])
  })

  it('takes the owner’s answer only while a plan waits on it', () => {
    const job = { kind: 'import', status: 'needs_review', review: { reason: 'wave' }, siteImport: planned() } as never
    expect(aiSiteImportPlanUpdate(job, { addPage: false, pictures: true })).toEqual({ 'siteImport.plan.proposed.on': false, 'siteImport.generatedPictures': true })
    expect(aiSiteImportPlanUpdate(job, {})).toBeNull()
    expect(aiSiteImportPlanUpdate({ kind: 'import', status: 'needs_review', review: { reason: 'wave' }, siteImport: accepted() } as never, { addPage: false })).toBeNull()
    expect(aiSiteImportPlanUpdate({ kind: 'import', status: 'running', review: null, siteImport: planned() } as never, { addPage: false })).toBeNull()
    expect(aiSiteImportPlanUpdate({ kind: 'import', status: 'needs_review', review: { reason: 'wave' }, siteImport: site() } as never, { pictures: true })).toBeNull()
  })
})

/*------------------------------------------
 * The frame
 *-----------------------------------------*/

const frameOf = (state: AiSiteImportState) => {
  const wave = state.waves[0] as AiSiteImportState['waves'][number]
  return aiSiteImportFrameSource(state, wave) as AiLayoutFrameSource
}

describe('the frame a plan draws', () => {
  it('organizes the menu: a link for one page, a menu for several, a later wave’s page by its address', () => {
    const state = planned({ pages: [...site().pages] })
    const grouped = {
      ...state,
      plan: {
        ...(state.plan as AiSiteImportPlan),
        nav: { ...(state.plan as AiSiteImportPlan).nav, groups: [{ label: 'What we do', pages: ['d-p1', 'd-p2'] }, { label: 'Notes', pages: ['d-p5'] }, { label: 'Gone', pages: ['d-nope'] }] },
      },
    }
    const frame = frameOf(grouped)
    expect(frame.nav).toEqual([
      { label: 'What we do', to: null, items: [{ label: 'Services', to: 'page:d-p1' }, { label: 'About', to: 'page:d-p2' }] },
      { label: 'Notes', to: '/news/one', items: [] },
    ])
  })

  it('fills its one main button, to a page, the form’s page or the phone', () => {
    expect(frameOf(accepted()).ctas).toEqual([{ label: 'Start now', to: 'page:d-p3', style: 'primary' }])
    const state = accepted()
    const onPhone = { ...state, plan: { ...(state.plan as AiSiteImportPlan), nav: { ...(state.plan as AiSiteImportPlan).nav, primaryCta: { label: 'Call us', target: 'phone' } } } }
    expect(frameOf(onPhone).ctas).toEqual([{ label: 'Call us', to: 'tel:5550142200', style: 'primary' }])
  })

  it('gives the footer real columns, and how to reach the site from anywhere it says', () => {
    const footer = frameOf(accepted()).footer
    expect(footer?.columns).toEqual([
      { heading: 'Company', links: [{ label: 'Services', to: 'page:d-p1' }, { label: 'About', to: 'page:d-p2' }] },
      { heading: 'Help', links: [{ label: 'Contact', to: 'page:d-p3' }, { label: 'Privacy policy', to: 'page:d-p4' }] },
    ])
    expect(footer).toMatchObject({ address: '12 Main Street', phone: '(555) 014-2200', email: 'hello@x.example', copyright: '© Larkspur Tax Studio' })
  })

  it('stands on the source’s columns where the plan writes none', () => {
    const state = accepted()
    const home = { ...state.home, footer: { columns: [{ heading: 'Visit', links: [{ label: 'About', href: 'https://x.example/about' }] }], links: [], text: [], social: [], address: null, phone: null, email: null, copyright: '© 2024 Larkspur' } } as never
    const none = { ...state, home, plan: { ...(state.plan as AiSiteImportPlan), nav: { ...(state.plan as AiSiteImportPlan).nav, footer: [] } } }
    expect(frameOf(none).footer?.columns).toEqual([{ heading: 'Visit', links: [{ label: 'About', to: 'page:d-p2' }] }])
    expect(frameOf(none).footer?.copyright).toBe('© 2024 Larkspur')
  })

  it('draws a footer with no column as one short band, and today’s as it was', () => {
    const source = { ...frameOf(accepted()), nav: [{ label: 'About', to: 'page:d-p2', items: [] }], footer: { columns: [], links: [], text: [], social: [], address: null, phone: null, email: null, copyright: '© x' } }
    const compile = (frame: AiLayoutFrameSource) =>
      aiCompileLayoutFrame(
        { header: { band: 'plain', align: 'start', blocks: [] }, footer: null },
        { siteName: 'X', homeId: 'd-p0', navPages: [], closesDark: false, cart: false, source: frame } as never,
        { pageId: null, pages: [], homeIds: ['d-p0'], forms: [], formPageId: null, components: [], facts: '' } as never,
      ).tree.nodes as unknown as Record<string, { sx?: Record<string, unknown>; props?: Record<string, unknown> }>
    const padding = (nodes: ReturnType<typeof compile>) => Object.values(nodes).find((node) => node.props?.['maxWidth'] === 'lg' && (node.sx?.['py'] as { md?: number } | undefined)?.md !== undefined && (node.sx?.['py'] as { md: number }).md !== undefined)?.sx?.['py']
    const footerOf = (nodes: ReturnType<typeof compile>) => JSON.stringify(Object.values(nodes).filter((node) => node.props?.['spacing'] !== undefined))
    expect(footerOf(compile(source))).toContain('"spacing":"2"')
    expect(JSON.stringify(padding(compile(source)))).toContain('"md":4')
    const { planned: _planned, ...today } = source
    expect(JSON.stringify(Object.values(compile(today)).map((node) => node.sx?.['py']).filter(Boolean))).toContain('"md":8')
  })

  it('holds every entry in the phone menu, its button too', () => {
    const state = accepted()
    const source = { ...frameOf(state), nav: [{ label: 'What we do', to: null, items: [{ label: 'Services', to: 'page:d-p1' }, { label: 'About', to: 'page:d-p2' }] }, { label: 'Contact', to: 'page:d-p3', items: [] }] }
    const tree = new AiLayoutTreeBuilder('lf')
    const header = aiLayoutSourceHeader(tree, source, { onBrand: false, close: [], brandWidth: 200 })
    const under = (id: string): string[] => [id, ...((tree.nodes[id] as { nodes?: string[] }).nodes ?? []).flatMap(under)]
    const words = header.drawer.flatMap(under).map((id) => (tree.nodes[id] as { props?: Record<string, unknown> }).props?.['children']).filter(Boolean)
    expect(words).toEqual(expect.arrayContaining(['What we do', 'Services', 'About', 'Contact', 'Start now']))
    const button = header.drawer.flatMap(under).map((id) => tree.nodes[id] as { componentId?: string; props?: Record<string, unknown> }).find((node) => node.componentId === 'muiButton')
    expect(button?.props).toMatchObject({ variant: 'contained', children: 'Start now' })
  })

  it('hides the typed name beside a logo that holds it, and sizes the logo sensibly', () => {
    expect(aiSiteImportLogoHoldsName({ aspect: 4, alt: 'x', siteName: 'Larkspur' })).toBe(true)
    expect(aiSiteImportLogoHoldsName({ aspect: 1.6, alt: 'Larkspur logo', siteName: 'Larkspur' })).toBe(true)
    expect(aiSiteImportLogoHoldsName({ aspect: 1, alt: 'Larkspur', siteName: 'Larkspur' })).toBe(false)
    expect(aiSiteImportLogoHoldsName({ aspect: null, alt: 'Larkspur', siteName: 'Larkspur' })).toBe(false)
    expect(aiSiteImportLogoHeight(1)).toBe('48px')
    expect(aiSiteImportLogoHeight(2)).toBe('40px')
    expect(aiSiteImportLogoHeight(8)).toBe('28px')
    expect(aiSiteImportLogoHeight(null)).toBe('40px')

    const state = accepted()
    const wave = state.waves[0] as AiSiteImportState['waves'][number]
    const brand = aiLayoutSiteBrandOf(aiSiteImportFrameJob(importJob(state, []), state, wave, []).inputs)
    expect(brand).toMatchObject({ name: false, height: '40px', aspect: 4 })
    // Off, the name beside the logo and its one height, as they were.
    const today = aiLayoutSiteBrandOf(aiSiteImportFrameJob(importJob(state, []), state, { ...wave, generative: undefined } as never, []).inputs)
    expect(today).toMatchObject({ name: true })
    expect(today).not.toHaveProperty('height')
  })

  it('leaves the source’s own frame as it was with the flag off', () => {
    const state = site()
    const frame = aiSiteImportFrameSource(state, { index: 1 })
    expect(frame?.planned).toBeUndefined()
    expect(frame?.nav.map((entry) => entry.label)).toEqual(['Services', 'About', 'Contact'])
  })
})

/*------------------------------------------
 * The design
 *-----------------------------------------*/

describe('the design a plan gives every page of every wave', () => {
  it('passes its kind and design, and draws one hero, group and rhythm whatever the seed', () => {
    const state = accepted()
    const wave = state.waves[0] as AiSiteImportState['waves'][number]
    const inputs = aiSiteImportDesignInputs(state, wave)
    expect(inputs).toMatchObject({ siteKind: 'professional', siteStyle: { seed: 11, planned: { hero: 'panel', group: 'ruled', bandRhythm: 'alternate', coverClose: false } } })
    for (const seed of [1, 2, 3, 99]) {
      const design = aiLayoutDesignOf({ $id: 'x', inputs: { ...inputs, siteStyle: { ...(inputs['siteStyle'] as object), seed } } }, '/about')
      expect(aiLayoutDesignChoices(design as never)).toMatchObject({ hero: 'panel', group: 'ruled', bandRhythm: 'alternate', coverClose: false })
    }
    // The next wave's page, the same site.
    const next = aiSiteImportPageJob(importJob(state, []), { ...state, waves: [wave, { ...state.waves[1], generative: true } as never] }, state.pages[5] as AiSiteImportPage, [])
    expect((next.inputs?.['siteStyle'] as { planned?: unknown }).planned).toEqual({ hero: 'panel', group: 'ruled', bandRhythm: 'alternate', coverClose: false })
  })

  it('carries a plan with no look’s seed too', () => {
    const state = { ...accepted(), look: null }
    const inputs = aiSiteImportDesignInputs(state, state.waves[0])
    expect(inputs).toEqual({ siteKind: 'professional', siteStyle: { planned: { hero: 'panel', group: 'ruled', bandRhythm: 'alternate', coverClose: false } } })
  })

  it('is exactly today’s with the flag off, and its seed’s choices stand to the byte', () => {
    const state = site({ plan: planOf(site(), answer({ site: { ...answer().site, kind: 'trades' } })) })
    const today = aiSiteImportDesignInputs(state, { generative: undefined } as never)
    expect(today).toEqual(aiSiteImportDesignInputs(site()))
    expect(today).toEqual({ siteKind: 'professional', siteStyle: { seed: 11 } })
    expect(aiSiteImportDesignInputs(state, state.waves[0])).toMatchObject({ siteKind: 'trades' })
    const { hero, group } = aiLayoutDesignChoices({ kind: 'business', seed: 7, home: true })
    expect(aiLayoutDesignChoices({ kind: 'business', seed: 7, home: true, planned: { hero: 'editorial' } })).toMatchObject({ hero: 'editorial', group })
    expect(hero).not.toBe('editorial')
    expect(aiLayoutPlannedChoicesOf({ hero: 'nope', group: 'nope' })).toBeNull()
  })

  it('never lets a page’s design answer open differently from the plan, new copy off', async () => {
    const { aiSiteImportDesignedSections } = await import('./ai-site-import-compile')
    const doc = { ...siteImportReplayDocument('salon'), finish: 'improve', wording: 'kept' } as AiSiteImportDocument
    const hero = (rest: Parameters<typeof aiSiteImportDesignedSections>[2]) => aiSiteImportDesignedSections(doc, { sections: [{ hero: 'split' }] } as never, { finish: 'improve', ...rest }).sections[0]?.hero
    const asked = hero({})
    if (!asked) return
    expect(asked).toBe('split')
    expect(hero({ plannedHero: 'editorial' })).toBe('editorial')
  })
})

/*------------------------------------------
 * The quote
 *-----------------------------------------*/

describe('what a generative Improve it is quoted at', () => {
  const waiting = (patch: Partial<AiSiteImportState> = {}) => {
    const state = site(patch)
    return { ...state, waves: state.waves.map((wave, index) => (index === 0 ? { ...wave, status: 'waiting' as const, startedAt: null, generative: undefined } : wave)) } as AiSiteImportState
  }

  it('quotes the plan on its measured row, each redesigned page on the reworded row, and the page it may propose', () => {
    const state = waiting()
    const wave = state.waves[0] as AiSiteImportState['waves'][number]
    const owed = aiSiteImportWaveOwed(state, wave)
    expect(owed).toMatchObject({ plan: true, proposed: 1, arranged: 5, reworded: 4, frame: false })
    const { plan } = AI_MEASURED_PAID_SITE_CREDITS
    const { reworded, arranged } = AI_MEASURED_IMPORT_CREDITS
    const range = aiSiteImportWaveCreditRange(state, wave)
    expect(range.likely).toBe(plan.median + 5 * reworded.median + arranged.median)
    expect(range.p90).toBe(plan.p90 + 5 * reworded.p90 + arranged.p90)
    expect(aiSiteImportWaveQuote({ items: null, siteImport: state } as never, wave)).toMatch(/your site’s plan, 4 pages redesigned by Aglyn AI, 1 arranged by Aglyn AI, a new page if the plan proposes one/)
  })

  it('takes the proposed page out where the plan has no room, and the plan out once it is in', () => {
    const full = waiting({ pageLimit: 6 })
    expect(aiSiteImportWaveOwed(full, full.waves[0] as never)).not.toHaveProperty('proposed')
    const shown = planned()
    const owed = aiSiteImportWaveOwed(shown, shown.waves[0] as never, aiSiteImportPlanRow(shown, rows(site())))
    expect(owed).not.toHaveProperty('plan')
    expect(owed).not.toHaveProperty('proposed')
    // Its own row now.
    expect(owed.reworded).toBe(5)
  })

  it('adds generated pictures to the ceiling alone, only where they are switched on', () => {
    const state = waiting({ generatedPictures: true })
    const wave = state.waves[0] as AiSiteImportState['waves'][number]
    const off = aiSiteImportWaveCreditRange(waiting(), wave)
    const on = aiSiteImportWaveCreditRange(state, wave)
    expect(on.likely).toBe(off.likely)
    expect(on.p90).toBe(off.p90)
    expect(on.ceiling - off.ceiling).toBe(5 * AI_SITE_IMPORT_GENERATED_PICTURES_PER_PAGE * 108)
    expect(aiSiteImportWaveQuote({ items: null, siteImport: state } as never, wave)).toContain('up to 10 generated pictures')
  })

  it('quotes today’s Improve it to the byte with the flag off', () => {
    const state = waiting({ generative: undefined })
    const wave = state.waves[0] as AiSiteImportState['waves'][number]
    const owed = aiSiteImportWaveOwed(state, wave)
    expect(Object.keys(owed).sort()).toEqual(['arranged', 'copied', 'frame', 'pages', 'reworded'])
    expect(aiSiteImportWaveCreditRange(state, wave)).toEqual(aiSiteImportCreditRange(0, { arranged: 5, reworded: 4 }))
    expect(aiSiteImportQuoteText(aiSiteImportCreditRange(0, { arranged: 2, reworded: 1 }), { arranged: 2, reworded: 1, copied: 0 })).toMatch(/2 pages arranged and reworded by Aglyn AI, 1 arranged by Aglyn AI$|1 page arranged and reworded by Aglyn AI, 1 arranged by Aglyn AI$/)
  })
})

/*------------------------------------------
 * The pictures
 *-----------------------------------------*/

const slot = (patch: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({ imageId: 'img', frameId: null, iconId: null, alt: 'a calm office desk', aspect: 4 / 3, sectionIndex: 1, role: 'gallery', ...patch })
const photo = (src: string, from?: string) => ({ mediaId: src, src, width: 1600, height: 900, ...(from ? { from } : {}) })

describe('a redesign’s slots', () => {
  const NO_NODES = {} as never

  it('fill from the page’s own, then the site’s, then the next source, then a generated picture, and the row counts each', async () => {
    const tally = aiSiteImportPictureTally()
    const make = jest.fn(async (_slot: AiLayoutPictureSlot, into: typeof tally) => {
      into.generated += 1
      return { src: 'media:h/gen', width: 1024, height: 768 }
    })
    const next = jest.fn(async (slots: readonly AiLayoutPictureSlot[]) => slots.map((_, at) => (at === 0 ? { src: 'media:h/stock', width: 800, height: 600 } : AI_LAYOUT_NO_PHOTO)))
    const source = aiSiteImportPictureSource({ photos: [photo('media:h/own', 'https://x.example/a.jpg')], next, make, nodes: NO_NODES, tally })
    const slots = [slot({ imageId: 'a', role: 'hero', sectionIndex: 0 }), slot({ imageId: 'b', sectionIndex: 1 }), slot({ imageId: 'c', sectionIndex: 2 })]
    const found = await source?.(slots)
    expect(found?.map((entry) => entry?.src)).toEqual(['media:h/own', 'media:h/stock', 'media:h/gen'])
    expect(next.mock.calls[0]?.[0].map((entry) => entry.imageId)).toEqual(['b', 'c'])
    expect(make).toHaveBeenCalledTimes(1)
    expect(tally).toMatchObject({ source: 1, generated: 1, placed: ['https://x.example/a.jpg'] })
  })

  it('takes at most two generated pictures a page, a hero or a section’s lead, never a person, a product or a band’s cell', async () => {
    const tally = aiSiteImportPictureTally()
    const made: string[] = []
    const make = async (entry: AiLayoutPictureSlot) => {
      made.push(entry.imageId)
      return { src: `media:h/${entry.imageId}`, width: 1024, height: 768 }
    }
    const slots = [
      slot({ imageId: 'later', sectionIndex: 3 }),
      slot({ imageId: 'hero', role: 'hero', sectionIndex: 0 }),
      slot({ imageId: 'second', sectionIndex: 3 }),
      slot({ imageId: 'team', sectionIndex: 4, alt: 'our team at the office' }),
      slot({ imageId: 'bio', sectionIndex: 5, people: true }),
      slot({ imageId: 'thing', sectionIndex: 6, product: { subjects: ['a mug'] } }),
      slot({ imageId: 'third', sectionIndex: 7 }),
    ]
    const source = aiSiteImportPictureSource({ photos: [], next: async (open) => open.map(() => AI_LAYOUT_NO_PHOTO), make, nodes: NO_NODES, tally })
    await source?.(slots)
    expect(made).toEqual(['hero', 'later'])
    expect(aiSiteImportGeneratedSlots(NO_NODES, slots)).toEqual([true, true, false, false, false, false, true])
  })

  it('makes none with the switch off: the slot is dropped', async () => {
    const tally = aiSiteImportPictureTally()
    const source = aiSiteImportPictureSource({ photos: [], next: async (open) => open.map(() => AI_LAYOUT_NO_PHOTO), make: null, nodes: NO_NODES, tally })
    expect((await source?.([slot()]))?.[0]).toBe(AI_LAYOUT_NO_PHOTO)
    expect(tally.generated).toBe(0)
  })

  it('never takes a picture of its own over the page’s own opening photo', () => {
    const doc = siteImportReplayDocument('tax-firm')
    const ledger = aiSiteImportImproveLedger(doc)
    const opening = ledger.items.find((item) => item.kind === 'picture' && item.section === 0)
    expect(opening).toBeTruthy()
    const violations = aiSiteImportHonesty(
      [
        { blocks: [{ kind: 'heading', text: 'Keep your taxes calm' }, { kind: 'image', text: 'a new picture' }] },
        { blocks: ledger.items.filter((item) => item.must).map((item) => ({ kind: 'keep' as const, ref: item.ref })) },
      ] as never,
      { ledger, scope: ['Keep your taxes calm'], destinations: aiSiteImportImproveDestinations(doc, ledger) },
    )
    expect(violations.map((violation) => violation.message).join(' ')).toContain('own opening picture')
  })

  it('redraws without a gap where a slot beside words is dropped', () => {
    const nodes = {
      root: { componentId: 'section', nodes: ['row'] },
      row: { componentId: 'muiGrid', props: { container: true }, nodes: ['words', 'cell'] },
      words: { componentId: 'muiGrid', props: { size: 'xs:12 md:7' }, sx: { order: 2 }, nodes: ['text'] },
      text: { componentId: 'muiTypography', props: { children: 'Words' } },
      cell: { componentId: 'muiGrid', props: { size: 'xs:12 md:5' }, nodes: ['frame'] },
      frame: { componentId: 'muiBox', nodes: ['img'] },
      img: { componentId: 'image', props: { src: '', alt: 'a calm office desk' } },
    } as never
    const slots = aiLayoutPictureSlots(nodes, 'root', { ids: ['root'], names: ['Why us'] })
    expect(slots).toHaveLength(1)
    const next = aiLayoutDropEmptyPictures(nodes, slots, [AI_LAYOUT_NO_PHOTO], ['root']) as unknown as Record<string, { props?: Record<string, unknown>; nodes?: string[] }>
    expect(next['row']?.nodes).toEqual(['words'])
    expect(next['words']?.props).toMatchObject({ size: 'xs:12' })
    expect(next['img']).toBeUndefined()
  })

  it('fills through the door a page has today, and asks nothing of it for a kind of job', async () => {
    const nodes = {
      root: { componentId: 'section', nodes: ['frame'] },
      frame: { componentId: 'muiBox', nodes: ['img'] },
      img: { componentId: 'image', props: { src: '', alt: 'a calm office desk' } },
    } as never
    const tally = aiSiteImportPictureTally()
    const source = aiSiteImportPictureSource({ photos: [], next: async (open) => open.map(() => ({ src: 'media:h/stock', width: 800, height: 600 })), make: null, nodes, tally })
    const out = (await aiResolveLayoutPictures(nodes, { rootId: 'root', sectionIds: ['root'], sectionNames: ['Why us'], seed: 's', source })) as unknown as Record<string, { props?: Record<string, unknown> }>
    expect(out['img']?.props?.['src']).toBe('media:h/stock')
  })

  it('counts what a page’s row says, and hands its unplaced photos to a later page', () => {
    const tally = { ...aiSiteImportPictureTally(), source: 1, stock: 1, generated: 1, placed: ['https://x.example/a.jpg'] }
    const pictures = aiSiteImportPagePicturesOf({ source: 2, stock: 0, generated: 0, slots: 3, unplaced: ['https://x.example/a.jpg', 'https://x.example/b.jpg'] }, tally)
    expect(pictures).toEqual({ source: 3, stock: 1, generated: 1, slots: 0, unplaced: ['https://x.example/b.jpg'] })
    expect(aiSiteImportPicturesText({ pictures })).toBe('1 stock photo, 1 generated picture, 1 of your photos not placed')

    const state = site({ pages: [page('p0', '/', 'Home', 'x', { photos: { brought: 2, reused: 0, skipped: 0, assets: [photo('media:h/a', 'https://x.example/a.jpg'), photo('media:h/b', 'https://x.example/b.jpg')] } })] })
    const next = aiSiteImportRedesignOf(state, 'p0', 'redesigned', [], pictures)
    expect(next.sitePhotos?.map((entry) => entry.src)).toEqual(['media:h/b'])
    expect(aiSiteImportRedesignOf(next, 'p0', 'redesigned', [], pictures).sitePhotos).toHaveLength(1)
  })

  describe('a generated picture', () => {
    const provider = (generate: jest.Mock, configured = true) => ({ id: 'p', label: 'P', defaultModel: () => 'gemini-3.1-flash-image', configured: () => configured, endpointHost: () => 'x', generate }) as never
    const update = jest.fn(async () => undefined)
    const firestore = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ update }) }) }) }) } as never
    const input = (patch = {}) => ({
      provider: provider(jest.fn(async () => ({ model: 'm', images: [{ base64: 'AAAA', mimeType: 'image/png' }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, filtered: 0 }))),
      ingest: { ingest: jest.fn(async () => ({ ok: true as const, mediaId: 'gen1', src: 'media:h/gen1', width: 1024, height: 768 })), findStockPhoto: async () => null } as never,
      firestore,
      orgId: 'org',
      hostId: 'host',
      uid: 'u',
      about: 'a tax firm',
      record: jest.fn(async () => 'signal') as never,
      ...patch,
    })

    it('runs the Media door’s own parts at a paid size, keeps its provenance and meters only once stored', async () => {
      const made = input()
      const tally = aiSiteImportPictureTally()
      const out = await aiSiteImportPictureMaker(made)?.(slot({ aspect: 16 / 9 }), tally)
      expect(out).toMatchObject({ src: 'media:h/gen1', width: 1024, height: 768 })
      const asked = (made.provider as unknown as { generate: jest.Mock }).generate.mock.calls[0]?.[0]
      expect(asked).toMatchObject({ size: '1K', count: 1, aspectRatio: '16:9' })
      expect(asked.prompt).toContain('a calm office desk')
      expect((made.ingest as unknown as { ingest: jest.Mock }).ingest.mock.calls[0]?.[0]).toMatchObject({ hostId: 'host', uid: 'u', contentType: 'image/png', description: 'Created with AI from a description.' })
      expect((made.record as unknown as jest.Mock).mock.calls[0]?.[2]).toMatchObject({ kind: 'image', usage: { images: 1, imageSize: '1K' } })
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ aiGenerated: expect.objectContaining({ mode: 'photo', signalId: 'signal' }) }))
      expect(tally.generated).toBe(1)
      expect(tally.generatedUsd).toBeGreaterThan(0)
    })

    it('drops the slot and charges nothing where the provider declines, the library refuses, or nothing is set up', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      expect(aiSiteImportPictureMaker(input({ provider: null }))).toBeNull()
      expect(aiSiteImportPictureMaker(input({ provider: provider(jest.fn(), false) }))).toBeNull()
      expect(aiSiteImportPictureMaker(input({ ingest: null }))).toBeNull()
      const failed = input({ provider: provider(jest.fn(async () => { throw new Error('no') })) })
      expect(await aiSiteImportPictureMaker(failed)?.(slot(), aiSiteImportPictureTally())).toBeNull()
      expect((failed.record as unknown as jest.Mock).mock.calls).toHaveLength(0)
      const refused = input({ ingest: { ingest: jest.fn(async () => ({ ok: false, status: 402, reason: 'no room' })), findStockPhoto: async () => null } as never })
      expect(await aiSiteImportPictureMaker(refused)?.(slot(), aiSiteImportPictureTally())).toBeNull()
      expect((refused.record as unknown as jest.Mock).mock.calls).toHaveLength(0)
      const walled = input({ roomFor: () => false })
      expect(await aiSiteImportPictureMaker(walled)?.(slot(), aiSiteImportPictureTally())).toBeNull()
      jest.restoreAllMocks()
    })

    it('draws at the nearest shape a model makes', () => {
      expect(aiSiteImportPictureShape(1.8)).toBe('16:9')
      expect(aiSiteImportPictureShape(1)).toBe('1:1')
      expect(aiSiteImportPictureShape(0.5)).toBe('9:16')
      expect(aiSiteImportPictureShape(Number.NaN)).toBe('4:3')
    })
  })
})

/*------------------------------------------
 * The proposed page
 *-----------------------------------------*/

describe('the page a plan proposes', () => {
  const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const toolAnswer = (name: string, input: unknown) => ({ kind: 'completion', text: '', toolUse: [{ name, input }], usage: ZERO_USAGE, estCostUsd: 0, stopReason: 'tool_use' })

  const docOf = () => {
    const state = accepted()
    const doc = aiSiteImportDocumentFor(state, state.pages.find((entry) => entry.origin === 'proposed') as AiSiteImportPage) as AiSiteImportDocument
    return JSON.parse(JSON.stringify(doc)) as AiSiteImportDocument
  }

  const run = (doc: AiSiteImportDocument) => {
    const names = aiSiteImportSectionNames(doc)
    const screen = { title: doc.title, slug: '/common-questions', sections: names.map((name) => ({ name, uses: [] as string[], items: 0 })) }
    return aiRunLayoutPage({
      job: { $id: 'job-new', brief: '', inputs: { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc, businessName: 'Larkspur Tax Studio', siteKind: 'professional', siteStyle: { seed: 7 } } },
      plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
      screen: screen as never,
      sectionIds: names.map((_, index) => `sec-${index}`),
      targets: { pageId: 'p9', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: '' } as never,
      context: { screenIds: doc.links.map((link) => link.id), formIds: [], componentIds: [], codeBuilt: true },
      reusableComponents: false,
      inventory: null,
      model: 'claude-sonnet-5-5',
    })
  }

  beforeEach(() => {
    mockRunAiRequest.mockReset()
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  const written = {
    sections: [
      {
        band: 'plain',
        cols: [],
        align: 'start',
        blocks: [
          { kind: 'heading', col: -1, text: 'Common questions about tax preparation', to: '', style: 'none', icon: '', items: [], ref: '' },
          { kind: 'lede', col: -1, text: 'What people ask before they start, in plain words.', to: '', style: 'none', icon: '', items: [], ref: '' },
          { kind: 'button', col: -1, text: 'Contact us', to: 'page:d-p3', style: 'primary', icon: '', items: [], ref: '' },
        ],
      },
      {
        band: 'soft',
        cols: [],
        align: 'start',
        blocks: [
          { kind: 'heading', col: -1, text: 'What people ask', to: '', style: 'none', icon: '', items: [], ref: '' },
          {
            kind: 'faq',
            col: -1,
            text: '',
            to: '',
            style: 'none',
            icon: '',
            items: [
              { title: 'What do you help with?', text: 'Tax preparation and bookkeeping for small businesses.', to: '', icon: '', ref: '' },
              { title: 'How do I start?', text: 'Write to us or call us.', to: '', icon: '', ref: '' },
              { title: 'Do you plan ahead?', text: 'Yes, planning is part of what we do.', to: '', icon: '', ref: '' },
            ],
          },
        ],
      },
      {
        band: 'plain',
        cols: [],
        align: 'start',
        blocks: [
          { kind: 'heading', col: -1, text: 'What we help with', to: '', style: 'none', icon: '', items: [], ref: '' },
          {
            kind: 'cards',
            col: -1,
            text: '',
            to: '',
            style: 'none',
            icon: '',
            items: [
              { title: 'Tax preparation', text: 'Filed for your small business.', to: '', icon: '', ref: '' },
              { title: 'Planning', text: 'Keep more of what you earn.', to: '', icon: '', ref: '' },
              { title: 'Bookkeeping', text: 'Your books, kept for you.', to: '', icon: '', ref: '' },
            ],
          },
        ],
      },
      {
        band: 'dark',
        cols: [],
        align: 'center',
        blocks: [
          { kind: 'heading', col: -1, text: 'Ready to start?', to: '', style: 'none', icon: '', items: [], ref: '' },
          { kind: 'button', col: -1, text: 'Contact us', to: 'page:d-p3', style: 'primary', icon: '', items: [], ref: '' },
        ],
      },
    ],
  }

  it('carries its plan and its purpose in its one job, with no old page', () => {
    const doc = docOf()
    expect(doc).toMatchObject({ generative: true, proposed: true, wording: 'improved', build: 'arranged', title: 'Common questions' })
    expect(aiSiteImportDocumentOf({ [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc })?.proposed).toBe(true)
    const ledger = aiSiteImportImproveLedger(doc)
    const prompt = aiSiteImportImprovePrompt({ screen: { title: doc.title, slug: '/common-questions' }, doc, ledger, destinations: new Map(), kindLines: [], seed: 'x' })
    expect(prompt).toContain('This page is new')
    expect(prompt).toContain('What people ask about tax preparation and bookkeeping.')
  })

  it('is written from what the site says, and held only to what it says', async () => {
    mockRunAiRequest.mockResolvedValue(toolAnswer('submit_improved_page', written))
    const result = await run(docOf())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.value.redesign?.status).toBe('redesigned')
  })

  it('is left out, never kept as a stub, where its answer misses twice', async () => {
    mockRunAiRequest.mockResolvedValue(toolAnswer('submit_improved_page', { sections: [] }))
    const result = await run(docOf())
    expect(result.status).toBe('needs_input')
    if (result.status === 'needs_input') expect(result.message).toBe(AI_SITE_IMPORT_PROPOSED_NOT_WRITTEN)
  })

  it('is nothing a Keep my site or an ordinary redesign ever carries', () => {
    const state = site()
    const doc = aiSiteImportDocumentFor(state, state.pages[1] as AiSiteImportPage)
    expect(doc).toMatchObject({ generative: true })
    expect(doc).not.toHaveProperty('proposed')
    expect(doc).not.toHaveProperty('generatedPictures')
    const on = aiSiteImportDocumentFor(site({ generatedPictures: true }), state.pages[1] as AiSiteImportPage)
    expect(on).toMatchObject({ generatedPictures: true })
  })
})

/*------------------------------------------
 * What the owner sees
 *-----------------------------------------*/

describe('what the owner reads', () => {
  it('says what the site is, its menu, its button, its footer and its new page', () => {
    const view = aiSiteImportPlanViewOf(planned())
    expect(view).toMatchObject({
      what: 'Tax preparation and bookkeeping for small businesses.',
      cta: 'Start now → Contact',
      editable: true,
      proposed: { title: 'Common questions', address: '/common-questions' },
    })
    expect(view?.menu.map((entry) => entry.label)).toEqual(['Services', 'About', 'Common questions', 'Contact'])
    expect(view?.footer[1]).toEqual({ label: 'Help', pages: ['Contact', 'Privacy policy'] })
    expect(aiSiteImportPlanViewOf(accepted())?.editable).toBe(false)
    expect(aiSiteImportPlanViewOf(site())).toBeNull()
    expect(aiSiteImportPlanViewOf(site({ plan: null }))).toBeNull()
  })

  it('reads each page’s row, its new sections, its pictures, a proposed page, and what’s new', () => {
    const state = planned()
    const done = aiSiteImportRedesignOf(
      aiSiteImportRedesignOf(state, 'p1', 'redesigned', [{ heading: 'Why us' }, { heading: 'FAQ', items: 4 }], { source: 1, stock: 1, generated: 1, slots: 0, unplaced: [] }),
      'p2',
      'layout-kept',
    )
    const rowsOf = aiSiteImportWaveRows({ items: aiSiteImportPlanRow(done, rows(site())), status: 'needs_review', siteImport: done } as never, done.waves[0] as never)
    const by = new Map(rowsOf.map((entry) => [entry.slot, entry]))
    expect(by.get('p1')).toMatchObject({ build: 'Redesigned by Aglyn AI · 2 new sections', added: 'New: Why us, FAQ (4)', pictures: '1 stock photo, 1 generated picture' })
    expect(by.get('p2')?.build).toBe('Layout kept: the redesign did not pass')
    expect(by.get('p3')?.build).toBe('Redesigned by Aglyn AI')
    expect(by.get(AI_SITE_IMPORT_PROPOSED_SLOT)).toMatchObject({ title: 'Common questions', isNew: true, to: '/common-questions' })
    expect(aiSiteImportAddedText({ added: [] })).toBeNull()
    expect(aiSiteImportWhatsNew(done, done.waves[0] as never)).toEqual([{ page: 'Services', lines: ['New: Why us, FAQ (4)', '1 stock photo, 1 generated picture'] }])
  })

  it('reads no new word on a row with the flag off', () => {
    const state = site({ generative: undefined, waves: site().waves.map(({ generative: _generative, ...wave }) => wave) as never })
    const rowsOf = aiSiteImportWaveRows({ items: rows(state), status: 'running', siteImport: state } as never, state.waves[0] as never)
    const row = rowsOf.find((entry) => entry.slot === 'p1')
    expect(row?.build).toBe('Arranged and reworded by Aglyn AI')
    for (const key of ['added', 'pictures', 'isNew']) expect(Object.keys(row ?? {})).not.toContain(key)
    expect(aiSiteImportWhatsNew(state, state.waves[0] as never)).toEqual([])
    expect(aiSiteImportPlanFellBackText(state)).toBeNull()
  })
})
