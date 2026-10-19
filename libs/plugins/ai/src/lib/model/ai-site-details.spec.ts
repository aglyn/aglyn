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
 * The business details a guided start may be given (AGL-3979): each held to
 * its own rule by the questions and the create door alike, tidied as the job
 * stores it, and told to every unit of the site job only where given.
 */

import {
  AI_SITE_DETAIL_KEYS,
  AI_SITE_DETAIL_MAX_CHARS,
  AI_SITE_NO_DETAILS,
  aiSiteContactOf,
  aiSiteDetailProblem,
  aiSiteDetailsBriefLines,
  aiSiteEmailHref,
  aiSiteHoursSentence,
  aiSitePhoneHref,
  aiSitePhoneValid,
  aiSiteSocialLinks,
  parseAiSiteDetails,
} from './ai-site-details'
import { parseAiSiteJobInputs } from './ai-site-job'

const NOW = new Date('2026-10-19T12:00:00Z')

describe('a phone number', () => {
  it('reads with its area code and the usual separators, in any country', () => {
    for (const phone of ['(512) 555-0142', '512.555.0142', '+1 512 555 0142', '+44 20 7946 0958', '020 7946 0958']) {
      expect(aiSitePhoneValid(phone)).toBe(true)
    }
  })

  it('is refused as letters, a short run, or a plus anywhere but first', () => {
    for (const phone of ['call us', '555-01', '512+555+0142', '1234567890123456', 'tel:5125550142']) {
      expect(aiSitePhoneValid(phone)).toBe(false)
    }
    expect(aiSiteDetailProblem('phone', 'call us')).toEqual({ code: 'invalid', message: expect.stringMatching(/area code/) })
  })

  it('links the digits as given, with a plus only where typed: no country is guessed', () => {
    expect(aiSitePhoneHref('(512) 555-0142')).toBe('tel:5125550142')
    expect(aiSitePhoneHref('+44 20 7946 0958')).toBe('tel:+442079460958')
    expect(aiSitePhoneHref('nope')).toBe('')
  })
})

describe('an email address', () => {
  it('reads as one, and links as mailto', () => {
    expect(aiSiteDetailProblem('email', 'hello@harborline.co')).toBeNull()
    expect(aiSiteEmailHref(' hello@harborline.co ')).toBe('mailto:hello@harborline.co')
  })

  it('is refused without an @, a domain, or with spaces', () => {
    for (const email of ['hello', 'hello@', 'hello@harborline', 'he llo@harborline.co', '<a>@b.co']) {
      expect(aiSiteDetailProblem('email', email)?.code).toBe('invalid')
    }
  })
})

describe('the other details', () => {
  it('a year founded is four digits, never in the future', () => {
    expect(aiSiteDetailProblem('founded', '2015', { now: NOW })).toBeNull()
    expect(aiSiteDetailProblem('founded', '15', { now: NOW })?.code).toBe('invalid')
    expect(aiSiteDetailProblem('founded', '2031', { now: NOW })?.code).toBe('invalid')
  })

  it('profile links are https pages, typed with or without their scheme, each once', () => {
    expect(aiSiteSocialLinks('instagram.com/harborline\nhttps://www.facebook.com/harborline, http://x.com/harbor\nINSTAGRAM.com/harborline')).toEqual([
      'https://instagram.com/harborline',
      'https://www.facebook.com/harborline',
      'https://x.com/harbor',
    ])
    expect(aiSiteSocialLinks('my instagram')).toBeNull()
    expect(aiSiteDetailProblem('social', 'my instagram')?.code).toBe('invalid')
  })

  it('opening hours read as a person says them', () => {
    expect(aiSiteHoursSentence('Mo-Fr 09:00-17:30\nSa 10:00-14:00')).toBe('Mon–Fri 9am–5:30pm; Sat 10am–2pm')
    expect(aiSiteHoursSentence('Mo,We 12:00-00:00')).toBe('Mon, Wed 12pm–12am')
  })

  it('every detail is held to its length, and none is required', () => {
    for (const key of AI_SITE_DETAIL_KEYS) {
      expect(aiSiteDetailProblem(key, '')).toBeNull()
      expect(aiSiteDetailProblem(key, 'x'.repeat(AI_SITE_DETAIL_MAX_CHARS[key] + 1))?.code).toBe('too_long')
    }
    const total = Object.values(AI_SITE_DETAIL_MAX_CHARS).reduce((sum, max) => sum + max, 0)
    // Far under the jobs route's 8,000-character cap on a job's inputs.
    expect(total).toBeLessThan(4_000)
  })
})

describe('the create door reads the details (parseAiSiteJobInputs)', () => {
  const base = { businessType: 'a plumber', pages: 5 }

  it('admits a start with none, every one empty', () => {
    const parsed = parseAiSiteJobInputs(base)
    expect(typeof parsed).not.toBe('string')
    expect(parsed).toMatchObject(AI_SITE_NO_DETAILS)
  })

  it('keeps each one tidied: links and areas one a line, only the hours that read', () => {
    const parsed = parseAiSiteDetails({
      phone: ' (512) 555-0142 ',
      email: 'hello@pipeworks.co',
      social: 'instagram.com/pipeworks, facebook.com/pipeworks',
      serviceArea: 'Austin, Round Rock\nAustin',
      hours: 'Mo-Fr 08:00-18:00\nwhenever',
    })
    expect(parsed).toMatchObject({
      phone: '(512) 555-0142',
      email: 'hello@pipeworks.co',
      social: 'https://instagram.com/pipeworks\nhttps://facebook.com/pipeworks',
      serviceArea: 'Austin\nRound Rock',
      hours: 'Mo-Fr 08:00-18:00',
    })
  })

  it('refuses one that breaks its rule, naming it', () => {
    expect(parseAiSiteJobInputs({ ...base, phone: 'call us' })).toMatch(/^phone: /)
    expect(parseAiSiteJobInputs({ ...base, email: 'nope' })).toMatch(/^email: /)
    expect(parseAiSiteJobInputs({ ...base, social: 'not a link' })).toMatch(/^social: /)
    expect(parseAiSiteJobInputs({ ...base, founded: 'long ago' })).toMatch(/^founded: /)
    expect(parseAiSiteJobInputs({ ...base, tagline: 42 })).toMatch(/^tagline: /)
  })
})

describe('what the site job is told', () => {
  it('nothing more, for a start with no details', () => {
    expect(aiSiteDetailsBriefLines(AI_SITE_NO_DETAILS)).toEqual([])
    expect(aiSiteContactOf({})).toBeNull()
  })

  it('the contact, place and hours, the rest, and that the pages show the phone and email as written', () => {
    const lines = aiSiteDetailsBriefLines(
      {
        ...AI_SITE_NO_DETAILS,
        phone: '(512) 555-0142',
        email: 'hello@pipeworks.co',
        street: '214 Main Street',
        region: 'TX',
        postalCode: '78701',
        hours: 'Mo-Fr 08:00-18:00',
        tagline: 'Fixed right the first time',
        serviceArea: 'Austin\nRound Rock',
        social: 'https://instagram.com/pipeworks',
      },
      { city: 'Austin' },
    )
    expect(lines).toEqual([
      'Contact — phone: (512) 555-0142; email: hello@pipeworks.co; address: 214 Main Street, Austin, TX 78701; hours: Mon–Fri 8am–6pm.',
      'About the business — tagline: Fixed right the first time; serves: Austin, Round Rock; profiles: https://instagram.com/pipeworks.',
      expect.stringContaining('Show the phone number and email exactly as written'),
    ])
    expect(lines[2]).toContain('a link that calls goes to "phone" and a link that writes goes to "email"')
  })

  it('the links a page makes from them', () => {
    expect(aiSiteContactOf({ phone: '(512) 555-0142', email: 'bad' })).toEqual({
      phone: '(512) 555-0142',
      phoneHref: 'tel:5125550142',
      email: '',
      emailHref: '',
    })
  })
})
