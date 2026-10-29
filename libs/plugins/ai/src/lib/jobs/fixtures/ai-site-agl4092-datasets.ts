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

import type { AiBuildPlan, AiBuildPlanCreate, AiBuildPlanScreen } from '../../model/ai-build-plan'

/**
 * RECORDED, NOT GOLDEN (AGL-4092): what the 2026-10-28 Rut Runners Racing
 * start in the test workspace planned and wrote, and the About page an Assist
 * build then proposed for it, for the offline replays of Lane B. The business
 * is fictional. No contact detail, street, person, workspace or site id is
 * kept: screen ids are this fixture's own, and the contact details the brief
 * and the plan quoted are left out.
 *
 *  - The site job's "Riders" and "Race results" datasets, as their records
 *    were written: six sample riders whose every bio ends "Add this rider's
 *    story here.", and eleven sample races whose every past one has the
 *    result "Add finishing position". Dates are "" as the tool answers them;
 *    the platform sets them.
 *  - The Assist build's brief, as the chat wrote it, and its plan's About
 *    page, whose section names carried "[year founded]", "[team story]",
 *    "[age and class requirements]", "[email]" and "[phone]".
 */

/** The site job's "Riders" creation, as planned. */
export const RUT_1028_RIDERS: AiBuildPlanCreate = {
  kind: 'dataset',
  name: 'Riders',
  why: 'Rider profiles are a list of 4 or more similar items and none of the listed datasets holds them.',
  duplicateOf: null,
  fields: ['Name', 'Class', 'Bike number', 'Hometown', 'Bio', 'Photo'],
  id: 'fxRiders28',
}

/** The site job's "Race results" creation, as planned. */
export const RUT_1028_RACE_RESULTS: AiBuildPlanCreate = {
  kind: 'dataset',
  name: 'Race results',
  why: 'The race schedule and results are a list of events and no listed dataset holds them.',
  duplicateOf: null,
  fields: ['Event', 'Date', 'Track', 'Class', 'Result', 'Status'],
  id: 'fxRaces28',
}

const page = (id: string, title: string, slug: string, sections: Array<[string, string[], number]>): AiBuildPlanScreen => ({
  id,
  title,
  slug,
  layout: 'new:Team site layout',
  template: null,
  duplicateOf: null,
  nav: true,
  seoTitle: title,
  seoDescription: title,
  record: null,
  sections: sections.map(([name, uses, items]) => ({ name, uses, items })),
})

/** The site job's pages, as planned (titles, addresses and sections). */
export const RUT_1028_SCREENS: AiBuildPlanScreen[] = [
  page('fx28Home', 'Home', '/', [
    ['Hero with team tagline and Meet the riders button', [], 0],
    ['How to start: four steps to join the team', [], 4],
    ['Programs: classes our riders race in', [], 5],
    ['The team in pictures: garage, track and podium', [], 6],
    ['Meet the riders', ['new:Riders'], 4],
    ['Questions people ask, answered', [], 5],
    ['Call to action: Contact the team button', [], 0],
  ]),
  page('fx28Riders', 'Riders', '/riders', [
    ['Riders intro', [], 0],
    ['Rider profiles', ['new:Riders'], 6],
    ['Want to ride with us: join call to action', [], 0],
  ]),
  page('fx28Schedule', 'Race Schedule and Results', '/schedule-results', [
    ['Season overview', [], 0],
    ['Upcoming races', ['new:Race results'], 5],
    ['Past results', ['new:Race results'], 6],
    ['Come watch: what to expect at the track', [], 3],
  ]),
  page('fx28Sponsors', 'Sponsors', '/sponsors', [
    ['Why local businesses sponsor the team', [], 0],
    ['Ways to sponsor', [], 4],
    ['What working together is like', [], 4],
    ['Our current sponsors', [], 0],
    ['Call to action: become a sponsor button', [], 0],
  ]),
  page('fx28Contact', 'Contact', '/contact', [
    ['Get in touch intro', [], 0],
    ['Sponsor, fan and join inquiry form', ['new:Sponsor and join inquiry form'], 0],
    ['Where to find us: address, phone, email and service area', [], 5],
  ]),
]

/** The site job's brief, as the dataset unit's opened with it (no contact details). */
export const RUT_1028_BRIEF =
  'A 5-page website for Amateur motocross race team: rider profiles, race schedule and results, sponsors, and sponsor inquiries. It is for Local businesses that sponsor riders, race fans and families following the team, and young riders who want to join. Make it a fitness & sports site. Plan a page for each thing a visitor comes to do, with the contact form on the page a visitor opens to get in touch.'

/** The instruction every recorded bio ended with. */
export const RIDER_INSTRUCTION = "Add this rider's story here."

/** The instruction every recorded past result was. */
export const RESULT_INSTRUCTION = 'Add finishing position'

const RIDER_FIELDS = RUT_1028_RIDERS.fields.map((name) => ({ name, type: 'text' }))

/** One sample rider as the tool answers it: name, class, bike number, hometown, bio, photo. */
const rider = (name: string, klass: string, bio: string) => ({ values: [name, klass, '', '', bio, ''], sample: true })

/** The six riders' names, classes and the bios' first sentences, as written. */
const RIDERS: Array<[string, string, string]> = [
  ['Youth rider, 65cc class', '65cc Beginner', 'A young rider learning race starts, corners and track etiquette with the team.'],
  ['Youth rider, 85cc class', '85cc Junior', 'A junior rider building speed and consistency through the season.'],
  ['Amateur rider, 125cc class', '125cc Amateur', 'An amateur rider racing local rounds for Rut Runners Racing.'],
  ['Amateur rider, 250cc class', '250cc Amateur', "A full-size bike rider who races the team's Central Texas rounds."],
  ["Women's class rider", "Women's Amateur", "A rider competing in the women's class for the team."],
  ['Vet class rider', 'Vet Amateur', 'An experienced rider racing in the vet class and mentoring newer teammates.'],
]

/** The first sentence of each recorded bio: what is left once the instruction is taken out. */
export const RIDER_BIOS = RIDERS.map(([, , bio]) => bio)

/** The "Riders" answer of 2026-10-28, through the tool: six samples, each bio ending in the instruction. */
export const RIDERS_INSTRUCTION_ANSWER = {
  fields: RIDER_FIELDS,
  records: RIDERS.map(([name, klass, bio]) => rider(name, klass, `${bio} ${RIDER_INSTRUCTION}`)),
}

/**
 * A second answer of the same kind (AGL-4092): the six riders again, and one
 * row whose only words are an instruction to the owner, which nothing is left
 * of once it is taken out.
 */
export const RIDERS_INSTRUCTION_ANSWER_AGAIN = {
  fields: RIDER_FIELDS,
  records: [...RIDERS_INSTRUCTION_ANSWER.records, { values: ["Add this rider's name here.", '', '', '', '', ''], sample: true }],
}

/** The answer the re-ask is for: the six riders, each bio finished copy about its sample. */
export const RIDERS_FINISHED_ANSWER = {
  fields: RIDER_FIELDS,
  records: RIDERS.map(([name, klass, bio]) => rider(name, klass, `${bio} Rides most weekends with the team at tracks around Central Texas.`)),
}

const RACE_FIELDS = RUT_1028_RACE_RESULTS.fields.map((name) => ({ name, type: 'text' }))

/** One sample race as the tool answers it: event, date, track, class, result, status. */
const race = (event: string, track: string, klass: string, status: 'Upcoming' | 'Past', result = '') => ({
  values: [event, '', track, klass, result, status],
  sample: true,
})

/** The "Race results" answer of 2026-10-28, through the tool: five to come, six behind, each past result the instruction. */
export const RACE_RESULTS_INSTRUCTION_ANSWER = {
  fields: RACE_FIELDS,
  records: [
    race('Season Opener Race Day', 'Local motocross track', 'Youth 65cc', 'Upcoming'),
    race('Series Round 2', 'Central Texas track', 'Youth 85cc', 'Upcoming'),
    race('Lockhart Home Track Race', 'Lockhart track', 'Beginner', 'Upcoming'),
    race('Series Round 3', 'Central Texas track', 'Junior', 'Upcoming'),
    race('Season Finale Race Day', 'Central Texas track', 'Open Amateur', 'Upcoming'),
    race('Series Round 1', 'Central Texas track', 'Youth 65cc', 'Past', RESULT_INSTRUCTION),
    race('Spring Club Race', 'Local motocross track', 'Youth 85cc', 'Past', RESULT_INSTRUCTION),
    race('San Marcos Area Race Day', 'San Marcos area track', 'Beginner', 'Past', RESULT_INSTRUCTION),
    race('Austin Area Race Day', 'Austin area track', 'Junior', 'Past', RESULT_INSTRUCTION),
    race('Luling Area Race Day', 'Luling area track', 'Open Amateur', 'Past', RESULT_INSTRUCTION),
    race('Practice and Club Day', 'Local motocross track', 'Beginner', 'Past', RESULT_INSTRUCTION),
  ],
}

// ── The Assist build (AGL-4092) ────────────────────────────────────────

/**
 * The brief the chat wrote for the About page, as the build tool carried it,
 * with the contact details it quoted left out. Its second-to-last sentences
 * are the chat's own: nothing in the build protocol asked for placeholders.
 */
export const ASSIST_ABOUT_BRIEF =
  "Create an About page (slug /about) for Rut Runners Racing, an amateur motocross race team for local businesses based in Lockhart, Texas, serving Lockhart, Luling, San Marcos, Austin and Central Texas. Audience: local businesses that sponsor riders, race fans and families following the team, and young riders who want to join. Tone: warm and plain, no exclamation marks. Cover who the team is, what it does, the area it serves, how local businesses can sponsor riders, and how young riders can join, with a link to the existing Sponsors, Riders and Contact pages. Use only the contact details on file. Do not invent names, history, prices, results or testimonials; use bracketed placeholders where details are missing. Also propose a warmer look for the site's theme: warmer colors, friendlier fonts and softer rounded corners, for the owner to apply in Setup → Theme."

/** The About page the Assist build's plan proposed, its section names as planned (the street left out). */
export const ASSIST_ABOUT_PLAN: Pick<AiBuildPlan, 'screens'> = {
  screens: [
    {
      id: 'fx28About',
      title: 'About',
      slug: '/about',
      layout: 'fxLayout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About Rut Runners Racing | Amateur Motocross in Lockhart, TX',
      seoDescription:
        'Meet Rut Runners Racing, an amateur motocross team for local businesses in Lockhart, Texas. See how to sponsor a rider or join the team.',
      record: null,
      sections: [
        { name: 'Hero: About the team, with the one h1', uses: [], items: 0 },
        { name: 'Who we are: an amateur motocross team for local businesses, with [year founded] and [team story]', uses: [], items: 0 },
        { name: 'What the team does: racing, riders and following along', uses: [], items: 3 },
        { name: 'Where we race and who we serve: Lockhart, Luling, San Marcos, Austin and Central Texas', uses: [], items: 5 },
        { name: 'Sponsor a rider: how local businesses can help, with a link to the Sponsors page', uses: ['fxSponsors'], items: 0 },
        { name: 'Young riders: how to join, with a link to the Riders page, and [age and class requirements]', uses: ['fxRiders'], items: 0 },
        { name: 'Contact details: [email], [phone], Lockhart, TX, United States, with a link to the Contact page', uses: ['fxContact'], items: 3 },
      ],
    },
  ],
}

/** What those section names read once nothing in them is a gap. */
export const ASSIST_ABOUT_SECTION_NAMES = [
  'Hero: About the team, with the one h1',
  'Who we are: an amateur motocross team for local businesses',
  'What the team does: racing, riders and following along',
  'Where we race and who we serve: Lockhart, Luling, San Marcos, Austin and Central Texas',
  'Sponsor a rider: how local businesses can help, with a link to the Sponsors page',
  'Young riders: how to join, with a link to the Riders page',
  'Contact details: Lockhart, TX, United States, with a link to the Contact page',
]

/** The guided start's answers the site job carried (no contact details): the year founded among them. */
export const RUT_1028_INPUTS = {
  businessType: 'Amateur motocross race team: rider profiles, race schedule and results, sponsors, and sponsor inquiries',
  audience: 'Local businesses that sponsor riders, race fans and families following the team, and young riders who want to join',
  starter: 'business',
  siteKind: 'fitness',
  pages: 5,
  businessName: 'Rut Runners Racing',
  city: 'Lockhart',
  tagline: 'Built in Lockhart, raced across Texas',
  founded: '2019',
  serviceArea: 'Lockhart\nLuling\nSan Marcos\nAustin\nCentral Texas',
  languages: 'English, Spanish',
}
