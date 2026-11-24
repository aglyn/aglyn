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

import type { AiJobItemLedger } from './ai-jobs.types'
import type { AiSiteImportPage, AiSiteImportState } from './ai-site-import'
import {
  aiSiteImportRedirectPlan,
  aiSiteImportRedirectText,
  aiSiteImportRedirectsSummary,
} from './ai-site-import-redirects'
import { aiSiteImportWaveRows } from './ai-site-import-view'

/**
 * Which old addresses an import asks a redirect for (AGL-4245), from a
 * hand-built import and routing map: same-path pages need nothing, a page
 * there is never hidden, a query-only twin gets none, a recorded other
 * address of a page gets one, and a settled address is never asked twice.
 */

/** The redirects plugin's stored form, for the spec: lowercase, no query, no trailing slash. */
const stored = (path: string): string | null => {
  if (/\s/.test(path)) return null
  const value = (path.startsWith('/') ? path : `/${path}`).split(/[?#]/)[0]!.toLowerCase()
  return value.length > 1 ? value.replace(/\/+$/, '') : '/'
}

function page(slot: string, path: string, slug: string, extra: Partial<AiSiteImportPage> = {}): AiSiteImportPage {
  return {
    slot,
    url: `https://old.example.com${path}`,
    path,
    title: slot,
    group: 'main',
    wave: 0,
    draftId: `d-${slot}`,
    slug,
    words: 100,
    images: 0,
    ...extra,
  }
}

function state(pages: AiSiteImportPage[], extra: Partial<AiSiteImportState> = {}): AiSiteImportState {
  return {
    domain: 'old.example.com',
    siteName: 'Old',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: '2026-11-24T00:00:00Z',
    pageLimit: null,
    existingPages: 0,
    found: pages.length,
    stoppedBy: null,
    groups: [],
    pages,
    waves: [{ index: 0, label: 'Main pages', group: 'main', slots: pages.map((entry) => entry.slot), frame: false, status: 'review', startedAt: null, finishedAt: null }],
    leftOut: [],
    leftOutCount: {},
    frame: null,
    ...extra,
  }
}

const done = (slot: string): AiJobItemLedger =>
  ({ slot, op: 'page', label: slot, status: 'succeeded', attempt: 1, creditsSpent: 0, creditsRefunded: 0, outputs: [] }) as AiJobItemLedger

describe('which old addresses an import redirects', () => {
  const pages = [
    page('p0', '/', '/'),
    page('p1', '/About-Us/', 'about-us'),
    page('p2', '/services.html', 'services'),
    page('p3', '/blog/spring-sale', 'spring-sale'),
    page('p4', '/team', 'team-2'),
    page('p5', '/blog/spring-sale?ref=menu', 'spring-sale-2'),
    page('p6', '/not-live', 'not-live-yet'),
    page('p7', '/later', 'later', { wave: 1 }),
  ]
  const screens = {
    'd-p0': '/',
    'd-p1': 'about-us',
    'd-p2': 'services',
    'd-p3': 'spring-sale',
    'd-p4': 'team-2',
    'd-p5': 'spring-sale-2',
    // Another page of the site already answers at /team.
    owner: 'team',
  }
  const items = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(done)

  it('asks for each page that moved, to its live address, and settles the rest with why', () => {
    const plan = aiSiteImportRedirectPlan({ state: state(pages), items, screens, storedSource: stored })
    expect(plan.asks.map(({ from, to, slot }) => ({ from, to, slot }))).toEqual([
      { from: '/services.html', to: '/services', slot: 'p2' },
      { from: '/blog/spring-sale', to: '/spring-sale', slot: 'p3' },
    ])
    const bySlot = new Map(plan.entries.map((entry) => [entry.slot, entry]))
    expect(bySlot.get('p0')).toMatchObject({ outcome: 'same' })
    // `/About-Us/` is `/about-us` as a redirect reads it: the same address.
    expect(bySlot.get('p1')).toMatchObject({ outcome: 'same', from: '/about-us' })
    expect(bySlot.get('p4')).toMatchObject({ outcome: 'left-out', reason: 'page-there', from: '/team' })
    expect(bySlot.get('p5')).toMatchObject({ outcome: 'left-out', reason: 'shared-address', from: '/blog/spring-sale' })
    expect(bySlot.get('p6')).toMatchObject({ outcome: 'left-out', reason: 'unpublished' })
    // A page of a wave not in yet is not considered.
    expect(bySlot.has('p7')).toBe(false)
  })

  it('never redirects an old address a page of this import will be at', () => {
    const plan = aiSiteImportRedirectPlan({
      state: state([page('p0', '/later', 'later-2'), page('p1', '/x/later', 'later', { wave: 1 })]),
      items: [done('p0')],
      screens: { 'd-p0': 'later-2' },
      storedSource: stored,
    })
    expect(plan.asks).toEqual([])
    expect(plan.entries[0]).toMatchObject({ outcome: 'left-out', reason: 'page-there' })
  })

  it('redirects another address of a page the read recorded, and invents none for any other skip', () => {
    const plan = aiSiteImportRedirectPlan({
      state: state([page('p0', '/', '/'), page('p1', '/menu.php', 'menu')], {
        leftOut: [
          { url: 'https://old.example.com/index.html', path: '/index.html', title: '', reason: 'duplicate', sameAs: '/' },
          { url: 'https://old.example.com/menu.php?print=1', path: '/menu.php?print=1', title: '', reason: 'duplicate', sameAs: '/menu.php' },
          { url: 'https://old.example.com/private', path: '/private', title: '', reason: 'login-form' },
        ],
      }),
      items: [done('p0'), done('p1')],
      screens: { 'd-p0': '/', 'd-p1': 'menu' },
      storedSource: stored,
    })
    expect(plan.asks.map(({ from, to, slot }) => ({ from, to, slot }))).toEqual([
      { from: '/menu.php', to: '/menu', slot: 'p1' },
      { from: '/index.html', to: '/', slot: null },
    ])
  })

  it('carries what is settled and asks again for what was left out', () => {
    const plan = aiSiteImportRedirectPlan({
      state: state(pages, {
        redirects: [
          { from: '/services.html', to: '/services', outcome: 'created', slot: 'p2', ruleId: 'job-1-abc' },
          { from: '/blog/spring-sale', to: '/spring-sale', outcome: 'left-out', reason: 'plan-limit', slot: 'p3' },
        ],
      }),
      items,
      screens,
      storedSource: stored,
    })
    expect(plan.asks.map((ask) => ask.slot)).toEqual(['p3'])
    expect(plan.entries.find((entry) => entry.slot === 'p2')).toMatchObject({ outcome: 'created', ruleId: 'job-1-abc' })
  })

  it('leaves out an address a redirect cannot use', () => {
    const plan = aiSiteImportRedirectPlan({
      state: state([page('p0', '/has space', 'has-space')]),
      items: [done('p0')],
      screens: { 'd-p0': 'has-space' },
      storedSource: stored,
    })
    expect(plan.entries).toEqual([{ from: '/has space', to: null, outcome: 'left-out', reason: 'unusable', slot: 'p0' }])
  })
})

describe('what the import’s page says of them', () => {
  it('says on each row whether a redirect was added, kept or left out, and why', () => {
    expect(aiSiteImportRedirectText({ from: '/a', to: '/b', outcome: 'created' })).toBe('Redirect added: visitors to the old address go to /b')
    expect(aiSiteImportRedirectText({ from: '/a', to: null, outcome: 'kept' })).toBe('You already had a redirect from the old address, so it was kept')
    expect(aiSiteImportRedirectText({ from: '/a', to: '/a', outcome: 'same' })).toBeNull()
    expect(aiSiteImportRedirectText({ from: '/a', to: '/b', outcome: 'left-out', reason: 'page-there' })).toBe(
      'No redirect: a page on your new site uses this address, and a redirect would hide it.',
    )
    expect(
      aiSiteImportRedirectText({ from: '/a', to: '/b', outcome: 'left-out', reason: 'plan-limit', note: 'Your plan includes 25 redirects — upgrade in Billing for more' }),
    ).toBe('No redirect: Your plan includes 25 redirects — upgrade in Billing for more')
  })

  it('counts them for the card, and shows a row’s beside its addresses', () => {
    const imported = state([page('p0', '/old', 'new')], {
      redirects: [
        { from: '/old', to: '/new', outcome: 'created', slot: 'p0' },
        { from: '/index.html', to: '/', outcome: 'kept', slot: null },
        { from: '/x', to: '/y', outcome: 'left-out', reason: 'plan-limit', slot: null },
      ],
    })
    expect(aiSiteImportRedirectsSummary(imported)).toBe('1 redirect added from your old addresses, 1 of yours kept, 1 left out.')
    expect(aiSiteImportRedirectsSummary(state([]))).toBeNull()
    const [row] = aiSiteImportWaveRows({ items: [done('p0')], siteImport: imported, status: 'needs_review' } as never, imported.waves[0]!)
    expect(row).toMatchObject({ from: '/old', to: '/new', redirect: 'Redirect added: visitors to the old address go to /new' })
  })
})
