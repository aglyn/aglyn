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
  AI_SITE_START_ANSWERS,
  AI_SITE_START_STYLE_REQUIRED,
  aiSiteStartRefusal,
  aiSiteStartStyleAnswer,
  type AiSiteStartAnswers,
} from './ai-site-start'
import {
  AI_SITE_START_MORE_FIELDS,
  AI_SITE_START_STEP_FIELDS,
  AI_SITE_START_STEPS,
  aiSiteStartFieldErrors,
  aiSiteStartFirstInvalidStep,
  aiSiteStartNextStep,
  aiSiteStartPreviousStep,
  aiSiteStartStepErrors,
} from './ai-site-start-steps'

/** Answers a person gave: what the site is, and a style card clicked ("Pick for me"). */
const answers = (patch: Partial<AiSiteStartAnswers> = {}): AiSiteStartAnswers => ({
  ...AI_SITE_START_ANSWERS,
  siteType: 'a bakery',
  ...aiSiteStartStyleAnswer('auto'),
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
    // The sites a person likes are an optional answer no default holds (AGL-3975).
    expect(asked.sort()).toEqual([...Object.keys(AI_SITE_START_ANSWERS).filter((key) => key !== 'example'), 'inspiration'].sort())
  })

  it('requires what kind of site it is, and a style card clicked, and nothing else', () => {
    const blank = answers({ siteType: '  ' })
    expect(aiSiteStartStepErrors('kind', blank)).toEqual([{ field: 'siteType', message: 'Say what kind of site this is.', code: 'required' }])
    for (const step of ['audience', 'style', 'details'] as const) expect(aiSiteStartStepErrors(step, blank)).toEqual([])
  })

  it('does not go forward from the Style step until a card is clicked (AGL-4049)', () => {
    const unchosen = answers({ style: null, kind: null })
    expect(aiSiteStartStepErrors('style', unchosen)).toEqual([
      { field: 'style', message: AI_SITE_START_STYLE_REQUIRED, code: 'required' },
    ])
    // "Pick for me" is a card a person clicks, and it goes forward.
    expect(aiSiteStartStepErrors('style', answers({ ...aiSiteStartStyleAnswer('auto') }))).toEqual([])
    expect(aiSiteStartStepErrors('style', answers({ ...aiSiteStartStyleAnswer('trades') }))).toEqual([])
    // A review reached without one opens on the Style step.
    expect(aiSiteStartFirstInvalidStep(unchosen)).toBe('style')
    // The door would admit it; it is the questions that ask.
    expect(aiSiteStartRefusal(unchosen)).toBeNull()
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

describe('the business details each step asks (AGL-3979)', () => {
  it('asks the phone and email on Details, and offers More details on every question step', () => {
    expect(AI_SITE_START_STEP_FIELDS.details.slice(0, 2)).toEqual(['phone', 'email'])
    for (const step of ['kind', 'audience', 'style', 'details'] as const) {
      expect(AI_SITE_START_MORE_FIELDS[step].length).toBeGreaterThan(0)
      for (const field of AI_SITE_START_MORE_FIELDS[step]) expect(AI_SITE_START_STEP_FIELDS[step]).toContain(field)
    }
    expect(AI_SITE_START_MORE_FIELDS.choose).toEqual([])
    expect(AI_SITE_START_MORE_FIELDS.review).toEqual([])
  })

  it('every detail is optional, and one given is held to its rule on its own step', () => {
    expect(aiSiteStartStepErrors('details', answers())).toEqual([])
    expect(aiSiteStartStepErrors('details', answers({ phone: 'call us', email: 'nope' }))).toEqual([
      { field: 'phone', code: 'invalid', message: expect.stringMatching(/area code/) },
      { field: 'email', code: 'invalid', message: expect.stringMatching(/email address/) },
    ])
    expect(aiSiteStartStepErrors('kind', answers({ founded: '15' }))).toEqual([
      { field: 'founded', code: 'invalid', message: expect.stringMatching(/four digits/) },
    ])
    expect(aiSiteStartStepErrors('audience', answers({ languages: 'x'.repeat(200) }))[0]).toMatchObject({ field: 'languages', code: 'too_long' })
    // The review opens on the step whose detail cannot go forward, and the start says why.
    expect(aiSiteStartFirstInvalidStep(answers({ social: 'my instagram' }))).toBe('details')
    expect(aiSiteStartRefusal(answers({ social: 'my instagram' }))).toMatch(/profile/)
  })
})

describe('the Style step holds both the sites they like and its More details (AGL-3975, AGL-3979)', () => {
  it('asks the style, then the sites they like, then the brand color under More details', () => {
    // The card clicked (AGL-4049) and the kind it names, first.
    expect(AI_SITE_START_STEP_FIELDS.style).toEqual(['style', 'kind', 'inspiration', ...AI_SITE_START_MORE_FIELDS.style])
    expect(AI_SITE_START_MORE_FIELDS.style).toEqual(['brand'])
  })

  it('says each one’s reason on the Style step, the sites they like first', () => {
    expect(aiSiteStartStepErrors('style', answers({ inspiration: ['not a site'], brand: 'x'.repeat(200) }))).toEqual([
      { field: 'inspiration', code: 'invalid', message: expect.stringMatching(/https address/) },
      { field: 'brand', code: 'too_long', message: expect.stringMatching(/under/) },
    ])
    expect(aiSiteStartFirstInvalidStep(answers({ inspiration: ['https://a.example.com', 'https://b.example.com'] }), { freeTaste: true })).toBe('style')
  })
})
