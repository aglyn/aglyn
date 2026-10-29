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

import { weeklyHoursFromText, weeklyHoursToText } from '@aglyn/shared-ui-jsx/utils/weekly-hours'
import { aiSiteHoursSentence, parseAiSiteDetails } from './ai-site-details'
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
  it('answers the first question with what the business does, fills the details, and keeps every other default', () => {
    expect(aiSiteStartAnswersFromClientBuild(INTAKE)).toEqual({
      ...AI_SITE_START_ANSWERS,
      siteType: 'a family plumbing business',
      // The site exists and the intake answered for it: what the business
      // does picks its style, as "Pick for me" does (AGL-4049).
      style: 'auto',
      kind: null,
      phone: '(512) 555-0123',
      email: 'owner@example.com',
      serviceArea: 'Austin\nRound Rock',
      // "8–5" does not say which 8 or which 5: left out, never guessed at.
      hours: '',
    })
  })

  it('fills the name and the place the questions leave empty, within the inputs’ bound', () => {
    expect(aiSiteStartClientInputs(INTAKE)).toEqual({ businessName: 'Harbor Plumbing', city: 'Austin and Round Rock' })
    const long = aiSiteStartClientInputs({ ...INTAKE, towns: 'Austin, '.repeat(30) })
    expect(long.city.length).toBeLessThanOrEqual(AI_SITE_INPUT_MAX_CHARS)
  })

  it('with no address given, the towns are the place (AGL-3995)', () => {
    const answers = aiSiteStartAnswersFromClientBuild(INTAKE)
    expect(answers).toMatchObject({ street: '', postalCode: '', city: '' })
    expect(aiSiteStartClientInputs(INTAKE, answers).city).toBe('Austin and Round Rock')
  })

  it('with a street or a postal code, the place is that address’s own city, never the towns (AGL-3995)', () => {
    const answers = aiSiteStartAnswersFromClientBuild(INTAKE)
    expect(aiSiteStartClientInputs(INTAKE, { ...answers, street: '214 Main Street', city: 'Round Rock' }).city).toBe(
      'Round Rock',
    )
    expect(aiSiteStartClientInputs(INTAKE, { ...answers, postalCode: '78701', city: ' Austin ' }).city).toBe('Austin')
    // An address without its city names no city at all, rather than the towns.
    expect(aiSiteStartClientInputs(INTAKE, { ...answers, street: '214 Main Street' }).city).toBe('')
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

  it('tells the review what the intake adds beyond the review’s own rows', () => {
    // The phone, email, towns and hours are Details rows on the review
    // (AGL-3995): the note says only what no row does.
    expect(aiSiteStartClientNote(INTAKE)).toBe('Also from the client’s details: Harbor Plumbing and the owner\'s own words.')
    expect(aiSiteStartClientNote({ ...EMPTY, businessName: 'Harbor Plumbing', phone: '(512) 555-0123' })).toBe(
      'Also from the client’s details: Harbor Plumbing.',
    )
    expect(aiSiteStartClientNote({ ...EMPTY, ownerWords: 'Fixing pipes.' })).toBe(
      'Also from the client’s details: the owner\'s own words.',
    )
    expect(aiSiteStartClientNote(EMPTY)).toBe('Built from the client’s details.')
  })
})

describe('the client build’s details on the Details step (AGL-3995, AGL-3979)', () => {
  const answers = (patch: Partial<typeof INTAKE>) => aiSiteStartAnswersFromClientBuild({ ...EMPTY, ...patch })

  it('fills the phone and the email the Details step asks for, as the owner gave them', () => {
    expect(answers({ phone: ' +44 20  7946 0958 ', email: ' owner@example.com ' })).toMatchObject({
      phone: '+44 20 7946 0958',
      email: 'owner@example.com',
    })
  })

  it('leaves a phone or an email the Details step would refuse empty, and the brief still says it', () => {
    const intake = { ...EMPTY, phone: '555-01', email: 'owner@example' }
    expect(aiSiteStartAnswersFromClientBuild(intake)).toMatchObject({ phone: '', email: '' })
    expect(aiSiteStartClientBrief(intake)).toContain('call 555-01 or email owner@example')
  })

  it('serves each town on a line of its own, as "Areas you serve" holds them', () => {
    expect(answers({ towns: 'Austin, Round Rock and Pflugerville' }).serviceArea).toBe(
      'Austin\nRound Rock\nPflugerville',
    )
    expect(answers({ towns: 'Austin, Round Rock, and Leander' }).serviceArea).toBe('Austin\nRound Rock\nLeander')
    expect(answers({ towns: 'Austin; austin & Kyle' }).serviceArea).toBe('Austin\nKyle')
    expect(answers({ towns: '' }).serviceArea).toBe('')
    // The town as the job's place is unchanged: the city input still carries it.
    expect(aiSiteStartClientInputs({ ...INTAKE, towns: 'Austin and Kyle' }).city).toBe('Austin and Kyle')
  })

  it('writes the hours exactly as the Details step’s hours picker does, so the review reads them back', () => {
    const hours = answers({ hours: 'Tue–Sat 9am–5pm' }).hours
    expect(hours).toBe('Tu-Sa 09:00-17:00')
    // The picker's own writer, over the picker's own reader, gives the same text.
    expect(weeklyHoursToText(weeklyHoursFromText(hours).hours)).toBe(hours)
    expect(aiSiteHoursSentence(hours)).toBe('Tue–Sat 9am–5pm')
    // And the create door admits it as it stands.
    expect(parseAiSiteDetails({ hours })).toMatchObject({ hours })
  })

  it('reads the ways an owner says their hours', () => {
    expect(answers({ hours: 'Mon–Fri 8am–5:30pm, Sat 9am–1pm' }).hours).toBe('Mo-Fr 08:00-17:30\nSa 09:00-13:00')
    expect(answers({ hours: 'Mon to Fri 9 a.m. to 5 p.m.' }).hours).toBe('Mo-Fr 09:00-17:00')
    expect(answers({ hours: 'Mo-Fr 09:00-17:00; Sa 10:00-14:00' }).hours).toBe('Mo-Fr 09:00-17:00\nSa 10:00-14:00')
    expect(answers({ hours: 'Fri 12pm–12am' }).hours).toBe('Fr 12:00-00:00')
    expect(answers({ hours: 'Mon, Wed, Fri 8am-12pm\nTue 1pm-6pm' }).hours).toBe('Mo,We,Fr 08:00-12:00\nTu 13:00-18:00')
  })

  it('leaves hours that do not read empty, keeps the ones that do, and the brief still says all of them', () => {
    expect(answers({ hours: 'Mon–Fri 8am–5pm, Sat by appointment' }).hours).toBe('Mo-Fr 08:00-17:00')
    for (const hours of ['Mon–Fri 8–5', 'by appointment', 'Mon–Fri 13pm–5pm', 'weekdays 9am-5pm']) {
      expect(answers({ hours }).hours).toBe('')
      expect(aiSiteStartClientBrief({ ...EMPTY, hours })).toBe(`Its hours are ${hours}.`)
    }
  })
})
