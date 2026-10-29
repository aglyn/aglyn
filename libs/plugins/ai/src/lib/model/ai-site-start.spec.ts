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
import * as start from './ai-site-start'
import * as copy from './ai-job-failure-copy'
import {
  AI_SITE_INPUT_MAX_CHARS,
  AI_SITE_PAGES,
  AI_SITE_SUBMISSION_CHOICES,
  AI_SITE_SUBMISSIONS,
  parseAiSiteJobInputs,
} from './ai-site-job'
import { AI_SITE_NO_DETAILS } from './ai-site-details'
import { AI_SITE_KINDS } from './ai-site-kinds'
import { aiSiteKindDefaultLook } from './ai-site-look'
import {
  AI_SITE_START_ANSWERS,
  AI_SITE_START_EXAMPLES,
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
      ...AI_SITE_NO_DETAILS,
      businessType: 'a neighborhood dog groomer',
      audience: 'local dog owners',
      starter: 'business',
      siteKind: 'business',
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
    expect(AI_SITE_SUBMISSION_CHOICES.map((option) => option.id)).toEqual([...AI_SITE_SUBMISSIONS])
    for (const option of AI_SITE_SUBMISSION_CHOICES) {
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

describe('a failed start reopens on its own answers (AGL-3596)', () => {
  it('reads the job’s inputs back into the questions, and back again into the same inputs', () => {
    const answers = {
      ...AI_SITE_START_ANSWERS,
      siteType: 'dog grooming salon',
      audience: 'dog owners in Hillside',
      example: 'business',
      // A start that ran had its style chosen (AGL-4049); it comes back chosen.
      style: 'business',
      kind: 'business',
      pages: 2,
      submissions: 'lead' as const,
      welcomeEmail: false,
    }
    const inputs = start.aiSiteStartInputs(answers)
    expect(start.aiSiteStartAnswersFromInputs({ ...inputs, autoConfirm: true, originJobId: 'x' }, { freeTaste: true })).toEqual(answers)
    // Only the site's answers travel on the summary.
    expect(start.aiSiteStartInputsOf({ ...inputs, autoConfirm: true, batchId: 'b' })).toEqual(inputs)
  })

  it('holds what it reads to the questions and the workspace’s band', () => {
    expect(start.aiSiteStartAnswersFromInputs({ businessType: '' })).toBeNull()
    expect(start.aiSiteStartAnswersFromInputs({ businessType: 'a cafe', pages: 6, starter: 'gone', submissions: 'nowhere' }, { freeTaste: true })).toEqual({
      ...AI_SITE_START_ANSWERS,
      siteType: 'a cafe',
      audience: '',
      example: null,
      // No kind to read back: it reopens on "Pick for me", chosen (AGL-4049).
      style: 'auto',
      kind: null,
      pages: 2,
      submissions: 'inbox',
      welcomeEmail: false,
    })
  })

  it('offers the starter on a failed start whose only output is its listing proposal', () => {
    const failed = {
      kind: 'site' as const,
      status: 'failed' as const,
      hostId: 'host-1',
      review: null,
      outputs: [{ resource: 'seo', id: 'site:listing', hostId: 'host-1', label: 'Listing' }],
    }
    expect(copy.aiSiteStarterFallbackOffered(failed as never)).toBe(true)
    expect(
      copy.aiSiteStarterFallbackOffered({ ...failed, outputs: [...failed.outputs, { resource: 'layout', id: 'l', hostId: 'host-1', label: 'L' }] } as never),
    ).toBe(false)
  })

  it('says what became of the credits from the job’s record alone', () => {
    expect(copy.aiJobRefundCopy({ status: 'failed', creditsSpent: 102, refundedCredits: 102 })).toBe(
      'This one’s on us — you weren’t charged. The 102 credits it used are back in your AI credits.',
    )
    expect(copy.aiJobRefundCopy({ status: 'failed', creditsSpent: 40, refundedCredits: 1 })).toBe(
      'This one’s on us — you weren’t charged for the part that failed. The 1 credit it used is back in your AI credits.',
    )
    expect(copy.aiJobRefundCopy({ status: 'canceled', creditsSpent: 13 })).toBe('This job used 13 credits before it stopped.')
    expect(copy.aiJobRefundCopy({ status: 'failed', creditsSpent: 13 })).toBeNull()
  })
})

describe('a failed start keeps its business details (AGL-3979)', () => {
  it('reads every detail back into the questions, and back again into the same inputs', () => {
    const answers = {
      ...AI_SITE_START_ANSWERS,
      siteType: 'a family plumbing company',
      phone: '(512) 555-0142',
      email: 'hello@pipeworks.co',
      tagline: 'Fixed right the first time',
      founded: '2009',
      serviceArea: 'Austin\nRound Rock',
      priceRange: '$$',
      languages: 'English, Spanish',
      brand: '#1565c0',
      street: '214 Main Street',
      city: 'Austin',
      region: 'TX',
      postalCode: '78701',
      country: 'US',
      hours: 'Mo-Fr 08:00-18:00',
      social: 'https://instagram.com/pipeworks',
    }
    const inputs = start.aiSiteStartInputs(answers)
    expect(parseAiSiteJobInputs(inputs)).toMatchObject({ phone: '(512) 555-0142', email: 'hello@pipeworks.co', city: 'Austin' })
    // The summary a failed start carries back holds every detail.
    const summary = start.aiSiteStartInputsOf({ ...inputs, autoConfirm: true })
    // The kind and example come back as the kind the words suggested; every detail as given.
    expect(start.aiSiteStartAnswersFromInputs(summary)).toEqual({
      ...answers,
      example: expect.anything(),
      style: expect.any(String),
      kind: expect.any(String),
    })
  })

  it('sends a detail only where it was given, so a start without them asks the plan nothing new', () => {
    const inputs = start.aiSiteStartInputs({ ...AI_SITE_START_ANSWERS, siteType: 'a bakery', phone: ' ', email: 'hi@bakery.co' })
    expect(inputs).not.toHaveProperty('phone')
    expect(inputs).toMatchObject({ email: 'hi@bakery.co' })
    expect(start.aiSiteStartExtrasGiven({ ...AI_SITE_START_ANSWERS, siteType: 'x', email: 'hi@bakery.co', hours: 'Mo 09:00-17:00' })).toEqual([
      'email',
      'hours',
    ])
  })
})

describe('a start with business details and sites it likes carries both (AGL-3979, AGL-3975)', () => {
  const answers = {
    ...AI_SITE_START_ANSWERS,
    siteType: 'a family plumbing company',
    phone: '(512) 555-0142',
    email: 'hello@pipeworks.co',
    brand: '#1565c0',
    inspiration: ['https://pipes.example.com/', 'https://drains.example.com/'],
  }

  it('sends both, the door admits both, and a failed start reopens on both', () => {
    const inputs = start.aiSiteStartInputs(answers)
    expect(inputs).toMatchObject({
      phone: '(512) 555-0142',
      email: 'hello@pipeworks.co',
      brand: '#1565c0',
      inspiration: 'https://pipes.example.com/ https://drains.example.com/',
    })
    expect(parseAiSiteJobInputs(inputs)).toMatchObject({
      phone: '(512) 555-0142',
      email: 'hello@pipeworks.co',
      inspiration: ['https://pipes.example.com/', 'https://drains.example.com/'],
    })
    const summary = start.aiSiteStartInputsOf({ ...inputs, autoConfirm: true })
    expect(summary).toMatchObject({ phone: '(512) 555-0142', inspiration: 'https://pipes.example.com/ https://drains.example.com/' })
    expect(start.aiSiteStartAnswersFromInputs(summary)).toEqual({
      ...answers,
      example: expect.anything(),
      style: expect.any(String),
      kind: expect.any(String),
    })
  })

  it('refuses either one on its own rule', () => {
    expect(aiSiteStartRefusal(answers)).toBeNull()
    expect(aiSiteStartRefusal({ ...answers, phone: 'call us' })).toMatch(/area code/)
    expect(aiSiteStartRefusal({ ...answers, inspiration: ['not a site'] })).toMatch(/https address/)
    // A Free workspace names one site; the details stay its own to give.
    expect(aiSiteStartRefusal({ ...answers, pages: 2 }, { freeTaste: true })).toMatch(/Free workspace/)
  })
})

describe('a style card clicked (AGL-4049)', () => {
  it('starts with nothing chosen', () => {
    expect(AI_SITE_START_ANSWERS.style).toBeNull()
    expect(AI_SITE_START_ANSWERS.kind).toBeNull()
  })

  it('holds the card as the style and the kind it names; "Pick for me" names none', () => {
    expect(start.aiSiteStartStyleAnswer('trades')).toEqual({ style: 'trades', kind: 'trades' })
    expect(start.aiSiteStartStyleAnswer('auto')).toEqual({ style: 'auto', kind: null })
    // "Pick for me" leaves the kind to what the site is.
    const picked = { ...AI_SITE_START_ANSWERS, siteType: 'a roofing company', ...start.aiSiteStartStyleAnswer('auto') }
    expect(start.aiSiteStartKind(picked).id).toBe('trades')
    // A card names the kind outright.
    const chosen = { ...picked, ...start.aiSiteStartStyleAnswer('yoga') }
    expect(start.aiSiteStartKind(chosen).id).toBe('yoga')
  })

  it('reopens a start that ran on its style, chosen', () => {
    const inputs = start.aiSiteStartInputs({ ...AI_SITE_START_ANSWERS, siteType: 'a bakery', ...start.aiSiteStartStyleAnswer('restaurant') })
    expect(start.aiSiteStartAnswersFromInputs(inputs)).toMatchObject({ style: 'restaurant', kind: 'restaurant' })
  })
})

/**
 * An AI starter picked in "Choose your starter" (AGL-4049 phase 4): the
 * answers its listing carries become the questions' answers, every one of
 * them the person's to change. The fixture is built the way the platform's
 * own `fp-starter-{kind}-ai` listings are (`first-party-starters.mjs`), from
 * the one derivation both use: `aiSiteKindDefaultLook`.
 */
describe('an AI starter’s answers fill the questions (AGL-4049)', () => {
  const kindOf = (id: string) => {
    const kind = AI_SITE_KINDS.find((entry) => entry.id === id)
    if (!kind) throw new Error(`no kind ${id}`)
    return kind
  }
  /** What the seed writes on a kind's AI starter: kind, style, fonts, brand colors, pages, brief. */
  const seeded = (id: string, patch: Record<string, unknown> = {}) => {
    const kind = kindOf(id)
    const look = aiSiteKindDefaultLook(kind, { presetIds: new Set(['theme-presets.material3', 'theme-presets.bootstrap']) })
    return {
      kind: kind.id,
      style: look.answerStyle,
      fonts: look.theme.fonts,
      brandColors: look.theme.brand.light,
      pages: kind.pages,
      brief: '',
      ...patch,
    }
  }

  it('chooses the starter’s style, and keeps its brand color as the brand answer', () => {
    const answers = seeded('restaurant')
    const mapped = start.aiSiteStartAnswersFromStarter(answers)
    expect(mapped).toMatchObject({ style: 'restaurant', kind: 'restaurant' })
    const primary = (answers.brandColors as Record<string, string>)['primary']
    expect(primary).toMatch(/^#[0-9a-f]{6}$/i)
    expect(mapped.brand).toBe(primary.toLowerCase())
  })

  it('leaves what a site is FOR to the person when the starter gives no brief, and every other answer at its start', () => {
    const mapped = start.aiSiteStartAnswersFromStarter(seeded('restaurant'))
    expect(mapped).toEqual({
      ...AI_SITE_START_ANSWERS,
      style: 'restaurant',
      kind: 'restaurant',
      brand: mapped.brand,
    })
    // So the questions still ask the one answer with no default.
    expect(aiSiteStartRefusal(mapped)).toBe('Say what kind of site this is.')
    expect(aiSiteStartRefusal({ ...mapped, siteType: 'a corner bistro' })).toBeNull()
  })

  it('takes a brief as what the site is for, held to the length the question allows', () => {
    expect(start.aiSiteStartAnswersFromStarter(seeded('restaurant', { brief: '  a corner bistro  ' })).siteType).toBe(
      'a corner bistro',
    )
    const long = start.aiSiteStartAnswersFromStarter(seeded('restaurant', { brief: 'word '.repeat(60) })).siteType
    expect(long.length).toBeLessThanOrEqual(AI_SITE_INPUT_MAX_CHARS)
    expect(long.endsWith(' ')).toBe(false)
  })

  it('a kind that suits any hue names no brand color, and the style chooses one', () => {
    const anyHue = AI_SITE_KINDS.find((kind) => kind.look.hues.some(([from, to]) => from === 0 && to === 360))
    expect(anyHue).toBeTruthy()
    const mapped = start.aiSiteStartAnswersFromStarter(seeded(anyHue!.id))
    expect(mapped).toMatchObject({ style: anyHue!.id, brand: '' })
  })

  it('takes a page count, held to the workspace’s band, and ignores a description of the pages', () => {
    expect(start.aiSiteStartAnswersFromStarter(seeded('restaurant')).pages).toBe(AI_SITE_START_ANSWERS.pages)
    expect(start.aiSiteStartAnswersFromStarter(seeded('restaurant', { pages: 6 })).pages).toBe(6)
    expect(start.aiSiteStartAnswersFromStarter(seeded('restaurant', { pages: 99 })).pages).toBe(AI_SITE_PAGES.max)
    expect(start.aiSiteStartAnswersFromStarter(seeded('restaurant', { pages: 0 })).pages).toBe(AI_SITE_PAGES.min)
    expect(start.aiSiteStartAnswersFromStarter(seeded('restaurant', { pages: 2.5 })).pages).toBe(AI_SITE_START_ANSWERS.pages)
    expect(start.aiSiteStartAnswersFromStarter(seeded('restaurant', { pages: 6 }), { freeTaste: true }).pages).toBe(2)
  })

  it('chooses nothing for a kind this deployment does not know, nor a brand that is not a color', () => {
    const mapped = start.aiSiteStartAnswersFromStarter(
      seeded('restaurant', { kind: 'nope', brandColors: { primary: 'tomato' } }),
    )
    expect(mapped).toMatchObject({ style: null, kind: null, brand: '' })
  })

  it('drops every key a starter does not carry, and reads anything that is not answers as none', () => {
    const mapped = start.aiSiteStartAnswersFromStarter(
      seeded('restaurant', {
        siteType: 'not a starter key',
        audience: 'nor this',
        businessName: 'Somebody',
        phone: '+1 555 0100',
        welcomeEmail: false,
        submissions: 'leads',
      }),
    )
    expect(mapped).toMatchObject({
      siteType: '',
      audience: '',
      phone: '',
      welcomeEmail: AI_SITE_START_ANSWERS.welcomeEmail,
      submissions: AI_SITE_START_ANSWERS.submissions,
    })
    expect(mapped).not.toHaveProperty('businessName')
    for (const value of [null, undefined, 'answers', 7, ['restaurant']]) {
      expect(start.aiSiteStartAnswersFromStarter(value as never)).toEqual(AI_SITE_START_ANSWERS)
    }
  })

  it('becomes a job the door admits once the person says what the site is for', () => {
    const mapped = { ...start.aiSiteStartAnswersFromStarter(seeded('restaurant', { pages: 6 })), siteType: 'a corner bistro' }
    const inputs = parseAiSiteJobInputs(aiSiteStartInputs(mapped))
    expect(inputs).toMatchObject({ siteKind: 'restaurant', pages: 6, brand: mapped.brand })
  })
})
