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
 * The import step's own rules (AGL-3976), pass by pass against fakes for
 * everything outside it: who may start an import and when, what a page's
 * model answer is told and how its text is fenced, what a wave leaves out when the site changed since it was read, and how
 * long each pass may take. The machine's half — waves started by a person,
 * the review between them, refunds — is in `ai-jobs.spec.ts`.
 */

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => null,
  getOrgForUser: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__now__' },
}))

import { UNTRUSTED_TEXT_RULE, UNTRUSTED_TEXT_TAG } from '@aglyn/shared-util-tools/untrusted-text'
import type { AiJob, AiJobItemLedger } from '../model/ai-jobs.types'
import {
  AI_SITE_IMPORT_LEFT_OUT_COPY,
  aiSiteImportInventory,
  aiSiteImportLedger,
  aiSiteImportNextWork,
  aiSiteImportPageSettled,
  aiSiteImportPagesRead,
  aiSiteImportPhotosIn,
  aiSiteImportWaveClosed,
  aiSiteImportWaveStarted,
  type AiSiteImportPageRead,
  type AiSiteImportState,
  type SiteImportLayout,
} from '../model/ai-site-import'
import { aiSiteImportStartAction, aiSiteImportStoppedCopy } from '../model/ai-site-import-view'
import type { SiteImportBlock } from '../site-import/site-import-html'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, type AiSiteImportDocument } from './ai-site-import-document'
import {
  HARBOR_DOMAIN,
  HARBOR_INJECTION,
  HARBOR_ORIGIN,
  harborFetch,
} from '../site-import/fixtures/site-import-wave-recordings'
import {
  AI_SITE_IMPORT_COPY,
  AI_SITE_IMPORT_JOB_MAX_BYTES,
  AI_SITE_IMPORT_MAX_PASSES,
  AI_SITE_IMPORT_PASS_MINIMUM_MS,
  aiSiteImportFrameJob,
  aiSiteImportPageJob,
  aiSiteImportReadsWithin,
  aiSiteImportRunMinimumMs,
  aiSiteImportStopReview,
  createAiJobImportStep,
  createAiSiteImportAdmission,
  type AiSiteImportStepDeps,
} from './ai-job-import-step'
import { AI_JOB_PAGE_LANGUAGE_BUDGET, aiJobPageLanguageInstructions, aiLayoutFacts, aiLayoutPagePrompt, aiLayoutPageTargets } from './ai-job-page-language'
import type { AiJobStepOutcome } from './ai-job-text-step'
import { aiJobStepMinimumMs, registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-19T12:00:00.000Z')

function importJob(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'importJob1',
    orgId: 'org-pro',
    hostId: 'host-1',
    kind: 'import',
    status: 'running',
    brief: `Bring in ${HARBOR_DOMAIN}`,
    inputs: { domain: HARBOR_DOMAIN },
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    ...patch,
  }
}

function harborState(): AiSiteImportState {
  let id = 0
  const page = (path: string, foundBy: 'home' | 'sitemap' = 'sitemap') => ({
    url: `${HARBOR_ORIGIN}${path}`,
    path,
    title: path === '/' ? 'Home' : path.slice(1),
    foundBy,
    words: 80,
    images: 1,
  })
  return aiSiteImportInventory({
    domain: HARBOR_DOMAIN,
    siteName: 'Harbor Dental',
    ownership: { method: 'dns', provenAt: NOW.getTime(), detail: '_aglyn-challenge.harbor-dental.com' },
    readAt: NOW.toISOString(),
    pages: [page('/', 'home'), page('/about'), page('/services'), page('/members/login'), page('/team')],
    menu: ['/', '/about', '/members/login', '/services', '/team'],
    skipped: [{ url: `${HARBOR_ORIGIN}/private/records`, reason: 'robots' }],
    stoppedBy: null,
    pageLimit: 25,
    existingPages: 0,
    mintId: () => `drft${++id}`,
  })
}

const outcome = (rest: Partial<AiJobStepOutcome> = {}): AiJobStepOutcome => ({
  outputs: [],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  estCostUsd: 0,
  model: 'm',
  stopReason: null,
  ...rest,
})

function deps(patch: Partial<AiSiteImportStepDeps> = {}): AiSiteImportStepDeps {
  return {
    crawlSeams: { fetch: harborFetch() },
    runnerFor: (() => null) as never,
    ownership: async () => ({ current: true, method: 'dns', provenAt: NOW.getTime(), detail: 'x' }),
    rateLimit: async () => ({ allowed: true }),
    releaseFlagOn: async () => true,
    ingest: () => null,
    readRoom: async () => ({ limit: 25, used: 0 }),
    readSiteName: async () => 'Harbor Dental',
    pageWritten: async () => true,
    ...patch,
  }
}

const run = (step: ReturnType<typeof createAiJobImportStep>, job: AiJob) =>
  step({ job, stepIndex: 0, now: NOW, firestore: {} as never, org: { plan: 'pro' } as never })

describe('who may start an import, and when: the admission both doors ask', () => {
  const context = (patch: Record<string, unknown> = {}) => ({
    firestore: {} as never,
    orgId: 'org-pro',
    hostId: 'host-1',
    inputs: { domain: HARBOR_DOMAIN },
    org: { plan: 'pro', billingStatus: 'active' },
    uid: 'uid-1',
    ...patch,
  })
  const admission = (patch: Parameters<typeof createAiSiteImportAdmission>[0] = {}) =>
    createAiSiteImportAdmission({
      releaseFlagOn: async () => true,
      ownership: async () => ({ current: true, method: 'meta', provenAt: 1, detail: null }),
      holdsSiteImport: async () => true,
      ...patch,
    })

  it('admits the owner or an admin of a paid workspace with a current proof', async () => {
    expect(await admission()(context())).toBeNull()
    expect(await admission({ holdsSiteImport: async () => true })(context())).toBeNull()
    // Asked before "Create site" makes the site, too.
    expect(await admission()(context({ hostId: null, siteToCome: true }))).toBeNull()
  })

  it('is absent while the release flag is off', async () => {
    expect(await admission({ releaseFlagOn: async () => false })(context())).toEqual({ status: 404, error: 'Not found' })
  })

  it('refuses the Free plan, in the words its disabled card shows', async () => {
    expect(await admission()(context({ org: { plan: 'free' } }))).toEqual({ status: 403, error: AI_SITE_IMPORT_COPY.plan })
  })

  it('refuses an editor, an address that is no website and a site that is not proved, before anything is spent', async () => {
    expect(await admission({ holdsSiteImport: async () => false })(context())).toEqual({ status: 403, error: AI_SITE_IMPORT_COPY.role })
    expect(await admission()(context({ inputs: { domain: 'not a website' } }))).toMatchObject({ status: 400 })
    expect(await admission({ ownership: async () => null })(context())).toEqual({
      status: 403,
      error: AI_SITE_IMPORT_COPY.ownership(HARBOR_DOMAIN),
    })
    // A proof older than its 30 days is no proof.
    expect(await admission({ ownership: async () => ({ current: false, method: 'dns', provenAt: 1, detail: null }) })(context())).toMatchObject({
      status: 403,
    })
  })
})

describe('what a page’s model answer is told: its text, fenced, under the rule that it is data', () => {
  const state = (() => {
    const base = harborState()
    const services = base.pages.find((page) => page.path === '/services')
    return aiSiteImportWaveStarted(
      base,
      0,
      NOW.toISOString(),
      new Map([
        [
          services?.slot as string,
          { at: 'x', title: 'Services', text: `# Services\n${HARBOR_INJECTION}\n(footer) Call (207) 555-0142.`, sections: ['Services', 'Preventive care'], images: [] },
        ],
      ]),
    )
  })()
  const services = state.pages.find((page) => page.path === '/services') as AiSiteImportState['pages'][number]
  const job = aiSiteImportPageJob(importJob({ siteImport: state }), state, services, aiSiteImportLedger(state))

  it('hands the page step one screen of the old page’s sections, at its new address, under the header once it is in', () => {
    expect(job.kind).toBe('page')
    expect(job.$id).toBe(services.draftId)
    expect(job.plan).toMatchObject({ status: 'confirmed', create: [], reuse: [] })
    expect(job.plan?.screens[0]).toMatchObject({ title: 'Services', slug: '/services', id: services.draftId, layout: null })
    expect(job.plan?.screens[0].sections.map((section) => section.name)).toEqual(['Services', 'Preventive care'])
    const built = aiSiteImportLedger(state).map((row): AiJobItemLedger => (row.slot === 'frame' ? { ...row, status: 'succeeded' } : row))
    expect(aiSiteImportPageJob(importJob(), state, services, built).plan?.screens[0].layout).toBe(state.frame?.draftId)
    // The brief is the platform's words; the page's own words are only in the fenced input.
    expect(job.brief).toBe(`Bring in the page “Services” of ${HARBOR_DOMAIN} as a page of “Harbor Dental”.`)
    expect(job.brief).not.toContain('Ignore')
  })

  it('fences the page’s text in the prompt, and the system says fenced text is data', () => {
    const prompt = aiLayoutPagePrompt({
      job,
      plan: job.plan as never,
      screen: job.plan?.screens[0] as never,
      targets: aiLayoutPageTargets({ job, inventory: null, own: [] }),
      reusableComponents: true,
    })
    const open = prompt.indexOf(`<${UNTRUSTED_TEXT_TAG}`)
    const close = prompt.indexOf(`</${UNTRUSTED_TEXT_TAG}>`)
    expect(open).toBeGreaterThan(-1)
    expect(prompt.indexOf(HARBOR_INJECTION)).toBeGreaterThan(open)
    expect(prompt.indexOf(HARBOR_INJECTION)).toBeLessThan(close)
    // Once: the hostile line appears nowhere outside the fence.
    expect(prompt.split(HARBOR_INJECTION)).toHaveLength(2)
    expect(prompt).toContain('This page is the site owner\'s own page, brought in from their current website.')
    expect(aiJobPageLanguageInstructions(job).map((block) => block.text)).toContain(UNTRUSTED_TEXT_RULE)
    // A page that is not brought in keeps the cached instructions as they were.
    expect(aiJobPageLanguageInstructions({ inputs: {} })).toHaveLength(1)
  })

  it('counts the old page’s phone and address as given, so the page may keep them', () => {
    expect(aiLayoutFacts(job)).toContain('(207) 555-0142')
  })

  it('tells the header and footer the site’s name and the pages it links, never a later wave’s', () => {
    const frame = aiSiteImportFrameJob(importJob(), state, state.waves[0], aiSiteImportLedger(state))
    expect(frame).toMatchObject({ kind: 'layout', $id: state.frame?.draftId })
    expect(frame.inputs['businessName']).toBe('Harbor Dental')
    expect((frame.inputs['sitePages'] as Array<{ slug: string }>).map((page) => page.slug)).toEqual(['/', '/about', '/login', '/services', '/team'])
  })
})

describe('a page job carries the source’s layout, links every planned page and keeps the source’s title and description (AGL-4107)', () => {
  const base = harborState()
  const services = base.pages.find((page) => page.path === '/services') as AiSiteImportState['pages'][number]
  const blocks: SiteImportBlock[] = [
    { kind: 'heading', level: 1, text: 'Services', region: 'main' },
    { kind: 'paragraph', text: 'Cleanings, fillings and crowns.', region: 'main' },
    { kind: 'heading', level: 2, text: 'Preventive care', region: 'main' },
    { kind: 'paragraph', text: 'Two cleanings a year.', region: 'main' },
  ]
  const layout: SiteImportLayout = {
    v: 1,
    sections: [
      { name: 'Our services', from: 'landmark', band: 'plain', background: '#ffffff', align: 'start', nodes: [0, 1].map((line) => ({ kind: 'line' as const, line })), lines: [0, 1] },
      { name: 'Prevention', from: 'landmark', band: 'soft', background: '#f5f5f5', align: 'center', nodes: [2, 3].map((line) => ({ kind: 'line' as const, line })), lines: [2, 3] },
    ],
    icons: [],
    look: { fonts: { body: null, headings: null, google: [] }, background: null, text: null, buttonFill: null, buttonText: null, buttonRadius: null, link: null, header: null },
  }
  const meta = { title: 'Services | Harbor Dental — Portland’s family dentist since 1998', description: 'Cleanings, fillings and crowns for the whole family, in Portland, Maine.' }
  const state = aiSiteImportWaveStarted(
    base,
    0,
    NOW.toISOString(),
    new Map([[services.slot, { at: 'x', title: 'Services', text: '', sections: ['Services'], images: [], blocks, layout, meta }]]),
  )
  const job = aiSiteImportPageJob(importJob({ siteImport: state }), state, state.pages.find((page) => page.slot === services.slot) as typeof services, aiSiteImportLedger(state))
  const doc = job.inputs[AI_LAYOUT_IMPORTED_SECTIONS_INPUT] as AiSiteImportDocument

  it('plans the page in the source’s own sections, by the names its layout gives them', () => {
    expect(job.plan?.screens[0].sections.map((section) => section.name)).toEqual(['Our services', 'Prevention'])
    expect(doc.layout).toEqual(layout)
  })

  it('keeps the source’s title and description word for word, never the page’s short name', () => {
    expect(job.plan?.screens[0]).toMatchObject({ title: 'Services', seoTitle: meta.title, seoDescription: meta.description })
  })

  it('may link every page the import plans, in any wave, by the id its draft is written under', () => {
    const planned = base.pages.filter((page) => page.slug !== '/' && !page.refused).map((page) => page.draftId)
    expect(doc.links.map((link) => link.id)).toEqual(planned)
  })
})

describe('a wave reads its pages again, and leaves out what changed', () => {
  it('leaves out a page that became a sign-in page and the pages past the plan’s room, settling their rows as not brought in', async () => {
    const state = harborState()
    const ledger = aiSiteImportLedger(state)
    // Three pages of room left (pages were added since the read): the wave's last two are past the plan.
    const step = createAiJobImportStep(deps({ readRoom: async () => ({ limit: 3, used: 0 }) }))
    const result = await run(step, importJob({ siteImport: state, items: ledger }))
    const reads = new Map(result.siteImport?.pages.map((page) => [page.path, page.refused ?? (page.read ? 'read' : null)]))
    expect([...reads]).toEqual([
      ['/', 'read'],
      ['/about', 'read'],
      ['/members/login', 'login-form'],
      ['/services', 'plan-limit'],
      ['/team', 'plan-limit'],
    ])
    const skipped = result.items?.filter((row) => row.status === 'skipped').map((row) => [row.label, row.note])
    expect(skipped).toEqual([
      ['members/login', 'A sign-in page. Pages that ask for a password are never brought in.'],
      ['services', 'Past your plan’s page count. Upgrade for more pages, then bring the rest in.'],
      ['team', 'Past your plan’s page count. Upgrade for more pages, then bring the rest in.'],
    ])
    expect(result.continue).toBe(true)
    expect(result.siteImport?.waves[0].status).toBe('running')
  })

  it('reads the rest of a wave on the next pass when the clock cut its read short, leaving nothing out for it', async () => {
    const state = harborState()
    const ledger = aiSiteImportLedger(state)
    const real = deps().crawlSeams
    let calls = 0
    // The first read reaches two pages before its clock runs out; the next reads the rest.
    const crawl = (async (options, seams) => {
      calls += 1
      const { crawlSiteForImport } = await import('../site-import/site-import-crawl')
      const only = options.only ?? []
      const result = await crawlSiteForImport({ ...options, only: calls === 1 ? only.slice(0, 2) : only }, seams ?? real)
      return calls === 1 ? { ...result, stoppedBy: 'time' as const } : result
    }) as NonNullable<AiSiteImportStepDeps['crawl']>
    const step = createAiJobImportStep(deps({ crawl }))
    const first = await run(step, importJob({ siteImport: state, items: ledger }))
    const after = (result: typeof first) => result.siteImport?.pages.map((page) => [page.path, page.refused ?? (page.read ? 'read' : null)])
    expect(after(first)).toEqual([
      ['/', 'read'],
      ['/about', 'read'],
      ['/members/login', null],
      ['/services', null],
      ['/team', null],
    ])
    expect(first.items?.filter((row) => row.status === 'skipped')).toEqual([])
    // The pages in hand go in first; the read goes on once their words are gone (AGL-4083).
    const inHand = first.siteImport?.pages.filter((page) => page.read).map((page) => page.slot) ?? []
    const built = (first.items ?? []).map((row): AiJobItemLedger => (row.slot === 'frame' || inHand.includes(row.slot) ? { ...row, status: 'succeeded' } : row))
    const second = await run(step, importJob({ siteImport: first.siteImport, items: built }))
    expect(after(second)).toEqual([
      ['/', 'read'],
      ['/about', 'read'],
      ['/members/login', 'login-form'],
      ['/services', 'read'],
      ['/team', 'read'],
    ])
    expect(aiSiteImportRunMinimumMs(importJob({ siteImport: first.siteImport, items: built }))).toBe(AI_SITE_IMPORT_PASS_MINIMUM_MS.wave)
  })

  it('stops for the person when robots.txt cannot be read, reading nothing else', async () => {
    const asked: string[] = []
    const step = createAiJobImportStep(
      deps({ crawlSeams: { fetch: harborFetch(asked, { [`${HARBOR_ORIGIN}/robots.txt`]: { status: 503, contentType: 'text/plain', body: '' } }) } }),
    )
    const result = await run(step, importJob())
    expect(result.review).toEqual({ reason: 'wave', message: AI_SITE_IMPORT_COPY.robots(HARBOR_DOMAIN), findings: [] })
    expect(asked).toEqual([`${HARBOR_ORIGIN}/robots.txt`])
    expect(result.siteImport).toBeUndefined()
  })

  it('leaves out a page the site’s bot protection now turns away as blocked, saying how to let AglynBot in', async () => {
    const state = harborState()
    const ledger = aiSiteImportLedger(state)
    const step = createAiJobImportStep(
      deps({ crawlSeams: { fetch: harborFetch([], { [`${HARBOR_ORIGIN}/about`]: { status: 429, contentType: 'text/html', body: '' } }) } }),
    )
    const result = await run(step, importJob({ siteImport: state, items: ledger }))
    expect(result.siteImport?.pages.find((page) => page.path === '/about')?.refused).toBe('blocked')
    expect(result.items?.find((row) => row.label === 'about')).toMatchObject({ status: 'skipped', note: AI_SITE_IMPORT_LEFT_OUT_COPY.blocked })
  })

  it('lists a page the site’s bot protection turned away on the read as blocked, not unreadable', async () => {
    const step = createAiJobImportStep(
      deps({ crawlSeams: { fetch: harborFetch([], { [`${HARBOR_ORIGIN}/team`]: { status: 429, contentType: 'text/html', body: '' } }) } }),
    )
    const result = await run(step, importJob())
    expect(result.siteImport?.leftOut).toContainEqual({ url: `${HARBOR_ORIGIN}/team`, path: '/team', title: '', reason: 'blocked' })
    expect(result.siteImport?.leftOutCount.blocked).toBe(1)
    expect(result.siteImport?.leftOutCount.unreadable).toBeUndefined()
  })

  it('says how to let AglynBot in when the site’s bot protection turns every page away, and that the site is down otherwise', async () => {
    const answering = (status: number) => (url: string, options: Parameters<ReturnType<typeof harborFetch>>[1]) =>
      url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')
        ? harborFetch()(url, options)
        : harborFetch([], { [url]: { status, contentType: 'text/html', body: '' } })(url, options)
    // The read's verdict words it (AGL-4084): no ledger, nothing quoted, Check again reads again.
    const blocked = await run(createAiJobImportStep(deps({ crawlSeams: { fetch: answering(403) } })), importJob())
    expect(blocked.review?.reason).toBe('blocked')
    expect(blocked.review?.message).toContain('turned AglynBot away before it could read your home page')
    expect(blocked.review?.message).toContain('no AI credits were used')
    expect(blocked.items).toEqual([])
    expect(blocked.siteImport?.waves).toEqual([])
    const down = await run(createAiJobImportStep(deps({ crawlSeams: { fetch: answering(500) } })), importJob())
    expect(down.review?.reason).toBe('unreadable')
    expect(down.review?.message).toContain(`Your home page could not be read (it answered with an error, 500)`)
  })

  it('refuses a lookalike address outright', async () => {
    const step = createAiJobImportStep(deps())
    expect((await run(step, importJob({ inputs: { domain: 'not a domain' } }))).failure).toBe(AI_SITE_IMPORT_COPY.badDomain)
  })

  it('never builds a page when the release flag went off between waves', async () => {
    const state = harborState()
    const step = createAiJobImportStep(deps({ releaseFlagOn: async () => false }))
    const result = await run(step, importJob({ siteImport: state, items: aiSiteImportLedger(state) }))
    expect(result.review).toMatchObject({ reason: 'wave', message: AI_SITE_IMPORT_COPY.unavailable })
    expect(result.siteImport).toBeUndefined()
  })
})

describe('each pass’s least time', () => {
  beforeAll(() => {
    registerAiJobStep('page', async () => outcome(), { minimumMs: AI_JOB_PAGE_LANGUAGE_BUDGET.minimumMs })
  })

  it('gives the read, a wave’s read and a page’s photos their own clocks, and a page the page step’s', () => {
    expect(aiSiteImportRunMinimumMs(importJob())).toBe(AI_SITE_IMPORT_PASS_MINIMUM_MS.read)
    const state = harborState()
    const ledger = aiSiteImportLedger(state)
    expect(aiSiteImportRunMinimumMs(importJob({ siteImport: state, items: ledger }))).toBe(AI_SITE_IMPORT_PASS_MINIMUM_MS.wave)
    // Started, nothing read yet: the read goes on first.
    expect(aiSiteImportRunMinimumMs(importJob({ siteImport: aiSiteImportWaveStarted(state, 0, 'x', new Map()), items: ledger }))).toBe(
      AI_SITE_IMPORT_PASS_MINIMUM_MS.wave,
    )
    const read = new Map(state.waves[0].slots.map((slot) => [slot, { at: 'x', title: 'T', text: 'words', sections: ['Hero'], images: [{ url: 'https://harbor-dental.com/p.jpg', alt: '' }] }]))
    let started = aiSiteImportWaveStarted(state, 0, 'x', read)
    const framed = ledger.map((row): AiJobItemLedger => (row.slot === 'frame' ? { ...row, status: 'succeeded' } : row))
    expect(aiSiteImportRunMinimumMs(importJob({ siteImport: started, items: framed }))).toBe(AI_SITE_IMPORT_PASS_MINIMUM_MS.photos)
    started = { ...started, pages: started.pages.map((page) => ({ ...page, photos: { brought: 0, reused: 0, skipped: 0, assets: [] } })) }
    expect(aiSiteImportRunMinimumMs(importJob({ siteImport: started, items: framed }))).toBeGreaterThanOrEqual(aiJobStepMinimumMs('page', 'generate'))
    // Every pass fits what one beat can give it.
    for (const ms of Object.values(AI_SITE_IMPORT_PASS_MINIMUM_MS)) expect(ms).toBeLessThanOrEqual(276_000)
  })

  it('never holds a pass that asks no model to a model’s whole answer (AGL-4083)', () => {
    const state = harborState()
    const ledger = aiSiteImportLedger(state).map((row): AiJobItemLedger => (row.slot === 'frame' ? { ...row, status: 'succeeded' } : row))
    const read = (meta: { title: string; description: string }, images: AiSiteImportPageRead['images'] = []) =>
      new Map(state.waves[0].slots.map((slot) => [slot, { at: 'x', title: 'T', text: 'words', sections: ['Hero'], images, meta }]))
    const built = (next: AiSiteImportState, build: 'copied' | 'arranged') => ({ ...next, pages: next.pages.map((page) => ({ ...page, build, photos: { brought: 0, reused: 0, skipped: 0, assets: [] } })) })
    const listed = { title: 'A release', description: 'What changed in it.' }
    const minimum = (next: AiSiteImportState) => aiSiteImportRunMinimumMs(importJob({ siteImport: next, items: ledger }))

    // A page of no pictures and no answer: nothing to fetch and nothing to wait on.
    expect(minimum(aiSiteImportWaveStarted(state, 0, 'x', read(listed)))).toBe(0)
    expect(minimum(built(aiSiteImportWaveStarted(state, 0, 'x', read(listed)), 'copied'))).toBe(0)
    // Pictures to fetch still have their clock, and an answer still has a model's.
    expect(minimum(aiSiteImportWaveStarted(state, 0, 'x', read(listed, [{ url: 'https://harbor-dental.com/p.jpg', alt: '' }])))).toBe(AI_SITE_IMPORT_PASS_MINIMUM_MS.photos)
    expect(minimum(built(aiSiteImportWaveStarted(state, 0, 'x', read(listed)), 'arranged'))).toBeGreaterThanOrEqual(aiJobStepMinimumMs('page', 'generate'))
    // A copied page whose source left its listing empty asks a model for it.
    expect(minimum(built(aiSiteImportWaveStarted(state, 0, 'x', read({ title: 'A release', description: '' })), 'copied'))).toBeGreaterThanOrEqual(aiJobStepMinimumMs('page', 'generate'))
  })

  it('gives a 400-page site room for every pass a page can take', () => {
    expect(AI_SITE_IMPORT_MAX_PASSES).toBe(3_260)
  })
})

describe('a whole site fits the one document its import rides (AGL-4083)', () => {
  const readOf = (chars: number): AiSiteImportPageRead => ({ at: 'x', title: 'T', text: 'w'.repeat(chars), sections: ['Hero'], images: [{ url: 'https://harbor-dental.com/p.jpg', alt: 'A photo' }], blocks: [], meta: { title: 'T', description: 'D' } })
  const pages = (state: AiSiteImportState) => state.waves.flatMap((wave) => wave.slots)
  const weight = (job: AiJob) => Buffer.byteLength(JSON.stringify(job))

  it('reads pages in order up to what the document can take, and every page the read left out', () => {
    const state = harborState()
    const [a, b, c, d] = pages(state)
    const room = AI_SITE_IMPORT_JOB_MAX_BYTES - weight(importJob({ siteImport: state }))
    const reads = new Map<string, AiSiteImportPageRead | 'blocked'>([
      [a, readOf(room - 2_000)],
      [b, readOf(4_000)],
      [c, 'blocked'],
      [d, readOf(10)],
    ])
    const kept = aiSiteImportReadsWithin(importJob({ siteImport: state }), state, reads)
    expect([...kept.keys()]).toEqual([a, c])
  })

  it('never leaves a wave with nothing to go on: with nothing held, its first page goes', () => {
    const state = harborState()
    const [a, b] = pages(state)
    const kept = aiSiteImportReadsWithin(importJob({ siteImport: state }), state, new Map([[a, readOf(AI_SITE_IMPORT_JOB_MAX_BYTES)], [b, readOf(10)]]))
    expect([...kept.keys()]).toEqual([a])
  })

  it('builds the pages a wave read, then reads the rest, so a wave held back still ends', () => {
    const state = harborState()
    const ledger = aiSiteImportLedger(state).map((row): AiJobItemLedger => (row.slot === 'frame' ? { ...row, status: 'succeeded' } : row))
    const [a, b, ...others] = state.waves[0].slots
    const started = aiSiteImportWaveStarted(state, 0, 'x', new Map([[a, readOf(10)], [b, readOf(10)]]))
    expect(aiSiteImportNextWork(started, ledger)).toMatchObject({ kind: 'images', page: { slot: a } })
    const settled = ledger.map((row): AiJobItemLedger => (row.slot === a || row.slot === b ? { ...row, status: 'succeeded' } : row))
    expect(aiSiteImportNextWork(started, settled)).toMatchObject({ kind: 'read', pages: others.map((slot) => expect.objectContaining({ slot })) })
  })

  it('keeps nothing of a page that is in but what its row shows', () => {
    const state = harborState()
    const [a] = state.waves[0].slots
    let held = aiSiteImportWaveStarted(state, 0, 'x', new Map([[a, { ...readOf(50_000), words: 900 }]]))
    held = aiSiteImportPhotosIn(held, a, { brought: 3, reused: 1, skipped: 1, assets: [{ mediaId: 'm', src: 'media:h/m', from: 'https://harbor-dental.com/p.jpg', width: 10, height: 10 }] })
    const page = aiSiteImportPageSettled(held, a).pages.find((entry) => entry.slot === a)
    expect(page?.read).toEqual({ at: 'x', title: 'T', text: '', sections: [], images: [], blocks: [], forms: [], layout: null, words: 900 })
    expect(page?.photos).toEqual({ brought: 3, reused: 1, skipped: 1, assets: [] })
    expect(page?.title).toBeTruthy()
  })

  it('holds a whole 400-page site, with room for a wave as big as the one that stopped the 11/1 import', () => {
    const base = harborState()
    const template = base.pages[0]
    const asset = { mediaId: 'mXXXXXXXXX', src: 'media:4G9dGlSk9y/mXXXXXXXXX', from: 'https://aglyn.com/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/hWwBgGtkiM?v=9c7e958bf4277afb.2', width: 1600, height: 900, alt: 'A photo of the page' }
    let state: AiSiteImportState = { ...base, pages: Array.from({ length: 400 }, (_, at) => ({ ...template, slot: `p${at}`, url: `https://aglyn.com/changelog/release-${at}`, path: `/changelog/release-${at}`, draftId: `draft-${at}` })) }
    for (const page of state.pages) {
      state = aiSiteImportPagesRead(state, new Map([[page.slot, { ...readOf(4_000), images: Array.from({ length: 8 }, () => ({ url: asset.from, alt: asset.alt })) }]]))
      state = aiSiteImportPhotosIn(state, page.slot, { brought: 8, reused: 0, skipped: 0, assets: Array.from({ length: 8 }, () => asset) })
      state = aiSiteImportPageSettled(state, page.slot)
    }
    const items = state.pages.map((page): AiJobItemLedger => ({ slot: page.slot, op: 'page', label: page.title, status: 'succeeded', attempt: 1, creditsSpent: 0, creditsRefunded: 0, outputs: [page.draftId] }))
    const job = importJob({ siteImport: state, items, outputs: state.pages.map((page) => ({ resource: 'screen', id: page.draftId, versionId: 'v', hostId: 'h', hostSubdomain: 's', label: page.title })) as never })
    // The 224 KB that ten changelog pages read to on the wave that stopped it, with room left over.
    expect(AI_SITE_IMPORT_JOB_MAX_BYTES - weight(job)).toBeGreaterThan(400_000)
  })
})

describe('an import that stops with work left waits, and never says it is done (AGL-4083)', () => {
  const stoppedAt = (state: AiSiteImportState, items: AiJobItemLedger[]) => aiSiteImportStopReview(importJob({ siteImport: state, items }))

  it('says what is not in yet and which wave brings in the rest', () => {
    const base = harborState()
    const [first, second, ...rest] = base.waves[0].slots
    const state: AiSiteImportState = {
      ...base,
      autoContinue: true,
      waves: [
        { ...base.waves[0], slots: [first, second], status: 'done' },
        { ...base.waves[0], index: 1, label: 'Blog, 1 of 2', frame: false, slots: rest, status: 'waiting', startedAt: null, finishedAt: null },
      ],
    }
    const settled = aiSiteImportLedger(state).map((row): AiJobItemLedger => (row.slot === first || row.slot === second || row.slot === 'frame' ? { ...row, status: 'succeeded' } : row))
    expect(stoppedAt(state, settled)).toEqual({ reason: 'wave', message: AI_SITE_IMPORT_COPY.stopped(rest.length, 'Blog, 1 of 2'), findings: [] })
    expect(AI_SITE_IMPORT_COPY.stopped(57, 'Changelog, 25 of 27')).toBe(
      'Your import stopped before it finished, so 57 pages are not in yet. Everything brought in so far is safe. Start Changelog, 25 of 27 to bring in the rest.',
    )
    expect(AI_SITE_IMPORT_COPY.stopped(1, 'Legal')).toContain('so 1 page is not in yet')
  })

  it('offers the wave it stopped inside, which starts again where it stopped', () => {
    const state = harborState()
    const [a] = state.waves[0].slots
    const started = aiSiteImportWaveStarted(state, 0, 'x', new Map([[a, { at: 'x', title: 'T', text: '', sections: [], images: [] }]]))
    const job = importJob({ siteImport: started, items: aiSiteImportLedger(state), status: 'needs_review', review: { reason: 'wave', message: 'Stopped.', findings: [] } })
    expect(aiSiteImportStartAction(job as never)).toMatchObject({ wave: { index: 0 } })
    // While it runs, nothing is offered: the wave is on its way.
    expect(aiSiteImportStartAction({ ...job, status: 'running' } as never)).toBeNull()
    expect(aiSiteImportStoppedCopy(job as never)).toBe('Stopped.')
  })

  it('tells a person who has not started yet nothing about a stop', () => {
    const state = harborState()
    expect(aiSiteImportStoppedCopy({ status: 'needs_review', review: { reason: 'wave', message: 'Start your first wave.', findings: [] }, siteImport: state } as never)).toBeNull()
  })

  it('leaves an import with nothing left to do to end as any build ends', () => {
    expect(stoppedAt({ ...harborState(), waves: harborState().waves.map((wave) => ({ ...wave, status: 'done' as const })) }, [])).toBeNull()
    expect(aiSiteImportStopReview(importJob())).toBeNull()
  })
})
