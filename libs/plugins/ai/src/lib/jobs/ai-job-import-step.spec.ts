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
 * model answer is told and how its text is fenced, what Trust & Safety reads,
 * what a wave leaves out when the site changed since it was read, and how
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
  aiSiteImportWaveStarted,
  type AiSiteImportState,
} from '../model/ai-site-import'
import { siteImportReviewDetails, fileSiteImportReview, SITE_IMPORT_REVIEW_SOURCE } from '../site-import/site-import-review'
import {
  HARBOR_DOMAIN,
  HARBOR_INJECTION,
  HARBOR_ORIGIN,
  harborFetch,
} from '../site-import/fixtures/site-import-wave-recordings'
import {
  AI_SITE_IMPORT_COPY,
  AI_SITE_IMPORT_PASS_MINIMUM_MS,
  aiSiteImportFrameJob,
  aiSiteImportPageJob,
  aiSiteImportRunMinimumMs,
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
    fileReview: async () => 'row',
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
    const second = await run(step, importJob({ siteImport: first.siteImport, items: first.items }))
    expect(after(second)).toEqual([
      ['/', 'read'],
      ['/about', 'read'],
      ['/members/login', 'login-form'],
      ['/services', 'read'],
      ['/team', 'read'],
    ])
    expect(aiSiteImportRunMinimumMs(importJob({ siteImport: first.siteImport, items: first.items }))).toBe(AI_SITE_IMPORT_PASS_MINIMUM_MS.wave)
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
    const blocked = await run(createAiJobImportStep(deps({ crawlSeams: { fetch: answering(403) } })), importJob())
    expect(blocked.review).toEqual({ reason: 'wave', message: AI_SITE_IMPORT_COPY.blocked(HARBOR_DOMAIN), findings: [] })
    expect(blocked.siteImport).toBeUndefined()
    const down = await run(createAiJobImportStep(deps({ crawlSeams: { fetch: answering(500) } })), importJob())
    expect(down.review).toEqual({ reason: 'wave', message: AI_SITE_IMPORT_COPY.nothing(HARBOR_DOMAIN), findings: [] })
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

describe('the Trust & Safety row every import files', () => {
  const state = harborState()
  const input = {
    orgId: 'org-pro',
    hostId: 'host-1',
    jobId: 'importJob1',
    state,
    items: aiSiteImportLedger(state),
    event: 'read' as const,
    nowMs: NOW.getTime(),
  }

  it('says what was proved and how, what was read, kept and left out, and that nothing is published', () => {
    const details = siteImportReviewDetails(input)
    expect(details).toContain(`Site import: ${HARBOR_DOMAIN} into site host-1 (AI job importJob1).`)
    expect(details).toContain('Ownership proven by a DNS TXT record (_aglyn-challenge.harbor-dental.com) on 2026-10-19.')
    expect(details).toContain('Read 5 pages; bringing in 5 pages in 1 wave (plan page count 25, 0 already on the site).')
    expect(details).toContain('Left out: robots 1.')
    expect(details).toContain('Nothing is published by the import')
  })

  it('is written in the abuse queue’s own shape, as the outbound screen files a hold', async () => {
    const writes: Array<{ path: string; data: Record<string, unknown> }> = []
    const firestore = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => ({ exists: false }),
          set: async (data: Record<string, unknown>) => {
            writes.push({ path: `${name}/${id}`, data })
          },
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore
    expect(await fileSiteImportReview(firestore, input)).toBe('site-import-importJob1')
    expect(writes[0].path).toBe('abuseReports/site-import-importJob1')
    expect(writes[0].data).toMatchObject({
      reference: 'SI-IMPORTJOB1',
      category: 'impersonation',
      severity: 'normal',
      source: SITE_IMPORT_REVIEW_SOURCE,
      url: `https://${HARBOR_DOMAIN}/`,
      reportedHostname: HARBOR_DOMAIN,
      hostId: 'host-1',
      orgId: 'org-pro',
      reporterEmail: null,
      dmca: null,
      status: 'open',
      siteImport: { jobId: 'importJob1', domain: HARBOR_DOMAIN, method: 'dns', kept: 5, waves: 1 },
    })
  })

  it('never stops an import when the row cannot be written', async () => {
    const firestore = { collection: () => ({ doc: () => ({ get: async () => Promise.reject(new Error('down')) }) }) } as never
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await fileSiteImportReview(firestore, input)).toBeNull()
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
    const read = new Map(state.waves[0].slots.map((slot) => [slot, { at: 'x', title: 'T', text: 'words', sections: ['Hero'], images: [] }]))
    let started = aiSiteImportWaveStarted(state, 0, 'x', read)
    const framed = ledger.map((row): AiJobItemLedger => (row.slot === 'frame' ? { ...row, status: 'succeeded' } : row))
    expect(aiSiteImportRunMinimumMs(importJob({ siteImport: started, items: framed }))).toBe(AI_SITE_IMPORT_PASS_MINIMUM_MS.photos)
    started = { ...started, pages: started.pages.map((page) => ({ ...page, photos: { brought: 0, reused: 0, skipped: 0, assets: [] } })) }
    expect(aiSiteImportRunMinimumMs(importJob({ siteImport: started, items: framed }))).toBeGreaterThanOrEqual(aiJobStepMinimumMs('page', 'generate'))
    // Every pass fits what one beat can give it.
    for (const ms of Object.values(AI_SITE_IMPORT_PASS_MINIMUM_MS)) expect(ms).toBeLessThanOrEqual(276_000)
  })
})
