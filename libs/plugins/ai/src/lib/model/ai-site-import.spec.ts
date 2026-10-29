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
 * Bring my site's plan of record (AGL-3976): how a crawled site is grouped,
 * kept under the plan's page count, cut into waves and priced, and how each
 * pass moves the import on. Pure, so every rule is pinned here once.
 */

import { AI_MEASURED_IMPORT_CREDITS, AI_MEASURED_PAID_SITE_CREDITS } from './ai-credit-estimate'
import type { AiJobItemLedger } from './ai-jobs.types'
import {
  AI_SITE_IMPORT_FRAME_SLOT,
  AI_SITE_IMPORT_LEFT_OUT_COPY,
  AI_SITE_IMPORT_LEFT_OUT_REASONS,
  AI_SITE_IMPORT_PAGE_CEILING_CREDITS,
  AI_SITE_IMPORT_WAVE_PAGES,
  aiSiteImportCreditRange,
  aiSiteImportGroups,
  aiSiteImportInventory,
  aiSiteImportLedger,
  aiSiteImportNextWave,
  aiSiteImportNextWork,
  aiSiteImportPhotosIn,
  aiSiteImportReviewWave,
  aiSiteImportSlug,
  aiSiteImportWaveClosed,
  aiSiteImportWaveCreditRange,
  aiSiteImportWaveMessage,
  aiSiteImportWaveStarted,
  aiSiteImportWire,
  AI_SITE_IMPORT_PROSE_WORDS,
  aiSiteImportPageBuild,
  aiSiteImportPagesRead,
  aiSiteImportPageSettled,
  aiSiteImportReadVerdict,
  aiSiteImportReadVerdictMessage,
  aiSiteImportReadVerdictReason,
  aiSiteImportRemainingCreditRange,
  AI_SITE_IMPORT_READ_MAX_CHARS,
  AI_SITE_IMPORT_WAVE_READ_MAX_CHARS,
  type AiSiteImportInventoryInput,
  type AiSiteImportListedPage,
  type AiSiteImportPageRead,
  type AiSiteImportReadInput,
  type AiSiteImportState,
} from './ai-site-import'
import { aglynSitemapUrls } from '../site-import/fixtures/aglyn-com-recordings'

const listed = (path: string, patch: Partial<AiSiteImportListedPage> = {}): AiSiteImportListedPage => ({
  url: `https://harbor-dental.com${path}`,
  path,
  title: path === '/' ? 'Home' : path.split('/').pop() ?? path,
  foundBy: path === '/' ? 'home' : 'sitemap',
  words: 120,
  images: 1,
  ...patch,
})

const MAIN = ['/', '/about', '/services', '/team', '/contact', '/blog']
const POSTS = Array.from({ length: 14 }, (_, index) => `/blog/post-${index + 1}`)
const MENU = ['/', '/about', '/services', '/team', '/blog', '/contact']

function inventory(patch: Partial<AiSiteImportInventoryInput> = {}) {
  let id = 0
  return aiSiteImportInventory({
    domain: 'harbor-dental.com',
    siteName: 'Harbor Dental',
    ownership: { method: 'dns', provenAt: 1, detail: '_aglyn-challenge.harbor-dental.com' },
    readAt: '2026-10-19T12:00:00.000Z',
    // The blog first, as the sitemap lists it.
    pages: [...POSTS.map((path) => listed(path)), ...MAIN.map((path) => listed(path))],
    menu: MENU,
    skipped: [{ url: 'https://harbor-dental.com/members/login', reason: 'login-form' }],
    stoppedBy: null,
    pageLimit: null,
    existingPages: 0,
    mintId: () => `draft${String(++id).padStart(3, '0')}`,
    ...patch,
  })
}

const ledgerOf = (rows: Array<[string, AiJobItemLedger['status']]>): AiJobItemLedger[] =>
  rows.map(([slot, status]) => ({ slot, op: slot === 'frame' ? 'layout' : 'page', label: slot, status, attempt: 1, creditsSpent: 0, creditsRefunded: 0, outputs: [] }))

describe('grouping: the main pages, then each collection', () => {
  it('keeps home, the menu and every top-level page as main pages, and a prefix of three or more as a collection', () => {
    const { groups } = aiSiteImportGroups([...MAIN, ...POSTS, '/legal/privacy'].map((path) => listed(path)), MENU)
    expect(groups.map((group) => [group.id, group.label, group.pages])).toEqual([
      // A prefix with fewer than three pages is not a collection: /legal/privacy is a main page.
      ['main', 'Main pages', 7],
      ['c:blog', 'Blog', 14],
    ])
  })

  it('calls a dated archive "Posts", and orders collections by the menu, then by size', () => {
    const pages = [
      listed('/'),
      ...['/2024/05/a', '/2024/06/b', '/2025/01/c'].map((path) => listed(path)),
      ...['/recipes/a', '/recipes/b', '/recipes/c', '/recipes/d'].map((path) => listed(path)),
      ...['/news/a', '/news/b', '/news/c'].map((path) => listed(path)),
    ]
    const { groups } = aiSiteImportGroups(pages, ['/', '/news'])
    expect(groups.map((group) => group.label)).toEqual(['Main pages', 'News', 'Recipes', 'Posts'])
  })
})

describe('never past the plan: kept in order until the room is used, the rest left out with the reason', () => {
  it('brings in the main pages before a collection, and leaves the collection’s tail out at the plan’s count', () => {
    const state = inventory({ pageLimit: 12, existingPages: 2 })
    // Room: 12 - 2 = 10 — the six main pages and the first four posts.
    expect(state.pages.map((page) => page.path)).toEqual([...['/', '/about', '/services', '/team', '/blog', '/contact'], ...POSTS.slice(0, 4)])
    expect(state.leftOutCount).toEqual({ 'login-form': 1, 'plan-limit': 10 })
    expect(state.leftOut.filter((entry) => entry.reason === 'plan-limit').map((entry) => entry.path)).toEqual(POSTS.slice(4))
    expect(state.pageLimit).toBe(12)
    expect(state.existingPages).toBe(2)
  })

  it('brings nothing in when the plan has no room, and says so for every page', () => {
    const state = inventory({ pageLimit: 5, existingPages: 5 })
    expect(state.pages).toEqual([])
    expect(state.waves).toEqual([])
    expect(state.frame).toBeNull()
    expect(state.leftOutCount['plan-limit']).toBe(20)
    expect(aiSiteImportWaveMessage(state, [])).toBe('Your site is read, and nothing on it can be brought in.')
  })

  it('leaves out a page with nothing on it', () => {
    const state = inventory({ pages: [listed('/'), listed('/empty', { words: 2, images: 0 })] })
    expect(state.pages.map((page) => page.path)).toEqual(['/'])
    expect(state.leftOut).toContainEqual(expect.objectContaining({ path: '/empty', reason: 'empty' }))
  })

  it('counts a page bot protection turned away as blocked, apart from one that could not be read, and says how to let AglynBot in', () => {
    const state = inventory({
      skipped: [
        { url: 'https://harbor-dental.com/booking', reason: 'blocked' },
        { url: 'https://harbor-dental.com/old-page', reason: 'unreadable' },
      ],
    })
    expect(state.leftOutCount).toEqual({ blocked: 1, unreadable: 1 })
    expect(state.leftOut).toContainEqual(expect.objectContaining({ path: '/booking', reason: 'blocked' }))
    expect(AI_SITE_IMPORT_LEFT_OUT_REASONS).toContain('blocked')
    expect(AI_SITE_IMPORT_LEFT_OUT_COPY.blocked).toBe(
      'The site’s bot protection or firewall turned AglynBot away. Allow AglynBot in your site’s bot or firewall settings, then bring the site in again.',
    )
  })
})

describe('waves', () => {
  it('cuts the main pages into the first wave with the header and footer, and each collection into its own', () => {
    const state = inventory()
    expect(state.waves.map((wave) => [wave.label, wave.slots.length, wave.frame])).toEqual([
      ['Main pages', 6, true],
      ['Blog, 1 of 2', AI_SITE_IMPORT_WAVE_PAGES, false],
      ['Blog, 2 of 2', 4, false],
    ])
    expect(state.waves.every((wave) => wave.status === 'waiting')).toBe(true)
    // Home first, then the menu's order.
    expect(state.waves[0].slots.map((slot) => state.pages.find((page) => page.slot === slot)?.path)).toEqual(MENU)
    expect(state.frame).toEqual({ draftId: expect.any(String) })
    // Every page's draft is named before anything is written, each once.
    expect(new Set(state.pages.map((page) => page.draftId)).size).toBe(state.pages.length)
  })

  it('starts a ledger of the header and footer and every page, all pending', () => {
    const state = inventory()
    const ledger = aiSiteImportLedger(state)
    expect(ledger[0]).toMatchObject({ slot: AI_SITE_IMPORT_FRAME_SLOT, op: 'layout', status: 'pending' })
    expect(ledger.slice(1).every((row) => row.op === 'page' && row.status === 'pending')).toBe(true)
    expect(ledger).toHaveLength(state.pages.length + 1)
  })

  it('gives every page one address of its own on the new site', () => {
    const taken = new Set<string>()
    expect(['/', '/about', '/blog/about', '/news/about', '/services.html', '/'].map((path) => aiSiteImportSlug(path, taken))).toEqual([
      '/',
      'about',
      'blog-about',
      'news-about',
      'services',
      'page',
    ])
  })
})

describe('what runs next, and the review between waves', () => {
  it('reads first, then waits: nothing runs until a person starts a wave', () => {
    expect(aiSiteImportNextWork(null, [])).toEqual({ kind: 'inventory' })
    const state = inventory()
    const ledger = aiSiteImportLedger(state)
    // Read, and no wave running: the next work is to start the first wave, which only a resume reaches.
    expect(aiSiteImportNextWork(state, ledger)).toMatchObject({ kind: 'start-wave', wave: { index: 0 } })
    expect(aiSiteImportWaveMessage(state, ledger)).toBe(
      'Your site is read: 20 pages to bring in, in 3 waves. Start the first wave when you are ready.',
    )
  })

  it('builds the header and footer first, then each page’s photos and then the page, then closes the wave for review', () => {
    let state = inventory()
    const first = state.pages[0]
    const reads = new Map(state.waves[0].slots.map((slot) => [slot, { at: 'x', title: 'T', text: 'words', sections: ['Hero'], images: [] }]))
    state = aiSiteImportWaveStarted(state, 0, '2026-10-19T12:05:00.000Z', reads)
    let ledger = aiSiteImportLedger(state)
    expect(aiSiteImportNextWork(state, ledger)).toMatchObject({ kind: 'frame' })
    ledger = ledger.map((row) => (row.slot === 'frame' ? { ...row, status: 'succeeded' } : row))
    expect(aiSiteImportNextWork(state, ledger)).toMatchObject({ kind: 'images', page: { slot: first.slot } })
    state = aiSiteImportPhotosIn(state, first.slot, { brought: 0, reused: 0, skipped: 0, assets: [] })
    expect(aiSiteImportNextWork(state, ledger)).toMatchObject({ kind: 'page', page: { slot: first.slot } })
    ledger = ledger.map((row) => (state.waves[0].slots.includes(row.slot) ? { ...row, status: 'succeeded' } : row))
    expect(aiSiteImportNextWork(state, ledger)).toMatchObject({ kind: 'close-wave', wave: { index: 0 } })
    state = aiSiteImportWaveClosed(state, 0, '2026-10-19T12:30:00.000Z')
    expect(aiSiteImportReviewWave(state)?.index).toBe(0)
    // Waiting for the person: the next wave is offered, not run.
    expect(aiSiteImportNextWave(state)?.index).toBe(1)
    expect(aiSiteImportWaveMessage(state, ledger)).toBe('Main pages is in: 6 pages ready to review as drafts. Start Blog, 1 of 2 when you are ready.')
    // What the wave read is no longer kept once it is in.
    expect(state.pages.filter((page) => page.wave === 0).every((page) => page.read?.text === '')).toBe(true)
    // Starting the next wave ends the review of this one.
    state = aiSiteImportWaveStarted(state, 1, '2026-10-20T09:00:00.000Z', new Map())
    expect(state.waves.map((wave) => wave.status)).toEqual(['done', 'running', 'waiting'])
  })

  it('ends with the last wave: no review is asked after it', () => {
    let state = inventory({ pages: [listed('/'), listed('/about')] })
    state = aiSiteImportWaveStarted(state, 0, 'a', new Map())
    state = aiSiteImportWaveClosed(state, 0, 'b')
    expect(state.waves[0].status).toBe('done')
    expect(aiSiteImportNextWork(state, ledgerOf([['frame', 'succeeded'], ['p0', 'succeeded'], ['p1', 'succeeded']]))).toEqual({ kind: 'done' })
  })

  it('never sends a wave’s page text to the console', () => {
    let state = inventory({ pages: [listed('/')] })
    state = aiSiteImportWaveStarted(state, 0, 'a', new Map([['p0', { at: 'a', title: 'Home', text: 'The page text.', sections: ['Hero'], images: [{ url: 'https://x/y.jpg', alt: '' }] }]]))
    const wire = aiSiteImportWire(state)
    expect(wire?.pages[0].read).toMatchObject({ text: '', images: [] })
    // The stored state keeps it for the model answer.
    expect(state.pages[0].read?.text).toBe('The page text.')
  })
})

describe('credits: about 27 a page, quoted before a wave starts', () => {
  it('prices a page as an AI page and the header and footer as a layout, as the paid table measured them', () => {
    expect(AI_MEASURED_IMPORT_CREDITS.page).toEqual(AI_MEASURED_PAID_SITE_CREDITS.page)
    expect(AI_MEASURED_IMPORT_CREDITS.page.median).toBe(27)
    expect(aiSiteImportCreditRange(10)).toEqual({ likely: 270, p90: 470, ceiling: 10 * AI_SITE_IMPORT_PAGE_CEILING_CREDITS })
    expect(aiSiteImportCreditRange(6, { frame: true })).toEqual({ likely: 6 * 27 + 29, p90: 6 * 47 + 29, ceiling: 650 })
    expect(aiSiteImportCreditRange(0)).toEqual({ likely: 0, p90: 0, ceiling: 0 })
  })

  it('quotes a wave by what it still owes: no refused page, and the header only while it is owed', () => {
    let state = inventory()
    state = aiSiteImportWaveStarted(state, 0, 'a', new Map([['p5', 'robots' as const]]))
    const ledger = aiSiteImportLedger(state).map((row) =>
      row.slot === 'frame' || row.slot === 'p0' ? { ...row, status: 'succeeded' as const } : row,
    )
    // Six main pages, one refused and one in: four left, and the header is built.
    expect(aiSiteImportWaveCreditRange(state, state.waves[0], ledger)).toEqual(aiSiteImportCreditRange(4))
    expect(aiSiteImportWaveCreditRange(state, state.waves[1])).toEqual(aiSiteImportCreditRange(10))
  })
})

/*------------------------------------------
 * Home first (AGL-4083)
 *-----------------------------------------*/

/** A crawl as `aiSiteImportReadVerdict` reads one. */
function crawl(patch: Partial<AiSiteImportReadInput> = {}): AiSiteImportReadInput {
  const words = (count: number) => [{ kind: 'paragraph', text: Array.from({ length: count }, () => 'word').join(' ') }]
  return {
    pages: [
      { path: '/', foundBy: 'home', blocks: words(200), images: [] },
      { path: '/about', foundBy: 'sitemap', blocks: words(200), images: [] },
    ],
    skipped: [],
    sitemapUrls: 2,
    ...patch,
  }
}

describe('the read verdict: nothing is planned or charged until Home is in', () => {
  it('is home-blocked when Home answered 401, 403 or 429, and names the edge that answered', () => {
    for (const status of [401, 403, 429]) {
      const verdict = aiSiteImportReadVerdict(
        crawl({
          pages: [{ path: '/contact', foundBy: 'sitemap', blocks: [{ kind: 'paragraph', text: 'Talk to us any day of the week' }], images: [] }],
          skipped: [
            { url: 'https://example.com/', reason: 'http-error', status, edge: 'vercel' },
            { url: 'https://example.com/about', reason: 'http-error', status },
          ],
          sitemapUrls: 3,
        }),
      )
      expect(verdict).toEqual({ kind: 'home-blocked', blocked: 2, total: 3, homeStatus: status, homeProblem: 'blocked', edge: 'vercel' })
      expect(aiSiteImportReadVerdictReason(verdict)).toBe('blocked')
    }
  })

  it('is home-unreadable when Home answered anything else, or read as an empty shell', () => {
    const skippedHome = (reason: string, status?: number) =>
      aiSiteImportReadVerdict(crawl({ pages: [crawl().pages[1]], skipped: [{ url: 'https://example.com/', reason, ...(status ? { status } : {}) }] }))
    expect(skippedHome('http-error', 500)).toMatchObject({ kind: 'home-unreadable', homeStatus: 500, homeProblem: 'http-error' })
    expect(skippedHome('unreachable')).toMatchObject({ kind: 'home-unreadable', homeProblem: 'unreachable' })
    expect(skippedHome('robots')).toMatchObject({ kind: 'home-unreadable', homeProblem: 'robots' })
    expect(skippedHome('not-reached')).toMatchObject({ kind: 'home-unreadable', homeProblem: 'not-reached' })
    const shell = aiSiteImportReadVerdict(crawl({ pages: [{ path: '/', foundBy: 'home', blocks: [{ kind: 'paragraph', text: 'Loading' }], images: [] }] }))
    expect(shell).toMatchObject({ kind: 'home-unreadable', homeProblem: 'empty' })
    expect(aiSiteImportReadVerdictReason(shell)).toBe('unreadable')
    // A home page that is all pictures is a page.
    expect(aiSiteImportReadVerdict(crawl({ pages: [{ path: '/', foundBy: 'home', blocks: [], images: [{}] }] })).kind).toBe('ok')
  })

  it('is mostly-blocked when Home came in but more than half the site was turned away, and ok otherwise', () => {
    const turnedAway = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ url: `https://example.com/p${index}`, reason: 'http-error', status: 403 }))
    expect(aiSiteImportReadVerdict(crawl({ skipped: turnedAway(3), sitemapUrls: 5 }))).toMatchObject({ kind: 'mostly-blocked', blocked: 3, total: 5 })
    expect(aiSiteImportReadVerdict(crawl({ skipped: turnedAway(2), sitemapUrls: 4 })).kind).toBe('ok')
    expect(aiSiteImportReadVerdictReason(aiSiteImportReadVerdict(crawl({ skipped: turnedAway(3), sitemapUrls: 5 })))).toBeNull()
  })

  it('says what happened and what to do, in console words', () => {
    const blocked = { kind: 'home-blocked' as const, blocked: 111, total: 121, homeStatus: 429, homeProblem: 'blocked' as const, edge: 'vercel' as const }
    expect(aiSiteImportReadVerdictMessage(blocked, 'aglyn.com')).toBe(
      'Your site’s bot protection or firewall turned AglynBot away before it could read your home page, and 110 other pages. Nothing was brought in and no AI credits were used. Allow AglynBot in your site’s bot or firewall settings, then choose Check again. Your site answers through Vercel: in its Firewall, under Rules, add a bypass rule for the user agent AglynBot.',
    )
    expect(aiSiteImportReadVerdictMessage({ ...blocked, edge: 'cloudflare', blocked: 1 }, 'aglyn.com')).toBe(
      'Your site’s bot protection or firewall turned AglynBot away before it could read your home page. Nothing was brought in and no AI credits were used. Allow AglynBot in your site’s bot or firewall settings, then choose Check again. Your site answers through Cloudflare: under Security, WAF, add a custom rule that skips the checks when the user agent contains AglynBot.',
    )
    expect(
      aiSiteImportReadVerdictMessage({ kind: 'home-unreadable', blocked: 0, total: 4, homeStatus: 500, homeProblem: 'http-error', edge: null }, 'example.com'),
    ).toBe(
      'Your home page could not be read (it answered with an error, 500). Nothing was brought in and no AI credits were used. Check that example.com is up and answers at https://example.com/, then choose Check again.',
    )
    expect(aiSiteImportReadVerdictMessage({ kind: 'mostly-blocked', blocked: 70, total: 121, homeStatus: null, homeProblem: null, edge: null }, 'aglyn.com')).toBe(
      '70 of 121 pages were turned away by your site’s bot protection; see Not brought in.',
    )
    expect(aiSiteImportReadVerdictMessage({ kind: 'ok', blocked: 0, total: 4, homeStatus: null, homeProblem: null, edge: null }, 'aglyn.com')).toBeNull()
  })
})

describe('the 10/20 import of aglyn.com, replayed', () => {
  // What job QE-n3OFOBa read on 10/20: Contact and the nine legal pages, the
  // only paths the edge let a crawler through; every other address of the
  // sitemaps it read (all but the authors' sitemap, past the old cap) 429.
  const READ: Array<[string, number]> = [
    ['/contact', 169],
    ['/legal/acceptable-use', 1559],
    ['/legal/cookies', 3467],
    ['/legal/dmca', 1063],
    ['/legal/dpa', 2323],
    ['/legal/eula', 949],
    ['/legal/marketplace-publisher-agreement', 2242],
    ['/legal/privacy', 4762],
    ['/legal/subprocessors', 2948],
    ['/legal/terms', 10266],
  ]
  const sitemap = aglynSitemapUrls().filter((url) => !url.includes('/author/'))
  const read = new Set(READ.map(([path]) => `https://aglyn.com${path}`))

  function tenTwenty() {
    let id = 0
    return aiSiteImportInventory({
      domain: 'aglyn.com',
      siteName: 'Aglyn Import Check',
      ownership: { method: 'dns', provenAt: 1, detail: null },
      readAt: '2026-10-20T01:37:10.047Z',
      pages: READ.map(([path, words]) => ({ url: `https://aglyn.com${path}`, path, title: path, foundBy: 'sitemap' as const, words, images: 3 })),
      menu: [],
      skipped: sitemap.filter((url) => !read.has(url)).map((url) => ({ url, reason: 'blocked' as const })),
      stoppedBy: null,
      pageLimit: null,
      existingPages: 0,
      mintId: () => `d${++id}`,
    })
  }

  it('plans no wave, starts no ledger and quotes nothing: Home was turned away', () => {
    expect(sitemap).toHaveLength(121)
    const state = tenTwenty()
    expect(state.verdict).toMatchObject({ kind: 'home-blocked', blocked: 111, total: 121 })
    expect(state.waves).toEqual([])
    expect(state.pages).toEqual([])
    expect(state.frame).toBeNull()
    expect(aiSiteImportLedger(state)).toEqual([])
    expect(aiSiteImportNextWave(state)).toBeNull()
    expect(aiSiteImportWaveMessage(state, [])).toContain('turned AglynBot away before it could read your home page, and 110 other pages')
    expect(aiSiteImportWaveMessage(state, [])).toContain('no AI credits were used')
  })

  it('reads the site again on the next pass, the person’s Check again', () => {
    expect(aiSiteImportNextWork(tenTwenty(), [])).toEqual({ kind: 'inventory' })
  })

  it('takes the step’s own verdict over its own reading when it is given one', () => {
    let id = 0
    const state = aiSiteImportInventory({
      domain: 'aglyn.com',
      siteName: 'Aglyn',
      ownership: { method: 'dns', provenAt: 1, detail: null },
      readAt: 'x',
      pages: [listed('/', { url: 'https://aglyn.com/' })],
      menu: [],
      skipped: [],
      stoppedBy: null,
      pageLimit: null,
      existingPages: 0,
      mintId: () => `d${++id}`,
      verdict: { kind: 'mostly-blocked', blocked: 70, total: 121, homeStatus: null, homeProblem: null, edge: null },
    })
    expect(state.verdict?.kind).toBe('mostly-blocked')
    expect(state.waves).toHaveLength(1)
  })
})

describe('a read stopped short: what it did not reach is said, so the count adds up', () => {
  it('lists the pages the read never reached apart from the plan’s limit', () => {
    const state = inventory({
      skipped: [
        { url: 'https://harbor-dental.com/blog/post-15', reason: 'not-reached' },
        { url: 'https://harbor-dental.com/blog/post-16', reason: 'not-reached' },
      ],
      stoppedBy: 'time',
    })
    expect(state.leftOutCount).toEqual({ 'not-reached': 2 })
    expect(AI_SITE_IMPORT_LEFT_OUT_REASONS).toContain('not-reached')
    expect(AI_SITE_IMPORT_LEFT_OUT_COPY['not-reached']).toBe('Not reached: the read stopped before it got to this page.')
    expect(AI_SITE_IMPORT_LEFT_OUT_COPY.empty).toBe(
      'No text could be read from this page. If your site is built in a way that needs a browser to show its words, it cannot be brought in yet.',
    )
  })
})

describe('the wave read keeps every block, inside the job document’s room', () => {
  const blocks = (chars: number) => [{ kind: 'paragraph' as const, text: 'x'.repeat(chars), region: 'main' as const }]
  const pageRead = (chars: number): AiSiteImportPageRead => ({ at: 'x', title: 't', text: '', sections: ['t'], images: [], blocks: blocks(chars), words: 1 })

  it('keeps a long page whole up to a wave’s budget, and says when it had to cut', () => {
    let state = inventory()
    const slots = state.waves[1].slots
    const each = AI_SITE_IMPORT_READ_MAX_CHARS
    state = aiSiteImportPagesRead(state, new Map(slots.slice(0, 4).map((slot) => [slot, pageRead(each)])))
    const kept = slots.slice(0, 4).map((slot) => state.pages.find((page) => page.slot === slot)?.read)
    const chars = kept.map((read) => (read?.blocks ?? []).reduce((total, block) => total + (block.kind === 'image' ? 0 : block.text.length), 0))
    expect(chars.slice(0, 3)).toEqual([each, each, each])
    expect(chars.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(AI_SITE_IMPORT_WAVE_READ_MAX_CHARS)
    expect(kept[3]?.cut).toBe(true)
    expect(kept[0]?.cut).toBeUndefined()
  })

  it('lets a page’s blocks go once it is in, and never sends them to the console', () => {
    let state = inventory()
    const slot = state.waves[0].slots[0]
    state = aiSiteImportPagesRead(state, new Map([[slot, pageRead(500)]]))
    expect(aiSiteImportWire(state)?.pages.find((page) => page.slot === slot)?.read?.blocks).toEqual([])
    expect(aiSiteImportPageSettled(state, slot).pages.find((page) => page.slot === slot)?.read?.blocks).toEqual([])
  })
})

describe('copied or arranged, and the quote that names both', () => {
  it('copies every page of a collection and any long page; arranges the main pages', () => {
    expect(AI_SITE_IMPORT_PROSE_WORDS).toBe(900)
    expect(aiSiteImportPageBuild({ group: 'c:blog', words: 120 })).toBe('copied')
    expect(aiSiteImportPageBuild({ group: 'main', words: 901 })).toBe('copied')
    expect(aiSiteImportPageBuild({ group: 'main', words: 900 })).toBe('arranged')
  })

  it('prices a copied page at its listing and an arranged page at its arrangement, once the step has chosen', () => {
    const { arranged, copied } = AI_MEASURED_IMPORT_CREDITS
    let state = inventory()
    state = { ...state, pages: state.pages.map((page) => ({ ...page, build: aiSiteImportPageBuild(page) })) }
    // Six main pages, arranged, with the header and footer.
    expect(aiSiteImportWaveCreditRange(state, state.waves[0])).toEqual(
      aiSiteImportCreditRange(0, { frame: true, arranged: 6 }),
    )
    expect(aiSiteImportCreditRange(0, { arranged: 7, copied: 3 })).toEqual({
      likely: 7 * arranged.median + 3 * copied.median,
      p90: 7 * arranged.p90 + 3 * copied.p90,
      ceiling: 7 * AI_SITE_IMPORT_PAGE_CEILING_CREDITS + 3 * (AI_SITE_IMPORT_PAGE_CEILING_CREDITS / 2),
    })
    // A page the step has not chosen for is priced as an AI page, as today.
    expect(aiSiteImportWaveCreditRange(inventory(), inventory().waves[0])).toEqual(aiSiteImportCreditRange(6, { frame: true }))
  })

  it('quotes every remaining wave at once for Start every remaining wave', () => {
    const state = inventory()
    const ledger = aiSiteImportLedger(state)
    expect(aiSiteImportRemainingCreditRange(state, ledger)).toEqual(aiSiteImportCreditRange(20, { frame: true }))
  })
})

describe('Start every remaining wave', () => {
  it('runs the next wave without a review stop, and ends on the last', () => {
    let state: AiSiteImportState = { ...inventory(), autoContinue: true }
    state = aiSiteImportWaveStarted(state, 0, 'a', new Map())
    state = aiSiteImportWaveClosed(state, 0, 'b')
    expect(state.waves[0].status).toBe('done')
    expect(aiSiteImportReviewWave(state)).toBeNull()
    expect(aiSiteImportNextWork(state, aiSiteImportLedger(state))).toMatchObject({ kind: 'start-wave', wave: { index: 1 } })
    // Off by default: the same close waits for the person.
    const reviewed = aiSiteImportWaveClosed(aiSiteImportWaveStarted(inventory(), 0, 'a', new Map()), 0, 'b')
    expect(reviewed.waves[0].status).toBe('review')
  })
})
