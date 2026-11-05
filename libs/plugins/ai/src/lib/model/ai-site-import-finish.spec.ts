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
 * Keep my site, or Improve it (AGL-4152), as the import's plan of record
 * holds it: an import that never said is Keep my site and never silently
 * improved, each wave is stamped with the choice when it starts, a change
 * between waves reaches only the waves not yet started, and only an arranged
 * main page that is no policy has its wording improved.
 */

import { AI_MEASURED_IMPORT_CREDITS, aiCreditRangeText } from './ai-credit-estimate'
import type { AiJob } from './ai-jobs.types'
import {
  AI_SITE_IMPORT_DEFAULT_CHOICE,
  AI_SITE_IMPORT_FINISH_INPUT,
  AI_SITE_IMPORT_WORDING_INPUT,
  aiSiteImportChoiceFromInputs,
  aiSiteImportChoiceOf,
  aiSiteImportCreditRange,
  aiSiteImportFinishUpdate,
  aiSiteImportInventory,
  aiSiteImportPageBuild,
  aiSiteImportPageIsLegal,
  aiSiteImportPageWording,
  aiSiteImportQuoteText,
  aiSiteImportWaveChoice,
  aiSiteImportWaveClosed,
  aiSiteImportWaveCreditRange,
  aiSiteImportWaveOwed,
  aiSiteImportWaveStamped,
  aiSiteImportWaveStarted,
  aiSiteImportWordingCredits,
  aiSiteImportWordingPages,
  aiSiteImportWordsKept,
  type AiSiteImportListedPage,
  type AiSiteImportState,
} from './ai-site-import'

const listed = (path: string): AiSiteImportListedPage => ({
  url: `https://harbor-dental.com${path}`,
  path,
  title: path === '/' ? 'Home' : (path.split('/').pop() as string),
  foundBy: path === '/' ? 'home' : 'sitemap',
  words: 120,
  images: 1,
})

/** Harbor Dental: home, about and its privacy policy as main pages, then a blog of four. */
function harbor(patch: Partial<AiSiteImportState> = {}): AiSiteImportState {
  let id = 0
  const state = aiSiteImportInventory({
    domain: 'harbor-dental.com',
    siteName: 'Harbor Dental',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: 'x',
    pages: ['/', '/about', '/privacy-policy', ...Array.from({ length: 4 }, (_, index) => `/blog/post-${index + 1}`)].map(listed),
    menu: ['/', '/about', '/privacy-policy'],
    skipped: [],
    stoppedBy: null,
    pageLimit: 25,
    existingPages: 0,
    mintId: () => `d${++id}`,
  })
  return { ...state, ...patch }
}

const waiting = (state: AiSiteImportState): Pick<AiJob, 'kind' | 'status' | 'review' | 'siteImport'> => ({
  kind: 'import',
  status: 'needs_review',
  review: { reason: 'wave', message: 'Start the first wave when you are ready.', findings: [] },
  siteImport: state,
})

describe('the choice an import holds', () => {
  it('reads an import that never said as Keep my site, its wording kept', () => {
    expect(aiSiteImportChoiceOf(harbor())).toEqual({ finish: 'keep', wording: false })
    expect(aiSiteImportChoiceOf(null)).toEqual({ finish: 'keep', wording: false })
    expect(aiSiteImportChoiceFromInputs({ domain: 'harbor-dental.com' })).toEqual({ finish: 'keep', wording: false })
    // Anything but improve is no improvement.
    expect(aiSiteImportChoiceFromInputs({ [AI_SITE_IMPORT_FINISH_INPUT]: 'better', [AI_SITE_IMPORT_WORDING_INPUT]: true })).toEqual({ finish: 'keep', wording: false })
  })

  it('takes Improve it with its wording on unless the owner switched it off, and never rewords under Keep my site', () => {
    expect(aiSiteImportChoiceFromInputs({ [AI_SITE_IMPORT_FINISH_INPUT]: 'improve', [AI_SITE_IMPORT_WORDING_INPUT]: true })).toEqual({ finish: 'improve', wording: true })
    expect(aiSiteImportChoiceFromInputs({ [AI_SITE_IMPORT_FINISH_INPUT]: 'improve' })).toEqual({ finish: 'improve', wording: true })
    expect(aiSiteImportChoiceFromInputs({ [AI_SITE_IMPORT_FINISH_INPUT]: 'improve', [AI_SITE_IMPORT_WORDING_INPUT]: false })).toEqual({ finish: 'improve', wording: false })
    expect(aiSiteImportChoiceFromInputs({ [AI_SITE_IMPORT_FINISH_INPUT]: 'keep', [AI_SITE_IMPORT_WORDING_INPUT]: true })).toEqual({ finish: 'keep', wording: false })
    expect(aiSiteImportChoiceOf(harbor({ finish: 'keep', wording: true }))).toEqual({ finish: 'keep', wording: false })
  })

  it('preselects Improve it, with Also improve my wording on', () => {
    expect(AI_SITE_IMPORT_DEFAULT_CHOICE).toEqual({ finish: 'improve', wording: true })
  })
})

describe('which pages are policies, whose words are always kept', () => {
  it('knows a policy by its address on either site or its title, its plural too', () => {
    for (const page of [
      { slug: 'privacy-policy', title: 'Privacy' },
      { slug: 'legal/terms', title: 'Terms of Service' },
      { slug: 'cookies', title: 'Cookies' },
      { slug: 'returns', title: 'Returns' },
      { slug: 'refund-policy', title: 'Refunds' },
      { slug: 'shipping-policy', title: 'Shipping' },
      { slug: 'info', title: 'Shipping Policies' },
      { slug: 'accessibility', title: 'Accessibility statement' },
      { slug: 'gdpr', title: 'GDPR' },
      { slug: 'imprint', title: 'Imprint' },
      { slug: 'x', path: '/impressum', title: 'Kontakt' },
      { slug: 'disclaimer', title: 'Disclaimer' },
    ]) {
      expect(aiSiteImportPageIsLegal(page)).toBe(true)
    }
  })

  it('never takes a word inside another for one, or a page about shipping for its policy', () => {
    for (const page of [
      { slug: '', title: 'Home' },
      { slug: 'about', title: 'About us' },
      { slug: 'long-term-care', title: 'Long-term care' },
      { slug: 'shipping', title: 'Fast shipping' },
      { slug: 'termsheet', title: 'Pricing' },
    ]) {
      expect(aiSiteImportPageIsLegal(page)).toBe(false)
    }
  })
})

describe('a wave stamped when it starts', () => {
  const improved = { finish: 'improve', wording: true } as const

  it('improves the wording only of an arranged main page that is no policy, under Improve it with its wording on', () => {
    const state = harbor()
    const [home, about, privacy] = state.pages
    const post = state.pages.find((page) => page.group !== 'main')
    if (!post) throw new Error('no blog post')
    expect([home, about, privacy, post].map((page) => aiSiteImportPageWording(page, improved))).toEqual(['improved', 'improved', 'kept', 'kept'])
    expect(aiSiteImportPageWording(home, { finish: 'improve', wording: false })).toBe('kept')
    expect(aiSiteImportPageWording(home, { finish: 'keep', wording: false })).toBe('kept')
  })

  it('stamps the wave and its pages with the choice now, and no other wave', () => {
    const state = aiSiteImportWaveStamped(aiSiteImportWaveStarted(harbor({ finish: 'improve', wording: true }), 0, 'x', new Map()), 0)
    expect(state.waves.map((wave) => [wave.finish ?? null, wave.wording ?? null])).toEqual([
      ['improve', true],
      [null, null],
    ])
    expect(state.pages.map((page) => page.wording ?? null)).toEqual(['improved', 'improved', 'kept', null, null, null, null])
  })

  it('keeps a wave already in as it was built when the choice changes before the next', () => {
    // The first wave as Keep my site.
    let state = aiSiteImportWaveStamped(aiSiteImportWaveStarted(harbor({ finish: 'keep', wording: false }), 0, 'x', new Map()), 0)
    state = aiSiteImportWaveClosed(state, 0, 'y')
    // Changed to Improve it while the second wave waits.
    const update = aiSiteImportFinishUpdate(waiting(state), { finish: 'improve', wording: true })
    expect(update).toEqual({ 'siteImport.finish': 'improve', 'siteImport.wording': true })
    state = { ...state, finish: update?.['siteImport.finish'], wording: update?.['siteImport.wording'] }
    expect(aiSiteImportWaveChoice(state, state.waves[0])).toEqual({ finish: 'keep', wording: false })
    expect(aiSiteImportWaveChoice(state, state.waves[1])).toEqual({ finish: 'improve', wording: true })
    state = aiSiteImportWaveStamped(aiSiteImportWaveStarted(state, 1, 'z', new Map()), 1)
    expect(state.waves.map((wave) => wave.finish)).toEqual(['keep', 'improve'])
    expect(state.pages.slice(0, 3).map((page) => page.wording)).toEqual(['kept', 'kept', 'kept'])
  })

  it('reads a wave that started before the choice existed as Keep my site', () => {
    const state = aiSiteImportWaveStarted(harbor({ finish: 'improve', wording: true }), 0, 'x', new Map())
    expect(aiSiteImportWaveChoice(state, state.waves[0])).toEqual({ finish: 'keep', wording: false })
  })
})

describe('the change between waves the resume door writes', () => {
  it('writes the finish and the switch, the switch always off under Keep my site', () => {
    expect(aiSiteImportFinishUpdate(waiting(harbor()), { finish: 'keep', wording: true })).toEqual({ 'siteImport.finish': 'keep', 'siteImport.wording': false })
    // Improve it with no word on the switch: on, its default, or as the import had it.
    expect(aiSiteImportFinishUpdate(waiting(harbor()), { finish: 'improve' })).toEqual({ 'siteImport.finish': 'improve', 'siteImport.wording': true })
    expect(aiSiteImportFinishUpdate(waiting(harbor({ finish: 'improve', wording: false })), { finish: 'improve' })).toEqual({
      'siteImport.finish': 'improve',
      'siteImport.wording': false,
    })
    // The switch alone keeps the finish.
    expect(aiSiteImportFinishUpdate(waiting(harbor({ finish: 'improve', wording: true })), { wording: false })).toEqual({
      'siteImport.finish': 'improve',
      'siteImport.wording': false,
    })
  })

  it('writes nothing onto a job that is no import waiting for a wave that has not started', () => {
    const state = harbor()
    expect(aiSiteImportFinishUpdate({ ...waiting(state), kind: 'site' }, { finish: 'improve' })).toBeNull()
    expect(aiSiteImportFinishUpdate({ ...waiting(state), status: 'running' }, { finish: 'improve' })).toBeNull()
    expect(aiSiteImportFinishUpdate({ ...waiting(state), review: { reason: 'ownership', message: '', findings: [] } }, { finish: 'improve' })).toBeNull()
    const allIn = aiSiteImportWaveClosed(aiSiteImportWaveClosed(aiSiteImportWaveStarted(aiSiteImportWaveStarted(state, 0, 'x', new Map()), 1, 'x', new Map()), 0, 'y'), 1, 'y')
    expect(aiSiteImportFinishUpdate(waiting(allIn), { finish: 'improve' })).toBeNull()
  })
})

describe('what Also improve my wording adds', () => {
  it('prices each reworded page as measured, about 25 more than an arranged one, and counts only the pages it rewords', () => {
    // A reworded page stands in place of an arranged one: the switch adds the difference.
    const { reworded, arranged } = AI_MEASURED_IMPORT_CREDITS
    expect(aiSiteImportWordingCredits(1)).toEqual({ likely: reworded.median - arranged.median, p90: reworded.p90 - arranged.p90 })
    expect(aiSiteImportWordingCredits(1).likely).toBe(25)
    const state = harbor()
    // Home and about: the policy and the blog keep every word.
    expect(aiSiteImportWordingPages(state, state.waves[0], { finish: 'improve', wording: true })).toBe(2)
    expect(aiSiteImportWordingPages(state, state.waves[1], { finish: 'improve', wording: true })).toBe(0)
    expect(aiSiteImportWordingPages(state, state.waves[0], { finish: 'improve', wording: false })).toBe(0)
    expect(aiSiteImportWordingPages(state, state.waves[0], { finish: 'keep', wording: false })).toBe(0)
  })

  /** The inventory with each page's build chosen, as the import step chooses it. */
  const built = (state: AiSiteImportState): AiSiteImportState => ({ ...state, pages: state.pages.map((entry) => ({ ...entry, build: aiSiteImportPageBuild(entry) })) })

  it('quotes a reworded page on its measured row, inside the ceiling an arranged page already holds', () => {
    const { reworded } = AI_MEASURED_IMPORT_CREDITS
    expect(aiSiteImportCreditRange(0, { arranged: 1, reworded: 1 })).toEqual({ likely: reworded.median, p90: reworded.p90, ceiling: 100 })
    // No more reworded than arranged.
    expect(aiSiteImportCreditRange(0, { arranged: 1, reworded: 3 })).toEqual(aiSiteImportCreditRange(0, { arranged: 1, reworded: 1 }))
    const on = built(harbor({ finish: 'improve', wording: true }))
    const off = built(harbor({ finish: 'improve', wording: false }))
    expect(aiSiteImportWaveOwed(on, on.waves[0])).toMatchObject({ arranged: 3, reworded: 2 })
    expect(aiSiteImportWaveOwed(off, off.waves[0])).toMatchObject({ arranged: 3, reworded: 0 })
    const [withWords, without] = [aiSiteImportWaveCreditRange(on, on.waves[0]), aiSiteImportWaveCreditRange(off, off.waves[0])]
    // The switch adds what it says it adds, and the most a page can spend does not move.
    expect(withWords.likely - without.likely).toBe(aiSiteImportWordingCredits(2).likely)
    expect(withWords.p90 - without.p90).toBe(aiSiteImportWordingCredits(2).p90)
    expect(withWords.ceiling).toBe(without.ceiling)
  })

  it('names a wave’s reworded pages in its quote, and those whose words are kept apart', () => {
    const on = built(harbor({ finish: 'improve', wording: true }))
    const range = aiSiteImportWaveCreditRange(on, on.waves[0])
    expect(aiSiteImportQuoteText(range, aiSiteImportWaveOwed(on, on.waves[0]))).toBe(`${aiCreditRangeText(range)}: 2 pages arranged and reworded by Aglyn AI, 1 arranged by Aglyn AI`)
    expect(aiSiteImportQuoteText(range, { arranged: 7, reworded: 7, copied: 3 })).toBe(`${aiCreditRangeText(range)}: 7 pages arranged and reworded by Aglyn AI, 3 copied as they are`)
    expect(aiSiteImportQuoteText(range, { arranged: 7, copied: 3 })).toBe(`${aiCreditRangeText(range)}: 7 pages arranged by Aglyn AI, 3 copied as they are`)
  })

  it('reads a page whose rewrite was refused as kept, in its row and its wave’s quote', () => {
    const started = aiSiteImportWaveStamped(aiSiteImportWaveStarted(built(harbor({ finish: 'improve', wording: true })), 0, 'x', new Map()), 0)
    const home = started.pages.find((entry) => entry.path === '/') as AiSiteImportState['pages'][number]
    expect(home.wording).toBe('improved')
    const kept = aiSiteImportWordsKept(started, home.slot)
    expect(kept.pages.find((entry) => entry.slot === home.slot)?.wording).toBe('kept')
    expect(aiSiteImportWaveOwed(kept, kept.waves[0]).reworded).toBe(aiSiteImportWaveOwed(started, started.waves[0]).reworded - 1)
    // A page whose words were never improved is left as it is.
    const policy = started.pages.find((entry) => entry.path === '/privacy-policy') as AiSiteImportState['pages'][number]
    expect(aiSiteImportWordsKept(started, policy.slot)).toBe(started)
  })
})
