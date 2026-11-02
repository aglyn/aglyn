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

import { siteImportCreditsLine, siteImportCreditsMeasured, siteImportLookLine, siteImportLookReport } from './ai-site-import-report'

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
