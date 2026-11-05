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

import { aiSiteImportStyle } from '../jobs/ai-site-import-look'
import {
  siteImportCreditsLine,
  siteImportCreditsMeasured,
  siteImportFidelityThemeFor,
  siteImportLookLine,
  siteImportLookPins,
  siteImportLookPinsLine,
  siteImportLookReport,
  siteImportPageFinish,
} from './ai-site-import-report'

/** A site as an import leaves it: the starter's base, the look saved over it. */
const worn = {
  theme: {
    colorSchemes: { light: { primary: { main: '#4338ca' }, secondary: { main: '#0f766e' }, tertiary: { main: '#b45309' } } },
    fonts: [{ family: 'Plus Jakarta Sans' }],
  },
  themeOverride: { patch: { colorSchemes: { light: { primary: { main: '#0970a4' }, secondary: { main: '#bfe4fd' } } }, fonts: [{ family: 'Roboto Flex' }] } },
  siteStyle: { base: 'starter', jobId: 'job1', brand: '#00b0ff' },
}

describe('the look a built site wears (AGL-4109)', () => {
  it('reads the override over the base, not the base the import started from', () => {
    expect(siteImportLookReport(worn, { look: { theme: 'applied' } })).toEqual({
      base: 'starter',
      override: true,
      jobId: 'job1',
      brand: '#00b0ff',
      pass: 'applied',
      primary: '#0970a4',
      secondary: '#bfe4fd',
      // A color the look left alone is the base's.
      tertiary: '#b45309',
      fonts: ['Roboto Flex'],
    })
  })

  it('says whose look it is, so the line proves the look is this job’s', () => {
    expect(siteImportLookLine(worn, { look: { theme: 'applied' } }, 'job1')).toBe(
      'applied; primary #0970a4, secondary #bfe4fd, tertiary #b45309, drawn from #00b0ff; Roboto Flex; an override over the starter base; saved by this job',
    )
    expect(siteImportLookLine(worn, { look: { theme: 'applied' } }, 'job2')).toContain('saved by job job1, not this one')
  })

  it('reports the base, and says so, for a site with no look saved over it', () => {
    const bare = { theme: worn.theme }
    expect(siteImportLookReport(bare, null)).toMatchObject({ override: false, primary: '#4338ca', fonts: ['Plus Jakarta Sans'], jobId: null })
    expect(siteImportLookLine(bare, null, 'job1')).toBe('not run; primary #4338ca, secondary #0f766e, tertiary #b45309; Plus Jakarta Sans; the site base, no override; saved by no job')
  })

  it('names what is not set rather than guessing it', () => {
    expect(siteImportLookLine({}, null, 'job1')).toBe('not run; primary not set, secondary not set, tertiary not set; not set; the site base, no override; saved by no job')
  })
})

describe('what a built site’s pages cost (AGL-4109)', () => {
  const row = (slot: string, creditsSpent: number, rest: Partial<{ status: 'succeeded' | 'failed' | 'skipped'; creditsRefunded: number }> = {}) => ({ slot, creditsSpent, status: 'succeeded' as const, creditsRefunded: 0, ...rest })

  it('takes the median and the nearest-rank p90 of the pages that came through, by how each was built', () => {
    const pages = [...Array.from({ length: 10 }, (_, at) => ({ slot: `a${at}`, build: 'arranged' })), { slot: 'c0', build: 'copied' }, { slot: 'c1', build: 'copied' }]
    const items = [...[3, 5, 7, 8, 9, 10, 10, 11, 12, 30].map((spent, at) => row(`a${at}`, spent)), row('c0', 0), row('c1', 0)]
    expect(siteImportCreditsMeasured({ pages }, items)).toEqual({
      arranged: { count: 10, median: 9.5, p90: 12, mean: 10.5 },
      copied: { count: 2, median: 0, p90: 0, mean: 0 },
    })
  })

  it('leaves out a page that failed, was skipped or gave back what it spent, and the header', () => {
    const pages = [{ slot: 'a0', build: 'arranged' }, { slot: 'a1', build: 'arranged' }, { slot: 'a2', build: 'arranged' }, { slot: 'a3', build: 'arranged' }]
    const items = [row('a0', 10), row('a1', 90, { status: 'failed' }), row('a2', 90, { status: 'skipped' }), row('a3', 90, { creditsRefunded: 90 }), row('frame', 500)]
    expect(siteImportCreditsMeasured({ pages }, items)).toEqual({ arranged: { count: 1, median: 10, p90: 10, mean: 10 } })
  })

  it('prints the median, the p90 and the mean with the count', () => {
    expect(siteImportCreditsLine({ arranged: { count: 77, median: 9.5, p90: 12, mean: 9.46 }, copied: { count: 48, median: 0, p90: 0, mean: 0 } })).toBe(
      '77 arranged, median 9.5, p90 12, mean 9.5; 48 copied, median 0, p90 0, mean 0',
    )
    expect(siteImportCreditsLine({})).toBe('no page in yet')
  })
})

describe('what Keep my site pins of the source’s look, source → theme (AGL-4152)', () => {
  /** The 11/4 live import of aglyn.com: its slate ground came out near-black, its cyan capitals deepened and in sentence case. */
  const live = {
    ...worn,
    themeOverride: {
      patch: {
        colorSchemes: {
          light: { background: { default: '#f5f5f5', paper: '#ffffff' }, primary: { main: '#0970a4', contrastText: '#ffffff' } },
          dark: { background: { default: '#0d1117', paper: '#161b22' } },
        },
        typography: { variants: { button: { textTransform: 'none' } } },
      },
    },
  }
  const read = { look: { theme: 'applied' }, home: { look: { background: '#f5f5f5', darkBackground: '#2b2f36', buttonFill: '#00b0ff', buttonText: '#0b1f2a', buttonCase: 'upper' } } }

  it('sets each pin beside the theme’s, a color with how far it moved', () => {
    const pins = siteImportLookPins(live, read)
    expect(pins).toMatchObject({
      from: 'theme',
      ground: { source: '#f5f5f5', theme: '#f5f5f5', delta: 0 },
      darkGround: { source: '#2b2f36', theme: '#0d1117' },
      buttonFill: { source: '#00b0ff', theme: '#0970a4' },
      buttonText: { source: '#0b1f2a', theme: '#ffffff' },
      buttonCase: { source: 'upper', theme: 'none', delta: null },
    })
    expect(pins?.darkGround.delta).toBeGreaterThan(0.05)
    expect(pins?.buttonFill.delta).toBeGreaterThan(0.05)
  })

  it('prints them on the look line, and nothing more for an import that read no look of its source', () => {
    const line = siteImportLookLine(live, read, 'job1')
    expect(line).toContain('; pins ground #f5f5f5 → #f5f5f5 (ΔE 0.000, kept), darkGround #2b2f36 → #0d1117 (ΔE ')
    expect(line).toMatch(/buttonFill #00b0ff → #0970a4 \(ΔE 0\.\d{3}, moved\)/)
    expect(line).toContain('buttonText #0b1f2a → #ffffff')
    expect(line).toContain('buttonCase upper → none (moved)')
    expect(line).toContain('paper not read → #ffffff')
    expect(line).toContain('darkPaper not read → #161b22')
    expect(line).toContain('buttonOutline not read → #0970a4')
    expect(line).toContain('textCase not read → none')
    expect(siteImportLookReport(live, read).pins).toBeDefined()
    expect(siteImportLookReport(live, { look: { theme: 'applied' } })).not.toHaveProperty('pins')
  })

  it('sets the paper, the outlined buttons’ color and the text buttons’ case beside the theme’s', () => {
    const pins = siteImportLookPins(live, { home: { look: { paperBackground: '#ffffff', buttonOutline: '#0077ad', textCase: 'none' } } })
    expect(pins?.paper).toEqual({ source: '#ffffff', theme: '#ffffff', delta: 0 })
    expect(pins?.buttonOutline).toMatchObject({ source: '#0077ad', theme: '#0970a4' })
    expect(pins?.textCase).toEqual({ source: 'none', theme: 'none', delta: null })
  })

  it('names a pin the reader did not read, rather than guessing it', () => {
    const line = siteImportLookPinsLine(siteImportLookPins(live, { home: { look: { background: '#f5f5f5' } } }) as NonNullable<ReturnType<typeof siteImportLookPins>>)
    expect(line).toContain('darkGround not read → #0d1117')
    expect(line).toContain('buttonCase not read → none')
  })

  it('reads the theme the site stores, else computes it from its site style and says so', () => {
    expect(siteImportFidelityThemeFor(live)?.from).toBe('theme')
    const style = aiSiteImportStyle(null, { seed: 7, description: 'A website platform', facts: { fonts: { body: null, headings: null, google: [] }, background: '#f5f5f5', text: '#000000', buttonFill: '#00b0ff', buttonText: '#ffffff', buttonRadius: 4, link: null, header: null } })
    const computed = siteImportFidelityThemeFor({ siteStyle: style })
    expect(computed?.from).toBe('style')
    expect(computed?.light.ground).toMatch(/^#[0-9a-f]{6}$/)
    expect(siteImportFidelityThemeFor({ siteStyle: { base: 'starter', jobId: 'job1' } })).toBeNull()
    expect(siteImportLookPinsLine(siteImportLookPins({ siteStyle: style }, read) as NonNullable<ReturnType<typeof siteImportLookPins>>)).toContain('the theme computed from the site style')
  })
})

describe('how each page of an import was finished (AGL-4152)', () => {
  const state = {
    finish: 'improve',
    wording: true,
    waves: [
      { index: 1, finish: 'keep', wording: false },
      { index: 2, finish: 'improve', wording: true },
      { index: 3 },
    ],
  }

  it('reads the wave a page was built in, else the import, else Keep my site', () => {
    expect(siteImportPageFinish(state, { wave: 1 })).toEqual({ finish: 'keep', words: 'kept', from: 'wave' })
    expect(siteImportPageFinish(state, { wave: 2 })).toEqual({ finish: 'improve', words: 'improved', from: 'wave' })
    expect(siteImportPageFinish(state, { wave: 3 })).toEqual({ finish: 'improve', words: 'improved', from: 'import' })
    expect(siteImportPageFinish({ waves: [] }, { wave: 1 })).toEqual({ finish: 'keep', words: 'kept', from: 'default' })
  })

  it('takes a page’s own words stamp over its wave’s, and what is asked over both', () => {
    expect(siteImportPageFinish(state, { wave: 2, wording: 'kept' })).toMatchObject({ finish: 'improve', words: 'kept' })
    expect(siteImportPageFinish(state, { wave: 2 }, { finish: 'keep' })).toEqual({ finish: 'keep', words: 'kept', from: 'asked' })
    expect(siteImportPageFinish(state, { wave: 1 }, { words: 'improved' })).toMatchObject({ finish: 'keep', words: 'improved' })
    // Keep my site never improves a word on its own.
    expect(siteImportPageFinish({ finish: 'keep', wording: true, waves: [] }, { wave: 1 })).toMatchObject({ words: 'kept' })
  })
})
