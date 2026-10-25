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
  type AiSiteImportInventoryInput,
  type AiSiteImportListedPage,
} from './ai-site-import'

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
