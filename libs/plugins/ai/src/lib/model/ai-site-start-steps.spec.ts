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

import { AI_SITE_START_ANSWERS, aiSiteStartRefusal, type AiSiteStartAnswers } from './ai-site-start'
import {
  AI_SITE_START_STEP_FIELDS,
  AI_SITE_START_STEPS,
  aiSiteStartFieldErrors,
  aiSiteStartFirstInvalidStep,
  aiSiteStartNextStep,
  aiSiteStartPreviousStep,
  aiSiteStartStepErrors,
} from './ai-site-start-steps'

const answers = (patch: Partial<AiSiteStartAnswers> = {}): AiSiteStartAnswers => ({
  ...AI_SITE_START_ANSWERS,
  siteType: 'a bakery',
  ...patch,
})

describe('the guided start’s steps (AGL-3898)', () => {
  it('walks choose, kind, audience, style, details and review, in that order', () => {
    expect(AI_SITE_START_STEPS).toEqual(['choose', 'kind', 'audience', 'style', 'details', 'review'])
    expect(aiSiteStartNextStep('choose')).toBe('kind')
    expect(aiSiteStartNextStep('review')).toBeNull()
    expect(aiSiteStartPreviousStep('kind')).toBe('choose')
    expect(aiSiteStartPreviousStep('choose')).toBeNull()
  })

  it('asks every answer the job is built from on exactly one step, and the example on none (the form never asked it)', () => {
    const asked = Object.values(AI_SITE_START_STEP_FIELDS).flat()
    expect(new Set(asked).size).toBe(asked.length)
    expect(asked.sort()).toEqual(Object.keys(AI_SITE_START_ANSWERS).filter((key) => key !== 'example').sort())
  })

  it('keeps what kind of site it is the one required answer', () => {
    const blank = answers({ siteType: '  ' })
    expect(aiSiteStartStepErrors('kind', blank)).toEqual([{ field: 'siteType', message: 'Say what kind of site this is.', code: 'required' }])
    for (const step of ['audience', 'style', 'details'] as const) expect(aiSiteStartStepErrors(step, blank)).toEqual([])
  })

  it.each([
    ['an empty kind of site', { siteType: '' }, 'siteType'],
    ['a kind of site past the limit', { siteType: 'x'.repeat(121) }, 'siteType'],
    ['an audience past the limit', { audience: 'x'.repeat(121) }, 'audience'],
    ['a page count outside the band', { pages: 12 }, 'pages'],
    ['an unknown place for submissions', { submissions: 'nowhere' as AiSiteStartAnswers['submissions'] }, 'submissions'],
  ] as const)('says %s in the very words the start always refused it with', (_case, patch, field) => {
    const asked = answers(patch as Partial<AiSiteStartAnswers>)
    expect(aiSiteStartFieldErrors(asked)[field]?.message).toBe(aiSiteStartRefusal(asked))
  })

  it('holds the page count to the Free band on the Free taste', () => {
    expect(aiSiteStartStepErrors('details', answers({ pages: 5 }), { freeTaste: true })).toEqual([
      { field: 'pages', message: 'A site is planned with 1 to 2 pages.', code: 'out_of_range' },
    ])
    expect(aiSiteStartStepErrors('details', answers({ pages: 2 }), { freeTaste: true })).toEqual([])
  })

  it('finds the first step a review cannot go forward from', () => {
    expect(aiSiteStartFirstInvalidStep(answers())).toBeNull()
    expect(aiSiteStartFirstInvalidStep(answers({ siteType: '' }))).toBe('kind')
    expect(aiSiteStartFirstInvalidStep(answers({ pages: 99 }))).toBe('details')
  })

  it('refuses nothing the start would let through', () => {
    const fine = answers({ audience: 'locals', kind: 'restaurant', pages: 8, submissions: 'lead', welcomeEmail: false })
    expect(aiSiteStartRefusal(fine)).toBeNull()
    expect(aiSiteStartFieldErrors(fine)).toEqual({})
  })
})
