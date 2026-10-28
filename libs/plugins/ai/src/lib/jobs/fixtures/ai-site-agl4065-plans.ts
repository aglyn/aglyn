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

import type { AiLayoutPagePlan } from '../../layout-language/ai-layout-compiler'
import type { AiLayoutSection } from '../../layout-language/ai-layout-language'
import type { AiLayoutTargets } from '../../layout-language/ai-layout-links'
import type { AiLayoutListing } from '../../layout-language/ai-layout-listings'

/**
 * Two booth-kit home pages from the guided starts of 2026-10-25 (AGL-4065),
 * the two trades sites that shared one layout: Holeshot Moto Repair and Two
 * Oaks Handyman, both fictional businesses built in the test workspace.
 *
 * Each plan is the job's own home plan, as its plan step wrote it. Each
 * page's sections are the model's design, rebuilt in the layout language
 * from the words the stored page shows (the decoded page trees): the same
 * bands, headings, ledes and items. Every contact line is left out — the
 * phone and email buttons, the street address an answer gave — so nothing
 * here names a real person, number or address. The towns are the sites'
 * service areas.
 *
 * Alongside them, the item groups whose icons came out random: the "Towns
 * we serve" and "Areas we serve" rows and the reasons to trust each shop.
 */

const block = (kind: AiLayoutSection['blocks'][number]['kind'], text = '', extra: Partial<AiLayoutSection['blocks'][number]> = {}) => ({
  kind,
  text,
  ...extra,
})
const items = (...entries: Array<[string, string?]>) => entries.map(([title, text = '']) => ({ title, text }))

// ── Holeshot Moto Repair (trades) ────────────────────────────────────────

/** The words the job was given, minus its contact details: no phone, email or street. */
export const HOLESHOT_FACTS = [
  'A 5-page website for Motorcycle and dirt bike repair shop: engine rebuilds, suspension, tires, race prep, service; books repair appointments.',
  'Motorcycle and dirt bike repair shop: engine rebuilds, suspension, tires, race prep, service; books repair appointments',
  'Dirt bike and street riders, motocross racers and youth-racer parents around San Marcos who want fast, honest repairs',
  'trades',
  'Holeshot Moto Repair',
  'San Marcos',
  'Back on the gate by race day',
  '2014',
  'San Marcos\nKyle\nBuda\nWimberley\nNew Braunfels\nLockhart',
  'English, Spanish',
  'Tu-Sa 09:00-17:00',
  'Open Tuesday to Saturday, 9am to 5pm',
  'TX',
  'United States',
].join('\n')

export const HOLESHOT_HOME_PLAN: AiLayoutPagePlan = {
  title: 'Home',
  sections: [
    { name: 'Hero with book a repair button', uses: [], items: 0 },
    { name: 'How a job goes, step by step', uses: [], items: 4 },
    { name: 'What we repair', uses: ['new:Repair services'], items: 5 },
    { name: 'Why riders and racing parents trust the shop', uses: [], items: 3 },
    { name: 'Questions riders ask, answered', uses: [], items: 5 },
    { name: 'Call to action: book your repair', uses: [], items: 0 },
  ],
}

/** The hero's eyebrow as the model wrote it: 42 characters, cut to "San Marcos motorcycle and dirt bike" on the live page. */
export const HOLESHOT_EYEBROW = 'San Marcos motorcycle and dirt bike repair'

export const HOLESHOT_TRUST = items(
  ['Open since 2014', 'Years of work on dirt bikes and street bikes around San Marcos.'],
  ['Straight answers', "We explain what your bike needs and what it doesn't."],
  ['English and Spanish', "Talk to us in the language you're comfortable with."],
)

export const HOLESHOT_HOME_SECTIONS: AiLayoutSection[] = [
  {
    band: 'dark',
    blocks: [
      block('eyebrow', HOLESHOT_EYEBROW),
      block('heading', 'Back on the gate by race day', { style: 'large' }),
      block('lede', 'Fast, honest repairs for dirt bike and street riders, racers and youth-racer parents.'),
      block('button', 'Book a repair', { to: 'page:pg-book', style: 'primary' }),
    ],
  },
  {
    band: 'plain',
    blocks: [
      block('heading', 'How a job goes, step by step'),
      block('steps', '', {
        items: items(
          ['Tell us about the bike', "Send the make, model, year and what's wrong, plus your race date if you have one."],
          ['Pick a day', 'We book a drop-off that fits your schedule.'],
          ['We diagnose and repair', 'We find the problem and tell you what it needs before the work starts.'],
          ['Pick up and ride', 'Your bike is ready and checked, so you can get back on the track or the road.'],
        ),
      }),
    ],
  },
  {
    band: 'soft',
    blocks: [
      block('heading', 'What we repair'),
      block('text', 'From full engine work to a routine service, we handle dirt bikes and street bikes.'),
      block('cards', '', { items: items(['Engine rebuilds'], ['Suspension'], ['Tires'], ['Race prep'], ['Service']) }),
    ],
  },
  {
    band: 'plain',
    blocks: [block('heading', 'Why riders and racing parents trust the shop'), block('cards', '', { items: HOLESHOT_TRUST })],
  },
  {
    band: 'soft',
    blocks: [
      block('heading', 'Questions riders ask, answered'),
      block('faq', '', {
        items: items(
          ['What do you repair?', 'Engine rebuilds, suspension, tires, race prep and service.'],
          ['Can you get my bike ready for a race?', "Yes. Give us your race date when you book and we'll plan around it."],
          ['When are you open?', 'Tuesday to Saturday, 9am to 5pm.'],
          ['Do you speak Spanish?', 'Yes, we work in English and Spanish.'],
        ),
      }),
    ],
  },
  {
    band: 'brand',
    align: 'center',
    blocks: [
      block('heading', 'Book your repair'),
      block('lede', 'Tell us what your bike needs and when you need it back.'),
      block('button', 'Book a repair', { to: 'page:pg-book', style: 'primary' }),
    ],
  },
]

/** The "Repair services" dataset the home lists, as the job proposed it: no photo field. */
const HOLESHOT_REPAIRS: AiLayoutListing = {
  id: 'listing:records:dsRepairs',
  kind: 'records',
  name: 'Repair services',
  records: ['Engine rebuilds', 'Suspension', 'Tires', 'Race prep', 'Service'],
  datasetId: 'dsRepairs',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'summary', name: 'Summary', type: 'text' },
    { id: 'typical_turnaround', name: 'Typical turnaround', type: 'text' },
    { id: 'bike_types', name: 'Bike types', type: 'sorted' },
  ],
  placements: [
    { screenId: 'pg-home', section: 2, role: 'featured' },
    { screenId: 'pg-services', section: 1, role: 'index' },
  ],
}

export const HOLESHOT_TARGETS: AiLayoutTargets = {
  pageId: 'pg-home',
  pages: [
    { id: 'pg-services', label: 'Services', slug: '/services' },
    { id: 'pg-about', label: 'About', slug: '/about' },
    { id: 'pg-area', label: 'Service Area', slug: '/service-area' },
    { id: 'pg-book', label: 'Book a Repair', slug: '/book-a-repair' },
  ],
  homeIds: ['pg-home'],
  forms: [{ id: 'form-repair', name: 'Repair request form' }],
  formPageId: 'pg-book',
  components: [],
  facts: HOLESHOT_FACTS,
  listings: [HOLESHOT_REPAIRS],
}

// ── Two Oaks Handyman (trades) ───────────────────────────────────────────

export const TWO_OAKS_FACTS = [
  'A 5-page website for Handyman business: home repairs, drywall, fences and decks, doors and trim, small remodels; takes quote requests.',
  'Handyman business: home repairs, drywall, fences and decks, doors and trim, small remodels; takes quote requests',
  'Homeowners and landlords around Seguin who need repairs done right without hiring three different trades',
  'trades',
  'Two Oaks Handyman',
  'Seguin',
  'Fixed right the first time, on time',
  '2012',
  'Seguin\nNew Braunfels\nSchertz\nCibolo\nMarion',
  'English, Spanish',
  'Mo-Sa 09:00-17:00',
  'Open Mon–Sat 9am–5pm',
  'TX',
  'United States',
].join('\n')

export const TWO_OAKS_HOME_PLAN: AiLayoutPagePlan = {
  title: 'Home',
  sections: [
    { name: 'Hero: fixed right the first time', uses: [], items: 0 },
    { name: 'Why homeowners and landlords trust us', uses: [], items: 4 },
    { name: 'What we repair and build', uses: ['new:Services list'], items: 6 },
    { name: 'How a job goes', uses: [], items: 4 },
    { name: 'Questions people ask', uses: ['new:Common questions'], items: 5 },
    { name: 'Towns we serve', uses: [], items: 5 },
    { name: 'Call to action: ask for a quote', uses: [], items: 0 },
  ],
}

export const TWO_OAKS_TRUST = items(
  ['One call, many trades', 'Repairs, drywall, fences and trim handled by one person, not three.'],
  ['Serving Seguin since 2012', 'Over a decade of work for local homes and rentals.'],
  ['On time', 'We show up when we say we will.'],
  ['English and Spanish', 'Talk to us in the language you prefer.'],
)

/** "Towns we serve" on the Two Oaks home, as the page showed it. */
export const TWO_OAKS_TOWNS = items(
  ['Seguin', 'Our home base.'],
  ['New Braunfels', 'Repairs and remodels.'],
  ['Schertz', 'Homes and rentals.'],
  ['Cibolo', 'Homes and rentals.'],
  ['Marion', 'Homes and rentals.'],
)

export const TWO_OAKS_HOME_SECTIONS: AiLayoutSection[] = [
  {
    band: 'dark',
    blocks: [
      block('eyebrow', 'Two Oaks Handyman · Seguin, TX'),
      block('heading', 'Fixed right the first time, on time', { style: 'large' }),
      block('lede', 'One handyman for repairs, drywall, fences, decks, doors, trim and small remodels around Seguin.'),
      block('button', 'Ask for a quote', { to: 'page:pg-contact', style: 'primary' }),
    ],
  },
  { band: 'plain', blocks: [block('heading', 'Why homeowners and landlords trust us'), block('cards', '', { items: TWO_OAKS_TRUST })] },
  {
    band: 'soft',
    blocks: [
      block('heading', 'What we repair and build'),
      block('lede', 'From a patched wall to a new deck, here is the work we do most.'),
      block('cards', '', { items: items(['Home repairs'], ['Drywall'], ['Fences and decks']) }),
    ],
  },
  {
    band: 'plain',
    blocks: [
      block('heading', 'How a job goes'),
      block('steps', '', {
        items: items(
          ['Send your request', 'Tell us what needs fixing and where.'],
          ['We review the job', 'We get back to you to talk through details and timing.'],
          ['We do the work', 'Repairs done properly, in one visit where possible.'],
          ['Final walk-through', 'We check the result with you before we leave.'],
        ),
      }),
    ],
  },
  {
    band: 'soft',
    blocks: [block('heading', 'Questions people ask'), block('lede', 'Quick answers about jobs, areas, quotes and languages.')],
  },
  { band: 'plain', blocks: [block('heading', 'Towns we serve'), block('cards', '', { items: TWO_OAKS_TOWNS })] },
  {
    band: 'dark',
    align: 'center',
    blocks: [
      block('heading', 'Ready for a quote?'),
      block('lede', 'Describe the job and we will get back to you. Open Mon–Sat 9am–5pm.'),
      block('button', 'Ask for a quote', { to: 'page:pg-contact', style: 'primary' }),
    ],
  },
]

const TWO_OAKS_SERVICES: AiLayoutListing = {
  id: 'listing:records:dsServices',
  kind: 'records',
  name: 'Services list',
  records: ['Home repairs', 'Drywall', 'Fences and decks', 'Doors and trim', 'Small remodels', 'Rental unit repairs'],
  datasetId: 'dsServices',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'summary', name: 'Summary', type: 'text' },
    { id: 'typical_jobs', name: 'Typical jobs', type: 'text' },
    { id: 'category', name: 'Category', type: 'text' },
    { id: 'image_description', name: 'Image description', type: 'text' },
  ],
  imageField: 'image',
  placements: [
    { screenId: 'pg-home', section: 2, role: 'featured' },
    { screenId: 'pg-services', section: 1, role: 'index' },
  ],
}

const TWO_OAKS_QUESTIONS: AiLayoutListing = {
  id: 'listing:records:dsQuestions',
  kind: 'records',
  name: 'Common questions',
  records: ['What kinds of jobs does Two Oaks Handyman take on?', 'Which areas do you serve?', 'How do I ask for a quote?'],
  datasetId: 'dsQuestions',
  fields: [
    { id: 'question', name: 'Question', type: 'text' },
    { id: 'answer', name: 'Answer', type: 'text' },
  ],
  placements: [
    { screenId: 'pg-home', section: 4, role: 'featured' },
    { screenId: 'pg-how', section: 2, role: 'index' },
  ],
}

export const TWO_OAKS_TARGETS: AiLayoutTargets = {
  pageId: 'pg-home',
  pages: [
    { id: 'pg-services', label: 'Services', slug: '/services' },
    { id: 'pg-about', label: 'About', slug: '/about' },
    { id: 'pg-how', label: 'How it works', slug: '/how-it-works' },
    { id: 'pg-contact', label: 'Contact and Quote', slug: '/contact' },
  ],
  homeIds: ['pg-home'],
  forms: [{ id: 'form-quote', name: 'Quote request form' }],
  formPageId: 'pg-contact',
  components: [],
  facts: TWO_OAKS_FACTS,
  listings: [TWO_OAKS_SERVICES, TWO_OAKS_QUESTIONS],
}

// ── The other rows whose icons came out random ───────────────────────────

/** Bluebonnet Yard & Landscape (business): its hero's eyebrow as written, 42 characters, cut to "…in New" live. */
export const BLUEBONNET_EYEBROW = 'Lawn care and landscaping in New Braunfels'

export const BLUEBONNET_FACTS = [
  'Landscaping company: lawn care, native plant beds, xeriscape, sod, irrigation repair, seasonal cleanups; free estimates',
  'business',
  'Bluebonnet Yard & Landscape',
  'New Braunfels',
  'New Braunfels\nCanyon Lake\nGarden Ridge\nSeguin\nGruene',
  'English, Spanish',
  'TX',
].join('\n')

/** "Areas we serve" on the Bluebonnet home: five towns, a title each. */
export const BLUEBONNET_AREAS = items(['New Braunfels'], ['Canyon Lake'], ['Garden Ridge'], ['Seguin'], ['Gruene'])

/** "Areas we serve" on the Berm & Bolt Moto Parts About page (store). */
export const BERM_AND_BOLT_AREAS = items(
  ['Kyle', 'Home of our shop and pickup counter.'],
  ['Buda', 'Just up the road.'],
  ['San Marcos', 'Pick up on your way home.'],
  ['Lockhart', 'Ranch and trail riders welcome.'],
  ['Austin', 'Worth the drive for fast parts.'],
)
