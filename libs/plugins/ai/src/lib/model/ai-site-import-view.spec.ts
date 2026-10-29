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
 * What the console shows of Bring my site (AGL-3976): the choice card's
 * state, and an import job's page in each of its states.
 */

import type { AiJobItemLedger, AiJobSummary } from './ai-jobs.types'
import {
  aiSiteImportInventory,
  aiSiteImportLedger,
  aiSiteImportPhotosIn,
  aiSiteImportWaveClosed,
  aiSiteImportWaveStarted,
  type AiSiteImportListedPage,
  type AiSiteImportState,
} from './ai-site-import'
import {
  AI_SITE_IMPORT_PLAN_COPY,
  AI_SITE_IMPORT_ROLE_COPY,
  aiSiteImportFoundText,
  aiSiteImportLeftOutLines,
  aiSiteImportOfferOf,
  aiSiteImportPhaseOf,
  aiSiteImportPhotosText,
  aiSiteImportPlanText,
  aiSiteImportStartAction,
  aiSiteImportWaveRows,
  aiSiteImportWaveSpent,
  aiSiteImportHeldCopy,
  aiSiteImportStartAllAction,
  aiSiteImportWaveQuote,
} from './ai-site-import-view'

const listed = (path: string): AiSiteImportListedPage => ({
  url: `https://harbor-dental.com${path}`,
  path,
  title: path === '/' ? 'Home' : (path.split('/').pop() as string),
  foundBy: path === '/' ? 'home' : 'sitemap',
  words: 100,
  images: 1,
})

function harbor(): AiSiteImportState {
  let id = 0
  return aiSiteImportInventory({
    domain: 'harbor-dental.com',
    siteName: 'Harbor Dental',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: 'x',
    pages: ['/', '/about', '/team', ...Array.from({ length: 12 }, (_, index) => `/blog/post-${index + 1}`)].map(listed),
    menu: ['/', '/about', '/team'],
    skipped: [{ url: 'https://harbor-dental.com/members/login', reason: 'login-form' }],
    stoppedBy: null,
    pageLimit: 10,
    existingPages: 0,
    mintId: () => `d${++id}`,
  })
}

function summary(patch: Partial<AiJobSummary>): AiJobSummary {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'import',
    status: 'queued',
    brief: 'Bring in harbor-dental.com',
    batch: null,
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: 'x',
    updatedAt: 'x',
    error: null,
    running: false,
    plan: null,
    review: null,
    ...patch,
  }
}

const settled = (ledger: AiJobItemLedger[], slots: string[], status: AiJobItemLedger['status'], patch: Partial<AiJobItemLedger> = {}) =>
  ledger.map((row) => (slots.includes(row.slot) ? { ...row, status, ...patch } : row))

describe('the choice card', () => {
  it('is absent while the flag is off, disabled with the reason on Free or for a member who cannot, and open otherwise', () => {
    expect(aiSiteImportOfferOf(undefined)).toEqual({ state: 'hidden' })
    expect(aiSiteImportOfferOf('plan')).toEqual({ state: 'blocked', reason: 'plan', message: AI_SITE_IMPORT_PLAN_COPY })
    expect(aiSiteImportOfferOf('role')).toEqual({ state: 'blocked', reason: 'role', message: AI_SITE_IMPORT_ROLE_COPY })
    expect(aiSiteImportOfferOf('ready')).toEqual({ state: 'ready', claims: [] })
  })
})

describe('an import job’s page', () => {
  it('reads, then is ready, then runs a wave, then reviews it, then is done', () => {
    expect(aiSiteImportPhaseOf(summary({ status: 'queued' }))).toBe('reading')
    let state = harbor()
    const review = { reason: 'wave' as const, message: 'm', findings: [] }
    expect(aiSiteImportPhaseOf(summary({ status: 'needs_review', review, siteImport: state }))).toBe('ready')
    expect(aiSiteImportPhaseOf(summary({ status: 'queued', siteImport: state }))).toBe('starting')
    state = aiSiteImportWaveStarted(state, 0, 'x', new Map())
    expect(aiSiteImportPhaseOf(summary({ status: 'running', siteImport: state }))).toBe('running')
    state = aiSiteImportWaveClosed(state, 0, 'y')
    expect(aiSiteImportPhaseOf(summary({ status: 'needs_review', review, siteImport: state }))).toBe('review')
    expect(aiSiteImportPhaseOf(summary({ status: 'done', siteImport: state }))).toBe('done')
  })

  it('is held for a new proof, the day’s limit or a site that could not be read, and paused by the meter', () => {
    const state = harbor()
    for (const reason of ['ownership', 'limit'] as const) {
      expect(aiSiteImportPhaseOf(summary({ status: 'needs_review', review: { reason, message: 'm', findings: [] }, siteImport: state }))).toBe('held')
    }
    // Robots.txt unreadable on the read: a wave review with nothing read yet.
    expect(aiSiteImportPhaseOf(summary({ status: 'needs_review', review: { reason: 'wave', message: 'm', findings: [] } }))).toBe('held')
    expect(aiSiteImportPhaseOf(summary({ status: 'needs_input', siteImport: state }))).toBe('paused')
    expect(aiSiteImportPhaseOf(summary({ status: 'canceled', siteImport: state }))).toBe('stopped')
  })

  it('says what was found and what the plan keeps, and lists what was left out by reason', () => {
    const state = harbor()
    expect(aiSiteImportFoundText(state)).toBe('Found 15 pages on harbor-dental.com: Main pages (3) and Blog (12).')
    expect(aiSiteImportPlanText(state)).toBe('Your plan includes 10 pages and this site has 0, so 10 pages are brought in, in 2 waves.')
    expect(aiSiteImportLeftOutLines(state).map((line) => [line.reason, line.count, line.paths.length])).toEqual([
      ['plan-limit', 5, 5],
      ['login-form', 1, 1],
    ])
  })

  it('shows each page of a wave: old and new address, its state, its photos, its draft, and what was left out', () => {
    let state = harbor()
    state = aiSiteImportWaveStarted(state, 0, 'x', new Map([['p2', 'robots' as const]]))
    state = aiSiteImportPhotosIn(state, 'p1', { brought: 2, reused: 1, skipped: 0, assets: [] })
    let ledger = aiSiteImportLedger(state)
    ledger = settled(ledger, ['frame'], 'succeeded', { outputs: ['layout-1'] })
    ledger = settled(ledger, ['p0'], 'succeeded', { outputs: ['draft-home'] })
    ledger = settled(ledger, ['p2'], 'skipped', { note: 'The site’s robots.txt asks AglynBot not to read it.' })
    const job = summary({ status: 'running', items: ledger, siteImport: state })
    const rows = aiSiteImportWaveRows(job, state.waves[0])
    expect(rows.map((row) => [row.title, row.from, row.to, row.state])).toEqual([
      ['Header and footer', 'Your menu on harbor-dental.com', 'Every page', 'done'],
      ['Home', '/', '/', 'done'],
      ['about', '/about', '/about', 'active'],
      ['team', '/team', '/team', 'skipped'],
    ])
    expect(rows[1].outputId).toBe('draft-home')
    expect(rows[2].photos).toBe('2 photos added, 1 already in your media library')
    expect(rows[3].note).toBe('The site’s robots.txt asks AglynBot not to read it.')
    expect(aiSiteImportPhotosText({ brought: 0, reused: 0 })).toBeNull()
  })

  it('offers the next wave with its quote, and counts what a wave used less what was given back', () => {
    let state = harbor()
    expect(aiSiteImportStartAction(summary({ siteImport: state, items: aiSiteImportLedger(state) }))).toMatchObject({
      label: 'Start Main pages',
      quote: 'About 110 credits (up to 350)',
    })
    state = aiSiteImportWaveClosed(aiSiteImportWaveStarted(state, 0, 'x', new Map()), 0, 'y')
    const ledger = settled(aiSiteImportLedger(state), ['frame', 'p0', 'p1', 'p2'], 'succeeded', { creditsSpent: 30, creditsRefunded: 0 }).map((row) =>
      row.slot === 'p2' ? { ...row, creditsRefunded: 30, status: 'failed' as const } : row,
    )
    const job = summary({ status: 'needs_review', items: ledger, siteImport: state })
    expect(aiSiteImportWaveSpent(job, state.waves[0])).toBe(90)
    expect(aiSiteImportStartAction(job)).toMatchObject({ label: 'Start Blog', quote: 'About 189 credits (up to 700)' })
  })
})

/*------------------------------------------
 * What the read found and what it did not (AGL-4083)
 *-----------------------------------------*/

describe('what the read says it found', () => {
  it('says how many pages more could not be read, and why the read stopped short', () => {
    let id = 0
    const state = aiSiteImportInventory({
      domain: 'harbor-dental.com',
      siteName: 'Harbor Dental',
      ownership: { method: 'dns', provenAt: 1, detail: null },
      readAt: 'x',
      pages: ['/', '/about', '/team'].map(listed),
      menu: [],
      skipped: [
        { url: 'https://harbor-dental.com/booking', reason: 'blocked' },
        { url: 'https://harbor-dental.com/blog/a', reason: 'not-reached' },
        { url: 'https://harbor-dental.com/blog/b', reason: 'not-reached' },
      ],
      stoppedBy: 'time',
      pageLimit: null,
      existingPages: 0,
      mintId: () => `d${++id}`,
    })
    expect(aiSiteImportFoundText(state)).toBe('Found 3 pages on harbor-dental.com: Main pages (3). 3 more could not be read; see Not brought in.')
    expect(aiSiteImportPlanText(state)).toBe(
      'Your plan has no page limit, so 3 pages are brought in, in one wave. Only the first 3 pages could be read in the time allowed; the rest are listed under Not brought in as not reached.',
    )
    expect(aiSiteImportLeftOutLines(state).map((line) => [line.reason, line.count])).toEqual([
      ['not-reached', 2],
      ['blocked', 1],
    ])
  })

  it('holds a site whose home page was turned away: the reason, the way through and Check again', () => {
    const review = { reason: 'blocked' as const, message: 'm', findings: [] }
    const job = summary({ status: 'needs_review', review })
    expect(aiSiteImportPhaseOf(job)).toBe('held')
    expect(aiSiteImportHeldCopy(job)).toEqual({ heading: 'AglynBot was turned away', action: 'Check again', message: 'm' })
    expect(aiSiteImportHeldCopy(summary({ status: 'needs_review', review: { ...review, reason: 'unreadable' as const } }))).toMatchObject({
      heading: 'Your home page could not be read',
      action: 'Check again',
    })
    // An inventory that found Home turned away holds the same way, with its own sentence.
    let id = 0
    const state = aiSiteImportInventory({
      domain: 'aglyn.com',
      siteName: 'Aglyn',
      ownership: { method: 'dns', provenAt: 1, detail: null },
      readAt: 'x',
      pages: [{ ...listed('/contact'), url: 'https://aglyn.com/contact' }],
      menu: [],
      skipped: [{ url: 'https://aglyn.com/', reason: 'blocked' }],
      stoppedBy: null,
      pageLimit: null,
      existingPages: 0,
      mintId: () => `d${++id}`,
    })
    const held = summary({ status: 'needs_review', review: { reason: 'wave', message: 'x', findings: [] }, siteImport: state })
    expect(aiSiteImportPhaseOf(held)).toBe('held')
    expect(aiSiteImportHeldCopy(held)).toMatchObject({ heading: 'AglynBot was turned away', action: 'Check again' })
    expect(aiSiteImportHeldCopy(held)?.message).toContain('before it could read your home page')
    // Any other hold keeps its own words.
    expect(aiSiteImportHeldCopy(summary({ status: 'needs_review', review: { reason: 'limit', message: 'l', findings: [] } }))).toBeNull()
  })
})

describe('each row says what came through', () => {
  it('names the old page, the photos brought against the photos tried, and the words once the page is in', () => {
    let state = harbor()
    state = aiSiteImportWaveStarted(state, 0, 'x', new Map())
    state = aiSiteImportPhotosIn(state, 'p1', { brought: 2, reused: 1, skipped: 2, assets: [] })
    state = {
      ...state,
      pages: state.pages.map((page) => (page.slot === 'p0' ? { ...page, build: 'arranged' as const, brought: { words: 96 } } : page.slot === 'p1' ? { ...page, build: 'copied' as const } : page)),
    }
    const rows = aiSiteImportWaveRows(summary({ status: 'running', items: aiSiteImportLedger(state), siteImport: state }), state.waves[0])
    expect(rows[0]).toMatchObject({ slot: 'frame', oldPage: 'https://harbor-dental.com/', words: null, build: null })
    expect(rows[1]).toMatchObject({ oldPage: 'https://harbor-dental.com/', words: '96 of 100 words', build: 'Arranged by Aglyn AI' })
    expect(rows[2]).toMatchObject({
      oldPage: 'https://harbor-dental.com/about',
      words: null,
      build: 'Copied as it is',
      photos: '3 of 5 photos: 2 added, 1 already in your media library, 2 could not be brought in',
    })
  })

  it('names the copied and arranged pages in a wave’s quote, once the step has chosen', () => {
    let state = harbor()
    state = { ...state, pages: state.pages.map((page, index) => ({ ...page, build: index === 0 ? ('copied' as const) : ('arranged' as const) })) }
    const job = summary({ siteImport: state, items: aiSiteImportLedger(state) })
    expect(aiSiteImportWaveQuote(job, state.waves[0])).toMatch(/^About \d+ credits \(up to \d+\): 2 pages arranged by Aglyn AI, 1 copied as it is$/)
    expect(aiSiteImportWaveQuote(summary({ siteImport: harbor(), items: aiSiteImportLedger(harbor()) }), harbor().waves[0])).toBe('About 110 credits (up to 350)')
  })

  it('offers every remaining wave at once, off by default, only when more than one waits', () => {
    const state = harbor()
    const job = summary({ siteImport: state, items: aiSiteImportLedger(state) })
    expect(aiSiteImportStartAllAction(job)).toEqual({ label: 'Start every remaining wave', quote: 'About 299 credits (up to 1,050)', waves: 2 })
    const last = aiSiteImportWaveClosed(aiSiteImportWaveStarted(state, 0, 'x', new Map()), 0, 'y')
    const reviewed = { ...last, waves: last.waves.map((wave) => (wave.index === 1 ? wave : { ...wave, status: 'done' as const })) }
    expect(aiSiteImportStartAllAction(summary({ siteImport: reviewed, items: aiSiteImportLedger(reviewed) }))).toBeNull()
  })
})
