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

import {
  AI_MEASURED_AT,
  AI_MEASURED_FREE_SITE_CREDITS,
  AI_MEASURED_PAGE_SECTIONS,
  AI_MEASURED_UNIT_CREDITS,
  aiCreditRangeText,
  aiCreditsConfirmation,
  aiCreditsNeedConfirm,
  aiCreditsPromptFor,
  aiCreditsPromptText,
  aiCreditsSmallerText,
  aiMeasuredPageCredits,
} from './ai-credit-estimate'
import { aiFreeSiteCreditEstimate, aiFreeSiteCreditRange } from './ai-site-job'

/**
 * The measured table a job is quoted from (AGL-3722). A re-measure moves the
 * table and this spec together: the figures are named here as they were read.
 */
describe('what a job is quoted from (AGL-3722)', () => {
  it('holds the production measurement as read on 2026-10-09, done jobs since 2026-10-01', () => {
    expect(AI_MEASURED_AT).toEqual({ read: '2026-10-09', since: '2026-10-01' })
    expect(AI_MEASURED_UNIT_CREDITS).toEqual({
      page: { median: 30, p90: 40 },
      form: { median: 29, p90: 31 },
      layout: { median: 23, p90: 24 },
      theme: { median: 4, p90: 8 },
      plan: { median: 21, p90: 70 },
    })
  })

  it('scales a page by its sections around the ~5-section median: about 6 a section, 8 at the p90', () => {
    expect(aiMeasuredPageCredits(AI_MEASURED_PAGE_SECTIONS)).toEqual(AI_MEASURED_UNIT_CREDITS.page)
    expect(aiMeasuredPageCredits(6)).toEqual({ median: 36, p90: 48 })
    expect(aiMeasuredPageCredits(3)).toEqual({ median: 18, p90: 24 })
    expect(aiMeasuredPageCredits(0)).toEqual({ median: 6, p90: 8 })
  })

  it('quotes a whole Free two-page site near what one measured (148–160), its p90 above it, its ceiling the worst case', () => {
    const range = aiFreeSiteCreditRange(2)
    // The sum of per-item medians runs a little under a whole job's median; within a tenth of it.
    expect(range.likely).toBeGreaterThanOrEqual(Math.floor(AI_MEASURED_FREE_SITE_CREDITS.low * 0.9))
    expect(range.likely).toBeLessThanOrEqual(AI_MEASURED_FREE_SITE_CREDITS.high)
    expect(range.p90).toBeGreaterThanOrEqual(AI_MEASURED_FREE_SITE_CREDITS.high)
    expect(range.ceiling).toBe(aiFreeSiteCreditEstimate(2))
  })
})

describe('how a range is quoted and confirmed (AGL-3722)', () => {
  const range = { likely: 180, p90: 230, ceiling: 600 }

  it('reads "About 180 credits (up to 600)", one number when the two meet', () => {
    expect(aiCreditRangeText(range)).toBe('About 180 credits (up to 600)')
    expect(aiCreditRangeText({ likely: 1200, p90: 1500, ceiling: 2400 })).toBe('About 1,200 credits (up to 2,400)')
    expect(aiCreditRangeText({ likely: 50, p90: 50, ceiling: 50 })).toBe('About 50 credits')
  })

  it('asks only when the p90 is more than what is left', () => {
    expect(aiCreditsNeedConfirm(range, 230)).toBe(false)
    expect(aiCreditsNeedConfirm(range, 229)).toBe(true)
    expect(aiCreditsNeedConfirm(range, Number.NaN)).toBe(false)
    expect(aiCreditsPromptFor(range, { left: 300, resetsOn: '2026-11-01' })).toBeNull()
    expect(aiCreditsPromptFor(range, null)).toBeNull()
    expect(aiCreditsPromptFor(range, { left: 120.7, resetsOn: '2026-11-01' })).toEqual({
      ...range,
      left: 120,
      resetsOn: '2026-11-01',
      smaller: null,
    })
  })

  it('says it plainly, with the smaller first build and the record a go-ahead keeps', () => {
    const prompt = {
      ...range,
      left: 120,
      resetsOn: '2026-11-01',
      smaller: { label: 'Build the home page first', likely: 64, p90: 80, ceiling: 250 },
    }
    expect(aiCreditsPromptText(prompt)).toBe(
      'This build is about 180 credits (up to 600). You have 120 left, so it will build as much as it can and pause ' +
        'when your credits run out. You can upgrade or resume when they renew on November 1.',
    )
    expect(aiCreditsPromptText(prompt, 'site')).toMatch(/^This site is about 180 credits/)
    expect(aiCreditsSmallerText(prompt.smaller)).toBe('Build the home page first (about 64 credits)')
    const at = new Date('2026-10-09T12:00:00.000Z')
    expect(aiCreditsConfirmation(prompt, 'uid-1', at)).toEqual({ by: 'uid-1', at, left: 120, likely: 180, p90: 230, ceiling: 600 })
    expect(aiCreditsConfirmation(null, 'uid-1', at)).toBeNull()
  })
})
