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
 * Bring my site builds in the site's own look and lands in its preview
 * (AGL-4084), replayed pass by pass on aglyn.com as AglynBot read it on
 * 2026-10-28: the read's verdict, the look from the owner's own home page
 * with no model, the header's brand as the source draws it, the footer told
 * the source's own facts, each page copied or arranged, a wave's close
 * published into the preview, and "Start every remaining wave".
 *
 * Every address is answered from the recordings through a stubbed `fetch`,
 * under the real `fetchPublicTextDetailed`. No model is called.
 */

const mockResolvePublicIp = jest.fn(async (_host: string) => '93.184.216.34')

jest.mock('@aglyn/tenant-data-admin/server/serve-plugin-fetch', () => ({
  __esModule: true,
  resolvePublicIp: (host: string) => mockResolvePublicIp(host),
  createPinnedDispatcher: () => ({ close: async () => undefined }),
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

import { defaultSiteSeo } from '@aglyn/aglyn/app-utils/default-site'
import { UNTRUSTED_TEXT_TAG } from '@aglyn/shared-util-tools/untrusted-text'
import type { AiJob, AiJobItemLedger, AiJobOutput } from '../model/ai-jobs.types'
import { aiSiteImportLedger, type AiSiteImportState } from '../model/ai-site-import'
import {
  AGLYN_DOMAIN,
  AGLYN_ORIGIN,
  AGLYN_RECORDED_PAGES,
  aglynAnswer,
  aglynRecording,
  aglynSyntheticPage,
} from '../site-import/fixtures/aglyn-com-recordings'
import { AI_LAYOUT_SITE_PAGES_INPUT } from './ai-job-layout-site-pages'
import {
  aiSiteImportBrandName,
  aiSiteImportFrameJob,
  aiSiteImportPageJob,
  aiSiteImportStartAllUpdate,
  createAiJobImportStep,
  type AiSiteImportStepDeps,
} from './ai-job-import-step'
import { AI_LAYOUT_SITE_BRAND_INPUT, AI_LAYOUT_SITE_FACTS_INPUT, aiJobLayoutLanguageInstructions, aiLayoutFrameCheck, aiLayoutFramePrompt, aiLayoutSiteBrandOf } from './ai-job-layout-language'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, type AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportListingUpdates, aiSiteImportLogo } from './ai-site-import-look'
import { aiPublishImportedWave } from './ai-site-import-publish'
import { siteImportPageRead } from '../site-import/site-import-page'
import { extractSiteImportPage } from '../site-import/site-import-html'
import type { AiJobStepOutcome } from './ai-job-text-step'
import { aiApplyJobItemRecord } from './ai-jobs'
import type { AiSiteStyle } from '../model/ai-site-look'
import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'

const NOW = new Date('2026-10-28T18:00:00.000Z')
const SITE_NAME = 'Aglyn Import Check'
const HOME_STYLES = aglynRecording('home.styles.css')
const LOGO_PREFIX = `${AGLYN_ORIGIN}/api/media/cdn/`
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><path d="M0 0h120v40H0z" fill="#0077ad"/></svg>'

let fetchSpy: jest.SpyInstance
let asked: string[] = []

/** aglyn.com as recorded: its home page with its own styles, its header logo as an SVG, the rest of its pages small. */
function serveAglyn(options: { challenged?: boolean } = {}) {
  asked = []
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    asked.push(url)
    if (url.startsWith(LOGO_PREFIX)) return new Response(LOGO_SVG, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
    const answer = aglynAnswer(url, options)
    const path = new URL(url).pathname
    let body = answer.body
    if (answer.status === 200 && path === '/') body = body.replace('</head>', `<style>${HOME_STYLES}</style></head>`)
    else if (answer.status === 200 && /text\/html/.test(answer.headers['content-type'] ?? '') && !AGLYN_RECORDED_PAGES[path]) {
      body = aglynSyntheticPage(path, 2_000)
    }
    return new Response(body || null, { status: answer.status, headers: answer.headers })
  })
}

afterEach(() => fetchSpy?.mockRestore())

function importJob(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'importJobAglyn',
    orgId: 'org-test',
    hostId: 'host-import',
    kind: 'import',
    status: 'running',
    brief: `Bring in ${AGLYN_DOMAIN}`,
    inputs: { domain: AGLYN_DOMAIN },
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-owner',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    ...patch,
  }
}

/** A library that keeps what it is given, by key, once. */
function library(): PluginMediaIngest & { stored: Array<{ contentType: string; key: string }> } {
  const held = new Map<string, { mediaId: string; src: string }>()
  const stored: Array<{ contentType: string; key: string }> = []
  return {
    stored,
    ingest: async (request) => {
      const key = request.importedFrom?.key ?? request.fileName
      stored.push({ contentType: request.contentType, key })
      const asset = { mediaId: `m${stored.length}`, src: `media:host-import/m${stored.length}` }
      held.set(key, asset)
      return { ok: true, ...asset }
    },
    findStockPhoto: async () => null,
    findOwnerPhotos: async () => [],
    findImportedPhoto: async ({ sourceKey }) => (held.has(sourceKey) ? { ...(held.get(sourceKey) as { mediaId: string; src: string }), alt: '' } : null),
  } as unknown as PluginMediaIngest & { stored: Array<{ contentType: string; key: string }> }
}

interface Harness {
  deps: AiSiteImportStepDeps
  saved: AiSiteStyle[]
  hostWrites: Record<string, unknown>[]
  rasterized: number
  rateLimited: number
  published: Array<Parameters<typeof aiPublishImportedWave>[1]>
  frames: AiJob[]
  pages: AiJob[]
  lib: ReturnType<typeof library>
}

function harness(patch: Partial<AiSiteImportStepDeps> = {}, theme: 'applied' | 'kept' = 'applied'): Harness {
  const lib = library()
  const h: Harness = { deps: {} as AiSiteImportStepDeps, saved: [], hostWrites: [], rasterized: 0, rateLimited: 0, published: [], frames: [], pages: [], lib }
  const runner = (kind: string) => async (context: { job: AiJob }): Promise<AiJobStepOutcome> => {
    ;(kind === 'layout' ? h.frames : h.pages).push(context.job)
    const output: AiJobOutput = { resource: kind === 'layout' ? 'layout' : 'screen', id: context.job.$id, label: 'Built', hostId: 'host-import' } as AiJobOutput
    return { outputs: [output], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, estCostUsd: 0.001, model: 'm', stopReason: 'tool_use' }
  }
  h.deps = {
    runnerFor: ((kind: string) => runner(kind)) as never,
    ownership: async () => ({ current: true, method: 'dns', provenAt: NOW.getTime(), detail: 'x' }),
    rateLimit: async () => {
      h.rateLimited += 1
      return { allowed: true }
    },
    releaseFlagOn: async () => true,
    ingest: () => lib,
    readRoom: async () => ({ limit: null, used: 0 }),
    readSiteName: async () => SITE_NAME,
    fileReview: async () => 'row',
    pageWritten: async () => true,
    draftWords: async () => 120,
    publishWave: async (_firestore, input) => {
      h.published.push(input)
      return { liveUrl: 'https://import-check.aglyn.app/', published: [{ id: 'x', label: 'Home', path: '/' }], drafts: [] }
    },
    lookDeps: {
      save: async (_firestore, input) => {
        h.saved.push(input.style)
        return { write: theme, baseName: 'Base' }
      },
      others: async () => [],
      readHost: async () => ({ displayName: SITE_NAME, seo: defaultSiteSeo(SITE_NAME) }),
      writeHost: async (_firestore, _hostId, updates) => {
        h.hostWrites.push(updates)
      },
      rasterize: async () => {
        h.rasterized += 1
        return new Uint8Array(2_048).fill(7)
      },
    },
    ...patch,
  }
  return h
}

/** One pass, applied to the job the way the machine applies it. */
async function pass(step: ReturnType<typeof createAiJobImportStep>, job: AiJob): Promise<{ job: AiJob; outcome: AiJobStepOutcome }> {
  const outcome = await step({ job, stepIndex: 0, now: NOW, firestore: {} as never, org: { plan: 'pro' } as never })
  let items: AiJobItemLedger[] = outcome.items ?? job.items ?? []
  if (outcome.item) items = aiApplyJobItemRecord(items, outcome.item, 0, NOW)
  return {
    outcome,
    job: {
      ...job,
      items,
      siteImport: outcome.siteImport ?? job.siteImport ?? null,
      outputs: [...(job.outputs ?? []), ...(outcome.outputs ?? [])],
      ...(outcome.sitePublish ? { sitePublish: outcome.sitePublish } : {}),
    },
  }
}

describe('the read: Home first, and no credit until Home can be read (AGL-4083, wired by AGL-4084)', () => {
  it('spends nothing and quotes nothing when Home is blocked: the 10/20 shape', async () => {
    serveAglyn({ challenged: true })
    const h = harness()
    const { outcome } = await pass(createAiJobImportStep(h.deps), importJob())
    expect(outcome.review?.reason).toBe('blocked')
    expect(outcome.review?.message).toMatch(/turned AglynBot away before it could read your home page, and [\d,]+ other pages/)
    expect(outcome.review?.message).toContain('Your site answers through Vercel')
    expect(outcome.items).toEqual([])
    expect(outcome.siteImport?.waves).toEqual([])
    expect(outcome.usage.outputTokens).toBe(0)
    expect(outcome.estCostUsd).toBe(0)
  })
})

describe('aglyn.com, read whole: what the home page says of the site, and how each page is built', () => {
  let state: AiSiteImportState
  beforeAll(async () => {
    serveAglyn()
    const { job } = await pass(createAiJobImportStep(harness().deps), importJob())
    state = job.siteImport as AiSiteImportState
    fetchSpy.mockRestore()
  })

  it('keeps the header brand as the source draws it, its logo and its own facts', () => {
    expect(state.home?.brand.kind).toBe('logo-only')
    expect(state.home?.brand.logo?.url.startsWith(LOGO_PREFIX)).toBe(true)
    expect(state.home?.siteName).toBe('Aglyn')
    expect(state.home?.facts.lines.join('\n')).toContain('Austin')
    expect(state.home?.description).toContain('Aglyn AI builds the first draft')
  })

  it('arranges the main pages, Home whatever its length, and copies a collection’s', () => {
    const by = (path: string) => state.pages.find((page) => page.path === path)
    expect(by('/')?.build).toBe('arranged')
    expect(by('/contact')?.build).toBe('arranged')
    expect(by('/legal/privacy')?.build).toBe('copied')
    expect(state.pages.filter((page) => page.group === 'c:blog').every((page) => page.build === 'copied')).toBe(true)
  })

  it('hands a copied page its every block, its sections the source’s own', () => {
    const privacy = state.pages.find((page) => page.path === '/legal/privacy') as AiSiteImportState['pages'][number]
    const extract = extractSiteImportPage(aglynRecording('legal__privacy.html'), privacy.url, (url) => url.origin === AGLYN_ORIGIN)
    const read = siteImportPageRead({ ...extract, url: privacy.url, path: privacy.path, foundBy: 'sitemap', bytes: 0 }, NOW.toISOString())
    const withRead = { ...state, pages: state.pages.map((page) => (page.slot === privacy.slot ? { ...page, read } : page)) }
    const job = aiSiteImportPageJob(importJob(), withRead, { ...privacy, read }, aiSiteImportLedger(withRead))
    const doc = job.inputs?.[AI_LAYOUT_IMPORTED_SECTIONS_INPUT] as AiSiteImportDocument
    expect(doc.build).toBe('copied')
    expect(doc.blocks).toEqual(read.blocks)
    expect(job.plan?.screens[0].sections).toHaveLength(14)
    // The old page step's paraphrase input is not handed in beside it.
    expect(job.inputs?.['importedPage']).toBeUndefined()
  })
})

describe('the first wave: the look before the frame, the brand as the source, the facts in the footer (AGL-4084)', () => {
  async function throughLook(theme: 'applied' | 'kept' = 'applied') {
    serveAglyn()
    const h = harness({}, theme)
    const step = createAiJobImportStep(h.deps)
    let { job } = await pass(step, importJob())
    ;({ job } = await pass(step, job)) // start wave 1
    const look = await pass(step, job) // the look
    return { h, step, job: look.job, outcome: look.outcome }
  }

  it('runs the look before the frame, with no model, and saves the source’s blue while the theme is untouched', async () => {
    const { h, outcome, job } = await throughLook()
    expect(h.frames).toHaveLength(0)
    expect(outcome.usage.outputTokens).toBe(0)
    expect(job.siteImport?.look?.theme).toBe('applied')
    expect(job.siteImport?.look?.colors[0]).toBe('#0077ad')
    expect(h.saved[0].brand).toBe('#0077ad')
    // The listing the site was created with takes the home page's own words.
    expect(h.hostWrites[0]['seo.title']).toBe('Build a Website: Describe It, Edit It, Publish Free | Aglyn')
    expect(String(h.hostWrites[0]['seo.description'])).toContain('Describe your website and Aglyn AI builds the first draft')
  })

  it('keeps a theme the owner chose', async () => {
    const { job } = await throughLook('kept')
    expect(job.siteImport?.look?.theme).toBe('kept')
  })

  it('brings the SVG logo in once, as a picture, and the frame’s brand is the logo alone, as the source draws it', async () => {
    const { h, step, job } = await throughLook()
    expect(h.rasterized).toBe(1)
    expect(h.lib.stored.filter((entry) => entry.contentType === 'image/png')).toHaveLength(1)
    await pass(step, job) // the frame
    const frame = h.frames[0]
    // Named as the source names its logo, never by the host's name (AGL-4108).
    expect(aiLayoutSiteBrandOf(frame.inputs)).toEqual({ logo: { src: job.siteImport?.look?.logo?.src }, name: false, alt: 'Aglyn' })
    // The header and footer the frame compiles: an image links home, and no name is printed beside it.
    const check = aiLayoutFrameCheck({
      siteName: SITE_NAME,
      homeId: 'home-id',
      pages: [{ id: 'home-id', label: 'Home', slug: '/' }],
      targets: { pageId: null, pages: [], homeIds: ['home-id'], forms: [], formPageId: null, components: [], facts: '' } as never,
      extend: () => [],
      brand: aiLayoutSiteBrandOf(frame.inputs),
    })
    const built = check({
      header: { band: 'plain', align: 'start', cols: [], blocks: [] },
      footer: { band: 'soft', align: 'start', cols: [], blocks: [{ kind: 'text', col: -1, text: 'Open source. Self-hostable. Yours to run.', to: '', icon: '', style: 'none', items: [] }] },
    })
    expect(built.violations).toEqual([])
    const nodes = Object.values(built.value?.nodes as unknown as Record<string, { componentId: string; props?: Record<string, unknown> }>)
    const logo = nodes.find((node) => node.componentId === 'image')
    expect(logo?.props).toMatchObject({ src: job.siteImport?.look?.logo?.src, alt: 'Aglyn', screenId: 'home-id' })
    expect(nodes.some((node) => node.props?.['children'] === SITE_NAME)).toBe(false)
  })

  it('tells the frame the site’s own header and footer words and its description, never the job’s brief', async () => {
    const { h, step, job } = await throughLook()
    await pass(step, job)
    const frame = h.frames[0]
    const prompt = aiLayoutFramePrompt({ job: frame, siteName: String(frame.inputs?.['businessName']), pages: [], targets: { forms: [], formPageId: null, listings: [] } as never })
    expect(prompt).toContain('Austin')
    expect(prompt).toContain('Aglyn AI builds the first draft')
    expect(prompt).toContain(`<${UNTRUSTED_TEXT_TAG}`)
    expect(prompt).not.toContain('brought in from')
    expect(prompt).not.toContain('Brief:')
    expect(aiJobLayoutLanguageInstructions(frame)).toHaveLength(2)
    expect(frame.inputs?.[AI_LAYOUT_SITE_FACTS_INPUT]).toBeTruthy()
    // The person's name for the site wins over the source's when they differ.
    expect(frame.inputs?.['businessName']).toBe(SITE_NAME)
    // Drawn in the look: its seed.
    expect((frame.inputs?.['siteStyle'] as { seed?: number })?.seed).toBe(job.siteImport?.look?.seed)
  })

  it('links the main pages in the site’s menu order, home first', async () => {
    const { h, step, job } = await throughLook()
    await pass(step, job)
    const pages = (h.frames[0].inputs?.[AI_LAYOUT_SITE_PAGES_INPUT] as Array<{ slug: string }>).map((page) => page.slug)
    expect(pages[0]).toBe('/')
    const state = job.siteImport as AiSiteImportState
    const wave = state.waves[0].slots.map((slot) => state.pages.find((page) => page.slot === slot)?.slug)
    expect(pages).toEqual(wave.slice(0, pages.length).map((slug) => (slug === '/' ? '/' : `/${slug}`)))
  })
})

describe('a wave’s close lands in the site’s preview (AGL-4084, on AGL-4086’s host.preview)', () => {
  const state = (): AiSiteImportState => ({
    domain: AGLYN_DOMAIN,
    siteName: SITE_NAME,
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: NOW.toISOString(),
    pageLimit: null,
    existingPages: 0,
    found: 3,
    stoppedBy: null,
    groups: [],
    pages: [
      { slot: 'p0', url: `${AGLYN_ORIGIN}/`, path: '/', title: 'Home', group: 'main', wave: 0, draftId: 'd-home', slug: '/', words: 100, images: 0 },
      { slot: 'p1', url: `${AGLYN_ORIGIN}/contact`, path: '/contact', title: 'Contact', group: 'main', wave: 0, draftId: 'd-contact', slug: 'contact', words: 100, images: 0 },
      { slot: 'p2', url: `${AGLYN_ORIGIN}/legal/privacy`, path: '/legal/privacy', title: 'Privacy', group: 'c:legal', wave: 1, draftId: 'd-privacy', slug: 'privacy', words: 6000, images: 0 },
    ],
    waves: [
      { index: 0, label: 'Main pages', group: 'main', slots: ['p0', 'p1'], frame: true, status: 'running', startedAt: NOW.toISOString(), finishedAt: null },
      { index: 1, label: 'Legal', group: 'c:legal', slots: ['p2'], frame: false, status: 'waiting', startedAt: null, finishedAt: null },
    ],
    leftOut: [],
    leftOutCount: {},
    frame: { draftId: 'd-frame' },
    reviewId: 'row',
    look: { at: NOW.toISOString(), theme: 'applied', colors: [], logo: null, seo: false, seed: 1 },
  })
  const ledger = (): AiJobItemLedger[] =>
    ['frame', 'p0', 'p1', 'p2'].map((slot) => ({
      slot,
      op: slot === 'frame' ? 'layout' : 'page',
      label: slot,
      status: slot === 'p2' ? 'pending' : 'succeeded',
      attempt: 1,
      creditsSpent: 1,
      creditsRefunded: 0,
      outputs: [slot === 'frame' ? 'd-frame' : `d-${slot === 'p0' ? 'home' : 'contact'}`],
    }))
  const outputs: AiJobOutput[] = [
    { resource: 'layout', id: 'd-frame', label: 'Header and footer' } as AiJobOutput,
    { resource: 'screen', id: 'd-home', label: 'Home' } as AiJobOutput,
    { resource: 'screen', id: 'd-contact', label: 'Contact' } as AiJobOutput,
  ]

  it('publishes the wave’s pages into a site in preview, Home among them, and sends no site_published', async () => {
    const calls: Array<{ input: Record<string, unknown>; deps: Record<string, unknown> }> = []
    const result = await aiPublishImportedWave(
      {} as never,
      { job: { $id: 'importJobAglyn', orgId: 'org-test', hostId: 'host-import' }, state: state(), wave: state().waves[0], items: ledger(), outputs, now: NOW },
      {
        inPreview: async () => true,
        publish: (async (_firestore: unknown, input: Record<string, unknown>, deps: Record<string, unknown>) => {
          calls.push({ input, deps })
          return { liveUrl: 'https://import-check.aglyn.app/', published: [{ id: 'd-home', label: 'Home', path: '/' }], drafts: [] }
        }) as never,
      },
    )
    expect(result?.published.map((page) => page.path)).toEqual(['/'])
    expect((calls[0].input['outputs'] as AiJobOutput[]).map((output) => output.id)).toEqual(['d-home', 'd-contact'])
    // The pages still to come are no link's destination yet.
    expect(calls[0].input['unbuiltScreenIds']).toEqual(['d-privacy'])
    // The first wave takes the home address; nothing announces the site.
    expect(calls[0].input['retry']).toBeUndefined()
    expect(await (calls[0].deps['sendSitePublished'] as () => Promise<unknown>)()).toBeUndefined()
  })

  it('keeps every page a draft on a site that is not in preview', async () => {
    let published = false
    const result = await aiPublishImportedWave(
      {} as never,
      { job: { $id: 'importJobAglyn', orgId: 'org-test', hostId: 'host-import' }, state: state(), wave: state().waves[0], items: ledger(), outputs, now: NOW },
      {
        inPreview: async () => false,
        publish: (async () => {
          published = true
          return { liveUrl: null, published: [], drafts: [] }
        }) as never,
      },
    )
    expect(result).toBeNull()
    expect(published).toBe(false)
  })

  it('a wave’s last page closes it: the publish is called, the job waits for the next wave', async () => {
    const h = harness()
    const before = state()
    const items = ledger().map((row) => (row.slot === 'p1' ? { ...row, status: 'running' as const, outputs: [] } : row))
    const pages = before.pages.map((page) => (page.slot === 'p1' ? { ...page, read: { at: '', title: 'Contact', text: '', sections: [], images: [] }, photos: { brought: 0, reused: 0, skipped: 0, assets: [] } } : page))
    const { outcome } = await pass(createAiJobImportStep(h.deps), importJob({ siteImport: { ...before, pages }, items, outputs }))
    expect(h.published).toHaveLength(1)
    expect(outcome.sitePublish?.liveUrl).toBe('https://import-check.aglyn.app/')
    expect(outcome.review?.reason).toBe('wave')
    expect(outcome.review?.message).toBe('Main pages is in your site’s preview: 1 page is on your site, where only you and your team can see it. Start Legal when you are ready.')
    expect(outcome.siteImport?.pages.find((page) => page.slot === 'p1')?.brought).toEqual({ words: 120 })
  })

  it('Start every remaining wave: no review between waves, and the waves it starts are the one start the day counts', async () => {
    const h = harness()
    const before = { ...state(), autoContinue: true, autoContinueFrom: 0 }
    const items = ledger().map((row) => (row.slot === 'p1' ? { ...row, status: 'running' as const, outputs: [] } : row))
    const pages = before.pages.map((page) => (page.slot === 'p1' ? { ...page, read: { at: '', title: 'Contact', text: '', sections: [], images: [] }, photos: { brought: 0, reused: 0, skipped: 0, assets: [] } } : page))
    const step = createAiJobImportStep(h.deps)
    const closed = await pass(step, importJob({ siteImport: { ...before, pages }, items, outputs }))
    expect(closed.outcome.review).toBeUndefined()
    expect(closed.outcome.continue).toBe(true)
    expect(closed.job.siteImport?.waves[0].status).toBe('done')
    serveAglyn()
    const started = await pass(step, closed.job)
    expect(started.job.siteImport?.waves[1].status).toBe('running')
    expect(h.rateLimited).toBe(0)
  })
})

describe('the resume door’s Start every remaining wave', () => {
  it('turns it on from the wave waiting next, only for an import waiting for a wave', () => {
    const siteImport = {
      waves: [
        { index: 0, status: 'review' },
        { index: 1, status: 'waiting' },
        { index: 2, status: 'waiting' },
      ],
    } as unknown as AiSiteImportState
    const waiting = { kind: 'import', status: 'needs_review', review: { reason: 'wave', message: '', findings: [] }, siteImport } as const
    expect(aiSiteImportStartAllUpdate(waiting as never)).toEqual({ 'siteImport.autoContinue': true, 'siteImport.autoContinueFrom': 1 })
    expect(aiSiteImportStartAllUpdate({ ...waiting, review: { reason: 'ownership', message: '', findings: [] } } as never)).toBeNull()
    expect(aiSiteImportStartAllUpdate({ ...waiting, kind: 'site' } as never)).toBeNull()
  })
})

describe('the site’s own words: its listing, and its name', () => {
  it('replaces the listing the site was created with, and keeps one the owner wrote', () => {
    const home = { title: 'Build a Website | Aglyn', description: 'Describe your website and Aglyn AI builds the first draft.' }
    expect(aiSiteImportListingUpdates(defaultSiteSeo(SITE_NAME), SITE_NAME, home)).toEqual({ 'seo.title': home.title, 'seo.description': home.description })
    expect(aiSiteImportListingUpdates({ title: 'Our own title', description: 'Our own words.' }, SITE_NAME, home)).toEqual({})
  })

  it('takes the source’s own name only where it is the name the person gave but for case and punctuation', () => {
    expect(aiSiteImportBrandName('aglyn', 'Aglyn')).toBe('Aglyn')
    expect(aiSiteImportBrandName(SITE_NAME, 'Aglyn')).toBe(SITE_NAME)
  })

  it('brings a logo in once: a second page’s header finds it in the library', async () => {
    serveAglyn()
    const lib = library()
    let drawn = 0
    const rasterize = async () => {
      drawn += 1
      return new Uint8Array(2_048).fill(1)
    }
    const logo = { url: `${LOGO_PREFIX}org:FixtureOrg:FixtureHst/hWwBgGtkiM?v=1`, alt: 'Aglyn', type: null }
    const first = await aiSiteImportLogo({ hostId: 'host-import', uid: 'uid-owner', domain: AGLYN_DOMAIN, logo, alt: 'Aglyn' }, { ingest: lib, rasterize })
    const again = await aiSiteImportLogo({ hostId: 'host-import', uid: 'uid-owner', domain: AGLYN_DOMAIN, logo, alt: 'Aglyn' }, { ingest: lib, rasterize })
    expect(first?.src).toBe(again?.src)
    expect(drawn).toBe(1)
    expect(lib.stored).toEqual([expect.objectContaining({ contentType: 'image/png' })])
    expect(asked.filter((url) => url.startsWith(LOGO_PREFIX))).toHaveLength(1)
    expect(AI_LAYOUT_SITE_BRAND_INPUT).toBe('siteBrand')
  })
})
