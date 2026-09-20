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
 * The site's own search listing from the guided start's answers (AGL-2918):
 * what the two answers become, what they are held to, and what a reader will
 * and will not stage into somebody's live SEO form.
 */

import { SCREEN_SEO_TEXT_GUIDANCE } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { AI_SITE_INPUT_MAX_CHARS } from './ai-site-job'
import {
  AI_SITE_SEO_FORM_FIELDS,
  AI_SITE_SEO_LIMITS,
  AI_SITE_SEO_PROPOSAL_KIND,
  aiSiteSeoProposal,
  aiSiteSeoProposalForInputs,
  aiSiteSeoProposalOf,
} from './ai-site-start-seo'

const ANSWERS = {
  about: 'a neighborhood dog groomer that takes bookings',
  audience: 'local dog owners who want a regular groom booked online',
}

const values = (input: Parameters<typeof aiSiteSeoProposal>[0]) =>
  aiSiteSeoProposal(input)?.values ?? null

describe('the answers become the site’s own listing', () => {
  it('is held to the same two lengths the SEO editors guide a listing to', () => {
    expect(AI_SITE_SEO_LIMITS).toBe(SCREEN_SEO_TEXT_GUIDANCE)
    expect({ ...AI_SITE_SEO_LIMITS }).toEqual({ title: 60, description: 155 })
  })

  it('names the two fields the site SEO form edits', () => {
    expect({ ...AI_SITE_SEO_FORM_FIELDS }).toEqual({
      title: 'seo.title',
      description: 'seo.description',
    })
  })

  it('turns what kind of site it is into a title, without its article', () => {
    expect(values(ANSWERS)).toEqual({
      'seo.title': 'Neighborhood dog groomer that takes bookings',
      'seo.description':
        'Neighborhood dog groomer that takes bookings, for local dog owners who want a regular groom booked online.',
    })
  })

  it('leads with the site’s own name where the job carries one', () => {
    expect(values({ ...ANSWERS, siteName: 'Waggle' })).toEqual({
      'seo.title': 'Waggle — Neighborhood dog groomer that takes bookings',
      'seo.description':
        'Waggle is a neighborhood dog groomer that takes bookings, for local dog owners who want a regular groom booked online.',
    })
  })

  it('says what the site is when nobody said who it is for', () => {
    expect(values({ about: 'a roofing company' })).toEqual({
      'seo.title': 'Roofing company',
      'seo.description': 'Roofing company.',
    })
  })

  it('proposes nothing at all where nobody said what the site is', () => {
    // An empty title staged into a REQUIRED field is worse than no proposal:
    // the form would refuse the save and blame the person for it.
    for (const about of ['', '   ', 'a ', undefined]) {
      expect(aiSiteSeoProposal({ about, audience: ANSWERS.audience })).toBeNull()
    }
  })

  it('holds both values to their lengths, cut at a word', () => {
    const proposal = values({
      about: 'a bespoke architectural sheet metal fabricator and installer of standing seam roofing',
      audience: 'commercial general contractors across the upper midwest who bid public school work',
      siteName: 'Northwind Metalworks',
    })
    const title = proposal?.['seo.title'] ?? ''
    const description = proposal?.['seo.description'] ?? ''
    expect(title.length).toBeLessThanOrEqual(AI_SITE_SEO_LIMITS.title)
    expect(description.length).toBeLessThanOrEqual(AI_SITE_SEO_LIMITS.description)
    // Cut at a word: the last thing in each value is a whole one, which is
    // what distinguishes a clip from a truncation nobody would publish.
    expect(title).not.toMatch(/\s$/)
    expect(`${title} `).toContain(`${title.split(' ').pop()} `)
    expect(description.endsWith('…')).toBe(false)
  })

  it('closes the description with one period and never two', () => {
    expect(values({ about: 'a dog groomer.' })?.['seo.description']).toBe('Dog groomer.')
    expect(values({ about: 'a dog groomer' })?.['seo.description']).toBe('Dog groomer.')
  })

  it('keeps a capital the person typed', () => {
    expect(values({ about: 'a McKinney plumber' })?.['seo.title']).toBe('McKinney plumber')
  })
})

describe('the proposal a job’s inputs imply', () => {
  it('reads the scaffold’s own inputs, and the name where a batch gave one', () => {
    expect(
      aiSiteSeoProposalForInputs({
        businessType: ANSWERS.about,
        audience: ANSWERS.audience,
        businessName: 'Waggle',
        pages: 5,
      })?.values,
    ).toEqual(values({ ...ANSWERS, siteName: 'Waggle' }))
  })

  it('proposes nothing for a job that describes no site', () => {
    // A page job started from the Screens page has no business type at all.
    expect(aiSiteSeoProposalForInputs({ pageType: 'landing' })).toBeNull()
    expect(aiSiteSeoProposalForInputs(null)).toBeNull()
    expect(aiSiteSeoProposalForInputs({ businessType: 42 })).toBeNull()
  })

  it('reads a long answer only as far as the door would have admitted it', () => {
    const long = `a ${'x'.repeat(AI_SITE_INPUT_MAX_CHARS * 2)}`
    const proposal = aiSiteSeoProposalForInputs({ businessType: long })
    expect(proposal?.values['seo.title'].length).toBeLessThanOrEqual(AI_SITE_SEO_LIMITS.title)
  })
})

describe('what the reader will take off a job’s outputs', () => {
  const output = (proposal: unknown) => [{ resource: 'seo' as const, proposal: proposal as never }]
  const good = aiSiteSeoProposal(ANSWERS)

  it('finds the listing among a scaffold’s other outputs', () => {
    expect(
      aiSiteSeoProposalOf([
        { resource: 'screen', proposal: undefined },
        ...output(good),
      ]),
    ).toEqual(good)
  })

  it('takes nothing off outputs that carry none', () => {
    expect(aiSiteSeoProposalOf([])).toBeNull()
    expect(aiSiteSeoProposalOf(null)).toBeNull()
    expect(aiSiteSeoProposalOf([{ resource: 'screen', proposal: good as never }])).toBeNull()
  })

  it('refuses a proposal of another kind, and a half-written one', () => {
    // Every one of these would stage SOMETHING into a live SEO form. An
    // `seo` output is also what the site audit reports, and its site-wide
    // proposal is a different shape entirely.
    const refused: unknown[] = [
      { kind: 'site', site: { values: {} } },
      { kind: AI_SITE_SEO_PROPOSAL_KIND },
      { kind: AI_SITE_SEO_PROPOSAL_KIND, values: {} },
      { kind: AI_SITE_SEO_PROPOSAL_KIND, values: { 'seo.title': 'Only a title' } },
      { kind: AI_SITE_SEO_PROPOSAL_KIND, values: { 'seo.title': 'A', 'seo.description': 12 } },
      { kind: AI_SITE_SEO_PROPOSAL_KIND, values: { 'seo.title': '  ', 'seo.description': 'B' } },
      'not a record',
      null,
    ]
    for (const proposal of refused) {
      expect(aiSiteSeoProposalOf(output(proposal))).toBeNull()
    }
  })

  it('keeps only the notes that are lines', () => {
    expect(
      aiSiteSeoProposalOf(output({ ...good, notes: ['a line', 7, null] }))?.notes,
    ).toEqual(['a line'])
  })
})
