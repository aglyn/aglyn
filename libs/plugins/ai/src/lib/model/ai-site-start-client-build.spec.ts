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

import { AI_SITE_INPUT_MAX_CHARS } from './ai-site-job'
import {
  AI_SITE_START_ANSWERS,
  aiSiteStartAnswersFromClientBuild,
  aiSiteStartClientBrief,
  aiSiteStartClientInputs,
  aiSiteStartClientNote,
} from './ai-site-start'

const INTAKE = {
  businessName: 'Harbor Plumbing',
  whatTheyDo: 'a family plumbing business',
  towns: 'Austin and Round Rock',
  phone: '(512) 555-0123',
  email: 'owner@example.com',
  hours: 'Mon–Fri 8–5',
  ownerWords: 'Three generations   fixing pipes\nthe right way.',
}
const EMPTY = { businessName: '', whatTheyDo: '', towns: '', phone: '', email: '', hours: '', ownerWords: '' }

describe('the guided start for a client build (AGL-3958)', () => {
  it('answers the first question with what the business does, and keeps every other default', () => {
    expect(aiSiteStartAnswersFromClientBuild(INTAKE)).toEqual({
      ...AI_SITE_START_ANSWERS,
      siteType: 'a family plumbing business',
    })
  })

  it('fills the name and the place the questions leave empty, within the inputs’ bound', () => {
    expect(aiSiteStartClientInputs(INTAKE)).toEqual({ businessName: 'Harbor Plumbing', city: 'Austin and Round Rock' })
    const long = aiSiteStartClientInputs({ ...INTAKE, towns: 'Austin, '.repeat(30) })
    expect(long.city.length).toBeLessThanOrEqual(AI_SITE_INPUT_MAX_CHARS)
  })

  it('adds how to reach the business, its hours and the owner’s words to the brief', () => {
    expect(aiSiteStartClientBrief(INTAKE)).toBe(
      'The business is called Harbor Plumbing. It serves Austin and Round Rock. Visitors reach it to call ' +
        '(512) 555-0123 or email owner@example.com; say so wherever the site tells them how to get in touch. ' +
        'Its hours are Mon–Fri 8–5. In the owner\'s own words: "Three generations fixing pipes the right way." ' +
        'Write the copy so it sounds like them.',
    )
  })

  it('says nothing for an answer that was not given', () => {
    expect(aiSiteStartClientBrief(EMPTY)).toBe('')
    expect(aiSiteStartClientBrief({ ...EMPTY, email: 'owner@example.com' })).toBe(
      'Visitors reach it to email owner@example.com; say so wherever the site tells them how to get in touch.',
    )
  })

  it('tells the review what the intake adds', () => {
    expect(aiSiteStartClientNote(INTAKE)).toBe(
      'Also from the client’s details: Harbor Plumbing, serving Austin and Round Rock, its phone, email and ' +
        'hours, and the owner\'s own words.',
    )
    expect(aiSiteStartClientNote({ ...EMPTY, businessName: 'Harbor Plumbing' })).toBe(
      'Also from the client’s details: Harbor Plumbing.',
    )
    expect(aiSiteStartClientNote(EMPTY)).toBe('Built from the client’s details.')
  })
})
