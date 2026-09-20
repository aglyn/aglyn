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
 * The guided start's question set (AGL-2918): what it asks, what it refuses,
 * and that its answers are a `site` job the existing door admits — the whole
 * point of the flow being questions in front of a generator rather than a
 * second generator.
 */

import { STARTER_TEMPLATES } from '@aglyn/aglyn/app-utils/starter-templates'
import {
  AI_SITE_INPUT_MAX_CHARS,
  AI_SITE_PAGES,
  AI_SITE_SUBMISSIONS,
  parseAiSiteJobInputs,
} from './ai-site-job'
import {
  AI_SITE_START_ANSWERS,
  AI_SITE_START_EXAMPLES,
  AI_SITE_START_SUBMISSIONS,
  AI_SITE_START_TYPES,
  aiSiteStartBrief,
  aiSiteStartExample,
  aiSiteStartInputs,
  aiSiteStartRefusal,
  type AiSiteStartAnswers,
} from './ai-site-start'

const answered = (patch: Partial<AiSiteStartAnswers> = {}): AiSiteStartAnswers => ({
  ...AI_SITE_START_ANSWERS,
  siteType: 'a neighborhood dog groomer',
  ...patch,
})

describe('the examples are the platform’s own starters', () => {
  it('names a starter that exists, by the id and the name the catalog uses', () => {
    for (const example of AI_SITE_START_EXAMPLES) {
      const starter = STARTER_TEMPLATES.find((entry) => entry.id === example.id)
      expect(`${example.id}: ${Boolean(starter)}`).toBe(`${example.id}: true`)
      expect(starter?.displayName).toBe(example.label)
      expect(starter?.category).toBe(example.category)
    }
  })

  it('offers every starter the catalog holds, so none is quietly unofferable', () => {
    expect(AI_SITE_START_EXAMPLES.map((example) => example.id).sort()).toEqual(
      STARTER_TEMPLATES.map((starter) => starter.id).sort(),
    )
  })

  it('reads back the example an answer names, and nothing it does not', () => {
    expect(aiSiteStartExample(answered({ example: 'business' }))?.label).toBe('Business')
    expect(aiSiteStartExample(answered({ example: null }))).toBeNull()
    expect(aiSiteStartExample(answered({ example: 'no-such-starter' }))).toBeNull()
  })
})

describe('what the start refuses to send', () => {
  it('starts on defaults that are already inside the scaffold’s band', () => {
    expect(AI_SITE_START_ANSWERS.pages).toBeGreaterThanOrEqual(AI_SITE_PAGES.min)
    expect(AI_SITE_START_ANSWERS.pages).toBeLessThanOrEqual(AI_SITE_PAGES.max)
    expect(AI_SITE_START_ANSWERS.welcomeEmail).toBe(true)
  })

  it('asks only for what kind of site it is', () => {
    expect(aiSiteStartRefusal(AI_SITE_START_ANSWERS)).toMatch(/what kind of site/)
    // Nothing else answered, and it is ready: the audience, the example, the
    // page count and the email are all defaults or optional.
    expect(aiSiteStartRefusal(answered())).toBeNull()
  })

  it('refuses an answer longer than a few words, and a page count outside the band', () => {
    expect(aiSiteStartRefusal(answered({ siteType: 'x'.repeat(AI_SITE_INPUT_MAX_CHARS + 1) }))).toMatch(
      /what kind of site this is under/,
    )
    expect(aiSiteStartRefusal(answered({ audience: 'x'.repeat(AI_SITE_INPUT_MAX_CHARS + 1) }))).toMatch(
      /who the site is for under/,
    )
    expect(aiSiteStartRefusal(answered({ pages: AI_SITE_PAGES.min - 1 }))).toMatch(
      new RegExp(`${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max}`),
    )
    expect(aiSiteStartRefusal(answered({ pages: 4.5 }))).toMatch(/pages/)
    expect(aiSiteStartRefusal(answered({ example: 'no-such-starter' }))).toMatch(/examples/)
  })

  it('offers kinds of site as suggestions rather than a list to choose from', () => {
    expect(AI_SITE_START_TYPES.length).toBeGreaterThan(0)
    // Each fills the box, so each must be an answer the box would accept.
    for (const type of AI_SITE_START_TYPES) {
      expect(aiSiteStartRefusal(answered({ siteType: type }))).toBeNull()
    }
  })
})

describe('the answers are a site job the door already admits', () => {
  it('parses as scaffold inputs, with the audience and the example carried', () => {
    const inputs = aiSiteStartInputs(
      answered({ audience: ' local dog owners ', example: 'business', pages: 6 }),
    )
    expect(parseAiSiteJobInputs({ ...inputs, batchId: null })).toEqual({
      businessType: 'a neighborhood dog groomer',
      audience: 'local dog owners',
      starter: 'business',
      pages: 6,
      businessName: '',
      city: '',
      brand: '',
      submissions: 'inbox',
      welcomeEmail: true,
      batchId: null,
    })
  })

  it('leaves the per-site variables an agency batch fills empty', () => {
    const inputs = aiSiteStartInputs(answered())
    expect([inputs.businessName, inputs.city, inputs.brand]).toEqual(['', '', ''])
  })

  it('carries the welcome email off when it was turned off', () => {
    const inputs = aiSiteStartInputs(answered({ welcomeEmail: false }))
    const parsed = parseAiSiteJobInputs(inputs)
    expect(typeof parsed === 'string' ? parsed : parsed.welcomeEmail).toBe(false)
  })

  it('writes a brief that says what was answered and asks nothing that was not', () => {
    const brief = aiSiteStartBrief(
      answered({ audience: 'local dog owners', example: 'business', pages: 6 }),
    )
    expect(brief).toContain('6-page website for a neighborhood dog groomer')
    expect(brief).toContain('It is for local dog owners.')
    expect(brief).toContain('Business starter')
    expect(brief).toContain('contact form')
  })

  it('leaves out the sentences whose questions went unanswered', () => {
    const brief = aiSiteStartBrief(answered())
    expect(brief).toContain('a neighborhood dog groomer')
    expect(brief).not.toContain('It is for')
    expect(brief).not.toContain('starter')
  })

  /*
   * Who fills the contact form in (AGL-2918). The audience used to be said
   * once, in a sentence about who the PAGES are written for, which left the
   * form to pick its fields off a brief that never mentioned it.
   */
  it('asks the contact form for what the audience would be asked for', () => {
    expect(aiSiteStartBrief(answered({ audience: 'local dog owners' }))).toContain(
      'Ask the contact form for what local dog owners would be asked for.',
    )
  })

  it('says nothing about the form’s fields when nobody said who it is for', () => {
    expect(aiSiteStartBrief(answered())).not.toContain('Ask the contact form')
  })
})

describe('where the contact form’s submissions go', () => {
  it('offers exactly the answers the form step can bind, and no third', () => {
    // The form step's own vocabulary has a mailing list, which it can only
    // answer with a note: offering it would be asking for an outcome the
    // stored routing has no place for.
    expect(AI_SITE_START_SUBMISSIONS.map((option) => option.id)).toEqual([...AI_SITE_SUBMISSIONS])
    for (const option of AI_SITE_START_SUBMISSIONS) {
      expect(aiSiteStartRefusal(answered({ submissions: option.id }))).toBeNull()
    }
  })

  it('starts on the Inbox, and carries whatever was answered onto the job', () => {
    expect(AI_SITE_START_ANSWERS.submissions).toBe('inbox')
    expect(aiSiteStartInputs(answered()).submissions).toBe('inbox')
    expect(aiSiteStartInputs(answered({ submissions: 'lead' })).submissions).toBe('lead')
  })

  it('refuses an answer the form step could not bind', () => {
    expect(
      aiSiteStartRefusal(answered({ submissions: 'carrier pigeon' as never })),
    ).toMatch(/submissions go/)
  })

  it('reaches the door as an input it admits', () => {
    const parsed = parseAiSiteJobInputs(aiSiteStartInputs(answered({ submissions: 'lead' })))
    expect(typeof parsed === 'string' ? parsed : parsed.submissions).toBe('lead')
  })
})
